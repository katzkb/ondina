// 流れの地図（設計書 3.1。2026-11-05 の見本 flow5）のステップ。流れの木（Analysis.flows）を段ごとに「呼ぶ → 中の呼び出し → 戻る」の順に開く。
// ① 背景 = 変わる前にある呼び出しだけ、② この PR = 全部（状態で色）、③ マージ後 = 変わった後にある呼び出しだけ。
// コースの範囲では、そのコースの変更の呼び出しとその戻りだけで止まる（ほかは灰色）。ここは純粋関数（reducer と画面の両方が使う）
import type { Analysis, CallFlow, FlowCall, Provenance } from '@ondina/model';

export type Stage = 1 | 2 | 3;

export interface FlowStep {
  /** 1 から */
  i: number;
  /** 筋書きのステップは常に call。筋書きが無い流れだけ、呼び出しの後に戻りのステップが来る */
  dir: 'call' | 'ret';
  /** 通る呼び出し（呼ぶ順）。筋書きが無ければ 1 つ */
  calls: FlowCall[];
  /** calls と同じ並びの呼び出しの番号（その段を深さ優先で歩いた呼ばれる順。戻りは呼び出しと同じ番号） */
  nums: number[];
  /** 筋書きのステップだけ。provenance が llm なら画面は AI の札と点線 */
  title?: { text: string; provenance: Provenance };
}

/** その段にある呼び出しか。根は入口の状態で決める（足しただけの入口は ① に無く、消しただけの入口は ③ に無い） */
export function inStage(c: FlowCall, stage: Stage): boolean {
  if (stage === 2) return true;
  if (c.from === null) return stage === 1 ? c.status !== 'added' : c.status !== 'removed';
  return stage === 1 ? c.before !== undefined : c.after !== undefined;
}

/** 段のステップ。入口がその段に無ければ空。筋書きがあれば筋書きのステップ（段にある呼び出しだけ。空は落とす）、無ければ呼び出しごとに 呼ぶ → 中 → 戻る */
export function flowSteps(flow: CallFlow, stage: Stage): FlowStep[] {
  if (!inStage(flow.root, stage)) return [];
  const nums = new Map<string, number>();
  const byKey = new Map<string, FlowCall>();
  const plain: FlowStep[] = [];
  const walk = (c: FlowCall) => {
    const num = nums.size + 1;
    nums.set(c.key, num);
    byKey.set(c.key, c);
    plain.push({ i: plain.length + 1, dir: 'call', calls: [c], nums: [num] });
    for (const k of c.kids) if (inStage(k, stage)) walk(k);
    plain.push({ i: plain.length + 1, dir: 'ret', calls: [c], nums: [num] });
  };
  walk(flow.root);
  const story: FlowStep[] = [];
  for (const st of flow.story ?? []) {
    const calls = st.calls.flatMap((k) => (nums.has(k) ? [byKey.get(k)!] : []));
    if (calls.length === 0) continue;
    story.push({ i: story.length + 1, dir: 'call', calls, nums: calls.map((c) => nums.get(c.key)!), title: { text: st.title, provenance: st.titleProvenance } });
  }
  // 筋書きがこの段の呼び出しを 1 つも含まなければ、今までどおり 1 呼び出しずつ
  return story.length > 0 ? story : plain;
}

/** 段をまたいで同じステップを指す鍵（筋書きのステップは先頭の呼び出し） */
export const stepKey = (s: FlowStep) => `${s.calls[0]!.key}|${s.dir}`;

/** 範囲: コースの番号、または色を付ける呼び出しの key の集合（要求コースの章） */
export type Scope = number | ReadonlySet<string>;

/** その範囲の変更の呼び出しか */
export const callInCourse = (c: FlowCall, course: Scope) => (typeof course === 'number' ? c.courses.includes(course) : course.has(c.key));

/** その範囲の変更のステップか（呼び出しのどれかが範囲に入る） */
export const inCourse = (s: FlowStep, course: Scope) => s.calls.some((c) => callInCourse(c, course));

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
  // 呼び出しの key から、それを通る「呼ぶ」ステップへ
  const callAt = new Map<string, number>();
  for (const s of to) if (s.dir === 'call') for (const c of s.calls) if (!callAt.has(c.key)) callAt.set(c.key, s.i);
  // 鍵は根からの道を / で繋いだもの。自分の呼び出し（呼ぶ向きのとき）、無ければ親の呼び出しの「呼ぶ」ステップへ
  const parts = cur.calls[0]!.key.split('/');
  for (let k = cur.dir === 'call' ? parts.length : parts.length - 1; k > 0; k--) {
    const hit = callAt.get(parts.slice(0, k).join('/'));
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
