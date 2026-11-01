// 地図に載せるノードと辺（設計書 3.3）。数は承認済みの見本（2026-09-24、地図サンプル v5）と同じになること。
import { describe, expect, it } from 'vitest';
import { buildGraph, GROUP_PREFIX, layerText, mapBands, mapNodeOf, NO_LAYER, REL_PREFIX, relationsOf, shortName, testsGuessed, type MapNode, type RelItem } from '../src/map/graph.js';
import { fixtureAnalysis, fixtureWithNeighbors } from './fixture.js';

const count = (how: number | null) => {
  const g = buildGraph(fixtureAnalysis(), how);
  const linked = new Set(g.edges.flatMap((e) => [e.from, e.to]));
  return {
    nodes: g.nodes.length,
    linked: g.nodes.filter((n) => linked.has(n.id)).length,
    edges: g.edges.length,
    call: g.edges.filter((e) => e.kind === 'call').length,
    reference: g.edges.filter((e) => e.kind === 'reference').length,
    crosses: g.edges.filter((e) => e.crosses).length,
    seed: g.seed.size,
  };
};

describe('buildGraph', () => {
  // 2026-10-11: 差分の無いシンボル 5 つは箱にしない。ほかの層の相手は「差分なし」の箱 2 つ（execute と apply の Domain の相手）と線 2 本
  it('全体: 束を畳み、テストを外し、同じ向きの辺を 1 本にすると 22 ノード（辺あり 14）・18 辺（呼び出し 8 / 参照 10）・層越え 5', () => {
    expect(count(null)).toEqual({ nodes: 22, linked: 14, edges: 18, call: 8, reference: 10, crosses: 5, seed: 0 });
  });

  // seed（紫の枠）は画面にある箱だけ数える（テストの hunk は出さない）。
  // 2026-09-26: 読む順番の箱だけにした変更（2026-09-25）を戻した（影響範囲が見えなくなる）。関連の箱は残し、見た目で分けて押すと覗く
  it('How で絞ると、その How の hunk と、辺でつながる隣が残る。束のメンバーは束の箱、テストは出さない', () => {
    expect(count(1)).toEqual({ nodes: 1, linked: 0, edges: 0, call: 0, reference: 0, crosses: 0, seed: 1 });
    expect(count(3)).toEqual({ nodes: 10, linked: 10, edges: 12, call: 3, reference: 9, crosses: 3, seed: 3 });
    expect(count(5)).toEqual({ nodes: 8, linked: 7, edges: 10, call: 6, reference: 4, crosses: 1, seed: 2 });
  });

  it('読む順番に無い箱は related。読む順番の箱は order（tours のステップの番号。右列の一覧と同じ）を持つ', () => {
    const a = fixtureAnalysis();
    const boxOf = mapNodeOf(a);
    for (const t of a.tours) {
      const steps = t.steps.map((s) => boxOf(s.symbolId));
      for (const n of buildGraph(a, t.howId).nodes) {
        if (n.rel) continue;
        const i = steps.indexOf(n.id);
        if (i < 0) expect([n.related, n.order], `How ${t.howId}: ${n.label}`).toEqual([true, undefined]);
        else expect(n, `How ${t.howId}: ${n.label}`).toMatchObject({ related: false, order: i + 1 });
      }
    }
    const g3 = buildGraph(a, 3);
    expect(g3.nodes.filter((n) => n.related).map((n) => n.label).sort()).toEqual([
      'ApplyDiscountUseCase.execute',
      'OrderRepositoryImpl.find',
      'OrderRepositoryImpl.save',
      'PromoService.apply',
      'api.OrderDetailResponse',
      'api.OrderResponse',
      'api.OrderSummaryResponse',
      'domain.DiscountCommand',
    ]);
    // How の hunk でも読む順番に無ければ関連（逸脱の PromoService.apply）。紫の枠（seed）は残す
    const promo = g3.nodes.find((n) => n.label === 'PromoService.apply')!;
    expect(g3.seed.has(promo.id)).toBe(true);
    expect(g3.nodes.filter((n) => !n.related).map((n) => [n.order, n.label])).toEqual(
      expect.arrayContaining([
        [1, 'domain.Order'],
        [2, '追従 22 件 · 差異あり 1'],
      ]),
    );
  });

  it('0（コース外）で絞ると、どの How にも属さない hunk が種で、その順に番号が付く', () => {
    const a = fixtureAnalysis();
    const g = buildGraph(a, 0);
    const unassigned = a.hunks.filter((h) => h.hows.length === 0).map((h) => h.id);
    expect([...g.seed].sort()).toEqual(unassigned.filter((id) => g.nodes.some((n) => n.id === id)).sort());
    expect(g.seed.size).toBeGreaterThan(0);
    const numbered = g.nodes.filter((n) => n.order !== undefined).sort((x, y) => x.order! - y.order!);
    expect(numbered.map((n) => n.id)).toEqual(unassigned.filter((id) => g.nodes.some((n) => n.id === id)));
  });

  it('全体表示では related も order も付けない', () => {
    for (const n of buildGraph(fixtureAnalysis(), null).nodes) {
      expect(n.related).toBeUndefined();
      expect(n.order).toBeUndefined();
    }
  });

  it('束は 1 箱になり、件数と書き換えのパターンを持つ。逸脱は畳まない', () => {
    const a = fixtureAnalysis();
    const g = buildGraph(a, null);
    const group = a.hunks.find((h) => h.group)!.group!;
    const box = g.nodes.find((n) => n.id === GROUP_PREFIX + group.representative)!;
    expect(box).toMatchObject({ group: true, band: NO_LAYER, label: '追従 22 件 · 差異あり 1', representative: group.representative });
    expect(box.sub).toContain(group.pattern);
    for (const m of group.members) expect(g.nodes.some((n) => n.id === m)).toBe(false);
    for (const d of group.deviations) expect(g.nodes.some((n) => n.id === d)).toBe(true);
  });

  it('同じ向きの辺は 1 本にし、種類は 呼び出し > テスト > 参照 の強い方、本数は足す', () => {
    const a = fixtureAnalysis();
    const g = buildGraph(a, null);
    const pairs = new Set(g.edges.map((e) => `${e.from}>${e.to}`));
    expect(pairs.size).toBe(g.edges.length);
    const fromBox = g.edges.find((e) => e.from.startsWith(GROUP_PREFIX))!;
    expect(fromBox).toMatchObject({ kind: 'reference', n: 21 });
  });

  it('テストのシンボルと test 辺は出さない（tests: true で出す）', () => {
    const a = fixtureAnalysis();
    const off = buildGraph(a, null);
    expect(off.nodes.some((n) => n.band === 'Tests')).toBe(false);
    expect(off.edges.some((e) => e.kind === 'test')).toBe(false);
    const on = buildGraph(a, null, { tests: true });
    expect(on.nodes.filter((n) => n.band === 'Tests').length).toBeGreaterThan(0);
    expect(on.edges.some((e) => e.kind === 'test')).toBe(true);
  });

  it('呼び出し関係を測れていないシンボルは edgesMeasured: false を持つ（箱に「? 測れていない」と書く元）', () => {
    const g = buildGraph(fixtureAnalysis(), null);
    expect(g.nodes.some((n) => n.edgesMeasured === false && !n.group)).toBe(true);
  });

  it('決定的: 同じ入力から同じ出力', () => {
    const a = buildGraph(fixtureAnalysis(), 5);
    const b = buildGraph(fixtureAnalysis(), 5);
    expect({ ...a, seed: [...a.seed] }).toEqual({ ...b, seed: [...b.seed] });
  });
});

