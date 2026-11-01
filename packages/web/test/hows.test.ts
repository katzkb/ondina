// How 分解の画面（設計書 3.2）の行の並び・束のまとめ・How ごとの件数は純粋関数で作る。
// fixture: How 7、hunk 48（核 15 / 追従 23 / テスト 7 / 未帰属 3）、束 1（代表 OrderAdminView.discountField、外れ PromoService.apply、メンバー 21）。
import type { Hunk } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { howCounts, howRows, navigable, rippleCounts, type HowRow } from '../src/hows.js';
import { fixtureAnalysis } from './fixture.js';

const label = (r: HowRow) => (r.kind === 'group' ? `group:${r.hunks.length}` : `${r.kind}:${r.hunk.symbol}`);
const group = (rows: HowRow[]) => rows.find((r) => r.kind === 'group') as Extract<HowRow, { kind: 'group' }>;

describe('howRows', () => {
  it('How の id 順に並び、同じ How の中は 核 → 追従（束は 1 行）→ テスト、未帰属は最後', () => {
    const rows = howRows(fixtureAnalysis(), [], [], null);
    const labels = rows.map(label);
    expect(labels.slice(0, 4)).toEqual(['hunk:V421__discount.sql', 'hunk:DiscountCommand.kt', 'hunk:DiscountCommand', 'hunk:Order']);
    expect(labels[4]).toBe('group:23');
    expect(labels.slice(-3)).toEqual(['hunk:Logger.kt', 'hunk:format()', 'hunk:DISCOUNT_V2']);
    // 束の 23 件は行にならないので 48 - 23 + 1
    expect(rows).toHaveLength(26);
  });

  it('束の行: 22 ファイル、23 件、代表、見た 0/23、畳んだ状態', () => {
    const g = group(howRows(fixtureAnalysis(), [], [], null));
    expect(g.files).toBe(22);
    expect(g.hunks).toHaveLength(23);
    expect(g.representative.symbol).toBe('discountField()');
    expect(g.viewedCount).toBe(0);
    expect(g.open).toBe(false);
  });

  it('束を展開すると 代表 → 外れ（距離つき）→ メンバー（path 順）の 23 行が続く', () => {
    const a = fixtureAnalysis();
    const rep = a.hunks.find((h) => h.symbol === 'discountField()')!;
    const rows = howRows(a, [rep.id], [rep.id], null);
    const g = group(rows);
    expect(g.open).toBe(true);
    expect(g.viewedCount).toBe(1);
    const at = rows.indexOf(g);
    const members = rows.slice(at + 1, at + 24) as Array<Extract<HowRow, { kind: 'member' }>>;
    expect(members.every((r) => r.kind === 'member')).toBe(true);
    expect(members[0]).toMatchObject({ role: 'representative', hunk: { symbol: 'discountField()' } });
    expect(members[1]).toMatchObject({ role: 'deviation', hunk: { symbol: 'apply()' } });
    expect(members[2]!.hunk.path).toContain('analytics/OrderMetrics.kt');
    expect(members[22]!.hunk.path).toContain('warehouse/PickingSlip.kt');
    expect(rows[at + 24]!.kind).not.toBe('member');
  });

  it('差異ありの行は語の数（distance）を持たない（画面に出さない）', () => {
    const a = fixtureAnalysis();
    const rep = a.hunks.find((h) => h.symbol === 'discountField()')!;
    const rows = howRows(a, [], [rep.id], null);
    const dev = rows.find((r) => r.kind === 'member' && r.role === 'deviation') as Extract<HowRow, { kind: 'member' }>;
    expect('distance' in dev).toBe(false);
  });

  it('How で絞り込むと属さない行が dim になる（束は代表の How で判断）', () => {
    const rows = howRows(fixtureAnalysis(), [], [], 3);
    expect(rows.filter((r) => !r.dim).map(label)).toEqual(['hunk:Order', 'group:23', 'hunk:`applies the policy rate to subtotal`()', 'hunk:`keeps total when code is unknown`()']);
    expect(rows.filter((r) => r.dim)).toHaveLength(22);
  });

  it('2 つの How に属す hunk は最初の How の位置に 1 回だけ出る', () => {
    const a = fixtureAnalysis();
    const sql = a.hunks.find((h) => h.symbol === 'V421__discount.sql')!;
    sql.hows = [1, 4];
    const rows = howRows(a, [], [], null);
    expect(rows.filter((r) => r.kind === 'hunk' && r.hunk.id === sql.id)).toHaveLength(1);
    expect(label(rows[0]!)).toBe('hunk:V421__discount.sql');
  });
});

describe('navigable', () => {
  it('畳んだ束は代表 1 つとして通り、展開すると 23 件を順に通る', () => {
    const a = fixtureAnalysis();
    const rep = a.hunks.find((h) => h.symbol === 'discountField()')!;
    const closed = navigable(howRows(a, [], [], null));
    expect(closed).toHaveLength(26);
    expect(closed[4]).toBe(rep.id);
    const open = navigable(howRows(a, [], [rep.id], null));
    expect(open).toHaveLength(48);
    expect(open[4]).toBe(rep.id);
    expect(open[5]).toBe(a.hunks.find((h) => h.symbol === 'apply()' && h.path.includes('promo'))!.id);
  });

  it('絞り込み中は dim の行を飛ばす', () => {
    const ids = navigable(howRows(fixtureAnalysis(), [], [], 1));
    expect(ids).toHaveLength(1);
  });
});

describe('howCounts', () => {
  it('How ごとに 核 / 追従 / テスト の件数と見た割合（束のメンバーも 1 件ずつ）', () => {
    const a = fixtureAnalysis();
    const rep = a.hunks.find((h) => h.symbol === 'discountField()')!;
    const counts = howCounts(a, [rep.id]);
    expect(counts.get(3)).toEqual({ core: 1, ripple: 23, test: 2, total: 26, viewed: 1, pct: 4 });
    expect(counts.get(1)).toEqual({ core: 1, ripple: 0, test: 0, total: 1, viewed: 0, pct: 0 });
  });

  it('hunk が無い How は 0%', () => {
    const a = fixtureAnalysis();
    a.hows.push({ id: 8, title: 'x', why: '', specIds: [] });
    expect(howCounts(a, []).get(8)).toEqual({ core: 0, ripple: 0, test: 0, total: 0, viewed: 0, pct: 0 });
  });
});

describe('rippleCounts', () => {
  it('fixture: 追従 23、逸脱 1、近い逸脱 0', () => {
    expect(rippleCounts(fixtureAnalysis().hunks)).toEqual({ ripple: 23, deviations: 1, near: 0 });
  });

  it('近い逸脱は group.near で数える', () => {
    const hunks = fixtureAnalysis().hunks;
    const dev = hunks.find((h) => h.group?.deviations.includes(h.id))!;
    for (const h of hunks) if (h.group) h.group.near = [dev.id];
    expect(rippleCounts(hunks).near).toBe(1);
  });

  it('束が無ければ全部 0', () => {
    const hunks: Hunk[] = fixtureAnalysis().hunks.filter((h) => h.kind !== 'ripple');
    expect(rippleCounts(hunks)).toEqual({ ripple: 0, deviations: 0, near: 0 });
  });
});
