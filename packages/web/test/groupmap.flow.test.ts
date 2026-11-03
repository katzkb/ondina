// 入口の地図にコースの道順を流す（2026-11-04。見本 5 の 2 版）。fixture の 7 コース + コース外で見る。
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { courseOf, courses } from '../src/course.js';
import { along, itemAt, lcaOf, mapRouteOf, routeDraw, snapSpeed, whereTo } from '../src/map/groupmap/flow.js';
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
const course = (id: number) => courseOf(courses(analysis), id)!;

describe('mapRouteOf', () => {
  it('テストの停留所は落とし、数を off に残す', () => {
    const r = mapRouteOf(analysis, tree, course(3));
    expect(r.steps.map((s) => s.box)).toEqual([file('Order.kt'), mg.boxes.find((b) => b.id.startsWith('group:'))!.id]);
    expect(r.off).toBe(2);
  });
  it('続く同じ箱の停留所は 1 歩にまとめる。離れて戻る箱は別の歩', () => {
    expect(mapRouteOf(analysis, tree, course(2)).steps).toEqual([{ box: file('DiscountCommand.kt'), stops: [0, 1] }]);
    const r = mapRouteOf(analysis, tree, course(5));
    expect(r.steps.map((s) => s.box)).toEqual([file('ApplyDiscountUseCase.kt'), file('OrderRepositoryImpl.kt'), file('Order.kt'), file('OrderRepositoryImpl.kt'), file('ApplyDiscountUseCase.kt')]);
  });
});

describe('itemAt / lcaOf / whereTo', () => {
  const root = viewOf(facts, labelOf, ROOT);
  const c5 = viewOf(facts, labelOf, 'course:5');
  it('全景では箱を含むまとまり、中ではその箱。外の箱は札（図に札が無ければ null）', () => {
    expect(itemAt(tree, root, file('Order.kt'))).toBe('course:3');
    expect(itemAt(tree, c5, file('ApplyDiscountUseCase.kt'))).toBe(file('ApplyDiscountUseCase.kt'));
    const out = itemAt(tree, c5, file('Order.kt'));
    expect(out === null || c5.items.find((it) => it.id === out)?.kind === 'portal').toBe(true);
    expect(itemAt(tree, c5, file('Logger.kt'))).toBeNull();
  });
  it('lcaOf は全部を含むいちばん深いまとまり', () => {
    expect(lcaOf(tree, [file('Order.kt')])).toBe('course:3');
    expect(lcaOf(tree, [file('Order.kt'), file('PromoService.kt')])).toBe('course:3');
    expect(lcaOf(tree, [file('Order.kt'), file('Logger.kt')])).toBe(ROOT);
  });
  it('全景で 1 つのまとまりの中の歩は「… の中で見る」。外の歩は「… で見る」。図の中で起きれば出さない', () => {
    expect(whereTo(tree, root, [file('Order.kt')])).toEqual({ to: 'course:3', under: true });
    expect(whereTo(tree, c5, [file('Order.kt')])).toEqual({ to: 'course:3', under: false });
    expect(whereTo(tree, c5, [file('ApplyDiscountUseCase.kt')])).toBeNull();
    expect(whereTo(tree, root, [file('Order.kt'), file('Logger.kt')])).toBeNull();
  });
});

describe('routeDraw', () => {
  it('全景のコース 5: まとまりに歩の番号、まとまりの間に線。今の歩は前の歩の所から来る', async () => {
    const v = await layoutView(viewOf(facts, labelOf, ROOT), new ELK(), (id) => id);
    const d = routeDraw(tree, v, mapRouteOf(analysis, tree, course(5)), 3);
    expect(d.badges.get('course:5')).toEqual([
      { n: 1, state: 'past' },
      { n: 5, state: 'fut' },
    ]);
    expect(d.badges.get('course:4')!.map((b) => b.n)).toEqual([2, 4]);
    expect(d.badges.get('course:3')).toEqual([{ n: 3, state: 'cur' }]);
    expect(d.lines.map((l) => l.n)).toEqual([2, 3, 4, 5]);
    expect(d.cur).toEqual({ item: 'course:3', n: 3, from: 'course:4' });
    // 線は前の箱の縁から次の箱の縁へ
    const l3 = d.lines.find((l) => l.n === 3)!;
    const a = v.items.find((it) => it.id === 'course:4')!;
    const b = v.items.find((it) => it.id === 'course:3')!;
    const onEdge = (r: typeof a, p: [number, number]) => p[0] >= r.x - 0.5 && p[0] <= r.x + r.w + 0.5 && p[1] >= r.y - 0.5 && p[1] <= r.y + r.h + 0.5;
    expect(onEdge(a, l3.pts[0]!)).toBe(true);
    expect(onEdge(b, l3.pts[l3.pts.length - 1]!)).toBe(true);
  });
  it('全部を見ている（i = 0）ときは全部の歩が fut で、今の歩は無い', async () => {
    const v = await layoutView(viewOf(facts, labelOf, ROOT), new ELK(), (id) => id);
    const d = routeDraw(tree, v, mapRouteOf(analysis, tree, course(6)), 0);
    expect(d.cur).toBeNull();
    expect([...d.badges.values()].flat().every((b) => b.state === 'fut')).toBe(true);
  });
});

