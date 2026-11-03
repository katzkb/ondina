// 入口の地図に動き（Analysis.behaviors。設計書 3.1）を流す・シーケンス図にする（2026-11-04。見本 5 の place / flowHtml / seqHtml）。純粋関数。
// 1 歩 = 呼び出し 1 回。1 歩目は「呼び出し元 → 始まり」。呼ぶ側・呼ばれる側のシンボルを箱に載せ、いま見ている図のどの箱・まとまり・札に載るかを決める。
// 違う箱なら矢印、同じ箱（か片方しか図に無い）なら「中で」。差分の無い相手（箱が無い）は呼ぶ側の「中で」にする。
// 矢印の文字は呼び出しだけ（名前(…引数の数)）。戻りは言語サーバーの戻り型だけ（原則 2。値の札は出さない、設計書 17 章の TODO）
import type { Analysis, Behavior } from '@ondina/model';
import { shortName } from '../graph.js';
import type { PlacedItem, PlacedView } from './layout.js';
import { textW } from './layout.js';
import { itemAt, lcaOf, stepState, type StepState } from './flow.js';
import { ROOT, type GroupTree, type ViewSpec } from './view.js';

/** 呼び出し元（図の外の点）。地図の箱の id とは衝突しない */
export const CALLER = 'caller';

/** 動きの 1 歩 */
export interface FlowStep {
  /** 1 から */
  n: number;
  /** 呼ぶ側の箱（MapBox.id）。null = 呼び出し元（1 歩目）か、呼ぶ側に箱が無い */
  from: string | null;
  /** 呼ばれる側の箱。null = 差分の無い相手 */
  to: string | null;
  /** 1 歩目（呼び出し元 → 始まり） */
  entry: boolean;
  /** 呼ぶ側の短い名前（1 歩目は「呼び出し元」） */
  caller: string;
  /** 呼ばれる側の短い名前（"OrderRepositoryImpl.find"） */
  callee: string;
  /** 矢印の札: "find(…1)"。呼び出しの式が無ければ呼ばれる側の短い名前 */
  short: string;
  /** 押したときの札: 呼び出しの式の原文（無ければ short） */
  full: string;
  returns?: string;
}

/** シンボル → 箱（シンボルの hunk を持つ箱。束のメンバーは束の箱） */
function boxOfSymbol(analysis: Analysis, tree: GroupTree): (symbolId: string) => string | null {
  const ofHunk = new Map<string, string>();
  for (const b of tree.boxes.values()) for (const h of b.hunkIds) ofHunk.set(h, b.id);
  const sym = new Map(analysis.symbols.map((s) => [s.id, s]));
  return (id) => {
    const s = sym.get(id);
    return ofHunk.get(s?.hunkId ?? id) ?? null;
  };
}

/** 動きを歩に分ける */
export function behaviorSteps(analysis: Analysis, tree: GroupTree, b: Behavior): FlowStep[] {
  const sym = new Map(analysis.symbols.map((s) => [s.id, s]));
  const nameOf = (id: string) => {
    const s = sym.get(id);
    return s ? shortName(s.fqName, s.path, s.kind) : id;
  };
  const box = boxOfSymbol(analysis, tree);
  const start = nameOf(b.start);
  const steps: FlowStep[] = [{ n: 1, from: null, to: box(b.start), entry: true, caller: '呼び出し元', callee: start, short: start, full: start }];
  for (const m of b.messages) {
    const callee = nameOf(m.to);
    const c = m.call;
    const short = c?.exact && c.name ? `${c.name}(${c.args && c.args.length > 0 ? `…${c.args.length}` : ''})` : callee;
    steps.push({
      n: steps.length + 1,
      from: box(m.from),
      to: box(m.to),
      entry: false,
      caller: nameOf(m.from),
      callee,
      short,
      full: c?.text ?? short,
      ...(m.returns !== undefined ? { returns: m.returns } : {}),
    });
  }
  return steps;
}

/** 1 歩が、いまの図にどう載るか。arrow = 2 つの間の矢印、in = 1 つの中（at が null なら図の外） */
export type Placed = { t: 'arrow'; a: string; b: string } | { t: 'in'; at: string | null };

/**
 * lanes = シーケンス図（札も列なので、札の間も矢印）。地図では、図の中の箱・まとまりに触れない歩（札と札、呼び出し元と札）は図の外（at = null）。
 * 図の外の歩は、下の「… で見る ›」で起きている図へ移る
 */
export function placeStep(tree: GroupTree, spec: ViewSpec, s: FlowStep, lanes = false): Placed {
  const a = s.entry ? CALLER : s.from === null ? null : itemAt(tree, spec, s.from);
  const b = s.to === null ? null : itemAt(tree, spec, s.to);
  const isBox = (id: string | null) => id !== null && id !== CALLER && spec.items.some((it) => it.id === id && (lanes || it.kind !== 'portal'));
  if (a !== null && b !== null && a !== b) return isBox(a) || isBox(b) ? { t: 'arrow', a, b } : { t: 'in', at: null };
  if (a !== null && a === b) return { t: 'in', at: a };
  // 差分の無い相手へは呼ぶ側の中で。片方しか図に無ければ、ある方の中で
  return { t: 'in', at: [a, b].find((x) => x !== null && x !== CALLER) ?? null };
}

