// 入口の地図に動きを流す・シーケンス図にする（2026-11-04。見本 5）。fixture の動き b1（OrderController.apply から）で見る。
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { behaviorSteps, CALLER, flowDraw, inDeeper, labelAt, placeStep, seqLayout, seqRows } from '../src/map/groupmap/behavior.js';
import { layoutView } from '../src/map/groupmap/layout.js';
import { mapFacts, ROOT, viewOf } from '../src/map/groupmap/view.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const analysis = fixtureAnalysis();
const mg = analysis.mapGroups!;
const facts = mapFacts(analysis, mg);
const tree = facts.tree;
const labelOf = (id: string) => tree.boxes.get(id)?.label ?? id;
const file = (name: string) => mg.boxes.find((b) => b.path?.endsWith(`/${name}`))!.id;
const b1 = analysis.behaviors![0]!;
const steps = behaviorSteps(analysis, tree, b1);

describe('behaviorSteps', () => {
  it('1 歩目は呼び出し元 → 始まり。以降は呼び出し 1 回ずつ', () => {
    expect(steps).toHaveLength(b1.messages.length + 1);
    expect(steps[0]).toMatchObject({ n: 1, from: null, to: file('OrderController.kt'), entry: true, short: 'OrderController.apply' });
    expect(steps[1]).toMatchObject({ from: file('OrderController.kt'), to: file('ApplyDiscountUseCase.kt'), short: 'execute(…2)', full: 'useCase.execute(OrderId(id), body.discountCode)', returns: 'Order' });
  });
  it('差分の無い相手は箱が無い（to = null）。名前は呼ばれる側の短い名前', () => {
    const s = steps.find((x) => x.short.startsWith('rateFor'))!;
    expect(s).toMatchObject({ from: file('Order.kt'), to: null, callee: 'DiscountPolicy.rateFor', short: 'rateFor(…1)', returns: 'Rate' });
  });
  it('呼び出しの式が無いときは呼ばれる側の短い名前', () => {
    const b = { ...b1, messages: [{ from: b1.start, to: b1.messages[0]!.to }] };
    expect(behaviorSteps(analysis, tree, b)[1]).toMatchObject({ short: 'ApplyDiscountUseCase.execute', full: 'ApplyDiscountUseCase.execute' });
  });
});

describe('placeStep', () => {
  const root = viewOf(facts, labelOf, ROOT);
  const c5 = viewOf(facts, labelOf, 'course:5');
  it('全景: まとまりの間は矢印、同じまとまりの中は「中で」、呼び出し元からも矢印', () => {
    const ctl = tree.parent.get(file('OrderController.kt'))!;
    expect(placeStep(tree, root, steps[0]!)).toEqual({ t: 'arrow', a: CALLER, b: ctl });
    const same = steps.filter((s) => s.from !== null && s.to !== null && tree.parent.get(s.from) === tree.parent.get(s.to));
    for (const s of same) expect(placeStep(tree, root, s)).toEqual({ t: 'in', at: tree.parent.get(s.from!) });
  });
  it('差分の無い相手へは、呼ぶ側の中で', () => {
    const s = steps.find((x) => x.to === null)!;
    expect(placeStep(tree, root, s)).toEqual({ t: 'in', at: tree.parent.get(s.from!) });
    expect(inDeeper(tree, root, s, tree.parent.get(s.from!)!)).toBeNull();
  });
  it('まとまりの中では箱の間の矢印。図の外の相手は札へ', () => {
    const p = placeStep(tree, c5, steps[2]!);
    expect(p).toMatchObject({ t: 'arrow', a: file('ApplyDiscountUseCase.kt') });
  });
});

describe('placeStep: 札と札の間', () => {
  it('地図では図の外（下の「… で見る」へ）。シーケンス図では札の列の間の矢印', () => {
    const c3 = viewOf(facts, labelOf, 'course:3');
    const s = steps.find((x) => x.short.startsWith('find'))!;
    expect(placeStep(tree, c3, s)).toEqual({ t: 'in', at: null });
    const p = placeStep(tree, c3, s, true);
    expect(p.t).toBe('arrow');
    if (p.t === 'arrow') for (const x of [p.a, p.b]) expect(c3.items.find((it) => it.id === x)?.kind).toBe('portal');
  });
});

