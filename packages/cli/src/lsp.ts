// LSP の起動・待機・終了（設計書 9.1 / 9.5）。core が決めた規則（ready / targets / client）を実際のプロセスに当てる。
//
// llm.ts との違い: LLM は sh -c で起動する 1 本の文字列だが、LSP は yaml が command と args を分けて持つので
// spawn(command, args) で起動する（インデックスの置き場のパスに空白があっても壊れないように）。
// 子は自分のプロセスグループ（detached）にして、打ち切りと Ctrl-C ではグループごと殺す（llm.ts と同じ）。
//
// 3 段構え（実測の根拠は設計書 9.1）:
//   1. $/progress が全部 end するまで待つ。知らせ（$/progress と取り込みの記録）が続くか、サーバーのログが伸びている間は待ち続け、
//      readyTimeoutSec 秒どちらも無ければ時間切れ（大きなリポジトリの冷えた起動は 10 分を超えうる。2026-10-09）。
//      Gradle の設定の段階は知らせを送らずログにだけ書く。実際のプロジェクトでは知らせの無いまま 10 分かかった（2026-10-10）。
//      ただし全体で readyCapSec（既定 60 分）を超えたら打ち切る。待っている間は onWaiting で終わっていない作業を渡す
//   2. そのあいだに独自通知が failed を言ったら、そこで打ち切る
//   3. 基準シンボルに callHierarchy を打って、辺が 1 本でも取れたら準備完了。
//      基準シンボルに関数が 1 つも無ければ（データクラス・定数・消した宣言だけの PR）打てないので、1・2 段目で準備完了とする
//
// 準備完了したあと、閉じる前に work(client, legend) を呼ぶ（設計書 9.1 の案A）。サーバが生きている間にしか
// 取れないもの（意味トークン・呼び出し辺・参照・定義）は全部ここで取る。どの道も finish() を通るので、
// IntelliJ サーバ（xmx 2 GB）の取り残しが起きない。
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLspClient, createReadyWatcher, describePending, findProbePosition, lastServerLogLine, type DocumentSymbol, type ImportNotificationRule, type LspClient, type Pending, type ProbeTarget, type SemanticLegend } from '@ondina/core';
import type { LspRun } from '@ondina/model';
import { mainWorktree } from './git.js';

/** 基準リクエストを打ち直す間隔。$/progress が終わってから答えが正しくなるまでに数秒の余地がある */
export const LSP_PROBE_INTERVAL_MS = 2000;

/**
 * 3 段目（基準リクエスト）の上限。$/progress が止まった時点でインデックスは終わっているので、
 * ここで何十秒も粘っても変わらない。readyTimeoutSec（既定 600 秒）を丸ごと使うと、
 * 呼び出し辺が本当に 0 本の PR で 10 分黙ることになる。
 */
export const LSP_PROBE_BUDGET_MS = 30_000;

/** 1 段目を全体で待つ上限の既定。知らせが続いていても、ここで打ち切る */
export const LSP_READY_CAP_SEC = 60 * 60;

/** 待っている間に onWaiting を呼ぶ間隔の既定 */
export const LSP_WAIT_REPORT_MS = 30_000;

/** 待機の状態を見に行く間隔 */
const POLL_MS = 100;

/** サーバーのログを見に行く間隔と、末尾から読む量 */
const SERVER_LOG_POLL_MS = 1000;
const SERVER_LOG_TAIL_BYTES = 64 * 1024;

/** ログのファイルの大きさと末尾。読めなければ undefined（ログが無くても待ち方は変わらない） */
function readTail(file: string): { size: number; tail: string } | undefined {
  try {
    const size = statSync(file).size;
    const len = Math.min(size, SERVER_LOG_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buf, 0, len, size - len);
    } finally {
      closeSync(fd);
    }
    return { size, tail: buf.toString('utf8') };
  } catch {
    return undefined;
  }
}

/** 65_000 → 「1 分 5 秒」、45_000 → 「45 秒」、120_000 → 「2 分」 */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} 秒`;
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`;
}

/** 待っている間の知らせ。elapsedMs は initialize の応答からの経過 */
export interface LspWaiting {
  elapsedMs: number;
  pending: Pending;
}

