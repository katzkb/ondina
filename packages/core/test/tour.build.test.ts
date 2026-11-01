// How ごとの読む順番（Tour）をプログラムが辺を辿って組む（設計書 3.3 / 10.2。2026-09-24 決定: LLM に経路を書かせない）。
import { describe, expect, it } from 'vitest';
import type { Edge, How, Hunk, RippleGroup, Symbol as OndinaSymbol } from '@ondina/model';
import { buildTours } from '../src/tour/build.js';

const LAYERS = [{ name: 'Tests' }, { name: 'API' }, { name: 'Application' }, { name: 'Domain' }, { name: 'Infrastructure' }];

function sym(id: string, fqName: string, layer: string | undefined, changed = true): OndinaSymbol {
  return { id, fqName, path: `src/${id}.kt`, ...(layer === undefined ? {} : { layer, layerProvenance: 'config' as const }), kind: 'function', changed, ...(changed ? { hunkId: id } : {}) };
}
function hunk(id: string, hows: number[], over: Partial<Hunk> = {}): Hunk {
  return { id, path: `src/${id}.kt`, lang: 'kotlin', symbol: id, symbolFqName: id, symbolKind: 'function', kind: 'none', kindProvenance: 'ast', hows, n: 1, lnOld: 1, lnNew: 1, lines: [], ...over };
}
function edge(from: string, to: string, kind: Edge['kind'] = 'call', types?: Edge['types']): Edge {
  return { from, to, kind, ...(types === undefined ? {} : { types }), crossesLayers: false, provenance: 'lsp' };
}
const how = (id: number): How => ({ id, title: `How ${id}`, why: '', specIds: [] });

const apply = sym('apply', 'com.example.api.OrderController.apply', 'API');
const execute = sym('execute', 'com.example.app.ApplyDiscountUseCase.execute', 'Application');
const applyDiscount = sym('applyDiscount', 'com.example.domain.Order.applyDiscount', 'Domain');
const rateFor = sym('rateFor', 'com.example.domain.DiscountPolicy.rateFor', 'Domain', false);
const save = sym('save', 'com.example.infra.OrderRepositoryImpl.save', 'Infrastructure');
const migration = sym('migration', 'db/V421__discount.sql', 'Infrastructure');
const command = sym('command', 'com.example.domain.DiscountCommand', 'Domain');

