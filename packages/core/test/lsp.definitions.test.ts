// 名前から定義へ（設計書 3.6 / 9.2）。言語サーバーの definition の答えを Analysis.defs にする規則を固定する。
// fixture の記録（fixtures/order-service/lsp/definitions.json）からの全体はゴールデン（expected/definitions.json）で見る
import { describe, expect, it } from 'vitest';
import type { Hunk } from '@ondina/model';
import { buildDefinitions, defTargetOf, diffLines, drawerFiles, filesToAsk, libName, namePositions, placeTarget, shownAt, type DefinitionSource } from '../src/lsp/definitions.js';

const hunk = (id: string, path: string, lnOld: number, lnNew: number, lines: string[]): Hunk => ({
  id,
  path,
  lang: 'kotlin',
  symbol: id,
  symbolFqName: id,
  symbolKind: 'function',
  kind: 'none',
  kindProvenance: 'ast',
  hows: [],
  n: 1,
  lnOld,
  lnNew,
  lines,
});

// base 10〜13 行 / head 10〜13 行: 10 は変わらない、11 は消した、11' と 12' は足した、12 / 13' は変わらない
const H = [hunk('h1', 'A.kt', 10, 10, [' a', '-b', '+c', '+d', ' e'])];
const ROOTS = { head: ['file:///w/lsp/head'], base: ['file:///w/lsp/base'] };

describe('namePositions', () => {
  const legend = { tokenTypes: ['class', 'keyword', 'function', 'string'], tokenModifiers: [] };
  // 0 行目: class(0,5) keyword(6,3)、2 行目: function(4,3) string(8,2)
  const data = [0, 0, 5, 0, 0, 0, 6, 3, 1, 0, 2, 4, 3, 2, 0, 0, 4, 2, 3, 0];
  it('名前でない種類（keyword・string など）は聞かない', () => {
    expect(namePositions(data, legend)).toEqual([
      { line: 0, col: 0, len: 5 },
      { line: 2, col: 4, len: 3 },
    ]);
  });
  it('keep で行を絞る（行は 0 始まり）', () => {
    expect(namePositions(data, legend, (l) => l === 2)).toEqual([{ line: 2, col: 4, len: 3 }]);
  });
});

describe('defTargetOf', () => {
  it('LocationLink は targetSelectionRange の始まり（名前の位置）。行は 1 始まりにする', () => {
    const res = [{ targetUri: 'file:///w/lsp/head/src/A.kt', targetRange: { start: { line: 2, character: 0 } }, targetSelectionRange: { start: { line: 3, character: 8 } } }];
    expect(defTargetOf(res, ROOTS)).toEqual({ side: 'head', path: 'src/A.kt', line: 4, col: 8 });
  });
  it('Location（配列でなくても）は range の始まり。base の worktree の下なら base', () => {
    expect(defTargetOf({ uri: 'file:///w/lsp/base/src/B.kt', range: { start: { line: 0, character: 4 } } }, ROOTS)).toEqual({ side: 'base', path: 'src/B.kt', line: 1, col: 4 });
  });
  it('パスの % を戻す', () => {
    expect(defTargetOf({ uri: 'file:///w/lsp/head/src/My%20File.kt', range: { start: { line: 0, character: 0 } } }, ROOTS)).toMatchObject({ path: 'src/My File.kt' });
  });
  it('worktree の実体のパス（別の書き方）の下でも見分ける', () => {
    const roots = { head: ['file:///link/head', 'file:///real/head'], base: ['file:///link/base'] };
    expect(defTargetOf({ uri: 'file:///real/head/X.kt', range: { start: { line: 0, character: 0 } } }, roots)).toMatchObject({ side: 'head', path: 'X.kt' });
  });
  it('名前が同じで前に続くだけのフォルダ（/w/lsp/headless）は head ではない', () => {
    expect(defTargetOf({ uri: 'file:///w/lsp/headless/X.kt', range: { start: { line: 0, character: 0 } } }, ROOTS)).toEqual({ lib: 'X.kt' });
  });
  it('答えが無い・空・形が違えば null', () => {
    expect(defTargetOf(null, ROOTS)).toBeNull();
    expect(defTargetOf([], ROOTS)).toBeNull();
    expect(defTargetOf([{ uri: 'file:///w/lsp/head/A.kt' }], ROOTS)).toBeNull();
  });
});

