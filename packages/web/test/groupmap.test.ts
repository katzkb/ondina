// 入口の地図（2026-11-04。見本 5 の形・案 A）の図を組む純粋関数と配置。fixture の mapGroups（7 コース + コース外）で見る。
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { layoutView } from '../src/map/groupmap/layout.js';
import { crumbName, groupTree, litBy, mapFacts, pathTo, ROOT, shortNames, viewOf } from '../src/map/groupmap/view.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { relHostLabel, relItems } from '../src/rel.js';
import { emptyReview, fixtureAnalysis, fixtureWithNeighbors } from './fixture.js';

const analysis = fixtureAnalysis();
const mg = analysis.mapGroups!;
const facts = mapFacts(analysis, mg);
const labelOf = (id: string) => facts.tree.boxes.get(id)?.label ?? id;
const file = (name: string) => mg.boxes.find((b) => b.path?.endsWith(`/${name}`))!.id;
const BUNDLE = mg.boxes.find((b) => b.id.startsWith('group:'))!.id;

describe('viewOf', () => {
  it('全景はまとまりの図。並びは全景の並びのまま（7 コース + コース外）で、札は無い', () => {
    const v = viewOf(facts, labelOf, ROOT);
    expect(v.kind).toBe('groups');
    expect(v.items.map((it) => it.id)).toEqual(mg.root);
    expect(v.items.every((it) => it.kind === 'group')).toBe(true);
  });

  it('コース 3 の中は箱の図。Order・束・PromoService と、外の相手を含むまとまりの札', () => {
    const v = viewOf(facts, labelOf, 'course:3');
    expect(v.kind).toBe('boxes');
    expect(v.items.filter((it) => it.kind === 'box').map((it) => it.id)).toEqual([file('Order.kt'), BUNDLE, file('PromoService.kt')]);
    const portals = v.items.filter((it) => it.kind === 'portal').map((it) => it.id);
    expect(portals.length).toBeGreaterThan(0);
    expect(portals.every((id) => mg.root.includes(id))).toBe(true);
    // 札とつなぐ線は点線（portal）。図の中の箱どうしは portal でない
    for (const e of v.edges) expect(e.portal).toBe(portals.includes(e.a) || portals.includes(e.b));
  });

  it('束の 22 か所から Order への線は 1 本に束ね、本数を数える', () => {
    const v = viewOf(facts, labelOf, 'course:3');
    const e = v.edges.find((x) => x.a === BUNDLE && x.b === file('Order.kt'));
    expect(e?.n).toBeGreaterThan(1);
  });

  it('箱の事実: 束は追従の件数と差異あり、新しいファイルは added、コースの丸は hunk のコース', () => {
    const b = facts.box.get(BUNDLE)!;
    expect(b.bundle?.members).toBe(22);
    expect(b.bundle?.deviations).toBe(1);
    expect(facts.box.get(file('DiscountCommand.kt'))!.added).toBe(true);
    expect(facts.box.get(file('Order.kt'))!.added).toBe(false);
    expect(facts.box.get(file('Logger.kt'))!.courses).toEqual([0]);
  });

  it('選んだコースが通るまとまりだけを光らせる。選んでいなければ null', () => {
    const v = viewOf(facts, labelOf, ROOT);
    expect(litBy(facts, v, null)).toBeNull();
    expect([...litBy(facts, v, 3)!]).toContain('course:3');
    expect(litBy(facts, v, 3)!.has('outside')).toBe(false);
  });
});

describe('shortNames', () => {
  it('半分以上の名前に出る 3 文字以上の語を「…」にまとめ、省いた語を返す', () => {
    const r = shortNames(['CustomerOrderDetailResponseDto', 'CustomerOrderSummaryResponseDto', 'CustomerOrderResponseDto']);
    expect(r.names).toEqual(['…Detail…', '…Summary…', 'ResponseDto']);
    expect(r.common).toEqual(['Customer', 'Order', 'Response', 'Dto']);
  });

  it('短くした名前がかぶったら、その名前は元に戻す', () => {
    const r = shortNames(['FooBarOne', 'BarFooOne', 'FooBarTwo', 'FooBarThree', 'FooBarFour']);
    expect(r.names).toEqual(['FooBarOne', 'BarFooOne', '…Two', '…Three', '…Four']);
  });

  it('キャメルケースの名前が 3 つ未満なら省かない。キャメルケースでない名前（SQL のファイル）はそのまま', () => {
    expect(shortNames(['OrderController', 'OrderResponse']).names).toEqual(['OrderController', 'OrderResponse']);
    expect(shortNames(['V421__discount', 'OrderA', 'OrderB', 'OrderC']).names[0]).toBe('V421__discount');
  });
});

