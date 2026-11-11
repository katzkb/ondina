// 要求ごとの地図の導出: fixture の流れ（flows.json）と章（chapters.json）から、濃い箱・濃い線・地図の外・出さない理由
import { describe, expect, it } from 'vitest';
import { boxChapters, chapterMap, fitScale, startMap } from '../src/requirementMap.js';
import { requirementAnalysis } from './requirementFixture.js';

const a = requirementAnalysis();
const short = (id: string) => id.split('.').pop();
const map = (i: number) => {
  const m = chapterMap(a, i, null);
  if (m.kind !== 'map') throw new Error(m.reason);
  return m;
};

describe('fitScale', () => {
  it('幅・高さの小さいほうに合わせて縮め、拡大はしない', () => {
    expect(fitScale(600, 880, 300, 440)).toBe(0.5);
    expect(fitScale(600, 880, 900, 440)).toBe(0.5);
    expect(fitScale(600, 400, 300, 440)).toBe(0.5);
    expect(fitScale(200, 100, 300, 440)).toBe(1);
    expect(fitScale(600, 880, 0, 440)).toBe(0.5);
  });
});

describe('chapterMap', () => {
  it('地図の外にファイル名（.kt）は出ない: ファイル全体の差分は同じファイルのほかの差分で代表される', () => {
    expect(map(0).outside.filter((n) => n.endsWith('.kt'))).toEqual([]);
    expect(new Set(map(0).outside).size).toBe(map(0).outside.length);
  });

  it('濃い箱は、箱のシンボルの hunk が章の hunk に入る箱', () => {
    expect([...map(0).boxes!.keys()].map(short)).toEqual(['OrderController', 'ApplyDiscountUseCase', 'Order']);
    expect([...map(1).boxes!.keys()].map(short)).toEqual(['Order']);
    expect([...map(3).boxes!.keys()].map(short)).toEqual(['OrderController', 'ApplyDiscountUseCase', 'OrderRepositoryImpl', 'OrderResponse']);
  });

  it('濃い箱を押すと開く hunk は、その章の hunk', () => {
    for (const i of [0, 1, 3, 5]) {
      for (const hunkId of map(i).boxes!.values()) expect(a.chapters![i]!.hunkIds).toContain(hunkId);
    }
  });

  it('呼ばれる側の箱が濃い線は濃い（Order への線）', () => {
    expect(map(1).calls!.size).toBe(2);
    expect(map(5).calls!.size).toBe(2);
    // 濃い線は、どれも濃い箱を呼ぶか、章の hunk の行から呼ぶ
    expect(map(0).calls!.size).toBe(8);
  });

  it('地図の外は、章の差分のうち流れの上に無いものの名前', () => {
    expect(map(1).outside).toEqual(['`applies the policy rate to subtotal`()']);
    expect(map(0).outside).toContain('ApplyDiscountRequest');
    expect(map(0).outside).not.toContain('Order');
  });

  it('差分が見つからない要求は、そう理由を出す', () => {
    expect(chapterMap(a, 4, null)).toEqual({ kind: 'none', reason: '地図は出していません。差分が見つからない要求です。' });
  });

  it('流れの上に差分が無い章は、その理由を出す', () => {
    expect(chapterMap(a, 6, null)).toEqual({ kind: 'none', reason: '地図は出していません。この章の差分は、処理の流れの上にありません。' });
    expect(chapterMap(a, 7, null)).toMatchObject({ kind: 'none' });
  });

  it('流れが 1 本も無い解析は、そう理由を出す', () => {
    const b = { ...requirementAnalysis(), flows: [] };
    expect(chapterMap(b, 0, null)).toEqual({ kind: 'none', reason: '地図は出していません。この解析には処理の流れがありません。' });
    expect(startMap(b, null)).toMatchObject({ kind: 'none' });
  });

  it('同じ解析と章なら同じ結果（原則 7）', () => {
    expect([...map(3).boxes!]).toEqual([...map(3).boxes!]);
    expect([...map(3).calls!]).toEqual([...map(3).calls!]);
  });
});

describe('startMap', () => {
  it('全部を ② の色で（濃い薄いを分けない）。箱ごとに差分がある章を並べる', () => {
    const s = startMap(a, null);
    if (s.kind !== 'map') throw new Error(s.reason);
    expect(s.calls).toBeNull();
    expect(s.boxes).toBeNull();
    const chips = boxChapters(a, s.facts);
    expect(chips.get([...chips.keys()].find((k) => k.endsWith('.Order'))!)).toEqual([0, 1, 2, 5]);
    expect(chips.get([...chips.keys()].find((k) => k.endsWith('.OrderRepositoryImpl'))!)).toEqual([3]);
  });
});