describe('libName', () => {
  it('jar の中なら jar の名前', () => {
    expect(libName('jar:///Users/u/.gradle/caches/modules-2/files-2.1/org.springframework/spring-web/6.2.0/e1b7/spring-web-6.2.0.jar!/org/springframework/web/bind/annotation/PostMapping.class')).toBe('spring-web-6.2.0.jar');
  });
  it('JDK（jrt）ならモジュール名', () => {
    expect(libName('jrt:///Users/u/kotlin-server/jbr/Contents/Home!/java.base/java/time/Instant.class')).toBe('java.base');
  });
  it('ほかはファイル名', () => {
    expect(libName('file:///opt/gen/Generated.kt')).toBe('Generated.kt');
  });
});

describe('diffLines', () => {
  it('側ごとの hunk の行。変わらない行は両側、消した行は base、足した行は head', () => {
    const d = diffLines(H);
    expect([...d.base.get('A.kt')!]).toEqual([10, 11, 12]);
    expect([...d.head.get('A.kt')!]).toEqual([10, 11, 12, 13]);
  });
});

describe('shownAt', () => {
  it('消した行は LEFT と base の行番号', () => {
    expect(shownAt(H, 'base', 'A.kt', 11)).toEqual({ hunkId: 'h1', side: 'LEFT', line: 11 });
  });
  it('足した行は RIGHT と head の行番号', () => {
    expect(shownAt(H, 'head', 'A.kt', 12)).toEqual({ hunkId: 'h1', side: 'RIGHT', line: 12 });
  });
  it('変わらない行は、base の行でも RIGHT と head の行番号（左右の右と統合の 1 行に出る）', () => {
    expect(shownAt(H, 'base', 'A.kt', 12)).toEqual({ hunkId: 'h1', side: 'RIGHT', line: 13 });
    expect(shownAt(H, 'head', 'A.kt', 10)).toEqual({ hunkId: 'h1', side: 'RIGHT', line: 10 });
  });
  it('hunk の外の行・ほかのファイルは出ない', () => {
    expect(shownAt(H, 'head', 'A.kt', 9)).toBeUndefined();
    expect(shownAt(H, 'head', 'A.kt', 14)).toBeUndefined();
    expect(shownAt(H, 'head', 'B.kt', 10)).toBeUndefined();
  });
});

describe('placeTarget', () => {
  it('base の行き先が PR で変わっていないファイルなら head の同じ場所', () => {
    expect(placeTarget({ side: 'base', path: 'Same.kt', line: 3, col: 4 }, H, new Set(['A.kt']))).toEqual({ side: 'head', path: 'Same.kt', line: 3, col: 4 });
  });
  it('変わったファイルなら base のまま。差分の列の行なら見え方を付ける', () => {
    expect(placeTarget({ side: 'base', path: 'A.kt', line: 11, col: 0 }, H, new Set(['A.kt']))).toEqual({ side: 'base', path: 'A.kt', line: 11, col: 0, shown: { hunkId: 'h1', side: 'LEFT', line: 11 } });
    expect(placeTarget({ side: 'base', path: 'A.kt', line: 2, col: 0 }, H, new Set(['A.kt']))).toEqual({ side: 'base', path: 'A.kt', line: 2, col: 0 });
  });
  it('ライブラリはそのまま', () => {
    expect(placeTarget({ lib: 'x.jar' }, H, new Set())).toEqual({ lib: 'x.jar' });
  });
});

