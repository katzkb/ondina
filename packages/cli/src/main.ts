// コマンドの入口。引数を解釈して analyze / serve / list / comments（add / wait） / token / update / completion を呼ぶ。プロセスの入出力は io で差し替えられる（テスト用）。
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeLocal, analyzePr, type AnalyzeOptions } from './analyze.js';
import { type BackgroundDeps, defaultBackgroundDeps, serveInBackground } from './background.js';
import { zshCompletion } from './completion.js';
import { git } from './git.js';
import { KEYCHAIN_SERVICE, type KeychainRead, readKeychain, readSecret, writeKeychain } from './keychain.js';
import { runScript, selfCommit, selfRoot, versionLine } from './self.js';
import { readConfigFile } from './config.js';
import { resolveLlmCommand } from './llm.js';
import { startServer } from './serve.js';
import { defaultServersDeps, findServes, formatServes, isOutdated, type RunningServe, type ServersDeps, stopServe, type StopResult } from './servers.js';
import { addComments, isCommentsInput, listAnalyses, markWaiting, readUi, takeReturned } from './store.js';
import { inferStructure, readStructure, STRUCTURE_FILE } from './structure.js';
import { TICKET_TOKEN_ENV } from './ticket.js';

export interface Io {
  cwd: string;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** 標準入力を全部読む（`comments add --from -`） */
  stdin?: () => string;
  /** 自分の clone の最上位（`--version` / `update`）。既定は self.ts の selfRoot() */
  selfRoot?: string;
  /** `update` が scripts/install.sh を走らせる関数。既定は self.ts の runScript（入出力をそのまま繋ぐ） */
  runScript?: (file: string, args: string[]) => number;
  /** `token` が使うキーチェーンと入力。既定は keychain.ts と process */
  keychain?: Partial<TokenDeps>;
  /** `serve --background` の切り離しと確かめ。既定は background.ts */
  background?: Partial<BackgroundDeps>;
  /** `serve list / stop / restart` の探し方と止め方。既定は servers.ts */
  servers?: Partial<ServersDeps>;
  /** テスト用。`comments wait` が受け箱を見る間隔（既定 1 秒） */
  pollMs?: number;
}

export interface TokenDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** キーチェーンの項目のアカウント（ログイン名） */
  account: string;
  readSecret: (prompt: string) => Promise<string | undefined>;
  write: (service: string, account: string, secret: string) => Promise<string | undefined>;
  read: (service: string) => Promise<KeychainRead | undefined>;
}

