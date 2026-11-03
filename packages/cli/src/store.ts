// .ondina/ の読み書き（設計書 5.5 / 12 章）。serve と `ondina comments add` が共用する。
//
// - 置き場: PR 番号の解析（<key> が番号）は元のフォルダの .ondina/。git worktree の中で打っても同じ場所なので、1 つの serve で全部見せる。
//   local（PR の無い変更）はその作業フォルダの作業ツリーの解析なので、打ったフォルダの .ondina/（keyDir）
// - 解析: .ondina/<key>/<headSha>.json（analyze が書く）
// - 閲覧状態: .ondina/<key>/state/<headSha>.json（UI が操作のたびに PUT する）。その PR の進み具合だけ。
//   新しい版を初めて読むとき、前の版から引き継いで作る（readOrCarryState）
// - UI 設定: .ondina/ui.json（worktreeRoot / llmCommand / reviewCommand / ticket / theme / diffMode。PR をまたぐ。設計書 3.8）
// - LLM の生出力: .ondina/<key>/llm/<headSha>.json（llm.ts が書く。5.3）
// - 案内人に聞くの会話: .ondina/<key>/ask/<headSha>.json（serve が答えを受け取った時点で足す。3.10。ReviewState とは別のファイルで、UI の PUT と書き合わない）
// - AI に返したコメント: .ondina/local/returned/<返した時刻>-<headSha 先頭 7>.json（local の解析だけ。12 章）。`comments wait` が古い順に読み、returned/done/ へ移す
// - 待っている AI の印: .ondina/local/waiting/<pid>（`comments wait` が待つ間だけ置く。返した直後に、待っている AI がいるかを画面に返す）
// key は PR 番号か 'local'、sha は 40 桁の hex に限る（パスに使うので形を検査する）
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { carryReview, onGithubDiff } from '@ondina/core';
import type { Analysis, AnalysisSummary, AskEntry, AskLog, AskPlace, CommentDraft, CommentsInput, ReviewState, UiSettings } from '@ondina/model';
import { git, mainWorktree } from './git.js';
import { graphqlData, prUrlArgs, targetFromGhJson, type GhTarget, type RunGh } from './pr.js';

const KEY = /^(\d+|local)$/;
const SHA = /^[0-9a-f]{40}$/;

export function isKey(s: string): boolean {
  return KEY.test(s);
}
export function isSha(s: string): boolean {
  return SHA.test(s);
}

/** state が無いときの初期値 */
export function defaultState(): ReviewState {
  return { viewed: [], comments: [] };
}

