// LLM への入力（設計書 10.1 を今回の範囲に絞ったもの）を Stage 1 の成果物から組む。決定的。ゴールデンは expected/llm-input.json。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Hunk, How, MapGroups } from '@ondina/model';
import { parseConfig, splitConfig } from '../src/config/load.js';
import { extractAllHunks } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import { buildLlmInput, previousFrom } from '../src/label/input.js';
import { detectRipples, type RippleResult } from '../src/ripple/detect.js';
import { buildCallGraph } from '../src/lsp/edges.js';
import { buildSymbols } from '../src/symbols/build.js';
import { changedFixtureFiles, FIXTURE_ROOT, readFixtureCallGraph } from './fixture.js';

const PR = { title: 'main..feature/discount', body: readFileSync(path.join(FIXTURE_ROOT, 'pr-body.md'), 'utf8') };
/** fixture の ondina.config.yaml の層（analyze と同じものを渡す） */
const FIXTURE_LAYERS = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis.layers;

let cached: Promise<RippleResult> | undefined;
function stage1() {
  cached ??= (async () => {
    const files = changedFixtureFiles();
    const hunks = (await extractAllHunks(files)).map(toHunk);
    const config = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
    return detectRipples(files, hunks, config);
  })();
  return cached;
}

describe('detectRipples の candidateIds', () => {
  it('核候補（宣言の追加・削除・シグネチャ変更を含む hunk）の id を path 順に返す', async () => {
    const { hunks, candidateIds } = await stage1();
    const fq = (id: string) => hunks.find((h) => h.id === id)!.symbolFqName;
    expect(candidateIds.map(fq)).toEqual([
      'com.example.config.FeatureFlags.DISCOUNT_V2',
      'com.example.order.api.ApplyDiscountRequest',
      'com.example.order.api.OrderController.apply',
      'com.example.order.api.OrderDetailResponse',
      'com.example.order.api.OrderResponse',
      'com.example.order.api.OrderSummaryResponse',
      'com.example.order.application.ApplyDiscountUseCase.execute',
      'com.example.order.domain.DiscountCommand',
      'com.example.order.domain.Order',
    ]);
  });
});