describe('layoutView', () => {
  it('箱の図は上の層ほど上。箱どうしは重ならない', async () => {
    const v = await layoutView(viewOf(facts, labelOf, 'course:3'), new ELK(), (id) => id);
    const ys = [...v.bands].map((b) => b.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    for (const a of v.items)
      for (const b of v.items) {
        if (a === b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.id} と ${b.id}`).toBe(true);
      }
    for (const e of v.edges) expect(e.pts.length).toBeGreaterThan(1);
  });

  it('全景の図は全部のまとまりに位置が付き、図の幅・高さに収まる', async () => {
    const v = await layoutView(viewOf(facts, labelOf, ROOT), new ELK(), (id) => id);
    expect(v.items).toHaveLength(mg.root.length);
    for (const it of v.items) {
      expect(it.x + it.w).toBeLessThanOrEqual(v.w);
      expect(it.y + it.h).toBeLessThanOrEqual(v.h);
    }
  });
});

describe('道筋とパンくず', () => {
  const tree = groupTree(mg);
  it('pathTo は全景の直下からの道筋。木に無い id は null', () => {
    expect(pathTo(tree, ROOT)).toEqual([]);
    expect(pathTo(tree, 'course:3')).toEqual(['course:3']);
    expect(pathTo(tree, 'nope')).toBeNull();
  });
  it('パンくずの名前は 全景 / コース n / コース外', () => {
    expect(crumbName(analysis, tree, ROOT)).toBe('全景');
    expect(crumbName(analysis, tree, 'course:3')).toBe('コース 3');
    expect(crumbName(analysis, tree, 'outside')).toBe('コース外');
  });
});

describe('reducer: map.enter / map.up / Esc', () => {
  const loaded = (): AppState => {
    const a = fixtureAnalysis();
    const summary = { key: 'local', headSha: a.pr.headSha, pr: a.pr, mtime: 1, repoName: 'order-service' };
    return reduce(initialState(), { id: 'data.loaded', summary, analysis: a, review: emptyReview() }).state;
  };
  it('中に入り、1 段上へ戻る。木に無い id は何もしない', () => {
    const s = reduce(loaded(), { id: 'map.enter', group: 'course:3' }).state;
    expect(s.home.path).toEqual(['course:3']);
    expect(reduce(s, { id: 'map.enter', group: 'nope' }).state.home.path).toEqual(['course:3']);
    expect(reduce(s, { id: 'map.up' }).state.home.path).toEqual([]);
    expect(reduce(s, { id: 'map.enter', group: ROOT }).state.home.path).toEqual([]);
  });
  it('Esc はまず 1 段上へ。全景ならコースを外す', () => {
    let s = reduce(reduce(loaded(), { id: 'home.select', courseId: 3 }).state, { id: 'map.enter', group: 'course:3' }).state;
    s = reduce(s, { id: 'escape' }).state;
    expect(s.home).toMatchObject({ path: [], sel: 3 });
    s = reduce(s, { id: 'escape' }).state;
    expect(s.home).toMatchObject({ path: [], sel: null });
  });
});

describe('rel: 入口の地図のファイルの箱', () => {
  it('ファイルの箱の相手は、そのファイルのシンボルの相手を合わせたもの。見出しは箱の名前', () => {
    const a = fixtureWithNeighbors();
    const host = a.mapGroups!.boxes.find((b) => b.path?.endsWith('/ApplyDiscountUseCase.kt'))!.id;
    expect(relItems(a, host, 'out').map((x) => x.name)).toEqual(['Clock.now', 'Money.plus', 'OrderId.of', 'OrderRepository.save']);
    expect(relHostLabel(a, host)).toBe('ApplyDiscountUseCase');
  });
});
