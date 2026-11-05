// 差分の列・引き出しの検索（⌘F）。引き出しが開いていればそのファイルを探し、検索欄を先に閉じる
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { findable, findIn, initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

function loaded(): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);

const definition: Command = { id: 'def.go', side: 'head', path: 'src/main/kotlin/com/example/order/api/OrderController.kt', line: 19, col: 19, name: 'save' };
const onView = (view: 'diff' | 'hows' | 'course') => {
  const s = loaded();
  if (view === 'course') return run(s, { id: 'course.enter', courseId: 6, at: 0 });
  return run(s, { id: view === 'diff' ? 'view.diff' : 'view.hows' }, { id: 'hunk.select', hunkId: s.analysis!.hunks.find((h) => h.path.endsWith('OrderController.kt'))!.id });
};
const drawerCommands = (s: AppState): [Command, Command][] => [
  [definition, { id: 'def.close' }],
  [{ id: 'rel.open', host: s.analysis!.symbols.find((x) => x.fqName.endsWith('ApplyDiscountUseCase.execute'))!.id }, { id: 'rel.close' }],
];

describe('findIn', () => {
  it.each(['diff', 'hows', 'course'] as const)('%s: 定義・差分の無い相手の引き出しを優先する', (view) => {
    const s = onView(view);
    for (const [open] of drawerCommands(s)) {
      const drawer = run(s, open);
      expect(drawer.def !== null || drawer.rel !== null).toBe(true);
      expect(findIn(drawer)).toBe('drawer');
      expect(findable(drawer)).toBe(true);
      expect(findIn({ ...drawer, analysis: null })).toBeNull();
      expect(findIn(run(drawer, { id: 'palette.open' }))).toBeNull();
    }
  });

  it('引き出しが無ければ、差分の列がある画面だけ list', () => {
    const s = run(loaded(), { id: 'view.diff' });
    expect(findIn(s)).toBe('list');
    expect(findIn({ ...s, view: 'hows', selectedHunk: s.analysis!.hunks[0]!.id })).toBe('list');
    expect(findIn({ ...s, view: 'hows', selectedHunk: null })).toBeNull();
    expect(findIn({ ...s, view: 'course' })).toBeNull();
    expect(findIn({ ...s, analysis: { ...s.analysis!, hunks: [] } })).toBeNull();
  });
});

describe('findable', () => {
  it('差分一覧と、hunk を選んでいる目的ごとの画面だけ。入口・解析なし・重なった画面の間は効かない', () => {
    expect(findable(run(loaded(), { id: 'view.diff' }))).toBe(true);
    const hows = run(loaded(), { id: 'view.hows' });
    expect(findable({ ...hows, selectedHunk: null })).toBe(false);
    expect(findable({ ...hows, selectedHunk: hows.analysis!.hunks[0]!.id })).toBe(true);
    expect(findable(loaded())).toBe(false);
    expect(findable(run(initialState(), { id: 'view.diff' }))).toBe(false);
    expect(findable(run(loaded(), { id: 'view.diff' }, { id: 'palette.open' }))).toBe(false);
  });
});

describe('find.*', () => {
  it('引き出しを開く・閉じると検索欄を閉じ、文字は残す', () => {
    const s = run(loaded(), { id: 'view.diff' }, { id: 'find.open' }, { id: 'find.query', text: 'save' });
    for (const [open, close] of drawerCommands(s)) {
      const drawer = run(s, open);
      expect(drawer.find).toMatchObject({ open: false, query: 'save' });
      const searching = run(drawer, { id: 'find.open' });
      expect(searching.find.open).toBe(true);
      expect(run(searching, close).find).toMatchObject({ open: false, query: 'save' });
    }
  });

  it.each(['diff', 'hows', 'course'] as const)('%s: Esc は検索欄、引き出しの順で閉じる', (view) => {
    const s = onView(view);
    for (const [open] of drawerCommands(s)) {
      const searching = run(s, open, { id: 'find.open' });
      expect(searching.find.open).toBe(true);
      const first = run(searching, { id: 'escape' });
      expect(first.find.open).toBe(false);
      expect(first.def !== null || first.rel !== null).toBe(true);
      const second = run(first, { id: 'escape' });
      expect(second.def).toBeNull();
      expect(second.rel).toBeNull();
      expect(second.view).toBe(view);
    }
  });

  it('開く（もう一度で n だけ進む）・文字を入れると先頭から・次へ / 前へ・閉じても文字は残す。保存しない', () => {
    const d = run(loaded(), { id: 'view.diff' });
    const r = reduce(d, { id: 'find.open' });
    expect(r.effects).toEqual([]);
    expect(r.state.find).toEqual({ open: true, query: '', at: 0, n: 1 });
    // 文字が空なら次へは何もしない
    expect(run(r.state, { id: 'find.next' }).find.at).toBe(0);
    const s = run(r.state, { id: 'find.query', text: 'discount' }, { id: 'find.next' }, { id: 'find.next' }, { id: 'find.prev' });
    expect(s.find).toMatchObject({ query: 'discount', at: 1 });
    expect(run(s, { id: 'find.query', text: 'discounts' }).find.at).toBe(0);
    expect(run(s, { id: 'find.open' }).find).toMatchObject({ open: true, at: 1, n: 2 });
    const closed = run(s, { id: 'find.close' });
    expect(closed.find).toMatchObject({ open: false, query: 'discount' });
    expect(run(closed, { id: 'find.open' }).find).toMatchObject({ open: true, query: 'discount' });
  });

  it('差分の列の無い画面では開かない', () => {
    expect(run(loaded(), { id: 'find.open' }).find.open).toBe(false);
  });

  it('Esc は検索欄を先に閉じる（画面は出ない）', () => {
    const s = run(loaded(), { id: 'view.diff' }, { id: 'find.open' }, { id: 'escape' });
    expect(s.find.open).toBe(false);
    expect(s.view).toBe('diff');
    expect(run(s, { id: 'escape' }).view).toBe('home');
  });

  it('画面を替えると閉じる（文字は残す）', () => {
    const s = run(loaded(), { id: 'view.diff' }, { id: 'find.open' }, { id: 'find.query', text: 'x' }, { id: 'view.hows' });
    expect(s.find).toMatchObject({ open: false, query: 'x' });
  });
});
