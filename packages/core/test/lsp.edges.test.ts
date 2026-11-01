// 呼び出し辺の組み立て（設計書 9.2〜9.4）。LSP が返した生の答えから Edge と Symbol を作る純粋な処理。
// 実機で確かめた形は src/lsp/edges.ts の先頭。
import { describe, expect, it } from 'vitest';
import type { Hunk, Symbol as OndinaSymbol } from '@ondina/model';
import { hunkId } from '../src/hunks/stable-id.js';
import { buildSymbols } from '../src/symbols/build.js';
import { buildCallGraph, crossesLayers, fqNameOf, signatureTypes, symbolKindOf, type CallGraphSource, type CallItem } from '../src/lsp/edges.js';

const DOMAIN = { name: 'Domain', match: ['**/domain/**'] };
const API = { name: 'API', match: ['**/api/**'] };
const TESTS = { name: 'Tests', match: ['src/test/**'] };
const LAYERS = [TESTS, API, DOMAIN];
const ALLOWED = { API: ['Domain'], Tests: ['API', 'Domain'] };

const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
const POLICY = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';
const CONTROLLER = 'src/main/kotlin/com/example/order/api/OrderController.kt';
const ORDER_TEST = 'src/test/kotlin/com/example/order/domain/OrderTest.kt';

function hunk(path: string, fqName: string, over: Partial<Hunk> = {}): Hunk {
  return {
    id: hunkId(path, fqName),
    path,
    lang: 'kotlin',
    symbol: fqName.split('.').pop()!,
    symbolFqName: fqName,
    symbolKind: 'function',
    kind: 'none',
    kindProvenance: 'ast',
    hows: [],
    n: 1,
    lnOld: 1,
    lnNew: 1,
    lines: [],
    ...over,
  };
}

function item(path: string, detail: string, name: string, kind = 6): CallItem {
  return { name, detail, kind, path };
}

/** 変更 hunk から symbols を組んで buildCallGraph に渡す。本番（analyze）と同じ順 */
function build(hunks: readonly Hunk[], src: Partial<CallGraphSource>, readHead?: (repoRelative: string) => string | undefined) {
  const symbols = buildSymbols(hunks, LAYERS);
  return buildCallGraph({ probes: [], calls: [], signatures: {}, testRefs: {}, refs: {}, ranges: {}, ...src }, { hunks, symbols, layers: LAYERS, allowedDependencies: ALLOWED, ...(readHead === undefined ? {} : { readHead }) });
}

