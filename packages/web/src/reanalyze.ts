// 画面から解析し直す（設計書 3.0 の帯の下の 1 行。2026-10-13）。帯の下に何を出すかを状態から決める純粋関数。
// 置き場所・知らせ方・切り替え方は動く見本を比べて決めた（見つけたら知らせる・知らせて待つ・帯の下に 1 行）。
// serve の解析の列（順番待ち・解析中・終わったもの。PR 一覧 3.11 と共有。2026-10-22）の読み方もここに置く。
import type { AnalysisSummary, AnalyzeJob, LatestHead, ReviewState } from '@ondina/model';

/** 新しい head を聞いた答え。どの版について聞いたか（key / headSha）を持ち、別の版の答えは使わない */
export interface LatestFor {
  key: string;
  headSha: string;
  head: LatestHead;
}

export interface ReanalyzeUi {
  latest: LatestFor | null;
  /** serve の解析（key ごとの最新。並びは serve と同じ 順番待ち → 解析中 → 終わったもの）と、serve に頼めなかった失敗 */
  jobs: AnalyzeJob[];
  /** 同じ版を解析し直して読み直した（上の帯のボタン）。閉じるか別の版を開くまで知らせる */
  redone: { key: string; headSha: string } | null;
}

export const NO_REANALYZE: ReanalyzeUi = { latest: null, jobs: [], redone: null };

/** 順番待ちか解析中 */
export const isActive = (j: AnalyzeJob | undefined): boolean => j?.status === 'queued' || j?.status === 'running';

export const jobOf = (jobs: readonly AnalyzeJob[], key: string): AnalyzeJob | undefined => jobs.find((j) => j.key === key);

/** その key の前にいる数（解析中と、列で前に並んでいるもの） */
export function aheadOf(jobs: readonly AnalyzeJob[], key: string): number {
  const at = jobs.filter((j) => j.status === 'queued').findIndex((j) => j.key === key);
  return jobs.filter((j) => j.status === 'running').length + Math.max(at, 0);
}

/** 押したときに serve と同じ決まりで列に入れる（返事を待たずに出す）。何か走っていれば順番待ちの後ろ、無ければ解析中 */
export function enqueue(jobs: readonly AnalyzeJob[], key: string, from: string | undefined, now: number): AnalyzeJob[] {
  const who = from === undefined ? { key } : { key, from };
  const rest = jobs.filter((j) => j.key !== key);
  if (!rest.some(isActive)) return [{ status: 'running', ...who, startedAt: now }, ...rest];
  return [...rest.filter((j) => j.status === 'queued'), { status: 'queued', ...who, queuedAt: now }, ...rest.filter((j) => j.status !== 'queued')];
}

/** serve の答えが正。serve に頼めなかった失敗（serve が知らない key）だけは、その key をまた始めるまで残す（解析と AI レビューで共有） */
export function mergeJobs<J extends { key: string; status: string }>(local: readonly J[], served: readonly J[]): J[] {
  return [...served, ...local.filter((j) => j.status === 'failed' && !served.some((s) => s.key === j.key))];
}

/** 前は順番待ちか解析中で、今は終わった（done）ジョブ */
export const finished = (before: readonly AnalyzeJob[], after: readonly AnalyzeJob[]): AnalyzeJob[] => after.filter((j) => j.status === 'done' && isActive(jobOf(before, j.key)));

export type Strip =
  /** 解析し直している。startedAt から経過を数える。line は最後の進み */
  | { kind: 'running'; startedAt: number; line?: string }
  /** 解析し直しが順番待ち。ahead = 前にいる数（解析中を含む） */
  | { kind: 'queued'; key: string; ahead: number }
  | { kind: 'failed'; reason: string }
  /** 新しいコミットを見つけた（まだ解析していない）。workingTree = 作業ツリーの解析で、作業ツリーが変わった（コミットではない。5.1） */
  | { kind: 'noticed'; from: string; to: string; newCommits?: number; workingTree?: true }
  /** 新しいバージョンの解析がある。changed は変わった差分の数（聞き直す前は無い） */
  | { kind: 'ready'; to: string; changed?: number }
  /** 同じ版を解析し直して読み直した */
  | { kind: 'redone'; to: string }
  /** 前のバージョンから引き継いだ。reset = 未確認に戻した差分の数、courses = 未完了に戻したコース、left = 前のバージョンに残したメモの数 */
  | { kind: 'switched'; to: string; reset: number; courses: number[]; left: number };

export function stripOf(s: { current: AnalysisSummary | null; review: ReviewState | null; reanalyze: ReanalyzeUi }): Strip | null {
  const cur = s.current;
  if (cur === null) return null;
  const { jobs, latest } = s.reanalyze;
  const job = jobOf(jobs, cur.key);
  if (job?.status === 'running') return { kind: 'running', startedAt: job.startedAt, ...(job.line === undefined ? {} : { line: job.line }) };
  if (job?.status === 'queued') return { kind: 'queued', key: cur.key, ahead: aheadOf(jobs, cur.key) };
  if (job?.status === 'failed' && job.from === cur.headSha) return { kind: 'failed', reason: job.reason };
  if (latest !== null && latest.key === cur.key && latest.headSha === cur.headSha && latest.head.headSha !== cur.headSha) {
    const h = latest.head;
    if (h.analyzed) return { kind: 'ready', to: h.headSha, ...(h.changed === undefined ? {} : { changed: h.changed }) };
    return { kind: 'noticed', from: cur.headSha, to: h.headSha, ...(h.newCommits === undefined ? {} : { newCommits: h.newCommits }), ...(cur.pr.workingTree ? { workingTree: true as const } : {}) };
  }
  const r = s.reanalyze.redone;
  if (r !== null && r.key === cur.key && r.headSha === cur.headSha) return { kind: 'redone', to: cur.headSha };
  const c = s.review?.carried;
  if (c !== undefined && c.dismissed !== true) return { kind: 'switched', to: cur.headSha, reset: c.reset.length, courses: c.coursesReset, left: c.left.length };
  return null;
}

/** 経過時間（m:ss） */
export function clock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
