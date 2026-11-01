// 並びを保ったまま空白を詰める（見本 map.html の packer / offAt）。
import { describe, expect, it } from 'vitest';
import { offAt, packer } from '../src/map/pack.js';

describe('packer', () => {
  it('重なる・接する区間はまとめ、まとまりを start から gap 空けて並べ直す', () => {
    const { merged, end } = packer(
      [
        { a: 300, b: 400 },
        { a: 10, b: 50 },
        { a: 40, b: 80 },
      ],
      24,
      48,
    );
    expect(merged).toEqual([
      { a: 10, b: 80, off: 14 },
      { a: 300, b: 400, off: -158 },
    ]);
    expect(end).toBe(242);
  });

  it('並びの順番は変えない（左にあった物は左のまま）', () => {
    const { merged } = packer(
      [
        { a: 500, b: 600 },
        { a: 100, b: 200 },
      ],
      0,
      10,
    );
    const moved = merged.map((m) => m.a + m.off);
    expect(moved[0]).toBeLessThan(moved[1]!);
  });

  it('空なら end は start - gap', () => {
    expect(packer([], 24, 48)).toEqual({ merged: [], end: -24 });
  });
});

describe('offAt', () => {
  const { merged } = packer(
    [
      { a: 10, b: 80 },
      { a: 300, b: 400 },
    ],
    24,
    48,
  );

  it('区間の中の点はその区間のずらし量', () => {
    expect(offAt(merged, 50)).toBe(14);
    expect(offAt(merged, 350)).toBe(-158);
  });

  it('区間の外の点（辺の曲がり点）はいちばん近い区間のずらし量', () => {
    expect(offAt(merged, 90)).toBe(14);
    expect(offAt(merged, 290)).toBe(-158);
  });

  it('区間が無ければ 0', () => {
    expect(offAt([], 5)).toBe(0);
  });
});
