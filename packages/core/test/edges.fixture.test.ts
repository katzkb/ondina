// fixtures/order-service の差分に対する Analysis.edges と Symbol（設計書 9 章）。
// 実機で採った答え（lsp/call-edges.json）だけで回る。kotlin-lsp は起動しない。
// ゴールデンは expected/edges.json と expected/symbols-lsp.json。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig, splitConfig } from '../src/config/load.js';
import { extractAllHunks } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import { buildCallGraph } from '../src/lsp/edges.js';
import { buildSymbols } from '../src/symbols/build.js';
import { changedFixtureFiles, FIXTURE_ROOT, readFixtureCallGraph, readFixtureHead } from './fixture.js';

let cached: ReturnType<typeof compute> | undefined;
function compute() {
  return (async () => {
    const hunks = (await extractAllHunks(changedFixtureFiles())).map(toHunk);
    const config = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
    const symbols = buildSymbols(hunks, config.layers);
    return { ...buildCallGraph(readFixtureCallGraph(), { hunks, symbols, layers: config.layers, allowedDependencies: config.allowedDependencies, readHead: readFixtureHead }), hunks };
  })();
}
function run() {
  cached ??= compute();
  return cached;
}

describe('buildCallGraph（fixture・実機の記録）', () => {
  it('全部 lsp 由来。参照辺は 30 本以上（2026-09-23 の実測 34 本。20 本を割ったら丸めか絞りが壊れている）', async () => {
    const { edges } = await run();
    expect(edges.every((e) => e.provenance === 'lsp')).toBe(true);
    expect(edges.filter((e) => e.kind === 'reference').length).toBeGreaterThanOrEqual(30);
    expect(edges.filter((e) => e.kind === 'reference').every((e) => (e.n ?? 0) >= 1)).toBe(true);
  });

  it('参照辺の両端はどちらも変更シンボル（未変更シンボルを参照辺のために作らない）', async () => {
    const { edges, symbols } = await run();
    const changed = new Set(symbols.filter((s) => s.changed).map((s) => s.id));
    expect(edges.filter((e) => e.kind === 'reference').every((e) => changed.has(e.from) && changed.has(e.to))).toBe(true);
  });

  it('参照辺を足すと、辺を持つ変更シンボルが過半数になる（2026-09-23 の実測 45/53。これが地図の成立条件）', async () => {
    const { edges, symbols } = await run();
    const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
    const changed = symbols.filter((s) => s.changed);
    const covered = changed.filter((s) => linked.has(s.id)).length;
    expect(covered / changed.length).toBeGreaterThan(0.5);
  });

  it('テストから出た辺は kind: test（incomingCalls には出ないのでテスト側から作っている）', async () => {
    const { edges } = await run();
    // 2026-10-12 から、変わらない行で差分の無い相手を呼ぶ辺（execute とそのテスト → OrderRepository.find）は作らない。それぞれ 11 → 10
    expect(edges.filter((e) => e.kind === 'test')).toHaveLength(10);
    expect(edges.filter((e) => e.kind === 'call')).toHaveLength(10);
  });

  it('層を飛び越える呼び出し辺は 2 本（API から Infrastructure と Domain を直に呼ぶ）。参照辺の層越えも同じ規則で付く', async () => {
    const { edges, symbols } = await run();
    const byId = new Map(symbols.map((s) => [s.id, s]));
    const crossing = edges.filter((e) => e.crossesLayers && e.kind === 'call').map((e) => `${byId.get(e.from)!.layer} → ${byId.get(e.to)!.layer}`);
    expect(crossing.sort()).toEqual(['API → Domain', 'API → Infrastructure']);
    expect(edges.filter((e) => e.crossesLayers && e.kind === 'reference').length).toBeGreaterThan(0);
  });

  it('辺ラベルは呼ばれる側のシグネチャから付く。戻り型が無い（Unit）側は欄ごと無い', async () => {
    const { edges, symbols } = await run();
    const byId = new Map(symbols.map((s) => [s.id, s]));
    const find = (to: string) => edges.find((e) => byId.get(e.to)!.fqName.endsWith(to));
    expect(find('ApplyDiscountUseCase.execute')!.types).toEqual({ in: 'OrderId, String', out: 'Order' });
    expect(find('OrderRepositoryImpl.save')!.types).toEqual({ in: 'Order' });
  });

  it('経路上の未変更シンボルが 4 件、どれも hunkId を持たない（OrderRepository.find は変わらない行からしか呼ばれないので作らない）', async () => {
    const { symbols } = await run();
    const baseline = symbols.filter((s) => !s.changed);
    expect(baseline).toHaveLength(4);
    expect(baseline.map((s) => s.fqName)).not.toContain('com.example.order.domain.OrderRepository.find');
    expect(baseline.every((s) => s.hunkId === undefined && s.edgesMeasured === true)).toBe(true);
    expect(baseline.map((s) => s.fqName)).toContain('com.example.order.domain.DiscountPolicy.rateFor');
  });

  it('呼び出し関係を測れなかった変更シンボルが 26 件（戻り型が value class の関数など。9 章）', async () => {
    const { symbols, unmeasured } = await run();
    expect(unmeasured).toBe(26);
    expect(symbols.filter((s) => s.edgesMeasured === false)).toHaveLength(26);
    // Order.total() は Money（value class）を返すので callHierarchy に出てこない
    expect(symbols.find((s) => s.fqName === 'com.example.admin.OrderAdminView.discountField')!.edgesMeasured).toBe(false);
  });

  it('testCount はテストの数。OrderRepositoryImpl.save は 3 件のテストから呼ばれている', async () => {
    const { symbols } = await run();
    const save = symbols.find((s) => s.fqName === 'com.example.order.infra.OrderRepositoryImpl.save');
    expect(save!.testCount).toBe(3);
    // 測った結果の 0 件と、測っていない（欄ごと無い）を混ぜない
    expect(symbols.filter((s) => s.testCount === 0).length).toBeGreaterThan(0);
    expect(symbols.filter((s) => s.changed && !('testCount' in s)).length).toBeGreaterThan(0);
  });

  it('未変更シンボルは自身のファイルの行を持つ。DiscountPolicy.rateFor は宣言の 9 行目の前後 2 行（設計書 3.3）', async () => {
    const { symbols } = await run();
    const rateFor = symbols.find((s) => s.fqName === 'com.example.order.domain.DiscountPolicy.rateFor');
    expect(rateFor!.excerpt).toEqual([{ start: 7, lines: ['    )', '', '    fun rateFor(code: String): Rate =', '        TABLE[code] ?: Rate.ZERO', '}'], centers: [9] }]);
    // 呼ぶ側の未変更シンボル: 宣言と Logger.format を呼んでいる行がどちらも 10 行目
    const log = symbols.find((s) => s.fqName === 'com.example.common.Logger.log');
    expect(log!.excerpt!.map((b) => b.centers)).toEqual([[10]]);
    expect(symbols.filter((s) => !s.changed).every((s) => s.excerpt !== undefined)).toBe(true);
    expect(symbols.filter((s) => s.changed).every((s) => s.excerpt === undefined)).toBe(true);
  });

  it('ゴールデン: 辺', async () => {
    const { edges } = await run();
    await expect(JSON.stringify(edges, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/edges.json'));
  });

  it('ゴールデン: LSP を重ねたシンボル（LSP なしの expected/symbols.json は動かない）', async () => {
    const { symbols } = await run();
    await expect(JSON.stringify(symbols, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/symbols-lsp.json'));
  });
});
