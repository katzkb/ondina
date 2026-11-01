// 言語サーバーを起動したまま、PR ごとに base / head の中身だけ切り替えて使う（設計書 9.1）。
// serve が 1 つ持ち続け（serve.ts）、serve が動いていない analyze は 1 回ごとに作って閉じる（analyze.ts）。
//
// 2026-10-15 の実測（fixture、kotlin-lsp 263.6379.0）:
// - kotlin-lsp は置き場所（workspaceFolders）ごとに索引を持ち、起動のたびに Gradle の取り込みをやり直す
// - 起動したまま、置き場所を固定した worktree を checkout で切り替え、変わったファイルを知らせると、次の PR は 0.2 秒で準備でき、
//   色は新しく起動した場合と完全に一致した。取り込みは起動したときの 1 回だけ
// - ただし依存の変化は拾わない（ビルドスクリプトに gson を足しても、gson の 5 か所に色が付かない）。そこで起動し直す（restart.ts）
// - ソケット（--multi-client）で接続し直す形は、接続のたびに取り込みが走るので使わない。1 本の stdio 接続を持ち続ける
// 2026-10-19: 起動するときは、保存したプロジェクト構造（lsp-model.ts）で Gradle の取り込みを省く。実際のプロジェクトでは、準備の大半が Gradle の取り込みだった
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { firstRestartPath, type CallGraphSource, type DefinitionSource, type ImportNotificationRule, type ProbeTarget, type SemanticSource } from '@ondina/core';
import type { Hunk, LspRun } from '@ondina/model';
import { switchWorktree, type WorktreeChange } from './git.js';
import { formatDuration, lspHome, LSP_PROBE_BUDGET_MS, LSP_PROBE_INTERVAL_MS, LSP_READY_CAP_SEC, probeSession, resolveLspArgs, startLspSession, waitingLine, type LspSession } from './lsp.js';
import { forgetProjectModels, grownSourceDir, prepareProjectModel, type UsedModel } from './lsp-model.js';
import { collectCallGraph, collectDefinitions, collectSemanticTokens, unchangedFiles } from './lsp-queries.js';

/** 起動したままの言語サーバーで基準シンボルを打ち直す間隔。切り替えた直後でも 0.2 秒で答えた（2026-10-15） */
const REUSED_PROBE_INTERVAL_MS = 250;

/** 別のプロセスがロックを持っている間、見に行く間隔 */
const LOCK_POLL_MS = 500;

export interface LspJobArgs {
  /** 起動し直す規則（restart.ts）を選ぶ */
  language: string;
  /** resolveLspCommand 済みの実行ファイル */
  command: string;
  /** yaml の args（{cacheDir} は置換前） */
  args: readonly string[];
  readyTimeoutSec: number;
  readyCapSec?: number;
  rule: ImportNotificationRule;
  /** 言語サーバー用の worktree の親（lspWorktreeRoot）。<root>/base と <root>/head を shas に切り替える */
  root: string;
  cacheDir: string;
  shas: { base: string; head: string };
  /** 意味トークンを取るファイル（リポジトリ相対。その側にある分だけ） */
  sides: { head: readonly string[]; base: readonly string[] };
  /** PR で変わったファイル全部（リポジトリ相対）。base の定義の行き先を head の同じ場所にしてよいかを決める（analyze の buildDefinitions と同じ集合。3.6） */
  changed: readonly string[];
  targets: readonly ProbeTarget[];
  hunks: readonly Hunk[];
  isTestPath: (repoRelative: string) => boolean;
  /** 進みの 1 行（ondina analyze が標準エラーに出す） */
  progress?: (line: string) => void;
  waitReportMs?: number;
  /** テスト用。子に足す環境変数 */
  env?: Record<string, string>;
}

export interface LspJobResult {
  run: LspRun;
  /** 起動済みの言語サーバーを使ったか */
  reused: boolean;
  /** definitions は名前から定義への答え（3.6）。semantic には、その 2 段目で全体を聞いたファイルの分も入る */
  result?: { semantic: SemanticSource; callGraph: CallGraphSource; definitions?: DefinitionSource };
}

export interface LspHolder {
  /** 1 本ずつ。走っている間に頼まれた分は、前が終わってから始める。投げない（失敗は unavailable で返す） */
  job(a: LspJobArgs): Promise<LspJobResult>;
  /** 言語サーバーを終わらせ、ロックを外す */
  close(): Promise<void>;
}

