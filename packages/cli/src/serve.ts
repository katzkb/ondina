// ondina serve（設計書 5.5）。node:http だけで、API と @ondina/web の dist を配る。
//
//   GET  /api/repo                      { repo, pid, version, startedAt }。どのリポジトリの serve か（serve --background が使い回してよいかを決める）と、
//                                       起動したときの ondina のコミットと時刻（serve list が更新前の serve を見分ける。12 章）
//   GET  /api/analyses                  .ondina/ 配下の解析の一覧（新しい順）
//   GET  /api/analyses/:key/:sha        Analysis.json
//   GET  /api/state/:key/:sha           ReviewState（その PR の進み具合）。無ければ前の版から引き継いで作る（無ければ初期値）
//   PUT  /api/state/:key/:sha           ReviewState を .ondina/<key>/state/<sha>.json に書く
//   GET  /api/ui / PUT /api/ui          .ondina/ui.json（PR をまたぐ設定: worktreeRoot / llmCommand / reviewCommand / ticket / theme / diffMode / keymap）。解析が無くても使える
//   GET  /api/config                    ondina.config.yaml の表示だけの部分（packagePrefix / theme / ide。11 章）。毎回読むので再起動不要
//   POST /api/comments                  12 章の JSON を下書きとして足す
//   POST /api/comments/send/:key/:sha   採用した下書きを GitHub で公開していないレビュー（pending）として送る（gh api）
//                                       local（PR 番号なし）は GitHub に送らず AI に返す（受け箱に書く。`comments wait` が受け取る）
//   GET  /api/github/viewed/:key/:sha   { viewed: パス[] }。GitHub の PR で Viewed のファイル（gh api graphql。12.1）。local は 400、gh の失敗は 502
//   POST /api/github/viewed/:key/:sha   { mark, unmark } を GitHub の Viewed に付ける / 外す。PR の head が解析と違えば 409（送らない）
//   GET  /api/ask/:key/:sha             案内人に聞くの会話（.ondina/<key>/ask/<sha>.json。3.10）
//   POST /api/ask/:key/:sha             { key, place, question } を LLM コマンドに聞き、検証した答え（AskEntry）を返して記録に足す。失敗は 502 と理由。
//                                       案内人が読みたいコードを頼んだら（need）head から読んで聞き直す（2 回まで）
//   GET  /api/latest/:key/:sha          その版より新しい head があるか（LatestHead。PR は gh、local は git）。聞けなければ 502
//   GET  /api/prs                       開いている PR の一覧（PrList。gh api graphql を 1 回。3.11）。gh の失敗は 502 と理由
//   GET  /api/prs/:n                    PR の詳細（PrDetail。一覧と同じ宛先に gh api graphql を 1 回。3.11）。gh の失敗は 502 と理由、番号でなければ 404
//   POST /api/analyze/:key/:sha         その版の引数で解析し直す（ondina analyze を子プロセスで。202 と AnalyzeJob）。その key が順番待ちか解析中なら 409 と今のジョブ
//   POST /api/analyze/:key              PR 番号で解析する（PR 一覧から。3.11）。返り方は同じ。local は 404
//   GET  /api/analyze                   key ごとの最新の AnalyzeJob[]。走るのは同時に 1 本で、あとは順番待ち
//   POST /api/review/:n                 { headSha } を AI レビューのコマンドでレビューする（202 と ReviewJob。3.11）。解析が動いているか無ければ waiting（無ければ解析を列に入れる）。
//                                       その PR が解析待ちかレビュー中なら 409 と今のジョブ、コマンドが空なら 400、番号でなければ 404
//   GET  /api/review                    key ごとの最新の ReviewJob[]。解析の列とは別で、いくつでも同時に走る
//   DELETE /api/review/:n               解析待ちかレビュー中を止める（コマンドはプロセスグループごと）。200 と止めたジョブ。動いていなければ 404
//   POST /api/lsp                       analyze から言語サーバーの仕事（LspJobRequest）を受け、起動したままの言語サーバーで取る（lsp-session.ts）。
//                                       応答は 1 行 1 JSON（進みと最後の結果。lsp-remote.ts）と、黙る間の空の行。serve は起動時に .ondina/serve.json を書き、analyze はそれで見つける
//   それ以外                             dist の静的ファイル。無ければ index.html（SPA）
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Analysis, AskEntry, PrDetail, PrList } from '@ondina/model';
import { buildAskInput, defaultConfig, parseAskOutput, renderAskPrompt, splitConfig, verifyAskAnswer, type DisplayConfig } from '@ondina/core';
import { readConfigFile } from './config.js';
import { ASK_TIMEOUT_MS, resolveLlmCommand, runLlmCommand } from './llm.js';
import { ASK_READ_ROUNDS, readForAsk } from './ask-read.js';
import { HeadMismatchError, readViewed, setViewed, type ViewedChange } from './github-viewed.js';
import { runGh as defaultRunGh, runGhAsync as defaultRunGhAsync, type GhTarget, type RunGh, type RunGhAsync } from './pr.js';
import { fetchPrDetail } from './pr-detail.js';
import { fetchPrList, repoTargetFromGhJson, repoUrlArgs } from './pr-list.js';
import { isLspJobRequest, removeServeFile, toJobArgs, toWire, writeServeFile, type WireLine } from './lsp-remote.js';
import { createLspHolder, type LspHolder, type LspJobResult } from './lsp-session.js';
import { createAnalyzeRunner, defaultReanalyzeDeps, latestHead, type ReanalyzeDeps } from './reanalyze.js';
import { createReviewRunner, type ReviewDeps } from './review.js';
import { addComments, appendAsk, isAskRequest, isCommentsInput, isReviewState, isSha, isUiSettings, keepOutsideDrafts, listAnalyses, OffDiffError, readAnalysis, readAsk, readOrCarryState, readState, readUi, returnComments, sendComments, writeState, writeUi } from './store.js';

