// 流れの地図の配置（見本 flow5）。箱を elkjs の layered で上から下へ組み、層を帯に固定する（partition）。線は直角。
// 間隔は見本どおり: 箱の間 100px、層の間 70px、平行な線 9px。収まらなければ縮めずにスクロールする（画面の側）。
// 配置は流れごとに 1 回（② の全部の呼び出しで組む）。段を替えても箱は動かない。ここは幾何の計算だけで、事実は足さない（原則 5）
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import type { CallFlow } from '@ondina/model';
import { textWidth, type ElkLike } from '../layout.js';
import type { FlowBox, FlowFacts } from './boxes.js';
import { allCalls } from './steps.js';

export type Pt = [number, number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlowLayout {
  w: number;
  h: number;
  boxes: Map<string, Rect>;
  /** 呼び出し（FlowCall.key）→ 線の点。同じ箱の中の呼び出しと根には無い */
  edges: Map<string, Pt[]>;
  /** 根の線（上の呼び出し元の点 → 入口の箱） */
  entry: Pt[];
  /** 帯の境目の点線（上から） */
  bands: Array<{ name: string; y: number }>;
}

/** 見本の間隔 */
export const GAP = { box: 100, layer: 70, edge: 9, edgeBox: 18 } as const;
const PAD = { top: 64, left: 32, right: 32, bottom: 40 };
export const BOX_HEAD = 30;
export const BOX_LINE = 18;

/** 箱の大きさ。幅は名前（札の分を足す）とメンバーの長い方、210〜520px */
export function boxSize(b: FlowBox): { w: number; h: number } {
  const name = textWidth(b.name) * (12.5 / 11.5) + 96;
  const mem = Math.max(0, ...b.members.map((m) => textWidth(m.name) + 40));
  return { w: Math.round(Math.max(210, Math.min(520, Math.max(name, mem) + 24))), h: BOX_HEAD + BOX_LINE * Math.max(1, b.members.length) + 10 };
}

export async function flowLayout(flow: CallFlow, facts: FlowFacts, elk: ElkLike): Promise<FlowLayout> {
  const bandIdx = new Map(facts.bands.map((b, i) => [b, i]));
  const band = new Map(facts.boxes.map((b) => [b.id, bandIdx.get(b.band) ?? 0]));
  const size = new Map(facts.boxes.map((b) => [b.id, boxSize(b)]));
  const calls = allCalls(flow).filter((c) => c.from !== null && facts.boxIdOf.get(c.from) !== facts.boxIdOf.get(c.to));
  const ends = (k: number) => {
    const c = calls[k]!;
    return [facts.boxIdOf.get(c.from!)!, facts.boxIdOf.get(c.to)!] as const;
  };
  // 上向きの線（下の帯 → 上の帯）は向きを逆にして渡し、描くときに戻す
  const up = (k: number) => {
    const [a, b] = ends(k);
    return band.get(a)! > band.get(b)!;
  };
  const input: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.partitioning.activate': 'true',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(GAP.box),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(GAP.layer),
      'elk.spacing.edgeEdge': String(GAP.edge),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(GAP.edge),
      'elk.spacing.edgeNode': String(GAP.edgeBox),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(GAP.edgeBox),
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.separateConnectedComponents': 'false',
      'elk.padding': `[top=${PAD.top},left=${PAD.left},bottom=${PAD.bottom},right=${PAD.right}]`,
    },
    children: facts.boxes.map((b) => ({ id: b.id, width: size.get(b.id)!.w, height: size.get(b.id)!.h, layoutOptions: { 'elk.partitioning.partition': String(band.get(b.id)!) } })),
    edges: calls.map((_, k) => {
      const [a, b] = ends(k);
      const [s, t] = up(k) ? [b, a] : [a, b];
      return { id: `e${k}`, sources: [s], targets: [t] };
    }),
  };
  const res = await elk.layout(input);
  const boxes = new Map<string, Rect>();
  for (const c of res.children ?? []) boxes.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0 });
  const edges = new Map<string, Pt[]>();
  let maxX = res.width ?? 0;
  let maxY = res.height ?? 0;
  for (const le of res.edges ?? []) {
    const k = Number(le.id.slice(1));
    const sec = le.sections?.[0];
    if (!sec) continue;
    let pts: Pt[] = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => [p.x, p.y]);
    if (up(k)) pts = pts.reverse();
    for (const [x, y] of pts) {
      maxX = Math.max(maxX, x + PAD.right);
      maxY = Math.max(maxY, y + PAD.bottom);
    }
    edges.set(calls[k]!.key, pts);
  }
  const root = boxes.get(facts.boxIdOf.get(flow.root.to) ?? '');
  const entry: Pt[] = root ? [[root.x + root.w / 2, root.y - 30], [root.x + root.w / 2, root.y]] : [];
  // 帯の境目: 上の帯の下端と下の帯の上端の真ん中。いちばん上は図の上
  const range = facts.bands.map((name) => {
    const mine = facts.boxes.filter((b) => b.band === name).map((b) => boxes.get(b.id)!);
    return { name, top: Math.min(...mine.map((r) => r.y)), bot: Math.max(...mine.map((r) => r.y + r.h)) };
  });
  const bands = range.map((r, i) => ({ name: r.name, y: i === 0 ? 6 : Math.round((range[i - 1]!.bot + r.top) / 2) }));
  return { w: Math.ceil(maxX), h: Math.ceil(maxY), boxes, edges, entry, bands };
}

