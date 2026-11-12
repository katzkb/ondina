// 2 回目の LLM（文を書く。設計書 5.3 / 10 章）への入力を組む。決定的（原則 7）。
// - 差分の行は 1 回目の入力（hunks / rippleGroups）を使い回し、行の頭に head の行番号を付ける（確かめることの根拠の行を番号で選ばせる。2026-10-22）。停留所は hunkId で行を引く
// - 停留所はプログラムが組んだ読む順番（tours）のまま。LLM に並びを決めさせない（10.3）
// - 停留所は差分だけ（2026-10-11）。差分の無い呼び出しの相手はコースの related に名前だけ入れる（図の箱の「変えていない」の札の材料。文は書かせない）
// - 前からあるものの候補（existing。説明タブの背景。2026-10-29）は related の out と、この PR で消える宣言（hunks/removed.ts）。LLM はここから選ぶ（原則 3）
// - 流れ（2026-11-05。それまでは動き）は、変わる前と変わった後の呼び出しの木をそれぞれ呼ぶ順に開き、「呼ぶ側の短い名前: 呼び出しの式」で渡す。
//   変わった呼び出しは状態（足した / 変えた / 消した）を頭に付けて別の欄に並べる。LLM は題と段ごとの文を書き、見せる順に並べる
//   （呼ぶ順と状態はプログラムが組んだ事実。原則 3）。入力の欄の名前は behaviors のまま
// - 作者の説明・前回の結果・辺・層の無いパスは渡さない（文を書くのに要らない。入口の説明は差分だけから書く）
import { shortName } from '../behavior/build.js';
import { flowCallsInOrder, stageOf } from '../flow/build.js';
import type { Edge, CallFlow, FlowCall, How, Hunk, Symbol as OndinaSymbol, Tour } from '../model.js';
import { headLines } from '../hunks/changed-lines.js';
import type { RemovedDeclaration } from '../hunks/removed.js';
import type { LlmInput, LlmInputGroup } from '../label/types.js';
import type { NarrationInput, NarrationInputBehavior, NarrationInputCourse, NarrationInputExisting, NarrationInputRelated, NarrationInputStop } from './types.js';

export interface BuildNarrationInputArgs {
  /** 1 回目の入力（buildLlmInput の結果） */
  base: Pick<LlmInput, 'pr' | 'hunks' | 'rippleGroups'>;
  hows: readonly How[];
  /** 1 回目の検証後の hunk（hows で未帰属を、kind でテストを、lnNew で行番号を見る） */
  hunks: readonly Pick<Hunk, 'id' | 'kind' | 'hows' | 'lnNew'>[];
  symbols: readonly OndinaSymbol[];
  /** test の辺の元をテストの停留所にする（画面の地図と同じ判定）。call / test の辺の差分の無い相手は related */
  edges: readonly Pick<Edge, 'from' | 'to' | 'kind'>[];
  tours: readonly Tour[];
  /** この PR で消える宣言（removedDeclarations の結果）。前からあるものの候補になる */
  removed?: readonly RemovedDeclaration[];
  /** 流れ（buildFlows と attachFlowCalls の結果）。題を付けさせる */
  flows?: readonly CallFlow[];
}