describe('fqNameOf', () => {
  it('detail（パッケージ）と name の括弧より前を繋ぐ', () => {
    expect(fqNameOf(item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'))).toBe('com.example.order.domain.Order.applyDiscount');
  });

  it('companion も name のまま繋ぐ', () => {
    expect(fqNameOf(item(CONTROLLER, 'com.example.order.api', 'OrderResponse.Companion.from(Order)'))).toBe('com.example.order.api.OrderResponse.Companion.from');
  });

  it('括弧が無ければ name をそのまま使う（プロパティ）', () => {
    expect(fqNameOf(item(POLICY, 'com.example.order.domain', 'DiscountPolicy.TABLE', 7))).toBe('com.example.order.domain.DiscountPolicy.TABLE');
  });

  it('detail が無ければ name だけ', () => {
    expect(fqNameOf({ name: 'topLevel()', kind: 12, path: ORDER })).toBe('topLevel');
  });
});

describe('signatureTypes', () => {
  it('引数の型を , で繋ぎ、戻り型を取る', () => {
    expect(signatureTypes('fun execute(id: OrderId, code: String): Order')).toEqual({ in: 'OrderId, String', out: 'Order' });
  });

  it('戻り型が無ければ（Unit）out は欄ごと無い', () => {
    expect(signatureTypes('override fun save(order: Order)')).toEqual({ in: 'Order' });
  });

  it('引数が無ければ in は欄ごと無い', () => {
    expect(signatureTypes('fun total(): Money')).toEqual({ out: 'Money' });
  });

  it('null 許容をそのまま残す', () => {
    expect(signatureTypes('fun find(id: OrderId): Order?')).toEqual({ in: 'OrderId', out: 'Order?' });
  });

  it('ジェネリクスの , で割らない。アノテーション付きの引数からも型を取る', () => {
    expect(signatureTypes('@PostMapping fun apply(@PathVariable id: String, @RequestBody body: ApplyDiscountRequest): ResponseEntity<OrderResponse>')).toEqual({
      in: 'String, ApplyDiscountRequest',
      out: 'ResponseEntity<OrderResponse>',
    });
  });

  it('既定値は型に含めない', () => {
    expect(signatureTypes('fun of(amount: Long = 0): Money')).toEqual({ in: 'Long', out: 'Money' });
  });

  it('ラムダの引数も型として残す', () => {
    expect(signatureTypes('fun each(block: (Int) -> Unit)')).toEqual({ in: '(Int) -> Unit' });
  });

  it('KDoc が前に付いた複数行でも、括弧のある行を読む', () => {
    expect(signatureTypes('注文に割引を適用する。\nfun execute(id: OrderId): Order')).toEqual({ in: 'OrderId', out: 'Order' });
  });

  it('括弧が無ければ両方とも欄ごと無い（プロパティの hover）', () => {
    expect(signatureTypes('val ZERO: Money')).toEqual({});
    expect(signatureTypes('')).toEqual({});
  });
});

describe('symbolKindOf', () => {
  it('LSP の SymbolKind を Symbol.kind に写す', () => {
    expect(symbolKindOf(6)).toBe('function');
    expect(symbolKindOf(12)).toBe('function');
    expect(symbolKindOf(5)).toBe('class');
    expect(symbolKindOf(7)).toBe('property');
    expect(symbolKindOf(14)).toBe('property');
    expect(symbolKindOf(9)).toBe('constructor');
  });

  it('知らない番号は function（推測を増やさない）', () => {
    expect(symbolKindOf(99)).toBe('function');
  });
});

describe('crossesLayers', () => {
  const sym = (layer?: string): OndinaSymbol => ({ id: 'x', fqName: 'x', path: 'x', kind: 'function', changed: true, ...(layer === undefined ? {} : { layer, layerProvenance: 'config' as const }) });

  it('同じ層なら飛び越えない', () => {
    expect(crossesLayers(sym('Domain'), sym('Domain'), ALLOWED)).toBe(false);
  });

  it('許された向きなら飛び越えない', () => {
    expect(crossesLayers(sym('API'), sym('Domain'), ALLOWED)).toBe(false);
  });

  it('許されていない向きなら飛び越える', () => {
    expect(crossesLayers(sym('Domain'), sym('API'), ALLOWED)).toBe(true);
  });

  it('呼んでよい向きが 1 つも書かれていなければ判定しない（決まりを知らないだけで赤い破線にしない）', () => {
    expect(crossesLayers(sym('Domain'), sym('API'), {})).toBe(false);
  });

  it('片方でも層が無ければ false（層を知らないだけで赤い破線にしない）', () => {
    expect(crossesLayers(sym(), sym('API'), ALLOWED)).toBe(false);
    expect(crossesLayers(sym('Domain'), sym(), ALLOWED)).toBe(false);
    expect(crossesLayers(sym(), sym(), ALLOWED)).toBe(false);
  });
});

describe('buildCallGraph の端点の対応づけ', () => {
  const controller = hunk(CONTROLLER, 'com.example.order.api.OrderController.apply');
  const orderClass = hunk(ORDER, 'com.example.order.domain.Order', { symbolKind: 'class' });

  it('FQ 名が変更 hunk と一致すればその Symbol.id を使う', () => {
    const { edges } = build([controller, orderClass], {
      calls: [{ from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), kind: 'call' }],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.from).toBe(controller.id);
  });

  it('関数が丸ごとクラスの hunk に入っているときは、そのクラスの Symbol に丸める（5.2 の 1 の格上げ）', () => {
    const { edges, symbols } = build([controller, orderClass], {
      calls: [{ from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), kind: 'call' }],
    });
    expect(edges[0]!.to).toBe(orderClass.id);
    expect(symbols.filter((s) => !s.changed)).toHaveLength(0);
  });

  it('接頭辞が 2 つ当たるときは長いほうに丸める', () => {
    const inner = hunk(ORDER, 'com.example.order.domain.Order.Inner', { symbolKind: 'class' });
    const { edges } = build([orderClass, inner], {
      calls: [{ from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: item(ORDER, 'com.example.order.domain', 'Order.Inner.run()'), kind: 'call' }],
    });
    expect(edges[0]!.to).toBe(inner.id);
  });

  it('変更 hunk に当たらない端点は未変更シンボルとして足す（changed: false、hunkId なし、層は glob）', () => {
    const { symbols } = build([controller], {
      calls: [{ from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: item(POLICY, 'com.example.order.domain', 'DiscountPolicy.rateFor(String)'), kind: 'call' }],
    });
    const added = symbols.filter((s) => !s.changed);
    expect(added).toHaveLength(1);
    expect(added[0]).toEqual({
      id: hunkId(POLICY, 'com.example.order.domain.DiscountPolicy.rateFor'),
      fqName: 'com.example.order.domain.DiscountPolicy.rateFor',
      path: POLICY,
      layer: 'Domain',
      layerProvenance: 'config',
      kind: 'function',
      changed: false,
      edgesMeasured: true,
    });
  });

  it('経路上の未変更シンボルの layerProvenance は ctx の layerProvenance に従う（構成の推定なら llm）', () => {
    const symbols = buildSymbols([controller], LAYERS, 'llm');
    const src = { probes: [], calls: [{ from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: item(POLICY, 'com.example.order.domain', 'DiscountPolicy.rateFor(String)'), kind: 'call' as const }], signatures: {}, testRefs: {}, refs: {}, ranges: {} };
    const out = buildCallGraph(src, { hunks: [controller], symbols, layers: LAYERS, allowedDependencies: ALLOWED, layerProvenance: 'llm' });
    expect(out.symbols.find((s) => !s.changed)).toMatchObject({ layer: 'Domain', layerProvenance: 'llm' });
  });

  it('バッククォート名のテスト関数も変更シンボルに対応づける（LSP はバッククォートを外して返す）', () => {
    const test = hunk(ORDER_TEST, 'com.example.order.domain.OrderTest.`applies the policy rate to subtotal`', { kind: 'test' });
    const { edges, symbols } = build([test, orderClass], {
      calls: [{ from: item(ORDER_TEST, 'com.example.order.domain', 'OrderTest.applies the policy rate to subtotal()'), to: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), kind: 'test' }],
    });
    expect(edges[0]!.from).toBe(test.id);
    expect(symbols.filter((s) => !s.changed)).toHaveLength(0);
  });

  it('丸めた結果 両端が同じシンボルになった辺は捨てる（自己ループを描かない）', () => {
    const { edges } = build([orderClass], {
      calls: [{ from: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), to: item(ORDER, 'com.example.order.domain', 'Order.total()'), kind: 'call' }],
    });
    expect(edges).toEqual([]);
  });
});

