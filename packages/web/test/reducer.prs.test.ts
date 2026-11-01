// PR 一覧（設計書 3.11）のコマンド: 開く → GitHub から取る → 絞り込む → 解析する（順番待ち）→ 開く。解析が無くても動く
import type { AnalysisSummary, CommentDraft, ReviewJob } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { prAnalysis } from '../src/prs.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';
import { openPr, prDetail, prList } from './prFixture.js';

const analysis = fixtureAnalysis();
const HEAD = analysis.pr.headSha;
const NEW = 'f'.repeat(40);
const summary = (key: string, headSha = HEAD, mtime = 1): AnalysisSummary => ({ key, headSha, pr: { ...analysis.pr, headSha }, mtime, repoName: 'order-service' });
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const loaded = (key = '42') => run(initialState(), { id: 'analyses.loaded', analyses: [summary(key), summary('7', NEW, 2)] }, { id: 'data.loaded', summary: summary(key), analysis, review: emptyReview() });

describe('PR 一覧を開く・取る', () => {
  it('view.prs で PR 一覧へ移り、GitHub から取る。解析が無くても開ける', () => {
    const r = reduce(initialState(), { id: 'view.prs' });
    expect(r.state.view).toBe('prs');
    expect(r.state.prs.loading).toBe(true);
    expect(r.effects).toEqual([{ type: 'fetchPrs' }]);
  });

  it('取れたら一覧、取れなければ理由（前の一覧は残す）。取っている間の「更新」は重ねて取らない', () => {
    const list = prList([openPr()]);
    const s = run(initialState(), { id: 'view.prs' }, { id: 'prs.loaded', list });
    expect(s.prs).toMatchObject({ list, loading: false, error: null });
    expect(reduce(run(initialState(), { id: 'view.prs' }), { id: 'prs.refresh' }).effects).toEqual([]);
    const failed = run(s, { id: 'prs.refresh' }, { id: 'prs.failed', reason: 'gh api に失敗しました: HTTP 401' });
    expect(failed.prs).toMatchObject({ list, loading: false, error: 'gh api に失敗しました: HTTP 401' });
    expect(reduce(failed, { id: 'prs.refresh' }).effects).toEqual([{ type: 'fetchPrs' }]);
    expect(reduce(failed, { id: 'prs.refresh' }).state.prs.error).toBeNull();
  });

  it('絞り込みは片方ずつ変えられる', () => {
    const s = run(initialState(), { id: 'prs.filter', mine: true }, { id: 'prs.filter', drafts: false });
    expect(s.prs.filter).toEqual({ mine: true, drafts: false });
  });

  it('解析が 1 つも無ければ最初から PR 一覧。あれば今まで通り', () => {
    const r = reduce(initialState(), { id: 'analyses.loaded', analyses: [] });
    expect(r.state.view).toBe('prs');
    expect(r.effects).toEqual([{ type: 'fetchPrs' }]);
    expect(reduce(r.state, { id: 'analyses.loaded', analyses: [] }).effects).toEqual([]);
    expect(reduce(initialState(), { id: 'analyses.loaded', analyses: [summary('42')] }).state.view).toBe('home');
  });

  it('Esc では PR 一覧から動かない', () => {
    expect(run(loaded(), { id: 'view.prs' }, { id: 'escape' }).view).toBe('prs');
  });
});