// eslint-disable-next-line ondina/wording-endings -- コマンドとオプションの説明は「〜する」の形が決まり
export const usage = `ondina — 大きな PR を読むためのレビュー支援ツール

使い方:
  ondina analyze <pr>                    gh で PR を取得して解析し、.ondina/<pr>/<headSha>.json に書き出す
  ondina analyze --base <ref> [--head <ref>]
                                         ローカルの 2 つの ref を解析する（gh 不要）。.ondina/local/<headSha>.json に書き出す。
                                         --head を付けなければ、今のブランチのコミットと、コミットしていない変更を合わせて
                                         解析する（AI が作った PR 前の変更を見せる）。コミットは作らない
      --worktree-root <dir>              言語サーバー用の base / head の worktree を置く親ディレクトリ（<dir>/lsp に作る。既定は .ondina/lsp。
                                         UI の設定 .ondina/ui.json にも保存できる）
      --no-llm                           LLM で目的ごとに分けない（How 分解をしない）
      --relabel                          保存した LLM 出力（.ondina/<pr>/llm/）を使わず LLM を呼び直す
      --body <file>                      作者の説明（PR 本文）。--base / --head のときだけ。PR 番号のときは gh から取得する
      --title <題>                       題。--base / --head のときだけ（既定は <base>..<head>）
      --no-lsp                           言語サーバー（LSP）を起動しない。既定は起動して関連の線と意味の色分けを取得する
                                         （PR ごとの初回は 1 分ほど延びる）
      --ticket <値>                      チケットの番号（SHOP-421）・URL・ファイル。説明の画面の「仕様」に表示する。取得方法は UI の設定
                                         （付けなければ PR の題・ブランチ名・本文から LLM が探す）
  ondina serve [--port <n>] [<pr>]       ローカル UI を起動する（既定 4177）。.ondina/ 配下の解析を全部表示する
      --background                       バックグラウンドで起動し、URL を表示してすぐ戻る（AI エージェント向け。ログは .ondina/serve.log）。
                                         このリポジトリの serve が動いていればそれを使い、ポートがほかで使われていれば空いているポートで起動する
  ondina serve list                      動いている serve を一覧表示する（ポート・pid・起動した時刻・バージョン・フォルダ）。どのフォルダで
                                         実行してもよい。ondina update の前から動いている serve には「更新前」と出す
  ondina serve stop <ポート>... | --all  serve を止める（--all は全部）
  ondina serve restart <ポート>... | --all
                                         serve を止めて、同じフォルダ・同じポートで今のバージョンをバックグラウンドで起動し直す
  ondina structure [<ref>]               リポジトリ全体の構成（層）を LLM で推定し直し、.ondina/structure.json を上書きする
                                         （既定 HEAD）。初回の analyze が自動で推定するので、分類できないファイルが増えたときに使う
  ondina list                            解析済みを新しい順に 1 行ずつ表示する（<key> <headSha> <baseSha> <題> をタブ区切り）
  ondina comments add --from <file|->    AI エージェントのコメント JSON を下書きとして受け取る
  ondina comments wait                   レビュアーが締めの画面の「AI に返す」で返したコメントを待ち、届いたら JSON で表示して
                                         終わる（local の解析だけ。届いているものがあればすぐ表示する。AI エージェント向け）
  ondina token                           Jira のトークンを Mac のキーチェーン（ondina-jira）に保存する。貼り付けて Enter（画面には表示しない）
                                         保存し直すときも同じ。pbpaste | ondina token でもよい
  ondina update [<バージョン>]           この clone を main の最新（または <バージョン>）にしてビルドし直す（scripts/install.sh）
                                         kotlin-lsp も最新にする（scripts/install-kotlin-lsp.sh）
  ondina --version                       インストールされているバージョン（コミットと日付）を表示する
  ondina completion zsh                  Tab 補完のスクリプトを出力する（install.sh が ~/.zsh_functions/_ondina に置く）

対象リポジトリはカレントディレクトリ。base / head の中身は git から読む（PR ごとの worktree は作らない）。言語サーバー用の worktree は 1 組だけ作り、PR をまたいで使い回す。
設定はリポジトリ直下の ondina.config.yaml（なければ既定値で動く）。layers を書かなければ、層は構成の推定から付く。
LLM コマンドは UI の設定 > 環境変数 ONDINA_LLM_COMMAND > yaml の llm.command > 既定（claude -p …）。
sh -c で起動し、stdin にプロンプト、stdout に JSON を返すコマンドなら何でもよい（Claude に限らない）。
LSP コマンドは 環境変数 ONDINA_LSP_COMMAND > yaml の lsp.<language>.command > kotlin-lsp の置き場（~/.local/share/kotlin-lsp/current）。実行ファイルのパスを 1 本で指定する。
`;

export async function run(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    io.stdout(usage);
    return 0;
  }
  if (command === 'analyze') return analyze(rest, io);
  if (command === 'serve') return serve(rest, io);
  if (command === 'list') return list(rest, io);
  if (command === 'comments') return comments(rest, io);
  if (command === 'structure') return structure(rest, io);
  if (command === 'token') return token(rest, io);
  if (command === '--version' || command === '-v') {
    io.stdout(`${versionLine(io.selfRoot ?? selfRoot())}\n`);
    return 0;
  }
  if (command === 'update') return update(rest, io);
  if (command === 'completion') return completion(rest, io);
  io.stderr(`ondina: '${command}' というコマンドはありません\n\n${usage}`);
  return 1;
}

