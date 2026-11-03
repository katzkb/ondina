// 入口の地図（設計書 3.1。2026-11-03 の見本 5 の形、分け方は見本 6 の案 A）の、1 枚の図に並べるものを組む純粋関数。
// まとまり（Analysis.mapGroups。core が分けた木）の 1 段だけを図にする。全景はまとまり、まとまりの中は箱（差分のあるファイルか畳んだ束）。
// 呼び出しの線はシンボルの辺を箱に丸めて束ね、図の中の 2 つをつなぐ本数を数える。図の外の相手は、その相手を含むまとまりの点線の札にする。
// 名前は、図の半分以上の名前に出る語を「…」で省く（違う部分を残す）。ここは事実を足さない（原則 5）。配置は layout.ts
import type { Analysis, MapBox, MapGroup, MapGroups } from '@ondina/model';
import { mapBands, NO_LAYER, relationsOf } from '../graph.js';

/** 全景の id（パンくずの先頭）。MapGroup.id とは衝突しない（'course:' / 'theme:' / 'outside'） */
export const ROOT = 'root';

export interface GroupTree {
  root: string[];
  groups: Map<string, MapGroup>;
  boxes: Map<string, MapBox>;
  /** まとまりか箱の id → 親（全景の直下は ROOT） */
  parent: Map<string, string>;
}

export function groupTree(mg: MapGroups): GroupTree {
  const groups = new Map(mg.groups.map((g) => [g.id, g]));
  const boxes = new Map(mg.boxes.map((b) => [b.id, b]));
  const parent = new Map<string, string>();
  for (const id of mg.root) parent.set(id, ROOT);
  for (const g of mg.groups) for (const c of g.children) if (!parent.has(c)) parent.set(c, g.id);
  return { root: mg.root, groups, boxes, parent };
}

/** 全景からそのまとまりまでの道筋（ROOT を含まない。最後がそのまとまり）。木に無い id は null */
export function pathTo(tree: GroupTree, id: string): string[] | null {
  if (id === ROOT) return [];
  if (!tree.groups.has(id)) return null;
  const out: string[] = [];
  for (let x: string | undefined = id; x !== undefined && x !== ROOT; x = tree.parent.get(x)) out.unshift(x);
  return out;
}

export function childrenOf(tree: GroupTree, id: string): string[] {
  return id === ROOT ? tree.root : (tree.groups.get(id)?.children ?? []);
}

/** まとまりの中の箱（全部の段） */
export function leavesOf(tree: GroupTree, id: string): MapBox[] {
  const box = tree.boxes.get(id);
  if (box) return [box];
  return childrenOf(tree, id).flatMap((c) => leavesOf(tree, c));
}

/** x を含む、at の直下の子。at の中に無ければ null */
function childUnder(tree: GroupTree, at: string, x: string): string | null {
  for (let y: string | undefined = x; y !== undefined && y !== ROOT; y = tree.parent.get(y)) if (tree.parent.get(y) === at) return y;
  return null;
}

/** at の外にある x を、at の道筋の脇に出ている段まで丸める（その図の札） */
function portalOf(tree: GroupTree, at: string, x: string): string {
  const up = new Set([ROOT, ...(pathTo(tree, at) ?? [])]);
  let y = x;
  while (!up.has(tree.parent.get(y) ?? ROOT)) y = tree.parent.get(y)!;
  return y;
}

/** 箱 1 つの事実。図の箱に書くもの */
export interface BoxFacts {
  id: string;
  /** 帯の番号（mapBands の並び。層が無ければ「層なし」の番号） */
  layer: number;
  /** 新しいファイル（GitHub の差分の塊が全部 old 側 0 行） */
  added: boolean;
  /** 箱の hunk のコース（小さい順。どのコースにも無い hunk があれば 0 も） */
  courses: number[];
  /** 2 行目: 変更したシンボルの名前（束は書き換えのパターン） */
  members: string[];
  hunks: number;
  /** 束だけ */
  bundle?: { members: number; deviations: number };
  /** 差分の無い相手の数（呼び出し元 + 呼び出し先）。押すと引き出し（rel.open。host は箱の id） */
  rel: number;
}

export interface MapEdgeFact {
  a: string;
  b: string;
  /** 束ねたシンボルの辺の本数（参照は箇所の数） */
  n: number;
}

export interface MapFacts {
  tree: GroupTree;
  bands: string[];
  box: Map<string, BoxFacts>;
  /** 箱どうしの線（向きつき、同じ向きは 1 本） */
  edges: MapEdgeFact[];
}

