// 言語サーバーを起動したまま、PR ごとに中身だけ切り替えて使う（設計書 9.1）。本物の kotlin-lsp は起動しない（test/fake-lsp.mjs）。
// 2026-10-15 の実測: 起動したまま中身を切り替えると次の PR は 0.2 秒、色は新しく起動した場合と完全一致。依存の変化は拾わないので起動し直す。
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KOTLIN_IMPORT_NOTIFICATION } from '@ondina/core';
import type { Hunk } from '@ondina/model';
import { createLspHolder, type LspJobArgs } from '../src/lsp-session.js';
import { lspCacheDir, lspWorktreeRoot } from '../src/lsp.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

const FAKE = path.resolve(import.meta.dirname, 'fake-lsp.mjs');
const CONTROLLER = 'src/main/kotlin/com/example/order/api/OrderController.kt';

let repo: string;
let cleanup: () => void;
const sha: Record<string, string> = {};
const commit = (msg: string) => git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-am', msg);

beforeAll(() => {
  ({ dir: repo, cleanup } = buildFixtureRepo());
  sha['main'] = git(repo, 'rev-parse', 'main');
  sha['discount'] = git(repo, 'rev-parse', 'feature/discount');
  // 2 本目の PR（Kotlin だけ）と、ビルドスクリプトを変える 3 本目の PR
  git(repo, 'checkout', '-q', '-b', 'feature/second', 'feature/discount');
  appendFileSync(path.join(repo, CONTROLLER), '// second\n');
  commit('second');
  sha['second'] = git(repo, 'rev-parse', 'HEAD');
  appendFileSync(path.join(repo, 'build.gradle.kts'), '// build\n');
  commit('build');
  sha['build'] = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'main');
});
afterAll(() => cleanup());

const lines = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '') : []);

let n = 0;
/** 呼ぶたびに別の記録のファイル */
function files() {
  n += 1;
  return { spawns: path.join(repo, `.spawns-${n}`), notes: path.join(repo, `.notes-${n}`) };
}

function job(shas: { base: string; head: string }, rec: { spawns: string; notes: string }, extra: Partial<LspJobArgs> = {}, progress: string[] = []): LspJobArgs {
  return {
    language: 'kotlin',
    command: FAKE,
    args: ['--stdio', '--system-path', '{cacheDir}'],
    readyTimeoutSec: 10,
    rule: KOTLIN_IMPORT_NOTIFICATION,
    root: lspWorktreeRoot(repo),
    cacheDir: lspCacheDir(repo),
    shas,
    sides: { head: [CONTROLLER], base: [CONTROLLER] },
    changed: [CONTROLLER],
    targets: [{ path: CONTROLLER, name: 'apply', hunkId: 'h1' }],
    hunks: [],
    isTestPath: () => false,
    progress: (l) => progress.push(l),
    env: { FAKE_LSP_SPAWNS: rec.spawns, FAKE_LSP_NOTES: rec.notes },
    ...extra,
  };
}

