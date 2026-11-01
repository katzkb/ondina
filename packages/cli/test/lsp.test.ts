// LSP の起動・待機・フォールバック（設計書 9.1 / 9.5）。本物の kotlin-lsp は起動しない（test/fake-lsp.mjs）。
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KOTLIN_IMPORT_NOTIFICATION } from '@ondina/core';
import { formatDuration, installedLspCommand, lspCacheDir, lspWorktreeRoot, resolveLspArgs, resolveLspCommand, runLsp, waitingLine } from '../src/lsp.js';
import { exportCacheDir, projectModelDir } from '../src/lsp-model.js';
import { lspLockFile } from '../src/lsp-session.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

const FAKE = path.resolve(import.meta.dirname, 'fake-lsp.mjs'); // shebang + 実行ビットで直接起動できる
const TARGETS = [{ path: 'src/main/kotlin/Order.kt', name: 'applyDiscount', hunkId: 'h1' }];

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-lsp-'));
  mkdirSync(path.join(dir, 'src/main/kotlin'), { recursive: true });
  writeFileSync(path.join(dir, 'src/main/kotlin/Order.kt'), 'class Order {\n    fun applyDiscount() {}\n}\n');
  writeFileSync(path.join(dir, 'src/main/kotlin/CartItem.kt'), 'data class CartItem(val sku: String)\n');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const base = (mode: string) => ({
  command: FAKE,
  args: ['--stdio', '--system-path', '{cacheDir}'],
  roots: { head: dir, base: dir },
  openFiles: [] as string[],
  cacheDir: path.join(dir, '.cache'),
  readyTimeoutSec: 10,
  rule: KOTLIN_IMPORT_NOTIFICATION,
  targets: TARGETS,
  env: { FAKE_LSP_MODE: mode },
});

describe('resolveLspArgs', () => {
  it('{cacheDir} を置換する。ほかの引数はそのまま', () => {
    expect(resolveLspArgs(['--stdio', '--system-path', '{cacheDir}'], '/tmp/c')).toEqual(['--stdio', '--system-path', '/tmp/c']);
  });
  it('{cacheDir} が無ければ何もしない', () => {
    expect(resolveLspArgs(['--stdio'], '/tmp/c')).toEqual(['--stdio']);
  });
});

describe('resolveLspCommand', () => {
  it('ONDINA_LSP_COMMAND > yaml の command > kotlin-lsp の置き場', () => {
    expect(resolveLspCommand({ env: '/a/lsp', yaml: 'kotlin-lsp', installed: '/b/lsp' })).toBe('/a/lsp');
    expect(resolveLspCommand({ yaml: 'kotlin-lsp', installed: '/b/lsp' })).toBe('kotlin-lsp');
    expect(resolveLspCommand({ yaml: '', installed: '/b/lsp' })).toBe('/b/lsp');
    expect(resolveLspCommand({ yaml: '' })).toBe('');
  });
  it('空文字は無いものとして扱う', () => {
    expect(resolveLspCommand({ env: '', yaml: 'kotlin-lsp' })).toBe('kotlin-lsp');
    expect(resolveLspCommand({ env: '', yaml: '', installed: '/b/lsp' })).toBe('/b/lsp');
  });
});

describe('installedLspCommand（scripts/install-kotlin-lsp.sh が入れた kotlin-lsp。AI エージェントの非対話シェルは ~/.zshrc を読まないので、環境変数に頼らず見つける）', () => {
  const server = (d: string) => path.join(d, 'current/bin/intellij-server');
  const put = (d: string) => {
    mkdirSync(path.dirname(server(d)), { recursive: true });
    writeFileSync(server(d), '#!/bin/sh\n');
  };

  it('ONDINA_LSP_DIR の current/bin/intellij-server。無ければ undefined', () => {
    const d = path.join(dir, 'lsp-dir');
    expect(installedLspCommand({ ONDINA_LSP_DIR: d }, path.join(dir, 'no-home'))).toBeUndefined();
    put(d);
    expect(installedLspCommand({ ONDINA_LSP_DIR: d }, path.join(dir, 'no-home'))).toBe(server(d));
  });
  it('ONDINA_LSP_DIR が無ければ（空でも） ~/.local/share/kotlin-lsp', () => {
    const home = path.join(dir, 'home');
    put(path.join(home, '.local/share/kotlin-lsp'));
    expect(installedLspCommand({}, home)).toBe(server(path.join(home, '.local/share/kotlin-lsp')));
    expect(installedLspCommand({ ONDINA_LSP_DIR: '' }, home)).toBe(server(path.join(home, '.local/share/kotlin-lsp')));
  });
});

