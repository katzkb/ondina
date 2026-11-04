// ondina serve --background（設計書 12 章）。AI エージェントが開いた画面が、エージェントが終わっても残るように、
// serve を親から切り離して起動し、URL を出して戻る。このリポジトリの serve が動いていればそれを使う。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BackgroundDeps, probePort, serveInBackground, spawnDetached } from '../src/background.js';
import { startServer } from '../src/serve.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

let repo: string;
beforeAll(() => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'ondina-bg-'));
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

function fake(over: Partial<BackgroundDeps> = {}, log = 'ondina serve: http://127.0.0.1:4177/pr/12\n') {
  const spawned: Array<{ repo: string; args: string[]; logFile: string }> = [];
  const d: BackgroundDeps = {
    probe: async () => ({ kind: 'free' }),
    spawn: (r, args, logFile) => {
      spawned.push({ repo: r, args, logFile });
      return { pid: 4321, exitCode: () => undefined };
    },
    readLog: () => log,
    sleep: async () => {},
    timeoutMs: 1000,
    ...over,
  };
  return { d, spawned };
}

describe('serveInBackground', () => {
  it('ポートが空いていれば serve を切り離して起動し、ログに出た URL を返す', async () => {
    const { d, spawned } = fake();
    expect(await serveInBackground(repo, 4177, '12', d)).toEqual({
      status: 'started',
      url: 'http://127.0.0.1:4177/pr/12',
      pid: 4321,
      log: path.join(repo, '.ondina', 'serve.log'),
    });
    expect(spawned).toEqual([{ repo, args: ['serve', '--port', '4177', '12'], logFile: path.join(repo, '.ondina', 'serve.log') }]);
  });

  it('このリポジトリの serve が動いていれば起動せず、その URL を返す（PR は /pr/<番号>、local は /local）', async () => {
    const { d, spawned } = fake({ probe: async () => ({ kind: 'ondina', repo, pid: 999 }) });
    expect(await serveInBackground(repo, 4177, '12', d)).toEqual({ status: 'reused', url: 'http://127.0.0.1:4177/pr/12', pid: 999 });
    expect(await serveInBackground(repo, 4177, 'local', d)).toEqual({ status: 'reused', url: 'http://127.0.0.1:4177/local', pid: 999 });
    expect(await serveInBackground(repo, 4177, undefined, d)).toEqual({ status: 'reused', url: 'http://127.0.0.1:4177/', pid: 999 });
    expect(spawned).toEqual([]);
  });

  it('別のリポジトリの serve や別のものが使っていれば、空いているポートで起動する', async () => {
    for (const use of [{ kind: 'ondina', repo: '/somewhere/else', pid: 999 }, { kind: 'other' }] as const) {
      const { d, spawned } = fake({ probe: async () => use }, 'ondina serve: http://127.0.0.1:50123/pr/12\n');
      expect(await serveInBackground(repo, 4177, '12', d)).toEqual({
        status: 'started',
        url: 'http://127.0.0.1:50123/pr/12',
        pid: 4321,
        log: path.join(repo, '.ondina', 'serve.log'),
        movedFrom: 4177,
        ...(use.kind === 'ondina' ? { occupiedBy: '/somewhere/else' } : {}),
      });
      expect(spawned[0]!.args).toEqual(['serve', '--port', '0', '12']);
    }
  });

  describe('同じリポジトリの別の worktree の serve', () => {
    let main: string;
    let wt: string;
    let wt2: string;
    let done: () => void;
    beforeAll(() => {
      const built = buildFixtureRepo();
      main = built.dir;
      wt = `${main}-wt`;
      wt2 = `${main}-wt2`;
      git(main, 'worktree', 'add', '--detach', wt, 'main');
      git(main, 'worktree', 'add', '--detach', wt2, 'main');
      done = () => {
        built.cleanup();
        for (const d of [wt, wt2]) rmSync(d, { recursive: true, force: true });
      };
    });
    afterAll(() => done());

    it('PR 番号を開くなら、それを使う（PR 番号の解析は元のフォルダに置くので、その画面に出る）', async () => {
      for (const [serving, here] of [
        [main, wt],
        [wt, main],
        [wt, wt2],
      ] as const) {
        const { d, spawned } = fake({ probe: async () => ({ kind: 'ondina', repo: serving, pid: 999 }) });
        expect(await serveInBackground(here, 4177, '12', d)).toEqual({ status: 'reused', url: 'http://127.0.0.1:4177/pr/12', pid: 999 });
        expect(await serveInBackground(here, 4177, undefined, d)).toEqual({ status: 'reused', url: 'http://127.0.0.1:4177/', pid: 999 });
        expect(spawned).toEqual([]);
      }
    });

    it('local（PR の無い変更）は、その worktree にしか無いので使わず、空いているポートで起動する', async () => {
      const { d, spawned } = fake({ probe: async () => ({ kind: 'ondina', repo: main, pid: 999 }) }, 'ondina serve: http://127.0.0.1:50123/local\n');
      expect(await serveInBackground(wt, 4177, 'local', d)).toEqual({
        status: 'started',
        url: 'http://127.0.0.1:50123/local',
        pid: 4321,
        log: path.join(wt, '.ondina', 'serve.log'),
        movedFrom: 4177,
        occupiedBy: main,
        sameRepo: true,
      });
      expect(spawned[0]!.args).toEqual(['serve', '--port', '0', 'local']);
    });
  });

  it('--port 0 なら確かめずに起動する', async () => {
    let probed = false;
    const { d, spawned } = fake({ probe: async () => ((probed = true), { kind: 'other' }) });
    expect((await serveInBackground(repo, 0, undefined, d)).status).toBe('started');
    expect(probed).toBe(false);
    expect(spawned[0]!.args).toEqual(['serve', '--port', '0']);
  });

  it('URL を出す前に serve が終わったら、ログを理由にして失敗', async () => {
    const { d } = fake({ spawn: () => ({ pid: 4321, exitCode: () => 1 }) }, 'ondina serve: listen EADDRINUSE: address already in use 127.0.0.1:4177\n');
    expect(await serveInBackground(repo, 4177, '12', d)).toEqual({
      status: 'failed',
      reason: expect.stringContaining('EADDRINUSE'),
    });
  });

  it('ログの置き場を作れない・起こせないときは、例外を理由にして失敗（権限の文を残す）', async () => {
    const { d } = fake({
      spawn: () => {
        throw Object.assign(new Error("EPERM: operation not permitted, open '/x/.ondina/serve.log'"), { code: 'EPERM' });
      },
    });
    expect(await serveInBackground(repo, 4177, '12', d)).toEqual({ status: 'failed', reason: expect.stringContaining('EPERM: operation not permitted') });
  });

  it('時間内に URL が出なければ失敗', async () => {
    let now = 0;
    const { d } = fake({ sleep: async (ms) => void (now += ms), timeoutMs: 500, now: () => now }, '');
    expect(await serveInBackground(repo, 4177, '12', d)).toEqual({ status: 'failed', reason: expect.stringMatching(/URL が出ません/) });
  });
});