describe('buildLlmInput（fixture）', () => {
  it('追従グループの hunk は hunks[] に入れず、残り 25 件を path 順に入れる', async () => {
    const { hunks, groups, candidateIds } = await stage1();
    const input = buildLlmInput({ hunks, groups, candidateIds, pr: PR, layers: FIXTURE_LAYERS });
    expect(input.hunks).toHaveLength(25);
    const inGroups = new Set(groups.flatMap((g) => [...g.members, ...g.deviations]));
    expect(input.hunks.some((h) => inGroups.has(h.id))).toBe(false);
    expect(input.hunks.map((h) => h.id)).toEqual(hunks.filter((h) => !inGroups.has(h.id)).map((h) => h.id));
    expect(input.hunks[0]).toMatchObject({ path: 'src/main/kotlin/com/example/common/Logger.kt', symbol: 'Logger.kt' });
    expect(input.hunks.every((h) => h.lines.length > 0)).toBe(true);
  });

  it('kindHint: 束を持つ核は core、束の無い候補は candidate、テストは test、それ以外は無し', async () => {
    const { hunks, groups, candidateIds } = await stage1();
    const input = buildLlmInput({ hunks, groups, candidateIds, pr: PR, layers: FIXTURE_LAYERS });
    const count = (k: string | undefined) => input.hunks.filter((h) => h.kindHint === k).length;
    expect({ core: count('core'), candidate: count('candidate'), test: count('test'), none: count(undefined) }).toEqual({ core: 1, candidate: 8, test: 7, none: 9 });
    const by = (symbol: string) => input.hunks.find((h) => h.symbol === symbol)!;
    expect(by('Order').kindHint).toBe('core');
    expect(by('DiscountCommand').kindHint).toBe('candidate');
    expect(by('DiscountCommand.kt').kindHint).toBeUndefined();
    expect(by('save()').kindHint).toBeUndefined();
  });

  it('rippleGroups は g1 から番号を振り、代表と逸脱の行だけ渡す（メンバーは数だけ）', async () => {
    const { hunks, groups, candidateIds } = await stage1();
    const input = buildLlmInput({ hunks, groups, candidateIds, pr: PR, layers: FIXTURE_LAYERS });
    expect(input.rippleGroups).toHaveLength(1);
    const g = input.rippleGroups[0]!;
    expect(g.id).toBe('g1');
    expect(g.pattern).toBe('getDiscount() → discount');
    expect(g.members).toBe(22);
    expect(g.coreHunkId).toBe(groups[0]!.derivedFrom.coreHunkId);
    expect(g.representative).toMatchObject({ hunkId: groups[0]!.representative, symbol: 'discountField()' });
    expect(g.representative.lines.length).toBeGreaterThan(0);
    expect(g.deviations).toHaveLength(1);
    expect(g.deviations[0]!.path).toBe('src/main/kotlin/com/example/promo/PromoService.kt');
  });

  it('pr は題名と本文、previous は無ければキーごと無い', async () => {
    const { hunks, groups, candidateIds } = await stage1();
    const input = buildLlmInput({ hunks, groups, candidateIds, pr: PR, layers: FIXTURE_LAYERS });
    expect(input.pr).toEqual(PR);
    expect('previous' in input).toBe(false);
    expect(Object.keys(input)).toEqual(['pr', 'hunks', 'rippleGroups', 'layers', 'unlayeredPaths']);
  });

  it('ゴールデン expected/llm-input.json と一致する（辺は実機で採った記録から。analyze --lsp と同じ形）', async () => {
    const { hunks, groups, candidateIds } = await stage1();
    const config = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
    const { edges } = buildCallGraph(readFixtureCallGraph(), { hunks, symbols: buildSymbols(hunks, config.layers), layers: config.layers, allowedDependencies: config.allowedDependencies });
    const input = buildLlmInput({ hunks, groups, candidateIds, pr: PR, layers: FIXTURE_LAYERS, edges });
    await expect(JSON.stringify(input, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/llm-input.json'));
  });
});

describe('previousFrom', () => {
  const hunk = (id: string, lines: string[], hows: number[] = []): Hunk =>
    ({ id, path: 'p', lang: 'kotlin', symbol: id, symbolFqName: id, symbolKind: 'function', kind: 'none', kindProvenance: 'ast', hows, n: 1, lnOld: 1, lnNew: 1, lines }) as Hunk;
  const hows: How[] = [
    { id: 1, title: 'A', why: 'a', specIds: [] },
    { id: 2, title: 'B', why: 'b', specIds: ['s1'] },
  ];

  it('id も lines も同じ hunk の割当だけを渡し、hows は id / title / why だけにする', () => {
    const prev = { hows, hunks: [hunk('x', ['+a'], [1]), hunk('y', ['+b'], [2]), hunk('z', ['+c'], [1, 2])] };
    const now = [hunk('x', ['+a']), hunk('y', ['+b2']), hunk('z', ['+c']), hunk('w', ['+d'])];
    expect(previousFrom(prev, now)).toEqual({
      hows: [
        { id: 1, title: 'A', why: 'a' },
        { id: 2, title: 'B', why: 'b' },
      ],
      assignment: { x: [1], z: [1, 2] },
    });
  });

  it('前回に hows が無ければ undefined（LLM を飛ばした回は前回にしない）', () => {
    expect(previousFrom({ hows: [], hunks: [hunk('x', ['+a'])] }, [hunk('x', ['+a'])])).toBeUndefined();
  });

  it('前回で未帰属だった hunk は assignment に入れない', () => {
    const prev = { hows, hunks: [hunk('x', ['+a'], [])] };
    expect(previousFrom(prev, [hunk('x', ['+a'])])).toEqual({ hows: [{ id: 1, title: 'A', why: 'a' }, { id: 2, title: 'B', why: 'b' }], assignment: {} });
  });

  it('前回の地図に題があれば、題の名前と中のコースを渡す（中がコースでも箱でも）', () => {
    const mapGroups: MapGroups = {
      root: ['theme:1', 'theme:2'],
      groups: [
        { id: 'theme:1', kind: 'theme', title: '大きい題', provenance: 'llm', children: ['course:1'] },
        { id: 'course:1', kind: 'course', howId: 1, provenance: 'ast', children: ['file:a'] },
        { id: 'theme:2', kind: 'theme', title: '小さい題', provenance: 'llm', children: ['file:b'] },
      ],
      boxes: [
        { id: 'file:a', label: 'a', path: 'a', hunkIds: ['x'], course: 1 },
        { id: 'file:b', label: 'b', path: 'b', hunkIds: ['y'], course: 2 },
      ],
    };
    expect(previousFrom({ hows, hunks: [], mapGroups }, [])?.themes).toEqual([
      { title: '大きい題', howIds: [1] },
      { title: '小さい題', howIds: [2] },
    ]);
  });
});

describe('buildLlmInput と層・辺（M2）', () => {
  const hunk = (id: string, path: string, symbol: string): Hunk => ({
    id,
    path,
    lang: 'kotlin',
    symbol,
    symbolFqName: `x.${symbol.replace('()', '')}`,
    symbolKind: 'function',
    kind: 'none',
    kindProvenance: 'ast',
    hows: [],
    n: 1,
    lnOld: 1,
    lnNew: 1,
    lines: ['+    val discount: Money'],
  });
  const layers = [
    { name: 'Tests', match: ['src/test/**'] },
    { name: 'Domain', match: ['**/domain/**'] },
  ];
  const domain = hunk('h1', 'src/main/kotlin/com/example/order/domain/Order.kt', 'applyDiscount()');
  const plain = hunk('h2', 'src/main/kotlin/com/example/common/Logger.kt', 'format()');

  it('glob で確定した層を hunk に付ける。当たらない hunk には欄ごと無い', () => {
    const input = buildLlmInput({ hunks: [domain, plain], groups: [], candidateIds: [], pr: PR, layers });
    expect(input.hunks[0]!.layer).toBe('Domain');
    expect(input.hunks[1]).not.toHaveProperty('layer');
  });

  it('層が当たらない変更ファイルを unlayeredPaths に昇順・重複なしで並べる', () => {
    const another = hunk('h3', 'src/main/kotlin/com/example/common/Logger.kt', 'log()');
    const input = buildLlmInput({ hunks: [plain, another, domain], groups: [], candidateIds: [], pr: PR, layers });
    expect(input.unlayeredPaths).toEqual(['src/main/kotlin/com/example/common/Logger.kt']);
  });

  it('層が当たらないファイルがあれば、選べる層の名前を layers に重複なしで並べる（どの hunk にも層が無くても選べるように）', () => {
    const input = buildLlmInput({ hunks: [plain], groups: [], candidateIds: [], pr: PR, layers: [...layers, { name: layers[0]!.name, match: ['x/**'] }] });
    expect(input.layers).toEqual([...new Set(layers.map((l) => l.name))]);
  });

  it('全部に層が付けば unlayeredPaths も layers も欄ごと無い', () => {
    const input = buildLlmInput({ hunks: [domain], groups: [], candidateIds: [], pr: PR, layers });
    expect(input).not.toHaveProperty('layers');
  });

  it('全部に層が付けば unlayeredPaths は欄ごと無い', () => {
    const input = buildLlmInput({ hunks: [domain], groups: [], candidateIds: [], pr: PR, layers });
    expect(input).not.toHaveProperty('unlayeredPaths');
  });

  it('layers を渡さなければ層は付かない（LSP や設定が無くても壊れない）', () => {
    const input = buildLlmInput({ hunks: [domain], groups: [], candidateIds: [], pr: PR });
    expect(input.hunks[0]).not.toHaveProperty('layer');
    expect(input.unlayeredPaths).toEqual([domain.path]);
  });

  it('辺は from / to / kind の 3 欄だけ渡す（型ラベルと層越えは渡さない。判定させない）', () => {
    const input = buildLlmInput({
      hunks: [domain],
      groups: [],
      candidateIds: [],
      pr: PR,
      layers,
      edges: [{ from: 'a', to: 'b', kind: 'call', types: { in: 'X', out: 'Y' }, crossesLayers: true, provenance: 'lsp' }],
    });
    expect(input.edges).toEqual([{ from: 'a', to: 'b', kind: 'call' }]);
  });

  it('辺を渡さなければ欄ごと無い（LSP を動かしていない）', () => {
    const input = buildLlmInput({ hunks: [domain], groups: [], candidateIds: [], pr: PR, layers });
    expect(input).not.toHaveProperty('edges');
  });
});
