// 保存したプロジェクト構造で、Gradle の取り込みを省いて言語サーバーを起動する（設計書 9.1）。本物の kotlin-lsp は起動しない（test/fake-lsp.mjs）。
// 2026-10-19 の実測: exportWorkspace が書いた workspace.json だけを置いたフォルダを渡すと、Gradle を走らせずに JSON で取り込み、
// 結果は Gradle の形と完全に一致した。実際のプロジェクトでは、準備の大半が「Importing（Gradle）」だった。
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KOTLIN_IMPORT_NOTIFICATION } from '@ondina/core';
import { projectModelDir, pruneProjectModels } from '../src/lsp-model.js';
import { createLspHolder, type LspJobArgs } from '../src/lsp-session.js';
import { lspCacheDir, lspWorktreeRoot } from '../src/lsp.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

const FAKE = path.resolve(import.meta.dirname, 'fake-lsp.mjs');
const CONTROLLER = 'src/main/kotlin/com/example/order/api/OrderController.kt';
const EXTRA = 'src/main/java/com/example/order/domain/Extra.kt';

interface Repo {
  dir: string;
  sha: Record<'main' | 'discount' | 'second' | 'build' | 'java', string>;
  imports: string;
  spawns: string;
  cleanup: () => void;
}

/** fixture に 3 本の PR を足す: Kotlin だけ（second）、ビルドスクリプト（build）、新しいソースのフォルダ（java） */
function setup(): Repo {
  const { dir, cleanup } = buildFixtureRepo();
  const commit = (msg: string) => git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', msg);
  const rev = (r: string) => git(dir, 'rev-parse', r);
  const main = rev('main');
  const discount = rev('feature/discount');
  git(dir, 'checkout', '-q', '-b', 'feature/second', 'feature/discount');
  appendFileSync(path.join(dir, CONTROLLER), '// second\n');
  git(dir, 'add', '-A');
  commit('second');
  const second = rev('HEAD');
  appendFileSync(path.join(dir, 'build.gradle.kts'), '// build\n');
  git(dir, 'add', '-A');
  commit('build');
  const build = rev('HEAD');
  git(dir, 'checkout', '-q', '-b', 'feature/java', 'feature/discount');
  mkdirSync(path.dirname(path.join(dir, EXTRA)), { recursive: true });
  writeFileSync(path.join(dir, EXTRA), 'package com.example.order.domain\n\nclass Extra {\n    fun look() = 1\n}\n');
  git(dir, 'add', '-A');
  commit('java');
  const java = rev('HEAD');
  git(dir, 'checkout', '-q', 'main');
  return { dir, sha: { main, discount, second, build, java }, imports: path.join(dir, '.imports'), spawns: path.join(dir, '.spawns'), cleanup };
}

const lines = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '') : []);

function job(r: Repo, shas: { base: string; head: string }, o: { progress?: string[]; env?: Record<string, string>; head?: string[]; language?: string } = {}): LspJobArgs {
  return {
    language: o.language ?? 'kotlin',
    command: FAKE,
    args: ['--stdio', '--system-path', '{cacheDir}'],
    readyTimeoutSec: 10,
    rule: KOTLIN_IMPORT_NOTIFICATION,
    root: lspWorktreeRoot(r.dir),
    cacheDir: lspCacheDir(r.dir),
    shas,
    sides: { head: o.head ?? [CONTROLLER], base: [CONTROLLER] },
    changed: o.head ?? [CONTROLLER],
    targets: [{ path: CONTROLLER, name: 'apply', hunkId: 'h1' }],
    hunks: [],
    isTestPath: () => false,
    ...(o.progress === undefined ? {} : { progress: (l: string) => o.progress!.push(l) }),
    env: { FAKE_LSP_SPAWNS: r.spawns, FAKE_LSP_IMPORTS: r.imports, ...o.env },
  };
}

/** holder を 1 つ作って解析を 1 本走らせ、閉じる（serve を起動し直すたびに holder は新しくなる） */
async function once(r: Repo, a: LspJobArgs) {
  const holder = createLspHolder(r.dir);
  try {
    return await holder.job(a);
  } finally {
    await holder.close();
  }
}

