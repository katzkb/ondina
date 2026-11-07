// インライン Kotlin での境界ケース。
import { describe, expect, it } from 'vitest';
import { extractHunks, type SemanticHunk } from '../src/hunks/extract.js';

async function kt(before: string[] | null, after: string[] | null, path = 'src/main/kotlin/p/A.kt'): Promise<SemanticHunk[]> {
  return extractHunks({ path, before: before === null ? null : before.join('\n') + '\n', after: after === null ? null : after.join('\n') + '\n' });
}

describe('extractHunks: 境界ケース', () => {
  it('変更が無ければ空', async () => {
    expect(await kt(['package p', 'class A'], ['package p', 'class A'])).toEqual([]);
  });

  it('ファイル削除は各宣言が削除 hunk になり、lnNew は挿入位置（1）を指す', async () => {
    const hunks = await kt(['package p', '', 'class A', 'fun b() = 1'], null);
    expect(hunks.map((h) => [h.symbolFqName, h.lnOld, h.lnNew, h.lines])).toEqual([
      ['src/main/kotlin/p/A.kt', 1, 1, ['-package p']],
      ['p.A', 3, 1, ['-class A']],
      ['p.b', 4, 1, ['-fun b() = 1']],
    ]);
  });

  it('関数本体の中だけの変更は、その関数が hunk になる（ローカル宣言には降りない）', async () => {
    const hunks = await kt(
      ['class A {', '    fun f() {', '        fun local() = 1', '        val x = 1', '    }', '}'],
      ['class A {', '    fun f() {', '        fun local() = 2', '        val x = 1', '    }', '}'],
    );
    expect(hunks.map((h) => h.symbolFqName)).toEqual(['A.f']);
  });

  it('トップレベル関数の削除と追加が隣接して1ブロックになる場合は、共通の親が無いのでファイル hunk に格上げする', async () => {
    const hunks = await kt(['package p', '', 'fun old() = 1', 'fun keep() = 0'], ['package p', '', 'fun new() = 2', 'fun keep() = 0']);
    expect(hunks.map((h) => [h.symbolFqName, h.lnOld, h.lnNew, h.lines])).toEqual([['src/main/kotlin/p/A.kt', 3, 3, ['-fun old() = 1', '+fun new() = 2']]]);
  });

  it('import の変更と宣言の追加が同じブロックにあっても、宣言はファイル hunk に巻き込まれない', async () => {
    const hunks = await kt(
      ['package p', '', 'import a.A', '', 'class K'],
      ['package p', '', 'import a.B', 'class New', '', 'class K'],
    );
    expect(hunks.map((h) => [h.symbolFqName, h.lines])).toEqual([
      ['src/main/kotlin/p/A.kt', ['-import a.A', '+import a.B']],
      ['p.New', ['+class New']],
    ]);
  });

  it('オーバーロードは #2 付きの fqName で別 hunk になる', async () => {
    const hunks = await kt(
      ['class M {', '    fun of(a: Int) = a', '    fun of(a: String) = a', '}'],
      ['class M {', '    fun of(a: Int) = a + 1', '    fun of(a: String) = a + "!"', '}'],
    );
    expect(hunks.map((h) => h.symbolFqName)).toEqual(['M.of', 'M.of#2']);
    expect(hunks.map((h) => h.symbol)).toEqual(['of()', 'of()']);
  });

  it('宣言の外の空行だけの変更は hunk を作らない', async () => {
    expect(await kt(['package p', 'class A'], ['package p', '', 'class A'])).toEqual([]);
  });

  it('Kotlin 以外（.md）はファイル単位の hunk で lang は拡張子', async () => {
    const hunks = await kt(['# a'], ['# b'], 'README.md');
    expect(hunks.map((h) => [h.symbolKind, h.lang, h.symbol, h.lines])).toEqual([['file', 'md', 'README.md', ['-# a', '+# b']]]);
  });
});

describe('extractHunks: importsOnly（package と import の行だけが変わったファイル hunk）', () => {
  it('import の追加だけなら立つ', async () => {
    const hunks = await kt(['package p', '', 'import a.A', '', 'class K'], ['package p', '', 'import a.A', 'import a.B', '', 'class K']);
    expect(hunks.map((h) => [h.symbolKind, h.importsOnly])).toEqual([['file', true]]);
  });

  it('旧側の import を消して新側の import を足しても立つ。変更の途中の空行も許す', async () => {
    const hunks = await kt(['package p', '', 'import a.A', '', 'import b.B', '', 'class K'], ['package p', '', 'import a.C', 'import b.B', '', 'class K']);
    expect(hunks.map((h) => [h.symbolKind, h.importsOnly])).toEqual([['file', true]]);
  });

  it('新規ファイルの package 行だけでも立つ。宣言の hunk には立たない', async () => {
    const hunks = await kt(null, ['package p', '', 'class K']);
    expect(hunks.map((h) => [h.symbolKind, h.importsOnly])).toEqual([
      ['file', true],
      ['class', undefined],
    ]);
  });

  it('import と同じ hunk にコメントの変更があれば立たない', async () => {
    const hunks = await kt(['package p', '', 'import a.A', '', '// old', '', 'class K'], ['package p', '', 'import a.B', '', '// new', '', 'class K']);
    expect(hunks.map((h) => [h.symbolKind, h.lines, h.importsOnly])).toEqual([
      ['file', ['-import a.A', '+import a.B', ' ', '-// old', '+// new'], undefined],
    ]);
  });

  it('ファイル先頭のアノテーションの変更は import ではないので立たない', async () => {
    const hunks = await kt(['@file:JvmName("A")', 'package p', 'class K'], ['@file:JvmName("B")', 'package p', 'class K']);
    expect(hunks.map((h) => [h.symbolKind, h.importsOnly])).toEqual([['file', undefined]]);
  });

  it('トップレベル関数の置き換えがファイル hunk に格上げされたものには立たない', async () => {
    const hunks = await kt(['package p', '', 'fun old() = 1', 'fun keep() = 0'], ['package p', '', 'fun new() = 2', 'fun keep() = 0']);
    expect(hunks.map((h) => [h.symbolKind, h.importsOnly])).toEqual([['file', undefined]]);
  });

  it('立たないときはフィールドごと無い', async () => {
    const hunks = await kt(['package p', '// a'], ['package p', '// b']);
    expect('importsOnly' in hunks[0]!).toBe(false);
  });

  it('Kotlin 以外のファイルには立たない', async () => {
    const hunks = await kt(['import a'], ['import b'], 'script.py');
    expect(hunks.map((h) => [h.symbolKind, 'importsOnly' in h])).toEqual([['file', false]]);
  });
});
