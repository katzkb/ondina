// 2 回目の LLM が書いた動きの題を重ねる（設計書 3.3 / 5.4。2026-11-04）。全部プログラムで決める（原則 3）。
// 規則:
//   1. 知らない id の題は捨てる。同じ id が 2 回来たら最初だけ（最初の題が空でも後の分は使わない）
//   2. 題は前後の空白と末尾の句点を落とす。空なら題を付けない（始まりの短い名前のまま。titleProvenance は ast）
//   3. 並びは LLM の出力の順（見せる順）。LLM が書かなかった動きは、プログラムの順のまま後ろに付ける
//   4. 呼び出しの列は変えない。題と並びだけ
//   6. 筋書き（2026-11-12）。出力の steps があるときだけ、storyOf の規則で検査して CallFlow.story を付ける
//   5. 流れの段の文（2026-11-05）: 前後の空白を落とし、空なら欄を付けない。① はその流れに変わる前の入口があるときだけ、③ はマージ後の入口があるときだけ、
//      ② は入口か呼び出しのどれかが変わっているときだけ残す（それ以外は捨てて知らせる）。題を使わなかった同じ id の 2 回目の文も使わない
import { flowCallsInOrder } from '../flow/build.js';
import type { Behavior, CallFlow, FlowCall, FlowStoryStep } from '../model.js';
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
    const story = storyOf(f, o.steps, info);
    return { ...f, ...(stages === undefined ? {} : { stages }), ...(story === undefined ? {} : { story }) };
  });
  const r = applyTitles(staged, output, '流れ');
  info.push(...r.info);
  const n = (k: keyof NonNullable<CallFlow['stages']>) => r.items.filter((f) => f.stages?.[k] !== undefined).length;
  if (r.items.some((f) => f.stages !== undefined)) info.push(`流れの段の文: ① ${n('before')}・② ${n('change')}・③ ${n('after')} / ${r.items.length} 本`);
  return { flows: r.items, info };
}

/** 筋書きのステップの上限（規則 2）。これを超えたステップは捨てる */
export const MAX_STORY_STEPS = 7;

/**
 * 規則 6（筋書き。2026-11-12）。全部プログラム。LLM の steps が 1 つ以上あるときだけ動く。
 *   1. 知らない id は捨てる  2. MAX_STORY_STEPS 個を超えたステップは捨てる（中の呼び出しは「入らなかった」扱い）
 *   3. 見出しが空のステップは捨てる  4. 同じ呼び出しの 2 回目は捨てる
 *   5. 呼ぶ側（木の親）が前のステップか同じステップに無い呼び出しは外す。根は親なし
 *   6. 呼び出しが 0 個になったステップは捨てる。ステップの中は木の深さ優先の順に並べ直す
 *   7. LLM のステップが残らなければ story を付けない
 *   8. 残ったら、same 以外でどのステップにも入らなかった呼び出しを最後の 1 ステップ（ast）に足す
 *   9. 最後に info に 1 行
 * id は入力と同じ順（flowCallsInOrder）で "c1" から付ける
 */
function storyOf(f: CallFlow, steps: NarrationOutput['behaviors'][number]['steps'], info: string[]): FlowStoryStep[] | undefined {
  if (steps.length === 0) return undefined;
  const order = flowCallsInOrder(f.root);
  const byId = new Map(order.map((c, i) => [`c${i + 1}`, i]));
  const parentOf = new Map<number, number>();
  const walk = (c: FlowCall, at: number): void => {
    for (const k of c.kids) {
      const ki = order.indexOf(k);
      parentOf.set(ki, at);
      walk(k, ki);
    }
  };
  walk(f.root, 0);
  const placed = new Set<number>();
  const story: FlowStoryStep[] = [];
  const tag = `流れ ${f.id} の筋書き`;
  steps.forEach((s, n) => {
    if (n >= MAX_STORY_STEPS) {
      info.push(`${tag}の ${n + 1} 個目のステップを除外しました（${MAX_STORY_STEPS} 個まで）`);
      return;
    }
    const title = s.title.trim().replace(/。$/, '').trim();
    if (title === '') {
      info.push(`${tag}の ${n + 1} 個目のステップを除外しました（見出しが空です）`);
      return;
    }
    const mine = new Set<number>();
    for (const id of s.calls) {
      const i = byId.get(id);
      if (i === undefined) info.push(`${tag}の ${n + 1} 個目のステップから不明な呼び出しを除外しました: ${id}`);
      else if (placed.has(i) || mine.has(i)) info.push(`${tag}の ${n + 1} 個目のステップから重なった呼び出しを除外しました: ${id}`);
      else mine.add(i);
    }
    const kept: number[] = [];
    for (const i of [...mine].sort((a, b) => a - b)) {
      const p = parentOf.get(i);
      if (p !== undefined && !placed.has(p) && !kept.includes(p)) info.push(`${tag}の ${n + 1} 個目のステップから呼ぶ側より先の呼び出しを除外しました: c${i + 1}`);
      else kept.push(i);
    }
    if (kept.length === 0) {
      info.push(`${tag}の ${n + 1} 個目のステップを除外しました（通る呼び出しがありません）`);
      return;
    }
    for (const i of kept) placed.add(i);
    story.push({ title, titleProvenance: 'llm', calls: kept.map((i) => order[i]!.key) });
  });
  if (story.length === 0) {
    info.push(`${tag}を除外しました（使えるステップがありません）`);
    return undefined;
  }
  const llm = story.length;
  const rest = order.flatMap((c, i) => (c.status !== 'same' && !placed.has(i) ? [c.key] : []));
  if (rest.length > 0) story.push({ title: `まとめに入らなかった呼び出し ${rest.length} 個`, titleProvenance: 'ast', calls: rest });
  info.push(`${tag}: ステップ ${story.length}（AI ${llm}・まとめに入らなかった呼び出し ${rest.length} 個）`);
  return story;
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
