// メモ（設計書 3.3 / 12 章）の純粋関数: 選んだ範囲、GitHub の差分に出る行か、行の書き方、保存する下書き、停留所との結び付け（印と「開く」）
import type { CommentDraft, GithubDiffFile } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { courseOf, courses } from '../src/course.js';
import { courseDrafts, courseMemos, isMemo, isOpenDraft, memoPlace, memoStop, mergeDraft, newMemo, onGithubDiff, pickFor, pickSpan, spanLabel, type MemoPick } from '../src/memo.js';
import { fixtureAnalysis } from './fixture.js';

const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
const CTRL = 'src/main/kotlin/com/example/order/api/OrderController.kt';
// fixture の GitHub の差分（2026-10-06 に本物の PR と一致を確認した塊）
const DIFF: GithubDiffFile[] = [
  { path: CTRL, hunks: [{ oldStart: 5, oldLines: 6, newStart: 5, newLines: 7 }, { oldStart: 13, oldLines: 8, newStart: 14, newLines: 9 }] },
  { path: ORDER, hunks: [{ oldStart: 3, oldLines: 9, newStart: 3, newLines: 12 }] },
];
const at = (side: 'LEFT' | 'RIGHT', line: number, order: number) => ({ side, line, order });

describe('pickSpan', () => {
  it('画面の上にある方が始まり（上へなぞっても入れ替える）', () => {
    const pick: MemoPick = { path: ORDER, anchor: at('RIGHT', 11, 12), head: at('RIGHT', 8, 9) };
    expect(pickSpan(pick)).toEqual({ start: at('RIGHT', 8, 9), end: at('RIGHT', 11, 12) });
  });

  it('1 行なら始まりと終わりが同じ', () => {
    const p = at('LEFT', 6, 3);
    expect(pickSpan({ path: ORDER, anchor: p, head: p })).toEqual({ start: p, end: p });
  });
});

