// 行の中の変わった所（設計書 3.4。2026-10-30）。左右表示と同じ組（続く消した行と足した行の k 番目どうし）の中で、変わった語を [from, to) で返す。
// 期待値は fixtures/order-service の差分の文字から手で数えた。
import { describe, expect, it } from 'vitest';
import { wordDiff, type ChangeSpan } from '../src/diff/wordDiff.js';

/** 塗る所の文字（行の接頭辞を除いた文字の中の位置） */
const texts = (line: string, spans: readonly ChangeSpan[] | undefined) => spans?.map(([from, to]) => line.slice(1).slice(from, to));

describe('wordDiff', () => {
  it('getDiscount() → discount: 両側の変わった語だけ', () => {
    const lines = ['     fun discountField(order: Order): Money {', '-        return order.getDiscount()', '+        return order.discount', '     }'];
    const out = wordDiff(lines);
    expect(out).toEqual([undefined, [[21, 34]], [[21, 29]], undefined]);
    expect(texts(lines[1]!, out[1])).toEqual(['getDiscount()']);
    expect(texts(lines[2]!, out[2])).toEqual(['discount']);
  });

  it('文字列の中に足した所は、足した側だけ。前後の空白は含めない', () => {
    const lines = ['-    fun format(level: Level, msg: String) = "[$level] $msg"', '+    fun format(level: Level, msg: String) = "[$level] ${Instant.now()} $msg"'];
    const out = wordDiff(lines);
    expect(out[0]).toBeUndefined();
    expect(texts(lines[1]!, out[1])).toEqual(['${Instant.now()}']);
  });

  it('引数を足した行: 足した側だけ', () => {
    const lines = ['-    fun execute(id: OrderId): Order {', '+    fun execute(id: OrderId, code: String): Order {'];
    const out = wordDiff(lines);
    expect(out[0]).toBeUndefined();
    expect(texts(lines[1]!, out[1])).toEqual([', code: String']);
  });

  it('ほとんど書き換えた組は塗らない', () => {
    expect(wordDiff(['-    val promo: Promo? = null,', '+    var discount: Money = Money.ZERO,'])).toEqual([undefined, undefined]);
  });

  it('消した 2 行と足した 3 行: 前から順に組にし、組の相手がいない足した行と変わらない行は塗らない', () => {
    const lines = [
      '     @PostMapping("/orders/{id}/discount")',
      '-    fun apply(@PathVariable id: String): OrderResponse {',
      '-        val order = useCase.execute(OrderId(id))',
      '+    fun apply(@PathVariable id: String, @RequestBody body: ApplyDiscountRequest): OrderResponse {',
      '+        val order = useCase.execute(OrderId(id), body.discountCode)',
      '+        repository.save(order)',
      '         return OrderResponse.from(order)',
      '     }',
    ];
    const out = wordDiff(lines);
    expect(out.map((s, i) => texts(lines[i]!, s))).toEqual([undefined, undefined, undefined, [', @RequestBody body: ApplyDiscountRequest'], [', body.discountCode'], undefined, undefined, undefined]);
  });

  it('前に消した行の無い足した行は塗らない', () => {
    expect(wordDiff([' a', '+b', ' c'])).toEqual([undefined, undefined, undefined]);
  });

  it('字下げだけ変えた行は、空白を塗る', () => {
    const lines = ['-  foo(x)', '+    foo(x)'];
    const out = wordDiff(lines);
    expect(out).toEqual([[[0, 2]], [[0, 4]]]);
  });

  it('空白だけを挟んだ変わった語は 1 つにつなぐ', () => {
    const lines = ['-val a = old value here', '+val a = new thing here'];
    expect(texts(lines[0]!, wordDiff(lines)[0])).toEqual(['old value']);
    expect(texts(lines[1]!, wordDiff(lines)[1])).toEqual(['new thing']);
  });
});