describe('buildCallGraph の辺', () => {
  const controller = hunk(CONTROLLER, 'com.example.order.api.OrderController.apply');
  const call = { from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: item(POLICY, 'com.example.order.domain', 'DiscountPolicy.rateFor(String)'), kind: 'call' as const };

  it('呼ばれる側のシグネチャから辺ラベルを付け、provenance は lsp', () => {
    const { edges } = build([controller], { calls: [call], signatures: { 'com.example.order.domain.DiscountPolicy.rateFor': 'fun rateFor(code: String): Rate' } });
    expect(edges[0]).toMatchObject({ kind: 'call', types: { in: 'String', out: 'Rate' }, provenance: 'lsp' });
  });

  it('シグネチャが無ければ types は欄ごと無い', () => {
    const { edges } = build([controller], { calls: [call] });
    expect(edges[0]).not.toHaveProperty('types');
  });

  it('層越えを判定する（API → Domain は許されているので false）', () => {
    const { edges } = build([controller], { calls: [call] });
    expect(edges[0]!.crossesLayers).toBe(false);
  });

  it('許されていない向きは crossesLayers: true', () => {
    const order = hunk(ORDER, 'com.example.order.domain.Order.applyDiscount');
    const { edges } = build([order], {
      calls: [{ from: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), to: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), kind: 'call' }],
    });
    expect(edges[0]!.crossesLayers).toBe(true);
  });

  it('同じ (from, to, kind) は 1 本に落とす', () => {
    const { edges } = build([controller], { calls: [call, call, call] });
    expect(edges).toHaveLength(1);
  });

  it('kind が違えば別の辺（呼び出しとテストは分ける）', () => {
    const { edges } = build([controller], { calls: [call, { ...call, kind: 'test' }] });
    expect(edges.map((e) => e.kind).sort()).toEqual(['call', 'test']);
  });

  describe('呼んでいる行（読む順と「n 行で呼ぶ」の材料）', () => {
    const order = hunk(ORDER, 'com.example.order.domain.Order.applyDiscount');
    const toOrder = { from: call.from, to: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), kind: 'call' as const };

    it('1 始まりにして残す', () => {
      const { edges } = build([controller, order], { calls: [{ ...toOrder, lines: [16] }] });
      expect(edges[0]!.lines).toEqual([17]);
    });

    it('同じ両端の記録（インターフェースと実装など）の行は合わせ、昇順で重複なし', () => {
      const { edges } = build([controller, order], { calls: [{ ...toOrder, lines: [20, 16] }, { ...toOrder, lines: [16] }, toOrder] });
      expect(edges).toHaveLength(1);
      expect(edges[0]!.lines).toEqual([17, 21]);
    });

    it('位置の無い記録と、言語サーバーが位置を返さなかった記録だけなら欄ごと無い', () => {
      const { edges } = build([controller, order], { calls: [toOrder, { ...toOrder, lines: [] }] });
      expect(edges[0]).not.toHaveProperty('lines');
    });
  });

  it('入力の順を入れ替えても同じ並びになる（原則 7）', () => {
    const a = call;
    const b = { from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), kind: 'call' as const };
    const one = build([controller], { calls: [a, b] }).edges;
    const two = build([controller], { calls: [b, a] }).edges;
    expect(one).toEqual(two);
    expect(one.map((e) => `${e.from}->${e.to}`)).toEqual([...one.map((e) => `${e.from}->${e.to}`)].sort());
  });
});

