// 完了メーター（設計書 3.7）はプログラムが計算する（原則 3）。
import { describe, expect, it } from 'vitest';
import { meter } from '../src/meter.js';
import { fixtureAnalysis } from './fixture.js';

describe('meter', () => {
  it('fixture（How 7、未帰属 3）: 帰属 45/48、閲覧 0/48、絡み 0、ツアー 0/7、仕様 0/0', () => {
    expect(meter(fixtureAnalysis(), [])).toEqual({
      assigned: { n: 45, total: 48 },
      viewed: { n: 0, total: 48 },
      tangled: 0,
      tours: { n: 0, total: 7 },
      specs: { n: 0, total: 0 },
    });
  });

  it('閲覧は viewed に入っている hunk の n の和', () => {
    const a = fixtureAnalysis();
    const ids = a.hunks.slice(0, 3).map((h) => h.id);
    a.hunks[0]!.n = 5;
    expect(meter(a, ids).viewed).toEqual({ n: 7, total: 52 });
  });

  it('帰属・絡み・仕様・ツアーは hows / specs / tours から数える', () => {
    const a = fixtureAnalysis();
    for (const h of a.hunks) h.hows = [];
    a.hunks[0]!.hows = [1];
    a.hunks[1]!.hows = [1, 2];
    a.specs = [
      { id: 's1', text: '', hunkIds: [], hows: [1] },
      { id: 's2', text: '', hunkIds: [], hows: [] },
    ];
    a.tours = [
      { howId: 1, steps: [{ symbolId: 'x', hunkId: a.hunks[0]!.id, call: '' }, { symbolId: 'y', call: '' }] },
      { howId: 2, steps: [{ symbolId: 'z', hunkId: a.hunks[1]!.id, call: '' }] },
    ];
    const m = meter(a, [a.hunks[0]!.id]);
    expect(m.assigned).toEqual({ n: 2, total: 48 });
    expect(m.tangled).toBe(1);
    expect(m.specs).toEqual({ n: 1, total: 2 });
    expect(m.tours).toEqual({ n: 1, total: 2 });
  });
});
