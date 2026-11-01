// 地図の配置（設計書 3.3）。全体を elkjs で 1 回だけ組み（baseLayout）、How で絞ったときは並びを保ったまま詰める（scopeView）。
// elkjs は呼ぶ側から渡す（ブラウザでは Web Worker、テストでは elk.bundled）。ここは幾何の計算だけで、事実は足さない（原則 5）。
// 2026-09-24 に見本で踏んだ穴を塞いである: 島を別々に組まない / 上向きの辺は逆にして渡す / 図の幅・高さは辺の点も含める。
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { relLabel, relSub, type MapEdge, type MapGraph, type MapNode, type RelGroup } from './graph.js';
import { offAt, packer, type Packed } from './pack.js';

export interface Point {
  x: number;
  y: number;
}

export interface Placed {
  n: MapNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BaseLayout {
  bands: string[];
  nodeAt: Map<string, Placed>;
  geom: Array<{ e: MapEdge; pts: Point[] }>;
}

export interface ViewLayout {
  width: number;
  height: number;
  nodeAt: Map<string, Placed & { seed: boolean }>;
  paths: Array<{ e: MapEdge; pts: Point[]; lab: string; on: boolean }>;
  bands: Array<{ b: string; top: number; label: string }>;
}

export interface ElkLike {
  layout(graph: ElkNode): Promise<ElkNode>;
}

// 箱の幅: 1 文字 6.9px（11.5px の等幅フォントの実測）で名前の長さから決め、150〜268px に収める。
// 上限を超える名前は draw.ts の clip() が「…」で切る。Kotlin の Class.member が 1 行に収まる幅で決めた（2026-09-24 の見本）。言語を足すときに見直す
export const CH = 6.9;
const TOP = 34;
const LEFT = 24;
const BAND_GAP = 44;

/** 日本語を含む文字列の幅。ASCII は CH、それ以外は 1 文字 11.5px（11.5px のフォントの全角）。「差分なし」の箱の文に使う */
export const textWidth = (t: string) => [...t].reduce((w, ch) => w + (ch.charCodeAt(0) < 128 ? CH : 11.5), 0);

/** 差分の箱と、右隣の「差分なし n か所」（side）の間。線 1 本と矢印が入る幅 */
export const SIDE_GAP = 46;

/** 「差分なし n か所」の箱の幅。1 行目（11.5px）と 2 行目（10px）の長い方で計り、最小 130 */
export const relWidth = (g: RelGroup) => Math.max(130, Math.ceil(Math.max(textWidth(relLabel(g)), (textWidth(relSub(g)) * 10) / 11.5) + 24));

/** 箱そのものの幅（右隣の side を含まない）。描くときの枠の幅 */
export const coreWidth = (n: MapNode) => (n.rel ? relWidth(n.rel) : Math.max(150, Math.min(268, n.label.length * CH + (n.testCount ? 58 : 26))));

/** 配置で使う幅。side のある箱は右隣のまとまりの分も含める（elkjs には 1 つの箱として渡す） */
export const nodeWidth = (n: MapNode) => coreWidth(n) + (n.side ? SIDE_GAP + relWidth(n.side) : 0);
export const nodeHeight = (n: MapNode) => (n.sub || n.rel ? 52 : 44);

/** 全体の配置。辺のあるノードだけ elkjs に渡し、辺の無いノードは自前でバンドに流す（elkjs は孤立ノードに partition を効かせない） */
export async function baseLayout(graph: MapGraph, elk: ElkLike): Promise<BaseLayout> {
  const { nodes, edges, bands } = graph;
  const bandIdx = (n: MapNode) => Math.max(0, bands.indexOf(n.band));
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const conn = nodes.filter((n) => linked.has(n.id));
  const loose = nodes.filter((n) => !linked.has(n.id));
  const bandOf = new Map(nodes.map((n) => [n.id, bandIdx(n)]));
  // 上向きの辺（下のバンド → 上のバンド）は向きを逆にして渡し、描くときに戻す。絞って詰めたときの経路が素直になる
  const up = (e: MapEdge) => bandOf.get(e.from)! > bandOf.get(e.to)!;
  const hasSide = new Set(conn.filter((n) => n.side).map((n) => n.id));
  const input: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.partitioning.activate': 'true',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '20',
      'elk.spacing.edgeNode': '18',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=34,left=24,bottom=24,right=24]',
      // 繋がっていない島も 1 枚で組む。別々に組むと島にはバンドが効かず、バンドの縦範囲が図全体に広がる
      'elk.separateConnectedComponents': 'false',
    },
    children: conn.map((n) => (n.side ? sidePorts(n, bandIdx(n)) : { id: n.id, width: nodeWidth(n), height: nodeHeight(n), layoutOptions: { 'elk.partitioning.partition': String(bandIdx(n)) } })),
    edges: edges.map((e, i) => {
      const [a, b] = up(e) ? [e.to, e.from] : [e.from, e.to];
      return { id: `e${i}`, sources: [hasSide.has(a) ? `${a}${PORT}s` : a], targets: [hasSide.has(b) ? `${b}${PORT}n` : b] };
    }),
  };
  const res: ElkNode = conn.length > 0 ? await elk.layout(input) : { id: 'root', width: 600, height: 120, children: [], edges: [] };

  const pos = new Map((res.children ?? []).map((c) => [c.id, c]));
  const range = new Map<string, { top: number; bot: number }>();
  for (const n of conn) {
    const q = pos.get(n.id);
    if (!q) continue;
    const r = range.get(n.band) ?? { top: Infinity, bot: -Infinity };
    r.top = Math.min(r.top, q.y ?? 0);
    r.bot = Math.max(r.bot, (q.y ?? 0) + (q.height ?? 0));
    range.set(n.band, r);
  }
  // バンドを上から積み直す。elkjs の縦位置をバンドごとにずらし、辺の無いノードはバンドの下に横に流す
  const present = bands.filter((b) => range.has(b) || loose.some((n) => n.band === b));
  const offset = new Map<string, number>();
  const placed: Placed[] = [];
  const lineWidth = Math.max(700, (res.width ?? 700) - LEFT);
  let cursor = TOP;
  for (const b of present) {
    const r = range.get(b);
    offset.set(b, cursor - (r ? r.top : cursor));
    let h = r ? r.bot - r.top : 0;
    const mine = loose.filter((n) => n.band === b);
    if (mine.length > 0) {
      let x = LEFT;
      let y = cursor + (r ? h + 14 : 0);
      let rowEnd = 0;
      for (const n of mine) {
        const w = nodeWidth(n);
        if (x + w > lineWidth) {
          x = LEFT;
          y += 54;
        }
        placed.push({ n, x, y, w, h: nodeHeight(n) });
        x += w + 12;
        rowEnd = Math.max(rowEnd, y + nodeHeight(n));
      }
      h = rowEnd + 8 - cursor;
    }
    cursor += h + BAND_GAP;
  }
  // 辺の点は、いちばん近いバンドのずらし量に従う
  const shift = (y: number) => {
    let best = present[0];
    let bd = Infinity;
    for (const b of present) {
      const r = range.get(b);
      if (!r) continue;
      const d = y < r.top ? r.top - y : y > r.bot ? y - r.bot : 0;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return y + (best === undefined ? 0 : (offset.get(best) ?? 0));
  };

  const nodeAt = new Map<string, Placed>();
  for (const n of conn) {
    const q = pos.get(n.id);
    if (q) nodeAt.set(n.id, { n, x: q.x ?? 0, y: (q.y ?? 0) + (offset.get(n.band) ?? 0), w: q.width ?? nodeWidth(n), h: q.height ?? nodeHeight(n) });
  }
  for (const q of placed) nodeAt.set(q.n.id, q);

  const geom: BaseLayout['geom'] = [];
  for (const le of res.edges ?? []) {
    const e = edges[Number(le.id.slice(1))]!;
    for (const sec of le.sections ?? []) {
      const pts = [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({ x: p.x, y: shift(p.y) }));
      if (up(e)) pts.reverse();
      geom.push({ e, pts });
    }
  }
  return { bands, nodeAt, geom };
}

