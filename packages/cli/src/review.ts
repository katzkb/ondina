// PR 一覧から AI にレビューを頼む（設計書 3.11 / 5.5。2026-10-22）。
// serve が設定の「AI レビューのコマンド」（UiSettings.reviewCommand）を PR ごとに sh -c で起動し、stdin に指示文（core の renderReviewPrompt）、
// 環境変数に ONDINA_PR / ONDINA_BASE_SHA / ONDINA_HEAD_SHA を渡す。stdout の JSON（12 章の CommentsInput）を AI の下書きとして入れる。
// 解析の列とは別で、いくつでも同時に走る（押したのはレビュアー）。その PR の解析が順番待ちか解析中なら終わるまで待ち、
// 今の head の解析が無ければ先に解析を列に入れる（指示文の base の sha と GitHub の差分の塊は、解析から取るため）。
// `ondina comments add` は差分に出ない行が 1 件でもあれば丸ごと断る（AI が直して渡し直せる）。このジョブは 1 回きりで渡し直せないので、
// 差分に出ない行のコメントだけを除いて残りを入れ、除いた数をジョブに残す
import { extractJson, onGithubDiff, renderReviewPrompt } from '@ondina/core';
import type { Analysis, CommentDraft, CommentsInput, ReviewJob } from '@ondina/model';
import { runLlmCommand, type LlmRunResult } from './llm.js';
import type { AnalyzeRunner } from './reanalyze.js';
import { addComments, isCommentsInput, listAnalyses, readAnalysis, readState, readUi } from './store.js';

/** 30 分。エージェントが道具で差分とファイルを何度も読んでも打ち切られない程度 */
export const REVIEW_TIMEOUT_MS = 30 * 60 * 1000;

export interface ReviewDeps {
  now: () => number;
  timeoutMs: number;
}

export interface ReviewRunner {
  /**
   * PR（key）の headSha をレビューする。今の head の解析があり、その PR の解析が動いていなければすぐ走る。
   * 解析が動いていれば終わるのを待ち、解析が無ければ先に列に入れて待つ（waiting）。解析が終わったら、解析した head をレビューする。
   * 同じ key が解析待ちかレビュー中なら busy、コマンドが空なら nocommand、PR 番号でなければ missing
   */
  start(key: string, headSha: string): ReviewJob | { error: 'busy' | 'missing' | 'nocommand' };
  /** 解析待ちかレビュー中なら stopped にする（レビュー中はコマンドをプロセスグループごと止める。解析は続ける）。動いていなければ undefined */
  stop(key: string): ReviewJob | undefined;
  /** key ごとの最新。done の下書きの数は聞くたびに今の state から数え直す（レビュアーが採用・破棄すると変わる） */
  jobs(): ReviewJob[];
}

const PR_KEY = /^[1-9][0-9]*$/;
const OPEN: ReadonlySet<CommentDraft['state']> = new Set(['draft', 'edit', 'adopted']);