function repoRoot(io: Io, cmd: string): string | undefined {
  try {
    return git(io.cwd, 'rev-parse', '--show-toplevel');
  } catch {
    io.stderr(`ondina ${cmd}: ${io.cwd} は git リポジトリではありません\n`);
    return undefined;
  }
}

async function analyze(args: string[], io: Io): Promise<number> {
  const parsed = parseAnalyzeArgs(args);
  if ('error' in parsed) {
    io.stderr(`ondina analyze: ${parsed.error}\n\n${usage}`);
    return 1;
  }
  const repo = repoRoot(io, 'analyze');
  if (!repo) return 1;
  try {
    // 設計書 3.8: worktree の置き場所は引数 > UI の設定（.ondina/ui.json） > 既定
    const ui = readUi(repo);
    const worktreeRoot = parsed.worktreeRoot ?? ui.worktreeRoot;
    const opts: AnalyzeOptions = {
      ...(worktreeRoot === undefined ? {} : { worktreeRoot }),
      ...(ui.llmCommand === undefined ? {} : { llmCommand: ui.llmCommand }),
      llm: parsed.llm,
      lsp: parsed.lsp,
      progress: (line) => io.stderr(`ondina analyze: ${line}\n`),
      ...(parsed.mode === 'local' && parsed.bodyFile !== undefined ? { body: readBody(parsed.bodyFile, io.cwd) } : {}),
      ...(parsed.mode === 'local' && parsed.title !== undefined ? { title: parsed.title } : {}),
      // チケット（5.1）の取り方は UI の設定（.ondina/ui.json の ticket）。ファイルの値は打った場所から。
      // --ticket が無ければ題・ブランチ名・本文から探し（10.7）、見つけたものを同じ取り方で取る
      ticket: { ...(parsed.ticket === undefined ? {} : { ref: parsed.ticket }), cwd: io.cwd, ...(ui.ticket === undefined ? {} : { settings: ui.ticket }) },
    };
    const result = parsed.mode === 'pr' ? await analyzePr(repo, parsed.number, opts) : await analyzeLocal(repo, parsed.base, parsed.head, opts);
    for (const w of result.warnings) io.stderr(`ondina analyze: ${w}\n`);
    for (const i of result.info) io.stderr(`ondina analyze: ${i}\n`);
    io.stdout(result.cachePath + '\n');
    return 0;
  } catch (e) {
    io.stderr(`ondina analyze: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

/** local の head が無い = 作業ツリー（コミットしていない変更を含む。5.1） */
type AnalyzeArgs = ({ mode: 'pr'; number: number } | { mode: 'local'; base: string; head?: string; bodyFile?: string; title?: string }) & { worktreeRoot?: string; llm: 'auto' | 'off' | 'relabel'; lsp: boolean; ticket?: string };

export function parseAnalyzeArgs(args: string[]): AnalyzeArgs | { error: string } {
  const positional: string[] = [];
  let base: string | undefined;
  let head: string | undefined;
  let worktreeRoot: string | undefined;
  let bodyFile: string | undefined;
  let title: string | undefined;
  let ticket: string | undefined;
  let noLlm = false;
  let relabel = false;
  let lspOn = false;
  let lspOff = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--base' || a === '--head' || a === '--worktree-root' || a === '--body' || a === '--title' || a === '--ticket') {
      const v = args[++i];
      if (v === undefined) return { error: `${a} には値を指定してください` };
      if (a === '--base') base = v;
      else if (a === '--head') head = v;
      else if (a === '--body') bodyFile = v;
      else if (a === '--title') title = v;
      else if (a === '--ticket') ticket = v;
      else worktreeRoot = v;
    } else if (a === '--no-llm') {
      noLlm = true;
    } else if (a === '--relabel') {
      relabel = true;
    } else if (a === '--lsp') {
      lspOn = true;
    } else if (a === '--no-lsp') {
      lspOff = true;
    } else if (a.startsWith('--')) {
      return { error: `'${a}' というオプションはありません` };
    } else {
      positional.push(a);
    }
  }
  if (noLlm && relabel) return { error: '--no-llm と --relabel は同時に指定できません' };
  if (lspOn && lspOff) return { error: '--lsp と --no-lsp は同時に指定できません' };
  const extra = { ...(worktreeRoot === undefined ? {} : { worktreeRoot }), llm: noLlm ? ('off' as const) : relabel ? ('relabel' as const) : ('auto' as const), lsp: !lspOff, ...(ticket === undefined ? {} : { ticket }) };
  if (base !== undefined || head !== undefined) {
    if (positional.length > 0) return { error: 'PR 番号と --base / --head は同時に指定できません' };
    if (base === undefined) return { error: '--head と組で --base を指定してください' };
    return { mode: 'local', base, ...(head === undefined ? {} : { head }), ...extra, ...(title === undefined ? {} : { title }), ...(bodyFile === undefined ? {} : { bodyFile }) };
  }
  if (bodyFile !== undefined) return { error: '--body は --base / --head のときだけ指定できます（PR 番号のときは gh から取ります）' };
  if (title !== undefined) return { error: '--title は --base / --head のときだけ指定できます（PR 番号のときは gh から取ります）' };
  if (positional.length !== 1) return { error: 'PR 番号か --base <ref> --head <ref> を指定してください' };
  const number = Number(positional[0]);
  if (!Number.isInteger(number) || number <= 0) return { error: `'${positional[0]}' は PR 番号ではありません` };
  return { mode: 'pr', number, ...extra };
}

/** --body <file> を読む。無ければ Error（analyze の catch で exit 1） */
function readBody(file: string, cwd: string): string {
  const abs = path.resolve(cwd, file);
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    throw new Error(`--body のファイルが読めません: ${abs}`);
  }
}

export const DEFAULT_PORT = 4177;

export type ServeArgs = { port: number; initialKey?: string; background?: true } | { error: string };

export function parseServeArgs(args: string[]): ServeArgs {
  let port = DEFAULT_PORT;
  let initialKey: string | undefined;
  let background = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--background') {
      background = true;
    } else if (a === '--port') {
      const v = args[++i];
      const n = Number(v);
      if (v === undefined || !Number.isInteger(n) || n < 0 || n > 65535) return { error: `--port にはポート番号を指定してください（'${v ?? ''}'）` };
      port = n;
    } else if (a.startsWith('--')) {
      return { error: `'${a}' というオプションはありません` };
    } else if (initialKey === undefined) {
      initialKey = a;
    } else {
      return { error: `引数が多すぎます: '${a}'` };
    }
  }
  return { port, ...(initialKey === undefined ? {} : { initialKey }), ...(background ? { background: true as const } : {}) };
}

async function serve(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'list') return serveList(rest, io);
  if (sub === 'stop' || sub === 'restart') return serveStop(sub, rest, io);
  const parsed = parseServeArgs(args);
  if ('error' in parsed) {
    io.stderr(`ondina serve: ${parsed.error}\n\n${usage}`);
    return 1;
  }
  const repo = repoRoot(io, 'serve');
  if (!repo) return 1;
  if (parsed.background) return serveBackground(repo, parsed.port, parsed.initialKey, io);
  try {
    const version = selfCommit(io.selfRoot ?? selfRoot());
    const running = await startServer({ repo, port: parsed.port, ...(version === undefined ? {} : { version }) });
    const url = parsed.initialKey === undefined ? running.url : `${running.url}?pr=${encodeURIComponent(parsed.initialKey)}`;
    io.stdout(`ondina serve: ${url}\n`);
    await new Promise<void>((resolve) => {
      const stop = () => {
        void running.close().finally(resolve);
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
    return 0;
  } catch (e) {
    io.stderr(`ondina serve: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

// 切り離して起動する（12 章）。URL は前で起動したときと同じ 1 行を標準出力に、どうしたかは標準エラーに
async function serveBackground(repo: string, port: number, key: string | undefined, io: Io): Promise<number> {
  const r = await serveInBackground(repo, port, key, { ...defaultBackgroundDeps(), ...io.background });
  if (r.status === 'failed') {
    io.stderr(`ondina serve: バックグラウンドで起動できませんでした: ${r.reason}\n`);
    return 1;
  }
  if (r.status === 'reused') {
    io.stderr(`ondina serve: このリポジトリの serve が動いています（pid ${r.pid}）。新しく起動せず、それを使います\n`);
  } else {
    if (r.sameRepo) {
      io.stderr(`ondina serve: ${r.movedFrom} 番は同じリポジトリの別の worktree（${r.occupiedBy}）の serve が使っています。PR のない変更はその画面に表示できないので、空いているポートで起動しました\n`);
    } else if (r.movedFrom !== undefined) {
      const by = r.occupiedBy === undefined ? '別のもの' : `別のリポジトリの serve（${r.occupiedBy}）`;
      io.stderr(`ondina serve: ${r.movedFrom} 番は${by}が使っています。空いているポートで起動しました\n`);
    }
    io.stderr(`ondina serve: バックグラウンドで起動しました（pid ${r.pid}。ログは ${r.log}）。止めるときは ondina serve stop ${new URL(r.url).port} を実行してください\n`);
  }
  io.stdout(`ondina serve: ${r.url}\n`);
  return 0;
}

/** 動いている serve を探す。lsof が無いなどで探せなければ理由を出して undefined */
async function runningServes(cmd: string, d: ServersDeps, io: Io): Promise<RunningServe[] | undefined> {
  try {
    return await findServes(d);
  } catch (e) {
    io.stderr(`ondina serve ${cmd}: ${e instanceof Error ? e.message : String(e)}\n`);
    return undefined;
  }
}

// 今インストールされている ondina のコミット（serve list の「更新前」の基準）
const installedCommit = (io: Io): string | undefined => selfCommit(io.selfRoot ?? selfRoot());

// 動いている serve の一覧（12 章）。どのフォルダで実行してもよい
async function serveList(args: string[], io: Io): Promise<number> {
  if (args.length > 0) {
    io.stderr(`ondina serve list: 引数は指定できません\n\n${usage}`);
    return 1;
  }
  const found = await runningServes('list', { ...defaultServersDeps(), ...io.servers }, io);
  if (found === undefined) return 1;
  if (found.length === 0) {
    io.stderr('ondina serve list: 動いている serve はありません\n');
    return 0;
  }
  const installed = installedCommit(io);
  io.stdout(formatServes(found, installed, os.homedir()));
  const outdated = found.filter((s) => isOutdated(s, installed)).map((s) => s.port);
  if (outdated.length > 0) {
    const now = installed === undefined ? '今のバージョン' : `今のバージョン（${installed}）`;
    io.stderr(`ondina serve list: 更新前の serve は古いコードのまま動いています。${now}で起動し直すには ondina serve restart ${outdated.join(' ')} を実行してください\n`);
  }
  return 0;
}

export type ServeTargets = { all: true } | { ports: number[] } | { error: string };

export function parseServeTargets(args: string[]): ServeTargets {
  const ports: number[] = [];
  let all = false;
  for (const a of args) {
    if (a === '--all') all = true;
    else if (a.startsWith('-')) return { error: `'${a}' というオプションはありません` };
    else if (/^\d+$/.test(a) && Number(a) >= 1 && Number(a) <= 65535) ports.push(Number(a));
    else return { error: `'${a}' はポート番号ではありません` };
  }
  if (all && ports.length > 0) return { error: 'ポートと --all は同時に指定できません' };
  if (all) return { all: true };
  if (ports.length === 0) return { error: 'serve のポートか --all を指定してください' };
  return { ports };
}

/** 止めた結果を出す。止まったら true */
function reportStop(cmd: string, s: RunningServe, r: StopResult, out: (line: string) => void, io: Io): boolean {
  if (r.status === 'stopped') {
    out(`${s.port} 番の serve を止めました（pid ${s.pid}、${s.folder}）\n`);
    return true;
  }
  if (r.status === 'stuck') io.stderr(`ondina serve ${cmd}: ${s.port} 番の serve（pid ${s.pid}）が 10 秒たっても止まりません。kill -9 ${s.pid} を実行してください\n`);
  else io.stderr(`ondina serve ${cmd}: ${s.port} 番の serve（pid ${s.pid}）を止められませんでした: ${r.reason}\n`);
  return false;
}

// serve を止める・起動し直す（12 章）。ポートが 1 つでも違えば、どれも止めない
async function serveStop(cmd: 'stop' | 'restart', args: string[], io: Io): Promise<number> {
  const d = { ...defaultServersDeps(), ...io.servers };
  const targets = parseServeTargets(args);
  const found = await runningServes(cmd, d, io);
  if (found === undefined) return 1;
  const missing = 'ports' in targets ? targets.ports.filter((p) => !found.some((s) => s.port === p)) : [];
  if ('error' in targets || missing.length > 0) {
    const why = 'error' in targets ? [targets.error] : missing.map((p) => `${p} 番で動いている serve はありません`);
    const list = found.length === 0 ? '動いている serve はありません\n' : formatServes(found, installedCommit(io), os.homedir());
    io.stderr(`${why.map((w) => `ondina serve ${cmd}: ${w}\n`).join('')}\n${list}`);
    return 1;
  }
  const chosen = 'all' in targets ? found : found.filter((s) => targets.ports.includes(s.port));
  if (chosen.length === 0) {
    io.stderr(`ondina serve ${cmd}: 動いている serve はありません\n`);
    return 0;
  }
  if (cmd === 'stop') {
    const results = await Promise.all(chosen.map((s) => stopServe(s, d)));
    return chosen.map((s, i) => reportStop(cmd, s, results[i]!, io.stdout, io)).every(Boolean) ? 0 : 1;
  }
  // 同じフォルダの serve はログ（.ondina/serve.log）を共にするので、1 つずつ起動し直す
  let code = 0;
  for (const s of chosen) {
    // 消えた worktree の serve を起動し直すと、フォルダを作り直してしまう
    if (!existsSync(s.folder)) {
      io.stderr(`ondina serve restart: ${s.port} 番の serve のフォルダ（${s.folder}）がもうありません。起動し直せないので、止めるときは ondina serve stop ${s.port} を実行してください\n`);
      code = 1;
      continue;
    }
    if (!reportStop(cmd, s, await stopServe(s, d), (l) => io.stderr(`ondina serve restart: ${l}`), io) || (await serveBackground(s.folder, s.port, undefined, io)) !== 0) code = 1;
  }
  return code;
}

// 解析済みの一覧（12 章）。AI エージェントがコメントを付ける版（headSha）と差分の基点（baseSha）を知るため
function list(args: string[], io: Io): number {
  if (args.length > 0) {
    io.stderr(`ondina list: 引数は指定できません\n\n${usage}`);
    return 1;
  }
  const repo = repoRoot(io, 'list');
  if (!repo) return 1;
  const analyses = listAnalyses(repo);
  if (analyses.length === 0) io.stderr('ondina list: 解析がありません。ondina analyze <pr> で解析してください\n');
  for (const a of analyses) io.stdout(`${a.key}\t${a.headSha}\t${a.pr.baseSha}\t${a.pr.title}\n`);
  return 0;
}

async function token(args: string[], io: Io): Promise<number> {
  if (args.length > 0) {
    io.stderr(`ondina token: 引数は指定できません\n\n${usage}`);
    return 1;
  }
  const d: TokenDeps = {
    platform: process.platform,
    env: process.env,
    account: os.userInfo().username,
    readSecret: (prompt) => readSecret(prompt),
    write: (service, account, secret) => writeKeychain(service, account, secret),
    read: (service) => readKeychain(service),
    ...io.keychain,
  };
  if (d.platform !== 'darwin') {
    io.stderr(`ondina token: キーチェーンに保存できるのは Mac だけです。環境変数 ${TICKET_TOKEN_ENV} にトークンを設定してください\n`);
    return 1;
  }
  const secret = await d.readSecret(`Jira のトークンを貼り付けて Enter を押してください（画面には表示されません。キーチェーンの ${KEYCHAIN_SERVICE} に保存します）: `);
  if (secret === undefined || secret === '') {
    io.stderr(`ondina token: ${secret === undefined ? '中止しました' : 'トークンが空です'}。キーチェーンは変更していません\n`);
    return 1;
  }
  const failed = await d.write(KEYCHAIN_SERVICE, d.account, secret);
  if (failed !== undefined) {
    io.stderr(`ondina token: キーチェーンに保存できませんでした: ${failed}\n`);
    return 1;
  }
  // 入れたものを読み戻して確かめる（analyze が読むのと同じ道）
  const back = await d.read(KEYCHAIN_SERVICE);
  if (back === undefined || !('token' in back) || back.token !== secret) {
    const why = back !== undefined && 'error' in back ? `: ${back.error}` : back !== undefined && 'token' in back ? '（別の値が保存されています）' : '（見つかりません）';
    io.stderr(`ondina token: 保存したトークンを読み出せませんでした${why}\n`);
    return 1;
  }
  io.stdout(`Jira のトークン（${secret.length} 文字）をキーチェーンの ${KEYCHAIN_SERVICE} に保存しました。次の analyze から使います\n`);
  if (d.env[TICKET_TOKEN_ENV]) io.stderr(`ondina token: 環境変数 ${TICKET_TOKEN_ENV} もあり、そちらが先に使われます。~/.zshrc などの export を消してください\n`);
  return 0;
}

async function comments(args: string[], io: Io): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === 'wait') return commentsWait(rest, io);
  if (sub !== 'add') {
    io.stderr(`ondina comments: 使えるのは add と wait だけです\n\n${usage}`);
    return 1;
  }
  const i = rest.indexOf('--from');
  const from = i >= 0 ? rest[i + 1] : undefined;
  if (from === undefined) {
    io.stderr(`ondina comments add: --from <file|-> を指定してください\n\n${usage}`);
    return 1;
  }
  const repo = repoRoot(io, 'comments add');
  if (!repo) return 1;
  try {
    const text = from === '-' ? (io.stdin ?? (() => readFileSync(0, 'utf8')))() : readFileSync(from, 'utf8');
    const input: unknown = JSON.parse(text);
    if (!isCommentsInput(input)) {
      io.stderr('ondina comments add: JSON の形式が違います（source / headSha / comments[{path, line, side, body, note?}]）\n');
      return 1;
    }
    const r = addComments(repo, input);
    io.stdout(`${r.added} 件を下書きに追加しました（${r.key} / ${r.headSha.slice(0, 7)}）\n`);
    return 0;
  } catch (e) {
    io.stderr(`ondina comments add: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

/**
 * `comments wait`（12 章。2026-10-15）: レビュアーが締めの画面の「AI に返す」で返したコメントを待つ。届いていればすぐ、無ければ届くまで待ち、
 * JSON（`{ comments: ReturnedComment[] }`）を標準出力に出して exit 0。待つ間は待ち印を置き、画面が「待っている AI がいるか」を出せるようにする
 */
async function commentsWait(args: string[], io: Io): Promise<number> {
  if (args.length > 0) {
    io.stderr(`ondina comments wait: 引数はありません\n\n${usage}`);
    return 1;
  }
  const repo = repoRoot(io, 'comments wait');
  if (!repo) return 1;
  const off = markWaiting(repo, process.pid);
  // Ctrl+C やエージェントが止めたときも印を外す（強制終了で残った印は、pid が生きていないので数えない）
  const stop = (code: number) => () => {
    off();
    process.exit(code);
  };
  const onInt = stop(130);
  const onTerm = stop(143);
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    io.stderr('ondina comments wait: レビュアーが画面の「AI に返す」を押すのを待っています\n');
    for (;;) {
      const got = takeReturned(repo);
      if (got.length > 0) {
        io.stderr(`ondina comments wait: ${got.length} 件を受け取りました\n`);
        io.stdout(JSON.stringify({ comments: got }, null, 2) + '\n');
        return 0;
      }
      await new Promise((r) => setTimeout(r, io.pollMs ?? 1000));
    }
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    off();
  }
}

// 構成の推定し直し（設計書 10.6）。LLM コマンドの解決は analyze と同じ（UI の設定 > 環境変数 > yaml > 既定）
async function structure(args: string[], io: Io): Promise<number> {
  if (args.length > 1 || args.some((a) => a.startsWith('-'))) {
    io.stderr(`ondina structure: 引数は <ref> 1 つだけです\n\n${usage}`);
    return 1;
  }
  const repo = repoRoot(io, 'structure');
  if (!repo) return 1;
  try {
    const sha = git(repo, 'rev-parse', '--verify', `${args[0] ?? 'HEAD'}^{commit}`);
    const command = resolveLlmCommand({ override: readUi(repo).llmCommand, env: process.env['ONDINA_LLM_COMMAND'], yaml: readConfigFile(repo).config.llm?.command });
    // 前回の層の名前を渡し、当てはまる限り同じ名前と並びを使わせる（原則 7）
    const previous = readStructure(repo)?.layers.map((l) => l.name);
    const r = await inferStructure(repo, sha, command, undefined, previous);
    if ('error' in r) {
      io.stderr(`ondina structure: 構成を推定できませんでした: ${r.error}\n`);
      return 1;
    }
    for (const i of r.info) io.stderr(`ondina structure: ${i}\n`);
    io.stdout(`${STRUCTURE_FILE} を書きました: 層 ${r.saved.layers.length}（${r.saved.layers.map((l) => l.name).join(' / ')}）、テストの置き場 ${r.saved.tests?.length ?? 0} か所、${sha.slice(0, 7)} のファイル ${r.saved.known.length} 件\n`);
    io.stdout('画面に反映するには ondina analyze <pr> で解析し直してください\n');
    return 0;
  } catch (e) {
    io.stderr(`ondina structure: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

// Tab 補完のスクリプトを標準出力に出す。今は zsh だけ
function completion(args: string[], io: Io): number {
  if (args.length !== 1 || args[0] !== 'zsh') {
    io.stderr(`ondina completion: 対応しているのは zsh だけです\n\n${usage}`);
    return 1;
  }
  io.stdout(zshCompletion());
  return 0;
}

// 設計書 5.5 clone して入れる: 入れた clone を scripts/install.sh で取り直して組み立て直す
function update(args: string[], io: Io): number {
  if (args.length > 1) {
    io.stderr(`ondina update: 引数が多すぎます（バージョンは 1 つだけ指定できます）\n\n${usage}`);
    return 1;
  }
  const script = path.join(io.selfRoot ?? selfRoot(), 'scripts/install.sh');
  if (!existsSync(script)) {
    io.stderr(`ondina update: ${script} がありません。clone からインストールした ondina ではないので、update できません\n`);
    return 1;
  }
  return (io.runScript ?? runScript)(script, args);
}
