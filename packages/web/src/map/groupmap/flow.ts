// 入口の地図にコースの道順を流す（設計書 3.1。2026-11-03 の見本 5 の 2 版）。純粋関数。
// 停留所を箱に載せ（テストの停留所は地図に無いので落とし、続く同じ箱は 1 歩にまとめる。古い地図の courseRoute と同じ規則）、
// いま見ている図のどの箱・まとまり・札に載るかを決め、停留所の番号と道順の線を組む。プログラムが停留所の並びから機械的に作る（原則 3）
import type { Analysis } from '@ondina/model';
import type { Course } from '../../course.js';
import type { PlacedItem, PlacedView } from './layout.js';
import { childUnder, portalOf, ROOT, type GroupTree, type ViewSpec } from './view.js';

/** 道順の 1 歩。番号は並びの順（1 から） */
export interface RouteStep {
  /** 停留所の箱（MapBox.id） */
  box: string;
  /** この歩にまとめた停留所（Course.steps の番号）。続く同じ箱の停留所は 1 歩 */
  stops: number[];
}

export interface MapRoute {
  steps: RouteStep[];
  /** 地図に無い停留所（テスト）の数 */
  off: number;
}

/** コースの停留所を箱に載せた道順 */
export function mapRouteOf(analysis: Analysis, tree: GroupTree, course: Course): MapRoute {
  const ofHunk = new Map<string, string>();
  for (const b of tree.boxes.values()) for (const h of b.hunkIds) ofHunk.set(h, b.id);
  const hunkOfSym = new Map(analysis.symbols.map((s) => [s.id, s.hunkId]));
  const steps: RouteStep[] = [];
  let off = 0;
  course.steps.forEach((s, k) => {
    // hunkId はコース外の停留所（symbolId = hunkId = hunk の id）、シンボルの停留所はそのシンボルの hunk から引く
    const box = [s.hunkId, hunkOfSym.get(s.symbolId)].map((h) => (h === undefined ? undefined : ofHunk.get(h))).find((b) => b !== undefined);
    if (box === undefined) {
      off++;
      return;
    }
    const last = steps[steps.length - 1];
    if (last?.box === box) last.stops.push(k);
    else steps.push({ box, stops: [k] });
  });
  return { steps, off };
}

/** 箱 x が、spec の図のどれに載るか（その図の箱、箱を含むまとまり、外なら札）。図に無ければ null */
export function itemAt(tree: GroupTree, spec: ViewSpec, x: string): string | null {
  const c = childUnder(tree, spec.at, x);
  if (c !== null) return c;
  const p = portalOf(tree, spec.at, x);
  return spec.items.some((it) => it.id === p) ? p : null;
}

/** x の上のまとまり（全景から順。x を含まない） */
function ancestors(tree: GroupTree, x: string): string[] {
  const out: string[] = [];
  for (let y = tree.parent.get(x); y !== undefined; y = y === ROOT ? undefined : tree.parent.get(y)) out.unshift(y);
  return out;
}

/** 箱たちを全部含む、いちばん深いまとまり（全景は ROOT） */
export function lcaOf(tree: GroupTree, boxes: readonly string[]): string {
  const cs = boxes.map((b) => ancestors(tree, b));
  if (cs.length === 0) return ROOT;
  let k = 0;
  while (cs.every((c) => k < c.length && c[k] === cs[0]![k])) k++;
  return k === 0 ? ROOT : cs[0]![k - 1]!;
}

/**
 * 今の歩（i = 0 は全部の歩）が、いま見ている図の外で起きているとき、移る先のまとまり。
 * under = 今の図の中のまとまり（「… の中で見る」）。そうでなければ外（「… で見る」）。図の中の箱・まとまりに載るなら外でも出さない
 */
export function whereTo(tree: GroupTree, spec: ViewSpec, boxes: readonly string[]): { to: string; under: boolean } | null {
  const to = lcaOf(tree, boxes);
  if (to === spec.at) return null;
  const under = to !== spec.at && (spec.at === ROOT || ancestors(tree, to).includes(spec.at));
  const here = boxes.some((b) => {
    const id = itemAt(tree, spec, b);
    return id !== null && spec.items.find((it) => it.id === id)?.kind !== 'portal';
  });
  if (!under && here) return null;
  return { to, under };
}

export type StepState = 'fut' | 'past' | 'cur';

/** 歩 n（1 から）の状態。i = 0（全部を見ている）は全部 fut */
export const stepState = (n: number, i: number): StepState => (i === 0 || n > i ? 'fut' : n < i ? 'past' : 'cur');

export interface RouteLine {
  /** 着く歩の番号 */
  n: number;
  pts: Array<[number, number]>;
  state: StepState;
}