/** 待っている間に ondina analyze が出す 1 行。黙って 10 分待たせないように、何をしているかの事実を出す */
export function waitingLine(w: LspWaiting): string {
  const tasks = w.pending.tasks.length > 0 ? w.pending.tasks.join('、') : '最初の通知を待っています';
  const log = w.pending.log === undefined ? '' : `。最後のインポートのログ: ${w.pending.log}`;
  const serverLog = w.pending.serverLog === undefined ? '' : `。サーバーのログの最後: ${w.pending.serverLog}`;
  return `言語サーバーの準備を待っています（${formatDuration(w.elapsedMs)}）: ${tasks}${log}${serverLog}`;
}

/** initialize の応答を待つ上限。実測は 3 秒前後 */
const INITIALIZE_TIMEOUT_MS = 60_000;

/**
 * インデックスの置き場（--system-path）。リポジトリで 1 つ。headSha でも PR でも分けない（設計書 9.1）。
 * kotlin-lsp は中で置き場所（workspaceFolders）ごとに索引を分けるので、PR で分けても使い回しにはならず、
 * 言語サーバー用の worktree（lspWorktreeRoot）を 1 組に固定したときだけ索引が効く（2026-10-15 実測）。
 * base / head を 1 プロセスの 2 つの workspaceFolder で賄うので、side でも分けない。
 */
export function lspCacheDir(repo: string): string {
  return path.join(lspHome(repo), 'workspace');
}

/**
 * 言語サーバーまわり（索引・言語サーバー用の worktree・ロック・保存した構造）の置き場。git worktree の中で打っても元のフォルダの .ondina/lsp。
 * 索引は置き場所のパスの文字列ごとなので、打ったフォルダで変わると作り直す（2026-10-19 実測。fixture で 1.9 秒 → 8.3 秒）
 */
export function lspHome(repo: string): string {
  return path.join(mainWorktree(repo), '.ondina', 'lsp');
}

/**
 * 言語サーバー用の base / head の worktree の親（<親>/base と <親>/head）。リポジトリで 1 組で、PR ごとに中身だけ切り替える。
 * 置き場所の設定（worktreeRoot）があればその下、無ければ lspHome
 */
export function lspWorktreeRoot(repo: string, worktreeRoot?: string): string {
  return worktreeRoot === undefined ? lspHome(repo) : path.join(worktreeRoot, 'lsp');
}

/** yaml の args の {cacheDir} を実際の場所に置き換える。ondina が触るのはここだけ */
export function resolveLspArgs(args: readonly string[], cacheDir: string): string[] {
  return args.map((a) => a.replaceAll('{cacheDir}', cacheDir));
}

/**
 * 解決順: 環境変数 ONDINA_LSP_COMMAND > yaml の lsp.<lang>.command > kotlin-lsp の置き場（installedLspCommand）。空文字は無いものとして扱う。
 * 値は実行ファイルのパス 1 本（spawn(command, args) で起動するので 2 語は渡せない）。args は yaml のまま。
 */
export function resolveLspCommand(src: { env?: string | undefined; yaml: string; installed?: string | undefined }): string {
  return [src.env, src.yaml, src.installed].find((s) => s !== undefined && s !== '') ?? src.yaml;
}

/** kotlin-lsp の置き場（scripts/install-kotlin-lsp.sh と同じ。ONDINA_LSP_DIR、既定 ~/.local/share/kotlin-lsp）の current の下 */
export function lspInstallPath(env: Record<string, string | undefined>, home: string): string {
  return path.join(env['ONDINA_LSP_DIR'] || path.join(home, '.local/share/kotlin-lsp'), 'current/bin/intellij-server');
}

/**
 * scripts/install-kotlin-lsp.sh が入れた kotlin-lsp。無ければ undefined。
 * AI エージェントはコマンドを非対話の zsh（zsh -lc）で打ち、~/.zshrc を読まない。~/.zshrc の ONDINA_LSP_COMMAND に頼らず見つける（2026-10-19）
 */
export function installedLspCommand(env: Record<string, string | undefined>, home: string): string | undefined {
  const p = lspInstallPath(env, home);
  return existsSync(p) ? p : undefined;
}

