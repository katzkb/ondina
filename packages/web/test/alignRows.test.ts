// prototype.html の alignRows を写したもの。削除の並びと追加の並びを対にし、余った側は null。
import { describe, expect, it } from 'vitest';
import { alignRows } from '../src/diff/alignRows.js';

describe('alignRows', () => {
  it('共通行は両側に同じ index、行番号は旧・新それぞれ進む', () => {
    expect(alignRows([' a', ' b'], 10, 20)).toEqual([
      { o: { i: 0, t: 'c', ln: 10 }, n: { i: 0, t: 'c', ln: 20 } },
      { o: { i: 1, t: 'c', ln: 11 }, n: { i: 1, t: 'c', ln: 21 } },
    ]);
  });

  it('削除 1 行 + 追加 1 行は 1 段に対になる', () => {
    expect(alignRows(['-x', '+y'], 1, 1)).toEqual([{ o: { i: 0, t: 'r', ln: 1 }, n: { i: 1, t: 'a', ln: 1 } }]);
  });

  it('削除 2 行 + 追加 1 行は 2 段目の新側が null', () => {
    expect(alignRows(['-x', '-y', '+z'], 5, 7)).toEqual([
      { o: { i: 0, t: 'r', ln: 5 }, n: { i: 2, t: 'a', ln: 7 } },
      { o: { i: 1, t: 'r', ln: 6 }, n: null },
    ]);
  });

  it('削除を伴わない追加は旧側が null で、旧の行番号は進まない', () => {
    expect(alignRows(['+z', ' k'], 5, 7)).toEqual([
      { o: null, n: { i: 0, t: 'a', ln: 7 } },
      { o: { i: 1, t: 'c', ln: 5 }, n: { i: 1, t: 'c', ln: 8 } },
    ]);
  });

  it('削除の後に共通行が来たら追加の束は空', () => {
    expect(alignRows(['-x', ' k'], 1, 1)).toEqual([
      { o: { i: 0, t: 'r', ln: 1 }, n: null },
      { o: { i: 1, t: 'c', ln: 2 }, n: { i: 1, t: 'c', ln: 1 } },
    ]);
  });
});
