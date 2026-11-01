// 差分一覧とコースの左のファイルツリー（設計書 3.3 / 3.4）: フォルダ先・名前順、中身がフォルダ 1 つだけのフォルダはつなげる。
import { describe, expect, it } from 'vitest';
import { buildTree, compareTreeOrder, dirKeys, treeRows, under, type TreeNode } from '../src/fileTree.js';
import { fixtureHunks } from './fixture.js';

/** 木を「名前（フォルダは /）」の入れ子の配列にして見る */
const shape = (nodes: readonly TreeNode[]): unknown[] => nodes.map((n) => (n.kind === 'file' ? n.name : { [`${n.name}/`]: shape(n.kids) }));

describe('buildTree', () => {
  it('中身がフォルダ 1 つだけのフォルダは、次のフォルダとつなげて 1 つにする', () => {
    const tree = buildTree(['a/b/c/x.kt', 'a/b/c/y.kt']);
    expect(shape(tree)).toEqual([{ 'a/b/c/': ['x.kt', 'y.kt'] }]);
    expect(tree[0]).toMatchObject({ kind: 'dir', key: 'a/b/c' });
  });

  it('ファイルもあるフォルダはつなげない。フォルダを先に、名前順に並べる', () => {
    expect(shape(buildTree(['a/z.kt', 'a/b/y.kt', 'a/c/x.kt']))).toEqual([{ 'a/': [{ 'b/': ['y.kt'] }, { 'c/': ['x.kt'] }, 'z.kt'] }]);
  });

  it('直下のファイルはフォルダの後に並ぶ', () => {
    expect(shape(buildTree(['README.md', 'src/a.kt']))).toEqual([{ 'src/': ['a.kt'] }, 'README.md']);
  });

  it('fixture の 37 ファイル: src → main と test/kotlin/com/example/order、main の下は kotlin/com/example と resources/db/migration', () => {
    const paths = [...new Set(fixtureHunks().map((h) => h.path))];
    const tree = buildTree(paths);
    expect(tree.map((n) => n.name)).toEqual(['src']);
    const src = tree[0]!;
    if (src.kind !== 'dir') throw new Error('src はフォルダ');
    expect(src.kids.map((n) => n.name)).toEqual(['main', 'test/kotlin/com/example/order']);
    const [main, test] = src.kids as [Extract<TreeNode, { kind: 'dir' }>, Extract<TreeNode, { kind: 'dir' }>];
    expect(main.kids.map((n) => n.name)).toEqual(['kotlin/com/example', 'resources/db/migration']);
    expect(test.key).toBe('src/test/kotlin/com/example/order');
    expect(shape(test.kids)).toEqual([{ 'application/': ['ApplyDiscountUseCaseTest.kt'] }, { 'domain/': ['OrderTest.kt'] }, { 'infra/': ['OrderRepositoryImplTest.kt'] }]);
    expect(src.files).toHaveLength(37);
  });
});

describe('compareTreeOrder', () => {
  it('木の並びと同じ順（同じフォルダではフォルダが先）', () => {
    const paths = ['a/z.kt', 'a/c/x.kt', 'b.kt', 'a/b/y.kt'];
    expect([...paths].sort(compareTreeOrder)).toEqual(['a/b/y.kt', 'a/c/x.kt', 'a/z.kt', 'b.kt']);
  });

  it('木を上から順に読んだファイルの順と一致する（fixture）', () => {
    const paths = [...new Set(fixtureHunks().map((h) => h.path))];
    const tree = buildTree(paths);
    const fromTree = treeRows(tree, new Set()).flatMap((r) => (r.node.kind === 'file' ? [r.node.path] : []));
    expect([...paths].sort(compareTreeOrder)).toEqual(fromTree);
  });
});

describe('treeRows', () => {
  const tree = buildTree(['a/b/x.kt', 'a/b/y.kt', 'a/z.kt', 'c.kt']);

  it('開いているフォルダの中を深さ付きで並べる', () => {
    expect(treeRows(tree, new Set()).map((r) => `${r.depth}:${r.node.name}`)).toEqual(['0:a', '1:b', '2:x.kt', '2:y.kt', '1:z.kt', '0:c.kt']);
  });

  it('閉じたフォルダ（key）の中は出さない', () => {
    expect(treeRows(tree, new Set(['a/b'])).map((r) => r.node.name)).toEqual(['a', 'b', 'z.kt', 'c.kt']);
    expect(treeRows(tree, new Set(['a'])).map((r) => r.node.name)).toEqual(['a', 'c.kt']);
  });
});

describe('dirKeys / under', () => {
  it('dirKeys は全部のフォルダの key（つなげたフォルダは一番深い所）', () => {
    expect(dirKeys(buildTree(['a/b/c/x.kt', 'a/b/c/d/y.kt', 'a/b/c/e/z.kt']))).toEqual(['a/b/c', 'a/b/c/d', 'a/b/c/e']);
  });

  it('under はそのフォルダの下のファイルか（名前の途中では一致させない）', () => {
    expect(under('a/b/x.kt', 'a/b')).toBe(true);
    expect(under('a/b/c/x.kt', 'a')).toBe(true);
    expect(under('a/bc/x.kt', 'a/b')).toBe(false);
    expect(under('a/b', 'a/b')).toBe(false);
  });
});
