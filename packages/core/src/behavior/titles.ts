// 2 回目の LLM が書いた動きの題を重ねる（設計書 3.3 / 5.4。2026-11-04）。全部プログラムで決める（原則 3）。
// 規則:
//   1. 知らない id の題は捨てる。同じ id が 2 回来たら最初だけ（最初の題が空でも後の分は使わない）
//   2. 題は前後の空白と末尾の句点を落とす。空なら題を付けない（始まりの短い名前のまま。titleProvenance は ast）
//   3. 並びは LLM の出力の順（見せる順）。LLM が書かなかった動きは、プログラムの順のまま後ろに付ける
//   4. 呼び出しの列は変えない。題と並びだけ
import type { Behavior, CallFlow } from '../model.js';
import type { NarrationOutput } from '../narration/types.js';

type Titled = { id: string; title: string; titleProvenance: Behavior['titleProvenance'] };

export function applyBehaviorTitles(behaviors: readonly Behavior[], output: NarrationOutput['behaviors']): { behaviors: Behavior[]; info: string[] } {
  const r = applyTitles(behaviors, output, '動き');
  return { behaviors: r.items, info: r.info };
}

/** 流れ（2026-11-05）の題。規則は動きと同じ。LLM の出力の欄は behaviors のまま（入力の behaviors[] に流れを入れている） */
export function applyFlowTitles(flows: readonly CallFlow[], output: NarrationOutput['behaviors']): { flows: CallFlow[]; info: string[] } {
  const r = applyTitles(flows, output, '流れ');
  return { flows: r.items, info: r.info };
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