describe('drawerFiles / filesToAsk', () => {
  const src: DefinitionSource = {
    files: [{ side: 'head', path: 'A.kt', part: true }],
    answers: [
      { side: 'head', path: 'A.kt', line: 12, col: 4, len: 3, to: { side: 'head', path: 'Repo.kt', line: 4, col: 8 } },
      { side: 'head', path: 'A.kt', line: 12, col: 9, len: 3, to: { side: 'head', path: 'A.kt', line: 10, col: 0 } },
      { side: 'head', path: 'A.kt', line: 13, col: 0, len: 3, to: { side: 'head', path: 'A.kt', line: 2, col: 0 } },
      { side: 'head', path: 'A.kt', line: 13, col: 4, len: 3, to: { lib: 'x.jar' } },
      { side: 'base', path: 'A.kt', line: 11, col: 0, len: 3, to: { side: 'base', path: 'Repo.kt', line: 4, col: 8 } },
    ],
  };
  it('差分の列に無い行き先のファイル。base の変わっていないファイルは head にまとまる', () => {
    expect(filesToAsk(src, H, new Set(['A.kt']))).toEqual([
      { side: 'head', path: 'A.kt' },
      { side: 'head', path: 'Repo.kt' },
    ]);
  });
  it('全体を聞いたファイルはもう聞かない（差分の行だけ聞いたファイルは聞く）', () => {
    expect(filesToAsk({ ...src, files: [...src.files, { side: 'head', path: 'Repo.kt' }] }, H, new Set(['A.kt']))).toEqual([{ side: 'head', path: 'A.kt' }]);
    expect(filesToAsk({ ...src, files: [{ side: 'head', path: 'A.kt' }] }, H, new Set(['A.kt']))).toEqual([{ side: 'head', path: 'Repo.kt' }]);
  });
  it('drawerFiles は head が先、パス順', () => {
    expect(drawerFiles([{ side: 'base', path: 'A.kt', line: 1, col: 0 }, { lib: 'x' }, { side: 'head', path: 'Z.kt', line: 1, col: 0 }, { side: 'head', path: 'B.kt', line: 1, col: 0, shown: { hunkId: 'h', side: 'RIGHT', line: 1 } }])).toEqual([
      { side: 'head', path: 'Z.kt' },
      { side: 'base', path: 'A.kt' },
    ]);
  });
});

describe('buildDefinitions', () => {
  const src: DefinitionSource = {
    files: [
      { side: 'head', path: 'A.kt', part: true },
      { side: 'head', path: 'Empty.kt' },
    ],
    answers: [
      { side: 'head', path: 'A.kt', line: 13, col: 4, len: 3, to: { lib: 'x.jar' } },
      { side: 'head', path: 'A.kt', line: 12, col: 9, len: 3, to: { side: 'head', path: 'Repo.kt', line: 4, col: 8 } },
      { side: 'head', path: 'A.kt', line: 12, col: 4, len: 3, to: { side: 'head', path: 'Repo.kt', line: 4, col: 8 } },
      // 宣言の名前（自分自身）と答えの無い名前は入れない
      { side: 'head', path: 'A.kt', line: 11, col: 6, len: 1, to: { side: 'head', path: 'A.kt', line: 11, col: 6 } },
      { side: 'head', path: 'A.kt', line: 11, col: 9, len: 1, to: null },
      { side: 'base', path: 'A.kt', line: 11, col: 0, len: 1, to: { side: 'base', path: 'A.kt', line: 10, col: 0 } },
    ],
  };
  const defs = buildDefinitions(src, H, new Set(['A.kt']));
  it('名前は side・path・行・列の順。同じ行き先は 1 つの添字', () => {
    expect(defs.files).toEqual([
      { side: 'head', path: 'A.kt', part: true, names: [[12, 4, 3, 0], [12, 9, 3, 0], [13, 4, 3, 1]] },
      { side: 'head', path: 'Empty.kt', names: [] },
      { side: 'base', path: 'A.kt', part: true, names: [[11, 0, 1, 2]] },
    ]);
    expect(defs.targets).toEqual([{ side: 'head', path: 'Repo.kt', line: 4, col: 8 }, { lib: 'x.jar' }, { side: 'base', path: 'A.kt', line: 10, col: 0, shown: { hunkId: 'h1', side: 'RIGHT', line: 10 } }]);
  });
  it('同じファイルを差分の行だけと全体の両方で聞いていれば全体', () => {
    const both = buildDefinitions({ files: [{ side: 'head', path: 'A.kt', part: true }, { side: 'head', path: 'A.kt' }], answers: [] }, H, new Set());
    expect(both.files).toEqual([{ side: 'head', path: 'A.kt', names: [] }]);
  });
});
