// 2 回目の LLM が書いた動きの題を重ねる（設計書 3.3 / 5.4。2026-11-04）。全部プログラムで決める（原則 3）。
// 規則:
//   1. 知らない id の題は捨てる。同じ id が 2 回来たら最初だけ（最初の題が空でも後の分は使わない）
//   2. 題は前後の空白と末尾の句点を落とす。空なら題を付けない（始まりの短い名前のまま。titleProvenance は ast）
//   3. 並びは LLM の出力の順（見せる順）。LLM が書かなかった動きは、プログラムの順のまま後ろに付ける
//   4. 呼び出しの列は変えない。題と並びだけ
//   5. 流れの段の文（2026-11-05）: 前後の空白を落とし、空なら欄を付けない。① はその流れに変わる前の入口があるときだけ、③ はマージ後の入口があるときだけ、
//      ② は入口か呼び出しのどれかが変わっているときだけ残す（それ以外は捨てて知らせる）。題を使わなかった同じ id の 2 回目の文も使わない
import type { Behavior, CallFlow, FlowCall } from '../model.js';
import type { NarrationOutput } from '../narration/types.js';

type Titled = { id: string; title: string; titleProvenance: Behavior['titleProvenance'] };

export function applyBehaviorTitles(behaviors: readonly Behavior[], output: NarrationOutput['behaviors']): { behaviors: Behavior[]; info: string[] } {
  const r = applyTitles(behaviors, output, '動き');
  return { behaviors: r.items, info: r.info };
}

/** 流れ（2026-11-05）の題と段の文。題の規則は動きと同じ。LLM の出力の欄は behaviors のまま（入力の behaviors[] に流れを入れている） */
export function applyFlowTitles(flows: readonly CallFlow[], output: NarrationOutput['behaviors']): { flows: CallFlow[]; info: string[] } {
  const info: string[] = [];
  const first = new Map<string, NarrationOutput['behaviors'][number]>();
  for (const o of output) if (!first.has(o.id)) first.set(o.id, o);
  const staged = flows.map((f): CallFlow => {
    const o = first.get(f.id);
    if (o === undefined) return f;
    const stages = stageTexts(f, o, info);
    return stages === undefined ? f : { ...f, stages };
  });
  const r = applyTitles(staged, output, '流れ');
  info.push(...r.info);
  const n = (k: keyof NonNullable<CallFlow['stages']>) => r.items.filter((f) => f.stages?.[k] !== undefined).length;
  if (r.items.some((f) => f.stages !== undefined)) info.push(`流れの段の文: ① ${n('before')}・② ${n('change')}・③ ${n('after')} / ${r.items.length} 本`);
  return { flows: r.items, info };
}

const STAGE_TEXT = { before: '① 背景の文', change: '② この PR の文', after: '③ マージ後の文' } as const;

/** 規則 5 */
function stageTexts(f: CallFlow, o: NarrationOutput['behaviors'][number], info: string[]): CallFlow['stages'] {
  const changed = (c: FlowCall): boolean => c.status !== 'same' || c.kids.some(changed);
  const why = { before: f.root.before === undefined ? '変わる前にこの流れがありません' : undefined, change: changed(f.root) ? undefined : '変わった呼び出しがありません', after: f.root.after === undefined ? 'マージ後にこの流れがありません' : undefined };
  const out: NonNullable<CallFlow['stages']> = {};
  for (const k of ['before', 'change', 'after'] as const) {
    const t = o[k].trim();
    if (t === '') continue;
    const no = why[k];
    if (no !== undefined) info.push(`流れ ${f.id} の ${STAGE_TEXT[k]}を除外しました（${no}）`);
    else out[k] = t;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * 流れの題と並びを動きに写す（動きの地図が流れの地図に替わるまでのつなぎ。2026-11-05）。
 * 入口が同じ動きに同じ題を付け、流れの並びにする。対応する流れの無い動きは後ろに元の順で
 */
export function copyFlowTitles(behaviors: readonly Behavior[], flows: readonly CallFlow[]): Behavior[] {
  const byStart = new Map(flows.map((f, i) => [f.root.to, { f, i }]));
  const rank = (b: Behavior) => byStart.get(b.start)?.i ?? flows.length;
  return behaviors
    .map((b, j) => ({ b, j }))
    .sort((x, y) => rank(x.b) - rank(y.b) || x.j - y.j)
    .map(({ b }) => {
      const f = byStart.get(b.start)?.f;
      return f === undefined || f.titleProvenance !== 'llm' ? b : { ...b, title: f.title, titleProvenance: f.titleProvenance };
    });
}

function applyTitles<T extends Titled>(items: readonly T[], output: NarrationOutput['behaviors'], noun: string): { items: T[]; info: string[] } {
  const info: string[] = [];
  const byId = new Map(items.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const ordered: T[] = [];
  for (const o of output) {
    const b = byId.get(o.id);
    if (b === undefined) {
      info.push(`不明な${noun}の題を除外しました: ${o.id}`);
      continue;
    }
    if (seen.has(o.id)) {
      info.push(`${noun} ${o.id} の題が 2 回来たので最初だけ使いました`);
      continue;
    }
    seen.add(o.id);
    const title = o.title.trim().replace(/。$/, '').trim();
    ordered.push(title === '' ? b : { ...b, title, titleProvenance: 'llm' });
  }
  const rest = items.filter((b) => !seen.has(b.id));
  if (items.length > 0) info.push(`${noun}の題: ${ordered.filter((b) => b.titleProvenance === 'llm').length} / ${items.length} 本`);
  return { items: [...ordered, ...rest], info };
}