describe('formatDuration', () => {
  it('分と秒。0 の方は書かない', () => {
    expect(formatDuration(45_000)).toBe('45 秒');
    expect(formatDuration(65_000)).toBe('1 分 5 秒');
    expect(formatDuration(600_000)).toBe('10 分');
  });
});

describe('waitingLine（待っている間に ondina analyze が出す 1 行）', () => {
  it('経過・終わっていない作業・最後のインポートのログ', () => {
    expect(waitingLine({ elapsedMs: 150_000, pending: { tasks: ['Importing（Gradle）', 'Indexing（42%）'], log: 'Download b-1.0.jar' } })).toBe(
      '言語サーバーの準備を待っています（2 分 30 秒）: Importing（Gradle）、Indexing（42%）。最後のインポートのログ: Download b-1.0.jar',
    );
  });
  it('サーバーのログの最後の進みがあれば後ろに足す', () => {
    expect(waitingLine({ elapsedMs: 360_000, pending: { tasks: ['Importing（Gradle）'], serverLog: 'Run build started' } })).toBe(
      '言語サーバーの準備を待っています（6 分）: Importing（Gradle）。サーバーのログの最後: Run build started',
    );
  });

  it('作業がまだ始まっていなければ、そう書く', () => {
    expect(waitingLine({ elapsedMs: 30_000, pending: { tasks: [] } })).toBe('言語サーバーの準備を待っています（30 秒）: 最初の通知を待っています');
  });
});

describe('lspCacheDir', () => {
  it('.ondina/lsp/workspace。リポジトリで 1 つ（PR でも headSha でも分けない）', () => {
    expect(lspCacheDir('/repo')).toBe(path.join('/repo', '.ondina', 'lsp', 'workspace'));
  });
});

describe('言語サーバーまわりの置き場所は、worktree から打っても元のフォルダの .ondina/lsp', () => {
  // 索引は置き場所のパスの文字列ごと。打つフォルダで変わると、索引を作り直す（2026-10-19 実測。fixture で 1.9 秒 → 8.3 秒）
  let main: string;
  let wt: string;
  let done: () => void;
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
  afterAll(() => done());

  it('索引・言語サーバー用の worktree・ロック・保存した構造・書き出しの作業場所', () => {
    const lsp = path.join(main, '.ondina', 'lsp');
    expect(lspCacheDir(wt)).toBe(path.join(lsp, 'workspace'));
    expect(lspWorktreeRoot(wt)).toBe(lsp);
    expect(lspLockFile(wt)).toBe(path.join(lsp, 'lock'));
    expect(projectModelDir(wt)).toBe(path.join(lsp, 'models'));
    expect(exportCacheDir(wt)).toBe(path.join(lsp, 'export'));
  });

  it('置き場所の設定（worktreeRoot）があれば、その下のまま', () => {
    expect(lspWorktreeRoot(wt, '/somewhere')).toBe(path.join('/somewhere', 'lsp'));
  });
});