describe('onGithubDiff', () => {
  const c = (over: Partial<CommentDraft>) => ({ path: CTRL, line: 11, side: 'RIGHT' as const, ...over });

  it('塊の端の文脈行（変更から 3 行目）は入る、塊の間の行は入らない', () => {
    expect(onGithubDiff(DIFF, c({ line: 11 }))).toBe(true);
    expect(onGithubDiff(DIFF, c({ line: 12 }))).toBe(false);
  });

  it('範囲は始まりと終わりがどちらも塊に入れば入る（2 つの塊にまたがってもよい）。始まりが外なら入らない', () => {
    expect(onGithubDiff(DIFF, c({ startLine: 10, startSide: 'RIGHT', line: 15 }))).toBe(true);
    expect(onGithubDiff(DIFF, c({ startLine: 12, startSide: 'RIGHT', line: 15 }))).toBe(false);
  });

  it('base 側の行は oldStart / oldLines で見る', () => {
    expect(onGithubDiff(DIFF, { path: ORDER, line: 11, side: 'LEFT' })).toBe(true);
    expect(onGithubDiff(DIFF, { path: ORDER, line: 12, side: 'LEFT' })).toBe(false);
    expect(onGithubDiff(DIFF, { path: ORDER, startLine: 6, startSide: 'LEFT', line: 11, side: 'RIGHT' })).toBe(true);
  });

  it('差分の無いファイル（変わっていない場所）は入らない', () => {
    expect(onGithubDiff(DIFF, { path: 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt', line: 10, side: 'RIGHT' })).toBe(false);
  });

  it('GitHub の差分の範囲が無い解析（local と古い解析）は決めない（どの行にも書けて、送れる）', () => {
    expect(onGithubDiff(undefined, c({ line: 12 }))).toBeUndefined();
  });
});

describe('spanLabel', () => {
  it('1 行 / 範囲 / base 側 / base から head にまたがる範囲', () => {
    expect(spanLabel({ line: 13, side: 'RIGHT' })).toBe('13 行目');
    expect(spanLabel({ startLine: 8, startSide: 'RIGHT', line: 11, side: 'RIGHT' })).toBe('8〜11 行目');
    expect(spanLabel({ line: 6, side: 'LEFT' })).toBe('6 行目（base 側）');
    expect(spanLabel({ startLine: 6, startSide: 'LEFT', line: 11, side: 'RIGHT' })).toBe('base 6 行目〜head 11 行目');
  });

  it('head 側の行から下の消した行への範囲は、始まりを head、終わりを base で書く（統合表示で変わらない行から下の消した行までなぞった）', () => {
    expect(spanLabel({ startLine: 3, startSide: 'RIGHT', line: 10, side: 'LEFT' })).toBe('head 3 行目〜base 10 行目');
  });
});

describe('newMemo', () => {
  it('レビュアーのメモとして採用済みで作る。id は m と通し番号', () => {
    const pick: MemoPick = { path: ORDER, anchor: at('RIGHT', 8, 9), head: at('RIGHT', 11, 12) };
    const prev: CommentDraft[] = [{ id: 'm2', path: ORDER, line: 13, side: 'RIGHT', body: 'x', source: 'reviewer', state: 'adopted' }, { id: 'abc123', path: ORDER, line: 3, side: 'RIGHT', body: 'y', source: 'claude-code', state: 'draft' }];
    expect(newMemo(prev, pick, '  上書きになる？  ')).toEqual({ id: 'm3', path: ORDER, startLine: 8, startSide: 'RIGHT', line: 11, side: 'RIGHT', body: '上書きになる？', source: 'reviewer', state: 'adopted' });
  });

  it('1 行なら startLine を付けない', () => {
    const p = at('RIGHT', 10, 1);
    expect(newMemo([], { path: 'a.kt', anchor: p, head: p }, 'x')).toEqual({ id: 'm1', path: 'a.kt', line: 10, side: 'RIGHT', body: 'x', source: 'reviewer', state: 'adopted' });
  });
});

describe('isMemo', () => {
  it('source が reviewer の物だけ', () => {
    expect(isMemo({ source: 'reviewer' })).toBe(true);
    expect(isMemo({ source: 'claude-code' })).toBe(false);
  });
});

describe('memoPlace / courseMemos / memoStop（メモの印と「開く」の行き先）', () => {
  const analysis = fixtureAnalysis();
  const c3 = courseOf(courses(analysis), 3)!;
  const POLICY = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';
  const TEST = 'src/test/kotlin/com/example/order/domain/OrderTest.kt';
  const memo = (id: string, path: string, line: number, side: 'LEFT' | 'RIGHT' = 'RIGHT', over: Partial<CommentDraft> = {}): CommentDraft => ({ id, path, line, side, body: id, source: 'reviewer', state: 'adopted', ...over });

  // 2026-10-11: 停留所は差分だけ。コース 3 は Order・束の代表（OrderAdminView）・テスト 2 本。差分の無い DiscountPolicy.kt はどの停留所にも無い
  it('メモの行が見える最初の停留所（前後 3 行。base 側の行は消した行で見る）。差分の無いファイルは null', () => {
    expect(memoPlace(analysis, c3, memo('a', ORDER, 13))).toEqual({ k: 0, full: false });
    expect(memoPlace(analysis, c3, memo('b', ORDER, 8, 'LEFT'))).toEqual({ k: 0, full: false });
    expect(memoPlace(analysis, c3, memo('c', POLICY, 10))).toBeNull();
    // OrderTest.kt の 18 行目は 3 か所目（10〜21 行目）と 4 か所目（17〜26 行目）の両方で見える。最初の方
    expect(memoPlace(analysis, c3, memo('d', TEST, 18))).toEqual({ k: 2, full: false });
  });

  it('どの停留所の前後にも入らなければ、同じファイルを通る最初の停留所をファイル全体で。通らなければ null', () => {
    expect(memoPlace(analysis, c3, memo('a', POLICY, 2))).toBeNull();
    expect(memoPlace(analysis, c3, memo('b', TEST, 5))).toEqual({ k: 2, full: true });
    expect(memoPlace(analysis, c3, memo('c', CTRL, 11))).toBeNull();
  });

  it('courseMemos は停留所ごとのメモ（1 件を 2 か所で数えない）。行の上から順、AI の下書きと差分の無いファイルのメモは入れない', () => {
    const comments = [memo('m1', TEST, 18), memo('m2', ORDER, 13), memo('m3', ORDER, 8, 'LEFT'), memo('m4', POLICY, 2), memo('c1', ORDER, 3, 'RIGHT', { source: 'claude-code', state: 'draft' }), memo('m5', CTRL, 11)];
    expect(courseMemos(analysis, c3, comments).map((list) => list.map((m) => m.id))).toEqual([['m3', 'm2'], [], ['m1'], []]);
  });

  it('courseDrafts は停留所ごとの AI の下書き（置き場所はメモと同じ）。状態を問わず入れ、自分のメモと差分の無いファイルの下書きは入れない', () => {
    const ai = (id: string, path: string, line: number, side: 'LEFT' | 'RIGHT', state: CommentDraft['state']) => memo(id, path, line, side, { source: 'codex', state });
    const comments = [ai('d1', TEST, 18, 'RIGHT', 'draft'), ai('d2', ORDER, 13, 'RIGHT', 'adopted'), ai('d3', ORDER, 8, 'LEFT', 'discarded'), ai('d4', POLICY, 2, 'RIGHT', 'draft'), memo('m1', ORDER, 10), ai('d5', ORDER, 10, 'RIGHT', 'edit')];
    expect(courseDrafts(analysis, c3, comments).map((list) => list.map((m) => m.id))).toEqual([['d3', 'd5', 'd2'], [], ['d1'], []]);
  });

  it('isOpenDraft は、まだ採用も破棄もしていない AI の下書き（draft と edit）。自分のメモは入れない', () => {
    const states: CommentDraft['state'][] = ['draft', 'edit', 'adopted', 'discarded', 'sent'];
    expect(states.map((state) => isOpenDraft(memo('d', ORDER, 3, 'RIGHT', { source: 'codex', state })))).toEqual([true, true, false, false, false]);
    expect(isOpenDraft(memo('m', ORDER, 3, 'RIGHT', { state: 'draft' }))).toBe(false);
  });

  it('memoStop はどれかのコースで見える停留所を先に探し、無ければファイル全体で開く停留所。差分の無いファイルは null（引き出しで開く）', () => {
    expect(memoStop(analysis, memo('a', TEST, 18))).toEqual({ courseId: 3, i: 2, full: false });
    expect(memoStop(analysis, memo('b', POLICY, 10))).toBeNull();
    expect(memoStop(analysis, memo('c', 'src/main/kotlin/com/example/order/domain/OrderRepository.kt', 1))).toBeNull();
    expect(memoStop(analysis, memo('d', 'README.md', 1))).toBeNull();
  });
});

describe('pickFor（案内人の答えの「メモにする」で、聞いた行を着いた画面で選び直す。3.10）', () => {
  const analysis = fixtureAnalysis();
  const course3 = courseOf(courses(analysis), 3)!;
  const L = (start: ['head' | 'base', number], end: ['head' | 'base', number], path = ORDER) => ({ path, start: { side: start[0], line: start[1] }, end: { side: end[0], line: end[1] } });
  const orderHunks = analysis.hunks.filter((h) => h.path === ORDER);

  it('停留所の画面: 並びはファイル全体の行の何番目か（FileView と同じ数え方）', () => {
    expect(pickFor(analysis, { kind: 'stop', course: course3, k: 0 }, L(['head', 8], ['head', 11]))).toEqual({ path: ORDER, anchor: at('RIGHT', 8, 9), head: at('RIGHT', 11, 12) });
    expect(pickFor(analysis, { kind: 'stop', course: course3, k: 0 }, L(['base', 6], ['head', 6]))).toEqual({ path: ORDER, anchor: at('LEFT', 6, 5), head: at('RIGHT', 6, 6) });
    expect(pickFor(analysis, { kind: 'stop', course: course3, k: 0 }, L(['head', 1], ['head', 1]))).toEqual({ path: ORDER, anchor: at('RIGHT', 1, 0), head: at('RIGHT', 1, 0) });
  });

  it('差分一覧: 並びはそのファイルの差分の行の何番目か（rows.ts の base + i と同じ）', () => {
    expect(pickFor(analysis, { kind: 'diff', hunks: orderHunks }, L(['head', 8], ['head', 11]))).toEqual({ path: ORDER, anchor: at('RIGHT', 8, 7), head: at('RIGHT', 11, 10) });
    expect(pickFor(analysis, { kind: 'diff', hunks: orderHunks }, L(['base', 6], ['head', 6]))).toEqual({ path: ORDER, anchor: at('LEFT', 6, 3), head: at('RIGHT', 6, 4) });
  });

  it('その画面に無い行・別のファイルなら null（行を選び直せない）', () => {
    expect(pickFor(analysis, { kind: 'diff', hunks: orderHunks }, L(['head', 1], ['head', 2]))).toBeNull();
    expect(pickFor(analysis, { kind: 'diff', hunks: analysis.hunks.filter((h) => h.path === CTRL) }, L(['head', 8], ['head', 11]))).toBeNull();
    expect(pickFor(analysis, { kind: 'stop', course: course3, k: 1 }, L(['head', 8], ['head', 11]))).toBeNull();
  });
});

describe('mergeDraft（質問の文を書く枠に入れる。3.10）', () => {
  it('空なら質問の文だけ', () => {
    expect(mergeDraft('', 'q?')).toBe('q?');
    expect(mergeDraft('  \n', 'q?')).toBe('q?');
  });

  it('書きかけは消さず、改行して後ろに足す。同じ文がもう入っていれば足さない', () => {
    expect(mergeDraft('ここは確認したい。\n', 'q?')).toBe('ここは確認したい。\nq?');
    expect(mergeDraft('ここは確認したい。\nq?', 'q?')).toBe('ここは確認したい。\nq?');
  });
});