export function buildNarrationInput({ base, hows, hunks, symbols, edges, tours, removed = [], flows = [] }: BuildNarrationInputArgs): NarrationInput {
  const symbolOf = new Map(symbols.map((s) => [s.id, s]));
  const hunkOf = new Map(hunks.map((h) => [h.id, h]));
  const tourOf = new Map(tours.map((t) => [t.howId, t]));
  const testFrom = new Set(edges.filter((e) => e.kind === 'test').map((e) => e.from));
  const groupOf = new Map(base.rippleGroups.flatMap((g) => [g.representative.hunkId, ...g.deviations.map((d) => d.hunkId)].map((id) => [id, g.id] as const)));

  const stop = (step: Tour['steps'][number]): NarrationInputStop => {
    const s = symbolOf.get(step.symbolId);
    const hunkId = step.hunkId ?? s?.hunkId;
    const groupId = hunkId === undefined ? undefined : groupOf.get(hunkId);
    return {
      symbolId: step.symbolId,
      symbol: s?.fqName ?? step.symbolId,
      path: s?.path ?? '',
      test: (hunkId !== undefined && hunkOf.get(hunkId)?.kind === 'test') || testFrom.has(step.symbolId),
      ...(hunkId === undefined ? {} : { hunkId }),
      ...(groupId === undefined ? {} : { groupId }),
      ...(step.call === '' ? {} : { call: step.call }),
    };
  };
  /** 古い経路に残る差分の無い停留所は入れない */
  const isDiff = (step: Tour['steps'][number]) => step.hunkId !== undefined || symbolOf.get(step.symbolId)?.changed !== false;
  const unchanged = (id: string) => symbolOf.get(id)?.changed === false;
  const related = (steps: readonly Tour['steps'][number][]): NarrationInputRelated[] => {
    const out: NarrationInputRelated[] = [];
    const seen = new Set<string>();
    const byName = (a: string, b: string) => (symbolOf.get(a)!.fqName < symbolOf.get(b)!.fqName ? -1 : 1);
    for (const step of steps) {
      const callers = edges.filter((e) => e.kind === 'call' && e.to === step.symbolId && unchanged(e.from)).map((e) => e.from);
      const callees = edges.filter((e) => (e.kind === 'call' || e.kind === 'test') && e.from === step.symbolId && unchanged(e.to)).map((e) => e.to);
      for (const [dir, ids] of [['in', callers], ['out', callees]] as const) {
        for (const id of [...new Set(ids)].sort(byName)) {
          if (seen.has(`${dir}:${id}`)) continue;
          seen.add(`${dir}:${id}`);
          const s = symbolOf.get(id)!;
          out.push({ of: step.symbolId, dir, symbol: s.fqName, path: s.path });
        }
      }
    }
    return out;
  };

  const numbered = (id: string, lines: readonly string[]): string[] => numberLines(lines, hunkOf.get(id)?.lnNew ?? 1);
  const groupLines = (x: LlmInputGroup['representative']) => ({ ...x, lines: numbered(x.hunkId, x.lines) });

  const courses = hows.flatMap((w): NarrationInputCourse[] => {
    const t = tourOf.get(w.id);
    if (t === undefined) return [];
    const steps = t.steps.filter(isDiff);
    return [{ howId: w.id, title: w.title, why: w.why, stops: steps.map(stop), related: related(steps) }];
  });
  const kindOf = new Map(symbols.map((s) => [s.fqName, s.kind]));
  const nameOf = (id: string) => shortName(symbolOf.get(id) ?? { fqName: id });
  const callsOf = (c: FlowCall, side: 'before' | 'after'): string[] =>
    c.kids.flatMap((k) => [`${nameOf(k.from!)}: ${k[side]?.call?.text ?? nameOf(k.to)}`, ...callsOf(k, side)]);
  const sideCalls = (root: FlowCall, side: 'before' | 'after'): string[] => {
    const tree = stageOf(root, side);
    return tree === undefined ? [] : callsOf(tree, side);
  };
  const changesOf = (c: FlowCall): string[] =>
    c.kids.flatMap((k) => {
      const pre = k.before?.call?.text;
      const post = k.after?.call?.text;
      const expr = k.status === 'removed' ? (pre ?? nameOf(k.to)) : k.status === 'changed' && pre !== undefined && post !== undefined && pre !== post ? `${pre} → ${post}` : (post ?? pre ?? nameOf(k.to));
      return [...(k.status === 'same' ? [] : [`${CHANGE_WORD[k.status]} ${nameOf(k.from!)}: ${expr}`]), ...changesOf(k)];
    });
  const callsList = (f: CallFlow): NarrationInputBehavior['calls'] =>
    flowCallsInOrder(f.root).map((c, i) => ({
      id: `c${i + 1}`,
      call: c.from === null ? `入口: ${nameOf(c.to)}` : `${nameOf(c.from)}: ${c.after?.call?.text ?? c.before?.call?.text ?? nameOf(c.to)}`,
      status: CALL_STATUS_WORD[c.status],
    }));
  const moves = flows.map((f): NarrationInputBehavior => ({
    id: f.id,
    start: symbolOf.get(f.root.to)?.fqName ?? f.root.to,
    before: sideCalls(f.root, 'before'),
    after: sideCalls(f.root, 'after'),
    changes: changesOf(f.root),
    calls: callsList(f),
  }));
  const used = [...new Map(courses.flatMap((c) => c.related.filter((r) => r.dir === 'out')).map((r) => [r.symbol, r])).values()];

  return {
    pr: { title: base.pr.title },
    hunks: base.hunks.map((h) => ({ ...h, lines: numbered(h.id, h.lines) })),
    rippleGroups: base.rippleGroups.map((g) => ({ ...g, representative: groupLines(g.representative), deviations: g.deviations.map(groupLines) })),
    courses,
    unassigned: hunks.filter((h) => h.hows.length === 0).map((h) => h.id),
    existing: [
      ...used.map((r): NarrationInputExisting => ({ symbol: r.symbol, path: r.path, kind: kindOf.get(r.symbol)!, removed: false })),
      ...removed.map((d): NarrationInputExisting => ({ symbol: d.fqName, path: d.path, kind: d.kind, removed: true })),
    ],
    ...(moves.length === 0 ? {} : { behaviors: moves }),
  };
}

const CALL_STATUS_WORD = { same: '同じ', changed: '変えた', added: '足した', removed: '消した' } as const;
const CHANGE_WORD = { added: '足した', changed: '変えた', removed: '消した' } as const;

/** 統合形式の行の頭に head の行番号と「|」を付ける。削除の行（"-"）は番号の代わりに空白。桁はいちばん大きい番号に揃える */
function numberLines(lines: readonly string[], lnNew: number): string[] {
  const nums = headLines({ lnNew, lines: [...lines] });
  const width = String(nums.reduce<number>((m, x) => Math.max(m, x ?? 0), lnNew)).length;
  return lines.map((l, i) => `${nums[i] === null ? ' '.repeat(width) : String(nums[i]).padStart(width)}|${l}`);
}