describe('PR 一覧から解析する・開く', () => {
  it('解析するで serve に版なしで頼み、すぐ解析中にする。順番待ちか解析中の間は頼まない', () => {
    const pr = openPr({ number: 7 });
    const r = reduce(run(initialState(), { id: 'view.prs' }), { id: 'pr.analyze', key: '7', now: 1000 });
    expect(r.effects).toEqual([{ type: 'startAnalyze', key: '7' }]);
    expect(prAnalysis(pr, r.state.analyses, r.state.reanalyze.jobs)).toEqual({ kind: 'running', startedAt: 1000 });
    expect(reduce(r.state, { id: 'pr.analyze', key: '7', now: 2000 }).effects).toEqual([]);
    const second = reduce(r.state, { id: 'pr.analyze', key: '8', now: 2000 });
    expect(prAnalysis(openPr({ number: 8 }), [], second.state.reanalyze.jobs)).toEqual({ kind: 'queued', ahead: 1 });
  });

  it('解析し直すは前の解析の版から（同じ引数で解析し直す）', () => {
    expect(reduce(initialState(), { id: 'pr.analyze', key: '7', from: NEW, now: 1 }).effects).toEqual([{ type: 'startAnalyze', key: '7', from: NEW }]);
  });

  it('開くでその解析を読み込み、全体図に着く（同じ PR の別のバージョンでも）', () => {
    const s = run(loaded('7'), { id: 'view.prs' });
    const r = reduce(s, { id: 'pr.open', key: '7', headSha: NEW });
    expect(r.effects).toEqual([{ type: 'loadAnalysis', key: '7', headSha: NEW }]);
    const next = run(r.state, { id: 'data.loaded', summary: summary('7', NEW, 2), analysis: { ...analysis, pr: { ...analysis.pr, headSha: NEW } }, review: emptyReview() });
    expect(next.view).toBe('home');
    expect(next.current?.headSha).toBe(NEW);
  });

  it('今開いている解析を開くなら読み込まずに全体図へ', () => {
    const r = reduce(run(loaded('42'), { id: 'view.prs' }), { id: 'pr.open', key: '42', headSha: HEAD });
    expect(r.effects).toEqual([]);
    expect(r.state.view).toBe('home');
  });
});

