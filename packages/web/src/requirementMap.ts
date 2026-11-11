// 要求コースの地図（要求ごとの地図）の導出。事実（symbols・hunk・流れの木）だけで決める（原則 3）。
// 濃い箱 = 箱のシンボルの hunk がその章の hunk。濃い線 = 呼んでいる行の hunk がその章の hunk、または呼ばれる側の箱が濃い。
import type { Analysis, CallFlow, FlowCall } from '@ondina/model';
import { hunkAt } from './files.js';
import { flowFacts, type FlowFacts } from './map/flowmap/boxes.js';
import { onFlows } from './map/flowmap/outside.js';
import { allCalls, pickFlow } from './map/flowmap/steps.js';

/** 箱の id → その章で最初に読む hunk（箱のシンボルの hunk が章の hunk に入る箱だけ。章の読む順） */
export function boxHunks(analysis: Pick<Analysis, 'symbols'>, facts: FlowFacts, hunkIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const hunkOfBox = new Map<string, Set<string>>();
  const note = (box: string, hunkId: string | undefined) => {
    if (hunkId === undefined) return;
    const set = hunkOfBox.get(box) ?? new Set<string>();
    set.add(hunkId);
    hunkOfBox.set(box, set);
  };
  const sym = new Map(analysis.symbols.map((s) => [s.id, s]));
  for (const box of facts.boxes) {
    for (const m of box.members) note(box.id, sym.get(m.sym)?.hunkId);
    // クラスそのものの hunk（クラスの宣言の差分）
    for (const s of analysis.symbols) if (s.fqName === box.id || (s.kind === 'file' && s.path === box.id)) note(box.id, s.hunkId);
  }
  for (const id of hunkIds) {
    for (const [box, set] of hunkOfBox) if (set.has(id) && !out.has(box)) out.set(box, id);
  }
  return out;
}

/** 呼んでいる行の hunk（after は head の行、before だけなら base の行）。根は宣言なので無い */
function lineHunk(analysis: Pick<Analysis, 'symbols' | 'hunks'>, c: FlowCall): string | undefined {
  if (c.from === null) return undefined;
  const owner = analysis.symbols.find((s) => s.id === c.from);
  if (!owner) return undefined;
  if (c.after?.line !== undefined) return hunkAt(analysis.hunks, owner.path, c.after.line, 'RIGHT')?.id;
  if (c.before?.line !== undefined) return hunkAt(analysis.hunks, owner.path, c.before.line, 'LEFT')?.id;
  return undefined;
}

/** 濃い線（呼び出しの key）。呼んでいる行がその章の hunk か、呼ばれる側の箱が濃い */
export function darkCalls(analysis: Pick<Analysis, 'symbols' | 'hunks'>, flow: CallFlow, facts: FlowFacts, hunkIds: readonly string[], boxes: ReadonlySet<string>): Set<string> {
  const ids = new Set(hunkIds);
  const out = new Set<string>();
  for (const c of allCalls(flow)) {
    const line = lineHunk(analysis, c);
    const box = facts.boxIdOf.get(c.to);
    if ((line !== undefined && ids.has(line)) || (box !== undefined && boxes.has(box))) out.add(c.key);
  }
  return out;
}

/** その章の差分が乗る流れ（② の呼び出しのどれかが濃い流れ） */
function chapterFlows(analysis: Pick<Analysis, 'symbols' | 'hunks' | 'flows' | 'config' | 'structure'>, hunkIds: readonly string[]): CallFlow[] {
  return (analysis.flows ?? []).filter((f) => {
    const facts = flowFacts(analysis, f);
    const boxes = new Set(boxHunks(analysis, facts, hunkIds).keys());
    return darkCalls(analysis, f, facts, hunkIds, boxes).size > 0;
  });
}

export interface ChapterMap {
  kind: 'map';
  /** 選べる流れ（章の差分が乗る流れ。「はじめに」は全部） */
  flows: CallFlow[];
  flow: CallFlow;
  facts: FlowFacts;
  /** 濃い線の key。null = 全部を ② の色で（はじめに） */
  calls: Set<string> | null;
  /** 濃い箱の id → 押すと開く hunk。null = 濃い薄いを分けない */
  boxes: Map<string, string> | null;
  /** 地図の外: この章の差分のうち、この流れの上に無いもののシンボル名 */
  outside: string[];
}
export interface NoMap {
  kind: 'none';
  /** 地図を出さない理由の 1 文 */
  reason: string;
}

