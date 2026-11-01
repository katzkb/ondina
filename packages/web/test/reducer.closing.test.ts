// 締め（設計書 3.9）と差分一覧へ飛ぶコマンド。承認は PR ページを開くだけで、ゲートしない（原則 8）。
import type { CommentDraft } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { courseOf, courses, OUTSIDE } from '../src/course.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const PR_URL = 'https://github.com/o/r/pull/42';

function loaded(opts: { prUrl?: string; analysis?: ReturnType<typeof fixtureAnalysis>; comments?: CommentDraft[] } = {}): AppState {
  const analysis = opts.analysis ?? fixtureAnalysis();
  const summary = { key: opts.prUrl ? '42' : 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service', ...(opts.prUrl ? { prUrl: opts.prUrl } : {}) };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: { ...emptyReview(), comments: opts.comments ?? [] } }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const allDone = (s: AppState): AppState => ({ ...s, review: { ...s.review!, course: { done: [], completed: [1, 2, 3, 4, 5, 6, 7] } } });

describe('締めへ行く', () => {
  it('view.closing で締めの画面へ。いたコースの場所は残す（上の帯に「コース n に戻る」）', () => {
    const s = run(loaded(), { id: 'course.enter', courseId: 4 }, { id: 'view.closing' });
    expect(s.view).toBe('closing');
    expect(s.course).toEqual({ id: 4, i: 0, screen: 'brief' });
  });

  it('最後のコースを完了にすると締めへ。コースは出る', () => {
    const s0 = loaded();
    const last = courseOf(courses(s0.analysis!), 7)!.steps.length - 1;
    const atSummary = run(allDone(s0), { id: 'course.enter', courseId: 7, at: last }, { id: 'course.ok' });
    const s = run({ ...atSummary, review: { ...atSummary.review!, course: { done: [], completed: [1, 2, 3, 4, 5, 6] } } }, { id: 'enter' });
    expect(s.review!.course?.completed).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.view).toBe('closing');
    expect(s.course).toBeNull();
  });

  it('入口の Enter: 全部のコースが完了していれば締めへ', () => {
    expect(run(allDone(loaded()), { id: 'enter' }).view).toBe('closing');
  });

  it('入口の Enter: コースが無くコース外だけ（LLM 失敗）のときは今までどおりコース外に入る', () => {
    const a = fixtureAnalysis();
    a.hows = [];
    a.tours = [];
    a.hunks = a.hunks.map((h) => ({ ...h, hows: [] }));
    const s = run(loaded({ analysis: a }), { id: 'enter' });
    expect(s.view).toBe('course');
    expect(s.course?.id).toBe(OUTSIDE);
  });
});

describe('締めの画面で', () => {
  it('Esc はコースから来ていればそのコースへ、無ければ入口へ', () => {
    const fromCourse = run(loaded(), { id: 'course.enter', courseId: 4 }, { id: 'view.closing' }, { id: 'escape' });
    expect(fromCourse.view).toBe('course');
    expect(run(loaded(), { id: 'view.closing' }, { id: 'escape' }).view).toBe('home');
  });

  it('Enter と closing.approve は PR ページを新しいタブで開く（openTab）', () => {
    const s = run(loaded({ prUrl: PR_URL }), { id: 'view.closing' });
    expect(reduce(s, { id: 'enter' }).effects).toEqual([{ type: 'openTab', url: PR_URL }]);
    expect(reduce(s, { id: 'closing.approve' }).effects).toEqual([{ type: 'openTab', url: PR_URL }]);
  });

  it('PR の URL が無い解析（local）では承認は何もしない', () => {
    const s = run(loaded(), { id: 'view.closing' });
    expect(reduce(s, { id: 'closing.approve' })).toEqual({ state: s, effects: [] });
    expect(reduce(s, { id: 'enter' }).effects).toEqual([]);
  });

  it('diff.open は差分一覧の画面でその hunk を選ぶ', () => {
    const s0 = run(loaded(), { id: 'view.closing' });
    const h = s0.analysis!.hunks.find((x) => x.path.endsWith('OrderMetrics.kt'))!;
    const s = run(s0, { id: 'diff.open', hunkId: h.id });
    expect(s.view).toBe('diff');
    expect(s.selectedFile).toBe(h.path);
    expect(s.selectedHunk).toBe(h.id);
  });
});

describe('comment.open（下書きの「開く」）', () => {
  const analysis = fixtureAnalysis();
  const h = analysis.hunks.find((x) => x.path.endsWith('OrderRepositoryImpl.kt') && x.lines.some((l) => l.startsWith('-')))!;
  const first = analysis.hunks.find((x) => x.path === h.path)!;
  const draft = (line: number): CommentDraft => ({ id: 'c1', path: h.path, line, side: 'RIGHT', body: 'b', source: 'test', state: 'draft' });

  it('その行を含む hunk を差分一覧で選ぶ', () => {
    const s = run(loaded({ comments: [draft(h.lnNew + 1)] }), { id: 'view.closing' }, { id: 'comment.open', commentId: 'c1' });
    expect(s.view).toBe('diff');
    expect(s.selectedHunk).toBe(h.id);
  });

  it('どの hunk にも入らない行なら、その行が見えるコースの停留所（どの停留所の前後にも入らなければ、同じファイルを通る停留所をファイル全体で）', () => {
    const s = run(loaded({ comments: [draft(1)] }), { id: 'view.closing' }, { id: 'comment.open', commentId: 'c1' });
    expect(s.view).toBe('course');
    expect(s.course).toEqual({ id: 4, i: 0, screen: 'stop' });
    expect(s.fullFile).toBe(true);
  });

  it('ファイル全体が解析に無い古い解析で hunk の外の行なら、そのファイルを差分一覧で開く（最初の hunk）', () => {
    const old = { ...fixtureAnalysis() };
    delete old.files;
    const s = run(loaded({ analysis: old, comments: [draft(1)] }), { id: 'view.closing' }, { id: 'comment.open', commentId: 'c1' });
    expect(s.view).toBe('diff');
    expect(s.selectedFile).toBe(h.path);
    expect(s.selectedHunk).toBe(first.id);
  });

  it('知らない下書きなら何もしない', () => {
    const s = run(loaded(), { id: 'view.closing' });
    expect(run(s, { id: 'comment.open', commentId: 'nope' })).toBe(s);
  });
});
