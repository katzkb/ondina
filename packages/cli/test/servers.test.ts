// 動いている serve の一覧・停止（ondina serve list / stop / restart。設計書 12 章）。
// lsof・HTTP・kill・時計は偽物で見る。本物で見るテストは、自分で起動した serve のポートだけを止める（ほかのセッションの serve には触らない）
import { spawn, type ChildProcess } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/main.js';
import { findServes, formatServes, parseLsof, stopServe, type RunningServe, type ServersDeps } from '../src/servers.js';
import { buildFixtureRepo } from './fixture-repo.js';

function fake(over: Partial<ServersDeps> = {}) {
  let now = 0;
  const killed: Array<[number, string]> = [];
  const d: ServersDeps = {
    listeners: async () => [],
    probe: async () => undefined,
    kill: (pid, signal) => void killed.push([pid, signal]),
    sleep: async (ms) => void (now += ms),
    now: () => now,
    ...over,
  };
  return { d, killed, elapsed: () => now };
}

describe('parseLsof', () => {
  it('lsof -F の p（pid）と n（アドレス:ポート）の行から、待ち受けている pid とポートを出す', () => {
    const out = 'p56341\ncnode\nf12\nn127.0.0.1:4231\np7042\nf145\nn127.0.0.1:7265\nf146\nn[::1]:7265\nf147\nn*:5173\n';
    expect(parseLsof(out)).toEqual([
      { pid: 56341, port: 4231 },
      { pid: 7042, port: 7265 },
      { pid: 7042, port: 5173 },
    ]);
  });

  it('空なら空', () => {
    expect(parseLsof('')).toEqual([]);
  });
});

describe('findServes', () => {
  it('待ち受けている各ポートに /api/repo を聞き、答えの pid が lsof の pid と同じものだけを serve としてポート順に返す', async () => {
    const { d } = fake({
      listeners: async () => [
        { pid: 56341, port: 4231 },
        { pid: 800, port: 5173 },
        { pid: 700, port: 4177 },
        { pid: 900, port: 9000 },
      ],
      probe: async (port) =>
        port === 4231
          ? { repo: '/r/a', pid: 56341 }
          : port === 4177
            ? { repo: '/r/b', pid: 700, version: 'abc1234', startedAt: '2026-10-23T00:05:00.000Z' }
            : // 画面の開発サーバー（vite）は /api を serve に中継するので、別の pid で答える
              port === 5173
              ? { repo: '/r/b', pid: 700 }
              : undefined,
    });
    expect(await findServes(d)).toEqual([
      { pid: 700, port: 4177, folder: '/r/b', version: 'abc1234', startedAt: '2026-10-23T00:05:00.000Z' },
      { pid: 56341, port: 4231, folder: '/r/a' },
    ]);
  });
});

describe('stopServe', () => {
  const s: RunningServe = { pid: 700, port: 4177, folder: '/r/b' };

  it('SIGTERM を送り、そのポートが同じ pid で応答しなくなったら止まった', async () => {
    let asked = 0;
    const { d, killed } = fake({ probe: async () => (++asked < 3 ? { repo: '/r/b', pid: 700 } : undefined) });
    expect(await stopServe(s, d)).toEqual({ status: 'stopped' });
    expect(killed).toEqual([[700, 'SIGTERM']]);
    expect(asked).toBe(3);
  });

  it('10 秒たっても同じ pid で応答し続ければ止まらない', async () => {
    const { d, elapsed } = fake({ probe: async () => ({ repo: '/r/b', pid: 700 }) });
    expect(await stopServe(s, d)).toEqual({ status: 'stuck' });
    expect(elapsed()).toBeGreaterThanOrEqual(10_000);
    expect(elapsed()).toBeLessThan(11_000);
  });

  it('もう終わっていれば（ESRCH）止まったとみなし、送れなければ（EPERM）理由を返す', async () => {
    const throwing = (code: string) => () => {
      throw Object.assign(new Error(`kill ${code}`), { code });
    };
    expect(await stopServe(s, fake({ kill: throwing('ESRCH') }).d)).toEqual({ status: 'stopped' });
    expect(await stopServe(s, fake({ kill: throwing('EPERM') }).d)).toEqual({ status: 'failed', reason: 'kill EPERM' });
  });
});