const NO_DIFF = '地図は出していません。差分が見つからない要求です。';
const NO_FLOWS = '地図は出していません。この解析には処理の流れがありません。';
const NOT_ON_FLOW = '地図は出していません。この章の差分は、処理の流れの上にありません。';

/** 章の地図。出さないときは理由（プログラムが決める。推測で作らない） */
export function chapterMap(analysis: Analysis, index: number, flowId: string | null): ChapterMap | NoMap {
  const chapter = analysis.chapters?.[index];
  if (!chapter) return { kind: 'none', reason: NOT_ON_FLOW };
  if (chapter.hunkIds.length === 0 && chapter.kind === 'spec') return { kind: 'none', reason: NO_DIFF };
  if ((analysis.flows ?? []).length === 0) return { kind: 'none', reason: NO_FLOWS };
  const flows = chapterFlows(analysis, chapter.hunkIds);
  if (flows.length === 0) return { kind: 'none', reason: NOT_ON_FLOW };
  const flow = pickFlow({ flows }, flowId, null)!;
  const facts = flowFacts(analysis, flow);
  const boxes = boxHunks(analysis, facts, chapter.hunkIds);
  const calls = darkCalls(analysis, flow, facts, chapter.hunkIds, new Set(boxes.keys()));
  return { kind: 'map', flows, flow, facts, calls, boxes, outside: outsideNames(analysis, flow, chapter.hunkIds) };
}

/** 「はじめに」の地図: 全部の流れを ② の色で */
export function startMap(analysis: Analysis, flowId: string | null): ChapterMap | NoMap {
  const flows = analysis.flows ?? [];
  if (flows.length === 0) return { kind: 'none', reason: NO_FLOWS };
  const flow = pickFlow({ flows }, flowId, null)!;
  return { kind: 'map', flows, flow, facts: flowFacts(analysis, flow), calls: null, boxes: null, outside: [] };
}

/** 箱の id → その箱に差分がある章（番号の昇順）。「はじめに」の箱のチップ */
export function boxChapters(analysis: Analysis, facts: FlowFacts): Map<string, number[]> {
  const out = new Map<string, number[]>();
  (analysis.chapters ?? []).forEach((c, i) => {
    for (const box of boxHunks(analysis, facts, c.hunkIds).keys()) out.set(box, [...(out.get(box) ?? []), i]);
  });
  return out;
}

/** 流れの上に無い、この章の差分のシンボル名（ファイル全体の差分はファイル名） */
function outsideNames(analysis: Pick<Analysis, 'symbols' | 'hunks'>, flow: CallFlow, hunkIds: readonly string[]): string[] {
  const on = onFlows(analysis, [flow]);
  const names: string[] = [];
  for (const id of hunkIds) {
    if (on.has(id)) continue;
    const h = analysis.hunks.find((x) => x.id === id);
    if (!h) continue;
    // ファイル全体の差分（package・import）は、同じファイルにこの章のほかの差分があれば出さない（そちらの名前か地図の箱で代表される）
    if (h.symbolKind === 'file' && hunkIds.some((o) => o !== id && analysis.hunks.find((x) => x.id === o)?.path === h.path)) continue;
    const name = h.symbolKind === 'file' ? (h.path.split('/').pop() ?? h.path) : h.symbol;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** 要求コースの小さい形の窓の高さの上限（px） */
export const REQ_MAP_MAX_H = 620;

/** 地図全体が窓に収まる倍率 = min(1, 窓の幅 / 地図の幅, 上限の高さ / 地図の高さ)。窓の幅が測れない（0）ときは高さだけで決める */
export function fitScale(w: number, h: number, winW: number, maxH: number): number {
  const byW = winW > 0 && w > 0 ? winW / w : 1;
  const byH = h > 0 ? maxH / h : 1;
  return Math.min(1, byW, byH);
}
