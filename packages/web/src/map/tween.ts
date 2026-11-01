// 地図の動き（2026-09-24 承認。見本 map.html v5）。画面の状態を 1 つのデータにして、from → to を 1 本のタイムラインで補間する。
// 残る物はその位置から滑り、消える物はその場で前半 40% で薄れ、現れる物は後半 40% で濃くなる。
// 図の大きさも同じタイムラインで動かす（倍率は動かさない。カメラを動かすと相対運動が読めない）。
import type { MapEdge } from './graph.js';
import type { Placed, Point, ViewLayout } from './layout.js';

/** 既定の動きの長さ（0.7 秒と比べて 1 秒にした）。設計書 18.3 の 100〜200ms とは別枠 */
export const DURATION_MS = 1000;
/** 消える物は t = 0..0.4 で薄れる */
export const FADE_OUT = 0.4;
/** 現れる物は t = 0.6..1 で濃くなる */
export const FADE_IN = 0.6;

export type NodeState = { x: number; y: number; o: number; v: Placed; seed: boolean };
export type EdgeState = { pts: Point[]; o: number; e: MapEdge; lab: string; on: boolean };
export type BandState = { top: number; o: number; label: string };

export interface MapState {
  W: number;
  H: number;
  nodes: Map<string, NodeState>;
  edges: Map<string, EdgeState>;
  bands: Map<string, BandState>;
}

export const edgeKey = (e: MapEdge) => `${e.from}>${e.to}`;

export function targetState(L: ViewLayout): MapState {
  const nodes = new Map<string, NodeState>();
  for (const [id, v] of L.nodeAt) nodes.set(id, { x: v.x, y: v.y, o: 1, v, seed: v.seed });
  const edges = new Map<string, EdgeState>();
  for (const p of L.paths) edges.set(edgeKey(p.e), { pts: p.pts, o: 1, e: p.e, lab: p.lab, on: p.on });
  const bands = new Map<string, BandState>();
  for (const b of L.bands) bands.set(b.b, { top: b.top, o: 1, label: b.label });
  return { W: L.width, H: L.height, nodes, edges, bands };
}

/** ease-in-out（3 次） */
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const fadeOut = (t: number) => 1 - clamp01(t / FADE_OUT);
const fadeIn = (t: number) => clamp01((t - FADE_IN) / (1 - FADE_IN));

/** 折れ線を長さに沿って N 点に採り直す。点の数が同じならそのまま（1:1 で補間できる） */
export function resample(pts: readonly Point[], N: number): Point[] {
  if (pts.length === N) return [...pts];
  const seg = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
  const total = seg[seg.length - 1] || 1;
  const out: Point[] = [];
  for (let j = 0; j < N; j++) {
    const s = (total * j) / (N - 1);
    let i = 1;
    while (i < seg.length - 1 && seg[i]! < s) i++;
    const a = pts[i - 1]!;
    const b = pts[i] ?? a;
    const len = seg[i]! - seg[i - 1]!;
    const k = len ? (s - seg[i - 1]!) / len : 0;
    out.push({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
  }
  return out;
}

/** t（0..1）の時点の状態 */
export function mix(from: MapState, to: MapState, t: number): MapState {
  const k = ease(clamp01(t));
  // 図の大きさ: 広がるときは最初から、縮むときは消える物が薄れ終わってから（薄れている途中の物を枠で切らない）
  const kLate = ease(clamp01((t - FADE_OUT) / (1 - FADE_OUT)));
  const size = (f: number, g: number) => Math.max(lerp(f, g, k), lerp(f, g, kLate));
  const s: MapState = { W: size(from.W, to.W), H: size(from.H, to.H), nodes: new Map(), edges: new Map(), bands: new Map() };

  for (const id of new Set([...from.nodes.keys(), ...to.nodes.keys()])) {
    const f = from.nodes.get(id);
    const g = to.nodes.get(id);
    if (f && g) s.nodes.set(id, { x: lerp(f.x, g.x, k), y: lerp(f.y, g.y, k), o: lerp(f.o, 1, k), v: g.v, seed: g.seed });
    else if (f) s.nodes.set(id, { ...f, o: f.o * fadeOut(t) });
    else if (g) s.nodes.set(id, { ...g, o: fadeIn(t) });
  }
  for (const key of new Set([...from.edges.keys(), ...to.edges.keys()])) {
    const f = from.edges.get(key);
    const g = to.edges.get(key);
    if (f && g) {
      const N = f.pts.length === g.pts.length ? f.pts.length : 16;
      const fp = resample(f.pts, N);
      const gp = resample(g.pts, N);
      s.edges.set(key, { pts: fp.map((p, i) => ({ x: lerp(p.x, gp[i]!.x, k), y: lerp(p.y, gp[i]!.y, k) })), o: lerp(f.o, 1, k), e: g.e, lab: g.lab, on: g.on });
    } else if (f) s.edges.set(key, { ...f, o: f.o * fadeOut(t) });
    else if (g) s.edges.set(key, { ...g, o: fadeIn(t) });
  }
  for (const b of new Set([...from.bands.keys(), ...to.bands.keys()])) {
    const f = from.bands.get(b);
    const g = to.bands.get(b);
    if (f && g) s.bands.set(b, { top: lerp(f.top, g.top, k), o: lerp(f.o, 1, k), label: g.label });
    else if (f) s.bands.set(b, { ...f, o: f.o * fadeOut(t) });
    else if (g) s.bands.set(b, { ...g, o: fadeIn(t) });
  }
  return s;
}
