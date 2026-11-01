// 締め（設計書 3.9）の事実。数はプログラムが出す（原則 3）。fixture の数字は決めごとの見本（2026-10-03）で確かめたもの。
import type { CommentDraft } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { closingFacts } from '../src/closing.js';
import { courseOf, courses, OUTSIDE } from '../src/course.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const analysis = fixtureAnalysis();
const all = courses(analysis);
/** 7 本のコースを全部「問題なし · 次へ」で回った後（停留所の hunk だけが viewed。束の残りとコース外は見ていない） */
const stopHunks = [...new Set(all.filter((c) => c.id !== OUTSIDE).flatMap((c) => c.steps.map((s) => s.hunkId).filter((id): id is string => id !== undefined)))];

// Order.kt の 3 行目（head 側）は GitHub の差分の塊の中
const draft = (id: string, state: CommentDraft['state']): CommentDraft => ({ id, path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 3, side: 'RIGHT', body: id, source: 'test', state });

describe('closingFacts', () => {
  it('何も見ていなければ コース 0 / 7、問題なし 0 / 48、見ていない差分は 48 件全部', () => {
    const f = closingFacts(analysis, emptyReview());
    expect(f.courses).toEqual({ done: 0, total: 7 });
    expect(f.viewed).toEqual({ n: 0, total: 48 });
    expect(f.unseen).toHaveLength(48);
  });

  it('全部のコースを回った後: コース 7 / 7、問題なし 23 / 48、見ていない差分 25（束の残り 21 + PromoService + コース外 3）', () => {
    const review = { ...emptyReview(), viewed: stopHunks, course: { done: [], completed: [1, 2, 3, 4, 5, 6, 7] } };
    const f = closingFacts(analysis, review);
    expect(f.courses).toEqual({ done: 7, total: 7 });
    expect(f.viewed).toEqual({ n: 23, total: 48 });
    expect(f.unseen).toHaveLength(25);
    expect(f.unseen.filter((h) => h.hows.length === 0).map((h) => h.symbol)).toHaveLength(3);
  });

  it('見ていない差分は差分一覧と同じ並び（path 順）', () => {
    const paths = closingFacts(analysis, emptyReview()).unseen.map((h) => h.path);
    expect(paths).toEqual([...paths].sort());
  });

  it('完了の数にコース外は入れない（completed に 0 があっても数えない）', () => {
    const f = closingFacts(analysis, { ...emptyReview(), course: { done: [], completed: [OUTSIDE, 1] } });
    expect(f.courses).toEqual({ done: 1, total: 7 });
  });

  it('コース外はコースの並びの最後の物。未帰属が無ければ null', () => {
    expect(closingFacts(analysis, emptyReview()).outside).toEqual(courseOf(all, OUTSIDE));
    const a = fixtureAnalysis();
    a.hunks = a.hunks.map((h) => (h.hows.length === 0 ? { ...h, hows: [1] } : h));
    expect(closingFacts(a, emptyReview()).outside).toBeNull();
  });

  it('下書きは 採用 n / 生きている物 m（破棄・送信済は数えない）', () => {
    const comments = [draft('a', 'draft'), draft('b', 'edit'), draft('c', 'adopted'), draft('d', 'discarded'), draft('e', 'sent')];
    expect(closingFacts(analysis, { ...emptyReview(), comments }).drafts).toEqual({ adopted: 1, live: 3 });
  });

  it('自分のメモ（送信済を除く）は下書きと別に数え、送るコメントは メモ + 採用した下書き', () => {
    const memo = (id: string, state: CommentDraft['state']): CommentDraft => ({ ...draft(id, state), source: 'reviewer' });
    const comments = [memo('m1', 'adopted'), memo('m2', 'adopted'), memo('m3', 'sent'), draft('c', 'adopted'), draft('a', 'draft')];
    const f = closingFacts(analysis, { ...emptyReview(), comments });
    expect(f.memos).toBe(2);
    expect(f.drafts).toEqual({ adopted: 1, live: 2 });
    expect(f.toSend).toBe(3);
  });

  it('送るコメントに GitHub の差分に出ない行の採用は数えない（GitHub はこの行にコメントを付けられない）。差分の範囲が無い古い解析なら数える', () => {
    const off = (c: CommentDraft): CommentDraft => ({ ...c, path: 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt', line: 10 });
    const memo = (id: string): CommentDraft => ({ ...draft(id, 'adopted'), source: 'reviewer' });
    const comments = [memo('m1'), off(memo('m2')), draft('c', 'adopted'), off(draft('d', 'adopted'))];
    const f = closingFacts(analysis, { ...emptyReview(), comments });
    expect(f.toSend).toBe(2);
    const old = { ...analysis };
    delete old.githubDiff;
    expect(closingFacts(old, { ...emptyReview(), comments }).toSend).toBe(4);
  });
});
