// 画面ごとの URL（2026-11-04）。読み直しても同じ画面に戻り、ブラウザの戻る・進むが効く
import type { AnalysisSummary } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute, routeOf, routeTarget, sameEntry, type Page, type Route } from '../src/route.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import type { Command } from '../src/commands/commands.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OLD = 'f00dfeed00000000000000000000000000000000';
const at = (key: string, sha: string | null, page: Page): Extract<Route, { kind: 'analysis' }> => ({ kind: 'analysis', key, sha, page });
const parse = (url: string) => {
  const u = new URL(url, 'http://127.0.0.1:4177');
  return parseRoute(u.pathname, u.search);
};

describe('parseRoute / formatRoute', () => {
  const routes: Route[] = [
    { kind: 'prs' },
    { kind: 'latest' },
    at('12', 'a1b2c3d', { kind: 'explain' }),
    at('12', 'a1b2c3d', { kind: 'map' }),
    at('local', 'a1b2c3d', { kind: 'hows', how: null }),
    at('local', 'a1b2c3d', { kind: 'hows', how: 3 }),
    at('12', 'a1b2c3d', { kind: 'course', course: 3, at: { kind: 'brief' } }),
    at('12', 'a1b2c3d', { kind: 'course', course: 3, at: { kind: 'stop', i: 0 } }),
    at('12', 'a1b2c3d', { kind: 'course', course: 0, at: { kind: 'stop', i: 4 } }),
    at('12', 'a1b2c3d', { kind: 'course', course: 3, at: { kind: 'summary' } }),
    at('12', 'a1b2c3d', { kind: 'diff', file: null }),
    at('12', 'a1b2c3d', { kind: 'diff', file: 'src/main/kotlin/a b+c%d.kt' }),
    at('12', 'a1b2c3d', { kind: 'closing' }),
    at('12', null, { kind: 'explain' }),
    at('local', null, { kind: 'course', course: 5, at: { kind: 'stop', i: 1 } }),
  ];

  it('書いた URL を読むと同じ画面に戻る', () => {
    for (const r of routes) expect(parse(formatRoute(r)), formatRoute(r)).toEqual(r);
  });

  it('PR は /pr/<番号>、local は /local。続けて head の先頭 7 文字と画面。停留所の番号は 1 から', () => {
    expect(formatRoute(at('12', 'a1b2c3d', { kind: 'explain' }))).toBe('/pr/12/a1b2c3d/explain');
    expect(formatRoute(at('local', 'a1b2c3d', { kind: 'course', course: 3, at: { kind: 'stop', i: 0 } }))).toBe('/local/a1b2c3d/course/3/1');
    expect(formatRoute(at('local', 'a1b2c3d', { kind: 'diff', file: 'src/A.kt' }))).toBe('/local/a1b2c3d/diff?file=src/A.kt');
    expect(formatRoute({ kind: 'prs' })).toBe('/prs');
    expect(formatRoute({ kind: 'latest' })).toBe('/');
  });

  it('/pr/<番号> と /local は、その key の最新の説明タブ', () => {
    expect(parse('/pr/12')).toEqual(at('12', null, { kind: 'explain' }));
    expect(parse('/local')).toEqual(at('local', null, { kind: 'explain' }));
    expect(parse('/pr/12/a1b2c3d')).toEqual(at('12', 'a1b2c3d', { kind: 'explain' }));
  });

  it('前の CLI が出した /?pr=<key> は /pr/<key> と同じ', () => {
    expect(parse('/?pr=12')).toEqual(parse('/pr/12'));
    expect(parse('/?pr=local')).toEqual(parse('/local'));
  });

  it('知らない画面・番号でない id・0 番の停留所は説明タブ。知らないパスは最新の解析', () => {
    for (const url of ['/pr/12/a1b2c3d/nope', '/pr/12/a1b2c3d/hows/x', '/pr/12/a1b2c3d/course/x', '/pr/12/a1b2c3d/course/3/0', '/pr/12/a1b2c3d/course/3/-1', '/pr/12/a1b2c3d/map/extra']) {
      expect(parse(url), url).toEqual(at('12', 'a1b2c3d', { kind: 'explain' }));
    }
    expect(parse('/somewhere')).toEqual({ kind: 'latest' });
    expect(parse('/pr')).toEqual({ kind: 'latest' });
  });
});

