// 基準リクエストの対象選び（設計書 9.1 の 3 段目）。同じ headSha で同じ対象になること（原則 7）と、
// documentSymbol の実測の形（name は識別子だけ、関数は kind 6、クラスと同名のコンストラクタが kind 9 で混ざる）を固定する。
import { describe, expect, it } from 'vitest';
import type { Hunk } from '@ondina/model';
import { chooseProbeTargets, findDeclarationPosition, findProbePosition, symbolName, type DocumentSymbol } from '../src/lsp/targets.js';

const hunk = (id: string, path: string, symbolFqName: string, symbolKind: Hunk['symbolKind'], kind: Hunk['kind'] = 'none'): Hunk => ({
  id,
  path,
  lang: 'kotlin',
  symbol: symbolFqName.slice(symbolFqName.lastIndexOf('.') + 1),
  symbolFqName,
  symbolKind,
  kind,
  kindProvenance: 'ast',
  hows: [],
  n: 1,
  lnOld: 1,
  lnNew: 1,
  lines: [],
});

describe('symbolName', () => {
  it('FQ 名の最後の区切りから後ろを取る', () => {
    expect(symbolName('com.example.order.domain.Order.applyDiscount')).toBe('applyDiscount');
  });
  it('オーバーロードの #2 は落とす（5.2 の 1）', () => {
    expect(symbolName('com.example.order.domain.Order.total#2')).toBe('total');
  });
  it('区切りが無ければそのまま', () => {
    expect(symbolName('main')).toBe('main');
  });
  it('バッククォート名のテスト関数はバッククォートを外す（documentSymbol が外した形で返すため。2026-09-22 実測）', () => {
    expect(symbolName('com.example.order.infra.OrderRepositoryImplTest.`persists discount`')).toBe('persists discount');
  });
  it('バッククォート名の中に . が入っていても壊れない', () => {
    expect(symbolName('a.OrderTest.`keeps the total. really`')).toBe('keeps the total. really');
  });
});

describe('chooseProbeTargets', () => {
  const hunks = [
    hunk('r1', 'a/Ripple1.kt', 'a.Ripple1.discountColumn', 'function', 'ripple'),
    hunk('r2', 'a/Ripple2.kt', 'a.Ripple2.settledDiscount', 'function', 'ripple'),
    hunk('n1', 'a/Plain.kt', 'a.Plain.helper', 'function', 'none'),
    hunk('t1', 'a/OrderTest.kt', 'a.OrderTest.applies', 'function', 'test'),
    hunk('c1', 'a/Order.kt', 'a.Order', 'class', 'core'),
    hunk('f1', 'a/Order.kt', 'a/Order.kt', 'file', 'none'),
  ];

  it('核 → テスト → 未帰属 → 追従 の順に選ぶ（追従は呼び出し辺を持たないことが多い）', () => {
    expect(chooseProbeTargets(hunks)).toEqual([
      { path: 'a/Order.kt', name: 'Order', hunkId: 'c1' },
      { path: 'a/OrderTest.kt', name: 'applies', hunkId: 't1' },
      { path: 'a/Plain.kt', name: 'helper', hunkId: 'n1' },
    ]);
  });

  it('ファイル hunk は宣言ではないので選ばない', () => {
    expect(chooseProbeTargets(hunks).some((t) => t.hunkId === 'f1')).toBe(false);
  });

  it('同じ種別の中は id の昇順。入力の並びを変えても同じ結果（原則 7）', () => {
    const ripples = [hunk('b', 'a/B.kt', 'a.B.x', 'function', 'ripple'), hunk('a', 'a/A.kt', 'a.A.x', 'function', 'ripple')];
    expect(chooseProbeTargets(ripples).map((t) => t.hunkId)).toEqual(['a', 'b']);
    expect(chooseProbeTargets([...hunks].reverse())).toEqual(chooseProbeTargets(hunks));
  });

  it('入力を壊さない', () => {
    const before = hunks.map((h) => h.id);
    chooseProbeTargets(hunks);
    expect(hunks.map((h) => h.id)).toEqual(before);
  });

  it('宣言の hunk が無ければ空', () => {
    expect(chooseProbeTargets([hunk('f', 'a/X.kt', 'a/X.kt', 'file')])).toEqual([]);
  });

  it('上限を渡せる', () => {
    expect(chooseProbeTargets(hunks, 1)).toEqual([{ path: 'a/Order.kt', name: 'Order', hunkId: 'c1' }]);
  });
});

