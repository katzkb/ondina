// route.go: URL の画面（route.ts の Page）へ移る。起動とブラウザの戻る・進むで使う（2026-11-04）
import { describe, expect, it } from 'vitest';
import { courseOf, courses, OUTSIDE } from '../src/course.js';
import type { Command } from '../src/commands/commands.js';
import type { Page } from '../src/route.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

function loaded(): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const go = (s: AppState, page: Page) => run(s, { id: 'route.go', page });
const explained = (s: AppState) => s.view === 'home' && s.home.tab === 'text';

describe('route.go', () => {
  it('入口の説明タブと地図タブ。コースにいれば出る', () => {
    const inCourse = run(loaded(), { id: 'course.enter', courseId: 3, at: 1 });
    const map = go(inCourse, { kind: 'map' });
    expect([map.view, map.home.tab, map.course]).toEqual(['home', 'map', null]);
    expect(explained(go(map, { kind: 'explain' }))).toBe(true);
  });

  it('目的ごとの画面。how があればその目的で絞り込み、null なら絞り込み無し', () => {
    const s = go(loaded(), { kind: 'hows', how: 2 });
    expect([s.view, s.selectedHow]).toEqual(['hows', 2]);
    expect(go(s, { kind: 'hows', how: null }).selectedHow).toBeNull();
  });

  it('コースの読む前の案内・停留所・総括', () => {
    const s = loaded();
    expect(go(s, { kind: 'course', course: 3, at: { kind: 'brief' } }).course).toEqual({ id: 3, i: 0, screen: 'brief' });
    const stop = go(s, { kind: 'course', course: 3, at: { kind: 'stop', i: 1 } });
    expect([stop.view, stop.course]).toEqual(['course', { id: 3, i: 1, screen: 'stop' }]);
    expect(stop.selectedHunk).toBe(courseOf(courses(s.analysis!), 3)!.steps[1]!.hunkId);
    const last = courseOf(courses(s.analysis!), 3)!.steps.length - 1;
    expect(go(s, { kind: 'course', course: 3, at: { kind: 'summary' } }).course).toEqual({ id: 3, i: last, screen: 'summary' });
  });

  it('コース外には読む前の案内が無いので、読む前の案内を指すと最初の未確認の停留所', () => {
    expect(go(loaded(), { kind: 'course', course: OUTSIDE, at: { kind: 'brief' } }).course).toEqual({ id: OUTSIDE, i: 0, screen: 'stop' });
  });

  it('差分一覧。file があればそのファイルを選び、その見出しまでスクロールする', () => {
    const s = loaded();
    const path = s.analysis!.hunks.at(-1)!.path;
    const d = go(s, { kind: 'diff', file: path });
    expect([d.view, d.selectedFile]).toEqual(['diff', path]);
    expect(d.diffJump).toMatchObject({ to: 'file', n: s.diffJump.n + 1 });
    expect(go(s, { kind: 'diff', file: null }).view).toBe('diff');
  });

  it('締め', () => {
    expect(go(loaded(), { kind: 'closing' }).view).toBe('closing');
  });

  it('無いコース・停留所・目的・ファイルは説明タブ', () => {
    const inDiff = run(loaded(), { id: 'view.diff' });
    const steps = courseOf(courses(inDiff.analysis!), 3)!.steps.length;
    for (const page of [
      { kind: 'course', course: 99, at: { kind: 'brief' } },
      { kind: 'course', course: 3, at: { kind: 'stop', i: steps } },
      { kind: 'hows', how: 99 },
      { kind: 'diff', file: 'no/such/File.kt' },
    ] satisfies Page[]) {
      expect(explained(go(inDiff, page)), JSON.stringify(page)).toBe(true);
    }
  });

  it('解析を読む前は何もしない', () => {
    const s = initialState();
    expect(go(s, { kind: 'closing' })).toBe(s);
  });
});