describe('createLspHolder', () => {
  it('変わる前（base）の呼び出し関係も聞く。base に無いファイル（PR で足したファイル）の hunk は聞かない', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    const hunk = (id: string, p: string, symbol: string): Hunk => ({ id, path: p, lang: 'kotlin', symbol, symbolFqName: `x.${symbol}`, symbolKind: 'function', kind: 'none', kindProvenance: 'ast', hows: [], n: 1, lnOld: 1, lnNew: 1, lines: [] });
    try {
      const r = await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec, { hunks: [hunk('h1', CONTROLLER, 'apply'), hunk('h2', 'src/main/kotlin/com/example/order/api/ApplyDiscountRequest.kt', 'discountCode')] }));
      expect(r.run.status).toBe('ok');
      expect(r.result?.callGraphBase?.probes.map((p) => p.hunkId)).toEqual(['h1']);
      expect(r.result?.callGraph.probes.map((p) => p.hunkId)).toEqual(['h1', 'h2']);
    } finally {
      await holder.close();
    }
  });

  it('2 本目の PR は起動したまま使う。変わったファイルを知らせ、意味トークンも取れる', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    const progress: string[] = [];
    try {
      const first = await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec, {}, progress));
      expect(first.run.status).toBe('ok');
      expect(first.reused).toBe(false);
      expect(first.result?.semantic.head.get(CONTROLLER)?.length).toBeGreaterThan(0);
      const second = await holder.job(job({ base: sha['discount']!, head: sha['second']! }, rec, {}, progress));
      expect(second.run.status).toBe('ok');
      expect(second.reused).toBe(true);
      expect(second.result?.semantic.base.get(CONTROLLER)?.length).toBeGreaterThan(0);
      expect(lines(rec.spawns)).toHaveLength(1);
      // base は main → feature/discount（37 ファイル）、head は feature/discount → second（1 ファイル）
      const changed = Number(git(repo, 'diff', '--name-only', sha['main']!, sha['discount']!).split('\n').length) + 1;
      expect(lines(rec.notes)).toContain(`workspace/didChangeWatchedFiles ${changed}`);
      expect(progress).toContain('言語サーバーを起動しています');
      expect(progress).toContain('起動済みの言語サーバーを使います');
      expect(git(path.join(lspWorktreeRoot(repo), 'head'), 'rev-parse', 'HEAD')).toBe(sha['second']);
    } finally {
      await holder.close();
    }
  });

  it('起動したままの 2 本目で、変えた宣言に関数が無くても使える', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    try {
      expect((await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec))).run.status).toBe('ok');
      const flags = 'src/main/kotlin/com/example/config/FeatureFlags.kt';
      const second = await holder.job(job({ base: sha['discount']!, head: sha['second']! }, rec, { targets: [{ path: flags, name: 'FeatureFlags', hunkId: 'h2' }] }));
      expect(second.run.status).toBe('ok');
      expect(second.reused).toBe(true);
    } finally {
      await holder.close();
    }
  });

  it('解析が終わるたびに、開いたファイルを全部閉じる（開いたままだと次の PR で古い中身を使われる）', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    try {
      await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec));
      await holder.job(job({ base: sha['discount']!, head: sha['second']! }, rec));
    } finally {
      await holder.close(); // shutdown の応答を待つので、その前に送った通知は記録されている
    }
    // 1 回の解析で 3 本: 変わったファイル（head・base）と、その名前の行き先の差分の無いファイル（偽 LSP の DiscountPolicy.kt。定義の引き出しの全文）
    const notes = lines(rec.notes);
    expect(notes.filter((l) => l === 'textDocument/didOpen').length).toBe(6);
    expect(notes.filter((l) => l === 'textDocument/didClose').length).toBe(6);
  });

  it('ビルドの設定ファイルが変わったら起動し直す（起動したままでは依存の変化を拾わない）', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    const progress: string[] = [];
    try {
      await holder.job(job({ base: sha['discount']!, head: sha['second']! }, rec, {}, progress));
      const r = await holder.job(job({ base: sha['second']!, head: sha['build']! }, rec, {}, progress));
      expect(r.run.status).toBe('ok');
      expect(r.reused).toBe(false);
      expect(lines(rec.spawns)).toHaveLength(2);
      expect(progress).toContain('ビルドの設定ファイルが変わったので、言語サーバーを起動し直します（build.gradle.kts）');
    } finally {
      await holder.close();
    }
  });

  it('起動の設定が変わったら起動し直す', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    try {
      await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec));
      const r = await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec, { readyTimeoutSec: 11 }));
      expect(r.reused).toBe(true); // 時間の上限は起動の形ではない
      const again = await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec, { args: ['--stdio', '--system-path', '{cacheDir}', '--x'] }));
      expect(again.reused).toBe(false);
      expect(lines(rec.spawns)).toHaveLength(2);
    } finally {
      await holder.close();
    }
  });

  it('途中で死んだら、その解析は unavailable。次の解析で起動し直す', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    try {
      const die = { env: { FAKE_LSP_SPAWNS: rec.spawns, FAKE_LSP_NOTES: rec.notes, FAKE_LSP_EXIT_ON: 'workspace/didChangeWatchedFiles' } };
      expect((await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec, die))).run.status).toBe('ok');
      const dead = await holder.job(job({ base: sha['discount']!, head: sha['second']! }, rec, die));
      expect(dead.run).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('LSP が途中で終了しました') });
      const next = await holder.job(job({ base: sha['discount']!, head: sha['second']! }, rec, die));
      expect(next.run.status).toBe('ok');
      expect(lines(rec.spawns)).toHaveLength(2);
    } finally {
      await holder.close();
    }
  });

  it('同時に頼まれたら 1 本ずつ。後の解析には待っていると知らせる', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    const progress: string[] = [];
    try {
      const [a, b] = await Promise.all([
        holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec)),
        holder.job(job({ base: sha['discount']!, head: sha['second']! }, rec, {}, progress)),
      ]);
      expect([a.run.status, b.run.status]).toEqual(['ok', 'ok']);
      expect(b.reused).toBe(true);
      expect(progress[0]).toBe('別の解析が言語サーバーを使っています。終わるのを待っています');
    } finally {
      await holder.close();
    }
  });

  it('別のプロセスが言語サーバーを使っている間は待つ（同じ作業場所を 2 つの言語サーバーが使うと壊れる）', async () => {
    const rec = files();
    const lockFile = path.join(repo, '.ondina', 'lsp', 'lock');
    const other = spawn('sleep', ['30']);
    writeFileSync(lockFile, String(other.pid));
    const holder = createLspHolder(repo);
    const progress: string[] = [];
    try {
      const running = holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec, {}, progress));
      await new Promise((r) => setTimeout(r, 300));
      expect(progress).toContain(`別の解析（pid ${other.pid}）が言語サーバーを使っています。終わるのを待っています`);
      expect(lines(rec.spawns)).toHaveLength(0);
      other.kill('SIGKILL');
      expect((await running).run.status).toBe('ok');
      expect(readFileSync(lockFile, 'utf8')).toBe(String(process.pid));
    } finally {
      other.kill('SIGKILL');
      await holder.close();
    }
    expect(existsSync(lockFile)).toBe(false);
  });

  it('起動の途中で閉じたら、待たずに言語サーバーを殺す（serve の終了。冷えた起動は 10 分かかりうる）', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    const slow = { env: { FAKE_LSP_SPAWNS: rec.spawns, FAKE_LSP_MODE: 'slow', FAKE_LSP_STEPS: '2000', FAKE_LSP_DELAY_MS: '20' } };
    const running = holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec, slow));
    await new Promise((r) => setTimeout(r, 500));
    const t = Date.now();
    await holder.close();
    expect(Date.now() - t).toBeLessThan(3000);
    expect((await running).run.status).toBe('unavailable');
    const pid = Number(lines(rec.spawns)[0]);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(existsSync(path.join(repo, '.ondina', 'lsp', 'lock'))).toBe(false);
  });

  it('worktree を切り替えられなくても投げず、unavailable で返す。次の解析は使える（9.5）', async () => {
    const rec = files();
    const holder = createLspHolder(repo);
    try {
      const bad = await holder.job(job({ base: sha['main']!, head: '0'.repeat(40) }, rec));
      expect(bad.run).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('0'.repeat(40)) });
      expect((await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec))).run.status).toBe('ok');
    } finally {
      await holder.close();
    }
  });

  it('持ち主の死んだロックは取り直す', async () => {
    const rec = files();
    const lockFile = path.join(repo, '.ondina', 'lsp', 'lock');
    writeFileSync(lockFile, '999999');
    const holder = createLspHolder(repo);
    try {
      expect((await holder.job(job({ base: sha['main']!, head: sha['discount']! }, rec))).run.status).toBe('ok');
    } finally {
      await holder.close();
    }
  });
});
