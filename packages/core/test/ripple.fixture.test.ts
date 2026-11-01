// fixtures/order-service の差分に対する追従検出（設計書 8 章）の期待値。ゴールデンは expected/ripples.json。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Hunk, RippleGroup } from '@ondina/model';
import { parseConfig, splitConfig } from '../src/config/load.js';
import { extractAllHunks } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import { testPathsFor } from '../src/layers/assign.js';
import { detectRipples } from '../src/ripple/detect.js';
import { changedFixtureFiles, FIXTURE_ROOT } from './fixture.js';

let cached: Promise<{ hunks: Hunk[]; groups: RippleGroup[]; info: string[] }> | undefined;
function run() {
  cached ??= (async () => {
    const files = changedFixtureFiles();
    const hunks = (await extractAllHunks(files)).map(toHunk);
    const config = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
    return detectRipples(files, hunks, config);
  })();
  return cached;
}

describe('detectRipples（fixture）', () => {
  it('kind の内訳は core 1 / ripple 23 / test 7 / none 17', async () => {
    const { hunks } = await run();
    const count = (k: Hunk['kind']) => hunks.filter((h) => h.kind === k).length;
    expect({ core: count('core'), ripple: count('ripple'), test: count('test'), none: count('none') }).toEqual({ core: 1, ripple: 23, test: 7, none: 17 });
    expect(hunks).toHaveLength(48);
  });

  it('Order だけが core（ast）。束の無い候補（DiscountCommand / execute / apply / DTO）は none のまま', async () => {
    const { hunks } = await run();
    const kindOf = (fq: string) => hunks.find((h) => h.symbolFqName === fq)?.kind;
    expect(kindOf('com.example.order.domain.Order')).toBe('core');
    expect(hunks.find((h) => h.kind === 'core')?.kindProvenance).toBe('ast');
    for (const fq of [
      'com.example.order.domain.DiscountCommand',
      'com.example.order.application.ApplyDiscountUseCase.execute',
      'com.example.order.api.OrderController.apply',
      'com.example.order.api.OrderResponse',
      'com.example.order.api.OrderSummaryResponse',
      'com.example.order.api.OrderDetailResponse',
    ]) {
      expect(kindOf(fq), fq).toBe('none');
    }
  });

  it('src/test の hunk は test（config）で、束に入らない', async () => {
    const { hunks, groups } = await run();
    const tests = hunks.filter((h) => h.path.startsWith('src/test/'));
    expect(tests).toHaveLength(7);
    expect(tests.every((h) => h.kind === 'test' && h.kindProvenance === 'config')).toBe(true);
    const inGroups = new Set(groups.flatMap((g) => [...g.members, ...g.deviations]));
    expect(tests.some((h) => inGroups.has(h.id))).toBe(false);
  });

  it('設定にテストの置き場が無くても、構成の推定のテストの置き場の hunk は test（llm）で、束に入らない（5.2 の 7）', async () => {
    const files = changedFixtureFiles();
    const hunks = (await extractAllHunks(files)).map(toHunk);
    const config = { ...splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis, sourceRoots: [], layers: [] };
    const out = await detectRipples(files, hunks, config, testPathsFor(config, ['src/test']));
    const tests = out.hunks.filter((h) => h.path.startsWith('src/test/'));
    expect(tests).toHaveLength(7);
    expect(tests.every((h) => h.kind === 'test' && h.kindProvenance === 'llm')).toBe(true);
    const inGroups = new Set(out.groups.flatMap((g) => [...g.members, ...g.deviations]));
    expect(tests.some((h) => inGroups.has(h.id))).toBe(false);
  });

  it('束は 1 つ: getDiscount() → discount、members 22、逸脱は PromoService.apply だけ、近い逸脱は無い', async () => {
    const { hunks, groups } = await run();
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    const byId = new Map(hunks.map((h) => [h.id, h]));
    const fq = (id: string) => byId.get(id)?.symbolFqName;
    expect(g.pattern).toBe('getDiscount() → discount');
    expect(g.uniform).toBe('ast');
    expect(fq(g.derivedFrom.coreHunkId)).toBe('com.example.order.domain.Order');
    expect(g.derivedFrom).toEqual({ coreHunkId: g.derivedFrom.coreHunkId, removed: ['promo', 'getDiscount'], added: ['discount', 'applyDiscount'] });
    expect(g.members).toHaveLength(22);
    expect(fq(g.representative)).toBe('com.example.admin.OrderAdminView.discountField');
    expect(g.members[0]).toBe(g.representative);
    expect(g.deviations.map(fq)).toEqual(['com.example.promo.PromoService.apply']);
    expect(g.distance).toEqual({ [g.deviations[0]!]: 13 });
    expect(g.near).toEqual([]);
    expect(g.members.map(fq)).toContain('com.example.invoice.InvoiceBuilder.discountLine');
    expect(g.members.map(fq)).toContain('com.example.invoice.InvoiceBuilder.grandTotal');
    expect(g.members.map(fq)).toContain('com.example.cart.CartSummary.total');
  });

  it('束の全 hunk（代表・メンバー・逸脱）が kind ripple で同じ group を持つ', async () => {
    const { hunks, groups } = await run();
    const g = groups[0]!;
    for (const id of [...g.members, ...g.deviations]) {
      const h = hunks.find((x) => x.id === id)!;
      expect(h.kind).toBe('ripple');
      expect(h.kindProvenance).toBe('ast');
      expect(h.group).toEqual(g);
    }
    expect(hunks.filter((h) => h.group !== undefined)).toHaveLength(23);
  });

  it('入力の hunk 配列は変えず、n は全部 1、hows は空のまま', async () => {
    const files = changedFixtureFiles();
    const before = (await extractAllHunks(files)).map(toHunk);
    const snapshot = JSON.stringify(before);
    const config = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
    const { hunks } = await detectRipples(files, before, config);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(hunks.every((h) => h.n === 1 && h.hows.length === 0)).toBe(true);
    expect(hunks.map((h) => h.id)).toEqual(before.map((h) => h.id));
  });

  it('info: 束の要約 1 行と、未対応の正規化ルール namedArgOrder', async () => {
    const { info } = await run();
    expect(info).toEqual(['追従グループ 1、差異あり 1、わずかな差異 0', 'normalize.kotlin の namedArgOrder は未対応です']);
  });

  it('ゴールデン expected/ripples.json と一致する', async () => {
    const { hunks, groups } = await run();
    const golden = {
      hunks: hunks.map((h) => ({ id: h.id, symbolFqName: h.symbolFqName, kind: h.kind, kindProvenance: h.kindProvenance })),
      groups,
    };
    await expect(JSON.stringify(golden, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/ripples.json'));
  });
});