// 2026-10-11: 差分の無いコードは「関係がある」と分かれば十分で、差分と同じ箱にしない（差分が責任の単位という方針。見本の 2 版「層ごと」）。
// 差分の箱ごと・層ごとに「差分なし n か所」。同じ層は差分の箱の右隣（side）、ほかの層はその層の帯の箱（rel）と線。10/10 のまとめた箱（fold）は廃止
describe('差分の無い相手（層ごとの「差分なし n か所」）', () => {
  const idOf = (a: ReturnType<typeof fixtureAnalysis>, fq: string) => a.symbols.find((s) => s.fqName === fq)!.id;
  const byLabel = (nodes: MapNode[], label: string) => nodes.find((n) => n.label === label)!;
  const groups = (nodes: MapNode[]) => nodes.flatMap((n) => [n.side, n.rel].filter((g) => g !== undefined));

  it('差分の無いシンボルは箱にも線の端にもならない', () => {
    const a = fixtureAnalysis();
    const unchanged = new Set(a.symbols.filter((s) => !s.changed).map((s) => s.id));
    const g = buildGraph(a, null);
    expect(g.nodes.some((n) => unchanged.has(n.id))).toBe(false);
    expect(g.edges.some((e) => unchanged.has(e.from) || unchanged.has(e.to))).toBe(false);
  });

  it('同じ層の相手は差分の箱の side: domain.Order の右に呼び出し先 1（DiscountPolicy.rateFor）、Logger.format の右に呼び出し元 1（Logger.log）', () => {
    const g = buildGraph(fixtureAnalysis(), null);
    const order = byLabel(g.nodes, 'domain.Order');
    expect(order.side).toEqual({ host: order.id, layer: 'Domain', callers: 0, callees: 1, crosses: false });
    const format = byLabel(g.nodes, 'Logger.format');
    expect(format.side).toEqual({ host: format.id, layer: NO_LAYER, callers: 1, callees: 0, crosses: false });
  });

  it('ほかの層の相手はその層の帯の箱「差分なし n か所」。呼び出し先だけなら線は差分の箱から相手へ', () => {
    const a = fixtureAnalysis();
    const g = buildGraph(a, null);
    const exec = idOf(a, 'com.example.order.application.ApplyDiscountUseCase.execute');
    const box = g.nodes.find((n) => n.id === `${REL_PREFIX}${exec}:Domain`)!;
    // execute が足した行で呼ぶ OrderRepository.save だけ（find は変わらない行から呼ぶので辺が無い。2026-10-12）
    expect(box).toMatchObject({ label: '差分なし 1 か所', sub: '呼び出し先 1', band: 'Domain', changed: false, group: false, rel: { host: exec, layer: 'Domain', callers: 0, callees: 1, crosses: false } });
    expect(byLabel(g.nodes, 'ApplyDiscountUseCase.execute').side).toBeUndefined();
    expect(g.edges.filter((e) => e.from === box.id || e.to === box.id)).toEqual([{ from: exec, to: box.id, kind: 'call', n: 1, crosses: false, rel: { both: false } }]);
  });

  it('層を飛び越える呼び出しが 1 本でもあれば、まとまりの線も層越え（OrderController.apply → OrderRepository.save）', () => {
    const a = fixtureAnalysis();
    const g = buildGraph(a, null);
    const apply = idOf(a, 'com.example.order.api.OrderController.apply');
    expect(g.edges.find((e) => e.to === `${REL_PREFIX}${apply}:Domain`)).toMatchObject({ from: apply, crosses: true, rel: { both: false } });
  });

  it('呼び出し元の方が多いまとまりは相手から差分の箱へ。両方あれば両矢印（both）', () => {
    const a = fixtureWithNeighbors();
    const order = idOf(a, 'com.example.order.domain.Order');
    a.symbols.push({ id: 'unchanged:com.example.cart.application.CartView.render', fqName: 'com.example.cart.application.CartView.render', path: 'src/main/kotlin/com/example/cart/application/CartView.kt', layer: 'Application', layerProvenance: 'config', kind: 'function', changed: false, edgesMeasured: true });
    a.edges.push({ from: order, to: 'unchanged:com.example.cart.application.CartView.render', kind: 'call', crossesLayers: false, provenance: 'lsp' });
    const g = buildGraph(a, null);
    const box = g.nodes.find((n) => n.id === `${REL_PREFIX}${order}:Application`)!;
    expect(box).toMatchObject({ label: '差分なし 5 か所', sub: '呼び出し元 4 · 呼び出し先 1', band: 'Application' });
    expect(g.edges.filter((e) => e.to === order && e.from === box.id)).toEqual([{ from: box.id, to: order, kind: 'call', n: 5, crosses: false, rel: { both: true } }]);
  });

  it('テストからだけの相手（Money.ZERO）は地図に出ない。数は 4 つ（rateFor・save（execute と apply から）・Logger.log）', () => {
    const g = buildGraph(fixtureAnalysis(), null);
    expect(groups(g.nodes).reduce((n, x) => n + x.callers + x.callees, 0)).toBe(4);
  });

  it('コースで絞ると、範囲の箱（紫の枠）のまとまりだけ残る。まとまりの箱は関連にも番号にもならない', () => {
    const a = fixtureAnalysis();
    const g5 = buildGraph(a, 5);
    const exec = idOf(a, 'com.example.order.application.ApplyDiscountUseCase.execute');
    expect(g5.nodes.filter((n) => n.rel).map((n) => n.rel!.host)).toEqual([exec]);
    for (const n of g5.nodes) if (n.side) expect(g5.seed.has(n.id), n.label).toBe(true);
    const box = g5.nodes.find((n) => n.rel)!;
    expect([box.related, box.order]).toEqual([undefined, undefined]);
    // コース 3: Order は範囲の箱なので side が残る
    expect(byLabel(buildGraph(a, 3).nodes, 'domain.Order').side).toMatchObject({ callees: 1 });
  });

  it('決定的: シンボルと辺の並びが変わっても同じ', () => {
    const a = fixtureWithNeighbors();
    const b = fixtureWithNeighbors();
    b.symbols.reverse();
    b.edges.reverse();
    const pick = (x: typeof a) => {
      const g = buildGraph(x, null);
      return { nodes: g.nodes.map((n) => [n.id, n.side, n.rel]).sort(), edges: g.edges.filter((e) => e.rel).map((e) => [e.from, e.to, e.n]).sort() };
    };
    expect(pick(b)).toEqual(pick(a));
  });
});

