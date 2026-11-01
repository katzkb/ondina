// GitHub の Viewed（設計書 12.1）: ファイルの最後の 1 か所を問題なしにしたら付け、全部でなくなったら外す。
// GitHub の Viewed は差分一覧に印だけ出し、ondina の問題なしにはしない。失敗は右下の通知（6 秒）と再試行。
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { groupFiles } from '../src/files.js';
import { initialState, reduce, type AppState, type Effect } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

function loaded(key = '42'): { state: AppState; effects: Effect[] } {
  const analysis = fixtureAnalysis();
  const summary = { key, headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() });
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const githubEffects = (r: { effects: Effect[] }) => r.effects.filter((e) => e.type === 'githubSet' || e.type === 'githubRead');

const s0 = loaded().state;
const key = s0.current!.key;
const headSha = s0.current!.headSha;
const files = groupFiles(s0.analysis!.hunks, []);
const multi = files.find((f) => f.hunks.length > 1)!;
const single = files.find((f) => f.hunks.length === 1)!;
const [a, b] = multi.hunks.map((h) => h.id) as [string, string];
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

describe('読む', () => {
  it('解析を開くと GitHub の Viewed を読みにいく。local では読まない', () => {
    expect(githubEffects(loaded())).toEqual([{ type: 'githubRead', key, headSha, quiet: false }]);
    expect(githubEffects(loaded('local'))).toEqual([]);
    expect(s0.github).toMatchObject({ viewed: null, toast: null });
  });

  it('読めたら Viewed のファイルを持つ。ondina の問題なしは変えない', () => {
    const s = run(s0, { id: 'github.loaded', key, headSha, viewed: [multi.path] });
    expect(s.github.viewed).toEqual([multi.path]);
    expect(s.review!.viewed).toEqual([]);
  });

  it('別の解析の結果は捨てる', () => {
    expect(run(s0, { id: 'github.loaded', key: '7', headSha, viewed: [multi.path] }).github.viewed).toBeNull();
  });

  it('開いたときに読めなければ通知（再試行で読み直す）。タブに戻ったときの読み直しの失敗は黙る', () => {
    const s = run(s0, { id: 'github.loadFailed', key, headSha, reason: 'HTTP 401: Bad credentials', quiet: false });
    expect(s.github.toast).toMatchObject({ message: 'GitHub の Viewed を読み込めませんでした', reason: 'HTTP 401: Bad credentials', retry: { kind: 'read' }, tone: 'error' });
    expect(run(s0, { id: 'github.loadFailed', key, headSha, reason: 'x', quiet: true }).github.toast).toBeNull();
  });
});

