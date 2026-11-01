// 締め（設計書 3.9）の事実。終えたコース・問題なしの数・見ていない差分・コース外・下書きとメモの数を、解析とレビューの状態から数える。
// 数はプログラムが出す（原則 3）。判断の語は入れない（原則 1）。
import type { Analysis, Hunk, ReviewState } from '@ondina/model';
import { courseOf, courses, OUTSIDE, type Course } from './course.js';
import { groupFiles } from './files.js';
import { isMemo, onGithubDiff } from './memo.js';

export interface ClosingFacts {
  /** 完了ボタンを押したコース / コースの数（コース外は数えない）。上の帯のメーターの「コース」（停留所を全部見たコース）とは別 */
  courses: { done: number; total: number };
  /** 問題なし（viewed）の hunk / hunk の数 */
  viewed: { n: number; total: number };
  /** 問題なしの付いていない hunk。差分一覧と同じ並び（path 順） */
  unseen: Hunk[];
  /** コース外（どの How にも属さない差分）。無ければ null */
  outside: Course | null;
  /** AI から受け取った下書き: 採用した物 / 生きている物（破棄・送信済を除く） */
  drafts: { adopted: number; live: number };
  /** 自分のメモ（送信済を除く。保存した時点で採用済み） */
  memos: number;
  /** 送るコメント = メモ + 採用した下書きのうち、GitHub の差分に出ない行の物を除いた数（GitHub はその行にコメントを付けられないので送らない） */
  toSend: number;
}

export function closingFacts(analysis: Analysis, review: Pick<ReviewState, 'viewed' | 'comments' | 'course'>): ClosingFacts {
  const all = courses(analysis);
  const real = all.filter((c) => c.id !== OUTSIDE);
  const completed = new Set(review.course?.completed ?? []);
  const viewed = new Set(review.viewed);
  const unseen = groupFiles(analysis.hunks, review.viewed)
    .flatMap((f) => f.hunks)
    .filter((h) => !viewed.has(h.id));
  const live = review.comments.filter((c) => !isMemo(c) && (c.state === 'draft' || c.state === 'edit' || c.state === 'adopted'));
  const memos = review.comments.filter((c) => isMemo(c) && c.state === 'adopted').length;
  const adopted = live.filter((c) => c.state === 'adopted').length;
  const toSend = review.comments.filter((c) => c.state === 'adopted' && onGithubDiff(analysis.githubDiff, c) !== false).length;
  return {
    courses: { done: real.filter((c) => completed.has(c.id)).length, total: real.length },
    viewed: { n: analysis.hunks.length - unseen.length, total: analysis.hunks.length },
    unseen,
    outside: courseOf(all, OUTSIDE) ?? null,
    drafts: { adopted, live: live.length },
    memos,
    toSend,
  };
}