/** 箱の hunk を持つ変更シンボル → 箱の id */
function boxOfSymbol(analysis: Analysis, mg: MapGroups): Map<string, string> {
  const ofHunk = new Map(mg.boxes.flatMap((b) => b.hunkIds.map((h) => [h, b.id] as const)));
  const out = new Map<string, string>();
  for (const s of analysis.symbols) {
    if (!s.changed) continue;
    const b = ofHunk.get(s.hunkId ?? s.id);
    if (b !== undefined) out.set(s.id, b);
  }
  return out;
}

export function mapFacts(analysis: Analysis, mg: MapGroups): MapFacts {
  const tree = groupTree(mg);
  const bands = mapBands(analysis);
  const bandAt = (l: string | undefined) => {
    const i = bands.indexOf(l ?? NO_LAYER);
    return i < 0 ? bands.length - 1 : i;
  };
  const hunkOf = new Map(analysis.hunks.map((h) => [h.id, h]));
  const symOf = new Map(analysis.symbols.map((s) => [s.id, s]));
  const fresh = new Set((analysis.githubDiff ?? []).filter((f) => f.hunks.length > 0 && f.hunks.every((h) => h.oldLines === 0)).map((f) => f.path));
  const rels = relationsOf(analysis);
  const owner = boxOfSymbol(analysis, mg);

  const box = new Map<string, BoxFacts>();
  for (const b of mg.boxes) {
    const hs = b.hunkIds.flatMap((id) => hunkOf.get(id) ?? []);
    const layers = new Set(b.hunkIds.map((id) => bandAt(symOf.get(id)?.layer)));
    const group = hs.find((h) => h.group?.representative !== undefined && b.id === `group:${h.group.representative}`)?.group;
    const courses = [...new Set(hs.flatMap((h) => (h.hows.length > 0 ? h.hows : [0])))].sort((p, q) => p - q);
    // 差分の無い相手は、箱に載るシンボル（束は束の箱）ごとの相手を合わせる。同じ相手は 1 回
    const hosts = group ? [b.id] : b.hunkIds;
    const seen = new Set<string>();
    for (const h of hosts) {
      const r = rels.get(h);
      for (const x of [...(r?.callers ?? []).map((y) => `in:${y.id}`), ...(r?.callees ?? []).map((y) => `out:${y.id}`)]) seen.add(x);
    }
    box.set(b.id, {
      id: b.id,
      layer: layers.size === 1 ? [...layers][0]! : group ? bands.length - 1 : Math.min(...layers),
      added: b.path !== undefined && fresh.has(b.path),
      courses,
      // 箱の名前と同じシンボル（ファイルそのもの・ファイルと同名のクラス）は 2 行目に重ねない
      members: group ? [] : [...new Set(hs.filter((h) => h.symbolKind !== 'file' && h.symbol !== b.label).map((h) => h.symbol))],
      hunks: hs.length,
      ...(group ? { bundle: { members: group.members.length, deviations: group.deviations.length } } : {}),
      rel: seen.size,
    });
  }

  const merged = new Map<string, MapEdgeFact>();
  for (const e of analysis.edges) {
    if (e.kind === 'test') continue;
    const a = owner.get(e.from);
    const b = owner.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const k = `${a}>${b}`;
    const cur = merged.get(k) ?? { a, b, n: 0 };
    cur.n += e.kind === 'reference' ? (e.n ?? 1) : 1;
    merged.set(k, cur);
  }
  return { tree, bands, box, edges: [...merged.values()] };
}

export interface ViewItem {
  id: string;
  /** group = 中に入れるまとまり、box = 箱、portal = 図の外の相手を含むまとまり（点線の札。押すとそこへ） */
  kind: 'group' | 'box' | 'portal';
  /** 帯の番号（箱と札。クラスの図の帯分けに使う） */
  layer: number;
  /** 箱だけ: 短くした名前（「…」入り） */
  short?: string;
}

export interface ViewEdge {
  a: string;
  b: string;
  n: number;
  /** 図の外への線（札とつなぐ）。点線 */
  portal: boolean;
}

export interface ViewSpec {
  at: string;
  /** groups = まとまりを並べた図（左から右）、boxes = 箱を並べた図（上から下に層の帯） */
  kind: 'groups' | 'boxes';
  items: ViewItem[];
  edges: ViewEdge[];
  /** 名前の「…」で省いた語（図の下に出す） */
  common: string[];
}