describe('routeTarget（URL が指す解析）', () => {
  const summary = (key: string, headSha: string): AnalysisSummary => ({ key, headSha, pr: fixtureAnalysis().pr, mtime: 1, repoName: 'r' });
  // 新しい順（serve の一覧と同じ）
  const list = [summary('12', SHA), summary('local', SHA), summary('12', OLD)];
  const course: Page = { kind: 'course', course: 3, at: { kind: 'stop', i: 1 } };

  it('sha の先頭が合うバージョン', () => {
    expect(routeTarget(list, at('12', 'f00dfee', course))).toEqual({ summary: list[2], page: course });
  });

  it('sha が無い・合わなければその key の最新のバージョン', () => {
    expect(routeTarget(list, at('12', null, course))).toEqual({ summary: list[0], page: course });
    expect(routeTarget(list, at('12', '1234567', course))).toEqual({ summary: list[0], page: course });
  });

  it('知らない key と / は最新の解析の説明タブ。解析が無ければ null', () => {
    expect(routeTarget(list, at('99', null, course))).toEqual({ summary: list[0], page: { kind: 'explain' } });
    expect(routeTarget(list, { kind: 'latest' })).toEqual({ summary: list[0], page: { kind: 'explain' } });
    expect(routeTarget([], { kind: 'latest' })).toBeNull();
  });
});

describe('sameEntry（履歴を足すか）', () => {
  it('同じ解析の同じ種類の画面なら同じ履歴（停留所・ファイル・絞り込みを移っても足さない）', () => {
    expect(sameEntry(parse('/pr/12/a1b2c3d/course/3/1'), parse('/pr/12/a1b2c3d/course/3/2'))).toBe(true);
    expect(sameEntry(parse('/pr/12/a1b2c3d/diff?file=A.kt'), parse('/pr/12/a1b2c3d/diff?file=B.kt'))).toBe(true);
    expect(sameEntry({ kind: 'prs' }, { kind: 'prs' })).toBe(true);
  });

  it('画面の種類・解析・バージョンが替われば別の履歴', () => {
    expect(sameEntry(parse('/pr/12/a1b2c3d/explain'), parse('/pr/12/a1b2c3d/map'))).toBe(false);
    expect(sameEntry(parse('/pr/12/a1b2c3d/course/1/5'), parse('/pr/12/a1b2c3d/course/2'))).toBe(false);
    expect(sameEntry(parse('/pr/12/a1b2c3d/explain'), parse('/pr/12/f00dfee/explain'))).toBe(false);
    expect(sameEntry(parse('/pr/12/a1b2c3d/explain'), parse('/local/a1b2c3d/explain'))).toBe(false);
    expect(sameEntry({ kind: 'prs' }, parse('/pr/12/a1b2c3d/explain'))).toBe(false);
  });
});

describe('routeOf（今の画面の URL）', () => {
  const analysis = fixtureAnalysis();
  const sha7 = analysis.pr.headSha.slice(0, 7);
  const loaded = (): AppState => {
    const summary = { key: '12', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
    return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
  };
  const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
  const url = (s: AppState) => formatRoute(routeOf(s)!);

  it('解析を読む前は無い。PR 一覧は解析が無くても /prs', () => {
    expect(routeOf(initialState())).toBeNull();
    expect(url(run(initialState(), { id: 'view.prs' }))).toBe('/prs');
  });

  it('読み込んだ直後は説明タブ。画面を移ると URL も移る', () => {
    const s = loaded();
    expect(url(s)).toBe(`/pr/12/${sha7}/explain`);
    expect(url(run(s, { id: 'home.tab', tab: 'map' }))).toBe(`/pr/12/${sha7}/map`);
    expect(url(run(s, { id: 'view.hows' }, { id: 'how.select', howId: 2 }))).toBe(`/pr/12/${sha7}/hows/2`);
    expect(url(run(s, { id: 'course.enter', courseId: 3 }))).toBe(`/pr/12/${sha7}/course/3`);
    expect(url(run(s, { id: 'course.enter', courseId: 3, at: 1 }))).toBe(`/pr/12/${sha7}/course/3/2`);
    expect(url(run(s, { id: 'view.closing' }))).toBe(`/pr/12/${sha7}/closing`);
    const diff = run(s, { id: 'view.diff' });
    expect(url(diff)).toBe(`/pr/12/${sha7}/diff?file=${diff.selectedFile}`);
  });
});