describe('relationsOf', () => {
  const idOf = (a: ReturnType<typeof fixtureAnalysis>, fq: string) => a.symbols.find((s) => s.fqName === fq)!.id;
  const names = (xs: RelItem[] | undefined) => (xs ?? []).map((x) => x.name);

  it('地図の箱ごとの差分の無い呼び出し元・呼び出し先（名前順）。名前・層・パスを持つ', () => {
    const a = fixtureAnalysis();
    const rels = relationsOf(a);
    const exec = rels.get(idOf(a, 'com.example.order.application.ApplyDiscountUseCase.execute'))!;
    expect(names(exec.callers)).toEqual([]);
    expect(exec.callees).toEqual([{ id: idOf(a, 'com.example.order.domain.OrderRepository.save'), name: 'OrderRepository.save', layer: 'Domain', path: 'src/main/kotlin/com/example/order/domain/OrderRepository.kt', crosses: false }]);
    expect(names(rels.get(idOf(a, 'com.example.order.domain.Order'))!.callees)).toEqual(['DiscountPolicy.rateFor']);
    expect(names(rels.get(idOf(a, 'com.example.common.Logger.format'))!.callers)).toEqual(['Logger.log']);
  });

  it('テストの呼び出し先も持つ（テストの箱の id で引く）。差分の無いテストからの呼び出しは数えない', () => {
    const a = fixtureAnalysis();
    const zero = idOf(a, 'com.example.order.domain.Money.Companion.ZERO');
    const host = a.edges.find((e) => e.to === zero)!.from;
    expect(names(relationsOf(a).get(host)!.callees)).toEqual(['Companion.ZERO']);
  });

  it('束のメンバーの相手は束の箱で引く。同じ相手は 1 回だけ（呼び出しとテストの両方で来ても）', () => {
    const a = fixtureAnalysis();
    const group = a.hunks.find((h) => h.group)!.group!;
    const member = group.members.find((m) => m !== group.representative)!;
    a.symbols.push({ id: 'unchanged:x.Report.build', fqName: 'x.Report.build', path: 'src/main/kotlin/x/Report.kt', kind: 'function', changed: false, edgesMeasured: true });
    a.edges.push({ from: 'unchanged:x.Report.build', to: member, kind: 'call', crossesLayers: false, provenance: 'lsp' });
    a.edges.push({ from: 'unchanged:x.Report.build', to: group.representative, kind: 'call', crossesLayers: false, provenance: 'lsp' });
    expect(relationsOf(a).get(GROUP_PREFIX + group.representative)!.callers).toEqual([{ id: 'unchanged:x.Report.build', name: 'Report.build', layer: NO_LAYER, path: 'src/main/kotlin/x/Report.kt', crosses: false }]);
  });
});

