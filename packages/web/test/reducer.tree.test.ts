// ファイルツリーの開け閉め（設計書 3.3 / 3.4。2026-10-19）。差分一覧とコースの左で別々に持ち、保存しない。
// 見ているファイル（差分一覧で選んだファイル・今の場所のファイル）が変わったら、その上のフォルダを開く。
import { describe, expect, it } from 'vitest';
import { buildTree, dirKeys } from '../src/fileTree.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import type { Command } from '../src/commands/commands.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

function loaded(): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const MAIN = 'src/main/kotlin/com/example';
const TESTS = 'src/test/kotlin/com/example/order';

describe('差分一覧のツリー', () => {
  it('読み込んだ直後は全部開いている', () => {
    expect(loaded().treeShut).toEqual({ diff: [], course: [] });
  });

  it('tree.toggle はフォルダを閉じ、もう一度で開く', () => {
    const s1 = run(loaded(), { id: 'tree.toggle', tree: 'diff', key: TESTS });
    expect(s1.treeShut.diff).toEqual([TESTS]);
    expect(run(s1, { id: 'tree.toggle', tree: 'diff', key: TESTS }).treeShut.diff).toEqual([]);
  });

  it('tree.closeAll は差分一覧の全部のフォルダを閉じ、tree.openAll で全部開く', () => {
    const s0 = loaded();
    const all = dirKeys(buildTree(s0.analysis!.hunks.map((h) => h.path)));
    const s1 = run(s0, { id: 'tree.closeAll', tree: 'diff' });
    expect([...s1.treeShut.diff].sort()).toEqual([...all].sort());
    expect(s1.treeShut.course).toEqual([]);
    expect(run(s1, { id: 'tree.openAll', tree: 'diff' }).treeShut.diff).toEqual([]);
  });

  it('選んだファイルのフォルダを閉じられる（選んだままでは開き直さない）', () => {
    const s0 = run(loaded(), { id: 'view.diff' });
    expect(s0.selectedFile!.startsWith(`${MAIN}/`)).toBe(true);
    expect(run(s0, { id: 'tree.toggle', tree: 'diff', key: MAIN }).treeShut.diff).toEqual([MAIN]);
  });

  it('ほかの画面へ行って戻っても、選んだファイルが同じなら閉じたフォルダは開き直さない', () => {
    const s0 = run(loaded(), { id: 'view.diff' }, { id: 'tree.toggle', tree: 'diff', key: MAIN });
    expect(run(s0, { id: 'view.hows' }, { id: 'view.diff' }).treeShut.diff).toEqual([MAIN]);
    expect(run(s0, { id: 'view.closing' }, { id: 'view.diff' }).treeShut.diff).toEqual([MAIN]);
    // コースに入ると選んだファイルも今の場所のファイルに移る（変わったので開く）
    const s1 = run(s0, { id: 'course.enter', courseId: 3, at: 0 });
    expect(s1.selectedFile).not.toBe(s0.selectedFile);
    expect(run(s1, { id: 'view.diff' }).treeShut.diff).toEqual([]);
  });

  it('ほかの画面で選んだファイルが変わったら、差分一覧に戻る前でもそのフォルダを開く', () => {
    const s0 = run(loaded(), { id: 'view.diff' }, { id: 'tree.toggle', tree: 'diff', key: TESTS }, { id: 'view.hows' });
    const test = s0.analysis!.hunks.find((h) => h.path.startsWith(`${TESTS}/`))!;
    const s1 = run(s0, { id: 'hunk.select', hunkId: test.id });
    expect(s1.selectedFile).toBe(test.path);
    expect(s1.treeShut.diff).toEqual([]);
  });

  it('閉じたフォルダの中のファイルへ移ると（] など）、その上のフォルダだけ開く', () => {
    const s0 = run(loaded(), { id: 'view.diff' }, { id: 'tree.toggle', tree: 'diff', key: 'src' }, { id: 'tree.toggle', tree: 'diff', key: MAIN }, { id: 'tree.toggle', tree: 'diff', key: TESTS });
    const s1 = run(s0, { id: 'file.next' });
    expect(s1.selectedFile!.startsWith(`${MAIN}/`)).toBe(true);
    expect(s1.treeShut.diff).toEqual([TESTS]);
  });
});

describe('コースの左のツリー', () => {
  it('今の場所のファイルが変わったら、そのフォルダを開く。差分一覧の開け閉めとは別', () => {
    // コース 4: OrderRepositoryImpl.kt の 2 か所 → OrderRepositoryImplTest.kt の 3 か所
    const s0 = run(loaded(), { id: 'course.enter', courseId: 4, at: 0 }, { id: 'tree.toggle', tree: 'course', key: `${TESTS}/infra` });
    expect(s0.treeShut).toEqual({ diff: [], course: [`${TESTS}/infra`] });
    expect(run(s0, { id: 'course.jump', i: 1 }).treeShut.course).toEqual([`${TESTS}/infra`]);
    expect(run(s0, { id: 'course.jump', i: 2 }).treeShut.course).toEqual([]);
  });

  it('ほかの画面へ行って戻っても、今の場所が同じなら閉じたフォルダは開き直さない', () => {
    const infra = 'src/main/kotlin/com/example/order/infra';
    const s0 = run(loaded(), { id: 'course.enter', courseId: 4, at: 0 }, { id: 'tree.toggle', tree: 'course', key: infra });
    expect(s0.treeShut.course).toEqual([infra]);
    expect(run(s0, { id: 'view.diff' }, { id: 'view.course' }).treeShut.course).toEqual([infra]);
    expect(run(s0, { id: 'view.hows' }, { id: 'view.course' }).treeShut.course).toEqual([infra]);
  });

  // 2026-10-20: コースの左も差分の全ファイルのツリーになった
  it('すべて閉じる・すべて開くは、コースの左のツリー（差分の全ファイル）にも効く。差分一覧とは別', () => {
    const s0 = run(loaded(), { id: 'course.enter', courseId: 3, at: 0 });
    const all = dirKeys(buildTree(s0.analysis!.hunks.map((h) => h.path)));
    const s1 = run(s0, { id: 'tree.closeAll', tree: 'course' });
    expect([...s1.treeShut.course].sort()).toEqual([...all].sort());
    expect(s1.treeShut.diff).toEqual([]);
    expect(run(s1, { id: 'tree.openAll', tree: 'course' }).treeShut.course).toEqual([]);
  });

  it('別の解析を開くと空に戻る', () => {
    const s0 = run(loaded(), { id: 'tree.toggle', tree: 'diff', key: TESTS }, { id: 'tree.toggle', tree: 'course', key: TESTS });
    const analysis = fixtureAnalysis();
    const summary = { key: 'pr-2', headSha: 'other', pr: analysis.pr, mtime: 2, repoName: 'order-service' };
    expect(run(s0, { id: 'data.loaded', summary, analysis, review: emptyReview() }).treeShut).toEqual({ diff: [], course: [] });
  });
});