/** 同じ作業場所を 2 つの言語サーバーが使わないためのロック。中身は持ち主の pid */
export function lspLockFile(repo: string): string {
  return path.join(lspHome(repo), 'lock');
}

/** その pid のプロセスが生きているか（別のユーザーのもので signal を送れなくても、生きているとみなす） */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** ロックを取る。生きている持ち主がいれば待つ（deadline まで）。取れたら外す関数、取れなければ持ち主の pid */
async function acquireLock(file: string, deadline: number, progress?: (line: string) => void): Promise<(() => void) | { holder: number }> {
  mkdirSync(path.dirname(file), { recursive: true });
  let told: number | undefined;
  for (;;) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          if (readFileSync(file, 'utf8') === String(process.pid)) unlinkSync(file);
        } catch {
          // 消えていれば構わない
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    let pid = Number.NaN;
    try {
      pid = Number(readFileSync(file, 'utf8').trim());
    } catch {
      continue; // 読む間に消えた。取り直す
    }
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || !alive(pid)) {
      // 持ち主が死んでいる（kill -9 された serve など）か、壊れている
      try {
        unlinkSync(file);
      } catch {
        // 別のプロセスが先に消した
      }
      continue;
    }
    if (Date.now() > deadline) return { holder: pid };
    if (told !== pid) {
      progress?.(`別の解析（pid ${pid}）が言語サーバーを使っています。終わるのを待っています`);
      told = pid;
    }
    await sleep(LOCK_POLL_MS);
  }
}

/** LSP の FileChangeType: 1 Created / 2 Changed / 3 Deleted */
const CHANGE_TYPE = { A: 1, M: 2, D: 3 } as const;