export interface RunLspArgs {
  command: string;
  args: readonly string[];
  /**
   * base / head の worktree。両方を workspaceFolders に入れて 1 プロセスで賄う（設計書 9.1）。
   * 専用インスタンスを 2 本立てた場合とトークン列が完全一致することを 2026-09-22 に実測した。
   * rootUri と子プロセスの cwd は head。
   */
  roots: { head: string; base: string };
  /** 準備完了を待つ前に didOpen する絶対パス。基準シンボルのファイルは targets から別に開く */
  openFiles: readonly string[];
  cacheDir: string;
  /** 1 段目: 知らせがこの秒数なにも来なければ時間切れ。initialize の応答を待つ上限にも使う */
  readyTimeoutSec: number;
  /** 1 段目を全体で待つ上限（既定 LSP_READY_CAP_SEC） */
  readyCapSec?: number;
  /** 待っている間、waitReportMs（既定 LSP_WAIT_REPORT_MS）おきに呼ばれる */
  onWaiting?: (w: LspWaiting) => void;
  waitReportMs?: number;
  rule: ImportNotificationRule;
  targets: readonly ProbeTarget[];
  /** テスト用。子に足す環境変数 */
  env?: Record<string, string>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 準備完了したあと、閉じる前に呼ばれる。サーバが生きている間にしか取れないものをここで取る */
export type LspWork<T> = (client: LspClient, legend: SemanticLegend) => Promise<T>;

/**
 * 起動して 1〜2 段目（$/progress が止まる・取り込みが失敗していない）まで済んだ言語サーバー。close() するまで生きている。
 * 基準シンボルで確かめる 3 段目は probeSession。runLsp は 1 回ごとに起動して閉じ、serve は起動したまま次の PR に使う（設計書 9.1）
 */
export interface LspSession {
  /** 起動したコマンド（引数込み。Analysis.lsp.command） */
  command: string;
  client: LspClient;
  legend: SemanticLegend;
  /** initialize の応答の時刻（waitedMs の起点） */
  startedAt: number;
  /** サーバーが持つ workspace/executeCommand の命令（initialize の executeCommandProvider.commands） */
  commands: readonly string[];
  alive(): boolean;
  /** 開いている $/progress が無いか。中身を切り替えたあとの索引を待つのに使う */
  settled(): boolean;
  /** 独自通知が取り込みの失敗を言っていれば、その理由 */
  failed(): string | undefined;
  /** 終わった子の理由。stderr の最後の 3 行を足す */
  died(what: string): Promise<string>;
  /** didOpen。同じファイルは 1 回だけ。ファイルが無ければ開かずに false（PR で消したファイルは head に無い） */
  open(abs: string): boolean;
  /** 開いたファイルを全部 didClose する。開いたままだと、次の PR でも開いたときの中身を使われる */
  closeAll(): void;
  /** shutdown → exit → プロセスグループごと殺す */
  close(): Promise<void>;
}

export interface StartLspArgs extends RunLspArgs {
  /**
   * サーバーに渡す workspaceFolders（既定は roots の head と base）。保存したプロジェクト構造で起動するときは、
   * workspace.json だけを置いたフォルダを渡す（lsp-model.ts。開くファイルと問い合わせは roots のまま）。最初のものが rootUri と cwd
   */
  folders?: readonly string[];
  /**
   * どこまで待つか。既定は $/progress が全部止まるまで（settled）。imported は取り込みの成功を言われた時点で返す
   * （プロジェクト構造の書き出しは索引を待たない。2026-10-19 実測）。imported のときは基準シンボルが無くてもよい
   */
  until?: 'settled' | 'imported';
  /** initialize の応答にこの命令が無ければ、待たずに閉じて missingCommand を返す */
  requireCommand?: string;
  /** Ctrl-C / kill で子をグループごと殺してから自分も終わる（既定 true）。serve は自分の終わり方で close() するので false */
  handleSignals?: boolean;
  /** 中断（serve の終了）。起動の途中でも子をグループごと殺す */
  signal?: AbortSignal;
}

/** 起動できなかった。importFailed は独自通知が取り込みの失敗を言ったとき、missingCommand は requireCommand が無かったとき */
export interface LspStartFailure {
  run: LspRun;
  importFailed?: true;
  missingCommand?: string;
}

export async function startLspSession(a: StartLspArgs): Promise<{ session: LspSession } | LspStartFailure> {
  const args = resolveLspArgs(a.args, a.cacheDir);
  const command = [a.command, ...args].join(' ');
  const unavailable = (reason: string): { run: LspRun } => ({ run: { command, status: 'unavailable', reason } });
  const folders = a.folders ?? [a.roots.head, a.roots.base];

  if (a.targets.length === 0 && a.until !== 'imported') return unavailable('基準シンボル（変更された宣言）がありません');

  mkdirSync(a.cacheDir, { recursive: true });
  const child = spawn(a.command, args, {
    cwd: folders[0] ?? a.roots.head,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, ...a.env },
  });

