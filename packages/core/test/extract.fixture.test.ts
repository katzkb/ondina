// fixtures/order-service の差分に対する意味的 hunk の期待値。設計書 5.2 手順1・2。
import { describe, expect, it } from 'vitest';
import { extractAllHunks, extractHunks, type SemanticHunk } from '../src/hunks/extract.js';
import { changedFixtureFiles, fixtureFile } from './fixture.js';

const MAIN = 'src/main/kotlin/com/example';
const TEST = 'src/test/kotlin/com/example';

async function hunksOf(relPath: string): Promise<SemanticHunk[]> {
  return extractHunks(fixtureFile(relPath));
}

function brief(h: SemanticHunk) {
  return { symbol: h.symbol, symbolFqName: h.symbolFqName, symbolKind: h.symbolKind, lnOld: h.lnOld, lnNew: h.lnNew };
}

describe('Order.kt（核: 削除と追加が別宣言にまたがるので class Order 全体が1 hunk）', () => {
  it('prototype の h1 と同じ統合 diff になる', async () => {
    const hunks = await hunksOf(`${MAIN}/order/domain/Order.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: 'Order', symbolFqName: 'com.example.order.domain.Order', symbolKind: 'class', lnOld: 3, lnNew: 3 },
    ]);
    expect(hunks[0]?.lines).toEqual([
      ' class Order(',
      '     val id: OrderId,',
      '     val subtotal: Money,',
      '-    val promo: Promo? = null,',
      '+    var discount: Money = Money.ZERO,',
      ' ) {',
      '-    fun getDiscount(): Money = promo?.amount ?: Money.ZERO',
      '+    fun applyDiscount(cmd: DiscountCommand) {',
      '+        val rate = DiscountPolicy.rateFor(cmd.code)',
      '+        discount = subtotal * rate',
      '+    }',
      ' ',
      '-    fun total(): Money = subtotal',
      '+    fun total(): Money = subtotal - discount',
      ' }',
    ]);
    expect(hunks[0]?.lang).toBe('kotlin');
    expect(hunks[0]?.path).toBe(`${MAIN}/order/domain/Order.kt`);
  });
});

describe('OrderRepositoryImpl.kt（核: save と find が別 hunk）', () => {
  it('save() と find() の2 hunk になり、find の2箇所の変更は1 hunk にまとまる', async () => {
    const hunks = await hunksOf(`${MAIN}/order/infra/OrderRepositoryImpl.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: 'save()', symbolFqName: 'com.example.order.infra.OrderRepositoryImpl.save', symbolKind: 'function', lnOld: 14, lnNew: 14 },
      { symbol: 'find()', symbolFqName: 'com.example.order.infra.OrderRepositoryImpl.find', symbolKind: 'function', lnOld: 21, lnNew: 25 },
    ]);
    expect(hunks[0]?.lines).toEqual([
      '     override fun save(order: Order) {',
      '         jdbc.update(',
      '-            "update orders set subtotal = :subtotal where id = :id",',
      '-            mapOf("id" to order.id.value, "subtotal" to order.subtotal.amount),',
      '+            "update orders set subtotal = :subtotal, discount = :discount where id = :id",',
      '+            mapOf(',
      '+                "id" to order.id.value,',
      '+                "subtotal" to order.subtotal.amount,',
      '+                "discount" to order.discount.amount,',
      '+            ),',
      '         )',
      '     }',
    ]);
    const find = hunks[1]?.lines ?? [];
    expect(find.filter((l) => l.startsWith('-'))).toEqual(['-            "select id, subtotal from orders where id = :id",']);
    expect(find.filter((l) => l.startsWith('+'))).toEqual([
      '+            "select id, subtotal, discount from orders where id = :id",',
      '+                discount = Money(rs.getLong("discount")),',
    ]);
  });
});

describe('DiscountCommand.kt（新規ファイル）', () => {
  it('package 行はファイル hunk、宣言は宣言 hunk になる。空行は hunk を作らない', async () => {
    const hunks = await hunksOf(`${MAIN}/order/domain/DiscountCommand.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: 'DiscountCommand.kt', symbolFqName: `${MAIN}/order/domain/DiscountCommand.kt`, symbolKind: 'file', lnOld: 1, lnNew: 1 },
      { symbol: 'DiscountCommand', symbolFqName: 'com.example.order.domain.DiscountCommand', symbolKind: 'class', lnOld: 1, lnNew: 3 },
    ]);
    expect(hunks[0]?.lines).toEqual(['+package com.example.order.domain']);
    expect(hunks[1]?.lines).toEqual(['+data class DiscountCommand(val code: String)']);
  });
});

describe('ApplyDiscountUseCase.kt（核: import 追加とシグネチャ変更）', () => {
  it('import はファイル hunk、execute() は prototype の h8 と同じ diff になる', async () => {
    const hunks = await hunksOf(`${MAIN}/order/application/ApplyDiscountUseCase.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: 'ApplyDiscountUseCase.kt', symbolFqName: `${MAIN}/order/application/ApplyDiscountUseCase.kt`, symbolKind: 'file', lnOld: 3, lnNew: 3 },
      { symbol: 'execute()', symbolFqName: 'com.example.order.application.ApplyDiscountUseCase.execute', symbolKind: 'function', lnOld: 14, lnNew: 15 },
    ]);
    expect(hunks[0]?.lines).toEqual(['+import com.example.order.domain.DiscountCommand']);
    expect(hunks[1]?.lines).toEqual([
      '-    fun execute(id: OrderId): Order {',
      '+    fun execute(id: OrderId, code: String): Order {',
      '         val order = repository.find(id) ?: throw OrderNotFound(id)',
      '+        order.applyDiscount(DiscountCommand(code))',
      '+        repository.save(order)',
      '         return order',
      '     }',
    ]);
  });
});