describe('buildCallGraph の差分の無い呼び出し先は足した行からの呼び出しだけ（2026-10-12）', () => {
  const USECASE = 'src/main/kotlin/com/example/order/application/ApplyDiscountUseCase.kt';
  const REPO = 'src/main/kotlin/com/example/order/application/OrderRepository.kt';
  // fixture の execute と同じ形。15 = 足した行（宣言）、16 = 変わらない行（find）、17・18 = 足した行（applyDiscount / save）
  const execute = hunk(USECASE, 'com.example.order.application.ApplyDiscountUseCase.execute', {
    lnOld: 14,
    lnNew: 15,
    lines: [
      '-    fun execute(id: OrderId): Order {',
      '+    fun execute(id: OrderId, code: String): Order {',
      '         val order = repository.find(id) ?: throw OrderNotFound(id)',
      '+        order.applyDiscount(DiscountCommand(code))',
      '+        repository.save(order)',
      '         return order',
      '     }',
    ],
  });
  const exec = item(USECASE, 'com.example.order.application', 'ApplyDiscountUseCase.execute(OrderId, String)');
  const find = item(REPO, 'com.example.order.application', 'OrderRepository.find(OrderId)');
  const save = item(REPO, 'com.example.order.application', 'OrderRepository.save(Order)');
  const unchanged = (r: ReturnType<typeof build>) => r.symbols.filter((s) => !s.changed).map((s) => s.fqName);

  it('変わらない行からの呼び出しは辺にせず、相手の未変更シンボルも作らない。足した行からの呼び出しは辺にする', () => {
    const r = build([execute], {
      calls: [
        { from: exec, to: find, kind: 'call', lines: [15] },
        { from: exec, to: save, kind: 'call', lines: [17] },
      ],
    });
    expect(unchanged(r)).toEqual(['com.example.order.application.OrderRepository.save']);
    expect(r.edges.map((e) => e.to)).toEqual([hunkId(REPO, 'com.example.order.application.OrderRepository.save')]);
  });

  it('呼んでいる位置が複数あれば、どれかが足した行なら辺にする', () => {
    const r = build([execute], { calls: [{ from: exec, to: find, kind: 'call', lines: [15, 16] }] });
    expect(unchanged(r)).toEqual(['com.example.order.application.OrderRepository.find']);
  });

  it('クラス丸ごとの hunk では、変わらないメソッドからの呼び出しを辺にしない（同じクラスにあるだけで差分と関係しない）', () => {
    const MONEY = 'src/main/kotlin/com/example/order/domain/Money.kt';
    // 1 class Order( / 2 + var discount / 3 ) { / 4 + fun applyDiscount / 5 + DiscountPolicy.rateFor / 6 + } / 7 / 8 fun total() = subtotal.plus(x) / 9 }
    const orderClass = hunk(ORDER, 'com.example.order.domain.Order', {
      symbolKind: 'class',
      lines: [' class Order(', '+    var discount: Money = Money.ZERO,', ' ) {', '+    fun applyDiscount(cmd: DiscountCommand) {', '+        val rate = DiscountPolicy.rateFor(cmd.code)', '+    }', ' ', '     fun total(): Money = subtotal.plus(tax)', ' }'],
    });
    const r = build([orderClass], {
      calls: [
        { from: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), to: item(POLICY, 'com.example.order.domain', 'DiscountPolicy.rateFor(String)'), kind: 'call', lines: [4] },
        { from: item(ORDER, 'com.example.order.domain', 'Order.total()'), to: item(MONEY, 'com.example.order.domain', 'Money.plus(Money)'), kind: 'call', lines: [7] },
      ],
    });
    expect(unchanged(r)).toEqual(['com.example.order.domain.DiscountPolicy.rateFor']);
  });

  it('テスト関数から呼んでいる相手も同じ（変えたテストの変わらない行からの呼び出しは辺にしない）', () => {
    const test = hunk(ORDER_TEST, 'com.example.order.domain.OrderTest.keeps', { lnNew: 10, lines: ['     fun keeps() {', '+        val order = Order(id, Money(100))', '         assertEquals(Money(100), order.total())', '     }'] });
    const from = item(ORDER_TEST, 'com.example.order.domain', 'OrderTest.keeps()');
    const r = build([test], {
      calls: [
        { from, to: item(ORDER, 'com.example.order.domain', 'Order.total()'), kind: 'test', lines: [11] },
        { from, to: item(ORDER, 'com.example.order.domain', 'Order.Order(OrderId, Money)'), kind: 'test', lines: [10] },
      ],
    });
    expect(unchanged(r)).toEqual(['com.example.order.domain.Order.Order']);
  });

  it('呼んでいる位置が無い（位置の無い記録）・空（言語サーバーが返さなかった）なら残す（測れていないものを隠さない）', () => {
    expect(unchanged(build([execute], { calls: [{ from: exec, to: find, kind: 'call' }] }))).toHaveLength(1);
    expect(unchanged(build([execute], { calls: [{ from: exec, to: find, kind: 'call', lines: [] }] }))).toHaveLength(1);
  });

  it('差分どうしの辺と、差分の無い呼び出し元からの辺は、呼んでいる位置によらず残す', () => {
    const apply = hunk(ORDER, 'com.example.order.domain.Order.applyDiscount');
    const toChanged = build([execute, apply], { calls: [{ from: exec, to: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), kind: 'call', lines: [15] }] });
    expect(toChanged.edges).toHaveLength(1);
    const caller = build([execute], { calls: [{ from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: exec, kind: 'call', lines: [3] }] });
    expect(unchanged(caller)).toEqual(['com.example.order.api.OrderController.apply']);
  });
});

