// 流れの地図の箱（見本 flow5）。箱はクラス（関数ならそれを持つクラス、クラスならそのもの）。中の行は、この流れで呼ばれるメンバー。
// 箱の状態（新しい / 変わった / 差分なし / まだ無い）は symbols の changed と hunk の行から決める（事実だけ。原則 3）
import type { Analysis, CallFlow, FlowCall, Hunk, Symbol as OndinaSymbol } from '@ondina/model';
import { mapBands, NO_LAYER } from '../graph.js';
import { allCalls, inStage, type Stage } from './steps.js';

/** 差分の形。added = 足しただけ、removed = 消しただけ、changed = ほか、none = 差分なし */
export type Diffness = 'added' | 'removed' | 'changed' | 'none';

export interface FlowMember {
  /** Symbol.id（呼ばれる側） */
  sym: string;
  /** 箱の中の 1 行（メンバーの名前。クラスそのものを呼んでいれば呼び出しの名前） */
  name: string;
  diff: Diffness;
  /** その段に、このメンバーへの呼び出しがあるか */
  stages: Record<Stage, boolean>;
}

export interface FlowBox {
  /** クラスの fqName（ファイル単位はパス） */
  id: string;
  name: string;
  /** 帯の名前（Symbol.layer。無ければ 層なし） */
  band: string;
  layerGuessed: boolean;
  members: FlowMember[];
  /** 箱の差分の形（クラスの hunk が足しただけなら added、メンバーのどれかに差分があれば changed） */
  diff: Diffness;
  /** その段の呼び出しが来るか（来なければ薄く出す） */
  used: Record<Stage, boolean>;
}

/** hunk の差分の形 */
export function hunkDiff(h: Pick<Hunk, 'lines'> | undefined): Diffness {
  if (!h) return 'none';
  // 前後の行（' '）を含まず、全部が足した行 = 新しく足したもの（hunk はシンボルごとなので、中身に手を入れただけなら前後の行が入る）
  if (!h.lines.some((l) => l[0] === '+' || l[0] === '-')) return 'none';
  if (h.lines.every((l) => l[0] === '+')) return 'added';
  if (h.lines.every((l) => l[0] === '-')) return 'removed';
  return 'changed';
}

const CLASSY = new Set(['class', 'object', 'companion', 'file']);

/** シンボルの箱の id と名前 */
export function boxOf(s: Pick<OndinaSymbol, 'fqName' | 'path' | 'kind'>): { id: string; name: string } {
  if (s.kind === 'file') return { id: s.path, name: s.path.split('/').pop() ?? s.path };
  const id = CLASSY.has(s.kind) ? s.fqName : s.fqName.split('.').slice(0, -1).join('.') || s.fqName;
  return { id, name: id.split('.').pop() ?? id };
}

/** 呼び出しに出す式（その段の側。② は変わった後、無ければ変わる前） */
export function callText(c: FlowCall, stage: Stage): string | null {
  const site = stage === 1 ? c.before : stage === 3 ? c.after : (c.after ?? c.before);
  return site?.call?.text ?? null;
}

export interface FlowFacts {
  boxes: FlowBox[];
  /** Symbol.id → 箱の id */
  boxIdOf: Map<string, string>;
  /** 帯の並び（設定の層の順。この流れに出る帯だけ） */
  bands: string[];
}

/** 流れの箱を組む。並びは呼ばれる順（最初に呼ばれた順） */
export function flowFacts(analysis: Pick<Analysis, 'symbols' | 'hunks' | 'config' | 'structure'>, flow: CallFlow): FlowFacts {
  const sym = new Map(analysis.symbols.map((s) => [s.id, s]));
  const hunk = new Map(analysis.hunks.map((h) => [h.id, h]));
  const symDiff = (id: string): Diffness => {
    const s = sym.get(id);
    if (!s || !s.changed) return 'none';
    return hunkDiff(hunk.get(s.hunkId ?? s.id));
  };
  const boxes = new Map<string, FlowBox>();
  const boxIdOf = new Map<string, string>();
  for (const c of allCalls(flow)) {
    const s = sym.get(c.to);
    const b = s ? boxOf(s) : { id: c.to, name: c.to.slice(0, 8) };
    boxIdOf.set(c.to, b.id);
    let box = boxes.get(b.id);
    if (!box) {
      box = { id: b.id, name: b.name, band: s?.layer ?? NO_LAYER, layerGuessed: s?.layerProvenance === 'llm', members: [], diff: 'none', used: { 1: false, 2: true, 3: false } };
      boxes.set(b.id, box);
    }
    const classy = s ? CLASSY.has(s.kind) : false;
    // クラスそのものへの呼び出し（コンストラクタや、メンバーを言語サーバーがクラスに丸めたもの）は呼び出しの名前で 1 行にする
    const name = classy ? (c.after?.call?.name ?? c.before?.call?.name ?? b.name) : (s?.fqName.split('.').pop() ?? c.to.slice(0, 8));
    let m = box.members.find((x) => x.sym === c.to && x.name === name);
    if (!m) {
      m = { sym: c.to, name, diff: symDiff(c.to), stages: { 1: false, 2: true, 3: false } };
      box.members.push(m);
    }
    for (const st of [1, 3] as const) {
      if (inStage(c, st)) {
        m.stages[st] = true;
        box.used[st] = true;
      }
    }
  }
  for (const box of boxes.values()) {
    const cls = analysis.symbols.find((s) => s.fqName === box.id && CLASSY.has(s.kind));
    const own = cls ? symDiff(cls.id) : 'none';
    box.diff = own === 'added' || own === 'removed' ? own : own !== 'none' || box.members.some((m) => m.diff !== 'none') ? 'changed' : 'none';
  }
  const order = mapBands(analysis as Analysis);
  const used = new Set([...boxes.values()].map((b) => b.band));
  // 設定の並びに無い層（構成の推定が後から変わったなど）は 層なし の前に足す
  const extra = [...used].filter((b) => !order.includes(b));
  const bands = [...order.slice(0, -1), ...extra, NO_LAYER].filter((b) => used.has(b));
  return { boxes: [...boxes.values()], boxIdOf, bands };
}