export interface ServeOptions {
  repo: string;
  /** 0 なら空いているポート */
  port: number;
  host?: string;
  /** 既定は @ondina/web の dist */
  distDir?: string;
  /** gh の実行（テストで差し替える） */
  runGh?: RunGh;
  /** gh の非同期の実行（GitHub の Viewed・PR 一覧。テストで差し替える） */
  runGhAsync?: RunGhAsync;
  /** 止められない失敗（yaml が壊れている、など）の出力先。既定は stderr */
  log?: (s: string) => void;
  /** 解析し直しの子プロセスと新しい head の聞き方（テストで差し替える） */
  reanalyze?: Partial<ReanalyzeDeps>;
  /** AI レビューの時計と打ち切り（テストで差し替える） */
  review?: Partial<ReviewDeps>;
  /** serve.json の登録が空いたか（登録していた serve が終わったか）を見る間隔。既定 REGISTER_CHECK_MS（テストで縮める） */
  registerCheckMs?: number;
  /** POST /api/lsp の応答に空の行を送る間隔。既定 LSP_KEEPALIVE_MS（テストで縮める） */
  lspKeepAliveMs?: number;
  /** 起動した ondina の clone のコミット（GET /api/repo。serve list が更新前の serve を見分ける） */
  version?: string;
}

/** 起動したときに別の serve が登録していたら、その serve が終わったあとに登録を引き継ぐ。それまでの間隔 */
const REGISTER_CHECK_MS = 10_000;

/**
 * POST /api/lsp の応答に空の行を送る間隔。analyze の fetch（Node）は 300 秒何も届かないと応答を切り、切られた analyze は
 * 自分で言語サーバーを起動しようとして serve のロックを最大 60 分待つ。前の解析の順番待ちや、大きな PR の取り出しの間は進みの行が無い（2026-10-28）
 */
const LSP_KEEPALIVE_MS = 30_000;

export interface RunningServer {
  port: number;
  url: string;
  server: Server;
  close(): Promise<void>;
}

