// PR 一覧（設計書 3.11。2026-10-22）。行 = 作者、列 = レビューの状況、カードの中に解析の状態と AI レビューの状態。何を出すかを決める純粋関数。
// 画面の形はモックを比べて決めた（作者 × レビューの状況）。列分けは画面の都合なので CLI でなくここで決める（CLI は人ごとの事実だけ）。
import type { AnalysisSummary, AnalyzeJob, OpenPr, PrList, ReviewJob } from '@ondina/model';
import { aheadOf, jobOf } from './reanalyze.js';

/** 誰も見ていない / コメントあり（修正の依頼も入る）/ 承認あり（1 人でも。必要な承認の数は見ない） */
export type ReviewColumn = 'none' | 'commented' | 'approved';
export const REVIEW_COLUMNS: readonly ReviewColumn[] = ['none', 'commented', 'approved'];

export function reviewColumn(pr: OpenPr): ReviewColumn {
  if (pr.reviewers.some((r) => r.state === 'approved')) return 'approved';
  return pr.reviewers.some((r) => r.state === 'changes' || r.state === 'commented') ? 'commented' : 'none';
}

/** カードの解析の行。at は解析ファイルの更新時刻 */
export type PrAnalysisState =
  | { kind: 'none' }
  | { kind: 'queued'; ahead: number }
  | { kind: 'running'; startedAt: number; line?: string }
  /** PR の今の head を解析済み */
  | { kind: 'done'; headSha: string; at: number }
  /** 古い head だけ解析済み。headSha は一番新しい解析 */
  | { kind: 'stale'; headSha: string; at: number }
  | { kind: 'failed'; reason: string; last?: { headSha: string; at: number } };

export function prAnalysis(pr: OpenPr, analyses: readonly AnalysisSummary[], jobs: readonly AnalyzeJob[]): PrAnalysisState {
  const key = String(pr.number);
  const job = jobOf(jobs, key);
  if (job?.status === 'queued') return { kind: 'queued', ahead: aheadOf(jobs, key) };
  if (job?.status === 'running') return { kind: 'running', startedAt: job.startedAt, ...(job.line === undefined ? {} : { line: job.line }) };
  const mine = analyses.filter((a) => a.key === key);
  const current = mine.find((a) => a.headSha === pr.headSha);
  if (current) return { kind: 'done', headSha: current.headSha, at: current.mtime };
  const newest = mine.reduce<AnalysisSummary | undefined>((n, a) => (n === undefined || a.mtime > n.mtime ? a : n), undefined);
  const last = newest && { headSha: newest.headSha, at: newest.mtime };
  if (job?.status === 'failed') return { kind: 'failed', reason: job.reason, ...(last ? { last } : {}) };
  return last ? { kind: 'stale', ...last } : { kind: 'none' };
}

/** カードの AI の行。off = AI レビューのコマンドが空（カードには行を出さない） */
export type PrAiState =
  | { kind: 'off' }
  | { kind: 'none' }
  /** その PR の解析が終わったら始める */
  | { kind: 'waiting' }
  | { kind: 'running'; startedAt: number }
  /** PR の今の head をレビューした。drafts はその head の AI の下書きの数、skipped は GitHub の差分に出ない行なので入れなかった数 */
  | { kind: 'done'; headSha: string; drafts: number; skipped: number }
  /** レビューした後に PR の head が変わった */
  | { kind: 'stale'; headSha: string; drafts: number; skipped: number }
  | { kind: 'failed'; reason: string }
  | { kind: 'stopped' };

/** enabled = AI レビューのコマンドがある。空にしても、その PR のジョブがあれば出す（動いているレビューを止められるように） */
export function prAiReview(pr: OpenPr, reviews: readonly ReviewJob[], enabled: boolean): PrAiState {
  const job = reviews.find((j) => j.key === String(pr.number));
  switch (job?.status) {
    case undefined:
      return enabled ? { kind: 'none' } : { kind: 'off' };
    case 'waiting':
      return { kind: 'waiting' };
    case 'running':
      return { kind: 'running', startedAt: job.startedAt };
    case 'done':
      return { kind: job.headSha === pr.headSha ? 'done' : 'stale', headSha: job.headSha, drafts: job.drafts, skipped: job.skipped };
    case 'failed':
      return { kind: 'failed', reason: job.reason };
    case 'stopped':
      return { kind: 'stopped' };
  }
}

/** 解析待ちかレビュー中 */
export const reviewActive = (j: ReviewJob | undefined): boolean => j?.status === 'waiting' || j?.status === 'running';

/** PR の詳細の引き出しのタブ: 説明 / レビューとコメント / 変更したファイル / チェック */
export type DetailTab = 'desc' | 'talk' | 'files' | 'checks';

/** mine = あなた個人に依頼中の PR だけ、drafts = Draft も出す */
export interface PrFilter {
  mine: boolean;
  drafts: boolean;
}

export const DEFAULT_PR_FILTER: PrFilter = { mine: false, drafts: true };

export interface AuthorRow {
  author: string;
  cells: Record<ReviewColumn, OpenPr[]>;
}

const asked = (pr: OpenPr, viewer: string | null): boolean => pr.reviewers.some((r) => r.login === viewer && r.state === 'requested' && r.team !== true);
const newer = (a: OpenPr, b: OpenPr): number => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

/** 作者は一番新しい更新の順（あなたの PR は最後）、セルの中は更新の新しい順。PR の残らない作者は出さない */
export function prRows(list: PrList, filter: PrFilter): AuthorRow[] {
  const shown = list.prs.filter((p) => (filter.drafts || !p.draft) && (!filter.mine || asked(p, list.viewer))).sort(newer);
  const rows = new Map<string, AuthorRow>();
  for (const pr of shown) {
    const row = rows.get(pr.author) ?? { author: pr.author, cells: { none: [], commented: [], approved: [] } };
    row.cells[reviewColumn(pr)].push(pr);
    rows.set(pr.author, row);
  }
  const all = [...rows.values()];
  return [...all.filter((r) => r.author !== list.viewer), ...all.filter((r) => r.author === list.viewer)];
}

const DONE: Record<'approved' | 'changes' | 'commented', string> = { approved: 'あなた: 承認済み', changes: 'あなた: 修正を依頼済み', commented: 'あなた: コメント済み' };

/** カードのあなたの印。asked = まだ応えていない依頼。あなたの PR とログインが分からないときは出さない */
export function youOf(pr: OpenPr, viewer: string | null): { text: string; asked: boolean } | null {
  if (viewer === null || pr.author === viewer) return null;
  const me = pr.reviewers.find((r) => r.login === viewer && r.team !== true);
  if (me === undefined) return null;
  return me.state === 'requested' ? { text: 'あなたに依頼', asked: true } : { text: DONE[me.state], asked: false };
}

const AVATAR_COLORS = ['peach', 'teal', 'blue', 'pink', 'green', 'sapphire', 'yellow', 'lavender', 'flamingo', 'sky', 'maroon', 'mauve'] as const;

/** 作者の丸の色（Catppuccin の色の名前）。login から決まる */
export function avatarColor(login: string): string {
  let h = 0;
  for (const c of login) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** 経過（ms）の言い方 */
export function ago(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min} 分前`;
  const hours = Math.floor(min / 60);
  return hours < 24 ? `${hours} 時間前` : `${Math.floor(hours / 24)} 日前`;
}

/** かかった時間（秒）の言い方: 「45 秒」「3 分 5 秒」「1 時間 2 分」 */
export function duration(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  return min < 60 ? `${min} 分 ${sec % 60} 秒` : `${Math.floor(min / 60)} 時間 ${min % 60} 分`;
}
