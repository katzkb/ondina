// 追従検出の「形」の材料: 変更行の単語列、プレースホルダ、表記ゆれの正規化（設計書 8 章 3）。
import { describe, expect, it } from 'vitest';
import { parseKotlin } from '../src/hunks/kotlin-parser.js';
import { leafTokens, normalizeTokens, placeholders } from '../src/ripple/tokens.js';

async function words(src: string, lines?: number[]): Promise<string[]> {
  const tree = await parseKotlin(src);
  const all = src.split('\n').map((_, i) => i + 1);
  return leafTokens(tree, lines ?? all).map((t) => t.text);
}

describe('leafTokens', () => {
  it('指定した行の葉だけを並べ、空白とコメントは含まない', async () => {
    const src = ['fun f() {', '    val d = order.getDiscount() // 旧', '    return d', '}'].join('\n');
    expect(await words(src, [2])).toEqual(['val', 'd', '=', 'order', '.', 'getDiscount', '(', ')']);
  });

  it('文字列リテラルの中身は識別子にならない', async () => {
    const tree = await parseKotlin('val s = "discount"\n');
    const ids = leafTokens(tree, [1]).filter((t) => t.type === 'identifier').map((t) => t.text);
    expect(ids).toEqual(['s']);
  });
});

describe('placeholders', () => {
  it('R∪A 以外の識別子を旧・新を通した出現順で $n にし、同じ名前は同じ番号', async () => {
    const oldT = leafTokens(await parseKotlin('val d = order.getDiscount()\n'), [1]);
    const newT = leafTokens(await parseKotlin('val d = order.discount\n'), [1]);
    const [o, n] = placeholders(oldT, newT, new Set(['getDiscount', 'discount']));
    expect(o).toEqual(['val', '$1', '=', '$2', '.', 'getDiscount', '(', ')']);
    expect(n).toEqual(['val', '$1', '=', '$2', '.', 'discount']);
  });

  it('it は置き換えない', async () => {
    const t = leafTokens(await parseKotlin('val x = items.sumOf { it.price }\n'), [1]);
    const [o] = placeholders(t, [], new Set());
    expect(o).toEqual(['val', '$1', '=', '$2', '.', '$3', '{', 'it', '.', '$4', '}']);
  });
});

describe('normalizeTokens', () => {
  it('safeCall: ?. を . に読み替える。ルールが無ければそのまま', async () => {
    const t = leafTokens(await parseKotlin('val d = order?.discount\n'), [1]);
    expect(normalizeTokens(t, ['safeCall']).map((x) => x.text)).toEqual(['val', 'd', '=', 'order', '.', 'discount']);
    expect(normalizeTokens(t, []).map((x) => x.text)).toEqual(['val', 'd', '=', 'order', '?.', 'discount']);
  });

  it('trailingComma: 閉じ括弧の直前のカンマを落とす', async () => {
    const t = leafTokens(await parseKotlin('val m = mapOf(\n    "a" to 1,\n)\n'), [1, 2, 3]);
    expect(normalizeTokens(t, ['trailingComma']).map((x) => x.text)).toEqual(['val', 'm', '=', 'mapOf', '(', '"', 'a', '"', 'to', '1', ')']);
    expect(normalizeTokens(t, []).map((x) => x.text)).toContain(',');
  });

  it('lambdaIt: 引数 1 つのラムダは引数名を落として本体を it に読み替える', async () => {
    const t = leafTokens(await parseKotlin('val x = items.map { p -> p.price }\n'), [1]);
    expect(normalizeTokens(t, ['lambdaIt']).map((x) => x.text)).toEqual(['val', 'x', '=', 'items', '.', 'map', '{', 'it', '.', 'price', '}']);
    expect(normalizeTokens(t, []).map((x) => x.text)).toEqual(['val', 'x', '=', 'items', '.', 'map', '{', 'p', '->', 'p', '.', 'price', '}']);
  });

  it('lambdaIt: 引数 2 つのラムダは触らない', async () => {
    const t = leafTokens(await parseKotlin('val x = m.map { k, v -> k }\n'), [1]);
    expect(normalizeTokens(t, ['lambdaIt']).map((x) => x.text)).toEqual(normalizeTokens(t, []).map((x) => x.text));
  });
});