  const killGroup = (): void => {
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  };
  // Ctrl-C / kill: LSP をグループごと殺したうえで、同じシグナルを自分に送り直して Node の既定どおり終わる（llm.ts と同じ）
  const onSignal = (sig: NodeJS.Signals): void => {
    killGroup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.kill(process.pid, sig);
  };
  const handleSignals = a.handleSignals ?? true;
  if (handleSignals) {
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }
  a.signal?.addEventListener('abort', killGroup, { once: true });

  let spawnError: string | undefined;
  let exited = false;
  /** 準備が済んでセッションを返したか。返したあとに死んだら、待っている問い合わせを打ち切る（返らないまま止まらないように） */
  let established = false;
  child.on('error', (e) => (spawnError = e.message));
  // 読まないと詰まる。kotlin-lsp.sh の非推奨警告や、期限切れの知らせ（試用版は約 30 日で起動しなくなる）が流れてくる。
  // 途中で終わったときの理由に足すので、最後の 4 KB だけ持っておく
  let stderr = '';
  let stderrEnded = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c: string) => (stderr = (stderr + c).slice(-4096)));
  child.stderr.on('end', () => (stderrEnded = true));
  /** 終わった子の stderr の最後の 3 行（空行を除く）。読み切るまで少しだけ待つ */
  const died = async (what: string): Promise<string> => {
    for (let i = 0; i < 10 && !stderrEnded; i++) await sleep(50);
    const tail = stderr.split('\n').map((l) => l.trim()).filter((l) => l !== '').slice(-3).join(' / ').slice(0, 300);
    return tail === '' ? what : `${what}: ${tail}`;
  };
  child.stdin.on('error', () => undefined); // 先に死んだ子への書き込み（EPIPE）で落とさない

  const client = createLspClient({
    write: (chunk) => child.stdin.write(chunk),
    onData: (cb) => child.stdout.on('data', cb),
  });
  child.on('exit', () => {
    exited = true;
    if (established) client.dispose('LSP が途中で終了しました');
  });
  const watcher = createReadyWatcher(a.rule);
  /** 最後に待ちの知らせ（$/progress と取り込みの記録）が来たか、サーバーのログが伸びた時刻 */
  let lastNoticeAt = Date.now();
  /** サーバーが initialize の直後に window/logMessage で言うログの場所（kotlin-lsp の「Log file: …」） */
  let serverLogFile: string | undefined;
  let serverLogSize = -1;
  let serverLog: string | undefined;
  client.onNotification((method, params) => {
    if (watcher.observe(method, params)) lastNoticeAt = Date.now();
    if (method === 'window/logMessage' && typeof params === 'object' && params !== null) {
      const m = (params as Record<string, unknown>)['message'];
      const file = typeof m === 'string' ? /^Log file: (.+)$/m.exec(m)?.[1]?.trim() : undefined;
      if (file !== undefined && file !== '') serverLogFile = file;
    }
  });
  /** サーバーのログが伸びていれば、動いている印にして最後の進みを読み直す */
  const watchServerLog = (now: number): void => {
    if (serverLogFile === undefined) return;
    const read = readTail(serverLogFile);
    if (read === undefined || read.size === serverLogSize) return;
    if (serverLogSize >= 0) lastNoticeAt = now;
    serverLogSize = read.size;
    serverLog = lastServerLogLine(read.tail) ?? serverLog;
  };
  const pending = (): Pending => ({ ...watcher.pending(), ...(serverLog === undefined ? {} : { serverLog }) });
  /** 時間切れの理由。終わっていない作業と最後の取り込みの記録を足す（Gradle が止まったのか、索引が遅いのかが分かるように） */
  const timedOut = (what: string): string => {
    const doing = describePending(pending());
    return `準備完了まで待ちましたが時間切れです（${what}）${doing === '' ? '' : `。${doing}`}`;
  };

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await Promise.race([client.request('shutdown'), sleep(1000)]);
      client.notify('exit');
    } catch {
      // 応答が無くても構わない。下で殺す
    }
    client.dispose('終了しました');
    await sleep(100);
    killGroup();
    if (handleSignals) {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
    a.signal?.removeEventListener('abort', killGroup);
  };
  const finish = async <T extends LspStartFailure>(out: T): Promise<T> => {
    await close();
    return out;
  };

  try {
    // initialize の応答を待つ。コマンドが無い・起動してすぐ死んだ場合は時間切れまで待たずに戻る
    // （待つと、コマンド名の打ち間違いで 60 秒黙ることになる）
    let initialized = false;
    let initError: Error | undefined;
    // legend はサーバが返すものを使う（クライアントが送った legend は無視される。設計書 9.1）
    let legend: SemanticLegend = { tokenTypes: [], tokenModifiers: [] };
    let commands: readonly string[] = [];
    const init = client
      .request<{ capabilities?: { semanticTokensProvider?: { legend?: SemanticLegend }; executeCommandProvider?: { commands?: unknown } } }>('initialize', initializeParams(folders))
      .then((res) => {
        legend = res?.capabilities?.semanticTokensProvider?.legend ?? legend;
        const listed = res?.capabilities?.executeCommandProvider?.commands;
        commands = Array.isArray(listed) ? listed.filter((c): c is string => typeof c === 'string') : [];
        initialized = true;
      })
      .catch((e: unknown) => {
        initError = e instanceof Error ? e : new Error(String(e));
      });
    const initDeadline = Date.now() + Math.min(INITIALIZE_TIMEOUT_MS, a.readyTimeoutSec * 1000);
    for (;;) {
      await Promise.race([init, sleep(POLL_MS)]);
      if (initialized) break;
      if (initError !== undefined) return await finish(unavailable(initError.message));
      if (spawnError !== undefined) return await finish(unavailable(`LSP コマンドを起動できません: ${spawnError}`));
      if (exited) return await finish(unavailable(await died('LSP が起動してすぐ終了しました')));
      if (Date.now() > initDeadline) return await finish(unavailable(`initialize の応答を待ちましたが時間切れです（${a.readyTimeoutSec} 秒）`));
    }

    if (a.requireCommand !== undefined && !commands.includes(a.requireCommand)) {
      return await finish({ ...unavailable(`言語サーバーに ${a.requireCommand} がありません`), missingCommand: a.requireCommand });
    }

    const startedAt = Date.now();
    const deadline = startedAt + (a.readyCapSec ?? LSP_READY_CAP_SEC) * 1000;
    lastNoticeAt = Math.max(lastNoticeAt, startedAt);
    client.notify('initialized', {});
    // 準備完了を待つ前に全部開く（実測がその順。開いたファイルから先にインデックスが進む）
    const opened = new Set<string>();
    const open = (abs: string): boolean => {
      if (opened.has(abs)) return true;
      if (!existsSync(abs)) return false;
      opened.add(abs);
      client.notify('textDocument/didOpen', {
        textDocument: { uri: pathToFileURL(abs).href, languageId: 'kotlin', version: 1, text: readFileSync(abs, 'utf8') },
      });
      return true;
    };
    for (const t of a.targets) open(path.join(a.roots.head, t.path));
    for (const abs of a.openFiles) open(abs);

    // 1 と 2: $/progress が止まるまで待つ。途中で failed を言われたら打ち切る
    const reportEvery = a.waitReportMs ?? LSP_WAIT_REPORT_MS;
    let nextReport = startedAt + reportEvery;
    let nextLogCheck = startedAt;
    for (;;) {
      if (exited) return await finish(unavailable(await died('LSP が途中で終了しました')));
      const now = Date.now();
      if (now >= nextLogCheck) {
        watchServerLog(now);
        nextLogCheck = now + SERVER_LOG_POLL_MS;
      }
      // 打ち切る前に、サーバーのログが伸びていないかをもう一度見る
      if (now - lastNoticeAt > a.readyTimeoutSec * 1000) watchServerLog(now);
      if (now - lastNoticeAt > a.readyTimeoutSec * 1000) return await finish(unavailable(timedOut(`${formatDuration(a.readyTimeoutSec * 1000)}間、新しい通知がありません`)));
      if (now > deadline) return await finish(unavailable(timedOut(formatDuration(deadline - startedAt))));
      const s = watcher.state(now - startedAt);
      if (s.phase === 'failed') return await finish({ ...unavailable(s.reason), importFailed: true });
      if (s.phase === 'settled' || (a.until === 'imported' && watcher.imported())) break;
      if (a.onWaiting !== undefined && now >= nextReport) {
        a.onWaiting({ elapsedMs: now - startedAt, pending: pending() });
        // 足し込まずに今から数える（止まっていた後に続けて何度も呼ばないように）
        nextReport = now + reportEvery;
      }
      await sleep(POLL_MS);
    }

    const state = () => watcher.state(Date.now() - startedAt);
    const session: LspSession = {
      command,
      client,
      legend,
      startedAt,
      commands,
      alive: () => !exited && !closed,
      settled: () => state().phase === 'settled',
      failed: () => {
        const s = state();
        return s.phase === 'failed' ? s.reason : undefined;
      },
      died,
      open,
      closeAll: () => {
        for (const abs of opened) client.notify('textDocument/didClose', { textDocument: { uri: pathToFileURL(abs).href } });
        opened.clear();
      },
      close,
    };
    established = true;
    return { session };
  } catch (e) {
    return await finish(unavailable(e instanceof Error ? e.message : String(e)));
  }
}

