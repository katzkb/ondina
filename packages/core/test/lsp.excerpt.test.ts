// 未変更シンボルの行の切り出し（設計書 3.3）。中心の行（0 始まり）の前後 2 行を、重なり・隣接はつないで返す。
import { describe, expect, it } from 'vitest';
import { cutExcerpt } from '../src/lsp/excerpt.js';

/** "l1\nl2\n…" の n 行のファイル */
const file = (n: number): string => Array.from({ length: n }, (_, i) => `l${i + 1}`).join('\n') + '\n';

describe('cutExcerpt', () => {
  it('中心 1 つなら前後 2 行の 1 塊。行番号は 1 始まり', () => {
    expect(cutExcerpt(file(20), [9])).toEqual([{ start: 8, lines: ['l8', 'l9', 'l10', 'l11', 'l12'], centers: [10] }]);
  });

  it('ファイルの先頭と末尾で切れる（末尾の改行で空行を足さない）', () => {
    expect(cutExcerpt(file(11), [0])).toEqual([{ start: 1, lines: ['l1', 'l2', 'l3'], centers: [1] }]);
    expect(cutExcerpt(file(11), [10])).toEqual([{ start: 9, lines: ['l9', 'l10', 'l11'], centers: [11] }]);
  });

  it('前後が重なる中心はつなぐ', () => {
    expect(cutExcerpt(file(20), [4, 7])).toEqual([{ start: 3, lines: ['l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'], centers: [5, 8] }]);
  });

  it('隙間の無い隣り合わせもつなぐ（⋯ で 0 行を隠さない）', () => {
    expect(cutExcerpt(file(20), [2, 7])).toEqual([{ start: 1, lines: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'], centers: [3, 8] }]);
  });

  it('離れた中心は別の塊。並びと重複は整える', () => {
    expect(cutExcerpt(file(30), [20, 2, 20])).toEqual([
      { start: 1, lines: ['l1', 'l2', 'l3', 'l4', 'l5'], centers: [3] },
      { start: 19, lines: ['l19', 'l20', 'l21', 'l22', 'l23'], centers: [21] },
    ]);
  });

  it('ファイルの外の中心は捨てる。中心が残らなければ空', () => {
    expect(cutExcerpt(file(5), [99, -1])).toEqual([]);
    expect(cutExcerpt(file(5), [])).toEqual([]);
  });

  it('CRLF の行末を本文に残さない', () => {
    expect(cutExcerpt('a\r\nb\r\nc\r\n', [1])).toEqual([{ start: 1, lines: ['a', 'b', 'c'], centers: [2] }]);
  });
});
