// LLM 出力の検証（設計書 5.4 と計画の規則 1〜7）。全部プログラムで決め、捨てたものは info に 1 行ずつ。
import { describe, expect, it } from 'vitest';
import type { Hunk, RippleGroup } from '@ondina/model';
import { hunkId } from '../src/hunks/stable-id.js';
import { buildLlmInput } from '../src/label/input.js';
import type { LlmOutput } from '../src/label/types.js';
import { applyLlmOutput } from '../src/label/verify.js';

type Partial = Pick<Hunk, 'id' | 'path'> & Partial<Pick<Hunk, 'symbolKind' | 'kind' | 'kindProvenance' | 'symbol'>>;
const H = (p: Partial): Hunk => ({
  id: p.id,
  path: p.path,
  lang: 'kotlin',
  symbol: p.symbol ?? p.id,
  symbolFqName: p.id,
  symbolKind: p.symbolKind ?? 'function',
  kind: p.kind ?? 'none',
  kindProvenance: p.kindProvenance ?? 'ast',
  hows: [],
  n: 1,
  lnOld: 1,
  lnNew: 1,
  lines: [`+${p.id}`],
});

const group: RippleGroup = {
  pattern: 'a → b',
  derivedFrom: { coreHunkId: 'core', removed: ['a'], added: ['b'] },
  uniform: 'ast',
  representative: 'r1',
  members: ['r1', 'r2'],
  deviations: ['d1'],
  distance: { d1: 3 },
  near: [],
};
const hunks: Hunk[] = [
  H({ id: 'core', path: 'A.kt', kind: 'core' }),
  H({ id: 'r1', path: 'B.kt', kind: 'ripple' }),
  H({ id: 'r2', path: 'C.kt', kind: 'ripple' }),
  H({ id: 'd1', path: 'D.kt', kind: 'ripple' }),
  H({ id: 'x', path: 'X.kt' }),
  H({ id: 'X.kt', path: 'X.kt', symbolKind: 'file' }),
  H({ id: 'y', path: 'Y.kt' }),
  H({ id: 'y2', path: 'Y.kt' }),
  H({ id: 'Y.kt', path: 'Y.kt', symbolKind: 'file' }),
  H({ id: 't', path: 'src/test/T.kt', kind: 'test', kindProvenance: 'config' }),
  H({ id: 'z', path: 'Z.kt' }),
].map((h) => (['r1', 'r2', 'd1'].includes(h.id) ? { ...h, group } : h));
const body = '割引を足した。キャッシュ層を横断的に更新した。';
const input = buildLlmInput({ hunks, groups: [group], candidateIds: ['core', 'x'], pr: { title: 'T', body } });
const out = (o: Partial<LlmOutput>): LlmOutput => ({ hows: [], claims: [], layerGuesses: [], ...o });
const how = (h: Partial<LlmOutput['hows'][number]>): LlmOutput['hows'][number] => ({ title: '', why: '', hunkIds: [], groupIds: [], ...h });