describe('PR の詳細の引き出し', () => {
  const list = prList([openPr({ number: 7 }), openPr({ number: 8, url: 'https://github.com/o/order-service/pull/8' })]);
  const onList = () => run(initialState(), { id: 'view.prs' }, { id: 'prs.loaded', list });

  it('カードを押すと説明のタブで開いて GitHub から取る。同じカードでもう一度押すと閉じる', () => {
    const r = reduce(onList(), { id: 'pr.detail', number: 7 });
    expect(r.state.prs.detail).toEqual({ number: 7, tab: 'desc' });
    expect(r.state.prs.details[7]).toEqual({ data: null, loading: true, error: null });
    expect(r.effects).toEqual([{ type: 'fetchPrDetail', number: 7 }]);
    const closed = reduce(r.state, { id: 'pr.detail', number: 7 });
    expect(closed.state.prs.detail).toBeNull();
    expect(closed.effects).toEqual([]);
  });

  it('別のカードを押すと中身が切り替わり、タブは説明に戻る。取れた中身は番号ごとに残り、開き直すと出したまま取り直す', () => {
    const d7 = prDetail({ number: 7 });
    const s = run(onList(), { id: 'pr.detail', number: 7 }, { id: 'prDetail.loaded', number: 7, detail: d7 }, { id: 'pr.detail.tab', tab: 'files' });
    expect(s.prs.detail).toEqual({ number: 7, tab: 'files' });
    const r = reduce(s, { id: 'pr.detail', number: 8 });
    expect(r.state.prs.detail).toEqual({ number: 8, tab: 'desc' });
    expect(r.effects).toEqual([{ type: 'fetchPrDetail', number: 8 }]);
    const back = reduce(r.state, { id: 'pr.detail', number: 7 });
    expect(back.state.prs.details[7]).toEqual({ data: d7, loading: true, error: null });
    expect(back.effects).toEqual([{ type: 'fetchPrDetail', number: 7 }]);
  });

  it('遅れて届いた別の PR の中身はその番号に入れるだけ（開いている引き出しは替えない）', () => {
    const s = run(onList(), { id: 'pr.detail', number: 7 }, { id: 'pr.detail', number: 8 }, { id: 'prDetail.loaded', number: 7, detail: prDetail({ number: 7 }) });
    expect(s.prs.detail?.number).toBe(8);
    expect(s.prs.details[7]?.data?.number).toBe(7);
    expect(s.prs.details[8]?.data).toBeNull();
  });

  it('取れなければ理由。前の中身は残す。「もう一度」で取り直す（取っている間は重ねない）', () => {
    const d7 = prDetail({ number: 7 });
    const s = run(onList(), { id: 'pr.detail', number: 7 }, { id: 'prDetail.loaded', number: 7, detail: d7 }, { id: 'prs.refresh' }, { id: 'prDetail.failed', number: 7, reason: 'gh api に失敗しました: HTTP 502' });
    expect(s.prs.details[7]).toEqual({ data: d7, loading: false, error: 'gh api に失敗しました: HTTP 502' });
    const r = reduce(s, { id: 'pr.detail.refresh' });
    expect(r.effects).toEqual([{ type: 'fetchPrDetail', number: 7 }]);
    expect(r.state.prs.details[7]).toEqual({ data: d7, loading: true, error: null });
    expect(reduce(r.state, { id: 'pr.detail.refresh' }).effects).toEqual([]);
  });

  it('一覧の「更新」は開いている PR の詳細も取り直す', () => {
    const s = run(onList(), { id: 'pr.detail', number: 7 }, { id: 'prDetail.loaded', number: 7, detail: prDetail() });
    expect(reduce(s, { id: 'prs.refresh' }).effects).toEqual([{ type: 'fetchPrs' }, { type: 'fetchPrDetail', number: 7 }]);
  });

  it('Esc で閉じる。閉じていれば今まで通り PR 一覧のまま', () => {
    const s = run(onList(), { id: 'pr.detail', number: 7 }, { id: 'escape' });
    expect(s.prs.detail).toBeNull();
    expect(s.view).toBe('prs');
    expect(run(s, { id: 'escape' }).view).toBe('prs');
  });

  it('PR 一覧から離れたら閉じる', () => {
    const s = run(loaded(), { id: 'view.prs' }, { id: 'prs.loaded', list }, { id: 'pr.detail', number: 7 }, { id: 'view.home' }, { id: 'view.prs' });
    expect(s.prs.detail).toBeNull();
  });

  it('取り直した一覧から開いている PR が消えたら（閉じた・マージされた）閉じる', () => {
    const s = run(onList(), { id: 'pr.detail', number: 7 }, { id: 'prs.refresh' });
    expect(run(s, { id: 'prs.loaded', list: prList([openPr({ number: 7 })]) }).prs.detail).toEqual({ number: 7, tab: 'desc' });
    expect(run(s, { id: 'prs.loaded', list: prList([openPr({ number: 8 })]) }).prs.detail).toBeNull();
  });

  it('「GitHub で開く」はその PR のページを新しいタブで', () => {
    const s = run(onList(), { id: 'pr.detail', number: 8 });
    expect(reduce(s, { id: 'pr.github', number: 8 }).effects).toEqual([{ type: 'openTab', url: 'https://github.com/o/order-service/pull/8' }]);
  });
});

