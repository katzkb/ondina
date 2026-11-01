// Analysis.symbols の組み立て（設計書 4 章 / 5.2 の 4）。M1 は変更された hunk と 1 対 1。
// 経路上の未変更シンボル（changed: false）と testCount は LSP が要るので M2。
import { describe, expect, it } from 'vitest';
import type { Hunk } from '@ondina/model';
import { hunkId } from '../src/hunks/stable-id.js';
import { buildSymbols } from '../src/symbols/build.js';

const DOMAIN = { name: 'Domain', match: ['**/domain/**'] };
const TESTS = { name: 'Tests', match: ['src/test/**'] };

function hunk(path: string, fqName: string, over: Partial<Hunk> = {}): Hunk {
  return {
    id: hunkId(path, fqName),
    path,
    lang: 'kotlin',
    symbol: fqName.split('.').pop()!,
    symbolFqName: fqName,
    symbolKind: 'function',
    kind: 'none',
    kindProvenance: 'ast',
    hows: [],
    n: 1,
    lnOld: 1,
    lnNew: 1,
    lines: [],
    ...over,
  };
}

const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
const ADMIN = 'src/main/kotlin/com/example/admin/OrderAdminView.kt';

describe('buildSymbols', () => {
  it('hunk 1 件につきシンボル 1 件で、欄は hunk から写す', () => {
    const h = hunk(ORDER, 'com.example.order.domain.Order', { symbolKind: 'class' });
    expect(buildSymbols([h], [DOMAIN])).toEqual([
      {
        id: h.id,
        fqName: 'com.example.order.domain.Order',
        path: ORDER,
        layer: 'Domain',
        layerProvenance: 'config',
        kind: 'class',
        changed: true,
        hunkId: h.id,
      },
    ]);
  });

  it('id は hunk と同じ式 sha1(path + "#" + fqName) で、hunk.id と一致する', () => {
    const h = hunk(ORDER, 'com.example.order.domain.Order.applyDiscount');
    const [s] = buildSymbols([h], []);
    expect(s!.id).toBe(hunkId(ORDER, 'com.example.order.domain.Order.applyDiscount'));
    expect(s!.id).toBe(h.id);
  });

  it('どの層にも当たらなければ layer も layerProvenance も欄ごと無い', () => {
    const [s] = buildSymbols([hunk(ADMIN, 'com.example.admin.OrderAdminView.discountField')], [DOMAIN, TESTS]);
    expect(s).not.toHaveProperty('layer');
    expect(s).not.toHaveProperty('layerProvenance');
  });

  it('構成の推定から組んだ層は layerProvenance: llm（原則 2。設計書 10.6）', () => {
    const [s] = buildSymbols([hunk(ORDER, 'com.example.order.domain.Order')], [DOMAIN], 'llm');
    expect(s).toMatchObject({ layer: 'Domain', layerProvenance: 'llm' });
  });

  it('testCount は M1 では入れない（未計測。0 件と混ぜない）', () => {
    const [s] = buildSymbols([hunk(ORDER, 'com.example.order.domain.Order')], [DOMAIN]);
    expect(s).not.toHaveProperty('testCount');
  });

  it('層の割当は上から順で、最初に当たった層が勝つ', () => {
    const t = 'src/test/kotlin/com/example/order/domain/OrderTest.kt';
    const h = hunk(t, 'com.example.order.domain.OrderTest.appliesTheRate');
    expect(buildSymbols([h], [TESTS, DOMAIN])[0]?.layer).toBe('Tests');
    expect(buildSymbols([h], [DOMAIN, TESTS])[0]?.layer).toBe('Domain');
  });

  it('ファイル hunk もシンボルになる（fqName はパス、kind は file）', () => {
    const [s] = buildSymbols([hunk(ADMIN, ADMIN, { symbolKind: 'file', symbol: 'OrderAdminView.kt' })], []);
    expect(s).toMatchObject({ fqName: ADMIN, path: ADMIN, kind: 'file', changed: true });
  });

  it('並びは hunks と同じで、id は重複しない', () => {
    const hs = [hunk(ORDER, 'com.example.order.domain.Order'), hunk(ADMIN, 'com.example.admin.OrderAdminView'), hunk(ORDER, 'com.example.order.domain.Order.applyDiscount')];
    const symbols = buildSymbols(hs, [DOMAIN]);
    expect(symbols.map((s) => s.id)).toEqual(hs.map((h) => h.id));
    expect(new Set(symbols.map((s) => s.id)).size).toBe(3);
  });

  it('hunks が空なら空', () => {
    expect(buildSymbols([], [DOMAIN])).toEqual([]);
  });
});