describe('mapBands', () => {
  it('設定の層の順番で、最後に「層なし」', () => {
    expect(mapBands(fixtureAnalysis())).toEqual(['Tests', 'API', 'Application', 'Domain', 'Infrastructure', NO_LAYER]);
  });

  it('設定の層が無ければ、構成の推定の並び（呼ぶ側が上。設計書 10.6）で、最後に「層なし」', () => {
    expect(mapBands(inferred())).toEqual(['Web', 'Core', NO_LAYER]);
  });

  it('設定の層も推定も無ければ「層なし」だけ', () => {
    const a = fixtureAnalysis();
    a.config.layers = [];
    expect(mapBands(a)).toEqual([NO_LAYER]);
  });
});

describe('帯と層の表示名（推定は「（推定）」。原則 2）', () => {
  it('推定の帯は名前に（推定）を付ける。設定の帯は付けない', () => {
    expect(buildGraph(inferred(), null).bandLabels).toEqual(new Map([['Web', 'Web（推定）'], ['Core', 'Core（推定）']]));
    expect(buildGraph(fixtureAnalysis(), null).bandLabels).toEqual(new Map());
  });

  it('layerText: 層なし / 設定の層 / LLM が推定した層', () => {
    expect(layerText(undefined)).toBe(NO_LAYER);
    expect(layerText({})).toBe(NO_LAYER);
    expect(layerText({ layer: 'Domain', layerProvenance: 'config' })).toBe('Domain');
    expect(layerText({ layer: 'Domain', layerProvenance: 'llm' })).toBe('Domain（推定）');
  });
});