export function defaultDistDir(): string {
  const require = createRequire(import.meta.url);
  return path.join(path.dirname(require.resolve('@ondina/web/package.json')), 'dist');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const MAX_BODY = 10 * 1024 * 1024;
/** POST /api/lsp の本文の上限。hunk を丸ごと送るので大きな PR では 10 MB を超えうる */
const MAX_LSP_BODY = 200 * 1024 * 1024;

function readBody(req: IncomingMessage, max = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('本文が大きすぎます'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

async function parseJsonBody(req: IncomingMessage, max = MAX_BODY): Promise<unknown> {
  const text = await readBody(req, max);
  return JSON.parse(text) as unknown;
}

const isPaths = (v: unknown): v is string[] => Array.isArray(v) && v.every((p) => typeof p === 'string');
const isViewedChange = (v: unknown): v is ViewedChange => typeof v === 'object' && v !== null && isPaths((v as Record<string, unknown>)['mark']) && isPaths((v as Record<string, unknown>)['unmark']);

export interface AppOptions {
  runGh?: RunGh;
  /** gh の非同期の実行（GitHub の Viewed。テストで差し替える） */
  runGhAsync?: RunGhAsync;
  log?: (s: string) => void;
  /** 案内人に聞くの打ち切り（既定 ASK_TIMEOUT_MS） */
  askTimeoutMs?: number;
  reanalyze?: Partial<ReanalyzeDeps>;
  review?: Partial<ReviewDeps>;
  /** 起動したまま持つ言語サーバー（POST /api/lsp）。無ければ 503 */
  lsp?: LspHolder;
  /** POST /api/lsp の応答に空の行を送る間隔（既定 LSP_KEEPALIVE_MS） */
  lspKeepAliveMs?: number;
  /** GET /api/repo に足す、起動したときのバージョンと時刻 */
  started?: { version?: string; startedAt: string };
}

export function createApp(repo: string, distDir: string, opts: AppOptions = {}): (req: IncomingMessage, res: ServerResponse) => void {
  const runGh = opts.runGh ?? defaultRunGh;
  const runGhAsync = opts.runGhAsync ?? defaultRunGhAsync;
  const log = opts.log ?? ((s: string) => process.stderr.write(s));
  const reanalyzeDeps = { ...defaultReanalyzeDeps(), ...opts.reanalyze };
  const runner = createAnalyzeRunner(repo, reanalyzeDeps);
  const reviews = createReviewRunner(repo, runner, opts.review);
  // yaml は毎回読む（直したら再読み込みで反映）。serve は止められないので、読めなければ既定値で描き理由を log に出す
  // PR 一覧・PR の詳細の宛先（リポジトリのホストと owner / name）は gh repo view で 1 回だけ聞いて覚える。聞けなければ次の回に聞き直す
  let prTarget: Promise<GhTarget> | null = null;
  const ghTarget = async (): Promise<GhTarget> => {
    prTarget ??= runGhAsync(repoUrlArgs, repo).then(repoTargetFromGhJson);
    try {
      return await prTarget;
    } catch (e) {
      prTarget = null;
      throw e;
    }
  };
  const prList = async (): Promise<PrList> => fetchPrList(repo, await ghTarget(), runGhAsync, Date.now());
  const prDetail = async (n: number): Promise<PrDetail> => fetchPrDetail(repo, await ghTarget(), n, runGhAsync);
  const displayConfig = (): DisplayConfig => {
    try {
      return splitConfig(readConfigFile(repo).config).display;
    } catch (e) {
      log(`ondina serve: ${e instanceof Error ? e.message : String(e)}（既定値で続けます）\n`);
      return splitConfig(defaultConfig()).display;
    }
  };
  const api = async (method: string, segments: string[], req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const [head, key, sha] = segments;
    if (head === 'repo' && method === 'GET' && segments.length === 1) return json(res, 200, { repo, pid: process.pid, ...opts.started });
    if (head === 'lsp' && method === 'POST' && segments.length === 1) {
      if (opts.lsp === undefined) return send(res, 503, 'この serve は言語サーバーを持っていません');
      let body: unknown;
      try {
        body = await parseJsonBody(req, MAX_LSP_BODY);
      } catch {
        return send(res, 400, 'JSON として読めません');
      }
      if (!isLspJobRequest(body)) return send(res, 400, 'LspJobRequest の形式ではありません');
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
      const line = (v: WireLine): void => {
        res.write(JSON.stringify(v) + '\n');
      };
      // 応答の頭はもう送ったので、ここから先は投げない（外側の catch が 500 を書こうとして serve ごと落ちる）
      const keepAlive = setInterval(() => res.write('\n'), opts.lspKeepAliveMs ?? LSP_KEEPALIVE_MS);
      let r: LspJobResult;
      try {
        r = await opts.lsp.job(toJobArgs(body, (progress) => line({ progress })));
      } catch (e) {
        r = { run: { command: body.command, status: 'unavailable', reason: e instanceof Error ? e.message : String(e) }, reused: false };
      } finally {
        clearInterval(keepAlive);
      }
      line({ done: toWire(r) });
      res.end();
      return;
    }
    if (head === 'config' && method === 'GET' && segments.length === 1) return json(res, 200, displayConfig());
    if (head === 'analyses' && method === 'GET' && segments.length === 1) return json(res, 200, listAnalyses(repo));
    if (head === 'analyses' && method === 'GET' && segments.length === 3) {
      const a = readAnalysis(repo, key!, sha!);
      return a ? json(res, 200, a) : send(res, 404, '解析がありません');
    }
    if (head === 'state' && segments.length === 3) {
      if (!readAnalysis(repo, key!, sha!)) return send(res, 404, '解析がありません');
      if (method === 'GET') return json(res, 200, readOrCarryState(repo, key!, sha!));
      if (method === 'PUT') {
        let body: unknown;
        try {
          body = await parseJsonBody(req);
        } catch {
          return send(res, 400, 'JSON として読めません');
        }
        if (!isReviewState(body)) return send(res, 400, 'ReviewState の形式ではありません');
        writeState(repo, key!, sha!, keepOutsideDrafts(readState(repo, key!, sha!), body));
        res.writeHead(204).end();
        return;
      }
    }
    if (head === 'ui' && segments.length === 1) {
      if (method === 'GET') return json(res, 200, readUi(repo));
      if (method === 'PUT') {
        let body: unknown;
        try {
          body = await parseJsonBody(req);
        } catch {
          return send(res, 400, 'JSON として読めません');
        }
        if (!isUiSettings(body)) return send(res, 400, 'UiSettings の形式ではありません');
        writeUi(repo, body);
        res.writeHead(204).end();
        return;
      }
    }
    if (head === 'comments' && method === 'POST' && segments.length === 4 && segments[1] === 'send') {
      const [, , k, h] = segments;
      if (!readAnalysis(repo, k!, h!)) return send(res, 404, '解析がありません');
      if (!readState(repo, k!, h!).comments.some((c) => c.state === 'adopted')) return send(res, 400, '採用したコメントがありません');
      // local（PR が無い）は GitHub に送らず、この変更を作った AI に返す（12 章。`comments wait` が受け取る）
      if (k === 'local') return json(res, 200, returnComments(repo, h!));
      // gh の呼び出しは同期（execFileSync）なので、GitHub の往復の間はこのサーバの他のリクエストも待つ。
      // ローカルの単一ユーザー向けなので受け入れている（レビュー指摘 2026-09-17。重くなったら execFile に）
      try {
        return json(res, 200, sendComments(repo, k!, h!, runGh));
      } catch (e) {
        return send(res, 502, e instanceof Error ? e.message : String(e));
      }
    }
    if (head === 'github' && segments.length === 4 && segments[1] === 'viewed') {
      const [, , k, h] = segments;
      const analysis = readAnalysis(repo, k!, h!);
      if (!analysis) return send(res, 404, '解析がありません');
      if (k === 'local') return send(res, 400, 'ローカル解析（PR 番号なし）では GitHub の Viewed を使えません');
      if (method === 'GET') {
        try {
          return json(res, 200, { viewed: (await readViewed(repo, analysis.pr.number, runGhAsync)).viewed });
        } catch (e) {
          return send(res, 502, e instanceof Error ? e.message : String(e));
        }
      }
      if (method === 'POST') {
        let body: unknown;
        try {
          body = await parseJsonBody(req);
        } catch {
          return send(res, 400, 'JSON として読めません');
        }
        if (!isViewedChange(body)) return send(res, 400, '{ mark, unmark }（パスの配列）の形式ではありません');
        try {
          await setViewed(repo, analysis.pr.number, h!, body, runGhAsync);
        } catch (e) {
          if (e instanceof HeadMismatchError) return send(res, 409, e.message);
          return send(res, 502, e instanceof Error ? e.message : String(e));
        }
        res.writeHead(204).end();
        return;
      }
    }
    if (head === 'ask' && segments.length === 3) {
      const analysis = readAnalysis(repo, key!, sha!);
      if (!analysis) return send(res, 404, '解析がありません');
      if (method === 'GET') return json(res, 200, readAsk(repo, key!, sha!));
      if (method === 'POST') return ask(analysis, key!, sha!, req, res);
    }
    if (head === 'latest' && method === 'GET' && segments.length === 3) {
      const current = readAnalysis(repo, key!, sha!);
      if (!current) return send(res, 404, '解析がありません');
      try {
        return json(res, 200, await latestHead(repo, key!, current, reanalyzeDeps));
      } catch (e) {
        return send(res, 502, e instanceof Error ? e.message : String(e));
      }
    }
    if (head === 'prs' && method === 'GET' && segments.length === 1) {
      try {
        return json(res, 200, await prList());
      } catch (e) {
        return send(res, 502, e instanceof Error ? e.message : String(e));
      }
    }
    if (head === 'prs' && method === 'GET' && segments.length === 2) {
      if (!/^[1-9][0-9]*$/.test(key!)) return send(res, 404, 'PR の番号ではありません');
      try {
        return json(res, 200, await prDetail(Number(key)));
      } catch (e) {
        return send(res, 502, e instanceof Error ? e.message : String(e));
      }
    }
    if (head === 'analyze' && method === 'GET' && segments.length === 1) return json(res, 200, runner.jobs());
    if (head === 'analyze' && method === 'POST' && (segments.length === 2 || segments.length === 3)) {
      const started = runner.start(key!, sha);
      if ('error' in started) return started.error === 'busy' ? json(res, 409, runner.jobs().find((j) => j.key === key)) : send(res, 404, '解析がありません');
      return json(res, 202, started);
    }
    if (head === 'review' && method === 'GET' && segments.length === 1) return json(res, 200, reviews.jobs());
    if (head === 'review' && segments.length === 2 && (method === 'POST' || method === 'DELETE')) {
      if (!/^[1-9][0-9]*$/.test(key!)) return send(res, 404, 'PR の番号ではありません');
      if (method === 'DELETE') {
        const stopped = reviews.stop(key!);
        return stopped ? json(res, 200, stopped) : send(res, 404, '動いている AI レビューはありません');
      }
      let body: unknown;
      try {
        body = await parseJsonBody(req);
      } catch {
        return send(res, 400, 'JSON として読めません');
      }
      const headSha = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['headSha'] : undefined;
      if (typeof headSha !== 'string' || !isSha(headSha)) return send(res, 400, '{ headSha }（40 桁の sha）の形式ではありません');
      const started = reviews.start(key!, headSha);
      if (!('error' in started)) return json(res, 202, started);
      if (started.error === 'busy') return json(res, 409, reviews.jobs().find((j) => j.key === key));
      if (started.error === 'nocommand') return send(res, 400, 'AI レビューのコマンドが設定されていません。設定（⚙）の「AI レビューのコマンド」に入れてください');
      return send(res, 404, 'PR の番号ではありません');
    }
    if (head === 'comments' && method === 'POST' && segments.length === 1) {
      let body: unknown;
      try {
        body = await parseJsonBody(req);
      } catch {
        return send(res, 400, 'JSON として読めません');
      }
      if (!isCommentsInput(body)) return send(res, 400, 'コメント JSON の形式ではありません（source / headSha / comments[]）');
      try {
        return json(res, 200, addComments(repo, body));
      } catch (e) {
        // GitHub の差分に出ない行があれば 400（AI が付け直す）、headSha の解析が無ければ 404
        return send(res, e instanceof OffDiffError ? 400 : 404, e instanceof Error ? e.message : String(e));
      }
    }
    send(res, 404, 'not found');
  };

  // LLM コマンドの解決は解析と同じ: UI の設定 > ONDINA_LLM_COMMAND > yaml > 既定（5.3）。毎回読む（設定を直したら次の問いから効く）
  const llmCommand = (): string => {
    let yaml: string | undefined;
    try {
      yaml = readConfigFile(repo).config.llm?.command;
    } catch {
      yaml = undefined; // 壊れた yaml は displayConfig が log に出す
    }
    return resolveLlmCommand({ override: readUi(repo).llmCommand, env: process.env['ONDINA_LLM_COMMAND'], yaml });
  };

  // 案内人に聞く（3.10 / 10.5）: 材料を組む → LLM → 検証 → 記録に足す。要求が切れたら（画面の「止める」）LLM をプロセスごと止める。
  // 案内人が need を返したら head から読んで reads に足し、聞き直す（ASK_READ_ROUNDS 回まで。最後の回は need を出させない）。
  // 打ち切りは全部の回を合わせた時間（人が待つのは 1 問の答え）
  const ask = async (analysis: Analysis, key: string, sha: string, req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body: unknown;
    try {
      body = await parseJsonBody(req);
    } catch {
      return send(res, 400, 'JSON として読めません');
    }
    if (!isAskRequest(body)) return send(res, 400, '質問の形式ではありません（key / place / question）');
    const question = body.question.trim();
    const history = readAsk(repo, key, sha).entries.filter((e) => e.key === body.key);
    let input = buildAskInput(analysis, body.place, question, history);
    const command = llmCommand();
    const stop = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) stop.abort();
    });
    const started = Date.now();
    const timeoutMs = opts.askTimeoutMs ?? ASK_TIMEOUT_MS;
    for (let round = 0; ; round++) {
      const last = round === ASK_READ_ROUNDS;
      const run = await runLlmCommand(command, renderAskPrompt(input, { last }), repo, Math.max(0, started + timeoutMs - Date.now()), stop.signal);
      if (run.aborted) return; // 画面が止めた。返す相手はもういない
      if (run.timedOut) return send(res, 502, `${Math.round(timeoutMs / 60000)} 分で終わりませんでした`);
      if (run.exitCode !== 0) return send(res, 502, `終了コード ${run.exitCode ?? 'なし'}: ${run.stderr.trim().slice(0, 200) || '（stderr なし）'}`);
      const parsed = parseAskOutput(run.stdout);
      if ('error' in parsed) return send(res, 502, `出力を読めません: ${parsed.error}`);
      if ('need' in parsed) {
        if (last) return send(res, 502, `コードを ${ASK_READ_ROUNDS} 回読んだあとも、答えがありませんでした`);
        input = { ...input, reads: [...(input.reads ?? []), ...(await readForAsk(repo, analysis.pr.headSha, parsed.need, stop.signal))] };
        if (stop.signal.aborted) return;
        continue;
      }
      const entry: AskEntry = {
        id: randomUUID(),
        key: body.key,
        place: body.place,
        question,
        answer: verifyAskAnswer(parsed.output, input),
        command,
        ms: Date.now() - started,
        at: new Date().toISOString(),
      };
      appendAsk(repo, key, sha, entry);
      return json(res, 200, entry);
    }
  };

  const serveStatic = (pathname: string, res: ServerResponse): void => {
    const root = path.resolve(distDir);
    const target = path.resolve(root, '.' + pathname);
    if (target.startsWith(root + path.sep) && existsSync(target) && statSync(target).isFile()) {
      send(res, 200, readFileSync(target), MIME[path.extname(target)] ?? 'application/octet-stream');
      return;
    }
    const index = path.join(root, 'index.html');
    if (!existsSync(index)) {
      send(res, 503, `UI のビルドがありません（${index}）。リポジトリのルートで pnpm build を実行してください`);
      return;
    }
    send(res, 200, readFileSync(index), MIME['.html']!);
  };

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      send(res, 400, 'bad path');
      return;
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const segments = pathname.slice('/api/'.length).split('/').filter(Boolean);
      api(req.method ?? 'GET', segments, req, res).catch((e: unknown) => send(res, 500, e instanceof Error ? e.message : String(e)));
      return;
    }
    serveStatic(pathname, res);
  };
}