/** 戻りの線: 同じ道を逆に、少しずらす（縦の区間は横へ、横の区間は縦へ d だけ） */
export function returnPath(pts: readonly Pt[], d = GAP.edge): Pt[] {
  return pts
    .map(([x, y], i): Pt => {
      const p = pts[Math.max(i - 1, 0)]!;
      const n = pts[Math.min(i + 1, pts.length - 1)]!;
      const horiz = (i > 0 && p[1] === y) || (i < pts.length - 1 && n[1] === y);
      const vert = (i > 0 && p[0] === x) || (i < pts.length - 1 && n[0] === x);
      return [x + (vert ? d : 0), y + (horiz ? d : 0)];
    })
    .reverse();
}

/** 線の上の t（0〜1）の位置。長さで割る */
export function along(pts: ReadonlyArray<readonly [number, number]>, t: number): [number, number] {
  if (pts.length === 0) return [0, 0];
  if (pts.length === 1) return [pts[0]![0], pts[0]![1]];
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    seg.push(l);
    total += l;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i]! || i === seg.length - 1) {
      const f = seg[i]! === 0 ? 0 : Math.min(1, d / seg[i]!);
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    d -= seg[i]!;
  }
  return [pts[pts.length - 1]![0], pts[pts.length - 1]![1]];
}

/** 札を置く所: いちばん長い区間の真ん中 */
export function midOf(pts: readonly Pt[]): Pt {
  let best: Pt = pts[0] ?? [0, 0];
  let len = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.abs(pts[i + 1]![0] - pts[i]![0]) + Math.abs(pts[i + 1]![1] - pts[i]![1]);
    if (l > len) {
      len = l;
      best = [(pts[i]![0] + pts[i + 1]![0]) / 2, (pts[i]![1] + pts[i + 1]![1]) / 2];
    }
  }
  return best;
}

/** 再生の速さ（ui.mapSpeed）。0.5 刻みの近くに吸い付く */
export const SPEED_SNAP = [0.5, 1, 1.5, 2, 2.5, 3] as const;
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 3;
export const snapSpeed = (v: number): number => {
  const x = Math.max(SPEED_MIN, Math.min(SPEED_MAX, v));
  const near = SPEED_SNAP.find((s) => Math.abs(s - x) <= 0.08);
  return near ?? Math.round(x * 100) / 100;
};
/** 玉が 1 本の線を走る時間 */
export const moveMs = (speed: number): number => 760 / speed;
/** 再生で次のステップへ移るまで（走る + 止まって読む） */
export const stepMs = (speed: number): number => (760 + 1100) / speed;
