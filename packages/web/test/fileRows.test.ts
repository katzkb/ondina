// 停留所の画面（3.3）のコード: ファイル全体に差分を埋め込み、見ている場所の前後 3 行以外を畳む。
import type { Hunk, TokenLine } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { fileRows, foldRows, splitRows, type FileRow, type SplitRow } from '../src/diff/fileRows.js';

const plain = (lines: string[]): TokenLine[] => lines.map((l) => [[l, null, 0]]);
const text = (r: FileRow) => r.tokens.map(([t]) => t).join('');

function hunk(id: string, lnOld: number, lnNew: number, lines: string[]): Hunk {
  return { id, path: 'A.kt', lang: 'kotlin', symbol: id, symbolFqName: id, symbolKind: 'function', kind: 'core', kindProvenance: 'ast', hows: [1], n: 1, lnOld, lnNew, lines };
}

// head: 1..12 行。hunk h1 は 4 行目の置き換え（旧 4 行目 old4 → 新 4 行目 new4）、h2 は 10 行目の後に 1 行追加（新 11 行目）
const head = ['l1', 'l2', 'l3', 'new4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'add11', 'l12'];
const h1 = hunk('h1', 4, 4, ['-old4', '+new4']);
const h2 = hunk('h2', 10, 10, [' l10', '+add11']);

describe('fileRows', () => {
  const rows = fileRows(plain(head), [h2, h1], 'h1', null);

  it('head の行に差分を埋め込む。削除行は旧の番号だけ、追加行は新の番号だけ', () => {
    expect(rows.map((r) => `${r.kind}:${r.old ?? ''}:${r.new ?? ''}:${text(r)}`)).toEqual([
      'ctx:1:1:l1',
      'ctx:2:2:l2',
      'ctx:3:3:l3',
      'del:4::old4',
      'add::4:new4',
      'ctx:5:5:l5',
      'ctx:6:6:l6',
      'ctx:7:7:l7',
      'ctx:8:8:l8',
      'ctx:9:9:l9',
      'ctx:10:10:l10',
      'add::11:add11',
      'ctx:11:12:l12',
    ]);
  });

  it('開いた行の記録の key: hunk の行は hunk の id と lines の位置、hunk の外の行は head 側の行番号（差分一覧と同じ key）', () => {
    expect(rows.map((r) => r.key)).toEqual(['n1', 'n2', 'n3', 'h1:0', 'h1:1', 'n5', 'n6', 'n7', 'n8', 'n9', 'h2:0', 'h2:1', 'n12']);
  });

  it('今の hunk の行だけが focus。他の hunk の行は hunkId で分かる', () => {
    expect(rows.filter((r) => r.focus).map(text)).toEqual(['old4', 'new4']);
    expect(rows.filter((r) => r.hunkId === 'h2').map(text)).toEqual(['l10', 'add11']);
  });

  it('差分の無い停留所は中心の行（宣言と呼ぶ行）が focus', () => {
    const r = fileRows(plain(['a', 'b', 'c']), [], null, [2]);
    expect(r.map((x) => [text(x), x.focus, x.center])).toEqual([
      ['a', false, false],
      ['b', true, true],
      ['c', false, false],
    ]);
  });

  it('中心の行が同じファイルの別の hunk の文脈行（\' \'）に重なっても focus になる（「位置なし」にしない）', () => {
    // h2 の 1 行目は head の 10 行目 l10 の文脈行
    const r = fileRows(plain(head), [h1, h2], null, [10]);
    expect(r.filter((x) => x.focus).map((x) => [text(x), x.center, x.hunkId])).toEqual([['l10', true, 'h2']]);
  });

  it('hunk にトークンがあればそれを使う', () => {
    const colored = { ...h1, tokens: [[['old4', 'red', 0]], [['new4', 'green', 0]]] as TokenLine[] };
    const r = fileRows(plain(head), [colored], 'h1', null);
    expect(r.find((x) => x.kind === 'del')!.tokens).toEqual([['old4', 'red', 0]]);
  });
});

describe('foldRows', () => {
  const rows = fileRows(plain(head), [h1, h2], 'h1', null);

  it('focus の前後 3 行を残し、上下を畳んだ行数で返す', () => {
    const f = foldRows(rows, false);
    expect(f.above).toBe(0);
    expect(f.rows.map(text)).toEqual(['l1', 'l2', 'l3', 'old4', 'new4', 'l5', 'l6', 'l7']);
    expect(f.below).toBe(rows.length - 8);
  });

  it('全体表示なら畳まない', () => {
    expect(foldRows(rows, true)).toEqual({ above: 0, rows, below: 0 });
  });

  it('focus が無ければ全部出す', () => {
    const none = fileRows(plain(head), [h1], null, null);
    expect(foldRows(none, false).rows).toHaveLength(none.length);
  });
});

describe('splitRows（左右表示）', () => {
  const rows = fileRows(plain(head), [h1, h2], 'h1', null);
  const side = (x: SplitRow['o']) => (x ? `${x.order}:${x.row.kind}:${text(x.row)}` : '-');
  const show = (r: SplitRow[]) => r.map((x) => `${side(x.o)} | ${side(x.n)}`);

  it('変わらない行は両側に同じ行、続く消した行と足した行は段ごとに対、余った側は null。order は行の並び', () => {
    expect(show(splitRows(rows))).toEqual([
      '0:ctx:l1 | 0:ctx:l1',
      '1:ctx:l2 | 1:ctx:l2',
      '2:ctx:l3 | 2:ctx:l3',
      '3:del:old4 | 4:add:new4',
      '5:ctx:l5 | 5:ctx:l5',
      '6:ctx:l6 | 6:ctx:l6',
      '7:ctx:l7 | 7:ctx:l7',
      '8:ctx:l8 | 8:ctx:l8',
      '9:ctx:l9 | 9:ctx:l9',
      '10:ctx:l10 | 10:ctx:l10',
      '- | 11:add:add11',
      '12:ctx:l12 | 12:ctx:l12',
    ]);
  });

  it('畳んだ後の行には、畳んだ行数から order を数える（統合と同じ数）', () => {
    const f = foldRows(fileRows(plain(head), [h1, h2], 'h2', null), false);
    expect(f.above).toBe(7);
    expect(show(splitRows(f.rows, f.above))).toEqual([
      '7:ctx:l7 | 7:ctx:l7',
      '8:ctx:l8 | 8:ctx:l8',
      '9:ctx:l9 | 9:ctx:l9',
      '10:ctx:l10 | 10:ctx:l10',
      '- | 11:add:add11',
      '12:ctx:l12 | 12:ctx:l12',
    ]);
  });

  it('消した行の数が多ければ、余った消した行の右は null', () => {
    const h = hunk('h', 2, 2, ['-a', '-b', '+c']);
    expect(show(splitRows(fileRows(plain(['l1', 'c', 'l3']), [h], 'h', null)))).toEqual(['0:ctx:l1 | 0:ctx:l1', '1:del:a | 3:add:c', '2:del:b | -', '4:ctx:l3 | 4:ctx:l3']);
  });

  it('別の hunk の消した行と足した行は対にしない', () => {
    // hA は 2 行目を消すだけ、hB はその直後（新 2 行目）に 1 行足すだけ
    const hA = hunk('hA', 2, 2, ['-x']);
    const hB = hunk('hB', 3, 2, ['+y']);
    expect(show(splitRows(fileRows(plain(['l1', 'y', 'l3']), [hA, hB], 'hA', null)))).toEqual(['0:ctx:l1 | 0:ctx:l1', '1:del:x | -', '- | 2:add:y', '3:ctx:l3 | 3:ctx:l3']);
  });
});

describe('fixture の全 hunk', () => {
  it('埋め込んだ後の新しい側の行は head の行と一致する（hunk の lnNew と lines が head と揃っている）', async () => {
    const { fixtureAnalysis } = await import('./fixture.js');
    const a = fixtureAnalysis();
    // 差分のあるファイルと Symbol.path のファイル 40 本と、定義の引き出しに出す差分の無いファイル 7 本（3.6）
    expect(a.files!.length).toBe(47);
    for (const f of a.files!) {
      const hs = a.hunks.filter((h) => h.path === f.path);
      const rows = fileRows(f.tokens, hs, hs[0]?.id ?? null, null);
      const newSide = rows.filter((r) => r.new !== null).map((r) => r.tokens.map(([t]) => t).join(''));
      expect(newSide, f.path).toEqual(f.tokens.map((l) => l.map(([t]) => t).join('')));
    }
  });
});