/**
 * side のある箱（2026-10-11）。elkjs には差分の箱と右隣のまとまりを 1 つの箱として渡し、線は差分の箱の部分の上下の真ん中のポートに付ける。
 * ポートが無いと elkjs は線を箱の幅いっぱいに散らし、右隣の「差分なし」につながっているように見える
 */
const PORT = '|';
function sidePorts(n: MapNode, partition: number): ElkNode {
  const cx = coreWidth(n) / 2;
  const h = nodeHeight(n);
  return {
    id: n.id,
    width: nodeWidth(n),
    height: h,
    layoutOptions: { 'elk.partitioning.partition': String(partition), 'elk.portConstraints': 'FIXED_POS' },
    ports: [
      { id: `${n.id}${PORT}n`, x: cx, y: 0, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'NORTH' } },
      { id: `${n.id}${PORT}s`, x: cx, y: h, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'SOUTH' } },
    ],
  };
}

/** 辺のラベル。型が取れていれば「入り → 出」、まとめた本数が 2 以上なら「×n」 */
export function edgeLabel(e: MapEdge): string {
  // 「差分なし」の箱の線は数を箱に書いているので、線には書かない
  if (e.rel) return '';
  const many = e.n > 1 ? `×${e.n}` : '';
  if (e.types && (e.types.in || e.types.out)) return `${e.types.in || '?'} → ${e.types.out || '?'}${many ? ` ${many}` : ''}`;
  return many;
}

