import { describe, expect, it } from 'vitest';
import { collectDeclarations, declarationAt, type Declaration } from '../src/hunks/declarations.js';
import { parseKotlin } from '../src/hunks/kotlin-parser.js';

async function decls(src: string) {
  return collectDeclarations(await parseKotlin(src));
}

function flat(ds: Declaration[]): Array<[string, string, number, number]> {
  return ds.flatMap((d) => [[d.kind, d.fqName, d.startLine, d.endLine] as [string, string, number, number], ...flat(d.children)]);
}

describe('collectDeclarations', () => {
  it('package を fqName の接頭辞にする', async () => {
    const t = await decls('package com.example.order\n\nclass Order\n');
    expect(t.packageName).toBe('com.example.order');
    expect(flat(t.declarations)).toEqual([['class', 'com.example.order.Order', 3, 3]]);
  });

  it('package が無ければ宣言名だけを fqName にする', async () => {
    const t = await decls('fun main() {}\n');
    expect(t.packageName).toBe('');
    expect(flat(t.declarations)).toEqual([['function', 'main', 1, 1]]);
  });

  it('クラスのメンバー（fun / property / companion / init / constructor）を入れ子で集める', async () => {
    const src = [
      'package p',
      '',
      'class Order(val id: OrderId) {',
      '    val total: Money',
      '        get() = subtotal',
      '',
      '    init {',
      '        check(id.value.isNotEmpty())',
      '    }',
      '',
      '    constructor(id: String) : this(OrderId(id))',
      '',
      '    fun applyDiscount(cmd: DiscountCommand) {',
      '        discount = subtotal * rate',
      '    }',
      '',
      '    companion object {',
      '        val EMPTY = Order(OrderId(""))',
      '    }',
      '}',
      '',
    ].join('\n');
    expect(flat((await decls(src)).declarations)).toEqual([
      ['class', 'p.Order', 3, 20],
      ['property', 'p.Order.total', 4, 5],
      ['init', 'p.Order.init', 7, 9],
      ['constructor', 'p.Order.constructor', 11, 11],
      ['function', 'p.Order.applyDiscount', 13, 15],
      ['companion', 'p.Order.Companion', 17, 19],
      ['property', 'p.Order.Companion.EMPTY', 18, 18],
    ]);
  });

  it('object / enum entry / typealias / 名前付き companion を集める', async () => {
    const src = [
      'object FeatureFlags {',
      '    const val NEW_CHECKOUT = true',
      '}',
      'enum class Level { INFO, WARN }',
      'typealias Rate = Long',
      'class A {',
      '    companion object Factory',
      '}',
      '',
    ].join('\n');
    expect(flat((await decls(src)).declarations)).toEqual([
      ['object', 'FeatureFlags', 1, 3],
      ['property', 'FeatureFlags.NEW_CHECKOUT', 2, 2],
      ['class', 'Level', 4, 4],
      ['enumEntry', 'Level.INFO', 4, 4],
      ['enumEntry', 'Level.WARN', 4, 4],
      ['typealias', 'Rate', 5, 5],
      ['class', 'A', 6, 8],
      ['companion', 'A.Factory', 7, 7],
    ]);
  });

  it('関数本体の中のローカル宣言には降りない', async () => {
    const src = ['fun outer() {', '    val x = 1', '    fun inner() = 2', '    class Local', '}', ''].join('\n');
    expect(flat((await decls(src)).declarations)).toEqual([['function', 'outer', 1, 5]]);
  });

  it('直前のアノテーションと KDoc を宣言の範囲に含める', async () => {
    const src = [
      'class T {',
      '    /**',
      '     * doc',
      '     */',
      '    @Test',
      '    fun `applies rate`() {',
      '    }',
      '',
      '    // 空行を挟んだコメントは含めない',
      '',
      '    fun other() = 1',
      '}',
      '',
    ].join('\n');
    expect(flat((await decls(src)).declarations)).toEqual([
      ['class', 'T', 1, 12],
      ['function', 'T.`applies rate`', 2, 7],
      ['function', 'T.other', 11, 11],
    ]);
  });

  it('同名のオーバーロードは出現順に #2, #3 で区別する', async () => {
    const src = ['class M {', '    fun of(a: Int) = a', '    fun of(a: String) = a', '    fun of(a: Long) = a', '}', ''].join('\n');
    expect(flat((await decls(src)).declarations).map((d) => d[1])).toEqual(['M', 'M.of', 'M.of#2', 'M.of#3']);
  });
});

describe('declarationAt', () => {
  it('行を含む最も内側の宣言を返し、宣言の外なら undefined', async () => {
    const src = ['package p', '', 'import a.b', '', 'class Order {', '    fun total() = 1', '}', ''].join('\n');
    const t = await decls(src);
    expect(declarationAt(t, 6)?.fqName).toBe('p.Order.total');
    expect(declarationAt(t, 5)?.fqName).toBe('p.Order');
    expect(declarationAt(t, 7)?.fqName).toBe('p.Order');
    expect(declarationAt(t, 3)).toBeUndefined();
    expect(declarationAt(t, 1)).toBeUndefined();
  });
});
