// PR 一覧（設計書 3.11）の純粋関数: レビューの列、解析の状態、作者ごとの行、あなたの印
import type { AnalysisSummary, AnalyzeJob, ReviewJob } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { ago, avatarColor, prAiReview, prAnalysis, prRows, reviewColumn, youOf } from '../src/prs.js';
import { fixtureAnalysis } from './fixture.js';
import { openPr, prList } from './prFixture.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const OLDER = 'c'.repeat(40);
const summary = (key: string, headSha: string, mtime: number): AnalysisSummary => ({ key, headSha, pr: { ...fixtureAnalysis().pr, headSha }, mtime, repoName: 'order-service' });

describe('reviewColumn', () => {
  it('承認が 1 人でもいれば承認あり、コメントか修正の依頼があればコメントあり、依頼中だけなら誰も見ていない', () => {
    expect(reviewColumn(openPr())).toBe('none');
    expect(reviewColumn(openPr({ reviewers: [{ login: 'sato', state: 'requested' }] }))).toBe('none');
    expect(reviewColumn(openPr({ reviewers: [{ login: 'sato', state: 'commented' }] }))).toBe('commented');
    expect(reviewColumn(openPr({ reviewers: [{ login: 'sato', state: 'changes' }] }))).toBe('commented');
    expect(reviewColumn(openPr({ reviewers: [{ login: 'sato', state: 'changes' }, { login: 'ito', state: 'approved' }] }))).toBe('approved');
  });
});

describe('prAnalysis', () => {
  const pr = openPr({ number: 7, headSha: HEAD });

  it('解析が無ければ未解析。ほかの PR の解析は見ない', () => {
    expect(prAnalysis(pr, [summary('8', HEAD, 1), summary('local', HEAD, 1)], [])).toEqual({ kind: 'none' });
  });

  it('PR の今の head の解析があれば解析済み。古い head だけなら解析後に更新あり（一番新しい解析）', () => {
    expect(prAnalysis(pr, [summary('7', OLD, 5), summary('7', HEAD, 9)], [])).toEqual({ kind: 'done', headSha: HEAD, at: 9 });
    expect(prAnalysis(pr, [summary('7', OLDER, 3), summary('7', OLD, 5)], [])).toEqual({ kind: 'stale', headSha: OLD, at: 5 });
  });

  it('順番待ちは前にいる数（解析中と、列で前に並んでいるもの）。解析中は経過の起点と最後の進み', () => {
    const jobs: AnalyzeJob[] = [
      { status: 'queued', key: '8', queuedAt: 1 },
      { status: 'queued', key: '7', queuedAt: 2 },
      { status: 'running', key: '9', startedAt: 3, line: '差分を切り出しています' },
    ];
    expect(prAnalysis(pr, [summary('7', HEAD, 9)], jobs)).toEqual({ kind: 'queued', ahead: 2 });
    expect(prAnalysis(openPr({ number: 9 }), [], jobs)).toEqual({ kind: 'running', startedAt: 3, line: '差分を切り出しています' });
  });

  it('失敗は理由と前の解析。今の head の解析があれば解析済みのまま', () => {
    const failed: AnalyzeJob[] = [{ status: 'failed', key: '7', reason: '言語サーバーが起動しませんでした' }];
    expect(prAnalysis(pr, [], failed)).toEqual({ kind: 'failed', reason: '言語サーバーが起動しませんでした' });
    expect(prAnalysis(pr, [summary('7', OLD, 5)], failed)).toEqual({ kind: 'failed', reason: '言語サーバーが起動しませんでした', last: { headSha: OLD, at: 5 } });
    expect(prAnalysis(pr, [summary('7', HEAD, 9)], failed)).toEqual({ kind: 'done', headSha: HEAD, at: 9 });
  });
});

describe('prAiReview', () => {
  const pr = openPr({ number: 7, headSha: HEAD });
  const one = (job: ReviewJob) => prAiReview(pr, [{ status: 'running', key: '8', headSha: HEAD, startedAt: 1 }, job], true);

  it('ジョブが無ければ、AI レビューのコマンドがあるとき未依頼。コマンドが空なら行を出さない。ほかの PR のジョブは見ない', () => {
    expect(prAiReview(pr, [], true)).toEqual({ kind: 'none' });
    expect(prAiReview(pr, [{ status: 'running', key: '8', headSha: HEAD, startedAt: 1 }], true)).toEqual({ kind: 'none' });
    expect(prAiReview(pr, [], false)).toEqual({ kind: 'off' });
  });

  it('解析待ち・レビュー中（経過の起点）・失敗（理由）・止めた', () => {
    expect(one({ status: 'waiting', key: '7', headSha: HEAD })).toEqual({ kind: 'waiting' });
    expect(one({ status: 'running', key: '7', headSha: HEAD, startedAt: 5 })).toEqual({ kind: 'running', startedAt: 5 });
    expect(one({ status: 'failed', key: '7', headSha: HEAD, reason: '終了コード 1 で終了しました' })).toEqual({ kind: 'failed', reason: '終了コード 1 で終了しました' });
    expect(one({ status: 'stopped', key: '7', headSha: HEAD })).toEqual({ kind: 'stopped' });
  });

  it('終わった: PR の今の head なら下書きの数と入れなかった数。head が変わっていればレビュー後に更新あり', () => {
    expect(one({ status: 'done', key: '7', headSha: HEAD, drafts: 3, skipped: 1 })).toEqual({ kind: 'done', headSha: HEAD, drafts: 3, skipped: 1 });
    expect(one({ status: 'done', key: '7', headSha: OLD, drafts: 2, skipped: 0 })).toEqual({ kind: 'stale', headSha: OLD, drafts: 2, skipped: 0 });
  });

  it('コマンドを空にしても、動いている・終わったジョブは出す（止められるように）', () => {
    expect(prAiReview(pr, [{ status: 'running', key: '7', headSha: HEAD, startedAt: 5 }], false)).toEqual({ kind: 'running', startedAt: 5 });
  });
});