export interface RouteDraw {
  /** 図の item → その item に載る歩の番号（左上の丸） */
  badges: Map<string, Array<{ n: number; state: StepState }>>;
  lines: RouteLine[];
  /** 今の歩が載る item（i = 0 か、図に無ければ null） */
  cur: { item: string; n: number; from: string | null } | null;
}

/** いまの図の上の停留所の番号と道順の線 */
export function routeDraw(tree: GroupTree, view: PlacedView, route: MapRoute, i: number): RouteDraw {
  const byId = new Map(view.items.map((it) => [it.id, it]));
  const badges = new Map<string, Array<{ n: number; state: StepState }>>();
  const lines: RouteLine[] = [];
  let cur: RouteDraw['cur'] = null;
  let prev: string | null = null;
  route.steps.forEach((s, k) => {
    const n = k + 1;
    const state = stepState(n, i);
    const b = itemAt(tree, view.spec, s.box);
    // 線と玉の向きは道順の並び（前の歩 → この歩）で決まり、← で戻ってきたときも同じ向き（どう動いて来たかでは変えない）
    const a = prev;
    prev = b;
    if (b === null) return;
    const list = badges.get(b) ?? [];
    // 同じ item に続けて載る歩も番号は全部出す（中に入れば別の箱に分かれる）
    list.push({ n, state });
    badges.set(b, list);
    if (a !== null && a !== b) lines.push({ n, pts: routePath(view, byId.get(a)!, byId.get(b)!), state });
    if (state === 'cur') cur = { item: b, n, from: a !== null && a !== b ? a : null };
  });
  return { badges, lines, cur };
}

/**
 * 2 つの item を結ぶ道順の折れ線（見本 5 の routePath）。
 * 箱の図（上から下に層の帯）: 同じ段なら上を回り、段が違えば出てすぐ折れる。まとまりの図（左から右）: 同じ列なら左を回り、列が違えば出てすぐ折れる
 */
export function routePath(view: PlacedView, A: PlacedItem, B: PlacedItem): Array<[number, number]> {
  const ax = A.x + A.w / 2;
  const ay = A.y + A.h / 2;
  const bx = B.x + B.w / 2;
  const by = B.y + B.h / 2;
  if (view.spec.kind === 'boxes') {
    if (Math.abs(A.y - B.y) < 12) {
      const y = Math.min(A.y, B.y) - 9;
      return [
        [ax, A.y],
        [ax, y],
        [bx, y],
        [bx, B.y],
      ];
    }
    const dn = B.y > A.y;
    const y1 = dn ? A.y + A.h : A.y;
    const ym = y1 + (dn ? 9 : -9);
    return [
      [ax, y1],
      [ax, ym],
      [bx, ym],
      [bx, dn ? B.y : B.y + B.h],
    ];
  }
  if (Math.abs(A.x - B.x) < 12) {
    const x = Math.min(A.x, B.x) - 10;
    return [
      [A.x, ay],
      [x, ay],
      [x, by],
      [B.x, by],
    ];
  }
  const rt = B.x > A.x;
  const x1 = rt ? A.x + A.w : A.x;
  const xm = x1 + (rt ? 13 : -13);
  return [
    [x1, ay],
    [xm, ay],
    [xm, by],
    [rt ? B.x : B.x + B.w, by],
  ];
}

/** 折れ線の上の割合 t（0〜1）の点。道順の玉を動かす */
export function along(pts: ReadonlyArray<readonly [number, number]>, t: number): [number, number] {
  const seg: number[] = [];
  let tot = 0;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]);
    seg.push(d);
    tot += d;
  }
  let d = t * tot;
  for (let k = 0; k < seg.length; k++) {
    if (d <= seg[k]! || k === seg.length - 1) {
      const u = seg[k] ? Math.min(1, d / seg[k]!) : 1;
      const p = pts[k]!;
      const q = pts[k + 1]!;
      return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
    }
    d -= seg[k]!;
  }
  const last = pts[pts.length - 1]!;
  return [last[0], last[1]];
}

/** 再生の速さの吸い付く値（見本 5）。0.08 以内ならその値に */
export const SPEED_SNAP = [0.5, 1, 1.5, 2, 2.5, 3] as const;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 3;
export const snapSpeed = (v: number): number => {
  const c = Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
  return SPEED_SNAP.find((x) => Math.abs(x - c) <= 0.08) ?? Math.round(c * 100) / 100;
};
/** 玉が 1 本の線を動く時間（ms） */
export const moveMs = (speed: number): number => 760 / speed;
/** 再生で次の歩へ移るまで（ms）。玉が着いて札を読む間を足す */
export const stepMs = (speed: number): number => (760 + 1100) / speed;