describe('runLsp', () => {
  it('取り込みが成功して辺が取れたら ok。待った時間を残す', async () => {
    const { run: r } = await runLsp(base('ok'));
    expect(r.status).toBe('ok');
    expect(r.command).toContain('fake-lsp.mjs');
    expect(r.command).toContain('--system-path');
    expect(r.waitedMs).toBeGreaterThan(0);
    expect(r).not.toHaveProperty('reason');
  });

  it('取り込みが失敗したら unavailable。$/progress が正常に end しても通さない', async () => {
    const { run: r } = await runLsp(base('failed'));
    expect(r.status).toBe('unavailable');
    expect(r.reason).toContain('Unable to import a Gradle project: boom');
    expect(r).not.toHaveProperty('waitedMs');
  });

  it('辺が取れないまま時間切れなら unavailable', async () => {
    const { run: r } = await runLsp({ ...base('empty'), readyTimeoutSec: 2 });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toContain('基準シンボル');
  });

  it('知らせが続いている間は、readyTimeoutSec を過ぎても待つ（大きなリポジトリの冷えた起動）', async () => {
    // 割合の知らせが 0.2 秒おきに 12 回（2.4 秒）。readyTimeoutSec は 1 秒
    const { run: r } = await runLsp({ ...base('slow'), readyTimeoutSec: 1, env: { FAKE_LSP_MODE: 'slow', FAKE_LSP_DELAY_MS: '200' } });
    expect(r.status).toBe('ok');
    expect(r.waitedMs).toBeGreaterThan(2000);
  });

  it('知らせが readyTimeoutSec 来なければ時間切れ。終わっていない作業と最後のインポートのログを理由に足す', async () => {
    const { run: r } = await runLsp({ ...base('stuck'), readyTimeoutSec: 1 });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('準備完了まで待ちましたが時間切れです（1 秒間、新しい通知がありません）。終わっていない作業: Importing（Gradle）。最後のインポートのログ: Download https://repo.example.com/b/1.0/b-1.0.jar');
  });

  it('知らせが続いていても、readyCapSec で打ち切る。そのときの作業を理由に足す', async () => {
    const { run: r } = await runLsp({ ...base('slow'), readyTimeoutSec: 10, readyCapSec: 1, env: { FAKE_LSP_MODE: 'slow', FAKE_LSP_DELAY_MS: '200' } });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toMatch(/^準備完了まで待ちましたが時間切れです（1 秒）。終わっていない作業: Importing、Indexing（\d+%）。最後のインポートのログ: Workspace imported successfully$/);
  });

  it('待っている間、waitReportMs おきに onWaiting で経過と終わっていない作業を渡す', async () => {
    const seen: { elapsedMs: number; tasks: string[] }[] = [];
    const { run: r } = await runLsp({
      ...base('slow'),
      env: { FAKE_LSP_MODE: 'slow', FAKE_LSP_DELAY_MS: '200' },
      waitReportMs: 500,
      onWaiting: (w) => seen.push({ elapsedMs: w.elapsedMs, tasks: w.pending.tasks }),
    });
    expect(r.status).toBe('ok');
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen[0]!.elapsedMs).toBeGreaterThanOrEqual(500);
    expect(seen.some((s) => s.tasks.some((t) => /^Indexing（\d+%）$/.test(t)))).toBe(true);
  });

  it('知らせが来なくても、サーバーのログが伸びている間は待つ。待っている間はログの最後の進みも渡す', async () => {
    // Gradle の設定の段階。知らせは Importing（Gradle）のまま、ログにだけ 0.3 秒おきに 8 行（2.4 秒）。readyTimeoutSec は 1 秒
    const log = path.join(dir, 'quietlog-server.log');
    writeFileSync(log, '');
    const seen: (string | undefined)[] = [];
    const { run: r } = await runLsp({
      ...base('quietlog'),
      readyTimeoutSec: 1,
      env: { FAKE_LSP_MODE: 'quietlog', FAKE_LSP_DELAY_MS: '300', FAKE_LSP_LOG: log },
      waitReportMs: 500,
      onWaiting: (w) => seen.push(w.pending.serverLog),
    });
    expect(r.status).toBe('ok');
    expect(seen.some((s) => s !== undefined && /^Resolve dependencies of :m\d:compileClasspath started$/.test(s))).toBe(true);
  });

  it('時間切れの理由に、サーバーのログの最後の進みも足す', async () => {
    const log = path.join(dir, 'stuck-server.log');
    writeFileSync(log, '');
    const { run: r } = await runLsp({ ...base('stuck'), readyTimeoutSec: 1, env: { FAKE_LSP_MODE: 'stuck', FAKE_LSP_LOG: log } });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe(
      '準備完了まで待ちましたが時間切れです（1 秒間、新しい通知がありません）。終わっていない作業: Importing（Gradle）。最後のインポートのログ: Download https://repo.example.com/b/1.0/b-1.0.jar。サーバーのログの最後: Run build started',
    );
  });

  it('応答が返らないまま時間切れなら unavailable', async () => {
    const { run: r } = await runLsp({ ...base('silent'), readyTimeoutSec: 1 });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toContain('時間切れ');
  });

  it('途中で落ちたら unavailable', async () => {
    const { run: r } = await runLsp({ ...base('crash'), readyTimeoutSec: 3 });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toMatch(/終了|切れ/);
  });

  it('起動してすぐ終わったら、stderr の最後の 3 行を理由に足す（期限切れの kotlin-lsp。9.5）', async () => {
    const { run: r } = await runLsp(base('expired'));
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('LSP が起動してすぐ終了しました: This build of kotlin-server has expired. / The IDE will now close. / Please download a new build from https://github.com/kotlin/kotlin-lsp');
  });

  it('コマンドが無ければ unavailable（解析は止めない）。時間切れを待たずにすぐ返す', async () => {
    const t0 = Date.now();
    const { run: r } = await runLsp({ ...base('ok'), command: '/no/such/lsp-binary', readyTimeoutSec: 30 });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toContain('起動できません');
    // readyTimeoutSec まで待ってはいけない（コマンド名の打ち間違いで 30 秒黙ることになる）
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('基準シンボルが 1 つも無ければ、起動せずに unavailable', async () => {
    const { run: r } = await runLsp({ ...base('ok'), targets: [] });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toContain('基準シンボル');
  });

  it('変えた宣言に関数が無い（データクラスだけ）PR でも、時間切れを待たずに使える', async () => {
    // 呼び出し関係を問い合わせる場所が無いだけで、言語サーバーは答えている
    const t0 = Date.now();
    const { run: r } = await runLsp({ ...base('ok'), targets: [{ path: 'src/main/kotlin/CartItem.kt', name: 'CartItem', hunkId: 'h9' }], readyTimeoutSec: 30 });
    expect(r.status).toBe('ok');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('宣言一覧に名前が無い（消した宣言など）PR でも、時間切れを待たずに使える', async () => {
    const t0 = Date.now();
    const { run: r } = await runLsp({ ...base('ok'), targets: [{ path: 'src/main/kotlin/Order.kt', name: 'いない関数', hunkId: 'h9' }], readyTimeoutSec: 30 });
    expect(r.status).toBe('ok');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('準備完了したら work が呼ばれ、その結果が返る（設計書 9.1 の案A）', async () => {
    const seen: string[] = [];
    const { run, result } = await runLsp(base('ok'), async (client, legend) => {
      seen.push(...legend.tokenTypes.slice(0, 2));
      const res = await client.request<{ data: number[] } | null>('textDocument/semanticTokens/full', {
        textDocument: { uri: 'file:///x/Order.kt' },
      });
      return res?.data ?? [];
    });
    expect(run.status).toBe('ok');
    expect(seen).toEqual(['namespace', 'class']);
    expect(result).toEqual([2, 6, 5, 1, 1, 1, 8, 2, 7, 1]); // class Order / parameter id
  });

  it('work が投げたら unavailable。理由を残し、準備完了までの時間も残す', async () => {
    const { run, result } = await runLsp(base('ok'), async () => {
      throw new Error('取り出しに失敗しました');
    });
    expect(run.status).toBe('unavailable');
    expect(run.reason).toContain('取り出しに失敗しました');
    expect(run.waitedMs).toBeGreaterThan(0);
    expect(result).toBeUndefined();
  });

  it('準備完了しなかったら work は呼ばれない', async () => {
    let called = false;
    const { run } = await runLsp({ ...base('failed') }, async () => {
      called = true;
      return 1;
    });
    expect(run.status).toBe('unavailable');
    expect(called).toBe(false);
  });

  it('インデックスの置き場を作る', async () => {
    const cacheDir = path.join(dir, '.cache-made');
    await runLsp({ ...base('ok'), cacheDir });
    expect(rmSync).toBeDefined();
    expect(path.isAbsolute(cacheDir)).toBe(true);
    const { existsSync } = await import('node:fs');
    expect(existsSync(cacheDir)).toBe(true);
  });
});