export function startServer(opts: ServeOptions): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1';
  // 言語サーバーは最初の POST /api/lsp で起動し、serve が終わるまで残す（設計書 9.1）。終わり方は serve が決めるので、シグナルは拾わせない
  const lsp = createLspHolder(opts.repo, { handleSignals: false });
  const started = { ...(opts.version === undefined ? {} : { version: opts.version }), startedAt: new Date().toISOString() };
  const server = createServer(createApp(opts.repo, opts.distDir ?? defaultDistDir(), { ...(opts.runGh ? { runGh: opts.runGh } : {}), ...(opts.runGhAsync ? { runGhAsync: opts.runGhAsync } : {}), ...(opts.log ? { log: opts.log } : {}), ...(opts.reanalyze ? { reanalyze: opts.reanalyze } : {}), ...(opts.review ? { review: opts.review } : {}), ...(opts.lspKeepAliveMs === undefined ? {} : { lspKeepAliveMs: opts.lspKeepAliveMs }), lsp, started }));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port;
      writeServeFile(opts.repo, port);
      const register = setInterval(() => {
        try {
          writeServeFile(opts.repo, port);
        } catch {
          // 書けなければ次の回に
        }
      }, opts.registerCheckMs ?? REGISTER_CHECK_MS);
      register.unref();
      resolve({
        port,
        url: `http://${host}:${port}/`,
        server,
        close: async () => {
          // 先に消す（閉じている間に analyze がこの serve を見つけないように）
          clearInterval(register);
          removeServeFile(opts.repo, port);
          await new Promise<void>((res, rej) => {
            server.closeAllConnections();
            server.close((e) => (e ? rej(e) : res()));
          });
          await lsp.close();
        },
      });
    });
  });
}