describe('付ける・外す', () => {
  it('ファイルの最後の 1 か所を問題なしにしたときだけ付けにいく', () => {
    const r1 = reduce(s0, { id: 'hunk.markViewed', hunkId: a });
    expect(githubEffects(r1)).toEqual([]);
    const r2 = reduce(r1.state, { id: 'hunk.markViewed', hunkId: b });
    expect(githubEffects(r2)).toEqual([{ type: 'githubSet', key, headSha, mark: [multi.path], unmark: [], retried: false }]);
  });

  it('全部でなくなったら外しにいく', () => {
    const s = run(s0, { id: 'hunk.markViewed', hunkId: a }, { id: 'hunk.markViewed', hunkId: b });
    expect(githubEffects(reduce(s, { id: 'hunk.markViewed', hunkId: a }))).toEqual([{ type: 'githubSet', key, headSha, mark: [], unmark: [multi.path], retried: false }]);
  });

  it('local では送らない', () => {
    const s = loaded('local').state;
    expect(githubEffects(reduce(s, { id: 'hunk.markViewed', hunkId: single.hunks[0]!.id }))).toEqual([]);
  });

  it('付けられたら手元の Viewed にも足し、外せたら除く。通知は出さない', () => {
    const s1 = run(s0, { id: 'github.loaded', key, headSha, viewed: [single.path] });
    const s2 = run(s1, { id: 'github.set', key, headSha, mark: [multi.path], unmark: [single.path], retried: false });
    expect(s2.github.viewed).toEqual([multi.path]);
    expect(s2.github.toast).toBeNull();
  });

  it('付けられなければ通知。文は「です・ます」で、1 ファイルなら名前、複数なら数', () => {
    const one = run(s0, { id: 'github.setFailed', key, headSha, mark: [multi.path], unmark: [], reason: 'HTTP 401', conflict: false });
    expect(one.github.toast).toMatchObject({ message: `${base(multi.path)} を GitHub で Viewed にできませんでした`, reason: 'HTTP 401', retry: { kind: 'set', mark: [multi.path], unmark: [] }, tone: 'error' });
    const two = run(s0, { id: 'github.setFailed', key, headSha, mark: [multi.path, single.path], unmark: [], reason: 'x', conflict: false });
    expect(two.github.toast?.message).toBe('2 ファイルを GitHub で Viewed にできませんでした');
    const off = run(s0, { id: 'github.setFailed', key, headSha, mark: [], unmark: [multi.path], reason: 'x', conflict: false });
    expect(off.github.toast?.message).toBe(`${base(multi.path)} の GitHub の Viewed を外せませんでした`);
    const both = run(s0, { id: 'github.setFailed', key, headSha, mark: [single.path], unmark: [multi.path], reason: 'x', conflict: false });
    expect(both.github.toast?.message).toBe('GitHub の Viewed を変更できませんでした（2 ファイル）');
  });

  it('PR に新しいコミットがあって送らなかったときは、その理由だけを出し、再試行は出さない', () => {
    const msg = 'PR に解析より新しいコミットがあるため、GitHub の Viewed は変更しませんでした。analyze を実行し直してください';
    const s = run(s0, { id: 'github.setFailed', key, headSha, mark: [multi.path], unmark: [], reason: msg, conflict: true });
    expect(s.github.toast).toMatchObject({ message: msg, retry: null, tone: 'error' });
    expect(s.github.toast?.reason).toBeUndefined();
  });
});

describe('通知', () => {
  const failed = run(s0, { id: 'github.setFailed', key, headSha, mark: [multi.path], unmark: [], reason: 'HTTP 401', conflict: false });

  it('再試行は同じ中身を送り直し、通知を閉じる', () => {
    const r = reduce(failed, { id: 'github.retry' });
    expect(githubEffects(r)).toEqual([{ type: 'githubSet', key, headSha, mark: [multi.path], unmark: [], retried: true }]);
    expect(r.state.github.toast).toBeNull();
  });

  it('再試行が通ったら、通ったことを通知する', () => {
    const s = run(failed, { id: 'github.retry' }, { id: 'github.set', key, headSha, mark: [multi.path], unmark: [], retried: true });
    expect(s.github.toast).toMatchObject({ message: `${base(multi.path)} を GitHub で Viewed にしました`, retry: null, tone: 'ok' });
  });

  it('読み込みの再試行は読み直す', () => {
    const s = run(s0, { id: 'github.loadFailed', key, headSha, reason: 'x', quiet: false });
    expect(githubEffects(reduce(s, { id: 'github.retry' }))).toEqual([{ type: 'githubRead', key, headSha, quiet: false }]);
  });

  it('閉じるのは出した通知だけ（後から出た通知は閉じない）', () => {
    const n = failed.github.toast!.n;
    expect(run(failed, { id: 'github.toast.close', n }).github.toast).toBeNull();
    const again = run(failed, { id: 'github.setFailed', key, headSha, mark: [single.path], unmark: [], reason: 'x', conflict: false });
    expect(again.github.toast!.n).not.toBe(n);
    expect(run(again, { id: 'github.toast.close', n }).github.toast).not.toBeNull();
  });

  it('別の解析を開くと GitHub の状態と通知は消える', () => {
    const r = reduce(failed, { id: 'data.loaded', summary: s0.current!, analysis: s0.analysis!, review: emptyReview() });
    expect(r.state.github).toMatchObject({ viewed: null, toast: null });
  });
});