describe('findProbePosition', () => {
  // 2026-09-21 に kotlin-lsp から実際に返ってきた形（fixtures/order-service の Order.kt）
  const order: DocumentSymbol[] = [
    {
      name: 'Order',
      kind: 5,
      selectionRange: { start: { line: 2, character: 6 } },
      children: [
        { name: 'id', kind: 13, selectionRange: { start: { line: 3, character: 8 } } },
        { name: 'discount', kind: 13, selectionRange: { start: { line: 5, character: 8 } } },
        { name: 'Order', kind: 9, selectionRange: { start: { line: 2, character: 11 } } },
        { name: 'applyDiscount', kind: 6, selectionRange: { start: { line: 7, character: 8 } } },
        { name: 'total', kind: 6, selectionRange: { start: { line: 12, character: 8 } } },
      ],
    },
  ];

  it('入れ子の中の関数の宣言名の位置を返す', () => {
    expect(findProbePosition(order, 'applyDiscount')).toEqual({ line: 7, character: 8 });
  });

  it('クラスに当たったら中の最初の関数に降りる（核 hunk はクラス全体になることがある）', () => {
    // プロパティ（13）もコンストラクタ（9）も飛ばして applyDiscount（6）を選ぶ
    expect(findProbePosition(order, 'Order')).toEqual({ line: 7, character: 8 });
  });

  it('プロパティに当たって中に関数が無ければ undefined', () => {
    expect(findProbePosition(order, 'discount')).toBeUndefined();
  });

  it('トップレベル関数（kind 12）も拾う', () => {
    expect(findProbePosition([{ name: 'main', kind: 12, selectionRange: { start: { line: 0, character: 4 } } }], 'main')).toEqual({ line: 0, character: 4 });
  });

  it('名前が無ければ undefined', () => {
    expect(findProbePosition(order, 'いない')).toBeUndefined();
  });

  it('関数が 1 つも無いクラスは undefined', () => {
    const empty: DocumentSymbol[] = [{ name: 'Empty', kind: 5, selectionRange: { start: { line: 0, character: 6 } }, children: [{ name: 'x', kind: 13, selectionRange: { start: { line: 1, character: 8 } } }] }];
    expect(findProbePosition(empty, 'Empty')).toBeUndefined();
  });

  it('同じ名前が入れ子の内側にもあるときは浅いほうを選ぶ', () => {
    // 先に並んでいるクラスの中の helper より、トップレベルの helper が当たり（基準シンボルは hunk の宣言そのもの）
    const tree: DocumentSymbol[] = [
      {
        name: 'Outer',
        kind: 5,
        selectionRange: { start: { line: 0, character: 6 } },
        children: [{ name: 'helper', kind: 6, selectionRange: { start: { line: 1, character: 8 } } }],
      },
      { name: 'helper', kind: 6, selectionRange: { start: { line: 5, character: 4 } } },
    ];
    expect(findProbePosition(tree, 'helper')).toEqual({ line: 5, character: 4 });
  });
});

describe('findDeclarationPosition（参照検索の基準。宣言そのものの位置）', () => {
  const order: DocumentSymbol[] = [
    {
      name: 'Order',
      kind: 5,
      selectionRange: { start: { line: 2, character: 6 } },
      children: [
        { name: 'discount', kind: 13, selectionRange: { start: { line: 5, character: 8 } } },
        { name: 'applyDiscount', kind: 6, selectionRange: { start: { line: 7, character: 8 } } },
      ],
    },
  ];

  it('プロパティは自分の位置を返す（findProbePosition は undefined になる）', () => {
    expect(findDeclarationPosition(order, 'discount')).toEqual({ line: 5, character: 8 });
  });

  it('クラスは中の関数に降りず自分の位置を返す（クラスへの参照を数えるため）', () => {
    expect(findDeclarationPosition(order, 'Order')).toEqual({ line: 2, character: 6 });
  });

  it('無ければ undefined', () => {
    expect(findDeclarationPosition(order, 'missing')).toBeUndefined();
  });
});