describe('formatServes', () => {
  // 起動の時刻は手元の時間帯で出す。期待値が時間帯によらないように、手元の時刻から作る
  const at = (month: number, day: number, h: number, m: number) => new Date(2026, month - 1, day, h, m).toISOString();

  it('ポート・pid・起動・バージョン・フォルダを列を揃えて出す。バージョンが今と違う・ないものに（更新前）、ホームは ~', () => {
    const serves: RunningServe[] = [
      { pid: 700, port: 4177, folder: '/home/u/b', version: 'abc1234', startedAt: at(10, 23, 9, 5) },
      { pid: 56341, port: 4231, folder: '/home/u/a' },
      { pid: 9, port: 50123, folder: '/elsewhere/c', version: 'old0000', startedAt: at(10, 22, 18, 30) },
    ];
    expect(formatServes(serves, 'abc1234', '/home/u')).toBe(
      [
        'ポート  pid    起動         バージョン         フォルダ',
        '4177    700    10/23 09:05  abc1234            ~/b',
        '4231    56341  —            —（更新前）        ~/a',
        '50123   9      10/22 18:30  old0000（更新前）  /elsewhere/c',
        '',
      ].join('\n'),
    );
  });

  it('今のバージョンが分からなければ、バージョンのないものだけ（更新前）', () => {
    const serves: RunningServe[] = [
      { pid: 1, port: 4177, folder: '/home/u', version: 'abc1234', startedAt: at(1, 2, 3, 4) },
      { pid: 2, port: 4178, folder: '/x' },
    ];
    expect(formatServes(serves, undefined, '/home/u')).toBe(
      ['ポート  pid  起動         バージョン   フォルダ', '4177    1    01/02 03:04  abc1234      ~', '4178    2    —            —（更新前）  /x', ''].join('\n'),
    );
  });
});

describe('本物の lsof・HTTP・kill（自分で起動した serve だけを止める）', () => {
  let repo: string;
  let cleanup: () => void;
  let child: ChildProcess;
  let port: number;
  beforeAll(async () => {
    ({ dir: repo, cleanup } = buildFixtureRepo());
    const tsx = path.resolve(import.meta.dirname, '../node_modules/.bin/tsx');
    child = spawn(tsx, [path.resolve(import.meta.dirname, '../src/index.ts'), 'serve', '--port', '0'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout!.on('data', (c: Buffer) => (out += c.toString()));
    for (let i = 0; i < 150 && !/127\.0\.0\.1:(\d+)/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    port = Number(/127\.0\.0\.1:(\d+)/.exec(out)?.[1]);
  }, 30_000);
  afterAll(() => {
    if (child.exitCode === null) child.kill();
    cleanup();
  });

  function io() {
    const out: string[] = [];
    const err: string[] = [];
    return { cwd: repo, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), out, err };
  }

  it('list に自分の serve がポートとフォルダつきで出て、stop <ポート> で止まる', async () => {
    expect(port).toBeGreaterThan(0);
    const listed = io();
    expect(await run(['serve', 'list'], listed)).toBe(0);
    const row = listed.out.join('').split('\n').find((l) => l.startsWith(`${port} `));
    expect(row).toBeDefined();
    expect(row).toContain(realpathSync(repo));
    expect(row).not.toContain('更新前');

    const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
    const stopped = io();
    expect(await run(['serve', 'stop', String(port)], stopped)).toBe(0);
    expect(stopped.out.join('')).toContain(`${port} 番の serve を止めました`);
    await exited;
    const after = io();
    await run(['serve', 'list'], after);
    expect(after.out.join('').split('\n').some((l) => l.startsWith(`${port} `))).toBe(false);
  }, 30_000);
});
