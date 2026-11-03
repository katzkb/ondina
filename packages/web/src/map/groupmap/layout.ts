// 入口の地図の 1 枚の配置（見本 5 の view()）。elkjs は呼ぶ側から渡す（ブラウザでは Web Worker、テストでは elk.bundled）。
// 箱の図は上から下（層の帯ごとに partition）、まとまりの図は左から右。線の無いものは自前で並べる（elkjs は孤立したものに partition を効かせない）。
// 上向きの線（下の帯 → 上の帯）は逆にして渡し、描くときに戻す（map/layout.ts と同じ穴）
import type { ElkLike } from '../layout.js';
import type { ViewEdge, ViewItem, ViewSpec } from './view.js';

export interface PlacedItem extends ViewItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedEdge extends ViewEdge {
  pts: Array<[number, number]>;
}

export interface PlacedView {
  spec: ViewSpec;
  w: number;
  h: number;
  items: PlacedItem[];
  edges: PlacedEdge[];
  /** 箱の図だけ: 帯の名前と上端 */
  bands: Array<{ layer: number; y: number }>;
}

/** 名前の幅。ASCII は 7px（11.5px の等幅）、それ以外は 12.5px */
export const textW = (s: string): number => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) < 128 ? 7 : 12.5), 0);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export const GROUP_W = 196;
export const GROUP_H = 116;
const BOX_MIN = 160;
const BOX_MAX = 240;

/** 箱・まとまり・札の大きさ。札は名前（portalName）の長さで決める */
export function sizeOf(it: ViewItem, portalName: string): { w: number; h: number } {
  if (it.kind === 'group') return { w: GROUP_W, h: GROUP_H };
  if (it.kind === 'portal') return { w: clamp(textW(portalName) + 34, 110, 320), h: 28 };
  const nw = textW(it.short ?? '');
  const w = clamp(Math.ceil(nw) + 24, BOX_MIN, BOX_MAX);
  const lines = nw > w - 22 ? 2 : 1;
  // 上の札の行 18 + 名前 15 × 行 + 2 行目 15 + 余白 10
  return { w, h: 18 + lines * 15 + 15 + 12 };
}

export async function layoutView(spec: ViewSpec, elk: ElkLike, portalName: (id: string) => string): Promise<PlacedView> {
  const down = spec.kind === 'boxes';
  const list: PlacedItem[] = spec.items.map((it) => ({ ...it, ...sizeOf(it, portalName(it.id)), x: 0, y: 0 }));
  const byId = new Map(list.map((it) => [it.id, it]));
  const linked = new Set(spec.edges.flatMap((e) => [e.a, e.b]));
  const conn = list.filter((it) => linked.has(it.id));
  const loose = list.filter((it) => !linked.has(it.id));
  const up = (e: ViewEdge) => down && byId.get(e.a)!.layer > byId.get(e.b)!.layer;
  const res = conn.length
    ? await elk.layout({
        id: 'root',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': down ? 'DOWN' : 'RIGHT',
          'elk.partitioning.activate': String(down),
          'elk.layered.spacing.nodeNodeBetweenLayers': down ? '40' : '52',
          'elk.spacing.nodeNode': down ? '18' : '20',
          'elk.spacing.edgeNode': '14',
          'elk.spacing.edgeEdge': '8',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.padding': `[top=${down ? 28 : 12},left=${down ? 10 : 34},bottom=14,right=10]`,
          'elk.separateConnectedComponents': String(!down),
          'elk.aspectRatio': '1.4',
          'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
        },
        children: conn.map((it) => ({ id: it.id, width: it.w, height: it.h, ...(down ? { layoutOptions: { 'elk.partitioning.partition': String(it.layer) } } : {}) })),
        edges: spec.edges.map((e, i) => (up(e) ? { id: `e${i}`, sources: [e.b], targets: [e.a] } : { id: `e${i}`, sources: [e.a], targets: [e.b] })),
      })
    : { id: 'root', width: 0, height: 0, children: [], edges: [] };
  for (const c of res.children ?? []) {
    const it = byId.get(c.id)!;
    it.x = Math.round(c.x ?? 0);
    it.y = Math.round(c.y ?? 0);
  }
  let W = res.width ?? 0;
  let H = res.height ?? 0;
  if (!down && conn.length) {
    // まとまりの図: 線の無いまとまりは右の列に、下から積む
    let y = 12;
    const x = Math.round(W) + 8;
    for (const it of loose) {
      it.x = x;
      it.y = y;
      y += it.h + 20;
      W = Math.max(W, it.x + it.w + 10);
      H = Math.max(H, y);
    }
  } else if (down) {
    // 箱の図: 線の無い箱は、その帯の箱の右へ並べる。線のある箱が無い帯は、下に帯ごとの行を足す（帯の順）
    const right = new Map<number, number>();
    const top = new Map<number, number>();
    for (const c of conn) {
      right.set(c.layer, Math.max(right.get(c.layer) ?? 0, c.x + c.w + 18));
      top.set(c.layer, Math.min(top.get(c.layer) ?? Infinity, c.y));
    }
    let next = conn.length ? H + 28 : 28;
    const rowH = new Map<number, number>();
    for (const it of [...loose].sort((p, q) => p.layer - q.layer)) {
      if (!top.has(it.layer)) {
        top.set(it.layer, next);
        right.set(it.layer, 10);
      }
      it.x = Math.round(right.get(it.layer)!);
      it.y = Math.round(top.get(it.layer)!);
      right.set(it.layer, it.x + it.w + 18);
      rowH.set(it.layer, Math.max(rowH.get(it.layer) ?? 0, it.h));
      if (!conn.some((c) => c.layer === it.layer)) next = it.y + rowH.get(it.layer)! + 40;
      W = Math.max(W, it.x + it.w + 10);
      H = Math.max(H, it.y + it.h + 14);
    }
  } else {
    let x = 12;
    for (const it of loose) {
      it.x = x;
      it.y = 12;
      x += it.w + 20;
      W = Math.max(W, x);
      H = Math.max(H, it.y + it.h + 14);
    }
  }
  const edges: PlacedEdge[] = spec.edges.map((e, i) => {
    const s = res.edges?.[i]?.sections?.[0];
    let pts: Array<[number, number]> = s ? [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => [Math.round(p.x), Math.round(p.y)]) : [];
    if (up(e)) pts = pts.reverse();
    for (const [x, y] of pts) {
      W = Math.max(W, x + 10);
      H = Math.max(H, y + 10);
    }
    return { ...e, pts };
  });
  // 帯の線は、その帯の一番上の箱の少し上。2 段以上の帯を同じ高さに引かない
  const bands: PlacedView['bands'] = [];
  if (down) {
    const layers = [...new Set(list.map((it) => it.layer))].sort((a, b) => a - b);
    for (const L of layers) bands.push({ layer: L, y: Math.min(...list.filter((it) => it.layer === L).map((it) => it.y)) - 20 });
  }
  return { spec, w: Math.ceil(W), h: Math.ceil(H), items: list, edges, bands };
}

/** 線の一番長い区間の中点（本数の札を置く所） */
export function midOf(pts: ReadonlyArray<readonly [number, number]>): [number, number] {
  let best = -1;
  let bi = 1;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.abs(pts[k]![0] - pts[k - 1]![0]) + Math.abs(pts[k]![1] - pts[k - 1]![1]);
    if (d > best) {
      best = d;
      bi = k;
    }
  }
  const a = pts[bi - 1] ?? [0, 0];
  const b = pts[bi] ?? a;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