describe('applyLlmOutput', () => {
  it('規則 3: hunk.hows はまとまり側から計算し、束は代表・メンバー・逸脱の全員に付く。specIds は空', () => {
    const r = applyLlmOutput(hunks, [group], input, out({ hows: [how({ id: 1, title: 'A', why: 'a', hunkIds: ['core', 'x'], groupIds: ['g1'] }), how({ id: 2, title: 'B', why: 'b', hunkIds: ['y', 'x'] })] }));
    const hows = (id: string) => r.hunks.find((h) => h.id === id)!.hows;
    expect(hows('core')).toEqual([1]);
    expect(hows('r1')).toEqual([1]);
    expect(hows('r2')).toEqual([1]);
    expect(hows('d1')).toEqual([1]);
    expect(hows('x')).toEqual([1, 2]);
    expect(hows('y')).toEqual([2]);
    expect(hows('z')).toEqual([]);
    expect(r.hows).toEqual([
      { id: 1, title: 'A', why: 'a', specIds: [] },
      { id: 2, title: 'B', why: 'b', specIds: [] },
    ]);
    // X.kt は規則 5 で x の [1, 2] を引き継ぐので絡みは x と X.kt の 2
    expect(r.info.at(-1)).toBe('How 2、未帰属 4、絡み 2');
  });

  it('規則 4: まとまりに入った none は core（llm）。core（ast）/ ripple / test は変えない', () => {
    const r = applyLlmOutput(hunks, [group], input, out({ hows: [how({ id: 1, hunkIds: ['core', 'x', 't'], groupIds: ['g1'] })] }));
    const k = (id: string) => {
      const h = r.hunks.find((h) => h.id === id)!;
      return [h.kind, h.kindProvenance];
    };
    expect(k('x')).toEqual(['core', 'llm']);
    expect(k('core')).toEqual(['core', 'ast']);
    expect(k('r1')).toEqual(['ripple', 'ast']);
    expect(k('t')).toEqual(['test', 'config']);
    expect(k('z')).toEqual(['none', 'ast']);
  });

  it('規則 5: LLM が入れなかったファイル hunk は、同じファイルの他の hunk が全部同じ hows ならそれを引き継ぐ', () => {
    const r = applyLlmOutput(hunks, [group], input, out({ hows: [how({ id: 1, hunkIds: ['x', 'y'] }), how({ id: 2, hunkIds: ['y2'] })] }));
    const h = (id: string) => r.hunks.find((h) => h.id === id)!;
    expect(h('X.kt').hows).toEqual([1]);
    expect([h('X.kt').kind, h('X.kt').kindProvenance]).toEqual(['core', 'llm']);
    // Y.kt は y が [1]、y2 が [2] で揃わないので未帰属のまま
    expect(h('Y.kt').hows).toEqual([]);
    expect(h('Y.kt').kind).toBe('none');
  });

  it('規則 5: LLM がファイル hunk を自分で入れたならそれを尊重する', () => {
    const r = applyLlmOutput(hunks, [group], input, out({ hows: [how({ id: 1, hunkIds: ['x'] }), how({ id: 2, hunkIds: ['X.kt'] })] }));
    expect(r.hunks.find((h) => h.id === 'X.kt')!.hows).toEqual([2]);
  });

  it('規則 1: 知らない hunk id / 束 id は捨てて info。空になったまとまりも捨てる', () => {
    const r = applyLlmOutput(hunks, [group], input, out({ hows: [how({ id: 1, title: 'A', hunkIds: ['x', 'nope'], groupIds: ['g9'] }), how({ id: 2, title: 'B', hunkIds: ['ghost'] })] }));
    expect(r.hows.map((h) => h.id)).toEqual([1]);
    expect(r.info).toEqual(['不明な hunk id を除外しました: nope', '不明な束 id を除外しました: g9', '不明な hunk id を除外しました: ghost', '空になった How を除外しました: B', 'How 1、未帰属 9、絡み 0']);
  });

  it('規則 2: id が重複・欠け・不正なら出てきた順に 1 から振り直して info', () => {
    const r = applyLlmOutput(hunks, [group], input, out({ hows: [how({ id: 3, hunkIds: ['x'] }), how({ hunkIds: ['y'] }), how({ id: 3, hunkIds: ['z'] })] }));
    expect(r.hows.map((h) => h.id)).toEqual([1, 2, 3]);
    expect(r.hunks.find((h) => h.id === 'z')!.hows).toEqual([3]);
    expect(r.info[0]).toBe('How の id を振り直しました（重複か欠け）');
  });

  it('規則 2: id が揃っていればそのまま（並びも LLM の順）', () => {
    const r = applyLlmOutput(hunks, [group], input, out({ hows: [how({ id: 3, hunkIds: ['x'] }), how({ id: 1, hunkIds: ['y'] })] }));
    expect(r.hows.map((h) => h.id)).toEqual([3, 1]);
    expect(r.info).toEqual(['How 2、未帰属 8、絡み 0']);
  });

  it('規則 6: 本文にそのまま含まれない主張は捨てて info。本文が空なら claims は空', () => {
    const claims = [
      { text: 'キャッシュ層を横断的に更新した', backed: false, reason: '該当する変更が無い' },
      { text: 'キャッシュ層を全面的に更新した', backed: false, reason: '…' },
    ];
    const r = applyLlmOutput(hunks, [group], input, out({ claims }));
    expect(r.claims).toEqual([claims[0]]);
    expect(r.info[0]).toBe('本文にない主張を除外しました: キャッシュ層を全面的に更新した');
    const noBody = buildLlmInput({ hunks, groups: [group], candidateIds: [], pr: { title: 'T', body: '' } });
    expect(applyLlmOutput(hunks, [group], noBody, out({ claims })).claims).toEqual([]);
  });

  it('束は入力の rippleGroups と groups を配列の位置ではなく代表の hunk id で対応付ける', () => {
    const group2: RippleGroup = { ...group, pattern: 'c → d', representative: 'x', members: ['x'], deviations: [], distance: {}, near: [] };
    const hs = hunks.map((h) => (h.id === 'x' ? { ...h, kind: 'ripple' as const, group: group2 } : h));
    const inp = buildLlmInput({ hunks: hs, groups: [group, group2], candidateIds: [], pr: { title: 'T', body: '' } });
    expect(inp.rippleGroups.map((g) => g.id)).toEqual(['g1', 'g2']);
    // 検証には逆順で渡しても g2 = x の束、g1 = r1/r2/d1 の束
    const r = applyLlmOutput(hs, [group2, group], inp, out({ hows: [how({ id: 1, groupIds: ['g2'] }), how({ id: 2, groupIds: ['g1'] })] }));
    const hows = (id: string) => r.hunks.find((h) => h.id === id)!.hows;
    expect(hows('x')).toEqual([1]);
    expect(hows('r1')).toEqual([2]);
    expect(hows('d1')).toEqual([2]);
  });

  it('入力の hunk 配列は変えない', () => {
    const snapshot = JSON.stringify(hunks);
    applyLlmOutput(hunks, [group], input, out({ hows: [how({ id: 1, hunkIds: ['x'], groupIds: ['g1'] })] }));
    expect(JSON.stringify(hunks)).toBe(snapshot);
  });
});

