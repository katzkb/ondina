import { describe, expect, it } from 'vitest';
import { changeBlocks, splitLines, unifiedLines } from '../src/hunks/line-diff.js';

describe('splitLines', () => {
  it('末尾の改行で空行を作らない', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
  });
});

describe('changeBlocks', () => {
  it('置換は旧範囲と新範囲の両方を持つ（1始まり・両端含む）', () => {
    expect(changeBlocks(['a', 'b', 'c'], ['a', 'B', 'c'])).toEqual([{ oldStart: 2, oldEnd: 2, newStart: 2, newEnd: 2 }]);
  });

  it('追加は旧側が空範囲（oldEnd = oldStart - 1）で挿入位置を指す', () => {
    expect(changeBlocks(['a', 'c'], ['a', 'b', 'c'])).toEqual([{ oldStart: 2, oldEnd: 1, newStart: 2, newEnd: 2 }]);
  });

  it('削除は新側が空範囲', () => {
    expect(changeBlocks(['a', 'b', 'c'], ['a', 'c'])).toEqual([{ oldStart: 2, oldEnd: 2, newStart: 2, newEnd: 1 }]);
  });

  it('文脈行で区切られた変更は別ブロックになり、隣接する削除と追加は1ブロックになる', () => {
    const blocks = changeBlocks(['1', '2', '3', '4', '5'], ['1', 'x', 'y', '3', '4', 'z']);
    expect(blocks).toEqual([
      { oldStart: 2, oldEnd: 2, newStart: 2, newEnd: 3 },
      { oldStart: 5, oldEnd: 5, newStart: 6, newEnd: 6 },
    ]);
  });

  it('同一なら空', () => {
    expect(changeBlocks(['a'], ['a'])).toEqual([]);
  });
});

describe('unifiedLines', () => {
  it("' ' '-' '+' を先頭に付けた統合形式を返す", () => {
    expect(unifiedLines(['class Order(', '    val promo: Promo?,', ') {'], ['class Order(', '    var discount: Money,', ') {'])).toEqual([
      ' class Order(',
      '-    val promo: Promo?,',
      '+    var discount: Money,',
      ' ) {',
    ]);
  });

  it('片側が空なら全行が追加または削除になる', () => {
    expect(unifiedLines([], ['a', 'b'])).toEqual(['+a', '+b']);
    expect(unifiedLines(['a'], [])).toEqual(['-a']);
  });
});