/**
 * 3 段目: 基準シンボルに辺が 1 本でも取れるまで打ち直す（deadline まで）。打てる関数が無ければ確かめずに ready。
 * settled を付けると、開いている $/progress が 0 になるまでも待つ（起動したまま中身を切り替えたあと。索引が後から始まることがある）
 */
export async function probeSession(
  s: LspSession,
  root: string,
  targets: readonly ProbeTarget[],
  o: { deadline: number; intervalMs: number; settled?: boolean },
): Promise<'ready' | { reason: string; dead?: true }> {
  const start = Date.now();
  for (;;) {
    if (!s.alive()) return { reason: await s.died('LSP が途中で終了しました'), dead: true };
    const failed = s.failed();
    if (failed !== undefined) return { reason: failed };
    let outcome: ProbeOutcome;
    try {
      outcome = await probeEdges(s.client, root, targets);
    } catch (e) {
      if (!s.alive()) return { reason: await s.died('LSP が途中で終了しました'), dead: true };
      throw e;
    }
    if ((outcome === 'edge' || outcome === 'nothing-to-probe') && (o.settled !== true || s.settled())) return 'ready';
    if (Date.now() + o.intervalMs > o.deadline) {
      const waited = Math.round((o.deadline - start) / 1000);
      return { reason: `基準シンボルの呼び出し関係を ${waited} 秒待っても取得できませんでした` };
    }
    await sleep(o.intervalMs);
  }
}

