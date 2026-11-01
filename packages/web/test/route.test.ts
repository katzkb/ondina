// 入口の地図の道順（設計書 3.1）。選んだコースの停留所の箱を順に結ぶ。承認したデモの hubMap と同じ規則。
import { describe, expect, it } from 'vitest';
import { courseOf, courses, OUTSIDE } from '../src/course.js';
import { buildGraph, mapNodeOf, REL_PREFIX } from '../src/map/graph.js';
import { courseKeep, courseRoute, routePoints } from '../src/map/route.js';
import { fixtureAnalysis } from './fixture.js';

const a = fixtureAnalysis();
const present = new Set(buildGraph(a, null).nodes.map((n) => n.id));
const route = (id: number) => courseRoute(a, courseOf(courses(a), id)!, present);

describe('courseRoute', () => {
  it('停留所の箱を順に並べる。束のメンバーは束の箱、地図に無い箱（テスト）は落とし、続く同じ箱は 1 つにする', () => {
    const boxOf = mapNodeOf(a);
    for (const c of courses(a)) {
      const r = route(c.id);
      const want = c.steps.map((s) => boxOf(s.symbolId)).filter((id) => present.has(id));
      expect(r.length, `コース ${c.id}`).toBeLessThanOrEqual(want.length);
      expect(r.every((id) => present.has(id))).toBe(true);
      for (let i = 1; i < r.length; i++) expect(r[i], `コース ${c.id}`).not.toBe(r[i - 1]);
      // 並びは停留所の順
      expect(r.map((id) => want.indexOf(id))).toEqual([...r.map((id) => want.indexOf(id))].sort((x, y) => x - y));
    }
  });

  it('fixture: コース 1 は 1 箱、コース 5 は停留所 9 のうちテストを落とした箱', () => {
    expect(route(1)).toHaveLength(1);
    const c5 = courseOf(courses(a), 5)!;
    const tests = new Set(a.hunks.filter((h) => h.kind === 'test').map((h) => h.id));
    expect(route(5).some((id) => tests.has(id))).toBe(false);
    expect(route(5).length).toBeLessThan(c5.steps.length);
    expect(route(5).length).toBeGreaterThan(1);
  });

  it('コース外は未帰属の hunk の箱', () => {
    expect(route(OUTSIDE).length).toBeGreaterThan(0);
  });
});

describe('courseKeep', () => {
  it('道順の箱と、そのコースの差分の箱を残す（他は沈める）', () => {
    const c3 = courseOf(courses(a), 3)!;
    const keep = courseKeep(a, c3, route(3), present);
    const boxOf = mapNodeOf(a);
    for (const id of route(3)) expect(keep.has(id)).toBe(true);
    for (const h of c3.hunkIds) if (present.has(boxOf(h))) expect(keep.has(boxOf(h))).toBe(true);
    expect(keep.size).toBeLessThan(present.size);
  });

  it('残す箱の「差分なし n か所」も残す（コース 5 の execute の Domain の相手）。ほかの箱のは沈める', () => {
    const exec = a.symbols.find((s) => s.fqName.endsWith('ApplyDiscountUseCase.execute'))!.id;
    const apply = a.symbols.find((s) => s.fqName.endsWith('OrderController.apply'))!.id;
    const keep = courseKeep(a, courseOf(courses(a), 5)!, route(5), present);
    expect(keep.has(`${REL_PREFIX}${exec}:Domain`)).toBe(true);
    expect(keep.has(`${REL_PREFIX}${apply}:Domain`)).toBe(false);
  });
});

describe('routePoints', () => {
  const box = (x: number, y: number) => ({ x, y, w: 100, h: 40 });

  it('同じ段の箱は、左の箱の右端から右の箱の左端へ直線', () => {
    expect(routePoints(box(0, 0), box(200, 0))).toEqual([
      { x: 100, y: 20 },
      { x: 200, y: 20 },
    ]);
    expect(routePoints(box(200, 0), box(0, 0))).toEqual([
      { x: 200, y: 20 },
      { x: 100, y: 20 },
    ]);
  });

  it('段が違う箱は、下辺（上辺）の中央から出て、間の高さで折れる', () => {
    expect(routePoints(box(0, 0), box(300, 100))).toEqual([
      { x: 50, y: 40 },
      { x: 50, y: 70 },
      { x: 350, y: 70 },
      { x: 350, y: 100 },
    ]);
    expect(routePoints(box(300, 100), box(0, 0))).toEqual([
      { x: 350, y: 100 },
      { x: 350, y: 70 },
      { x: 50, y: 70 },
      { x: 50, y: 40 },
    ]);
  });
});