describe('spawnDetached（本物のプロセス）', () => {
  it('親と別のプロセスグループで起こし、出力はログに書く', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-bg-child-'));
    const script = path.join(dir, 'child.mjs');
    writeFileSync(script, "process.stdout.write(`ondina serve: http://127.0.0.1:1/?args=${process.argv.slice(2).join(',')}\\n`); setTimeout(() => {}, 30000);\n");
    const log = path.join(dir, 'serve.log');
    const child = spawnDetached([script])(dir, ['serve', '--port', '0'], log);
    try {
      for (let i = 0; i < 50 && !readFileSync(log, 'utf8').includes('ondina serve:'); i++) await new Promise((r) => setTimeout(r, 100));
      expect(readFileSync(log, 'utf8')).toBe('ondina serve: http://127.0.0.1:1/?args=serve,--port,0\n');
      expect(child.exitCode()).toBeUndefined();
      const pgid = (pid: number) => execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
      expect(pgid(child.pid)).toBe(String(child.pid));
      expect(pgid(child.pid)).not.toBe(pgid(process.pid));
    } finally {
      process.kill(child.pid);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('probePort', () => {
  it('つながらなければ空き、ondina の serve ならリポジトリと pid、ほかの HTTP なら別のもの', async () => {
    const ondina = await startServer({ repo, port: 0, distDir: repo, log: () => {} });
    const plain = createServer((_req, res) => res.writeHead(404).end());
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
    const plainPort = (plain.address() as { port: number }).port;
    try {
      expect(await probePort(ondina.port)).toEqual({ kind: 'ondina', repo, pid: process.pid, startedAt: expect.any(String) });
      expect(await probePort(plainPort)).toEqual({ kind: 'other' });
    } finally {
      await ondina.close();
      await new Promise((r) => plain.close(r));
    }
    expect(await probePort(plainPort)).toEqual({ kind: 'free' });
  });
});
