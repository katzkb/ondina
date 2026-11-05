// fixtures/order-service の変わる前（base）の呼び出し辺（2026-11-05。流れの地図の ① 背景の材料）。
// 実機で採った答え（lsp/call-edges-base.json）だけで回る。kotlin-lsp は起動しない。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig, splitConfig } from '../src/config/load.js';
import { extractAllHunks } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import { buildBaseCallEdges, buildCallGraph } from '../src/lsp/edges.js';
import { buildSymbols } from '../src/symbols/build.js';
import { changedFixtureFiles, FIXTURE_ROOT, readFixtureBase, readFixtureCallGraph, readFixtureCallGraphBase, readFixtureHead } from './fixture.js';

async function run() {
  const hunks = (await extractAllHunks(changedFixtureFiles())).map(toHunk);
  const config = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
  const symbols = buildSymbols(hunks, config.layers);
  const ctx = { hunks, symbols, layers: config.layers, allowedDependencies: config.allowedDependencies };
  const head = buildCallGraph(readFixtureCallGraph(), { ...ctx, readHead: readFixtureHead });
  const base = buildBaseCallEdges(readFixtureCallGraphBase(), { ...ctx, readHead: readFixtureBase });
  const name = new Map([...head.symbols, ...base.symbols].map((s) => [s.id, s.fqName.split('.').slice(-2).join('.')]));
  const order = (edges: typeof base.edges) =>
    edges
      .filter((e) => e.kind === 'call')
      .map((e) => `${name.get(e.from)} → ${name.get(e.to)}`)
      .filter((s) => /OrderController|ApplyDiscountUseCase|OrderRepository|Order\.|DiscountPolicy|OrderResponse/.test(s))
      .sort();
  return { base, head, order };
}

describe('buildBaseCallEdges（fixture・実機の記録）', () => {
  it('変わる前の注文の流れは apply → execute → find と apply → OrderResponse だけ（割引の計算も保存も無い）', async () => {
    const { base, order } = await run();
    // OrderResponse.from は差分のあるクラス OrderResponse に丸まる（head と同じ規則）。
    // インターフェースの OrderRepository.find は差分が無く、呼んでいる行も変わらないので head と同じく落ちる
    expect(order(base.edges)).toEqual([
      'ApplyDiscountUseCase.execute → OrderRepositoryImpl.find',
      'OrderController.apply → ApplyDiscountUseCase.execute',
      'OrderController.apply → api.OrderResponse',
    ]);
  });

  it('変わった後には無い base だけの線は無く、head にある apply → save や applyDiscount → rateFor は base に無い', async () => {
    const { base, head, order } = await run();
    const before = order(base.edges);
    expect(before).not.toContain('OrderController.apply → OrderRepositoryImpl.save');
    expect(before).not.toContain('Order.applyDiscount → DiscountPolicy.rateFor');
    expect(order(head.edges)).toContain('OrderController.apply → ApplyDiscountUseCase.execute');
  });

  it('呼んでいる行は base のファイルの行（OrderController.kt の 17 行目で execute、18 行目で OrderResponse.from）', async () => {
    const { base, head } = await run();
    const byName = new Map([...head.symbols, ...base.symbols].map((s) => [s.id, s.fqName]));
    const lines = (to: string) => base.edges.find((e) => byName.get(e.from)?.endsWith('OrderController.apply') && byName.get(e.to)?.endsWith(to))?.lines;
    expect(lines('ApplyDiscountUseCase.execute')).toEqual([17]);
    expect(lines('api.OrderResponse')).toEqual([18]);
    expect(readFixtureBase('src/main/kotlin/com/example/order/api/OrderController.kt')!.split('\n')[16]).toContain('useCase.execute(OrderId(id))');
  });

  it('返すのは呼び出し辺と未変更シンボルだけ（参照辺・変更シンボルは head の答えが持つ）', async () => {
    const { base } = await run();
    expect(base.edges.every((e) => e.kind === 'call' && e.provenance === 'lsp')).toBe(true);
    expect(base.symbols.every((s) => !s.changed)).toBe(true);
  });
});