/** origin の URL から GitHub のリポジトリの URL（`https://github.com/<owner>/<repo>`）。GitHub 以外は undefined */
function repoUrlFromRemote(remote: string): string | undefined {
  const m = /^(?:git@github\.com:|https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

/** origin の URL から PR ページの URL。GitHub 以外は undefined */
export function prUrlFromRemote(remote: string, number: number): string | undefined {
  const base = repoUrlFromRemote(remote);
  return base === undefined ? undefined : `${base}/pull/${number}`;
}

function originUrl(repo: string): string | undefined {
  try {
    return git(repo, 'remote', 'get-url', 'origin');
  } catch {
    return undefined;
  }
}

function readJson<T>(file: string): T | undefined {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** 落ちても半端なファイルを残さない: tmp に書いて rename */
function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}

/** その key の置き場（.ondina/<key>）。PR 番号は元のフォルダ、local は repo */
export function keyDir(repo: string, key: string): string {
  return path.join(key === 'local' ? repo : mainWorktree(repo), '.ondina', key);
}

/** repo の local と、元のフォルダの PR 番号の解析 */
export function listAnalyses(repo: string): AnalysisSummary[] {
  const prRoot = path.join(mainWorktree(repo), '.ondina');
  const keys = ['local', ...(existsSync(prRoot) ? readdirSync(prRoot).filter((k) => isKey(k) && k !== 'local') : [])];
  const repoName = path.basename(repo);
  const remote = originUrl(repo);
  const out: AnalysisSummary[] = [];
  for (const key of keys) {
    const dir = keyDir(repo, key);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir)) {
      const headSha = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !isSha(headSha)) continue;
      const file = path.join(dir, name);
      const analysis = readJson<Analysis>(file);
      if (!analysis) continue;
      const prUrl = key !== 'local' && remote ? prUrlFromRemote(remote, analysis.pr.number) : undefined;
      out.push({ key, headSha, pr: analysis.pr, mtime: statSync(file).mtimeMs, repoName, ...(prUrl ? { prUrl } : {}) });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export function readAnalysis(repo: string, key: string, headSha: string): Analysis | undefined {
  if (!isKey(key) || !isSha(headSha)) return undefined;
  return readJson<Analysis>(path.join(keyDir(repo, key), `${headSha}.json`));
}

function statePath(repo: string, key: string, headSha: string): string {
  return path.join(keyDir(repo, key), 'state', `${headSha}.json`);
}

export function readState(repo: string, key: string, headSha: string): ReviewState {
  if (!isKey(key) || !isSha(headSha)) return defaultState();
  return readJson<ReviewState>(statePath(repo, key, headSha)) ?? defaultState();
}

export function writeState(repo: string, key: string, headSha: string, state: ReviewState): void {
  if (!isKey(key) || !isSha(headSha)) throw new Error(`不正な key / sha: ${key} / ${headSha}`);
  writeJsonAtomic(statePath(repo, key, headSha), state);
}

/** 同じ key で、state のファイルが一番新しい版（解析があるものだけ）。except の版は除く */
function latestStateSha(repo: string, key: string, except: string): string | undefined {
  const dir = path.join(keyDir(repo, key), 'state');
  if (!existsSync(dir)) return undefined;
  let best: { sha: string; mtime: number } | undefined;
  for (const name of readdirSync(dir)) {
    const sha = name.replace(/\.json$/, '');
    if (!name.endsWith('.json') || !isSha(sha) || sha === except || !existsSync(path.join(keyDir(repo, key), `${sha}.json`))) continue;
    const mtime = statSync(path.join(dir, name)).mtimeMs;
    if (best === undefined || mtime > best.mtime) best = { sha, mtime };
  }
  return best?.sha;
}

/**
 * 版の state。ファイルが無ければ、同じ key で state が一番新しい版から引き継いで作り、書く（3.0 / 12 章。2026-10-13）。
 * 新しい版を初めて開いたとき（GET /api/state）と、AI が先に下書きを足したとき（comments add）の両方で通る。
 * 解析し直しが終わった時点で作らないのは、知らせて待つ間に前の版で付けた印も移すため。引き継ぎ元が無ければ初期値（書かない）
 */
export function readOrCarryState(repo: string, key: string, headSha: string): ReviewState {
  if (!isKey(key) || !isSha(headSha)) return defaultState();
  const own = readJson<ReviewState>(statePath(repo, key, headSha));
  if (own !== undefined) return own;
  const next = readAnalysis(repo, key, headSha);
  const from = next === undefined ? undefined : latestStateSha(repo, key, headSha);
  const prev = from === undefined ? undefined : readAnalysis(repo, key, from);
  if (next === undefined || from === undefined || prev === undefined) return defaultState();
  const carried = carryReview(prev, readState(repo, key, from), next);
  writeState(repo, key, headSha, carried);
  return carried;
}

function askPath(repo: string, key: string, headSha: string): string {
  return path.join(keyDir(repo, key), 'ask', `${headSha}.json`);
}

/** 案内人に聞くの会話（古い順）。無ければ空 */
export function readAsk(repo: string, key: string, headSha: string): AskLog {
  if (!isKey(key) || !isSha(headSha)) return { entries: [] };
  return readJson<AskLog>(askPath(repo, key, headSha)) ?? { entries: [] };
}

/** 1 問 1 答を足す。答えを受け取った時点で呼ぶ（失敗と止めた問いは足さない） */
export function appendAsk(repo: string, key: string, headSha: string, entry: AskEntry): void {
  if (!isKey(key) || !isSha(headSha)) throw new Error(`不正な key / sha: ${key} / ${headSha}`);
  const log = readAsk(repo, key, headSha);
  writeJsonAtomic(askPath(repo, key, headSha), { entries: [...log.entries, entry] });
}

export function readUi(repo: string): UiSettings {
  return readJson<UiSettings>(path.join(repo, '.ondina', 'ui.json')) ?? {};
}

export function writeUi(repo: string, ui: UiSettings): void {
  writeJsonAtomic(path.join(repo, '.ondina', 'ui.json'), ui);
}

/** 内容から決める id。同じコメントを二度受けても増えない */
function commentId(source: string, c: CommentsInput['comments'][number]): string {
  return createHash('sha1').update([source, c.path, c.line, c.side, c.body].join('\0')).digest('hex').slice(0, 12);
}

/** AI の下書きに GitHub の差分に出ない行があり、1 件も足さなかった。serve は 400 で返す（解析が無いときの 404 と分ける） */
export class OffDiffError extends Error {}

/**
 * 12 章の JSON を受け、headSha から解析を探して state に draft として足す。
 * GitHub はその差分に出ない行にコメントを付けられないので、解析に githubDiff があり、差分に出ない行が 1 件でもあれば入力を丸ごと断る（AI が付け直して渡し直す。id は内容から作るので、二度渡しても増えない）。
 * githubDiff が無い解析（local と古い解析）はどの行も受ける。
 * key を渡せばその key の解析に足す（AI レビューのジョブは PR が決まっている。同じ head の local の解析に入れない）
 */
export function addComments(repo: string, input: CommentsInput, key?: string): { key: string; headSha: string; added: number } {
  const target = listAnalyses(repo).find((a) => a.headSha === input.headSha && (key === undefined || a.key === key));
  if (!target) throw new Error(`headSha ${input.headSha} の解析が .ondina/ にありません。先に ondina analyze を実行してください`);
  const diff = readAnalysis(repo, target.key, target.headSha)?.githubDiff;
  const off = input.comments.filter((c) => onGithubDiff(diff, c) === false);
  if (off.length > 0) {
    throw new OffDiffError(
      [
        `GitHub の差分に出ない行へのコメントが ${off.length} 件あります。GitHub はこの行にコメントを付けられないので、1 件も追加していません。差分の塊（git diff の @@ の中。変更の前後 3 行を含む）の行に付け直してください`,
        ...off.map((c) => `  ${c.path} ${c.line} 行目${c.side === 'LEFT' ? '（base 側）' : ''}`),
      ].join('\n'),
    );
  }
  const state = readOrCarryState(repo, target.key, target.headSha);
  const known = new Set(state.comments.map((c) => c.id));
  const fresh: CommentDraft[] = [];
  for (const c of input.comments) {
    const id = commentId(input.source, c);
    if (known.has(id)) continue;
    known.add(id);
    fresh.push({ id, path: c.path, line: c.line, side: c.side, body: c.body, source: input.source, state: 'draft' });
  }
  if (fresh.length > 0) writeState(repo, target.key, target.headSha, { ...state, comments: [...state.comments, ...fresh] });
  return { key: target.key, headSha: target.headSha, added: fresh.length };
}

/**
 * 画面の保存（PUT /api/state）は画面が持つ state 全体を送る。画面が読んだ後に `comments add` / `POST /api/comments` で足した
 * AI の下書きは画面が知らないので、ファイルにあって送られた state に無ければ後ろに残す（12 章）。
 * 自分のメモ（source が reviewer）は画面で消すと state から消えるので戻さない。AI の下書きは画面では消えない（破棄は state で持つ）
 */
export function keepOutsideDrafts(saved: ReviewState, incoming: ReviewState): ReviewState {
  const known = new Set(incoming.comments.map((c) => c.id));
  const outside = saved.comments.filter((c) => !known.has(c.id) && c.source !== 'reviewer');
  return outside.length === 0 ? incoming : { ...incoming, comments: [...incoming.comments, ...outside] };
}

export interface SendResult {
  /** 送った下書きの id */
  sent: string[];
  /** GitHub の PR の差分の画面。公開していないレビューを確かめて公開する場所 */
  url: string;
}

const PENDING_QUERY =
  'query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviews(states: PENDING, first: 100) { nodes { viewerDidAuthor } } } } }';

/** 自分が GitHub で公開していないレビュー（pending）の数 */
function pendingReviews(repo: string, t: GhTarget, number: number, run: RunGh): number {
  const fields = ['-F', `owner=${t.owner}`, '-F', `name=${t.name}`, '-F', `number=${number}`, '-f', `query=${PENDING_QUERY}`];
  const data = graphqlData(run(['api', 'graphql', '--hostname', t.host, ...fields], repo)) as { repository?: { pullRequest?: { reviews?: { nodes?: Array<{ viewerDidAuthor?: unknown }> } } | null } | null } | undefined;
  const nodes = data?.repository?.pullRequest?.reviews?.nodes;
  if (!Array.isArray(nodes)) throw new Error('GitHub の応答に PR のレビューがありません');
  return nodes.filter((n) => n.viewerDidAuthor === true).length;
}

/**
 * 採用済みの下書きを、GitHub で公開していない 1 つのレビュー（event を付けない = pending）にまとめて送る（12 章）。レビュアーが GitHub で確かめてから公開する。
 * GitHub は公開していないレビューを 1 つの PR に 1 人 1 つしか持てない（2 つ目は 422。2026-10-21 確認）ので、先に数え、あれば送らない。
 * 全部を行コメントで送る（範囲なら start_line / start_side）。レビュー全体の本文は付けない（GitHub の画面で Submit review すると消える。2026-10-21 確認）。
 * GitHub の差分に出ない行（Analysis.githubDiff の塊の外）の物は GitHub が行に付けられないので送らず、採用のまま残す。
 * 成功したら送った物だけを sent にして state を書く。失敗したら state は触らない。
 * 宛先は先に `gh pr view` で PR の URL から取り、`--hostname` で渡す（gh api はホストをリポジトリから決めない。pr.ts の GhTarget）
 */
export function sendComments(repo: string, key: string, headSha: string, run: RunGh): SendResult {
  const analysis = readAnalysis(repo, key, headSha);
  if (!analysis) throw new Error(`解析がありません: ${key} / ${headSha}`);
  if (key === 'local') throw new Error('ローカル解析（PR 番号なし）は GitHub に送れません');
  const state = readState(repo, key, headSha);
  const adopted = state.comments.filter((c) => c.state === 'adopted');
  if (adopted.length === 0) throw new Error('採用したコメントがありません');
  const lines = adopted.filter((c) => onGithubDiff(analysis.githubDiff, c) !== false);
  if (lines.length === 0) throw new Error('GitHub に送れるコメントがありません。GitHub の差分に出ない行のコメントは送れません');
  const review = {
    commit_id: headSha,
    comments: lines.map((c) =>
      c.startLine === undefined
        ? { path: c.path, line: c.line, side: c.side, body: c.body }
        : { path: c.path, start_line: c.startLine, start_side: c.startSide ?? c.side, line: c.line, side: c.side, body: c.body },
    ),
  };
  const t = targetFromGhJson(run(prUrlArgs(analysis.pr.number), repo));
  if (pendingReviews(repo, t, analysis.pr.number, run) > 0) {
    throw new Error('この PR には、GitHub で公開していない自分のレビューがあります。GitHub で公開するか破棄してから、もう一度送ってください。GitHub では、公開していないレビューは 1 つの PR に 1 つまでです');
  }
  const out = run(['api', `repos/${t.owner}/${t.name}/pulls/${analysis.pr.number}/reviews`, '--hostname', t.host, '--method', 'POST', '--input', '-'], repo, JSON.stringify(review));
  let url: unknown;
  try {
    url = (JSON.parse(out) as Record<string, unknown>)['html_url'];
  } catch {
    url = undefined;
  }
  if (typeof url !== 'string') throw new Error(`gh api の出力に html_url がありません: ${out.slice(0, 200)}`);
  const sent = new Set(lines.map((c) => c.id));
  writeState(repo, key, headSha, { ...state, comments: state.comments.map((c) => (sent.has(c.id) ? { ...c, state: 'sent' } : c)) });
  return { sent: [...sent], url: `${url.replace(/#.*$/, '')}/files` };
}

/** AI に返した 1 件（`comments wait` が JSON で出す形）。行番号は headSha の版のもの */
export interface ReturnedComment {
  headSha: string;
  path: string;
  /** 範囲なら最後の行 */
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  body: string;
  /** reviewer（レビュアーのメモ）か、採用した下書きを書いた AI（codex など） */
  source: string;
}

interface ReturnedBatch {
  headSha: string;
  returnedAt: string;
  comments: ReturnedComment[];
}

const returnedDir = (repo: string) => path.join(repo, '.ondina', 'local', 'returned');
const waitingDir = (repo: string) => path.join(repo, '.ondina', 'local', 'waiting');

/** pid のプロセスが生きているか（権限が無くて送れないのは、生きている） */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 採用済みの下書き（自分のメモを含む）を、この変更を作った AI に返す（local の解析だけ。12 章。2026-10-15）。
 * 受け箱に 1 ファイル書き、該当の下書きを sent にする。waiting は返した時点で `comments wait` が待っているか（画面が届くかどうかを伝える）
 */
export function returnComments(repo: string, headSha: string, opts: { now?: () => number; alive?: (pid: number) => boolean } = {}): { sent: string[]; waiting: boolean } {
  if (!readAnalysis(repo, 'local', headSha)) throw new Error(`解析がありません: local / ${headSha}`);
  const state = readState(repo, 'local', headSha);
  const adopted = state.comments.filter((c) => c.state === 'adopted');
  if (adopted.length === 0) throw new Error('採用したコメントがありません');
  const now = (opts.now ?? Date.now)();
  const batch: ReturnedBatch = {
    headSha,
    returnedAt: new Date(now).toISOString(),
    comments: adopted.map((c) => ({
      headSha,
      path: c.path,
      line: c.line,
      side: c.side,
      ...(c.startLine === undefined ? {} : { startLine: c.startLine, startSide: c.startSide ?? c.side }),
      body: c.body,
      source: c.source,
    })),
  };
  // 名前の順が返した順（時刻を桁をそろえて頭に置く）。同じ時刻なら番号を足す
  const stem = `${String(now).padStart(15, '0')}-${headSha.slice(0, 7)}`;
  let file = path.join(returnedDir(repo), `${stem}.json`);
  for (let n = 1; existsSync(file); n++) file = path.join(returnedDir(repo), `${stem}-${n}.json`);
  writeJsonAtomic(file, batch);
  const sent = new Set(adopted.map((c) => c.id));
  writeState(repo, 'local', headSha, { ...state, comments: state.comments.map((c) => (sent.has(c.id) ? { ...c, state: 'sent' } : c)) });
  return { sent: [...sent], waiting: isWaiting(repo, opts.alive) };
}

/**
 * 受け箱のまだ読んでいないものを返した順に全部取り出し、returned/done/ へ移す（二度渡さない）。
 * 先に done/ へ移せたものだけを読む。`comments wait` が 2 つ同時に動いていても、同じものを両方に渡さず、
 * ほかが先に移したファイル（一覧を取った後に消えた）は飛ばす。list はテスト用（一覧を取った後に消える場合）
 */
export function takeReturned(repo: string, list: (dir: string) => string[] = (d) => readdirSync(d)): ReturnedComment[] {
  const dir = returnedDir(repo);
  if (!existsSync(dir)) return [];
  const names = list(dir)
    .filter((n) => n.endsWith('.json'))
    .sort();
  const out: ReturnedComment[] = [];
  for (const name of names) {
    const taken = path.join(dir, 'done', name);
    mkdirSync(path.dirname(taken), { recursive: true });
    try {
      renameSync(path.join(dir, name), taken);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    const batch = readJson<ReturnedBatch>(taken);
    if (batch !== undefined) out.push(...batch.comments);
  }
  return out;
}

/** `comments wait` が待つ間の印を置く。外す関数を返す */
export function markWaiting(repo: string, pid: number): () => void {
  const file = path.join(waitingDir(repo), String(pid));
  mkdirSync(waitingDir(repo), { recursive: true });
  writeFileSync(file, `${new Date().toISOString()}\n`);
  return () => rmSync(file, { force: true });
}

/** 生きている pid の待ち印があるか（強制終了で残った印は数えない） */
export function isWaiting(repo: string, alive: (pid: number) => boolean = pidAlive): boolean {
  const dir = waitingDir(repo);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((n) => /^\d+$/.test(n) && alive(Number(n)));
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * PUT /api/state の本文の形。画面の設定（テーマ・左右 / 統合）は持たない（2026-10-11 に ui.json へ移した）。
 * 更新前から開いたままの画面は ui 付きで送るが、受ける（UI は読まない）
 */
const isStrings = (x: unknown): boolean => Array.isArray(x) && x.every((v) => typeof v === 'string');

/** 前の版からの引き継ぎの記録（任意） */
const isCarried = (x: unknown): boolean =>
  x === undefined || (isObj(x) && typeof x['from'] === 'string' && isStrings(x['reset']) && Array.isArray(x['coursesReset']) && x['coursesReset'].every((n) => Number.isInteger(n)) && isStrings(x['left']) && (x['dismissed'] === undefined || x['dismissed'] === true));

export function isReviewState(x: unknown): x is ReviewState {
  return isObj(x) && isStrings(x['viewed']) && Array.isArray(x['comments']) && isCarried(x['carried']);
}

export function isCommentsInput(x: unknown): x is CommentsInput {
  return (
    isObj(x) &&
    typeof x['source'] === 'string' &&
    typeof x['headSha'] === 'string' &&
    Array.isArray(x['comments']) &&
    x['comments'].every((c) => isObj(c) && typeof c['path'] === 'string' && typeof c['line'] === 'number' && (c['side'] === 'LEFT' || c['side'] === 'RIGHT') && typeof c['body'] === 'string')
  );
}

const isLineAt = (x: unknown): boolean => isObj(x) && (x['side'] === 'head' || x['side'] === 'base') && Number.isInteger(x['line']) && (x['line'] as number) > 0;
/** 選んだ行（任意）。あれば path と両端の side・行 */
const isLines = (x: unknown): boolean => x === undefined || (isObj(x) && typeof x['path'] === 'string' && isLineAt(x['start']) && isLineAt(x['end']));

const isPlace = (x: unknown): x is AskPlace => {
  if (!isObj(x)) return false;
  switch (x['kind']) {
    case 'pr':
      return true;
    case 'course':
      return Number.isInteger(x['courseId']);
    case 'symbol':
      return typeof x['symbolId'] === 'string' && (x['courseId'] === undefined || Number.isInteger(x['courseId'])) && isLines(x['lines']);
    case 'hunk':
      return typeof x['hunkId'] === 'string' && isLines(x['lines']);
    case 'file':
      return typeof x['path'] === 'string' && isLines(x['lines']);
    default:
      return false;
  }
};

/** POST /api/ask の本文の形（3.10）。key は場所の鍵（web が作る）、question は空白だけでないこと */
export function isAskRequest(x: unknown): x is { key: string; place: AskPlace; question: string } {
  return isObj(x) && typeof x['key'] === 'string' && x['key'] !== '' && typeof x['question'] === 'string' && x['question'].trim() !== '' && isPlace(x['place']);
}

const optString = (x: unknown): boolean => x === undefined || typeof x === 'string';
const optDiffMode = (x: unknown): boolean => x === undefined || x === 'sbs' || x === 'uni';

/** PUT /api/ui の本文の形。theme は mode（system / light / dark）と light・dark・accent の全部、diffMode は画面ごと（b / c / d）に任意、ticket の取り方は jira / command、keymap は操作の名前 → キーの配列、panes は列 → px、mapSpeed は正の数 */
export function isUiSettings(x: unknown): x is UiSettings {
  if (!isObj(x) || !optString(x['worktreeRoot']) || !optString(x['llmCommand']) || !optString(x['reviewCommand'])) return false;
  const keymap = x['keymap'];
  if (keymap !== undefined && !(isObj(keymap) && Object.values(keymap).every((keys) => Array.isArray(keys) && keys.every((k) => typeof k === 'string')))) return false;
  const panes = x['panes'];
  if (panes !== undefined && !(isObj(panes) && Object.values(panes).every((px) => typeof px === 'number' && Number.isFinite(px)))) return false;
  const speed = x['mapSpeed'];
  if (speed !== undefined && !(typeof speed === 'number' && Number.isFinite(speed) && speed > 0)) return false;
  const ticket = x['ticket'];
  if (ticket !== undefined && !(isObj(ticket) && (ticket['source'] === undefined || ticket['source'] === 'jira' || ticket['source'] === 'command') && optString(ticket['jiraUrl']) && optString(ticket['email']) && optString(ticket['command']))) return false;
  const theme = x['theme'];
  if (theme !== undefined && !(isObj(theme) && (theme['mode'] === 'system' || theme['mode'] === 'light' || theme['mode'] === 'dark') && typeof theme['light'] === 'string' && typeof theme['dark'] === 'string' && typeof theme['accent'] === 'string')) return false;
  const dm = x['diffMode'];
  return dm === undefined || (isObj(dm) && optDiffMode(dm['b']) && optDiffMode(dm['c']) && optDiffMode(dm['d']));
}