/**
 * 1 回ごとに起動して、準備完了したら work を呼び、閉じる。analyze は使わない（serve が持つ場合も自分で起動する場合も lsp-session.ts）。
 * 3 段構えの振る舞い（時間切れ・失敗・途中で死んだときの理由）をテスト（lsp.test.ts）で固定する入口として残している
 */
export async function runLsp<T = never>(a: RunLspArgs, work?: LspWork<T>): Promise<{ run: LspRun; result?: T }> {
  const started = await startLspSession(a);
  if ('run' in started) return started;
  const s = started.session;
  const unavailable = (reason: string, waitedMs?: number): { run: LspRun } => ({ run: { command: s.command, status: 'unavailable', reason, ...(waitedMs === undefined ? {} : { waitedMs }) } });
  try {
    // $/progress が止まった時点でインデックスは終わっているので、ここで何十秒も粘っても変わらない
    const probeStart = Date.now();
    const deadline = Math.min(s.startedAt + (a.readyCapSec ?? LSP_READY_CAP_SEC) * 1000, probeStart + LSP_PROBE_BUDGET_MS, probeStart + a.readyTimeoutSec * 1000);
    const probed = await probeSession(s, a.roots.head, a.targets, { deadline, intervalMs: LSP_PROBE_INTERVAL_MS });
    if (probed !== 'ready') return unavailable(probed.reason);
    const waitedMs = Date.now() - s.startedAt;
    if (work === undefined) return { run: { command: s.command, status: 'ok', waitedMs } };
    try {
      return { run: { command: s.command, status: 'ok', waitedMs }, result: await work(s.client, s.legend) };
    } catch (e) {
      // 準備完了はしていたが取り出しに失敗した。解析は止めず、事実として残す（9.5）
      return unavailable(e instanceof Error ? e.message : String(e), waitedMs);
    }
  } catch (e) {
    return unavailable(e instanceof Error ? e.message : String(e));
  } finally {
    await s.close();
  }
}