/** 保存したプロジェクト構造のファイル（key のフォルダの下） */
function saved(r: Repo): string[] {
  const dir = projectModelDir(r.dir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.json'));
}

describe('保存したプロジェクト構造で起動する', () => {
  it('初めてのビルドの設定は Gradle で 1 回だけ書き出し、JSON の形で起動する（base と head が同じ設定なら 1 回）', async () => {
    const r = setup();
    try {
      const progress: string[] = [];
      const res = await once(r, job(r, { base: r.sha.main, head: r.sha.discount }, { progress }));
      expect(res.run.status).toBe('ok');
      expect(res.result?.semantic.head.get(CONTROLLER)?.length).toBeGreaterThan(0);
      const root = lspWorktreeRoot(r.dir);
      expect(lines(r.imports)).toEqual([`gradle ${root}/head`, `export ${root}/head`, `json ${root}/json/head`, `json ${root}/json/base`]);
      expect(lines(r.spawns)).toHaveLength(1);
      expect(saved(r)).toHaveLength(1);
      expect(progress).toEqual(
        expect.arrayContaining([
          'このビルドの設定のプロジェクト構造はまだ保存していないので、Gradle で取り込んで保存します（head・base）',
          expect.stringMatching(/^プロジェクト構造を保存しました（\d+ 秒）。同じビルドの設定なら、次からは Gradle の取り込みを省きます$/),
          '保存してあるプロジェクト構造を使うので、Gradle の取り込みを省きます',
          '言語サーバーを起動しています',
        ]),
      );
      // JSON は各 worktree の絶対パスで置き、書き出しが worktree に書いたファイルは残さない
      const placed = readFileSync(path.join(root, 'json', 'base', 'workspace.json'), 'utf8');
      expect(placed).toContain(`${root}/base/src/main/kotlin`);
      expect(placed).not.toContain('<WORKSPACE>');
      expect(existsSync(path.join(root, 'head', 'workspace.json'))).toBe(false);
    } finally {
      r.cleanup();
    }
  });

  it('serve を起動し直しても（新しい holder）、書き出さずに JSON の形で起動する', async () => {
    const r = setup();
    try {
      await once(r, job(r, { base: r.sha.main, head: r.sha.discount }));
      const before = lines(r.imports).length;
      const res = await once(r, job(r, { base: r.sha.main, head: r.sha.discount }));
      expect(res.run.status).toBe('ok');
      const root = lspWorktreeRoot(r.dir);
      expect(lines(r.imports).slice(before)).toEqual([`json ${root}/json/head`, `json ${root}/json/base`]);
    } finally {
      r.cleanup();
    }
  });

  it('ビルドの設定が変わった PR は、変わった側だけ書き出し直す', async () => {
    const r = setup();
    const holder = createLspHolder(r.dir);
    try {
      await holder.job(job(r, { base: r.sha.main, head: r.sha.discount }));
      const before = lines(r.imports).length;
      const progress: string[] = [];
      const res = await holder.job(job(r, { base: r.sha.second, head: r.sha.build }, { progress }));
      expect(res).toMatchObject({ run: { status: 'ok' }, reused: false });
      const root = lspWorktreeRoot(r.dir);
      expect(lines(r.imports).slice(before)).toEqual([`gradle ${root}/head`, `export ${root}/head`, `json ${root}/json/head`, `json ${root}/json/base`]);
      expect(progress).toContain('このビルドの設定のプロジェクト構造はまだ保存していないので、Gradle で取り込んで保存します（head）');
      expect(saved(r)).toHaveLength(2);
    } finally {
      await holder.close();
      r.cleanup();
    }
  });

  it('ソースのフォルダが増えた PR は書き出し直す。書き出した版に在るフォルダなら、次は書き出さない', async () => {
    const r = setup();
    try {
      await once(r, job(r, { base: r.sha.main, head: r.sha.discount }));
      const progress: string[] = [];
      const before = lines(r.imports).length;
      expect((await once(r, job(r, { base: r.sha.discount, head: r.sha.java }, { progress, head: [CONTROLLER, EXTRA] }))).run.status).toBe('ok');
      const root = lspWorktreeRoot(r.dir);
      expect(lines(r.imports).slice(before)).toContain(`export ${root}/head`);
      expect(progress).toContain('ソースのフォルダ（src/main/java）が増えたので、Gradle で取り込み直します');
      expect(readFileSync(path.join(root, 'json', 'head', 'workspace.json'), 'utf8')).toContain(`${root}/head/src/main/java`);
      const again = lines(r.imports).length;
      expect((await once(r, job(r, { base: r.sha.discount, head: r.sha.java }, { head: [CONTROLLER, EXTRA] }))).run.status).toBe('ok');
      expect(lines(r.imports).slice(again)).toEqual([`json ${root}/json/head`, `json ${root}/json/base`]);
    } finally {
      r.cleanup();
    }
  });

  it('起動したままでも、ソースのフォルダが増えた PR では起動し直す', async () => {
    const r = setup();
    const holder = createLspHolder(r.dir);
    try {
      await holder.job(job(r, { base: r.sha.main, head: r.sha.discount }));
      const progress: string[] = [];
      const res = await holder.job(job(r, { base: r.sha.discount, head: r.sha.java }, { progress, head: [CONTROLLER, EXTRA] }));
      expect(res).toMatchObject({ run: { status: 'ok' }, reused: false });
      expect(progress[0]).toBe('ソースのフォルダ（src/main/java）が増えたので、言語サーバーを起動し直します');
      expect(lines(r.spawns)).toHaveLength(2);
    } finally {
      await holder.close();
      r.cleanup();
    }
  });

  it('保存が指すファイル（ライブラリの jar）が無くなっていれば書き出し直す', async () => {
    const r = setup();
    try {
      const lib = path.join(r.dir, '.lib.jar');
      writeFileSync(lib, '');
      await once(r, job(r, { base: r.sha.main, head: r.sha.discount }, { env: { FAKE_LSP_LIB: lib } }));
      unlinkSync(lib);
      const progress: string[] = [];
      const before = lines(r.imports).length;
      expect((await once(r, job(r, { base: r.sha.main, head: r.sha.discount }, { progress, env: { FAKE_LSP_LIB: lib } }))).run.status).toBe('ok');
      expect(progress).toContain('保存してあるプロジェクト構造が指すファイルが見つからないので、Gradle で取り込み直します（.lib.jar）');
      expect(lines(r.imports).slice(before)).toContain(`export ${lspWorktreeRoot(r.dir)}/head`);
    } finally {
      r.cleanup();
    }
  });

  it('exportWorkspace を持たない kotlin-lsp なら、今の Gradle の形で起動する', async () => {
    const r = setup();
    try {
      const progress: string[] = [];
      const res = await once(r, job(r, { base: r.sha.main, head: r.sha.discount }, { progress, env: { FAKE_LSP_NO_EXPORT: '1' } }));
      expect(res.run.status).toBe('ok');
      const root = lspWorktreeRoot(r.dir);
      expect(lines(r.imports).slice(-2)).toEqual([`gradle ${root}/head`, `gradle ${root}/base`]);
      expect(progress).toContain('この kotlin-lsp はプロジェクト構造を書き出せないので、Gradle で取り込みます');
      expect(saved(r)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  it('JSON の取り込みが失敗したら、同じ解析の中で Gradle の形で起動し、次からもこの kotlin-lsp では JSON を使わない', async () => {
    const r = setup();
    try {
      await once(r, job(r, { base: r.sha.main, head: r.sha.discount }));
      const progress: string[] = [];
      const before = lines(r.imports).length;
      const res = await once(r, job(r, { base: r.sha.main, head: r.sha.discount }, { progress, env: { FAKE_LSP_JSON_FAIL: '1' } }));
      expect(res.run.status).toBe('ok');
      const root = lspWorktreeRoot(r.dir);
      expect(lines(r.imports).slice(before)).toEqual([`json ${root}/json/head`, `json ${root}/json/base`, `gradle ${root}/head`, `gradle ${root}/base`]);
      expect(progress).toContain('保存してあるプロジェクト構造を読み込めなかったので、Gradle で取り込みます（インポートに失敗しました: Error parsing workspace.json: boom）');
      // 書き出しと JSON の失敗を毎回くり返さない（実際のプロジェクトではそれぞれ 10 分）
      const next: string[] = [];
      const again = lines(r.imports).length;
      expect((await once(r, job(r, { base: r.sha.main, head: r.sha.discount }, { progress: next }))).run.status).toBe('ok');
      expect(lines(r.imports).slice(again)).toEqual([`gradle ${root}/head`, `gradle ${root}/base`]);
      expect(next).toContain('この kotlin-lsp では保存したプロジェクト構造を読み込めなかったので、Gradle で取り込みます');
    } finally {
      r.cleanup();
    }
  });

  it('書き出しのための取り込みが失敗したら unavailable。言語サーバーの本体は起動しない', async () => {
    const r = setup();
    try {
      const res = await once(r, job(r, { base: r.sha.main, head: r.sha.discount }, { env: { FAKE_LSP_MODE: 'failed' } }));
      expect(res.run).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('Unable to import a Gradle project') });
      // 記録のコマンドは本体の起動の形（書き出し用の作業場所ではない）
      expect(res.run.command).toMatch(/--system-path .*\/lsp\/workspace$/);
      expect(lines(r.spawns)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });

  it('規則の無い言語では書き出さず、今の形で起動する', async () => {
    const r = setup();
    try {
      expect((await once(r, job(r, { base: r.sha.main, head: r.sha.discount }, { language: 'other' }))).run.status).toBe('ok');
      const root = lspWorktreeRoot(r.dir);
      expect(lines(r.imports)).toEqual([`gradle ${root}/head`, `gradle ${root}/base`]);
      expect(saved(r)).toEqual([]);
    } finally {
      r.cleanup();
    }
  });
});

describe('pruneProjectModels', () => {
  it('新しく使った順に keep 個まで残す', () => {
    const r = setup();
    try {
      const dir = projectModelDir(r.dir);
      const at = (name: string, sec: number) => {
        const f = path.join(dir, name);
        mkdirSync(path.dirname(f), { recursive: true });
        writeFileSync(f, '{}');
        utimesSync(f, sec, sec);
      };
      at('k1/a.json', 1000);
      at('k1/b.json', 3000);
      at('k2/c.json', 2000);
      pruneProjectModels(r.dir, 2);
      expect(saved(r).sort()).toEqual(['k1/b.json', 'k2/c.json']);
    } finally {
      r.cleanup();
    }
  });
});
