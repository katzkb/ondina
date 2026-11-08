import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Edge, Hunk, RippleGroup, Spec, Symbol } from '@ondina/model';
import { buildChapters } from '../src/chapter/build.js';
import { fixtureAnalysis } from './fixture-analysis.js';
import { FIXTURE_ROOT } from './fixture.js';

const hunk = (id: string, over: Partial<Hunk> = {}): Hunk => ({
  id, path: `${id}.kt`, lang: 'kotlin', symbol: id, symbolFqName: id, symbolKind: 'function',
  kind: 'none', kindProvenance: 'ast', hows: [], n: 1, lnOld: 1, lnNew: 1, lines: [], ...over,
});
const spec = (id: string, hunkIds: string[]): Spec => ({ id, text: id, hunkIds, hows: [] });
const group: RippleGroup = {
  pattern: 'a → b', derivedFrom: { coreHunkId: 'core', removed: ['a'], added: ['b'] }, uniform: 'ast',
  representative: 'rep', members: ['member', 'rep', 'chosen'], deviations: ['dev'], distance: {}, near: [],
};
const run = (specs: Spec[], hunks: Hunk[]) => buildChapters({ specs, hunks, symbols: [], edges: [], layers: [] });

describe('buildChapters', () => {
  it('要求の順に章を作り、同じ差分を複数の要求で読める。対応なしの章も残す', () => {
    expect(run([spec('s1', ['b', 'a']), spec('s2', ['a']), spec('s3', [])], [hunk('a'), hunk('b')])).toEqual([
      { kind: 'spec', specId: 's1', hunkIds: ['a', 'b'] },
      { kind: 'spec', specId: 's2', hunkIds: ['a'] },
      { kind: 'spec', specId: 's3', hunkIds: [] },
    ]);
  });

  it('追従は代表を先頭にして元順で並べ、要求にあるメンバー・核・逸脱を除く。残りは extra', () => {
    const hunks = [hunk('extra'), hunk('member', { group }), hunk('core'), hunk('rep', { group }), hunk('dev', { group }), hunk('chosen', { group })];
    const chapters = run([spec('s1', ['core', 'chosen'])], hunks);
    expect(chapters).toEqual([
      { kind: 'spec', specId: 's1', hunkIds: ['core', 'chosen'] },
      { kind: 'follow', hunkIds: ['rep', 'member'] },
      { kind: 'extra', hunkIds: ['extra', 'dev'] },
    ]);
    expect(new Set(chapters.flatMap((c) => c.hunkIds))).toEqual(new Set(hunks.map((h) => h.id)));
    expect(run([spec('s1', ['rep'])], hunks).find((c) => c.kind === 'follow')?.hunkIds).toEqual(['member', 'chosen']);
  });

  it('未選択の import だけの差分は、同じファイルを読む最初の要求の末尾に置く。他は extra', () => {
    const hunks = [hunk('imports', { path: 'a.kt', importsOnly: true }), hunk('a', { path: 'a.kt' }), hunk('orphan', { importsOnly: true }), hunk('selected', { importsOnly: true })];
    expect(run([spec('s1', []), spec('s2', ['a']), spec('s3', ['a', 'selected'])], hunks)).toEqual([
      { kind: 'spec', specId: 's1', hunkIds: [] },
      { kind: 'spec', specId: 's2', hunkIds: ['a', 'imports'] },
      { kind: 'spec', specId: 's3', hunkIds: ['a', 'selected'] },
      { kind: 'extra', hunkIds: ['orphan'] },
    ]);
  });

  it('要求が明示的に選んだ逸脱も call の読む順に含める', () => {
    const hunks = [hunk('core'), hunk('dev', { group }), hunk('rep', { group })];
    const symbols: Symbol[] = hunks.map((h) => ({ id: h.id, hunkId: h.id, path: h.path, fqName: h.id, kind: 'function', changed: true }));
    const edges: Edge[] = [{ from: 'dev', to: 'core', kind: 'call', crossesLayers: false, provenance: 'lsp' }];
    expect(buildChapters({ specs: [spec('s1', ['core', 'dev'])], hunks, symbols, edges, layers: [] })).toEqual([
      { kind: 'spec', specId: 's1', hunkIds: ['dev', 'core'] },
      { kind: 'follow', hunkIds: ['rep'] },
    ]);
  });

  it('辺に乗らない差分はシンボルの有無によらず hunk 順に残す', () => {
    const symbols: Symbol[] = [{ id: 'b', hunkId: 'b', path: 'b.kt', fqName: 'b', kind: 'function', changed: true }];
    expect(buildChapters({ specs: [spec('s1', ['b', 'a'])], hunks: [hunk('a'), hunk('b')], symbols, edges: [], layers: [] })).toEqual([
      { kind: 'spec', specId: 's1', hunkIds: ['a', 'b'] },
    ]);
  });

  it('要求なしなら追従と extra で全差分を読む。空の follow / extra は作らない', () => {
    expect(run([], [hunk('a')])).toEqual([{ kind: 'extra', hunkIds: ['a'] }]);
    expect(run([spec('s1', ['a'])], [hunk('a')])).toEqual([{ kind: 'spec', specId: 's1', hunkIds: ['a'] }]);
    expect(run([], [])).toEqual([]);
  });

  it('call の幅優先・呼ぶ行・層・元の hunk 順で並べ、要求外の呼び先は章に混ぜない', () => {
    const ids = ['loose', 'late', 'early', 'entry', 'outside'];
    const symbols: Symbol[] = ids.map((id) => ({ id, hunkId: id, path: `${id}.kt`, fqName: id, kind: 'function', changed: true, layer: id === 'late' ? 'first' : 'last', layerProvenance: 'config' }));
    const edges: Edge[] = ['late', 'early', 'outside'].map((to, i) => ({ from: 'entry', to, kind: 'call', lines: [i === 0 ? 20 : 10], crossesLayers: false, provenance: 'lsp' }));
    expect(buildChapters({ specs: [spec('s1', ids.slice(0, 4))], hunks: ids.map((id) => hunk(id)), symbols, edges, layers: [{ name: 'first' }, { name: 'last' }] })).toEqual([
      { kind: 'spec', specId: 's1', hunkIds: ['entry', 'early', 'late', 'loose'] },
      { kind: 'extra', hunkIds: ['outside'] },
    ]);
  });
});