describe('OrderController.kt（核: アノテーション付きの関数）', () => {
  it('@PostMapping を apply() の範囲に含め、prototype の h6 と同じ diff になる', async () => {
    const hunks = await hunksOf(`${MAIN}/order/api/OrderController.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: 'OrderController.kt', symbolFqName: `${MAIN}/order/api/OrderController.kt`, symbolKind: 'file', lnOld: 8, lnNew: 8 },
      { symbol: 'apply()', symbolFqName: 'com.example.order.api.OrderController.apply', symbolKind: 'function', lnOld: 15, lnNew: 16 },
    ]);
    expect(hunks[1]?.lines).toEqual([
      '     @PostMapping("/orders/{id}/discount")',
      '-    fun apply(@PathVariable id: String): OrderResponse {',
      '-        val order = useCase.execute(OrderId(id))',
      '+    fun apply(@PathVariable id: String, @RequestBody body: ApplyDiscountRequest): OrderResponse {',
      '+        val order = useCase.execute(OrderId(id), body.discountCode)',
      '+        repository.save(order)',
      '         return OrderResponse.from(order)',
      '     }',
    ]);
  });
});

describe('OrderResponse.kt（追従: コンストラクタと companion の変更は class に統合）', () => {
  it('OrderResponse 全体が1 hunk になる', async () => {
    const hunks = await hunksOf(`${MAIN}/order/api/OrderResponse.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: 'OrderResponse', symbolFqName: 'com.example.order.api.OrderResponse', symbolKind: 'class', lnOld: 5, lnNew: 5 },
    ]);
    expect(hunks[0]?.lines).toEqual([
      ' data class OrderResponse(',
      '     val id: String,',
      '     val subtotal: Long,',
      '+    val discount: Long,',
      ' ) {',
      '     companion object {',
      '         fun from(o: Order) = OrderResponse(',
      '             id = o.id.value,',
      '             subtotal = o.subtotal.amount,',
      '+            discount = o.discount.amount,',
      '         )',
      '     }',
      ' }',
    ]);
  });
});

describe('追従（getDiscount() → discount）', () => {
  it('代表 CartSummary.total() は変更された関数だけが hunk になる', async () => {
    const hunks = await hunksOf(`${MAIN}/cart/CartSummary.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: 'total()', symbolFqName: 'com.example.cart.CartSummary.total', symbolKind: 'function', lnOld: 12, lnNew: 12 },
    ]);
    expect(hunks[0]?.lines).toEqual([
      '     fun total(): Money {',
      '-        return items.sumOf { it.price } - order.getDiscount()',
      '+        return items.sumOf { it.price } - order.discount',
      '     }',
    ]);
  });

  it('逸脱 PromoService.apply() も同じ形の hunk になる（逸脱の判定は M1）', async () => {
    const hunks = await hunksOf(`${MAIN}/promo/PromoService.kt`);
    expect(hunks.map((h) => h.symbolFqName)).toEqual(['com.example.promo.PromoService.apply']);
  });

  it('1ファイルに2箇所ある InvoiceBuilder は2 hunk になる', async () => {
    const hunks = await hunksOf(`${MAIN}/invoice/InvoiceBuilder.kt`);
    expect(hunks.map((h) => h.symbolFqName)).toEqual([
      'com.example.invoice.InvoiceBuilder.discountLine',
      'com.example.invoice.InvoiceBuilder.grandTotal',
    ]);
  });
});

describe('テスト', () => {
  it('OrderTest.kt は追加された2つのテスト関数がそれぞれ hunk になり、間の空行は hunk を作らない', async () => {
    const hunks = await hunksOf(`${TEST}/order/domain/OrderTest.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: '`applies the policy rate to subtotal`()', symbolFqName: 'com.example.order.domain.OrderTest.`applies the policy rate to subtotal`', symbolKind: 'function', lnOld: 12, lnNew: 13 },
      { symbol: '`keeps total when code is unknown`()', symbolFqName: 'com.example.order.domain.OrderTest.`keeps total when code is unknown`', symbolKind: 'function', lnOld: 12, lnNew: 20 },
    ]);
    expect(hunks[0]?.lines).toEqual([
      '+    @Test',
      '+    fun `applies the policy rate to subtotal`() {',
      '+        val order = Order(id = OrderId("o-1"), subtotal = Money(1000))',
      '+        order.applyDiscount(DiscountCommand("SPRING10"))',
      '+        assertEquals(Money(900), order.total())',
      '+    }',
    ]);
  });
});

