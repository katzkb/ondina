// 流れの地図（設計書 3.1。2026-11-05 の見本 flow5）のステップ。流れの木（Analysis.flows）を段ごとに「呼ぶ → 中の呼び出し → 戻る」の順に開く。
// ① 背景 = 変わる前にある呼び出しだけ、② この PR = 全部（状態で色）、③ マージ後 = 変わった後にある呼び出しだけ。
// コースの範囲では、そのコースの変更の呼び出しとその戻りだけで止まる（ほかは灰色）。ここは純粋関数（reducer と画面の両方が使う）
import type { Analysis, CallFlow, FlowCall } from '@ondina/model';

export type Stage = 1 | 2 | 3;

export interface FlowStep {
  /** 1 から */
  i: number;
  /** 呼び出しの番号（呼ばれる順。戻りは呼び出しと同じ番号） */
  n: number;
  dir: 'call' | 'ret';
  call: FlowCall;
}

/** その段にある呼び出しか。根は入口の状態で決める（足しただけの入口は ① に無く、消しただけの入口は ③ に無い） */
export function inStage(c: FlowCall, stage: Stage): boolean {
  if (stage === 2) return true;
  if (c.from === null) return stage === 1 ? c.status !== 'added' : c.status !== 'removed';
  return stage === 1 ? c.before !== undefined : c.after !== undefined;
}

/** 段のステップ。入口がその段に無ければ空 */
export function flowSteps(flow: CallFlow, stage: Stage): FlowStep[] {
  const out: FlowStep[] = [];
  let n = 0;
  const walk = (c: FlowCall) => {
    const num = ++n;
    out.push({ i: out.length + 1, n: num, dir: 'call', call: c });
    for (const k of c.kids) if (inStage(k, stage)) walk(k);
    out.push({ i: out.length + 1, n: num, dir: 'ret', call: c });
  };
  if (inStage(flow.root, stage)) walk(flow.root);
  return out;
}

/** 段をまたいで同じステップを指す鍵 */
export const stepKey = (s: FlowStep) => `${s.call.key}|${s.dir}`;

/** 範囲: コースの番号、または色を付ける呼び出しの key の集合（要求コースの章） */
export type Scope = number | ReadonlySet<string>;

/** その範囲の変更のステップか（呼び出しとその戻り） */
export const inCourse = (s: FlowStep, course: Scope) => (typeof course === 'number' ? s.call.courses.includes(course) : course.has(s.call.key));

/** コースの範囲はこの PR の段だけで効く（見本: ① と ③ は流れそのもの） */
export const scoped = (stage: Stage, course: Scope | null): course is Scope => stage === 2 && course !== null;

/** 止まるステップの番号（1 から、昇順）。コースの範囲ならそのコースのステップだけ。範囲の中に 1 つも無ければ全部 */
export function stopsOf(steps: readonly FlowStep[], stage: Stage, course: Scope | null): number[] {
  const all = steps.map((s) => s.i);
  if (!scoped(stage, course)) return all;
  const mine = steps.filter((s) => inCourse(s, course)).map((s) => s.i);
  return mine.length > 0 ? mine : all;
}

/** そのコースの変更が乗る流れ（読む前の案内の地図に出す流れ） */
export function courseFlows(analysis: Pick<Analysis, 'flows'>, course: number): CallFlow[] {
  return (analysis.flows ?? []).filter((f) => flowSteps(f, 2).some((s) => inCourse(s, course)));
}

/** 選んでいる流れ。flowId が無ければ、コースを選んでいればそのコースが通る最初の流れ、無ければ最初の流れ */
export function pickFlow(analysis: Pick<Analysis, 'flows'>, flowId: string | null, course: number | null): CallFlow | null {
  const flows = analysis.flows ?? [];
  const chosen = flowId === null ? undefined : flows.find((f) => f.id === flowId);
  if (chosen) return chosen;
  if (course !== null) {
    const hit = flows.find((f) => flowSteps(f, 2).some((s) => inCourse(s, course)));
    if (hit) return hit;
  }
  return flows[0] ?? null;
}

/** 今のステップ（1 から）。0 や範囲の外は止まるステップの最初へ寄せる */
export function curStep(stops: readonly number[], step: number): number {
  if (stops.length === 0) return 0;
  return stops.includes(step) ? step : (stops.find((x) => x >= step) ?? stops[0]!);
}

/** 次・前の止まるステップ。端では動かない */
export function nextStop(stops: readonly number[], step: number, dir: 1 | -1): number {
  if (stops.length === 0) return 0;
  const cur = curStep(stops, step);
  const k = stops.indexOf(cur) + dir;
  return stops[Math.max(0, Math.min(stops.length - 1, k))]!;
}

/** 段を替えたときのステップ: 同じ呼び出しの同じ向きに留まる。新しい段に無ければ、近い呼び出し（親を辿る）、それも無ければ最初 */
export function carryStep(from: readonly FlowStep[], to: readonly FlowStep[], step: number): number {
  const cur = from[step - 1];
  if (!cur) return to[0]?.i ?? 0;
  const at = new Map(to.map((s) => [stepKey(s), s.i]));
  const same = at.get(stepKey(cur));
  if (same !== undefined) return same;
  // 鍵は根からの道を / で繋いだもの。親の呼び出しの「呼ぶ」ステップへ
  const parts = cur.call.key.split('/');
  for (let k = parts.length - 1; k > 0; k--) {
    const hit = at.get(`${parts.slice(0, k).join('/')}|call`);
    if (hit !== undefined) return hit;
  }
  return to[0]?.i ?? 0;
}

/** 木の全部の呼び出し（根から、呼ぶ順） */
export function allCalls(flow: CallFlow): FlowCall[] {
  const out: FlowCall[] = [];
  const walk = (c: FlowCall) => {
    out.push(c);
    c.kids.forEach(walk);
  };
  walk(flow.root);
  return out;
}

/** ② の数（根を除く呼び出し） */
export function statusCounts(flow: CallFlow): Record<FlowCall['status'], number> {
  const n = { same: 0, changed: 0, added: 0, removed: 0 };
  for (const c of allCalls(flow)) if (c.from !== null) n[c.status]++;
  return n;
}
