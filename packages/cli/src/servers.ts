// 動いている serve の一覧・停止（ondina serve list / stop / restart。設計書 12 章）。
// AI エージェントがいろいろなポートで serve を起動すると、どれがどれか分からなくなる。ondina update の前から動いている serve は、
// 古いコードのまま新しい画面を配り続ける（2026-10-23 にテーマが保存されない不具合の原因になった）。
// 登録ファイルは作らず、待ち受けている node から拾う。登録ファイルは kill -9 で消え残り、この仕組みより前に起動した serve も見つけられない。
// lsof で pid とポートを出し、各ポートの GET /api/repo の pid が lsof の pid と同じものだけを serve とする
// （画面の開発サーバー（vite）は /api を serve に中継するので、別の pid で答える）。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { probePort, type ServeInfo } from './background.js';

export interface RunningServe {
  pid: number;
  port: number;
  /** serve を起動したリポジトリ */
  folder: string;
  /** 起動したときの ondina の clone のコミット。2026-10-23 より前の serve には無い */
  version?: string;
  startedAt?: string;
}

export interface Listener {
  pid: number;
  port: number;
}

export interface ServersDeps {
  /** 待ち受けている node の pid とポート */
  listeners: () => Promise<Listener[]>;
  /** そのポートの GET /api/repo。ondina の serve でなければ undefined */
  probe: (port: number) => Promise<ServeInfo | undefined>;
  kill: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const STOP_TIMEOUT_MS = 10_000;

/** `lsof -F` の出力。p の行が pid、n の行が `アドレス:ポート`（IPv4 と IPv6 で同じポートが 2 行出ることがある） */
export function parseLsof(out: string): Listener[] {
  const found: Listener[] = [];
  let pid: number | undefined;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    const port = line.startsWith('n') ? /:(\d+)$/.exec(line)?.[1] : undefined;
    if (pid === undefined || port === undefined) continue;
    const l = { pid, port: Number(port) };
    if (!found.some((f) => f.pid === l.pid && f.port === l.port)) found.push(l);
  }
  return found;
}

async function lsofListeners(): Promise<Listener[]> {
  try {
    const { stdout } = await promisify(execFile)('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-c', 'node', '-Fpn']);
    return parseLsof(stdout);
  } catch (e) {
    const err = e as { code?: unknown; stdout?: unknown };
    if (err.code === 'ENOENT') throw new Error('lsof が見つかりません。動いている serve を探すのに使います');
    // 待ち受けている node が無ければ、何も出さずに終了コード 1
    if (typeof err.code === 'number') return parseLsof(typeof err.stdout === 'string' ? err.stdout : '');
    throw e;
  }
}

export function defaultServersDeps(): ServersDeps {
  return {
    listeners: lsofListeners,
    probe: async (port) => {
      const use = await probePort(port);
      return use.kind === 'ondina' ? use : undefined;
    },
    kill: (pid, signal) => process.kill(pid, signal),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  };
}

/** 動いている serve をポート順に */
export async function findServes(d: ServersDeps): Promise<RunningServe[]> {
  const found = await Promise.all(
    (await d.listeners()).map(async ({ pid, port }): Promise<RunningServe[]> => {
      const info = await d.probe(port);
      if (info === undefined || info.pid !== pid) return [];
      return [{ pid, port, folder: info.repo, ...(info.version === undefined ? {} : { version: info.version }), ...(info.startedAt === undefined ? {} : { startedAt: info.startedAt }) }];
    }),
  );
  return found.flat().sort((a, b) => a.port - b.port);
}

export type StopResult = { status: 'stopped' } | { status: 'stuck' } | { status: 'failed'; reason: string };

/** SIGTERM を送り、そのポートが同じ pid で応答しなくなるまで待つ（serve は SIGTERM で待ち受けを閉じて終わる。main.ts） */
export async function stopServe(s: RunningServe, d: ServersDeps): Promise<StopResult> {
  try {
    d.kill(s.pid, 'SIGTERM');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') return { status: 'failed', reason: e instanceof Error ? e.message : String(e) };
  }
  const start = d.now();
  for (;;) {
    if ((await d.probe(s.port))?.pid !== s.pid) return { status: 'stopped' };
    if (d.now() - start >= STOP_TIMEOUT_MS) return { status: 'stuck' };
    await d.sleep(200);
  }
}

/** バージョンが無い（この仕組みより前の serve）か、今の clone のコミットと違う */
export function isOutdated(s: RunningServe, installed: string | undefined): boolean {
  return s.version === undefined || (installed !== undefined && s.version !== installed);
}

const two = (n: number): string => String(n).padStart(2, '0');

function shortTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '—';
  return `${two(t.getMonth() + 1)}/${two(t.getDate())} ${two(t.getHours())}:${two(t.getMinutes())}`;
}

// 端末で 2 文字分の幅になる文字（かな・漢字・全角の括弧など）
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
const width = (s: string): number => [...s].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0);

/** ポート・pid・起動・バージョン・フォルダの表。列は端末の幅で揃える */
export function formatServes(serves: readonly RunningServe[], installed: string | undefined, home: string): string {
  const rows = [
    ['ポート', 'pid', '起動', 'バージョン', 'フォルダ'],
    ...serves.map((s) => [
      String(s.port),
      String(s.pid),
      s.startedAt === undefined ? '—' : shortTime(s.startedAt),
      `${s.version ?? '—'}${isOutdated(s, installed) ? '（更新前）' : ''}`,
      s.folder === home || s.folder.startsWith(`${home}/`) ? `~${s.folder.slice(home.length)}` : s.folder,
    ]),
  ];
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => width(r[i]!))));
  const line = (r: string[]): string => r.map((cell, i) => (i === r.length - 1 ? cell : cell + ' '.repeat(widths[i]! - width(cell) + 2))).join('');
  return rows.map(line).join('\n') + '\n';
}
