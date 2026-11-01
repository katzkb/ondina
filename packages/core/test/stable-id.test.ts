import { describe, expect, it } from 'vitest';
import { hunkId } from '../src/hunks/stable-id.js';

describe('hunkId', () => {
  it('sha1(path + "#" + fqName) の 40 桁 hex を返し、同じ入力には同じ値を返す', () => {
    const id = hunkId('src/main/kotlin/com/example/order/domain/Order.kt', 'com.example.order.domain.Order');
    expect(id).toMatch(/^[0-9a-f]{40}$/);
    expect(hunkId('src/main/kotlin/com/example/order/domain/Order.kt', 'com.example.order.domain.Order')).toBe(id);
  });

  it('path か fqName が違えば別の id になる', () => {
    const a = hunkId('a.kt', 'p.A');
    expect(hunkId('b.kt', 'p.A')).not.toBe(a);
    expect(hunkId('a.kt', 'p.B')).not.toBe(a);
  });
});