describe('along / snapSpeed', () => {
  it('along は折れ線の長さの割合の点', () => {
    const pts: Array<[number, number]> = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(along(pts, 0)).toEqual([0, 0]);
    expect(along(pts, 0.5)).toEqual([10, 0]);
    expect(along(pts, 0.75)).toEqual([10, 5]);
    expect(along(pts, 1)).toEqual([10, 10]);
  });
  it('速さは 0.5 刻みの近くに吸い付き、0.25〜3 に収める', () => {
    expect(snapSpeed(1.95)).toBe(2);
    expect(snapSpeed(1.3)).toBe(1.3);
    expect(snapSpeed(9)).toBe(3);
    expect(snapSpeed(0.1)).toBe(0.25);
  });
});

describe('reducer: 道順の歩・再生・速さ', () => {
  const loaded = (): AppState => {
    const a = fixtureAnalysis();
    const summary = { key: 'local', headSha: a.pr.headSha, pr: a.pr, mtime: 1, repoName: 'order-service' };
    return reduce(initialState(), { id: 'data.loaded', summary, analysis: a, review: emptyReview() }).state;
  };
  const sel5 = () => reduce(loaded(), { id: 'home.select', courseId: 5 }).state;

  it('コースを選ぶと全部を見る所（0）から。歩は 0〜歩の数に収める', () => {
    let s = sel5();
    expect(s.home).toMatchObject({ step: 0, play: false });
    s = reduce(s, { id: 'map.step', to: 3 }).state;
    expect(s.home.step).toBe(3);
    expect(reduce(s, { id: 'map.step', to: 99 }).state.home.step).toBe(5);
    expect(reduce(s, { id: 'map.step', to: -1 }).state.home.step).toBe(0);
    // 選び直すと 0 に戻る
    expect(reduce(s, { id: 'home.select', courseId: 6 }).state.home.step).toBe(0);
  });
  it('入口の地図では → / ← で歩を進める / 戻す（コースに入らない）。選んでいなければ → は今まで通り', () => {
    let s = sel5();
    s = reduce(s, { id: 'course.forward' }).state;
    expect(s.view).toBe('home');
    expect(s.home.step).toBe(1);
    s = reduce(s, { id: 'course.prev' }).state;
    expect(s.home.step).toBe(0);
    expect(reduce(loaded(), { id: 'course.forward' }).state.view).toBe('course');
  });
  it('▶ は最後まで見ていれば 1 歩目から。進むのは map.tick で、最後で止まる。手で動かすと止まる', () => {
    let s = reduce(reduce(sel5(), { id: 'map.step', to: 5 }).state, { id: 'map.play' }).state;
    expect(s.home).toMatchObject({ step: 1, play: true });
    s = reduce(s, { id: 'map.tick' }).state;
    expect(s.home).toMatchObject({ step: 2, play: true });
    expect(reduce(s, { id: 'map.step', to: 4 }).state.home.play).toBe(false);
    for (let k = 0; k < 3; k++) s = reduce(s, { id: 'map.tick' }).state;
    expect(s.home).toMatchObject({ step: 5, play: true });
    s = reduce(s, { id: 'map.tick' }).state;
    expect(s.home).toMatchObject({ step: 5, play: false });
    expect(reduce(reduce(s, { id: 'map.play' }).state, { id: 'map.play' }).state.home.play).toBe(false);
  });
  it('速さは ui.json に保存する（PR をまたぐ設定）', () => {
    const r = reduce(sel5(), { id: 'map.speed', speed: 1.97 });
    expect(r.state.ui.mapSpeed).toBe(2);
    expect(r.effects).toContainEqual({ type: 'saveUi' });
  });
});
