import { describe, it, expect } from 'vitest';
import { parseRoute, formatRoute, sameEntry, routeOf } from '../src/route.js';
import { initialState, reduce } from '../src/state/reducer.js';
import { emptyReview } from './fixture.js';
import { requirementAnalysis } from './requirementFixture.js';

it.each(['start', '0', '7', 'end'])('roundtrips requirement route %s', (part) => {
  const chapter = /^\d+$/.test(part) ? Number(part) : part;
  const path = `/pr/42/abcdef0/req/${part}`;
  const route = parseRoute(path, '');
  expect(route).toMatchObject({ page: { kind: 'req', chapter } });
  expect(formatRoute(route)).toBe(path);
});
describe('requirement history', () => {
  it('adds entries between chapters and restores through route.go', () => {
    const a = requirementAnalysis();
    let s = reduce(initialState(), { id: 'data.loaded', analysis: a, review: emptyReview(), summary: { key: '42', headSha: a.pr.headSha, pr: a.pr, mtime: 1, repoName: 'order-service' } }).state;
    s = reduce(s, { id: 'route.go', page: { kind: 'req', chapter: 0 } }).state;
    expect(s).toMatchObject({ view: 'req', requirement: { chapter: 0 } });
    expect(routeOf(s)).toMatchObject({ page: { kind: 'req', chapter: 0 } });
    expect(sameEntry(parseRoute('/pr/42/req/0', ''), parseRoute('/pr/42/req/1', ''))).toBe(false);
    s = reduce(s, { id: 'route.go', page: { kind: 'req', chapter: 999 } }).state;
    expect(s.view).toBe('home');
  });
});