describe('buildCallGraph の測れたかどうかと testCount', () => {
  const order = hunk(ORDER, 'com.example.order.domain.Order.applyDiscount');
  const total = hunk(ORDER, 'com.example.order.domain.Order.total');

  it('callHierarchy が答えた変更シンボルは edgesMeasured: true', () => {
    const { symbols } = build([order], { probes: [{ hunkId: order.id, item: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)') }] });
    expect(symbols[0]!.edgesMeasured).toBe(true);
  });

  it('答えなかった変更シンボルは edgesMeasured: false で、件数を返す（戻り型が value class の穴。9 章）', () => {
    const { symbols, unmeasured } = build([order, total], {
      probes: [{ hunkId: order.id, item: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)') }, { hunkId: total.id }],
    });
    expect(symbols.find((s) => s.id === total.id)!.edgesMeasured).toBe(false);
    expect(unmeasured).toBe(1);
  });

  it('問い合わせていない hunk（ファイル hunk など）には欄ごと付かない = 未計測', () => {
    const file = hunk(ORDER, ORDER, { symbolKind: 'file' });
    const { symbols } = build([order, file], { probes: [{ hunkId: order.id, item: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)') }] });
    expect(symbols.find((s) => s.id === file.id)).not.toHaveProperty('edgesMeasured');
  });

  it('testCount は参照していたテスト関数の数（参照の行数ではない）', () => {
    const { symbols } = build([order], {
      testRefs: { [order.id]: ['com.example.order.domain.OrderTest.`applies the policy rate to subtotal`', 'com.example.order.domain.OrderTest.`keeps total when code is unknown`'] },
    });
    expect(symbols[0]!.testCount).toBe(2);
  });

  it('参照を測っていない hunk には testCount を付けない（0 件と未計測を混ぜない）', () => {
    const { symbols } = build([order], {});
    expect(symbols[0]).not.toHaveProperty('testCount');
  });

  it('テストからの参照が 0 件なら testCount: 0（測った結果の 0）', () => {
    const { symbols } = build([order], { testRefs: { [order.id]: [] } });
    expect(symbols[0]!.testCount).toBe(0);
  });
});

describe('buildCallGraph の並び', () => {
  it('変更シンボルの並びは動かさず、未変更シンボルを id の昇順で末尾に足す', () => {
    const test = hunk(ORDER_TEST, 'com.example.order.domain.OrderTest.`applies the policy rate to subtotal`', { kind: 'test' });
    const controller = hunk(CONTROLLER, 'com.example.order.api.OrderController.apply');
    const { symbols } = build([controller, test], {
      calls: [
        { from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: item(POLICY, 'com.example.order.domain', 'DiscountPolicy.rateFor(String)'), kind: 'call' },
        { from: item(ORDER_TEST, 'com.example.order.domain', 'OrderTest.`applies the policy rate to subtotal`()'), to: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), kind: 'test' },
      ],
    });
    expect(symbols.slice(0, 2).map((s) => s.id)).toEqual([controller.id, test.id]);
    const added = symbols.slice(2);
    expect(added.every((s) => !s.changed)).toBe(true);
    expect(added.map((s) => s.id)).toEqual([...added.map((s) => s.id)].sort());
  });

  it('答えが空なら symbols はそのまま、edges は空', () => {
    const controller = hunk(CONTROLLER, 'com.example.order.api.OrderController.apply');
    const { edges, symbols, unmeasured } = build([controller], {});
    expect(edges).toEqual([]);
    expect(symbols).toEqual(buildSymbols([controller], LAYERS));
    expect(unmeasured).toBe(0);
  });
});

describe('buildCallGraph の参照辺（references。設計書 9.2）', () => {
  const orderClass = hunk(ORDER, 'com.example.order.domain.Order', { symbolKind: 'class' });
  const discount = hunk(ORDER, 'com.example.order.domain.Order.discount', { symbolKind: 'property' });
  const total = hunk(ORDER, 'com.example.order.domain.Order.total');
  const apply = hunk(CONTROLLER, 'com.example.order.api.OrderController.apply');
  const orderRanges = [
    { name: 'Order', kind: 5, start: 2, end: 20 },
    { name: 'Order.discount', kind: 13, start: 5, end: 5 },
    { name: 'Order.total', kind: 6, start: 12, end: 15 },
  ];
  const controllerRanges = [
    { name: 'OrderController', kind: 5, start: 1, end: 30 },
    { name: 'OrderController.apply', kind: 6, start: 10, end: 20 },
    { name: 'OrderController.list', kind: 6, start: 22, end: 28 },
  ];

  it('参照の位置を囲っている変更シンボルから、参照された変更シンボルへ reference の辺を作る。n は参照した箇所の数', () => {
    const { edges } = build([discount, apply], {
      refs: { [discount.id]: [{ path: CONTROLLER, line: 12 }, { path: CONTROLLER, line: 15 }] },
      ranges: { [CONTROLLER]: controllerRanges },
    });
    expect(edges).toEqual([{ from: apply.id, to: discount.id, kind: 'reference', n: 2, crossesLayers: false, provenance: 'lsp' }]);
  });

  it('囲っている宣言が変更シンボルでなければ捨てる（未変更シンボルを新しく作らない）', () => {
    const { edges, symbols } = build([discount, apply], {
      refs: { [discount.id]: [{ path: CONTROLLER, line: 25 }] },
      ranges: { [CONTROLLER]: controllerRanges },
    });
    expect(edges).toEqual([]);
    expect(symbols.filter((s) => !s.changed)).toHaveLength(0);
  });

  it('いちばん内側の変更シンボルに丸める。同じシンボルの中からの参照（自己参照）は捨てる', () => {
    const { edges } = build([orderClass, discount, total, apply], {
      // total() の中で discount を読む → Order.total → Order.discount。Order（クラス丸ごと）には丸めない
      // discount 自身の行の参照は自己参照として捨てる
      refs: { [discount.id]: [{ path: ORDER, line: 13 }, { path: ORDER, line: 5 }] },
      ranges: { [ORDER]: orderRanges },
    });
    expect(edges).toEqual([{ from: total.id, to: discount.id, kind: 'reference', n: 1, crossesLayers: false, provenance: 'lsp' }]);
  });

  it('参照の位置の宣言が変更シンボルの外側のクラスだけなら、そのクラスに丸める', () => {
    const { edges } = build([orderClass, discount], {
      refs: { [discount.id]: [{ path: ORDER, line: 18 }] },
      ranges: { [ORDER]: orderRanges },
    });
    expect(edges).toEqual([{ from: orderClass.id, to: discount.id, kind: 'reference', n: 1, crossesLayers: false, provenance: 'lsp' }]);
  });

  it('層越えは呼び出し辺と同じ規則で判定する', () => {
    const domainToApi = hunk(POLICY, 'com.example.order.domain.DiscountPolicy.rateFor');
    const { edges } = build([domainToApi, apply], {
      refs: { [apply.id]: [{ path: POLICY, line: 3 }] },
      ranges: { [POLICY]: [{ name: 'DiscountPolicy.rateFor', kind: 6, start: 1, end: 5 }] },
    });
    expect(edges[0]).toMatchObject({ from: domainToApi.id, to: apply.id, kind: 'reference', crossesLayers: true });
  });

  it('同じ 2 点に呼び出し辺と参照辺の両方があっても、別の辺として残す（並びは from, to, kind）', () => {
    const { edges } = build([total, apply], {
      calls: [{ from: item(CONTROLLER, 'com.example.order.api', 'OrderController.apply(String)'), to: item(ORDER, 'com.example.order.domain', 'Order.total()'), kind: 'call' }],
      refs: { [total.id]: [{ path: CONTROLLER, line: 12 }] },
      ranges: { [CONTROLLER]: controllerRanges },
    });
    expect(edges.map((e) => e.kind)).toEqual(['call', 'reference']);
  });
});

describe('buildCallGraph の未変更シンボルの行（設計書 3.3）', () => {
  const LOGGER = 'src/main/kotlin/com/example/common/Logger.kt';
  // 呼んでいる位置（0 始まりの 8 と 21）が足した行（1 始まりの 9 と 22）になる hunk。変わらない行からの呼び出しは辺にしないので
  const apply = hunk(ORDER, 'com.example.order.domain.Order.applyDiscount', { lnNew: 9, lines: ['+        val rate = DiscountPolicy.rateFor(cmd.code)'] });
  const format = hunk(LOGGER, 'com.example.common.Logger.format', { lnNew: 22, lines: ['+        val at = now()'] });
  const at = (path: string, detail: string, name: string, line: number): CallItem => ({ ...item(path, detail, name), line });
  const files: Record<string, string> = {
    [POLICY]: ['package com.example.order.domain', '', 'object DiscountPolicy {', '    private val TABLE: Map<String, Rate> = mapOf(', '        "SPRING10" to Rate(10),', '        "WELCOME5" to Rate(5),', '    )', '', '    fun rateFor(code: String): Rate =', '        TABLE[code] ?: Rate.ZERO', '}', ''].join('\n'),
    [LOGGER]: Array.from({ length: 30 }, (_, i) => `L${i + 1}`).join('\n'),
  };
  const read = (p: string): string | undefined => files[p];
  const unchanged = (r: ReturnType<typeof build>) => r.symbols.filter((s) => !s.changed);

  it('呼ばれる側は宣言の行の前後 2 行（呼ぶ側のファイルの呼び出し行は使わない）', () => {
    const r = build(
      [apply],
      { calls: [{ from: at(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)', 6), to: at(POLICY, 'com.example.order.domain', 'DiscountPolicy.rateFor(String)', 8), kind: 'call', lines: [8] }] },
      read,
    );
    expect(unchanged(r)[0]!.excerpt).toEqual([{ start: 7, lines: ['    )', '', '    fun rateFor(code: String): Rate =', '        TABLE[code] ?: Rate.ZERO', '}'], centers: [9] }]);
  });

  it('呼ぶ側は宣言の行と、変更シンボルを呼んでいる行。離れていれば塊を分ける', () => {
    const r = build(
      [format],
      { calls: [{ from: at(LOGGER, 'com.example.common', 'Logger.log(Logger.Level, String)', 2), to: at(LOGGER, 'com.example.common', 'Logger.format(Logger.Level, String)', 20), kind: 'call', lines: [3, 12] }] },
      read,
    );
    expect(unchanged(r)[0]!.excerpt).toEqual([
      { start: 1, lines: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'], centers: [3, 4] },
      { start: 11, lines: ['L11', 'L12', 'L13', 'L14', 'L15'], centers: [13] },
    ]);
  });

  it('呼ばれる側の辺の lines（相手のファイルの位置）は中心に入れない', () => {
    const r = build(
      [format],
      { calls: [{ from: at(LOGGER, 'com.example.common', 'Logger.format(Logger.Level, String)', 20), to: at(LOGGER, 'com.example.common', 'Logger.now()', 25), kind: 'call', lines: [21] }] },
      read,
    );
    expect(unchanged(r)[0]!.excerpt!.flatMap((b) => b.centers)).toEqual([26]);
  });

  it('位置の無い記録・ファイルが読めない・readHead が無いときは excerpt を付けない（欄なし = 位置が取れなかった）', () => {
    const noLine = build([apply], { calls: [{ from: item(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)'), to: item(POLICY, 'com.example.order.domain', 'DiscountPolicy.rateFor(String)'), kind: 'call' }] }, read);
    expect(unchanged(noLine)[0]).not.toHaveProperty('excerpt');
    const calls = [{ from: at(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)', 6), to: at(POLICY, 'com.example.order.domain', 'DiscountPolicy.rateFor(String)', 8), kind: 'call' as const }];
    expect(unchanged(build([apply], { calls }, () => undefined))[0]).not.toHaveProperty('excerpt');
    expect(unchanged(build([apply], { calls }))[0]).not.toHaveProperty('excerpt');
  });

  it('変更シンボルには excerpt を付けない（差分がある）', () => {
    const r = build(
      [apply],
      { calls: [{ from: at(ORDER, 'com.example.order.domain', 'Order.applyDiscount(DiscountCommand)', 6), to: at(POLICY, 'com.example.order.domain', 'DiscountPolicy.rateFor(String)', 8), kind: 'call', lines: [8] }] },
      () => 'x\n'.repeat(20),
    );
    expect(r.symbols.filter((s) => s.changed).every((s) => s.excerpt === undefined)).toBe(true);
  });
});