describe('未帰属', () => {
  it('Logger.kt は import のファイル hunk と format() の hunk', async () => {
    const hunks = await hunksOf(`${MAIN}/common/Logger.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: 'Logger.kt', symbolFqName: `${MAIN}/common/Logger.kt`, symbolKind: 'file', lnOld: 3, lnNew: 3 },
      { symbol: 'format()', symbolFqName: 'com.example.common.Logger.format', symbolKind: 'function', lnOld: 6, lnNew: 8 },
    ]);
    expect(hunks[0]?.lines).toEqual(['+import java.time.Instant']);
    expect(hunks[1]?.lines).toEqual([
      '-    fun format(level: Level, msg: String) = "[$level] $msg"',
      '+    fun format(level: Level, msg: String) = "[$level] ${Instant.now()} $msg"',
    ]);
  });

  it('FeatureFlags.kt は追加されたプロパティが最小の宣言なので property hunk になる', async () => {
    const hunks = await hunksOf(`${MAIN}/config/FeatureFlags.kt`);
    expect(hunks.map(brief)).toEqual([
      { symbol: 'DISCOUNT_V2', symbolFqName: 'com.example.config.FeatureFlags.DISCOUNT_V2', symbolKind: 'property', lnOld: 5, lnNew: 5 },
    ]);
    expect(hunks[0]?.lines).toEqual(['+    const val DISCOUNT_V2 = true']);
  });
});

describe('非 Kotlin ファイル', () => {
  it('SQL はファイル単位で1 hunk', async () => {
    const hunks = await hunksOf('src/main/resources/db/migration/V421__discount.sql');
    expect(hunks.map(brief)).toEqual([
      { symbol: 'V421__discount.sql', symbolFqName: 'src/main/resources/db/migration/V421__discount.sql', symbolKind: 'file', lnOld: 1, lnNew: 1 },
    ]);
    expect(hunks[0]?.lang).toBe('sql');
    expect(hunks[0]?.lines).toEqual(['+ALTER TABLE orders', '+  ADD COLUMN discount BIGINT NOT NULL DEFAULT 0;']);
  });
});

describe('importsOnly（fixture）', () => {
  it('package / import の行だけが変わったファイル hunk に立つ。SQL と宣言の hunk には立たない', async () => {
    const hunks = await extractAllHunks(changedFixtureFiles());
    const flagged = hunks.filter((h) => h.importsOnly === true);
    expect(flagged.map((h) => [h.path.split('/').pop(), h.symbolKind, h.lines])).toEqual(
      expect.arrayContaining([
        ['OrderController.kt', 'file', expect.any(Array)],
        ['ApplyDiscountUseCase.kt', 'file', ['+import com.example.order.domain.DiscountCommand']],
        ['Logger.kt', 'file', ['+import java.time.Instant']],
        ['ApplyDiscountRequest.kt', 'file', ['+package com.example.order.api']],
        ['DiscountCommand.kt', 'file', ['+package com.example.order.domain']],
      ]),
    );
    expect(flagged).toHaveLength(5);
    expect(flagged.every((h) => h.symbolKind === 'file' && h.lang === 'kotlin')).toBe(true);
    expect(hunks.filter((h) => h.path.endsWith('.sql')).some((h) => 'importsOnly' in h)).toBe(false);
  });
});

describe('fixture 全体', () => {
  it('変更ファイルは 37（追従 22 + 核 6 + 追従 DTO 3 + テスト 3 + 未帰属 2 + 新規 1）', () => {
    expect(changedFixtureFiles()).toHaveLength(37);
  });

  it('全 hunk の id は一意で、同じ入力から同じ結果になる', async () => {
    const files = changedFixtureFiles();
    const a = await extractAllHunks(files);
    const b = await extractAllHunks(files);
    expect(new Set(a.map((h) => h.id)).size).toBe(a.length);
    expect(b).toEqual(a);
  });

  it('ゴールデン fixtures/order-service/expected/hunks.json と一致する', async () => {
    const hunks = await extractAllHunks(changedFixtureFiles());
    await expect(JSON.stringify(hunks, null, 2) + '\n').toMatchFileSnapshot('../../../fixtures/order-service/expected/hunks.json');
  });
});