describe('buildChapters（fixture）', () => {
  const read = <T,>(name: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, `expected/${name}.json`), 'utf8')) as T;
  it('要求・追従・その他の章を組み、全差分を含む', async () => {
    const analysis = fixtureAnalysis({ files: false });
    const { specs } = read<{ specs: Spec[] }>('specs');
    const config = read<{ layers: string[] }>('llm-input');
    const chapters = buildChapters({ ...analysis, specs, layers: config.layers.map((name) => ({ name })) });
    const paths = (kind: 'follow' | 'extra') => chapters.filter((c) => c.kind === kind).flatMap((c) => c.hunkIds).map((id) => analysis.hunks.find((h) => h.id === id)!.path);
    expect(chapters.find((c) => c.kind === 'spec' && c.specId === specs.find((s) => s.text.includes('期限切れ'))!.id)?.hunkIds).toEqual([]);
    expect(paths('follow')).toHaveLength(22);
    expect(paths('extra')).toEqual(expect.arrayContaining([
      'src/main/kotlin/com/example/common/Logger.kt',
      'src/main/kotlin/com/example/config/FeatureFlags.kt',
      'src/main/kotlin/com/example/promo/PromoService.kt',
    ]));
    expect(new Set(chapters.flatMap((c) => c.hunkIds))).toEqual(new Set(analysis.hunks.map((h) => h.id)));
    await expect(JSON.stringify(chapters, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/chapters.json'));
  });
});