export function createLspHolder(repo: string, o: { handleSignals?: boolean } = {}): LspHolder {
  /** model は保存したプロジェクト構造で起動したときの、各側の保存（ソースのフォルダが増えたかを見る） */
  let current: { session: LspSession; identity: string; release: () => void; model?: Record<'head' | 'base', UsedModel> } | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  /** 頼まれてまだ終わっていない解析の数 */
  let pending = 0;
  /** close() で起動の途中の言語サーバーも殺す */
  const stop = new AbortController();

  const drop = async (): Promise<void> => {
    if (current === undefined) return;
    const c = current;
    current = undefined;
    try {
      await c.session.close();
    } finally {
      // 閉じるのが投げても、ロックは外す（残すと次の analyze が待ち続ける）
      c.release();
    }
  };

  const run = async (a: LspJobArgs): Promise<LspJobResult> => {
    const command = [a.command, ...resolveLspArgs(a.args, a.cacheDir)].join(' ');
    const unavailable = (reason: string, reused: boolean, waitedMs?: number): LspJobResult => ({ run: { command, status: 'unavailable', reason, ...(waitedMs === undefined ? {} : { waitedMs }) }, reused });
    if (a.targets.length === 0) return unavailable('基準シンボル（変更された宣言）がありません', false);

    // 1. 言語サーバー用の worktree を切り替える（作り直さない。索引は置き場所ごと）
    const roots = { base: path.join(a.root, 'base'), head: path.join(a.root, 'head') };
    const switched = { base: switchWorktree(repo, roots.base, a.shas.base), head: switchWorktree(repo, roots.head, a.shas.head) };

    // 2. 起動し直すか。起動の形（コマンド・引数・置き場所）が同じで、ビルドの設定ファイルが変わっていなければ使い回す
    const identity = JSON.stringify({ command: a.command, args: a.args, roots, cacheDir: a.cacheDir, env: a.env ?? {} });
    if (current !== undefined) {
      const why = !current.session.alive()
        ? '言語サーバーが終了していたので、起動し直します'
        : current.identity !== identity
          ? '言語サーバーの起動の設定が変わったので、起動し直します'
          : switched.base.previous === null || switched.head.previous === null
            ? 'base と head の置き場所を作り直したので、言語サーバーを起動し直します'
            : (restartFor(a.language, [...switched.base.changed, ...switched.head.changed]) ?? grownFor(repo, current.model, a.sides));
      if (why !== undefined) {
        a.progress?.(why);
        await drop();
      }
    }

    const open = { head: a.sides.head.map((p) => path.join(roots.head, p)), base: a.sides.base.map((p) => path.join(roots.base, p)) };
    let reused = current !== undefined;
    let since: number;
    let session: LspSession;
    if (current === undefined) {
      const cap = Date.now() + (a.readyCapSec ?? LSP_READY_CAP_SEC) * 1000;
      const lock = await acquireLock(lspLockFile(repo), cap, a.progress);
      if (typeof lock !== 'function') return unavailable(`別の解析（pid ${lock.holder}）が言語サーバーを使い続けているので、使えませんでした（${formatDuration((a.readyCapSec ?? LSP_READY_CAP_SEC) * 1000)}待ちました）`, false);
      const start = (folders?: readonly string[]) => {
        a.progress?.('言語サーバーを起動しています');
        return startLspSession({
          command: a.command,
          args: a.args,
          roots,
          ...(folders === undefined ? {} : { folders }),
          openFiles: [...open.head, ...open.base],
          cacheDir: a.cacheDir,
          readyTimeoutSec: a.readyTimeoutSec,
          ...(a.readyCapSec === undefined ? {} : { readyCapSec: a.readyCapSec }),
          rule: a.rule,
          targets: a.targets,
          ...(a.env === undefined ? {} : { env: a.env }),
          ...(a.waitReportMs === undefined ? {} : { waitReportMs: a.waitReportMs }),
          ...(a.progress === undefined ? {} : { onWaiting: (w) => a.progress?.(waitingLine(w)) }),
          ...(o.handleSignals === undefined ? {} : { handleSignals: o.handleSignals }),
          signal: stop.signal,
        });
      };
      let started: Awaited<ReturnType<typeof startLspSession>>;
      let model: Awaited<ReturnType<typeof prepareProjectModel>>;
      try {
        // 保存したプロジェクト構造を用意する（無い側だけ Gradle で書き出す）。ロックの中で（書き出しも kotlin-lsp を起動する）
        model = await prepareProjectModel({
          repo,
          language: a.language,
          command: a.command,
          args: a.args,
          readyTimeoutSec: a.readyTimeoutSec,
          ...(a.readyCapSec === undefined ? {} : { readyCapSec: a.readyCapSec }),
          rule: a.rule,
          root: a.root,
          shas: a.shas,
          sides: a.sides,
          ...(a.progress === undefined ? {} : { progress: a.progress }),
          ...(a.waitReportMs === undefined ? {} : { waitReportMs: a.waitReportMs }),
          ...(a.env === undefined ? {} : { env: a.env }),
          ...(o.handleSignals === undefined ? {} : { handleSignals: o.handleSignals }),
          signal: stop.signal,
        });
        if (model.kind === 'failed') {
          lock();
          // 記録のコマンドは本体の起動の形にそろえる（書き出し用の作業場所ではなく）
          return unavailable(model.run.reason ?? '', false);
        }
        started = await start(model.kind === 'json' ? model.folders : undefined);
        if ('run' in started && started.importFailed === true && model.kind === 'json') {
          // 保存した構造を kotlin-lsp が読めなかった。その保存を消し、同じ解析の中で今までの Gradle の形で起動し直す
          a.progress?.(`保存してあるプロジェクト構造を読み込めなかったので、Gradle で取り込みます（${started.run.reason ?? ''}）`);
          forgetProjectModels(repo, a.command, model.used, started.run.reason ?? '');
          model = { kind: 'gradle' };
          started = await start();
        }
      } catch (e) {
        lock();
        throw e;
      }
      if ('run' in started) {
        lock();
        return { run: started.run, reused: false };
      }
      session = started.session;
      current = { session, identity, release: lock, ...(model.kind === 'json' ? { model: model.used } : {}) };
      since = session.startedAt;
      reused = false;
    } else {
      session = current.session;
      a.progress?.('起動済みの言語サーバーを使います');
      since = Date.now();
      const changes = (['base', 'head'] as const).flatMap((side) => switched[side].changed.map((c) => ({ uri: pathToFileURL(path.join(roots[side], c.path)).href, type: CHANGE_TYPE[c.status] })));
      if (changes.length > 0) session.client.notify('workspace/didChangeWatchedFiles', { changes });
      for (const t of a.targets) session.open(path.join(roots.head, t.path));
      for (const abs of [...open.head, ...open.base]) session.open(abs);
    }

    try {
      // 3. 基準シンボルで確かめる。起動したままなら、切り替えで始まった索引（$/progress）が止まるまでも待つ
      const probeStart = Date.now();
      const deadline = Math.min(probeStart + LSP_PROBE_BUDGET_MS, probeStart + a.readyTimeoutSec * 1000, reused ? Infinity : session.startedAt + (a.readyCapSec ?? LSP_READY_CAP_SEC) * 1000);
      const probed = await probeSession(session, roots.head, a.targets, { deadline, intervalMs: reused ? REUSED_PROBE_INTERVAL_MS : LSP_PROBE_INTERVAL_MS, settled: reused });
      if (probed !== 'ready') {
        if (probed.dead === true || session.failed() !== undefined) await drop();
        return unavailable(probed.reason, reused);
      }
      const waitedMs = Date.now() - since;
      try {
        const semantic = await collectSemanticTokens(session.client, session.legend, a.sides, roots);
        const callGraph = await collectCallGraph(session.client, { hunks: a.hunks, root: roots.head, isTestPath: a.isTestPath });
        const changed = new Set(a.changed);
        const definitions = await collectDefinitions(session.client, { legend: session.legend, semantic, hunks: a.hunks, changed, worktrees: roots, unchanged: unchangedFiles(callGraph, changed), open: (abs) => session.open(abs) });
        return { run: { command, status: 'ok', waitedMs }, reused, result: { semantic, callGraph, definitions } };
      } catch (e) {
        // 準備完了はしていたが取り出しに失敗した。解析は止めず、事実として残す（9.5）
        if (!session.alive()) {
          const reason = await session.died('LSP が途中で終了しました');
          await drop();
          return unavailable(reason, reused, waitedMs);
        }
        return unavailable(e instanceof Error ? e.message : String(e), reused, waitedMs);
      }
    } catch (e) {
      if (!session.alive()) await drop();
      return unavailable(e instanceof Error ? e.message : String(e), reused);
    } finally {
      if (session.alive()) session.closeAll();
    }
  };

  return {
    job(a) {
      if (pending > 0) a.progress?.('別の解析が言語サーバーを使っています。終わるのを待っています');
      pending += 1;
      const p = queue.then(async (): Promise<LspJobResult> => {
        try {
          return await run(a);
        } catch (e) {
          // worktree の切り替え（git）・ロック・起動の準備で投げた。解析は止めない（9.5）。
          // 途中まで切り替えたかもしれないので、言語サーバーの知っている中身とずれないよう捨てて、次の解析で起動し直す
          await drop();
          const command = [a.command, ...resolveLspArgs(a.args, a.cacheDir)].join(' ');
          return { run: { command, status: 'unavailable', reason: e instanceof Error ? e.message : String(e) }, reused: false };
        } finally {
          pending -= 1;
        }
      });
      queue = p.catch(() => undefined);
      return p;
    },
    async close() {
      // 走っている解析は待たない（起動の途中なら 10 分かかりうる）。言語サーバーを殺せば、その解析はすぐ unavailable で終わる。
      // 走っていなければ、shutdown を送ってから閉じる（送った通知を読み終えてから終わらせる）
      if (pending > 0) stop.abort();
      await drop();
      await queue;
      await drop();
    },
  };
}

/** 保存した構造で起動していて、変更ファイルが書き出した版に無かったソースのフォルダにあれば、起動し直す理由の 1 行 */
function grownFor(repo: string, model: Record<'head' | 'base', UsedModel> | undefined, sides: LspJobArgs['sides']): string | undefined {
  if (model === undefined) return undefined;
  const dir = grownSourceDir(repo, model.head, sides.head) ?? grownSourceDir(repo, model.base, sides.base);
  return dir === undefined ? undefined : `ソースのフォルダ（${dir}）が増えたので、言語サーバーを起動し直します`;
}

/** ビルドの設定ファイルが変わっていれば、起動し直す理由の 1 行 */
function restartFor(language: string, changed: readonly WorktreeChange[]): string | undefined {
  const p = firstRestartPath(language, changed.map((c) => c.path));
  return p === undefined ? undefined : `ビルドの設定ファイルが変わったので、言語サーバーを起動し直します（${p}）`;
}