/** 歩が載る箱（「… で見る」を決める） */
export const stepBoxes = (s: FlowStep): string[] => [s.from, s.to].filter((x): x is string => x !== null);

/** 「中で」の札の見出し: 起きている場所が、載っている item かいまの図なら null（「中で」）、もっと深いまとまりならそのまとまり（「〇〇 の中で」） */
export function inDeeper(tree: GroupTree, spec: ViewSpec, s: FlowStep, at: string): string | null {
  const bs = stepBoxes(s);
  if (bs.length === 0) return null;
  const L = lcaOf(tree, bs);
  return L === at || L === spec.at || L === ROOT ? null : L;
}

export interface FlowArrow {
  n: number;
  pts: Array<[number, number]>;
  state: StepState;
  /** 呼び出し元の点（図の外） */
  dot?: [number, number];
}

export interface FlowDraw {
  arrows: FlowArrow[];
  /** 今の歩（i = 0 なら null） */
  cur: { step: FlowStep; place: Placed; arrow: FlowArrow | null } | null;
  /** 動きが通る item（ほかは沈める） */
  used: Set<string>;
}

const ctr = (r: PlacedItem): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

/** 箱の縁で切る（中心から p への線が箱の縁に当たる点） */
function clip(r: PlacedItem, p: readonly [number, number]): [number, number] {
  const [cx, cy] = ctr(r);
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  if (!dx && !dy) return [cx, cy];
  const s = Math.min(dx ? Math.abs(r.w / 2 / dx) : Infinity, dy ? Math.abs(r.h / 2 / dy) : Infinity);
  return [cx + dx * s, cy + dy * s];
}

/** 2 つの item を結ぶ矢印の線。図の線があればその線（逆向きなら逆にたどる）、無ければ縁から縁へまっすぐ。呼び出し元は図の外の点から */
export function flowPath(view: PlacedView, a: string, b: string): { pts: Array<[number, number]>; dot?: [number, number] } {
  const byId = new Map(view.items.map((it) => [it.id, it]));
  const down = view.spec.kind === 'boxes';
  if (a === CALLER || b === CALLER) {
    const r = byId.get(a === CALLER ? b : a)!;
    const d: [number, number] = down ? [r.x + r.w / 2, r.y - 20] : [r.x - 22, r.y + r.h / 2];
    const p: [number, number] = down ? [r.x + r.w / 2, r.y] : [r.x, r.y + r.h / 2];
    return { pts: a === CALLER ? [d, p] : [p, d], dot: d };
  }
  const e = view.edges.find((x) => x.a === a && x.b === b && x.pts.length > 1);
  if (e) return { pts: e.pts.map((p) => [p[0], p[1]]) };
  const f = view.edges.find((x) => x.a === b && x.b === a && x.pts.length > 1);
  if (f) return { pts: f.pts.map((p): [number, number] => [p[0], p[1]]).reverse() };
  const A = byId.get(a)!;
  const B = byId.get(b)!;
  return { pts: [clip(A, ctr(B)), clip(B, ctr(A))] };
}

/** いまの図の上の動き（矢印・今の歩） */
export function flowDraw(tree: GroupTree, view: PlacedView, steps: readonly FlowStep[], i: number): FlowDraw {
  const arrows: FlowArrow[] = [];
  const used = new Set<string>();
  let cur: FlowDraw['cur'] = null;
  for (const s of steps) {
    const p = placeStep(tree, view.spec, s);
    const state = stepState(s.n, i);
    let arrow: FlowArrow | null = null;
    if (p.t === 'arrow') {
      const P = flowPath(view, p.a, p.b);
      arrow = { n: s.n, pts: P.pts, state, ...(P.dot ? { dot: P.dot } : {}) };
      arrows.push(arrow);
      for (const x of [p.a, p.b]) if (x !== CALLER) used.add(x);
    } else if (p.at !== null) used.add(p.at);
    if (state === 'cur') cur = { step: s, place: p, arrow };
  }
  return { arrows, cur, used };
}

/** 矢印の札の場所（見本 5 の labPos）。線の一番長い区間の横に、縦の区間なら右（入らなければ左）、横の区間なら下 */
export function labelAt(pts: ReadonlyArray<readonly [number, number]>, w: number, W: number): { x: number; y: number } {
  let best = -1;
  let bi = 1;
  for (let k = 1; k < pts.length; k++) {
    const d = Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]);
    if (d > best) {
      best = d;
      bi = k;
    }
  }
  const [x0, y0] = pts[bi - 1]!;
  const [x1, y1] = pts[bi]!;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  if (Math.abs(x1 - x0) < Math.abs(y1 - y0)) {
    const right = mx + 10 + w <= W - 4;
    return { x: right ? mx + 10 : Math.max(4, mx - 10 - w), y: y0 + (y1 - y0) * 0.3 };
  }
  return { x: Math.max(4, Math.min(W - 4 - w, mx - w / 2)), y: my + 7 };
}