/**
 * edge             = 辺が 1 本取れた（準備完了）
 * no-edge          = まだ取れない（インデックスの途中かもしれないので待ち直す）
 * nothing-to-probe = 宣言一覧は返ってきているのに、基準シンボルに呼べる関数が 1 つも無い（データクラス・定数・消した宣言）。
 *                    documentSymbol は構文だけで答えられるので、待っても変わらない。言語サーバーの具合とは関係ないので、使えなくはしない
 */
export type ProbeOutcome = 'edge' | 'no-edge' | 'nothing-to-probe';

export async function probeEdges(client: LspClient, cwd: string, targets: readonly ProbeTarget[]): Promise<ProbeOutcome> {
  let anySymbols = false;
  let anyLocated = false;
  for (const t of targets) {
    const uri = pathToFileURL(path.join(cwd, t.path)).href;
    const symbols = await client.request<DocumentSymbol[] | null>('textDocument/documentSymbol', { textDocument: { uri } });
    if ((symbols ?? []).length > 0) anySymbols = true;
    const position = findProbePosition(symbols ?? [], t.name);
    if (position === undefined) continue;
    anyLocated = true;
    const items = await client.request<unknown[] | null>('textDocument/prepareCallHierarchy', { textDocument: { uri }, position });
    const item = items?.[0];
    if (item === undefined) continue;
    const out = await client.request<unknown[] | null>('callHierarchy/outgoingCalls', { item });
    if ((out ?? []).length > 0) return 'edge';
    const inc = await client.request<unknown[] | null>('callHierarchy/incomingCalls', { item });
    if ((inc ?? []).length > 0) return 'edge';
  }
  return anySymbols && !anyLocated ? 'nothing-to-probe' : 'no-edge';
}

/**
 * 9.2 で使うメソッドの分だけ能力を申告する。
 * semanticTokens の legend は空で送る（サーバが自分の legend を応答で返し、こちらが送ったものは無視される）。
 */
function initializeParams(folders: readonly string[]): Record<string, unknown> {
  const rootUri = folders[0] === undefined ? null : pathToFileURL(folders[0]).href;
  const folder = (dir: string) => ({ uri: pathToFileURL(dir).href, name: path.basename(dir) });
  return {
    processId: process.pid,
    rootUri,
    workspaceFolders: folders.map(folder),
    clientInfo: { name: 'ondina', version: '0.0.0' },
    capabilities: {
      window: { workDoneProgress: true },
      workspace: { workspaceFolders: true, configuration: true, didChangeWatchedFiles: { dynamicRegistration: true } },
      textDocument: {
        synchronization: { dynamicRegistration: false, didSave: false },
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        callHierarchy: { dynamicRegistration: false },
        definition: { linkSupport: true },
        references: {},
        semanticTokens: { requests: { full: true, range: true }, tokenTypes: [], tokenModifiers: [], formats: ['relative'] },
      },
    },
  };
}