// fixture の記録出力（fixtures/order-service/llm/。既定の LLM コマンドで record-llm.sh が採ったもの）を検証に通す。
// テストは LLM を起動しない。ゴールデンは expected/hows.json
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseConfig, splitConfig } from '../src/config/load.js';
import { extractAllHunks } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import { parseLlmOutput } from '../src/label/schema.js';
import type { LlmInput } from '../src/label/types.js';
import { detectRipples, type RippleResult } from '../src/ripple/detect.js';
import { changedFixtureFiles, FIXTURE_ROOT } from './fixture.js';

const readJson = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8')) as T;
const recorded = (rel: string): LlmOutput => {
  const r = parseLlmOutput(readJson<{ stdout: string }>(rel).stdout);
  if ('error' in r) throw new Error(`${rel}: ${r.error}`);
  return r.output;
};

let cached: Promise<RippleResult> | undefined;
function stage1() {
  cached ??= (async () => {
    const files = changedFixtureFiles();
    const hs = (await extractAllHunks(files)).map(toHunk);
    const config = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
    return detectRipples(files, hs, config);
  })();
  return cached;
}

describe('fixture の記録出力を検証に通す', () => {
  it('hows が埋まり、How に入った none は core（llm）、束の 23 hunk は同じ How、未帰属は Logger の 2 hunk と DISCOUNT_V2、claims に裏付け無しが 2 つ', async () => {
    const s1 = await stage1();
    const golden = readJson<LlmInput>('expected/llm-input.json');
    const r = applyLlmOutput(s1.hunks, s1.groups, golden, recorded('llm/output.json'));
    expect(r.hows.length).toBeGreaterThanOrEqual(3);
    expect(r.hows.map((h) => h.id)).toEqual(r.hows.map((_, i) => i + 1));
    expect(r.hunks.filter((h) => h.kind === 'none' && h.hows.length > 0)).toEqual([]);
    const ripple = r.hunks.filter((h) => h.kind === 'ripple');
    expect(ripple).toHaveLength(23);
    expect(new Set(ripple.map((h) => h.hows.join(','))).size).toBe(1);
    expect(r.hunks.filter((h) => h.hows.length === 0).map((h) => h.symbolFqName).sort()).toEqual(['com.example.common.Logger.format', 'com.example.config.FeatureFlags.DISCOUNT_V2', 'src/main/kotlin/com/example/common/Logger.kt']);
    // 記録を採り直すとモデルの判定は揺れる。裏付け無しの件数ではなく、fixture が仕込んだキャッシュの文が入っていることを見る
    expect(r.claims.filter((c) => !c.backed)).toHaveLength(2);
    expect(r.claims.filter((c) => !c.backed).map((c) => c.text)).toContain('キャッシュ層を横断的に更新し、割引後の合計が古い値で返らないようにした');
    expect(r.info.at(-1)).toBe('How 7、未帰属 3、絡み 0');
    expect(r.info.filter((l) => l.includes('除外しました'))).toEqual([]);
  });

  it('ゴールデン expected/hows.json と一致する', async () => {
    const s1 = await stage1();
    const r = applyLlmOutput(s1.hunks, s1.groups, readJson<LlmInput>('expected/llm-input.json'), recorded('llm/output.json'));
    const golden = {
      hows: r.hows,
      hunks: r.hunks.map((h) => ({ id: h.id, symbolFqName: h.symbolFqName, kind: h.kind, kindProvenance: h.kindProvenance, hows: h.hows })),
      claims: r.claims,
      info: r.info,
    };
    await expect(JSON.stringify(golden, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/hows.json'));
  });

  it('2 回目の記録: 入力はゴールデンの入力 + previous で、出力は previous の How の id と title を維持し、変わっていない hunk の割当も同じ', async () => {
    const s1 = await stage1();
    const golden = readJson<LlmInput>('expected/llm-input.json');
    const input2 = readJson<LlmInput>('llm/input-previous.json');
    expect(input2.previous).toBeDefined();
    // 記録は layers（選べる層の名前。2026-10-09 に足した欄）より前、かつ変わらない行からの呼び出し辺を落とす（2026-10-12）より前の入力。
    // 落とした 2 本（execute とそのテストが変わらない行で呼ぶ OrderRepository.find）のほかがゴールデンと同じことを見る
    const find = hunkId('src/main/kotlin/com/example/order/domain/OrderRepository.kt', 'com.example.order.domain.OrderRepository.find');
    expect(input2.edges?.filter((e) => e.to === find)).toHaveLength(2);
    expect({ ...input2, previous: undefined, edges: input2.edges?.filter((e) => e.to !== find) }).toEqual({ ...golden, previous: undefined, layers: undefined });
    const out2 = recorded('llm/output-previous.json');
    const prev = input2.previous!;
    for (const p of prev.hows) expect(out2.hows.find((h) => h.id === p.id)?.title, `How ${p.id}`).toBe(p.title);
    const r = applyLlmOutput(s1.hunks, s1.groups, input2, out2);
    for (const [id, hows] of Object.entries(prev.assignment)) expect(r.hunks.find((h) => h.id === id)!.hows, id).toEqual(hows);
    expect(r.hows.map((h) => h.id).sort((a, b) => a - b)).toEqual(prev.hows.map((h) => h.id).sort((a, b) => a - b));
  });
});
