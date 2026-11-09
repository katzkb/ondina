// 画面ごとの URL のパス（2026-11-04）。読み直しても同じ画面に戻り、ブラウザの戻る・進むが効く。
// URL を読む・書く規則はここだけ。URL を書き換えるのは App、画面を移すのは reducer の route.go。
// 解析の画面は /pr/<番号>/<head の先頭 7 文字>/<画面> か /local/<head の先頭 7 文字>/<画面>。PR 一覧は /prs、/ は最新の解析
import type { AnalysisSummary } from '@ondina/model';
import type { AppState } from './state/reducer.js';

/** コースの中の画面。停留所の i は 0 から（URL では 1 から） */
export type CourseScreen = { kind: 'brief' } | { kind: 'stop'; i: number } | { kind: 'summary' };

/** 解析の中の画面。explain / map は入口の説明タブ / 地図タブ。diff の file は選んだファイル */
export type Page =
  | { kind: 'req'; chapter: import('./requirement.js').RequirementChapter }
  | { kind: 'explain' }
  | { kind: 'map' }
  | { kind: 'hows'; how: number | null }
  | { kind: 'course'; course: number; at: CourseScreen }
  | { kind: 'diff'; file: string | null }
  | { kind: 'closing' };

/** latest = 最新の解析の説明タブ（/）。analysis の sha は headSha の先頭で、null はその key の最新のバージョン */
export type Route = { kind: 'prs' } | { kind: 'latest' } | { kind: 'analysis'; key: string; sha: string | null; page: Page };

const EXPLAIN: Page = { kind: 'explain' };

const SHA = /^[0-9a-f]{7,40}$/;

/** 0 以上の整数の文字だけ数にする */
const int = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function parseRoute(pathname: string, search: string): Route {
  const query = new URLSearchParams(search);
  const parts = pathname.split('/').filter((p) => p !== '').map(decode);
  if (parts.length === 0) {
    // 2026-11-04 までの CLI が出した /?pr=<key>
    const legacy = query.get('pr');
    return legacy === null ? { kind: 'latest' } : { kind: 'analysis', key: legacy, sha: null, page: EXPLAIN };
  }
  if (parts.length === 1 && parts[0] === 'prs') return { kind: 'prs' };
  const [head, ...tail] = parts;
  const place = head === 'local' ? { key: 'local', rest: tail } : head === 'pr' && tail[0] !== undefined ? { key: tail[0], rest: tail.slice(1) } : null;
  if (place === null) return { kind: 'latest' };
  const sha = place.rest[0] !== undefined && SHA.test(place.rest[0]) ? place.rest[0] : null;
  return { kind: 'analysis', key: place.key, sha, page: parsePage(sha === null ? place.rest : place.rest.slice(1), query) };
}

/** 解析の後ろのパス。読めなければ説明タブ */
function parsePage(rest: readonly string[], query: URLSearchParams): Page {
  const [name, id, sub] = rest;
  if (rest.length === 1) {
    if (name === 'map') return { kind: 'map' };
    if (name === 'hows') return { kind: 'hows', how: null };
    if (name === 'diff') return { kind: 'diff', file: query.get('file') };
    if (name === 'closing') return { kind: 'closing' };
  }
  if (name === 'req' && rest.length === 2) {
    if (id === 'start' || id === 'end') return { kind: 'req', chapter: id };
    const chapter = int(id);
    if (chapter !== null) return { kind: 'req', chapter };
  }
  const how = int(id);
  if (name === 'hows' && rest.length === 2 && how !== null) return { kind: 'hows', how };
  const course = int(id);
  if (name === 'course' && course !== null) {
    if (rest.length === 2) return { kind: 'course', course, at: { kind: 'brief' } };
    if (rest.length === 3 && sub === 'summary') return { kind: 'course', course, at: { kind: 'summary' } };
    const stop = int(sub);
    if (rest.length === 3 && stop !== null && stop >= 1) return { kind: 'course', course, at: { kind: 'stop', i: stop - 1 } };
  }
  return EXPLAIN;
}

