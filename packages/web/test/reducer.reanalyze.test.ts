// 画面から解析し直す（設計書 3.0 の帯の下の 1 行）のコマンド: 新しい head を聞く → 解析し直す（順番待ち）→ 進み → できた → 切り替える → 閉じる
import type { Analysis, AnalysisSummary, AnalyzeJob, ReviewState } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { stripOf } from '../src/reanalyze.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const NEW = 'f'.repeat(40);
const ORDER_KT = 'src/main/kotlin/com/example/order/domain/Order.kt';

const analysis = fixtureAnalysis();
const OLD = analysis.pr.headSha;
const summary = (headSha = OLD, key = '42'): AnalysisSummary => ({ key, headSha, pr: { ...analysis.pr, headSha }, mtime: 1, repoName: 'order-service' });
const newer = (): Analysis => ({ ...analysis, pr: { ...analysis.pr, headSha: NEW } });

function loaded(review: ReviewState = emptyReview()): AppState {
  return reduce(initialState(), { id: 'data.loaded', summary: summary(), analysis, review }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const running: AnalyzeJob = { status: 'running', key: '42', from: OLD, startedAt: 1000 };

describe('新しい head を聞く', () => {
  it('解析を読むと聞きに行く（checkLatest）', () => {
    const r = reduce(initialState(), { id: 'data.loaded', summary: summary(), analysis, review: emptyReview() });
    expect(r.effects).toContainEqual({ type: 'checkLatest', key: '42', headSha: OLD });
  });

  it('reanalyze.check は今の版について聞く。解析が無い・解析し直している間は聞かない', () => {
    expect(reduce(loaded(), { id: 'reanalyze.check' }).effects).toEqual([{ type: 'checkLatest', key: '42', headSha: OLD }]);
    expect(reduce(initialState(), { id: 'reanalyze.check' }).effects).toEqual([]);
    expect(reduce(run(loaded(), { id: 'reanalyze.job', jobs: [running] }), { id: 'reanalyze.check' }).effects).toEqual([]);
  });

  it('新しいコミットがあれば「見つけた」。同じ head なら何も出さない。別の版への答えは捨てる', () => {
    const s = run(loaded(), { id: 'reanalyze.checked', key: '42', headSha: OLD, latest: { headSha: NEW, newCommits: 2, analyzed: false } });
    expect(stripOf(s)).toEqual({ kind: 'noticed', from: OLD, to: NEW, newCommits: 2 });
    expect(stripOf(run(loaded(), { id: 'reanalyze.checked', key: '42', headSha: OLD, latest: { headSha: OLD, newCommits: 0, analyzed: true, changed: 0 } }))).toBeNull();
    expect(stripOf(run(loaded(), { id: 'reanalyze.checked', key: '42', headSha: 'e'.repeat(40), latest: { headSha: NEW, analyzed: false } }))).toBeNull();
  });

  it('作業ツリーの解析（pr.workingTree）は「作業ツリーの新しい変更」として見つける（コミットではない）', () => {
    const wt = { ...analysis, pr: { ...analysis.pr, workingTree: true as const } };
    const s0 = reduce(initialState(), { id: 'data.loaded', summary: { key: 'local', headSha: OLD, pr: wt.pr, mtime: 1, repoName: 'order-service' }, analysis: wt, review: emptyReview() }).state;
    const s = run(s0, { id: 'reanalyze.checked', key: 'local', headSha: OLD, latest: { headSha: NEW, analyzed: false } });
    expect(stripOf(s)).toEqual({ kind: 'noticed', from: OLD, to: NEW, workingTree: true });
  });

  it('新しい head の解析が既にあれば「できた」と変わった差分の数', () => {
    const s = run(loaded(), { id: 'reanalyze.checked', key: '42', headSha: OLD, latest: { headSha: NEW, newCommits: 1, analyzed: true, changed: 3 } });
    expect(stripOf(s)).toEqual({ kind: 'ready', to: NEW, changed: 3 });
  });
});

describe('解析し直す', () => {
  const noticed = () => run(loaded(), { id: 'reanalyze.checked', key: '42', headSha: OLD, latest: { headSha: NEW, newCommits: 2, analyzed: false } });

  it('start は serve に頼み（startAnalyze）、すぐ解析中にする', () => {
    const r = reduce(noticed(), { id: 'reanalyze.start', now: 1000 });
    expect(r.effects).toEqual([{ type: 'startAnalyze', key: '42', from: OLD }]);
    expect(stripOf(r.state)).toEqual({ kind: 'running', startedAt: 1000 });
  });

  it('この PR が順番待ちか解析中なら start しない', () => {
    expect(reduce(run(noticed(), { id: 'reanalyze.job', jobs: [running] }), { id: 'reanalyze.start', now: 2000 }).effects).toEqual([]);
    expect(reduce(run(noticed(), { id: 'reanalyze.job', jobs: [{ status: 'queued', key: '42', from: OLD, queuedAt: 1 }] }), { id: 'reanalyze.start', now: 2000 }).effects).toEqual([]);
  });

  it('別の PR を解析している間も押せて、押すと順番待ち（前に何件あるか）', () => {
    const s = run(noticed(), { id: 'reanalyze.job', jobs: [{ ...running, key: '7' }] });
    expect(stripOf(s)).toEqual({ kind: 'noticed', from: OLD, to: NEW, newCommits: 2 });
    const r = reduce(s, { id: 'reanalyze.start', now: 2000 });
    expect(r.effects).toEqual([{ type: 'startAnalyze', key: '42', from: OLD }]);
    expect(stripOf(r.state)).toEqual({ kind: 'queued', key: '42', ahead: 1 });
    const queued: AnalyzeJob[] = [{ status: 'queued', key: '8', queuedAt: 1 }, { status: 'queued', key: '42', from: OLD, queuedAt: 2 }, { ...running, key: '7' }];
    expect(stripOf(run(noticed(), { id: 'reanalyze.job', jobs: queued }))).toEqual({ kind: 'queued', key: '42', ahead: 2 });
  });

  it('進みの 1 行を出す。別の PR の解析は出さない', () => {
    expect(stripOf(run(noticed(), { id: 'reanalyze.job', jobs: [{ ...running, line: '差分を切り出しています' }] }))).toEqual({ kind: 'running', startedAt: 1000, line: '差分を切り出しています' });
    expect(stripOf(run(loaded(), { id: 'reanalyze.job', jobs: [{ ...running, key: '7' }] }))).toBeNull();
  });

  it('終わったら一覧を読み直して聞き直し、それまでは「できた」（数は聞き直しで届く）', () => {
    const s = run(noticed(), { id: 'reanalyze.job', jobs: [running] });
    const r = reduce(s, { id: 'reanalyze.job', jobs: [{ status: 'done', key: '42', from: OLD, headSha: NEW }] });
    expect(r.effects).toEqual([{ type: 'refreshAnalyses' }, { type: 'checkLatest', key: '42', headSha: OLD }]);
    expect(stripOf(r.state)).toEqual({ kind: 'ready', to: NEW });
  });

  it('PR 一覧から始めた（版の無い）解析でも、今の PR なら聞き直す', () => {
    const s = run(loaded(), { id: 'reanalyze.job', jobs: [{ status: 'running', key: '42', startedAt: 1 }] });
    const r = reduce(s, { id: 'reanalyze.job', jobs: [{ status: 'done', key: '42', headSha: NEW }] });
    expect(r.effects).toEqual([{ type: 'refreshAnalyses' }, { type: 'checkLatest', key: '42', headSha: OLD }]);
  });

  it('ほかの PR の解析が終わったら一覧だけ読み直す。前から終わっていたものでは読み直さない', () => {
    const done: AnalyzeJob = { status: 'done', key: '7', headSha: NEW };
    const s = run(loaded(), { id: 'reanalyze.job', jobs: [{ ...running, key: '7' }] });
    expect(reduce(s, { id: 'reanalyze.job', jobs: [done] }).effects).toEqual([{ type: 'refreshAnalyses' }]);
    expect(reduce(run(loaded(), { id: 'reanalyze.job', jobs: [done] }), { id: 'reanalyze.job', jobs: [done] }).effects).toEqual([]);
  });

  it('失敗したら理由。この版からの解析し直しのときだけ', () => {
    const failed: AnalyzeJob = { status: 'failed', key: '42', from: OLD, reason: 'gh pr view 42 に失敗しました' };
    expect(stripOf(run(noticed(), { id: 'reanalyze.job', jobs: [running] }, { id: 'reanalyze.job', jobs: [failed] }))).toEqual({ kind: 'failed', reason: 'gh pr view 42 に失敗しました' });
    expect(stripOf(run(loaded(), { id: 'reanalyze.job', jobs: [{ ...failed, from: 'e'.repeat(40) }] }))).toBeNull();
  });

  it('serve に頼めなければ失敗を出し、serve の次の答えにその PR が無くても残す', () => {
    const s = run(noticed(), { id: 'reanalyze.start', now: 1000 }, { id: 'reanalyze.startFailed', key: '42', from: OLD, reason: '解析がありません' });
    expect(stripOf(s)).toEqual({ kind: 'failed', reason: '解析がありません' });
    expect(stripOf(run(s, { id: 'reanalyze.job', jobs: [] }))).toEqual({ kind: 'failed', reason: '解析がありません' });
  });

  it('解析中のつもりでも serve の答えに無ければ消す（serve を起動し直したとき）', () => {
    const s = run(noticed(), { id: 'reanalyze.start', now: 1000 }, { id: 'reanalyze.job', jobs: [] });
    expect(stripOf(s)).toEqual({ kind: 'noticed', from: OLD, to: NEW, newCommits: 2 });
  });
});

describe('切り替える', () => {
  const ready = () => run(loaded(), { id: 'reanalyze.checked', key: '42', headSha: OLD, latest: { headSha: NEW, analyzed: true, changed: 1 } });

  it('一覧を読み直してから新しい版を開く（switchTo）', () => {
    expect(reduce(ready(), { id: 'reanalyze.switch' }).effects).toEqual([{ type: 'switchTo', key: '42', headSha: NEW }]);
    expect(reduce(loaded(), { id: 'reanalyze.switch' }).effects).toEqual([]);
  });

  it('同じ PR の別の版を開くと、今の画面と選んでいるファイルのまま', () => {
    const s = run(ready(), { id: 'view.diff' }, { id: 'file.select', path: ORDER_KT });
    const next = run(s, { id: 'data.loaded', summary: summary(NEW), analysis: newer(), review: emptyReview() });
    expect(next.view).toBe('diff');
    expect(next.selectedFile).toBe(ORDER_KT);
  });

  it('コースにいれば、同じコースの最初の未確認の停留所へ', () => {
    const s = run(ready(), { id: 'course.enter', courseId: 3, at: 2 });
    const next = run(s, { id: 'data.loaded', summary: summary(NEW), analysis: newer(), review: emptyReview() });
    expect(next.view).toBe('course');
    expect(next.course).toEqual({ id: 3, i: 0, screen: 'stop' });
  });

  it('別の PR を開くと入口に着く（今まで通り）', () => {
    const s = run(ready(), { id: 'view.diff' });
    expect(run(s, { id: 'data.loaded', summary: summary(OLD, '7'), analysis, review: emptyReview() }).view).toBe('home');
  });

  it('引き継いだ state なら、戻した差分・未完了に戻したコース・残したメモの数を出す。× で閉じて保存する', () => {
    const review: ReviewState = { ...emptyReview(), carried: { from: OLD, reset: ['a', 'b'], coursesReset: [3, 6], left: ['m2'] } };
    const s = run(ready(), { id: 'data.loaded', summary: summary(NEW), analysis: newer(), review });
    expect(stripOf(s)).toEqual({ kind: 'switched', to: NEW, reset: 2, courses: [3, 6], left: 1 });
    const r = reduce(s, { id: 'reanalyze.dismiss' });
    expect(r.effects).toEqual([{ type: 'saveState' }]);
    expect(r.state.review?.carried?.dismissed).toBe(true);
    expect(stripOf(r.state)).toBeNull();
  });
});

describe('同じ版を解析し直す（上の帯のボタン）', () => {
  it('新しいコミットが無くても start できる', () => {
    const r = reduce(loaded(), { id: 'reanalyze.start', now: 1000 });
    expect(r.effects).toEqual([{ type: 'startAnalyze', key: '42', from: OLD }]);
    expect(stripOf(r.state)).toEqual({ kind: 'running', startedAt: 1000 });
  });

  it('同じ head で終わったら、今の解析を読み直して「解析し直しました」。閉じると消える', () => {
    const s = run(loaded(), { id: 'reanalyze.start', now: 1000 }, { id: 'reanalyze.job', jobs: [running] });
    const r = reduce(s, { id: 'reanalyze.job', jobs: [{ status: 'done', key: '42', from: OLD, headSha: OLD }] });
    expect(r.effects).toEqual([{ type: 'refreshAnalyses' }, { type: 'loadAnalysis', key: '42', headSha: OLD }]);
    expect(stripOf(r.state)).toEqual({ kind: 'redone', to: OLD });
    const again = run(r.state, { id: 'data.loaded', summary: summary(), analysis, review: emptyReview() });
    expect(stripOf(again)).toEqual({ kind: 'redone', to: OLD });
    expect(stripOf(run(again, { id: 'reanalyze.dismiss' }))).toBeNull();
  });

  it('別の PR を開いたら「解析し直しました」は出さず、元の PR に戻っても出さない', () => {
    const s = run(loaded(), { id: 'reanalyze.job', jobs: [running] }, { id: 'reanalyze.job', jobs: [{ status: 'done', key: '42', from: OLD, headSha: OLD }] });
    const other = run(s, { id: 'data.loaded', summary: summary(OLD, '7'), analysis, review: emptyReview() });
    expect(stripOf(other)).toBeNull();
    expect(stripOf(run(other, { id: 'data.loaded', summary: summary(), analysis, review: emptyReview() }))).toBeNull();
  });
});