describe('prRows', () => {
  const t = (h: number) => `2026-10-22T${String(h).padStart(2, '0')}:00:00Z`;
  const list = prList([
    openPr({ number: 1, author: 'yamada', updatedAt: t(1) }),
    openPr({ number: 2, author: 'sato', updatedAt: t(5), reviewers: [{ login: 'ito', state: 'approved' }] }),
    openPr({ number: 3, author: 'yamada', updatedAt: t(3), reviewers: [{ login: 'katzkb', state: 'requested' }] }),
    openPr({ number: 4, author: 'katzkb', updatedAt: t(9) }),
    openPr({ number: 5, author: 'sato', updatedAt: t(2), draft: true, reviewers: [{ login: 'katzkb', state: 'requested' }] }),
    openPr({ number: 6, author: 'yamada', updatedAt: t(4), reviewers: [{ login: 'katzkb', state: 'requested', team: true }] }),
  ]);
  const shape = (rows: ReturnType<typeof prRows>) => rows.map((r) => [r.author, r.cells.none.map((p) => p.number), r.cells.commented.map((p) => p.number), r.cells.approved.map((p) => p.number)]);

  it('作者ごとの行に、レビューの列で分ける。作者は一番新しい更新の順で、あなたの PR は最後。セルの中は更新の新しい順', () => {
    expect(shape(prRows(list, { mine: false, drafts: true }))).toEqual([
      ['sato', [5], [], [2]],
      ['yamada', [6, 3, 1], [], []],
      ['katzkb', [4], [], []],
    ]);
  });

  it('あなたに依頼: あなた個人に依頼中の PR だけ（チームへの依頼は入れない）。PR の無い作者は出さない', () => {
    expect(shape(prRows(list, { mine: true, drafts: true }))).toEqual([
      ['yamada', [3], [], []],
      ['sato', [5], [], []],
    ]);
  });

  it('Draft を出さない', () => {
    expect(shape(prRows(list, { mine: true, drafts: false }))).toEqual([['yamada', [3], [], []]]);
  });
});

describe('youOf', () => {
  const me = (state: 'approved' | 'changes' | 'commented' | 'requested') => openPr({ reviewers: [{ login: 'katzkb', state }] });

  it('あなたへの依頼と、あなたのレビュー', () => {
    expect(youOf(me('requested'), 'katzkb')).toEqual({ text: 'あなたに依頼', asked: true });
    expect(youOf(me('approved'), 'katzkb')).toEqual({ text: 'あなた: 承認済み', asked: false });
    expect(youOf(me('changes'), 'katzkb')).toEqual({ text: 'あなた: 修正を依頼済み', asked: false });
    expect(youOf(me('commented'), 'katzkb')).toEqual({ text: 'あなた: コメント済み', asked: false });
  });

  it('あなたの PR・ログインが分からない・関わっていない・同じ名前のチームへの依頼は出さない', () => {
    expect(youOf(openPr({ author: 'katzkb' }), 'katzkb')).toBeNull();
    expect(youOf(me('requested'), null)).toBeNull();
    expect(youOf(openPr(), 'katzkb')).toBeNull();
    expect(youOf(openPr({ reviewers: [{ login: 'katzkb', state: 'requested', team: true }] }), 'katzkb')).toBeNull();
  });
});

describe('avatarColor / ago', () => {
  it('同じ人はいつも同じ色', () => {
    expect(avatarColor('yamada')).toBe(avatarColor('yamada'));
    expect(new Set(['yamada', 'sato', 'ito', 'suzuki', 'katzkb'].map(avatarColor)).size).toBeGreaterThan(1);
  });

  it('経過の言い方', () => {
    expect(ago(30_000)).toBe('たった今');
    expect(ago(5 * 60_000)).toBe('5 分前');
    expect(ago(3 * 3_600_000)).toBe('3 時間前');
    expect(ago(2 * 86_400_000)).toBe('2 日前');
  });
});
