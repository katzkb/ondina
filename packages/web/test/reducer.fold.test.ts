// 変わった行から離れた行の帯（2026-10-13）: 開いた行の記録（fold.open）と、すべて表示（F。差分一覧・目的ごと・停留所）
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

function loaded(): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
const REPO = 'src/main/kotlin/com/example/order/infra/OrderRepositoryImpl.kt';

describe('fold.open（帯の ↓ ↑ ↕ で開いた行）', () => {
  it('ファイルごとに開いた行の key を足していく（同じ key は 1 つ）。保存しない', () => {
    const r = reduce(loaded(), { id: 'fold.open', path: ORDER, keys: ['a:1', 'a:2'] });
    expect(r.effects).toEqual([]);
    const s = run(r.state, { id: 'fold.open', path: ORDER, keys: ['a:2', 'a:3'] }, { id: 'fold.open', path: REPO, keys: ['n4'] });
    expect(s.fold).toEqual({ [ORDER]: ['a:1', 'a:2', 'a:3'], [REPO]: ['n4'] });
  });

  it('画面やファイルを替えても残り、別の解析を開くと空になる', () => {
    const s = run(loaded(), { id: 'fold.open', path: ORDER, keys: ['a:1'] }, { id: 'view.diff' }, { id: 'file.select', path: REPO });
    expect(s.fold[ORDER]).toEqual(['a:1']);
    const analysis = fixtureAnalysis();
    const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 2, repoName: 'order-service' };
    expect(run(s, { id: 'data.loaded', summary, analysis, review: emptyReview() }).fold).toEqual({});
  });
});

describe('file.full（すべて表示 / 変更の近くだけ。F）', () => {
  it('差分一覧と目的ごとの画面でも切り替わる', () => {
    const d = run(loaded(), { id: 'view.diff' }, { id: 'file.full' });
    expect(d.fullFile).toBe(true);
    expect(run(d, { id: 'file.full' }).fullFile).toBe(false);
    expect(run(loaded(), { id: 'view.hows' }, { id: 'file.full' }).fullFile).toBe(true);
  });

  it('入口と締めでは何もしない', () => {
    expect(run(loaded(), { id: 'file.full' }).fullFile).toBe(false);
    expect(run(loaded(), { id: 'view.closing' }, { id: 'file.full' }).fullFile).toBe(false);
  });

  it('画面を替えると変更の近くだけに戻る。差分一覧はファイルを選び替えても戻らない（全部のファイルが 1 本の列。2026-10-20）。目的ごとの画面はファイルを選び替えると戻る', () => {
    const d = run(loaded(), { id: 'view.diff' }, { id: 'file.select', path: REPO }, { id: 'file.full' });
    const [, second] = d.analysis!.hunks.filter((h) => h.path === REPO);
    expect(run(d, { id: 'hunk.select', hunkId: second!.id }).fullFile).toBe(true);
    expect(run(d, { id: 'file.select', path: ORDER }).fullFile).toBe(true);
    expect(run(d, { id: 'view.hows' }).fullFile).toBe(false);
    const b = run(d, { id: 'view.hows' }, { id: 'file.full' });
    const order = b.analysis!.hunks.find((h) => h.path === ORDER)!;
    expect(run(b, { id: 'hunk.select', hunkId: second!.id }).fullFile).toBe(true);
    expect(run(b, { id: 'hunk.select', hunkId: order.id }).fullFile).toBe(false);
  });
});
