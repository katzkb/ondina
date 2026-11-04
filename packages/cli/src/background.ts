// ondina serve --background（設計書 12 章）。AI エージェントから開くとき、エージェントが終わっても画面が残るように、
// serve を親から切り離して（別のプロセスグループで）起動し、URL を出して戻る。
// Codex はセッションの終わりに子を止める。`nohup … &` でも止まり、setsid で切り離したものだけが残った（2026-10-12 に確かめた）。
// このリポジトリの serve が既に動いていれば起動せずそれを使い、ポートを別のものが使っていれば空いているポートで起動する。
// 同じリポジトリの別の worktree の serve も、PR 番号を開くなら使う（PR 番号の解析は元のフォルダに置き、どの serve にも出る。store.ts の keyDir）。
// local（PR の無い変更）は打った worktree にしか無いので、その worktree の serve だけを使う。
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { mainWorktree } from './git.js';

/** ondina の serve の GET /api/repo の答え。version と startedAt は 2026-10-23 より前の serve には無い */
export interface ServeInfo {
  repo: string;
  pid: number;
  version?: string;
  startedAt?: string;
}

/** ポートの使われ方。ondina の serve なら、どのリポジトリか */
export type PortUse = { kind: 'free' } | ({ kind: 'ondina' } & ServeInfo) | { kind: 'other' };

export interface Detached {
  pid: number;
  /** 終わっていれば終了コード（シグナルで終わったら null）。動いている間は undefined */
  exitCode: () => number | null | undefined;
}

export interface BackgroundDeps {
  probe: (port: number) => Promise<PortUse>;
  /** `ondina <args>` を切り離して起こし、標準出力と標準エラーを logFile に書かせる */
  spawn: (repo: string, args: string[], logFile: string) => Detached;
  readLog: (file: string) => string;
  sleep: (ms: number) => Promise<void>;
  /** URL が出るまで待つ長さ */
  timeoutMs: number;
  now?: () => number;
}

export type BackgroundResult =
  | { status: 'reused'; url: string; pid: number }
  /**
   * movedFrom: 頼まれたポートを使っていたので空いているポートで起動した。occupiedBy はそこにいた serve のフォルダ。
   * sameRepo: それが同じリポジトリの別の worktree（local を開くので使えなかった）
   */
  | { status: 'started'; url: string; pid: number; log: string; movedFrom?: number; occupiedBy?: string; sameRepo?: true }
  | { status: 'failed'; reason: string };

const URL_LINE = /^ondina serve: (http\S+)$/m;

/** 開く画面の URL。PR は /pr/<番号>、local は /local（画面の URL の形は packages/web/src/route.ts）。base は / で終わる */
export function pageUrl(base: string, key: string | undefined): string {
  if (key === undefined) return base;
  return `${base}${key === 'local' ? 'local' : `pr/${encodeURIComponent(key)}`}`;
}

const serveUrl = (port: number, key: string | undefined): string => pageUrl(`http://127.0.0.1:${port}/`, key);

function sameDir(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

export async function serveInBackground(repo: string, port: number, key: string | undefined, d: BackgroundDeps): Promise<BackgroundResult> {
  let listen = port;
  let moved: { movedFrom: number; occupiedBy?: string; sameRepo?: true } | undefined;
  if (port !== 0) {
    const use = await d.probe(port);
    const sameRepo = use.kind === 'ondina' && sameDir(mainWorktree(use.repo), mainWorktree(repo));
    if (use.kind === 'ondina' && (sameDir(use.repo, repo) || (sameRepo && key !== 'local'))) return { status: 'reused', url: serveUrl(port, key), pid: use.pid };
    if (use.kind !== 'free') {
      listen = 0;
      moved = { movedFrom: port, ...(use.kind === 'ondina' ? { occupiedBy: use.repo } : {}), ...(sameRepo ? { sameRepo: true as const } : {}) };
    }
  }
  const log = path.join(repo, '.ondina', 'serve.log');
  let child: Detached;
  try {
    mkdirSync(path.dirname(log), { recursive: true });
    child = d.spawn(repo, ['serve', '--port', String(listen), ...(key === undefined ? [] : [key])], log);
  } catch (e) {
    // サンドボックスで .ondina/ に書けないなど。EPERM の文を残す（スキルが見て許可を求める）
    return { status: 'failed', reason: e instanceof Error ? e.message : String(e) };
  }
  const now = d.now ?? Date.now;
  const start = now();
  for (;;) {
    const text = d.readLog(log);
    const m = URL_LINE.exec(text);
    if (m) return { status: 'started', url: m[1]!, pid: child.pid, log, ...moved };
    const code = child.exitCode();
    if (code !== undefined) return { status: 'failed', reason: `serve が終わりました（終了コード ${code ?? 'なし'}）: ${text.trim() || '（出力なし）'}` };
    if (now() - start >= d.timeoutMs) return { status: 'failed', reason: `${d.timeoutMs / 1000} 秒待っても URL が出ません（pid ${child.pid}、ログ ${log}）: ${text.trim() || '（出力なし）'}` };
    await d.sleep(100);
  }
}

/** entry は ondina の入口（既定は今動いている自分。tsx で動かしているときはその読み込みの指定ごと） */
export function spawnDetached(entry: string[] = [...process.execArgv, process.argv[1]!]): BackgroundDeps['spawn'] {
  return (repo, args, logFile) => {
    const fd = openSync(logFile, 'w');
    let code: number | null | undefined;
    const child = spawn(process.execPath, [...entry, ...args], { cwd: repo, detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    child.on('exit', (c) => (code = c));
    child.on('error', () => (code = null));
    child.unref();
    return { pid: child.pid ?? -1, exitCode: () => code };
  };
}

function parseServeInfo(v: unknown): ServeInfo | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const { repo, pid, version, startedAt } = v as Record<string, unknown>;
  if (typeof repo !== 'string' || typeof pid !== 'number') return undefined;
  return { repo, pid, ...(typeof version === 'string' ? { version } : {}), ...(typeof startedAt === 'string' ? { startedAt } : {}) };
}

export async function probePort(port: number): Promise<PortUse> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/repo`, { signal: AbortSignal.timeout(2000) });
    const info = parseServeInfo(res.ok ? await res.json().catch(() => undefined) : undefined);
    return info === undefined ? { kind: 'other' } : { kind: 'ondina', ...info };
  } catch (e) {
    // つながらなければ空き。それ以外（HTTP で答えない相手・時間切れ）は使われている
    const cause = (e as { cause?: { code?: string } }).cause;
    return cause?.code === 'ECONNREFUSED' ? { kind: 'free' } : { kind: 'other' };
  }
}

export function defaultBackgroundDeps(): BackgroundDeps {
  return {
    probe: probePort,
    spawn: spawnDetached(),
    readLog: (file) => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return '';
      }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    timeoutMs: 15000,
  };
}