describe('buildTours', () => {
  // 2026-10-11: 回る場所は差分だけ（差分が責任の単位。差分の無い関連は関係が分かれば十分）。
  // 差分の無い呼ばれる側（rateFor）は停留所にしない。地図の「差分なし n か所」と引き出しが受け持つ
  it('How の hunk から call の辺だけを辿り、呼ぶ側から呼ばれる側へ並べる。呼ばれ方は辺の型ラベルから。差分の無い相手は停留所にしない', () => {
    const tours = buildTours({
      hows: [how(5)],
      hunks: [hunk('execute', [5]), hunk('save', [5])],
      symbols: [execute, save, rateFor, applyDiscount],
      edges: [edge('execute', 'save', 'call', { in: 'Order' }), edge('execute', 'rateFor', 'call', { in: 'String', out: 'Rate' })],
      layers: LAYERS,
    });
    expect(tours).toEqual([
      {
        howId: 5,
        steps: [
          { symbolId: 'execute', hunkId: 'execute', call: '' },
          { symbolId: 'save', hunkId: 'save', call: 'ApplyDiscountUseCase.execute → OrderRepositoryImpl.save(Order)' },
        ],
      },
    ]);
  });

  it('差分の無い相手だけを呼ぶ種も始点になる（並びは差分の無い相手を含めて決め、停留所からだけ外す）', () => {
    const tours = buildTours({
      hows: [how(3)],
      hunks: [hunk('command', [3]), hunk('applyDiscount', [3])],
      symbols: [command, applyDiscount, rateFor],
      edges: [edge('applyDiscount', 'rateFor')],
      layers: LAYERS,
    });
    expect(tours[0]!.steps.map((s) => s.symbolId)).toEqual(['applyDiscount', 'command']);
  });

  it('始点は他の hunk から呼ばれていないもの。層の順（設定の並び）で安定させる', () => {
    const tours = buildTours({
      hows: [how(1)],
      hunks: [hunk('applyDiscount', [1]), hunk('apply', [1]), hunk('execute', [1])],
      symbols: [applyDiscount, apply, execute],
      edges: [edge('execute', 'applyDiscount'), edge('apply', 'execute')],
      layers: LAYERS,
    });
    expect(tours[0]!.steps.map((s) => s.symbolId)).toEqual(['apply', 'execute', 'applyDiscount']);
  });

  // 2026-10-22: 読む前の案内の「読む順」は、呼ぶ側のコードを上から読む順（見本を比べて案 1 にした。execute → find → applyDiscount → save）
  describe('呼ばれる側の並び', () => {
    const find = sym('find', 'com.example.infra.OrderRepositoryImpl.find', 'Infrastructure');
    const withLines = (e: Edge, lines: number[]): Edge => ({ ...e, lines });

    it('呼ぶ側で呼んでいる行が早い順（層の順より先）', () => {
      const tours = buildTours({
        hows: [how(5)],
        hunks: [hunk('execute', [5]), hunk('find', [5]), hunk('applyDiscount', [5]), hunk('save', [5])],
        symbols: [execute, find, applyDiscount, save],
        edges: [withLines(edge('execute', 'save'), [18]), withLines(edge('execute', 'applyDiscount'), [17]), withLines(edge('execute', 'find'), [16])],
        layers: LAYERS,
      });
      expect(tours[0]!.steps.map((s) => s.symbolId)).toEqual(['execute', 'find', 'applyDiscount', 'save']);
    });

    it('何か所かで呼ぶなら最初の行で並べる', () => {
      const tours = buildTours({
        hows: [how(5)],
        hunks: [hunk('execute', [5]), hunk('find', [5]), hunk('save', [5])],
        symbols: [execute, find, save],
        edges: [withLines(edge('execute', 'find'), [16, 30]), withLines(edge('execute', 'save'), [20])],
        layers: LAYERS,
      });
      expect(tours[0]!.steps.map((s) => s.symbolId)).toEqual(['execute', 'find', 'save']);
    });

    it('行の無い辺（位置の無い記録・古い解析）は、行のある辺の後ろに今までの順（層の順 → 名前）で', () => {
      const tours = buildTours({
        hows: [how(5)],
        hunks: [hunk('execute', [5]), hunk('find', [5]), hunk('applyDiscount', [5]), hunk('save', [5])],
        symbols: [execute, find, applyDiscount, save],
        edges: [edge('execute', 'save'), withLines(edge('execute', 'find'), [16]), edge('execute', 'applyDiscount')],
        layers: LAYERS,
      });
      expect(tours[0]!.steps.map((s) => s.symbolId)).toEqual(['execute', 'find', 'applyDiscount', 'save']);
    });
  });

  it('参照とテストの辺は辿らない', () => {
    const tours = buildTours({
      hows: [how(1)],
      hunks: [hunk('execute', [1])],
      symbols: [execute, command, save],
      edges: [edge('execute', 'command', 'reference'), edge('save', 'execute', 'test')],
      layers: LAYERS,
    });
    expect(tours[0]!.steps.map((s) => s.symbolId)).toEqual(['execute']);
  });

  it('辺に乗らない hunk は、経路の後ろに hunk の並び順で 1 件ずつ足す（辺 0 本の How はこれだけになる）', () => {
    const tours = buildTours({
      hows: [how(1), how(2)],
      hunks: [hunk('migration', [1]), hunk('command', [2]), hunk('execute', [2]), hunk('save', [2])],
      symbols: [migration, command, execute, save],
      edges: [edge('execute', 'save')],
      layers: LAYERS,
    });
    expect(tours).toEqual([
      { howId: 1, steps: [{ symbolId: 'migration', hunkId: 'migration', call: '' }] },
      {
        howId: 2,
        steps: [
          { symbolId: 'execute', hunkId: 'execute', call: '' },
          { symbolId: 'save', hunkId: 'save', call: 'ApplyDiscountUseCase.execute → OrderRepositoryImpl.save' },
          { symbolId: 'command', hunkId: 'command', call: '' },
        ],
      },
    ]);
  });

  it('追従グループの残りのメンバーは代表 1 件だけにする（B の画面で 1 件ずつ見る）', () => {
    const group: RippleGroup = { pattern: 'a → b', derivedFrom: { coreHunkId: 'applyDiscount', removed: ['a'], added: ['b'] }, uniform: 'ast', representative: 'r1', members: ['r1', 'r2', 'r3'], deviations: [], distance: {}, near: [] };
    const tours = buildTours({
      hows: [how(3)],
      hunks: [hunk('applyDiscount', [3]), hunk('r1', [3], { kind: 'ripple', group }), hunk('r2', [3], { kind: 'ripple', group }), hunk('r3', [3], { kind: 'ripple', group })],
      symbols: [applyDiscount, sym('r1', 'x.R1.f', undefined), sym('r2', 'x.R2.f', undefined), sym('r3', 'x.R3.f', undefined)],
      edges: [],
      layers: LAYERS,
    });
    expect(tours[0]!.steps.map((s) => s.symbolId)).toEqual(['applyDiscount', 'r1']);
  });

  it('追従グループの残りのメンバーは、呼び出し辺を持っていても始点にならない（束は代表 1 件だけ）', () => {
    const group: RippleGroup = { pattern: 'a → b', derivedFrom: { coreHunkId: 'applyDiscount', removed: ['a'], added: ['b'] }, uniform: 'ast', representative: 'r1', members: ['r1', 'r2'], deviations: [], distance: {}, near: [] };
    const tours = buildTours({
      hows: [how(3)],
      hunks: [hunk('applyDiscount', [3]), hunk('r1', [3], { kind: 'ripple', group }), hunk('r2', [3], { kind: 'ripple', group })],
      symbols: [applyDiscount, sym('r1', 'x.R1.f', undefined), sym('r2', 'x.R2.f', undefined), save],
      // r2（代表ではないメンバー）が save を呼んでいる
      edges: [edge('r2', 'save')],
      layers: LAYERS,
    });
    expect(tours[0]!.steps.map((s) => s.symbolId)).toEqual(['applyDiscount', 'r1']);
  });

  it('追従グループの残りのメンバーは、呼ばれる側でもステップにならない（束は代表 1 件だけ）', () => {
    const group: RippleGroup = { pattern: 'a → b', derivedFrom: { coreHunkId: 'applyDiscount', removed: ['a'], added: ['b'] }, uniform: 'ast', representative: 'r1', members: ['r1', 'r2'], deviations: [], distance: {}, near: [] };
    const tours = buildTours({
      hows: [how(3)],
      hunks: [hunk('applyDiscount', [3]), hunk('r1', [3], { kind: 'ripple', group }), hunk('r2', [3], { kind: 'ripple', group })],
      symbols: [applyDiscount, sym('r1', 'x.R1.f', undefined), sym('r2', 'x.R2.f', undefined)],
      // applyDiscount が r2（代表ではないメンバー）を呼んでいる
      edges: [edge('applyDiscount', 'r2')],
      layers: LAYERS,
    });
    expect(tours[0]!.steps.map((s) => s.symbolId)).toEqual(['applyDiscount', 'r1']);
  });

  it('同じ入力なら並びを変えても同じ出力（原則 7）', () => {
    const args = {
      hows: [how(1)],
      hunks: [hunk('apply', [1]), hunk('execute', [1]), hunk('save', [1])],
      symbols: [apply, execute, save, rateFor],
      edges: [edge('apply', 'execute'), edge('execute', 'save'), edge('execute', 'rateFor')],
      layers: LAYERS,
    };
    const a = buildTours(args);
    const b = buildTours({ ...args, symbols: [...args.symbols].reverse(), edges: [...args.edges].reverse() });
    expect(b).toEqual(a);
    expect(a[0]!.steps.map((s) => s.symbolId)).toEqual(['apply', 'execute', 'save']);
  });

  it('hunk が 1 つも無い How は steps が空', () => {
    expect(buildTours({ hows: [how(9)], hunks: [], symbols: [], edges: [], layers: LAYERS })).toEqual([{ howId: 9, steps: [] }]);
  });
});
