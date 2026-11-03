// 2 回目の LLM が書いた動きの題を重ねる（設計書 3.3 / 5.4。2026-11-04）。全部プログラムで決める（原則 3）。
// 規則:
//   1. 知らない id の題は捨てる。同じ id が 2 回来たら最初だけ（最初の題が空でも後の分は使わない）
//   2. 題は前後の空白と末尾の句点を落とす。空なら題を付けない（始まりの短い名前のまま。titleProvenance は ast）
//   3. 並びは LLM の出力の順（見せる順）。LLM が書かなかった動きは、プログラムの順のまま後ろに付ける
//   4. 呼び出しの列は変えない。題と並びだけ
import type { Behavior } from '../model.js';
import type { NarrationOutput } from '../narration/types.js';

export function applyBehaviorTitles(behaviors: readonly Behavior[], output: NarrationOutput['behaviors']): { behaviors: Behavior[]; info: string[] } {
  const info: string[] = [];
  const byId = new Map(behaviors.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const ordered: Behavior[] = [];
  for (const o of output) {
    const b = byId.get(o.id);
    if (b === undefined) {
      info.push(`不明な動きの題を除外しました: ${o.id}`);
      continue;
    }
    if (seen.has(o.id)) {
      info.push(`動き ${o.id} の題が 2 回来たので最初だけ使いました`);
      continue;
    }
    seen.add(o.id);
    const title = o.title.trim().replace(/。$/, '').trim();
    ordered.push(title === '' ? b : { ...b, title, titleProvenance: 'llm' });
  }
  const rest = behaviors.filter((b) => !seen.has(b.id));
  if (behaviors.length > 0) info.push(`動きの題: ${ordered.filter((b) => b.titleProvenance === 'llm').length} / ${behaviors.length} 本`);
  return { behaviors: [...ordered, ...rest], info };
}
