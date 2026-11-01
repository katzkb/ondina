// fixtures/order-service の差分に対する Analysis.tours（設計書 3.3 / 10.2）。
// 実機で採った辺の記録（lsp/call-edges.json）と LLM の記録（expected/hows.json）から組む。ゴールデンは expected/tours.json。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Analysis } from '@ondina/model';
import { parseConfig, splitConfig } from '../src/config/load.js';
import { extractAllHunks } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import { buildCallGraph } from '../src/lsp/edges.js';
import { detectRipples } from '../src/ripple/detect.js';
import { buildSymbols } from '../src/symbols/build.js';
import { buildTours } from '../src/tour/build.js';
import { changedFixtureFiles, FIXTURE_ROOT, readFixtureCallGraph } from './fixture.js';

let cached: ReturnType<typeof compute> | undefined;
function compute() {
  return (async () => {
    const files = changedFixtureFiles();
    const config = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
    // 本番（analyze）と同じく追従の束を付けてから組む（束は代表 1 件だけステップにする）
    const raw = (await detectRipples(files, (await extractAllHunks(files)).map(toHunk), config)).hunks;
    // hunk.hows は LLM の記録（expected/hows.json）から写す
    const labeled = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'expected/hows.json'), 'utf8')) as Pick<Analysis, 'hows' | 'hunks'>;
    const howsOf = new Map(labeled.hunks.map((h) => [h.id, h.hows]));
    const hunks = raw.map((h) => ({ ...h, hows: howsOf.get(h.id) ?? [] }));
    const symbols = buildSymbols(hunks, config.layers);
    const graph = buildCallGraph(readFixtureCallGraph(), { hunks, symbols, layers: config.layers, allowedDependencies: config.allowedDependencies });
    const tours = buildTours({ hows: labeled.hows, hunks, symbols: graph.symbols, edges: graph.edges, layers: config.layers });
    const byId = new Map(graph.symbols.map((s) => [s.id, s]));
    return { tours, byId, hows: labeled.hows };
  })();
}
function run() {
  cached ??= compute();
  return cached;
}

describe('buildTours（fixture・実機の記録）', () => {
  it('How の数だけ tours がある', async () => {
    const { tours, hows } = await run();
    expect(tours.map((t) => t.howId)).toEqual(hows.map((h) => h.id));
  });

  it('「execute にコードを受け取らせ保存する」は execute から始まり、呼ぶ順に並ぶ', async () => {
    const { tours, byId, hows } = await run();
    const how = hows.find((h) => h.title.includes('execute'))!;
    const names = tours.find((t) => t.howId === how.id)!.steps.map((s) => byId.get(s.symbolId)!.fqName.split('.').slice(-2).join('.'));
    expect(names[0]).toBe('ApplyDiscountUseCase.execute');
    expect(names).toContain('OrderRepositoryImpl.save');
    expect(names.indexOf('ApplyDiscountUseCase.execute')).toBeLessThan(names.indexOf('OrderRepositoryImpl.save'));
  });

  // 2026-10-11: 回る場所は差分だけ。fixture の差分の無い相手 5 つ（rateFor・OrderRepository.find / save など）は停留所にならない
  it('どの停留所も差分（hunkId を持ち、シンボルは changed）', async () => {
    const { tours, byId } = await run();
    const steps = tours.flatMap((t) => t.steps);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect([s.hunkId !== undefined, byId.get(s.symbolId)!.changed], byId.get(s.symbolId)!.fqName).toEqual([true, true]);
  });

  it('SQL だけの How は 1 ステップで、呼ばれ方は空', async () => {
    const { tours, byId, hows } = await run();
    const how = hows.find((h) => h.title.includes('テーブル'))!;
    const steps = tours.find((t) => t.howId === how.id)!.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]!.call).toBe('');
    expect(byId.get(steps[0]!.symbolId)!.fqName).toMatch(/\.sql$/);
  });

  it('追従の束は代表 1 件だけがステップになる', async () => {
    const { tours, byId, hows } = await run();
    const how = hows.find((h) => h.title.includes('applyDiscount'))!;
    const steps = tours.find((t) => t.howId === how.id)!.steps;
    const ripple = steps.filter((s) => byId.get(s.symbolId)!.fqName.startsWith('com.example.admin') || byId.get(s.symbolId)!.fqName.startsWith('com.example.analytics'));
    expect(steps.length).toBeLessThan(10);
    expect(ripple.length).toBeLessThanOrEqual(1);
  });

  it('ゴールデン: tours', async () => {
    const { tours } = await run();
    await expect(JSON.stringify(tours, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/tours.json'));
  });
});