/** シーケンス図の 1 行（呼び出しか、その戻り） */
export interface SeqRow {
  n: number;
  ret: boolean;
  place: Placed;
}

/**
 * 呼び出しと戻りを、時間の順の行にする。戻りは、その呼び出しの先で続く呼び出しが全部終わってから（深さ優先の積み下ろし）。
 * 戻り型の無い呼び出しは戻りの行を作らない（矢印の見本で決めた。2026-11-04）
 */
export function seqRows(tree: GroupTree, spec: ViewSpec, b: Behavior, steps: readonly FlowStep[]): SeqRow[] {
  const rows: SeqRow[] = [];
  const stack: Array<{ to: string; s: FlowStep }> = [];
  const close = (until: (top: { to: string }) => boolean) => {
    while (stack.length > 0 && !until(stack[stack.length - 1]!)) {
      const top = stack.pop()!;
      if (top.s.returns !== undefined) rows.push({ n: top.s.n, ret: true, place: back(placeStep(tree, spec, top.s, true)) });
    }
  };
  steps.forEach((s, k) => {
    const from = k === 0 ? null : b.messages[k - 1]!.from;
    const to = k === 0 ? b.start : b.messages[k - 1]!.to;
    if (from !== null) close((top) => top.to === from);
    rows.push({ n: s.n, ret: false, place: placeStep(tree, spec, s, true) });
    stack.push({ to, s });
  });
  close(() => false);
  return rows;
}

const back = (p: Placed): Placed => (p.t === 'arrow' ? { t: 'arrow', a: p.b, b: p.a } : p);

export interface SeqLane {
  id: string;
  cx: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SeqLayout {
  w: number;
  h: number;
  lanes: SeqLane[];
  /** 行の y（rows と同じ並び） */
  ys: number[];
  /** 箱の図だけ: 同じ層の列をまとめた帯 */
  bands: Array<{ layer: number; x: number; w: number }>;
  /** 呼び出し元の列の x */
  callerX: number;
}

export const SEQ_X0 = 38;
const SEQ_HEAD_Y = 22;
const SEQ_ROW = 30;

/**
 * シーケンス図の配置（見本 5 の seqHtml）。列の頭はいまの図の item。並びは、箱の図なら層の順（札は後ろ）、まとまりの図なら左から。
 * 9 列以上なら列の頭を 2 段に互い違いに置く
 */
export function seqLayout(view: PlacedView, rows: readonly SeqRow[], minW = 680): SeqLayout {
  const byId = new Map(view.items.map((it) => [it.id, it]));
  const ids = [...new Set(rows.flatMap((r) => (r.place.t === 'arrow' ? [r.place.a, r.place.b] : r.place.at === null ? [] : [r.place.at])))].filter((x) => x !== CALLER && byId.has(x));
  const down = view.spec.kind === 'boxes';
  ids.sort((a, b) => {
    const p = byId.get(a)!;
    const q = byId.get(b)!;
    return down ? p.layer - q.layer || Number(p.kind === 'portal') - Number(q.kind === 'portal') || p.y - q.y || p.x - q.x : p.x - q.x || p.y - q.y;
  });
  const stag = ids.length >= 9;
  const W = Math.max(minW, SEQ_X0 + ids.length * (stag ? 70 : 120));
  const colW = ids.length > 0 ? (W - SEQ_X0) / ids.length : W;
  const hw = Math.min(stag ? colW * 2 - 14 : colW - 10, 190);
  const hh = stag ? 40 : 52;
  const lanes = ids.map((id, k) => {
    const cx = SEQ_X0 + colW * k + colW / 2;
    return { id, cx, x: cx - hw / 2, y: SEQ_HEAD_Y + (stag ? (k % 2) * (hh + 6) : 0), w: hw, h: hh };
  });
  const y0 = SEQ_HEAD_Y + (stag ? hh * 2 + 6 : hh) + 34;
  const ys = rows.map((_, r) => y0 + r * SEQ_ROW);
  const bands: SeqLayout['bands'] = [];
  if (down) {
    let s = 0;
    lanes.forEach((l, k) => {
      const nx = lanes[k + 1];
      if (nx && byId.get(nx.id)!.layer === byId.get(l.id)!.layer) return;
      const x0 = lanes[s]!.cx - colW / 2;
      bands.push({ layer: byId.get(l.id)!.layer, x: x0, w: l.cx + colW / 2 - x0 });
      s = k + 1;
    });
  }
  return { w: W, h: y0 + rows.length * SEQ_ROW + 8, lanes, ys, bands, callerX: 26 };
}

/** 札の文字の幅の見積もり（等幅 11px） */
export const labelW = (s: string): number => Math.min(320, textW(s) * 0.95 + 18);

/** 歩 n の状態（シーケンス図の行）。i = 0 は全部ふつう */
export const rowState = (n: number, i: number): 'hot' | 'fut' | '' => (i === 0 ? '' : n === i ? 'hot' : n > i ? 'fut' : '');
