// 地図の動き（2026-09-24 承認）: 1 本のタイムラインで、残る物は滑り、消える物はその場で薄れ、現れる物は後から濃くなる。
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../src/map/graph.js';
import { ease, FADE_IN, FADE_OUT, mix, resample, type MapState, type NodeState } from '../src/map/tween.js';

const n = (id: string): MapNode => ({ id, label: id, band: 'Domain', changed: true, group: false });
const node = (id: string, x: number, y: number): NodeState => ({ x, y, o: 1, v: { n: n(id), x, y, w: 150, h: 44 }, seed: false });
const edge = (from: string, to: string, pts: Array<[number, number]>) => ({ pts: pts.map(([x, y]) => ({ x, y })), o: 1, e: { from, to, kind: 'call' as const, n: 1, crosses: false }, lab: '', on: false });
const state = (W: number, H: number, nodes: NodeState[], edges: ReturnType<typeof edge>[] = []): MapState => ({
  W,
  H,
  nodes: new Map(nodes.map((q) => [q.v.n.id, q])),
  edges: new Map(edges.map((q) => [`${q.e.from}>${q.e.to}`, q])),
  bands: new Map(),
});

// 全体（大きい図）→ 絞った図（小さい図）。a は残って左上へ動く、b は消える、c は現れる
const from = state(1600, 1000, [node('a', 400, 300), node('b', 900, 600)], [edge('a', 'b', [[475, 344], [475, 470], [975, 470], [975, 600]])]);
const to = state(700, 400, [node('a', 24, 34), node('c', 300, 200)], [edge('a', 'c', [[99, 78], [375, 200]])]);

describe('mix', () => {
  it('t=0 は from、t=1 は to の位置と大きさ', () => {
    const s0 = mix(from, to, 0);
    expect(s0.nodes.get('a')).toMatchObject({ x: 400, y: 300 });
    expect([s0.W, s0.H]).toEqual([1600, 1000]);
    const s1 = mix(from, to, 1);
    expect(s1.nodes.get('a')).toMatchObject({ x: 24, y: 34, o: 1 });
    expect([s1.W, s1.H]).toEqual([700, 400]);
  });

  it('残る物は途中で連続的に動く（瞬間移動しない）', () => {
    const xs = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((t) => mix(from, to, t).nodes.get('a')!.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeLessThanOrEqual(xs[i - 1]!);
    expect(xs[3]).toBeCloseTo(212, 0);
  });

  it('消える物はその場で前半 40% のうちに薄れ切る', () => {
    const mid = mix(from, to, FADE_OUT / 2).nodes.get('b')!;
    expect(mid).toMatchObject({ x: 900, y: 600 });
    expect(mid.o).toBeCloseTo(0.5);
    expect(mix(from, to, FADE_OUT).nodes.get('b')!.o).toBe(0);
    expect(mix(from, to, FADE_OUT).edges.get('a>b')!.o).toBe(0);
  });

  it('現れる物は後半 40% で濃くなる（それまでは見えない）', () => {
    expect(mix(from, to, FADE_IN).nodes.get('c')!.o).toBe(0);
    expect(mix(from, to, 0.8).nodes.get('c')!.o).toBeCloseTo(0.5);
    expect(mix(from, to, 1).nodes.get('c')!.o).toBe(1);
  });

  it('縮むときは、消える物が薄れ終わるまで図の大きさを保つ。広がるときは最初から広げる', () => {
    expect(mix(from, to, FADE_OUT).W).toBe(1600);
    expect(mix(from, to, 0.7).W).toBeLessThan(1600);
    expect(mix(to, from, 0.2).W).toBeGreaterThan(700);
  });

  it('辺は点ごとに補間する。点の数が違えば 16 点に採り直す', () => {
    const f = state(100, 100, [node('a', 0, 0), node('b', 0, 0)], [edge('a', 'b', [[0, 0], [0, 100]])]);
    const g = state(100, 100, [node('a', 0, 0), node('b', 0, 0)], [edge('a', 'b', [[0, 0], [50, 0], [50, 100]])]);
    const mid = mix(f, g, 0.5).edges.get('a>b')!;
    expect(mid.pts).toHaveLength(16);
    expect(mid.o).toBe(1);
  });
});

describe('resample', () => {
  it('両端を保って N 点にする。同じ数ならそのまま', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const r = resample(pts, 5);
    expect(r).toHaveLength(5);
    expect(r[0]).toEqual({ x: 0, y: 0 });
    expect(r[2]).toEqual({ x: 100, y: 0 });
    expect(r[4]).toEqual({ x: 100, y: 100 });
    expect(resample(pts, 3)).toEqual(pts);
  });
});

describe('ease', () => {
  it('0 → 0、0.5 → 0.5、1 → 1 で、両端がゆっくり', () => {
    expect([ease(0), ease(0.5), ease(1)]).toEqual([0, 0.5, 1]);
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });
});
