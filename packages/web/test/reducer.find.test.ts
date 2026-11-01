// 差分の列の中の検索（⌘F。2026-10-27）: 差分一覧と目的ごとの画面のプレビューでだけ効き、ほかの画面はブラウザのページ内検索に任せる
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { findable, initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

function loaded(): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);

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