describe('テストの見分けが推定の解析（5.2 の 7。原則 2）', () => {
  /** 設定にテストの置き場が無く、構成の推定のテストの置き場（src/test）でテストを見分けた解析 */
  function guessed() {
    const a = inferred();
    a.structure = { ...a.structure!, tests: ['src/test'] };
    a.hunks = a.hunks.map((h) => (h.kind === 'test' ? { ...h, kindProvenance: 'llm' as const } : h));
    return a;
  }

  it('テストの箱は出さない', () => {
    const a = guessed();
    const testPaths = new Set(a.symbols.filter((s) => s.path.startsWith('src/test/')).map((s) => s.id));
    expect(buildGraph(a, null).nodes.some((n) => testPaths.has(n.id))).toBe(false);
  });

  it('テスト n のチップに推定の印を付ける。設定で見分けた解析には付けない', () => {
    const counted = buildGraph(guessed(), null).nodes.filter((n) => n.testCount);
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.every((n) => n.testGuess === true)).toBe(true);
    expect(buildGraph(fixtureAnalysis(), null).nodes.some((n) => 'testGuess' in n)).toBe(false);
  });

  it('testsGuessed: 構成の推定のテストの置き場で見分けた解析だけ真', () => {
    expect(testsGuessed(guessed())).toBe(true);
    expect(testsGuessed(inferred())).toBe(false);
    expect(testsGuessed(fixtureAnalysis())).toBe(false);
  });
});

/** 設定の層が無く、構成の推定（Web / Core）から層が付いた解析 */
function inferred() {
  const a = fixtureAnalysis();
  a.config.layers = [];
  a.structure = { status: 'ok', layers: ['Web', 'Core'] };
  a.symbols = a.symbols.map((s) => ({ ...s, layer: s.path.includes('/api/') ? 'Web' : 'Core', layerProvenance: 'llm' as const }));
  return a;
}

describe('shortName', () => {
  it('最後の 2 つ（クラス.メンバー）。ファイル単位はファイル名だけ', () => {
    expect(shortName('com.example.order.domain.Order.applyDiscount', 'x.kt', 'function')).toBe('Order.applyDiscount');
    expect(shortName('src/main/resources/db/V421__discount.sql', 'src/main/resources/db/V421__discount.sql', 'file')).toBe('V421__discount.sql');
  });
});

describe('全体の地図の丸（コース）', () => {
  const a = fixtureAnalysis();
  const byLabel = (label: string) => buildGraph(a, null).nodes.find((n) => n.label === label);

  it('差分のある箱は、その hunk の最初の How（コース）。How に属さなければ 0（コース外）', () => {
    expect(byLabel('domain.Order')?.course).toBe(3);
    expect(byLabel('Logger.format')?.course).toBe(0);
    const g = buildGraph(a, null);
    for (const n of g.nodes.filter((x) => x.changed && !x.group)) {
      const h = a.hunks.find((x) => x.id === n.id)!;
      expect(n.course, n.label).toBe(h.hows[0] ?? 0);
    }
  });

  it('束の箱は代表の hunk のコース。「差分なし」の箱には丸が無い', () => {
    const g = buildGraph(a, null);
    const grp = g.nodes.find((n) => n.group)!;
    expect(grp.course).toBe(a.hunks.find((h) => h.id === grp.representative)!.hows[0]);
    for (const n of g.nodes.filter((x) => !x.changed)) expect(n.course, n.label).toBeUndefined();
  });

  it('コースで絞った地図には丸を付けない（番号の丸と重なるため）', () => {
    for (const n of buildGraph(a, 3).nodes) expect(n.course).toBeUndefined();
  });
});
