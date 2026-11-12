// 読む前の案内と停留所の右の列の確かめること（設計書 3.3。2026-10-22）。fixture のコース 5（execute → find → Order → save → import → テスト 2）
import { describe, expect, it } from 'vitest';
import { callEdge, callerFacts, courseChecks, courseFlow, courseSpecs, lineLabel, nextReason, placeLabel } from '../src/brief.js';
import { courseOf, courses, OUTSIDE, stopInfo } from '../src/course.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const analysis = fixtureAnalysis();
const review = emptyReview();
const c5 = courseOf(courses(analysis), 5)!;
const infos = (r = review, a = analysis, c = c5) => c.steps.map((_, k) => stopInfo(a, c, k, r));

describe('placeLabel / lineLabel', () => {
  it('テストは「テスト」、ファイル単位はファイル名、ほかは名前の最後', () => {
    expect(infos().map(placeLabel)).toEqual(['execute', 'find', 'Order', 'save', 'ApplyDiscountUseCase.kt', 'テスト', 'テスト']);
  });

  it('続いた行は「18–19」、離れた行は「16, 20」', () => {
    expect(lineLabel([16])).toBe('16');
    expect(lineLabel([18, 19])).toBe('18–19');
    expect(lineLabel([16, 20, 21])).toBe('16, 20–21');
  });
});

describe('courseChecks', () => {
  it('番号は並びの順。場所は読む順の番号と「execute 17 行」の呼び名', () => {
    const cs = courseChecks(analysis, c5, infos());
    expect(cs.map((c) => c.n)).toEqual([1, 2, 3, 4]);
    expect(cs[1]!.at.map((a) => [a.k, a.label])).toEqual([
      [0, 'execute 17 行'],
      [2, 'Order 8 行'],
    ]);
    expect(cs[1]!.at[0]!.say).toBeTruthy();
  });

  it('場所を全部「問題なし」にした確かめることだけ seen', () => {
    const [execute, , , , , missing] = c5.steps;
    const one = { ...review, viewed: [execute!.hunkId!] };
    expect(courseChecks(analysis, c5, infos(one)).map((c) => c.seen)).toEqual([true, false, false, false]);
    const two = { ...review, viewed: [execute!.hunkId!, missing!.hunkId!] };
    expect(courseChecks(analysis, c5, infos(two))[3]!.seen).toBe(true);
  });

  it('古い解析・LLM の無い解析は空。停留所に無い場所は落とし、場所が残らない文は出さない', () => {
    const bare = fixtureAnalysis({ text: false });
    expect(courseChecks(bare, courseOf(courses(bare), 5)!, infos(review, bare, courseOf(courses(bare), 5)!))).toEqual([]);
    const a = fixtureAnalysis();
    const t5 = a.tours.find((t) => t.howId === 5)!;
    t5.checks = [{ text: '消えた場所', at: [{ symbolId: 'gone', lines: [1] }] }, ...t5.checks!];
    const cs = courseChecks(a, courseOf(courses(a), 5)!, infos(review, a, courseOf(courses(a), 5)!));
    expect(cs.map((c) => c.n)).toEqual([1, 2, 3, 4]);
    expect(cs[0]!.text).not.toBe('消えた場所');
  });
});

describe('courseFlow', () => {
  it('コース 5 はコース 6 から呼ばれ、コース 3 と 4 を呼ぶ。呼び出しでつながらないコース 1 は空', () => {
    expect(courseFlow(analysis, c5)).toEqual({ callers: [6], callees: [3, 4] });
    expect(courseFlow(analysis, courseOf(courses(analysis), 1)!)).toEqual({ callers: [], callees: [] });
  });
});

describe('callerFacts', () => {
  it('ほかのコースの差分が、このコースの停留所を呼ぶ。呼ぶ側ごとに 1 件、呼んでいる行の順', () => {
    const fs = callerFacts(analysis, c5, infos());
    expect(fs).toHaveLength(1);
    expect(fs[0]).toMatchObject({ course: 6, name: 'OrderController.apply', calls: [{ k: 0, line: 18 }, { k: 3, line: 19 }] });
    expect(fs[0]!.text).toBe('コース 6 の OrderController.apply が、18 行で execute、19 行で save を呼びます。');
  });

  it('このコースの停留所どうしの呼び出しと、テストからの呼び出しは数えない', () => {
    const c3 = courseOf(courses(analysis), 3)!;
    const fs = callerFacts(analysis, c3, infos(review, analysis, c3));
    expect(fs.map((f) => [f.course, f.name])).toEqual([[5, 'ApplyDiscountUseCase.execute']]);
  });

  it('呼んでいる行の無い辺（古い解析）は「行で」を付けない', () => {
    const a = fixtureAnalysis();
    for (const e of a.edges) delete e.lines;
    const c = courseOf(courses(a), 5)!;
    expect(callerFacts(a, c, infos(review, a, c))[0]!.text).toBe('コース 6 の OrderController.apply が、execute、save を呼びます。');
  });
});

describe('courseSpecs', () => {
  it('Spec.hows にこのコースがある要求の文', () => {
    const a = { ...analysis, specs: [{ id: 's1', text: '割引コードを 1 つ適用できる', hunkIds: [], hows: [5, 6] }, { id: 's2', text: '別の要求', hunkIds: [], hows: [3] }] };
    expect(courseSpecs(a, c5)).toEqual(['割引コードを 1 つ適用できる']);
  });
});

describe('callEdge / nextReason', () => {
  it('停留所を呼んでいる辺と、「execute の 16 行から」。始点は辺が無い。テストとファイル単位は種類で言う', () => {
    const xs = infos();
    expect(callEdge(analysis, xs[0]!)).toBeNull();
    expect(callEdge(analysis, xs[1]!)?.types?.in).toBe('OrderId');
    expect(xs.map((x) => nextReason(analysis, x))).toEqual(['', 'execute の 16 行から', 'execute の 17 行から', 'execute の 18 行から', 'ファイルの先頭（import など）', 'このコースのテスト', 'このコースのテスト']);
  });

  it('コース外の停留所には経路が無い', () => {
    const out = courseOf(courses(analysis), OUTSIDE)!;
    expect(nextReason(analysis, stopInfo(analysis, out, 0, review))).toBe('ファイルの先頭（import など）');
  });
});
