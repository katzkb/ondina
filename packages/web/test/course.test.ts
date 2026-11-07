// コース（設計書 3.3）の並びと停留所の情報。fixture の数字は承認したデモで確かめたもの（2026-09-29 の handover）。
import { describe, expect, it } from 'vitest';
import { courseColorVars, courseIntro, courseOf, courseRipples, courses, firstUnseen, nextCourse, OUTSIDE, stopAfter, stopBefore, stopInfo } from '../src/course.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const analysis = fixtureAnalysis();
const all = courses(analysis);
const review = emptyReview();
const byName = (courseId: number, name: string, a = analysis) => {
  const c = courseOf(courses(a), courseId)!;
  const k = c.steps.findIndex((_, i) => stopInfo(a, c, i, review).name === name);
  return stopInfo(a, c, k, review);
};
/** 2 回目の LLM（文を書く）が無い解析。案内は事実から組んだ自動の文 */
const bare = fixtureAnalysis({ text: false });
const bareAll = courses(bare);

describe('courses', () => {
  // 2026-10-11: 停留所は差分だけ（コース 3 は 5 → 4、コース 5 は 9 → 7、コース 6 は 8 → 7）
  it('How の順に 7 本、最後にコース外。停留所は読む順番（tours）のまま', () => {
    expect(all.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7, OUTSIDE]);
    expect(all.map((c) => c.steps.length)).toEqual([1, 2, 4, 5, 7, 7, 3, 3]);
    expect(all.map((c) => c.hunkIds.length)).toEqual([1, 2, 26, 5, 4, 4, 3, 3]);
  });

  it('コース外は未帰属の hunk 3 件を停留所にする', () => {
    const outside = courseOf(all, OUTSIDE)!;
    expect(outside.title).toBe('コースに入っていない場所');
    expect(outside.steps.map((_, k) => stopInfo(analysis, outside, k, review).name)).toEqual(['Logger.kt', 'Logger.format', 'FeatureFlags.DISCOUNT_V2']);
  });

  it('古い解析の経路に残る差分の無い停留所は落とす（再解析しなくても差分だけを回る）', () => {
    const a = fixtureAnalysis();
    const rateFor = a.symbols.find((s) => s.fqName.endsWith('DiscountPolicy.rateFor'))!.id;
    const t3 = a.tours.find((t) => t.howId === 3)!;
    t3.steps.splice(1, 0, { symbolId: rateFor, call: 'domain.Order → DiscountPolicy.rateFor(String)' });
    const c3 = courseOf(courses(a), 3)!;
    expect(c3.steps.map((s) => s.symbolId)).not.toContain(rateFor);
    expect(c3.steps).toHaveLength(4);
  });

  it('未帰属の hunk が無ければコース外を作らない', () => {
    const a = fixtureAnalysis();
    a.hunks = a.hunks.map((h) => (h.hows.length === 0 ? { ...h, hows: [1] } : h));
    expect(courses(a).map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('stopInfo（LLM の文が無いときは事実から組む 1 行。自動）', () => {
  it('他のコースの差分を通る停留所には「コース n の差分」', () => {
    const c5 = courseOf(bareAll, 5)!;
    // 読む順は execute が呼ぶ行の順（find → Order → save）。3 か所目が Order
    const s = stopInfo(bare, c5, 2, review);
    expect(s.other).toBe(3);
    expect(s.guide.text).toContain('コース 3 の差分');
  });

  it('差分のある停留所: 種別と +n −m。呼ばれ方が無ければ種別だけ', () => {
    const s = stopInfo(bare, courseOf(bareAll, 3)!, 0, review);
    expect(s.kind).toBe('変更');
    expect(s.guide).toEqual({ text: '変更。', ai: false });
    expect(s.say.text).toMatch(/^変更 \+\d+ −\d+$/);
    expect(s.say.ai).toBe(false);
    expect(s.facts[0]).toBe('変更');
  });

  it('追従の束の代表には件数', () => {
    const s = byName(3, 'OrderAdminView.discountField');
    expect(s.facts).toContain('追従 22 のサンプル');
  });

  it('停留所の「問題なし」は viewed（その hunk）', () => {
    const c3 = courseOf(all, 3)!;
    const first = stopInfo(analysis, c3, 0, review);
    expect(first.seen).toBe(false);
    expect(stopInfo(analysis, c3, 0, { ...review, viewed: [first.hunk!.id] }).seen).toBe(true);
  });
});

describe('stopInfo（LLM の文。2 回目の呼び出しが書いた tours の文）', () => {
  // 2026-10-22 からの解析は この場所（role）。読む前の案内の画面ができるまでは、何を変えたかの枠に出す
  it('この場所（role）を何を変えたかの文に出す（ai）。なぜここかは自動の文。事実のチップは LLM の文があっても事実のまま', () => {
    const c3 = courseOf(all, 3)!;
    const step = analysis.tours.find((t) => t.howId === 3)!.steps[1]!;
    const s = stopInfo(analysis, c3, 1, review);
    expect(step.role).toBeTruthy();
    expect(s.say).toEqual({ text: step.role, ai: true });
    expect(s.guide.ai).toBe(false);
    expect(s.facts).toEqual(byName(3, 'OrderAdminView.discountField', bare).facts);
  });

  it('古い解析の なぜここか（guide）と 何を変えたか（say）があればそれを出す', () => {
    const a = fixtureAnalysis();
    const step = a.tours.find((t) => t.howId === 3)!.steps[1]!;
    Object.assign(step, { guide: '束のサンプル。', say: '読み方を変えた。' });
    delete step.role;
    const s = stopInfo(a, courseOf(courses(a), 3)!, 1, review);
    expect(s.guide).toEqual({ text: '束のサンプル。', ai: true });
    expect(s.say).toEqual({ text: '読み方を変えた。', ai: true });
  });

  it('LLM が書き漏らした停留所と、空白だけの文は自動の文にする（決定 2）', () => {
    const a = fixtureAnalysis();
    const [first, second] = a.tours.find((t) => t.howId === 3)!.steps;
    delete second!.role;
    first!.role = '  ';
    const c3 = courseOf(courses(a), 3)!;
    expect(stopInfo(a, c3, 1, review).say.ai).toBe(false);
    expect(stopInfo(a, c3, 0, review).say.ai).toBe(false);
  });
});

describe('courseRipples（総括の「同じ書き換え」）', () => {
  it('コース 3 は束 22（代表 OrderAdminView.discountField、逸脱 PromoService.apply、残り 21）', () => {
    const rs = courseRipples(analysis, courseOf(all, 3)!);
    expect(rs).toHaveLength(1);
    const r = rs[0]!;
    expect(r.size).toBe(22);
    expect(r.rest).toHaveLength(21);
    expect(analysis.hunks.find((h) => h.id === r.representative)?.symbolFqName).toMatch(/OrderAdminView\.discountField$/);
    expect(r.deviations.map((d) => analysis.hunks.find((h) => h.id === d.hunkId)?.symbolFqName.split('.').slice(-2).join('.'))).toEqual(['PromoService.apply']);
  });

  it('束の無いコースは空', () => {
    expect(courseRipples(analysis, courseOf(all, 1)!)).toEqual([]);
  });

  it('コースが束を 2 つ触るなら 2 つとも、代表の id 順に返す（1 つ目だけにしない）', () => {
    const a = fixtureAnalysis();
    const g = a.hunks.find((h) => h.group)!.group!;
    // 束の後半のメンバーを別の束に分けた解析を作る
    const moved = g.members.filter((m) => m !== g.representative).slice(10);
    const other = { ...g, representative: moved[0]!, members: moved, deviations: [], distance: {} };
    a.hunks = a.hunks.map((h) => (moved.includes(h.id) ? { ...h, group: other } : h.group ? { ...h, group: { ...g, members: g.members.filter((m) => !moved.includes(m)) } } : h));
    const rs = courseRipples(a, courseOf(courses(a), 3)!);
    expect(rs.map((r) => r.representative).sort()).toEqual([g.representative, moved[0]!].sort());
    expect(rs.map((r) => r.representative)).toEqual([...rs.map((r) => r.representative)].sort());
    expect(rs.reduce((n, r) => n + r.size, 0)).toBe(g.members.length);
  });
});

describe('入る位置と次のコース', () => {
  it('入る位置は最初の未確認の停留所。全部確認済みなら先頭', () => {
    const c2 = courseOf(all, 2)!;
    const [a, b] = c2.steps.map((st) => st.hunkId!);
    expect(firstUnseen(analysis, c2, review)).toBe(0);
    expect(firstUnseen(analysis, c2, { ...review, viewed: [a!] })).toBe(1);
    expect(firstUnseen(analysis, c2, { ...review, viewed: [a!, b!] })).toBe(0);
  });

  it('import だけの差分の停留所を飛ばす指定: 入る位置・次・前（コース 6 は 4 と 6 が import だけ）', () => {
    const c6 = courseOf(all, 6)!;
    const ids = c6.steps.map((st) => st.hunkId!);
    // 飛ばさなければ今までどおり
    expect(firstUnseen(analysis, c6, { ...review, viewed: ids.slice(0, 4) })).toBe(4);
    expect(firstUnseen(analysis, c6, { ...review, viewed: ids.slice(0, 4) }, true)).toBe(5);
    expect(firstUnseen(analysis, c6, { ...review, viewed: ids }, true)).toBe(0);
    expect(stopAfter(analysis, c6, 3, false)).toBe(4);
    expect(stopAfter(analysis, c6, 3, true)).toBe(5);
    expect(stopAfter(analysis, c6, 5, true)).toBeNull();
    expect(stopAfter(analysis, c6, 6, false)).toBeNull();
    expect(stopBefore(analysis, c6, 5, false)).toBe(4);
    expect(stopBefore(analysis, c6, 5, true)).toBe(3);
    expect(stopBefore(analysis, c6, 0, true)).toBeNull();
  });

  it('先頭が import だけの差分のコース 2 は、飛ばす指定なら最初に止まる停留所が 1', () => {
    const c2 = courseOf(all, 2)!;
    const [a, b] = c2.steps.map((st) => st.hunkId!);
    expect(firstUnseen(analysis, c2, review, true)).toBe(1);
    expect(firstUnseen(analysis, c2, { ...review, viewed: [a!, b!] }, true)).toBe(1);
    expect(stopBefore(analysis, c2, 1, true)).toBeNull();
  });

  it('次のコースは完了にしていない最初のコース（コース外は数えない）', () => {
    expect(nextCourse(all, review)?.id).toBe(1);
    expect(nextCourse(all, { ...review, course: { done: [], completed: [1, 2] } })?.id).toBe(3);
    expect(nextCourse(all, { ...review, course: { done: [], completed: [1, 2, 3, 4, 5, 6, 7] } })).toBeNull();
  });

  it('コースの紹介は LLM の変わることの後（ai。古い解析は紹介）。無ければ「なぜ」と停留所の数（自動）。コース外は固定の文（自動）', () => {
    expect(courseIntro(courseOf(all, 3)!)).toEqual({ text: analysis.tours.find((t) => t.howId === 3)!.change!.after, ai: true });
    const old = fixtureAnalysis();
    Object.assign(old.tours.find((t) => t.howId === 3)!, { intro: '古い紹介。', change: undefined });
    expect(courseIntro(courseOf(courses(old), 3)!)).toEqual({ text: '古い紹介。', ai: true });
    expect(courseIntro(courseOf(bareAll, 3)!)).toEqual({ text: '割引額の保持と合計計算を Order 側で行うため。4 か所。', ai: false });
    expect(courseIntro(courseOf(all, OUTSIDE)!)).toEqual({ text: 'どのコースにも入らない差分です。作者に聞くか、別の PR に分けるかを考えるときに見ます。', ai: false });
  });
});

describe('stopInfo の層（推定は「（推定）」。原則 2）', () => {
  it('LLM が推定した層は、停留所の層と事実のチップに（推定）を付ける', () => {
    const a = fixtureAnalysis();
    a.symbols = a.symbols.map((s) => (s.layer === undefined ? s : { ...s, layerProvenance: 'llm' as const }));
    const c = courseOf(courses(a), 3)!;
    const info = stopInfo(a, c, 0, review);
    expect(info.layer).toMatch(/（推定）$/);
    expect(info.facts).toContain(info.layer);
  });
});

describe('stopInfo のテスト（見分けが推定なら「（推定）」。5.2 の 7・原則 2）', () => {
  it('テストの見分けが推定の解析では、テストの停留所に testGuess、テスト n の事実に（推定）を付ける', () => {
    const a = fixtureAnalysis();
    a.config.layers = [];
    a.structure = { status: 'ok', layers: [], tests: ['src/test'] };
    a.hunks = a.hunks.map((h) => (h.kind === 'test' ? { ...h, kindProvenance: 'llm' as const } : h));
    const all = courses(a);
    const infos = all.flatMap((c) => c.steps.map((_, k) => stopInfo(a, c, k, review)));
    const tests = infos.filter((i) => i.test);
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.every((i) => i.testGuess)).toBe(true);
    const counted = infos.find((i) => (i.symbol?.testCount ?? 0) > 0)!;
    expect(counted.facts).toContain(`テスト ${counted.symbol!.testCount}（推定）`);
  });

  it('設定で見分けた解析では付けない', () => {
    const a = fixtureAnalysis();
    const all = courses(a);
    const infos = all.flatMap((c) => c.steps.map((_, k) => stopInfo(a, c, k, review)));
    expect(infos.some((i) => i.testGuess)).toBe(false);
    const counted = infos.find((i) => (i.symbol?.testCount ?? 0) > 0)!;
    expect(counted.facts).toContain(`テスト ${counted.symbol!.testCount}`);
  });
});

describe('courseColorVars', () => {
  it('番号が 8 以上でも、番号が飛んでも、コースの並び順で色を付ける', () => {
    expect(courseColorVars([1, 2, 9])).toEqual({ '--c1': 'var(--tone1)', '--c2': 'var(--tone2)', '--c9': 'var(--tone3)' });
  });
  it('8 本目から 1 本目の色に戻る', () => {
    expect(courseColorVars([1, 2, 3, 4, 5, 6, 7, 8])).toMatchObject({ '--c8': 'var(--tone1)' });
  });
});
