// 処理の流れ（設計書 3.3。2026-11-05）を、変わる前（edgesBase）と変わった後（edges）の呼び出しの線から組む。決定的（原則 7）。
// LLM は使わない（題は 2 回目の LLM が後で付ける）。地図の ① 背景 / ② この PR / ③ マージ後 は、この木を片側だけ辿るか全部辿るかの違い。
//
// 規則:
// - 呼ぶ側ごとの呼び出しの並び（行ごとに 1 回、インターフェースと実装の 2 本は 1 本）は動きと同じ（behavior/build.ts の callsOutOf）を側ごとに作る
// - 突き合わせ: 同じ呼ぶ側から同じ先への n 回目どうし。両方にあれば、呼んでいる行が差分の行（base は消した行、head は足した行）に
//   入るとき changed、入らなければ same。片方にだけあれば added / removed。
//   n 回目で合わせるので、同じ先への呼び出しの前に同じ先への呼び出しを足すと、足した方でなく後ろの方が added になる（既知の穴）
// - 並び: 変わった後の順。消えた呼び出しは、変わる前の順で直前にあった呼び出しの後ろに入れる
// - 入口 = 差分があり、変わる前にも後にも差分のある呼び出し元を持たないシンボル。呼び出しをどちらの側にも持たないものは流れにしない。
//   並びは入口の層の順 → FQ 名 → id（動きと同じ）
// - 呼ばれるたびに中を開く（同じ save を 2 回呼べば 2 回開く）。開くのは親と同じ側の呼び出しだけ（消えた呼び出しの先は変わる前の呼び出しだけ）。
//   深さ 6・同じ道の上に同じシンボルがある（輪）・1 本の木が 1000 呼び出しを超える、のどれかで開かずに cut を付ける
// - 根の状態は入口の hunk の行の形で決める: + も - も無い = same、+ だけ = added、- だけ = removed、ほか = changed
// - コース: 呼んでいる行が入る hunk の How。パスは呼ぶ側のシンボルのパスで引く（名前を変えたファイルの base の行は当たらない。既知の穴）
import type { BehaviorMessage, Edge, CallFlow, FlowCall, Hunk, Symbol as OndinaSymbol } from '../model.js';
import { callsOutOf, shortName } from '../behavior/build.js';
import { changedLines } from '../hunks/changed-lines.js';

export interface BuildFlowsArgs {
  /** 変わる前にだけある未変更シンボルも入れる（Analysis.symbols） */
  symbols: readonly OndinaSymbol[];
  /** 変わった後の線（Analysis.edges） */
  edges: readonly Edge[];
  /** 変わる前の線（Analysis.edgesBase）。無い解析では空 */
  edgesBase: readonly Edge[];
  hunks: readonly Pick<Hunk, 'id' | 'path' | 'group' | 'hows' | 'lnOld' | 'lnNew' | 'lines'>[];
  /** 設定の layers の並び */
  layers: ReadonlyArray<{ name: string }>;
}

export const FLOW_MAX_DEPTH = 6;
export const FLOW_MAX_CALLS = 1000;

type Side = 'before' | 'after';

interface Pair {
  local: string;
  to: string;
  b?: BehaviorMessage;
  a?: BehaviorMessage;
}