export function formatRoute(route: Route): string {
  if (route.kind === 'prs') return '/prs';
  if (route.kind === 'latest') return '/';
  const base = route.key === 'local' ? '/local' : `/pr/${encodeURIComponent(route.key)}`;
  return `${base}${route.sha === null ? '' : `/${route.sha}`}${pagePath(route.page)}`;
}

function pagePath(page: Page): string {
  switch (page.kind) {
    case 'req':
      return `/req/${page.chapter}`;
    case 'explain':
    case 'map':
    case 'closing':
      return `/${page.kind}`;
    case 'hows':
      return page.how === null ? '/hows' : `/hows/${page.how}`;
    case 'course':
      return `/course/${page.course}${page.at.kind === 'brief' ? '' : page.at.kind === 'summary' ? '/summary' : `/${page.at.i + 1}`}`;
    case 'diff':
      // パスの / は読めるまま残す
      return page.file === null ? '/diff' : `/diff?file=${encodeURIComponent(page.file).replaceAll('%2F', '/')}`;
  }
}

/** 今の画面の URL。解析を読むまでは null（PR 一覧は解析が無くても /prs） */
export function routeOf(state: AppState): Route | null {
  if (state.view === 'prs') return { kind: 'prs' };
  if (state.current === null || state.analysis === null) return null;
  return { kind: 'analysis', key: state.current.key, sha: state.current.headSha.slice(0, 7), page: pageOf(state) };
}

function pageOf(state: AppState): Page {
  const c = state.course;
  switch (state.view) {
    case 'req':
      return { kind: 'req', chapter: state.requirement.chapter };
    case 'hows':
      return { kind: 'hows', how: state.selectedHow };
    case 'course':
      return c === null ? EXPLAIN : { kind: 'course', course: c.id, at: c.screen === 'stop' ? { kind: 'stop', i: c.i } : { kind: c.screen } };
    case 'diff':
      return { kind: 'diff', file: state.selectedFile };
    case 'closing':
      return { kind: 'closing' };
    default:
      return state.home.tab === 'map' ? { kind: 'map' } : EXPLAIN;
  }
}

/**
 * URL が指す解析と画面。sha の先頭が合うバージョン、無い・合わなければその key の最新のバージョン（一覧は新しい順）。
 * key が一覧に無い・/ は最新の解析の説明タブ。解析が 1 つも無ければ null
 */
export function routeTarget(analyses: readonly AnalysisSummary[], route: Exclude<Route, { kind: 'prs' }>): { summary: AnalysisSummary; page: Page } | null {
  const latest = analyses[0];
  if (latest === undefined) return null;
  if (route.kind === 'latest') return { summary: latest, page: EXPLAIN };
  const { sha } = route;
  const same = analyses.filter((a) => a.key === route.key);
  const summary = (sha === null ? undefined : same.find((a) => a.headSha.startsWith(sha))) ?? same[0];
  return summary === undefined ? { summary: latest, page: EXPLAIN } : { summary, page: route.page };
}

/**
 * 同じ履歴の 1 つか（同じ解析の同じ種類の画面。コースは同じコース）。違えば履歴を足し、同じなら書き換える（停留所・ファイル・絞り込みを移るたびに足さない）。
 * コースを替えたら足す（次のコースに進んでから戻ると、前のコースに戻る）
 */
export function sameEntry(a: Route, b: Route): boolean {
  if (a.kind !== 'analysis' || b.kind !== 'analysis') return a.kind === b.kind;
  if (a.page.kind === 'req' && b.page.kind === 'req' && a.page.chapter !== b.page.chapter) return false;
  if (a.page.kind === 'course' && b.page.kind === 'course' && a.page.course !== b.page.course) return false;
  return a.key === b.key && a.sha === b.sha && a.page.kind === b.page.kind;
}