describe('seqRows', () => {
  it('戻りは、その先の呼び出しが終わってから。戻り型の無い呼び出しは戻りの行を作らない', () => {
    const rows = seqRows(tree, viewOf(facts, labelOf, ROOT), b1, steps);
    const ret = (n: number) => `${n}r`;
    const order = rows.map((r) => (r.ret ? ret(r.n) : String(r.n)));
    const withRet = steps.filter((s) => s.returns !== undefined).map((s) => s.n);
    expect(order.filter((x) => x.endsWith('r'))).toHaveLength(withRet.length);
    // find（3 歩目）の戻りは applyDiscount（4 歩目）の前、execute（2 歩目）の戻りは 2 歩目の先が全部終わってから
    expect(order.indexOf('3r')).toBe(order.indexOf('3') + 1);
    expect(order.indexOf('2r')).toBeGreaterThan(order.indexOf('6'));
    expect(order.indexOf('2r')).toBeLessThan(order.indexOf('7'));
    const r = rows.find((x) => x.ret && x.n === 3)!;
    const call = rows.find((x) => !x.ret && x.n === 3)!;
    if (call.place.t === 'arrow' && r.place.t === 'arrow') expect([r.place.a, r.place.b]).toEqual([call.place.b, call.place.a]);
  });
});

describe('flowDraw / seqLayout', () => {
  it('まとまりの中: 今の歩の矢印と、呼び出し元の点', async () => {
    const v = await layoutView(viewOf(facts, labelOf, tree.parent.get(file('OrderController.kt'))!), new ELK(), (id) => id);
    const d = flowDraw(tree, v, steps, 1);
    expect(d.cur?.step.n).toBe(1);
    expect(d.cur?.arrow?.dot).toBeDefined();
    expect(d.arrows.every((a) => a.pts.length >= 2)).toBe(true);
  });
  it('全景の列は左から。9 列以上なら列の頭を 2 段にする', async () => {
    const v = await layoutView(viewOf(facts, labelOf, ROOT), new ELK(), (id) => id);
    const rows = seqRows(tree, v.spec, b1, steps);
    const L = seqLayout(v, rows);
    const xs = L.lanes.map((l) => v.items.find((it) => it.id === l.id)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(L.lanes.map((l) => l.y)).size).toBe(1);
    expect(L.ys).toHaveLength(rows.length);
    const many = { ...v, items: Array.from({ length: 9 }, (_, k) => ({ ...v.items[0]!, id: `x${k}`, x: k * 10, kind: 'box' as const })) };
    const fake = many.items.map((it, k) => ({ n: k + 1, ret: false, place: { t: 'in' as const, at: it.id } }));
    expect(new Set(seqLayout(many, fake).lanes.map((l) => l.y)).size).toBe(2);
  });
  it('札は縦の線なら右、図の右端に入らなければ左', () => {
    expect(labelAt([[100, 0], [100, 100]], 50, 400).x).toBe(110);
    expect(labelAt([[380, 0], [380, 100]], 50, 400).x).toBe(320);
  });
});

describe('reducer', () => {
  const loaded = (): AppState => {
    const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
    return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
  };
  it('動きを選ぶとコースは外れ、歩は 0。もう一度で外す。歩は 1 歩目 + 呼び出しの数まで', () => {
    let s = reduce(loaded(), { id: 'home.select', courseId: 3 }).state;
    s = reduce(s, { id: 'home.behavior', behaviorId: 'b1' }).state;
    expect(s.home).toMatchObject({ sel: null, behavior: 'b1', step: 0 });
    s = reduce(s, { id: 'map.step', to: 99 }).state;
    expect(s.home.step).toBe(b1.messages.length + 1);
    s = reduce(s, { id: 'home.mode' }).state;
    expect(s.home.mode).toBe('seq');
    s = reduce(s, { id: 'home.select', courseId: 3 }).state;
    expect(s.home).toMatchObject({ sel: 3, behavior: null, mode: 'map' });
  });
  it('Esc は動きを外し、地図に戻す。動きが無ければ見せ方は変えない', () => {
    let s = reduce(loaded(), { id: 'home.mode' }).state;
    expect(s.home.mode).toBe('map');
    s = reduce(s, { id: 'home.behavior', behaviorId: 'b1' }).state;
    s = reduce(s, { id: 'home.mode', mode: 'seq' }).state;
    s = reduce(s, { id: 'escape' }).state;
    expect(s.home).toMatchObject({ behavior: null, mode: 'map', step: 0 });
  });
});
