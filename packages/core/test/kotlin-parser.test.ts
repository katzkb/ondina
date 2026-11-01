import { describe, expect, it } from 'vitest';
import { parseKotlin } from '../src/hunks/kotlin-parser.js';

describe('parseKotlin', () => {
  it('同梱 wasm で Kotlin をパースして source_file を返す', async () => {
    const tree = await parseKotlin('package com.example\n\nclass Order\n');
    expect(tree.rootNode.type).toBe('source_file');
    expect(tree.rootNode.hasError).toBe(false);
  });

  it('サンプルPRに出てくる構文をエラーなしでパースする', async () => {
    const src = [
      'package com.example.order.domain',
      '',
      'class Order(',
      '    val id: OrderId,',
      '    var discount: Money = Money.ZERO,',
      ') {',
      '    fun applyDiscount(cmd: DiscountCommand) {',
      '        val rate = DiscountPolicy.rateFor(cmd.code)',
      '        discount = subtotal * rate',
      '    }',
      '',
      '    @Test',
      '    fun `keeps total when code is unknown`() {',
      '        val d = order.discount.takeIf { it > Money.ZERO } ?: legacyPromo(order)',
      '        verify(exactly = 1) { repository.save(any()) }',
      '        return "[$level] ${Instant.now()} $msg"',
      '    }',
      '}',
      '',
    ].join('\n');
    const tree = await parseKotlin(src);
    expect(tree.rootNode.hasError).toBe(false);
  });
});