/** at の図に並べるもの。子の並びはまとまりの並びのまま、札はその後ろ */
export function viewOf(facts: MapFacts, labelOf: (boxId: string) => string, at: string): ViewSpec {
  const { tree } = facts;
  const kids = childrenOf(tree, at);
  const kind = kids.some((k) => tree.boxes.has(k)) ? 'boxes' : 'groups';
  const layerOf = (id: string) => Math.min(...leavesOf(tree, id).map((b) => facts.box.get(b.id)?.layer ?? 0));
  const items = new Map<string, ViewItem>(kids.map((k) => [k, { id: k, kind: tree.boxes.has(k) ? 'box' : 'group', layer: layerOf(k) }]));
  const agg = new Map<string, ViewEdge>();
  for (const e of facts.edges) {
    let a = childUnder(tree, at, e.a);
    let b = childUnder(tree, at, e.b);
    if (a === null && b === null) continue;
    if (a === b) continue;
    let portal = false;
    if (a === null) {
      a = portalOf(tree, at, e.a);
      portal = true;
    }
    if (b === null) {
      b = portalOf(tree, at, e.b);
      portal = true;
    }
    for (const [x, o] of [
      [a, e.a],
      [b, e.b],
    ] as const) {
      const layer = facts.box.get(o)?.layer ?? 0;
      const it = items.get(x);
      if (!it) items.set(x, { id: x, kind: 'portal', layer });
      else if (it.kind === 'portal') it.layer = Math.min(it.layer, layer);
    }
    const k = `${a}>${b}`;
    const g = agg.get(k) ?? { a, b, n: 0, portal };
    g.n += e.n;
    agg.set(k, g);
  }
  const boxes = kids.filter((k) => tree.boxes.has(k));
  const sn = shortNames(boxes.map((id) => labelOf(id)));
  boxes.forEach((id, i) => {
    items.get(id)!.short = sn.names[i]!;
  });
  return { at, kind, items: [...items.values()], edges: [...agg.values()], common: sn.common };
}

/** 名前を語に分ける（キャメルケース・数字・記号） */
export const tokens = (s: string): string[] => s.match(/[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+|[^A-Za-z\d]+/g) ?? [s];
const camel = (s: string) => /^[A-Z][A-Za-z\d]+$/.test(s);

/**
 * 図の名前の短縮（見本 5）。3 つ以上のキャメルケースの名前があるとき、その半分以上に出る 3 文字以上の語を「…」にまとめる。
 * 全部の語が省かれる名前は最後の 2 語を残す。短くした名前がかぶったら、かぶった名前は元に戻す。common は実際に省いた語
 */
export function shortNames(names: readonly string[]): { names: string[]; common: string[] } {
  const out = [...names];
  const cs = names.filter(camel);
  if (cs.length < 3) return { names: out, common: [] };
  const freq = new Map<string, number>();
  for (const n of cs) for (const t of new Set(tokens(n))) freq.set(t, (freq.get(t) ?? 0) + 1);
  const common = new Set([...freq].filter(([t, c]) => c >= Math.ceil(cs.length / 2) && t.length >= 3).map(([t]) => t));
  names.forEach((n, i) => {
    if (!camel(n)) return;
    const parts: string[] = [];
    for (const t of tokens(n)) {
      if (!common.has(t)) parts.push(t);
      else if (parts[parts.length - 1] !== '…') parts.push('…');
    }
    out[i] = parts.every((p) => p === '…') ? tokens(n).slice(-2).join('') : parts.join('');
  });
  const seen = new Map<string, number>();
  for (const n of out) seen.set(n, (seen.get(n) ?? 0) + 1);
  out.forEach((n, i) => {
    if ((seen.get(n) ?? 0) > 1) out[i] = names[i]!;
  });
  const used = [...common].filter((t) => out.some((n, i) => n !== names[i] && tokens(names[i]!).includes(t)));
  return { names: out, common: used };
}

/** 札と全景のまとまりに書く名前。guess = LLM の名前（点線。原則 2） */
export function groupName(analysis: Analysis, g: MapGroup): { text: string; guess: boolean } {
  if (g.kind === 'outside') return { text: 'コース外', guess: false };
  if (g.kind === 'theme') return { text: g.title ?? g.id, guess: true };
  return { text: analysis.hows.find((h) => h.id === g.howId)?.title ?? `コース ${g.howId}`, guess: false };
}

/** パンくずに書く名前 */
export function crumbName(analysis: Analysis, tree: GroupTree, id: string): string {
  if (id === ROOT) return '全景';
  const g = tree.groups.get(id);
  if (!g) return id;
  if (g.kind === 'course') return `コース ${g.howId}`;
  return groupName(analysis, g).text;
}

/** 選んだコースが通る、図の中のもの（まとまり・箱・札）。sel が null なら null */
export function litBy(facts: MapFacts, spec: ViewSpec, sel: number | null): Set<string> | null {
  if (sel === null) return null;
  const on = new Set<string>();
  for (const it of spec.items) if (leavesOf(facts.tree, it.id).some((b) => facts.box.get(b.id)?.courses.includes(sel))) on.add(it.id);
  return on;
}
