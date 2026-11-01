// 差分の列の中の検索（2026-10-27。diff/find.ts）。画面の外の行と帯に畳んだ行は DOM に無いので、畳む前の行列から探す
import type { Hunk } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { cellsOf, curIndex, findHits, marksByRow, splitMarks } from '../src/diff/find.js';
import { buildFileRows, buildRows } from '../src/diff/rows.js';
import { fixtureHunks } from './fixture.js';

const hunk = (): Hunk => {
  const h: Hunk = { ...fixtureHunks()[0]!, id: 'h1', symbol: 'Order.total', lnOld: 1, lnNew: 1, lines: [' val a = 1', '-val Total = a', '+val total = a + 1'] };
  delete h.tokens;
  return h;
};

describe('findHits', () => {
  it('ファイルの見出し・hunk の見出し・コードの行を上から順に、大文字と小文字を区別せずに探す', () => {
    const rows = buildRows([hunk()], 'uni', true);
    const hits = findHits(rows, 'total');
    expect(hits.map((h) => [h.row.kind, h.cell, h.from])).toEqual([
      ['header', 'head', 6],
      ['uni', 'code', 4],
      ['uni', 'code', 4],
    ]);
    const name = hunk().path.split('/').pop()!.toUpperCase();
    expect(findHits(rows, name).map((h) => h.cell)).toEqual(['path']);
  });

  it('左右では消した行は left、足した行は right（同じ段の両側を別々に数える）', () => {
    const hits = findHits(buildRows([hunk()], 'sbs'), 'a');
    const sides = hits.filter((h) => h.row.kind === 'sbs').map((h) => h.cell);
    // 変わらない行は両側（a が 2 か所ずつ）、val Total = a は左に 3 か所、val total = a + 1 は右に 3 か所
    expect(sides).toEqual(['left', 'left', 'right', 'right', 'left', 'left', 'left', 'right', 'right', 'right']);
  });

  it('1 行に何か所あっても全部。空の問いは何も探さない', () => {
    const rows = buildRows([hunk()], 'uni');
    expect(findHits(rows, 'a').filter((h) => h.row.kind === 'uni' && h.row.i === 0).map((h) => h.from)).toEqual([1, 4]);
    expect(findHits(rows, '')).toEqual([]);
  });

  it('hunk の外の行（目的ごとの画面のプレビュー）も探す。文字は head の全文のトークン', () => {
    const h = { ...hunk(), lnNew: 3, lnOld: 3 };
    const file = { path: h.path, tokens: [[['package x', null, 0]], [['import y', null, 0]], [['val a = 1', null, 0]]] } as never;
    const rows = buildFileRows(file, [h], 'uni');
    expect(cellsOf(rows[0]!)).toEqual([{ cell: 'code', text: 'package x' }]);
    expect(findHits(rows, 'import').map((x) => x.row.kind)).toEqual(['ctx']);
  });
});

describe('curIndex', () => {
  it('次へ・前へで増減した at を件数で回す。0 件は -1', () => {
    expect(curIndex(0, 3)).toBe(0);
    expect(curIndex(3, 3)).toBe(0);
    expect(curIndex(-1, 3)).toBe(2);
    expect(curIndex(5, 0)).toBe(-1);
  });
});

describe('marksByRow / splitMarks', () => {
  it('行と場所ごとに印をまとめ、今の 1 件に cur', () => {
    const rows = buildRows([hunk()], 'uni');
    const hits = findHits(rows, 'a');
    // 0 件目は hunk の見出し（Order.total）
    const m = marksByRow(hits, 2);
    expect(m.get(rows[1]!)?.code).toEqual([
      { from: 1, to: 2, cur: false },
      { from: 4, to: 5, cur: true },
    ]);
  });

  it('トークンを印の境目で切り、役割の色は保つ', () => {
    const pieces = splitMarks(
      [
        ['val', 'mauve', 0],
        [' total', null, 0],
      ],
      [{ from: 2, to: 6, cur: true }],
    );
    expect(pieces.map((p) => [p.text, p.role, p.mark !== null])).toEqual([
      ['va', 'mauve', false],
      ['l', 'mauve', true],
      [' to', null, true],
      ['tal', null, false],
    ]);
  });
});