describe('AI にレビューを頼む', () => {
  const list = prList([openPr({ number: 7, headSha: HEAD }), openPr({ number: 8 })]);
  const onList = () => run(initialState(), { id: 'view.prs' }, { id: 'prs.loaded', list });
  const running = (key: string): ReviewJob => ({ status: 'running', key, headSha: HEAD, startedAt: 5 });

  it('頼むと serve にその head で頼む。解析待ちかレビュー中の PR は頼まない（ほかの PR は頼める）', () => {
    expect(reduce(onList(), { id: 'pr.review', key: '7', headSha: HEAD }).effects).toEqual([{ type: 'startReview', key: '7', headSha: HEAD }]);
    const busy = run(onList(), { id: 'review.jobs', jobs: [running('7'), { status: 'waiting', key: '8', headSha: HEAD }] });
    expect(reduce(busy, { id: 'pr.review', key: '7', headSha: HEAD }).effects).toEqual([]);
    expect(reduce(busy, { id: 'pr.review', key: '8', headSha: HEAD }).effects).toEqual([]);
    expect(reduce(run(busy, { id: 'review.jobs', jobs: [running('7')] }), { id: 'pr.review', key: '8', headSha: HEAD }).effects).toEqual([{ type: 'startReview', key: '8', headSha: HEAD }]);
  });

  it('serve の答えで置き換える。頼めなかった失敗は、その PR を serve が知るまで残す', () => {
    const failed = run(onList(), { id: 'review.startFailed', key: '8', headSha: HEAD, reason: 'AI レビューのコマンドが設定されていません' });
    expect(failed.reviews).toEqual([{ status: 'failed', key: '8', headSha: HEAD, reason: 'AI レビューのコマンドが設定されていません' }]);
    expect(run(failed, { id: 'review.jobs', jobs: [running('7')] }).reviews).toEqual([running('7'), failed.reviews[0]]);
    expect(run(failed, { id: 'review.jobs', jobs: [running('8')] }).reviews).toEqual([running('8')]);
  });

  it('止めると serve に止めるよう頼む', () => {
    expect(reduce(onList(), { id: 'pr.review.stop', key: '7' }).effects).toEqual([{ type: 'stopReview', key: '7' }]);
  });

  it('今開いている解析のレビューが終わったら、その state の下書きを読み直す（ほかの PR・ほかの head なら読まない）', () => {
    const s = run(loaded('42'), { id: 'review.jobs', jobs: [running('42'), running('7')] });
    const done = (key: string, headSha = HEAD): ReviewJob => ({ status: 'done', key, headSha, drafts: 2, skipped: 0 });
    expect(reduce(s, { id: 'review.jobs', jobs: [done('42'), running('7')] }).effects).toEqual([{ type: 'loadComments', key: '42', headSha: HEAD }]);
    expect(reduce(s, { id: 'review.jobs', jobs: [running('42'), done('7')] }).effects).toEqual([]);
    expect(reduce(s, { id: 'review.jobs', jobs: [done('42', NEW), running('7')] }).effects).toEqual([]);
    expect(reduce(run(s, { id: 'review.jobs', jobs: [done('42')] }), { id: 'review.jobs', jobs: [done('42')] }).effects).toEqual([]);
  });

  it('「見る」はレビューした解析を読み込み、締めに着く。今開いている解析でも読み直す（下書きを並べる）', () => {
    const r = reduce(run(loaded('7'), { id: 'view.prs' }), { id: 'pr.drafts', key: '7', headSha: NEW });
    expect(r.effects).toEqual([{ type: 'loadAnalysis', key: '7', headSha: NEW, view: 'closing' }]);
    const drafts: CommentDraft[] = [{ id: 'd1', path: 'a.kt', line: 3, side: 'RIGHT', body: '[ask] x', source: 'codex', state: 'draft' }];
    const next = run(r.state, { id: 'data.loaded', summary: summary('7', NEW, 2), analysis: { ...analysis, pr: { ...analysis.pr, headSha: NEW } }, review: { ...emptyReview(), comments: drafts }, view: 'closing' });
    expect(next.view).toBe('closing');
    expect(next.review?.comments).toEqual(drafts);
    expect(reduce(run(loaded('42'), { id: 'view.prs' }), { id: 'pr.drafts', key: '42', headSha: HEAD }).effects).toEqual([{ type: 'loadAnalysis', key: '42', headSha: HEAD, view: 'closing' }]);
  });

  it('AI レビューのコマンドは ui.json に入る。空なら消す', () => {
    const r = reduce(initialState(), { id: 'ui.reviewCommand', value: 'codex exec -s read-only -' });
    expect(r.state.ui).toEqual({ reviewCommand: 'codex exec -s read-only -' });
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
    expect(reduce(r.state, { id: 'ui.reviewCommand', value: '' }).state.ui).toEqual({});
  });
});
