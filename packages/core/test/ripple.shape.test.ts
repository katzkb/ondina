// 「形」= 旧・新の単語列の差分（消えた単語と足された単語）と、形どうしの距離（設計書 8 章 3〜6）。
import { describe, expect, it } from 'vitest';
import { NEAR_THRESHOLD, shapeDistance, shapeOf } from '../src/ripple/shape.js';

describe('shapeOf', () => {
  it('消えた単語に -、足された単語に + を付けて並べる', () => {
    expect(shapeOf(['return', '$1', '.', 'getDiscount', '(', ')'], ['return', '$1', '.', 'discount'])).toEqual(['-getDiscount', '-(', '-)', '+discount']);
  });

  it('前後に何が付いていても、置き換えが同じなら同じ形（CartSummary と OrderAdminView）', () => {
    const cart = shapeOf(
      ['return', '$1', '.', 'sumOf', '{', 'it', '.', '$2', '}', '-', '$3', '.', 'getDiscount', '(', ')'],
      ['return', '$1', '.', 'sumOf', '{', 'it', '.', '$2', '}', '-', '$3', '.', 'discount'],
    );
    const admin = shapeOf(['return', '$1', '.', 'getDiscount', '(', ')'], ['return', '$1', '.', 'discount']);
    expect(cart).toEqual(admin);
  });

  it('変化が無ければ空', () => {
    expect(shapeOf(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});

describe('shapeDistance', () => {
  const rep = ['-getDiscount', '-(', '-)', '+discount'];

  it('同じ形は 0', () => {
    expect(shapeDistance(rep, rep)).toBe(0);
  });

  it('order.discount!! は代表と 1 語差で、閾値以下', () => {
    const d = shapeDistance(rep, ['-getDiscount', '-(', '-)', '+discount', '+!!']);
    expect(d).toBe(1);
    expect(d <= NEAR_THRESHOLD).toBe(true);
  });

  it('(order.discount) は 2 語差で、閾値以下', () => {
    expect(shapeDistance(rep, ['+(', '-getDiscount', '-(', '-)', '+discount', '+)'])).toBe(2);
  });

  it('PromoService（takeIf … ?: legacyPromo(order)）は 14 語差で、閾値を超える', () => {
    const promo = [...rep, '+.', '+takeIf', '+{', '+it', '+>', '+$2', '+.', '+ZERO', '+}', '+?:', '+legacyPromo', '+(', '+$1', '+)'];
    expect(shapeDistance(rep, promo)).toBe(14);
    expect(NEAR_THRESHOLD).toBe(2);
  });
});