export function buildFlows(args: BuildFlowsArgs): CallFlow[] {
  const head = callsOutOf({ symbols: args.symbols, edges: args.edges, hunks: args.hunks, layers: args.layers });
  const base = callsOutOf({ symbols: args.symbols, edges: args.edgesBase, hunks: args.hunks, layers: args.layers });
  const { byId, hidden, order } = head;

  // パスごとの hunk と、その消した行・足した行
  const byPath = new Map<string, Array<{ hows: number[]; old: Set<number>; added: Set<number> }>>();
  for (const h of args.hunks) {
    const { oldLines, newLines } = changedLines(h);
    byPath.set(h.path, [...(byPath.get(h.path) ?? []), { hows: h.hows, old: new Set(oldLines), added: new Set(newLines) }]);
  }
  const hunksAt = (from: string, line: number | undefined, side: Side) => {
    const p = byId.get(from)?.path;
    if (p === undefined || line === undefined) return [];
    return (byPath.get(p) ?? []).filter((h) => (side === 'before' ? h.old : h.added).has(line));
  };

  /** 呼ぶ側 id の呼び出しを、変わる前と後で突き合わせて並べる */
  const pairsOf = (id: string): Pair[] => {
    const number = (list: readonly BehaviorMessage[]) => {
      const seen = new Map<string, number>();
      return list.map((m) => {
        const n = (seen.get(m.to) ?? 0) + 1;
        seen.set(m.to, n);
        return { local: `${id}>${m.to}#${n}`, m };
      });
    };
    const before = number(base.outOf.get(id) ?? []);
    const after = number(head.outOf.get(id) ?? []);
    const beforeAt = new Map(before.map((x, i) => [x.local, i]));
    const afterKeys = new Set(after.map((x) => x.local));
    const out: Pair[] = [];
    let next = 0; // まだ出していない変わる前の位置
    const flushRemoved = (until: number): void => {
      for (; next < until; next++) {
        const x = before[next]!;
        if (!afterKeys.has(x.local)) out.push({ local: x.local, to: x.m.to, b: x.m });
      }
    };
    for (const x of after) {
      const j = beforeAt.get(x.local);
      if (j !== undefined) {
        flushRemoved(j);
        next = Math.max(next, j + 1);
      }
      out.push({ local: x.local, to: x.m.to, a: x.m, ...(j === undefined ? {} : { b: before[j]!.m }) });
    }
    flushRemoved(before.length);
    return out;
  };

  const site = (m: BehaviorMessage | undefined) => (m === undefined ? undefined : { ...(m.line === undefined ? {} : { line: m.line }), ...(m.returns === undefined ? {} : { returns: m.returns }) });

  const changedCallers = new Set([...head.calls, ...base.calls].filter((e) => byId.get(e.from)!.changed).map((e) => e.to));
  const hasCalls = (id: string): boolean => (head.outOf.get(id)?.length ?? 0) + (base.outOf.get(id)?.length ?? 0) > 0;
  const starts = args.symbols.filter((s) => s.changed && !hidden.has(s.id) && !changedCallers.has(s.id) && hasCalls(s.id)).sort(order);
  const hunkOf = new Map(args.hunks.map((h) => [h.id, h]));

  return starts.map((start, i) => {
    let size = 0;
    const open = (id: string, key: string, sides: ReadonlySet<Side>, path: readonly string[]): { kids: FlowCall[]; cut?: true } => {
      const pairs = pairsOf(id).filter((p) => (p.b !== undefined && sides.has('before')) || (p.a !== undefined && sides.has('after')));
      if (pairs.length === 0) return { kids: [] };
      if (path.length >= FLOW_MAX_DEPTH || path.includes(id) || size >= FLOW_MAX_CALLS) return { kids: [], cut: true };
      const kids = pairs.map((p): FlowCall => {
        size++;
        const b = sides.has('before') ? p.b : undefined;
        const a = sides.has('after') ? p.a : undefined;
        const at = [...hunksAt(id, b?.line, 'before'), ...hunksAt(id, a?.line, 'after')];
        const status = b === undefined ? 'added' : a === undefined ? 'removed' : at.length > 0 ? 'changed' : 'same';
        const childKey = `${key}/${p.local}`;
        const childSides = new Set<Side>([...(b === undefined ? [] : ['before' as const]), ...(a === undefined ? [] : ['after' as const])]);
        const inner = open(p.to, childKey, childSides, [...path, id]);
        return {
          key: childKey,
          from: id,
          to: p.to,
          status,
          ...(b === undefined ? {} : { before: site(b)! }),
          ...(a === undefined ? {} : { after: site(a)! }),
          courses: uniq(at.flatMap((h) => h.hows)),
          ...inner,
        };
      });
      return { kids };
    };

    const hunk = start.hunkId === undefined ? undefined : hunkOf.get(start.hunkId);
    const status = rootStatus(hunk);
    const sides = new Set<Side>([...(status === 'added' ? [] : ['before' as const]), ...(status === 'removed' ? [] : ['after' as const])]);
    const key = `>${start.id}#1`;
    const root: FlowCall = {
      key,
      from: null,
      to: start.id,
      status,
      ...(sides.has('before') ? { before: {} } : {}),
      ...(sides.has('after') ? { after: {} } : {}),
      courses: status === 'same' || hunk === undefined ? [] : uniq(hunk.hows),
      ...open(start.id, key, sides, []),
    };
    return { id: `f${i + 1}`, title: shortName(start), titleProvenance: 'ast', root };
  });
}

/** 片側（① = before、③ = after）だけを辿った木。根にその側が無ければ undefined */
export function stageOf(call: FlowCall, side: Side): FlowCall | undefined {
  if (call[side] === undefined) return undefined;
  return { ...call, kids: call.kids.map((k) => stageOf(k, side)).filter((k): k is FlowCall => k !== undefined) };
}

/** 呼び出しの木を深さ優先（呼ぶ順）で平らにする。根を含む。LLM への入力の id（c1 から）と筋書きの検査が同じ順を使う（2026-11-12） */
export function flowCallsInOrder(root: FlowCall): FlowCall[] {
  return [root, ...root.kids.flatMap(flowCallsInOrder)];
}

function rootStatus(h: Pick<Hunk, 'lines'> | undefined): FlowCall['status'] {
  if (h === undefined) return 'changed';
  const has = (c: string) => h.lines.some((l) => l[0] === c);
  const plus = has('+');
  const minus = has('-');
  if (!plus && !minus) return 'same';
  if (has(' ')) return 'changed';
  if (!minus) return 'added';
  if (!plus) return 'removed';
  return 'changed';
}

const uniq = (xs: number[]): number[] => [...new Set(xs)].sort((a, b) => a - b);