export function createReviewRunner(repo: string, analyze: AnalyzeRunner, deps: Partial<ReviewDeps> = {}): ReviewRunner {
  const d: ReviewDeps = { now: () => Date.now(), timeoutMs: REVIEW_TIMEOUT_MS, ...deps };
  const latest = new Map<string, ReviewJob>();
  const stops = new Map<string, AbortController>();
  // 止めた後に届く終わり（コマンド・解析）で、新しいジョブを書き換えない
  const settle = (from: ReviewJob, next: ReviewJob): void => {
    if (latest.get(from.key) === from) latest.set(from.key, next);
  };
  const drafts = (key: string, headSha: string): number => readState(repo, key, headSha).comments.filter((c) => c.source !== 'reviewer' && OPEN.has(c.state)).length;

  const launch = (key: string, headSha: string, command: string): void => {
    const analysis = readAnalysis(repo, key, headSha);
    if (!analysis) {
      latest.set(key, { status: 'failed', key, headSha, reason: `${headSha.slice(0, 7)} の解析がありません` });
      return;
    }
    const job: ReviewJob = { status: 'running', key, headSha, startedAt: d.now() };
    latest.set(key, job);
    const stop = new AbortController();
    stops.set(key, stop);
    const { pr } = analysis;
    const prompt = renderReviewPrompt({ number: pr.number, title: pr.title, base: pr.base, head: pr.head, baseSha: pr.baseSha, headSha });
    const env = { ...process.env, ONDINA_PR: String(pr.number), ONDINA_BASE_SHA: pr.baseSha, ONDINA_HEAD_SHA: headSha };
    void runLlmCommand(command, prompt, repo, d.timeoutMs, stop.signal, env).then((run) => {
      if (stops.get(key) === stop) stops.delete(key);
      let next: ReviewJob;
      try {
        next = finish(analysis, key, headSha, run);
      } catch (e) {
        next = { status: 'failed', key, headSha, reason: e instanceof Error ? e.message : String(e) };
      }
      settle(job, next);
    });
  };

  const finish = (analysis: Analysis, key: string, headSha: string, run: LlmRunResult): ReviewJob => {
    const failed = (reason: string): ReviewJob => ({ status: 'failed', key, headSha, reason });
    if (run.aborted) return { status: 'stopped', key, headSha };
    if (run.timedOut) return failed(`${Math.round(d.timeoutMs / 60_000)} 分で終わりませんでした`);
    if (run.exitCode !== 0) return failed(run.stderr.trim().split('\n').pop()?.trim() || `終了コード ${run.exitCode ?? 'なし'} で終了しました`);
    const parsed = parseReviewOutput(run.stdout, headSha);
    if ('error' in parsed) return failed(parsed.error);
    const comments = parsed.input?.comments ?? [];
    const onDiff = comments.filter((c) => onGithubDiff(analysis.githubDiff, c) !== false);
    if (parsed.input && onDiff.length > 0) addComments(repo, { ...parsed.input, comments: onDiff }, key);
    return { status: 'done', key, headSha, drafts: drafts(key, headSha), skipped: comments.length - onDiff.length };
  };

  return {
    jobs: () => [...latest.values()].map((j) => (j.status === 'done' ? { ...j, drafts: drafts(j.key, j.headSha) } : j)),
    start(key, headSha) {
      if (!PR_KEY.test(key)) return { error: 'missing' };
      const cur = latest.get(key);
      if (cur?.status === 'waiting' || cur?.status === 'running') return { error: 'busy' };
      const command = readUi(repo).reviewCommand?.trim() ?? '';
      if (command === '') return { error: 'nocommand' };
      const job = analyze.jobs().find((j) => j.key === key);
      const analyzing = job?.status === 'queued' || job?.status === 'running';
      if (!analyzing && readAnalysis(repo, key, headSha)) {
        launch(key, headSha, command);
        return latest.get(key)!;
      }
      if (!analyzing) {
        // 前の head の解析があれば、その引数で解析し直す（画面の「解析し直す」と同じ。--ticket で指定したチケットを引き継ぐ）
        const last = listAnalyses(repo).find((a) => a.key === key);
        const queued = analyze.start(key, last?.headSha);
        if ('error' in queued) {
          const failed: ReviewJob = { status: 'failed', key, headSha, reason: '解析を始められませんでした' };
          latest.set(key, failed);
          return failed;
        }
      }
      const waiting: ReviewJob = { status: 'waiting', key, headSha };
      latest.set(key, waiting);
      void analyze.finished(key).then((done) => {
        if (latest.get(key) !== waiting) return;
        if (done?.status === 'done') launch(key, done.headSha, command);
        else settle(waiting, { status: 'failed', key, headSha, reason: `解析できませんでした: ${done?.status === 'failed' ? done.reason : '結果がありません'}` });
      });
      return waiting;
    },
    stop(key) {
      const cur = latest.get(key);
      if (cur?.status !== 'waiting' && cur?.status !== 'running') return undefined;
      const stopped: ReviewJob = { status: 'stopped', key, headSha: cur.headSha };
      latest.set(key, stopped);
      stops.get(key)?.abort();
      stops.delete(key);
      return stopped;
    },
  };
}

/**
 * コマンドの stdout を 12 章の JSON として読む（前後の文やコードフェンスは外す）。headSha が無ければ補う。
 * 空なら入れる物は無い（エージェントが自分で ondina comments add を実行したかもしれないので、失敗にしない）
 */
function parseReviewOutput(stdout: string, headSha: string): { input?: CommentsInput } | { error: string } {
  if (stdout.trim() === '') return {};
  const json = extractJson(stdout);
  let doc: unknown;
  try {
    doc = json === undefined ? undefined : (JSON.parse(json) as unknown);
  } catch {
    doc = undefined;
  }
  // 出力の先頭も理由に出す（エージェントは JSON の代わりに文で答えることがある。コピー&ペーストできない環境では、serve の外の出力を貼れない）
  const said = stdout.trim().replace(/\s+/g, ' ');
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { error: `stdout に JSON オブジェクトがありません（出力の先頭: ${said.length > 120 ? `${said.slice(0, 120)}…` : said}）` };
  const input: unknown = { headSha, ...doc };
  if (!isCommentsInput(input)) return { error: 'コメント JSON の形式ではありません（source / headSha / comments[]）' };
  if (input.headSha !== headSha) return { error: `JSON の headSha（${input.headSha}）が、レビューを頼んだ head（${headSha}）と違います` };
  return { input };
}
