// 要求コース PR 8: チケットのある PR（chapters がある解析）から、目的ごとのコースの名残を片付ける。チケットの無い PR は今のまま。
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { meter } from '../src/meter.js';
import { paletteItems } from '../src/palette.js';
import { parseRoute, routeOf } from '../src/route.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';
import { requirementAnalysis } from './requirementFixture.js';

function load(analysis = requirementAnalysis(), view?: 'closing'): AppState {
  analysis.pr.number = 42;
  return reduce(initialState(), { id: 'data.loaded', analysis, review: emptyReview(), summary: { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' }, ...(view ? { view } : {}) }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((s, c) => reduce(s, c).state, s);

describe('チケットのある PR: 目的ごと・締めは要求コースへ', () => {
  it('view.hows は「はじめに」、view.closing は最後のページ', () => {
    expect(run(load(), { id: 'view.hows' })).toMatchObject({ view: 'req', requirement: { chapter: 'start' } });
    expect(run(load(), { id: 'view.closing' })).toMatchObject({ view: 'req', requirement: { chapter: 'end' } });
  });
  it('URL の /hows と /closing も同じ（route.go）', () => {
    const hows = parseRoute('/pr/42/abcdef0/hows', '');
    const how3 = parseRoute('/pr/42/abcdef0/hows/3', '');
    const closing = parseRoute('/pr/42/abcdef0/closing', '');
    for (const [route, chapter] of [[hows, 'start'], [how3, 'start'], [closing, 'end']] as const) {
      if (route.kind !== 'analysis') throw new Error('route');
      const s = run(load(), { id: 'route.go', page: route.page });
      expect(s).toMatchObject({ view: 'req', requirement: { chapter } });
      expect(routeOf(s)).toMatchObject({ page: { kind: 'req', chapter } });
    }
  });
  it('AI レビューの「見る」で着く締め（data.loaded の view）も最後のページ', () => {
    expect(load(requirementAnalysis(), 'closing')).toMatchObject({ view: 'req', requirement: { chapter: 'end' } });
  });
  it('パレットに目的ごと（How）を出さない', () => {
    expect(paletteItems(requirementAnalysis()).some((i) => i.kind === 'how')).toBe(false);
    expect(paletteItems(fixtureAnalysis()).some((i) => i.kind === 'how')).toBe(true);
  });
});

describe('チケットの無い PR は今のまま', () => {
  it('view.hows / view.closing / /hows / /closing', () => {
    const s = load(fixtureAnalysis());
    expect(run(s, { id: 'view.hows' }).view).toBe('hows');
    expect(run(s, { id: 'view.closing' }).view).toBe('closing');
    expect(run(s, { id: 'route.go', page: { kind: 'hows', how: null } }).view).toBe('hows');
    expect(run(s, { id: 'route.go', page: { kind: 'closing' } }).view).toBe('closing');
    expect(load(fixtureAnalysis(), 'closing').view).toBe('closing');
  });
  it('メーターに要求は無い', () => {
    expect(meter(fixtureAnalysis(), []).requirements).toBeUndefined();
  });
});

describe('要求 n/m（上の帯）', () => {
  it('m は差分のある要求の数、n はその hunk が全部見た（わかった・聞く）の数。差分が見つからない要求は数えない', () => {
    const a = requirementAnalysis();
    // fixture: 要求 6 件のうち差分があるのは 5 件（s5 は差分なし）
    expect(meter(a, []).requirements).toEqual({ n: 0, total: 5 });
    const chapter = a.chapters![1]!;
    expect(meter(a, chapter.hunkIds).requirements).toEqual({ n: 1, total: 5 });
    expect(meter(a, chapter.hunkIds.slice(1)).requirements).toEqual({ n: 0, total: 5 });
    // つられた所・要求の外を見ても要求は進まない
    expect(meter(a, a.chapters!.at(-1)!.hunkIds.filter((id) => !chapter.hunkIds.includes(id))).requirements?.n).toBe(0);
  });
});