/**
 * 絞った表示。全体の配置から scoped に残る物だけを取り、左右・上下の並びを保ったまま空白を詰める。
 * scoped が全体（seed が空）でも同じ関数を通す（全体表示も詰めた形で統一する）。
 */
export function scopeView(base: BaseLayout, scoped: MapGraph): ViewLayout {
  const keepN = new Set(scoped.nodes.map((n) => n.id));
  const keepE = new Set(scoped.edges.map((e) => `${e.from}>${e.to}`));
  // 箱の中身（related / order / side）は絞った側の物。幅もそれで計る（範囲の外の箱は side を外すので狭くなる。線はポートで左に付いている）
  const scopedNode = new Map(scoped.nodes.map((n) => [n.id, n]));
  const vis = [...base.nodeAt.values()].filter((v) => keepN.has(v.n.id)).map((v) => {
    const n = scopedNode.get(v.n.id) ?? v.n;
    return { ...v, n, w: nodeWidth(n) };
  });
  const X = packer(
    vis.map((v) => ({ a: v.x, b: v.x + v.w })),
    LEFT,
    48,
  );
  const perBand = new Map<string, Array<{ a: number; b: number }>>();
  for (const v of vis) {
    const arr = perBand.get(v.n.band) ?? [];
    arr.push({ a: v.y, b: v.y + v.h });
    perBand.set(v.n.band, arr);
  }
  let cursor = TOP;
  const ySpans: Packed[] = [];
  const bands: ViewLayout['bands'] = [];
  for (const b of base.bands) {
    const arr = perBand.get(b);
    if (!arr) continue;
    const { merged, end } = packer(arr, cursor, 18);
    bands.push({ b, top: cursor - 18, label: scoped.bandLabels?.get(b) ?? b });
    ySpans.push(...merged);
    cursor = end + BAND_GAP;
  }
  const tx = (x: number) => x + offAt(X.merged, x);
  const ty = (y: number) => y + offAt(ySpans, y);

  const nodeAt: ViewLayout['nodeAt'] = new Map();
  let maxX = 700;
  for (const v of vis) {
    const nv = { ...v, x: tx(v.x), y: ty(v.y), seed: scoped.seed.has(v.n.id) };
    nodeAt.set(v.n.id, nv);
    maxX = Math.max(maxX, nv.x + nv.w);
  }
  const on = scoped.seed.size > 0;
  const paths: ViewLayout['paths'] = [];
  for (const g of base.geom) {
    if (!keepE.has(`${g.e.from}>${g.e.to}`)) continue;
    paths.push({ e: g.e, pts: g.pts.map((q) => ({ x: tx(q.x), y: ty(q.y) })), lab: edgeLabel(g.e), on });
  }
  // 図の幅・高さはノードだけでなく辺の点も含める（辺が一番外のノードより外を回ることがある）
  let maxEX = 0;
  let maxEY = 0;
  for (const p of paths) {
    for (const q of p.pts) {
      maxEX = Math.max(maxEX, q.x);
      maxEY = Math.max(maxEY, q.y);
    }
  }
  const linked = new Set(scoped.edges.flatMap((e) => [e.from, e.to]));
  for (const b of bands) {
    const loose = [...nodeAt.values()].filter((v) => v.n.band === b.b && !linked.has(v.n.id)).length;
    if (loose > 0) b.label = `${b.label}  ／ 関連なし ${loose}`;
  }
  return { width: Math.max(maxX + LEFT, maxEX + LEFT), height: Math.max(cursor + 10, maxEY + 30), nodeAt, paths, bands };
}
