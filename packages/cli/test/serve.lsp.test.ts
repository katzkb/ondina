// serve が言語サーバーを起動したまま持ち、analyze から頼まれる（設計書 9.1 / 5.5）。本物の kotlin-lsp は起動しない（test/fake-lsp.mjs）。
// analyze は serve の子でも CLI からでも、.ondina/serve.json で serve を見つけて POST /api/lsp を送る。
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KOTLIN_IMPORT_NOTIFICATION } from '@ondina/core';
import { findServe, requestServeLsp, serveFile, type LspJobRequest } from '../src/lsp-remote.js';
import { lspCacheDir, lspWorktreeRoot } from '../src/lsp.js';
import { startServer, type RunningServer } from '../src/serve.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

const FAKE = path.resolve(import.meta.dirname, 'fake-lsp.mjs');
const CONTROLLER = 'src/main/kotlin/com/example/order/api/OrderController.kt';

let repo: string;
let cleanup: () => void;
let dist: string;
let server: RunningServer | undefined;
const spawns = () => (existsSync(path.join(repo, '.spawns')) ? readFileSync(path.join(repo, '.spawns'), 'utf8').split('\n').filter((l) => l !== '') : []);

beforeAll(() => {
  ({ dir: repo, cleanup } = buildFixtureRepo());
  dist = mkdtempSync(path.join(os.tmpdir(), 'ondina-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
});
afterAll(async () => {
  await server?.close();
  cleanup();
  rmSync(dist, { recursive: true, force: true });
});

/** at は analyze を打ったフォルダ。spawnsFile に言語サーバーを起動するたびに 1 行足す */
function request(shas: { base: string; head: string }, at: string = repo, spawnsFile: string = path.join(repo, '.spawns')): LspJobRequest {
  return {
    language: 'kotlin',
    command: FAKE,
    args: ['--stdio', '--system-path', '{cacheDir}'],
    readyTimeoutSec: 10,
    rule: KOTLIN_IMPORT_NOTIFICATION,
    root: lspWorktreeRoot(at),
    cacheDir: lspCacheDir(at),
    shas,
    sides: { head: [CONTROLLER], base: [CONTROLLER] },
    changed: [CONTROLLER],
    targets: [{ path: CONTROLLER, name: 'apply', hunkId: 'h1' }],
    hunks: [],
    tests: { layers: [], sourceRoots: [] },
    env: { FAKE_LSP_SPAWNS: spawnsFile },
  };
}

describe('serve が持つ言語サーバー', () => {
  it('起動すると .ondina/serve.json に pid とポートを書き、analyze はそれで serve を見つける', async () => {
    server = await startServer({ repo, port: 0, distDir: dist, log: () => undefined });
    expect(JSON.parse(readFileSync(serveFile(repo), 'utf8'))).toEqual({ pid: process.pid, port: server.port });
    expect(await findServe(repo)).toBe(`http://127.0.0.1:${server.port}`);
  });

  it('POST /api/lsp は進みを流し、2 本目の PR は起動済みの言語サーバーを使う', async () => {
    const url = (await findServe(repo))!;
    const progress: string[] = [];
    const main = git(repo, 'rev-parse', 'main');
    const head = git(repo, 'rev-parse', 'feature/discount');
    const first = await requestServeLsp(url, request({ base: main, head }), (l) => progress.push(l));
    expect(first).toMatchObject({ run: { status: 'ok' }, reused: false });
    const second = await requestServeLsp(url, request({ base: head, head: main }), (l) => progress.push(l));
    expect(second).toMatchObject({ run: { status: 'ok' }, reused: true });
    expect(spawns()).toHaveLength(1);
    expect(progress).toEqual(expect.arrayContaining(['言語サーバーを起動しています', '起動済みの言語サーバーを使います']));
    // Map は [パス, data] の組で送り、受け取った側で Map に戻す
    if ('error' in second) throw new Error(second.error);
    expect(second.result?.semantic.head).toBeInstanceOf(Map);
    expect(second.result?.semantic.head.get(CONTROLLER)?.length).toBeGreaterThan(0);
  });

  it('仕事が失敗しても serve は落ちず、unavailable を返す', async () => {
    const url = (await findServe(repo))!;
    const r = await requestServeLsp(url, request({ base: git(repo, 'rev-parse', 'main'), head: '0'.repeat(40) }), () => undefined);
    expect(r).toMatchObject({ run: { status: 'unavailable' }, reused: false });
    expect((await fetch(`${url}/api/repo`)).status).toBe(200);
  });

  it('閉じると言語サーバーを終わらせ、serve.json を消す', async () => {
    await server!.close();
    server = undefined;
    expect(existsSync(serveFile(repo))).toBe(false);
    expect(await findServe(repo)).toBeUndefined();
    const pid = Number(spawns()[0]);
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('serve.json の pid が死んでいれば、serve は無いとみなす', async () => {
    writeFileSync(serveFile(repo), JSON.stringify({ pid: 999999, port: 1 }));
    expect(await findServe(repo)).toBeUndefined();
  });

  it('serve.json のポートで別のリポジトリの serve が動いていれば使わない', async () => {
    const other = buildFixtureRepo();
    const s = await startServer({ repo: other.dir, port: 0, distDir: dist, log: () => undefined });
    try {
      writeFileSync(serveFile(repo), JSON.stringify({ pid: process.pid, port: s.port }));
      expect(await findServe(repo)).toBeUndefined();
    } finally {
      await s.close();
      other.cleanup();
    }
  });
});

describe('順番待ちの間も応答を途切れさせない', () => {
  // analyze の fetch（Node）は 300 秒何も届かないと応答を切る。切られた analyze は自分で言語サーバーを起動しようとして、
  // serve が持つロックを最大 60 分待っていた（画面には serve の pid を待つ 1 行。2026-10-28）
  let dir: string;
  let done: () => void;
  let s: RunningServer | undefined;
  beforeAll(() => {
    ({ dir, cleanup: done } = buildFixtureRepo());
  });
  afterAll(async () => {
    await s?.close();
    done();
  });

  it('前の仕事が終わるのを待つ間も、間をおいて空の行を送る', async () => {
    s = await startServer({ repo: dir, port: 0, distDir: dist, log: () => undefined, lspKeepAliveMs: 50 });
    const url = `http://127.0.0.1:${s.port}`;
    const main = git(dir, 'rev-parse', 'main');
    const head = git(dir, 'rev-parse', 'feature/discount');
    // 冷えた起動に 1 秒ほどかかる言語サーバー。進みの 1 行は 30 秒おきなので、その間 1 本目も 2 本目も黙る
    const env = { FAKE_LSP_SPAWNS: path.join(dir, '.spawns'), FAKE_LSP_MODE: 'slow', FAKE_LSP_STEPS: '10', FAKE_LSP_DELAY_MS: '100' };
    const first = requestServeLsp(url, { ...request({ base: main, head }, dir), env }, () => undefined);
    await new Promise((r) => setTimeout(r, 100));
    const res = await fetch(`${url}/api/lsp`, { method: 'POST', body: JSON.stringify({ ...request({ base: head, head: main }, dir), env }) });
    const gaps: number[] = [];
    let text = '';
    let last = Date.now();
    for await (const chunk of res.body!) {
      gaps.push(Date.now() - last);
      last = Date.now();
      text += Buffer.from(chunk as Uint8Array).toString('utf8');
    }
    expect(await first).toMatchObject({ run: { status: 'ok' }, reused: false });
    const lines = text.split('\n');
    expect(lines.filter((l) => l.startsWith('{"progress"'))).toContain('{"progress":"別の解析が言語サーバーを使っています。終わるのを待っています"}');
    expect(JSON.parse(lines.filter((l) => l !== '').at(-1)!)).toMatchObject({ done: { run: { status: 'ok' }, reused: true } });
    expect(Math.max(...gaps)).toBeLessThan(500);
  });
});

describe('同じリポジトリの別の worktree から（スキルは別の worktree の serve を使い回す）', () => {
  let main: string;
  let wt: string;
  let done: () => void;
  let first: RunningServer | undefined;
  let second: RunningServer | undefined;
  const spawnsFile = () => path.join(main, '.spawns');
  beforeAll(() => {
    const built = buildFixtureRepo();
    // CLI の repo は git rev-parse --show-toplevel（symlink を解いたパス）。macOS の一時フォルダは /var → /private/var
    main = realpathSync(built.dir);
    wt = `${main}-wt`;
    git(main, 'worktree', 'add', '--detach', wt, 'main');
    done = () => {
      built.cleanup();
      rmSync(wt, { recursive: true, force: true });
    };
  });
  afterAll(async () => {
    await second?.close();
    await first?.close();
    done();
  });

  it('元のフォルダで起動した serve を、worktree で打った analyze も見つける', async () => {
    first = await startServer({ repo: main, port: 0, distDir: dist, log: () => undefined });
    expect(await findServe(wt)).toBe(`http://127.0.0.1:${first.port}`);
  });

  it('元のフォルダと worktree から交互に頼んでも、起動済みの言語サーバーを使う', async () => {
    const url = (await findServe(wt))!;
    const main_ = git(main, 'rev-parse', 'main');
    const head = git(main, 'rev-parse', 'feature/discount');
    const a = await requestServeLsp(url, request({ base: main_, head }, main, spawnsFile()), () => undefined);
    const b = await requestServeLsp(url, request({ base: head, head: main_ }, wt, spawnsFile()), () => undefined);
    expect(a).toMatchObject({ run: { status: 'ok' }, reused: false });
    expect(b).toMatchObject({ run: { status: 'ok' }, reused: true });
    expect(readFileSync(spawnsFile(), 'utf8').split('\n').filter((l) => l !== '')).toHaveLength(1);
  });

  it('worktree で 2 つ目の serve を起動しても（PR のない変更を開くとき）、言語サーバーを持つ serve の登録を奪わない', async () => {
    // 奪うと、1 つ目が持ったままのロックを 2 つ目が待つ（最大 60 分）
    second = await startServer({ repo: wt, port: 0, distDir: dist, log: () => undefined });
    expect(await findServe(wt)).toBe(`http://127.0.0.1:${first!.port}`);
    await second.close();
    second = undefined;
    expect(await findServe(main)).toBe(`http://127.0.0.1:${first!.port}`);
  });

  it('登録していた serve が終わると、動いている別の serve が登録を引き継ぐ', async () => {
    // 引き継がないと、2 つ目が動いている間ずっと、analyze は 1 回ごとに言語サーバーを起動する
    second = await startServer({ repo: wt, port: 0, distDir: dist, log: () => undefined, registerCheckMs: 50 });
    await first!.close();
    first = undefined;
    const url = `http://127.0.0.1:${second.port}`;
    for (let i = 0; i < 40 && (await findServe(wt)) !== url; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await findServe(wt)).toBe(url);
    expect(await findServe(main)).toBe(url);
  });
});
