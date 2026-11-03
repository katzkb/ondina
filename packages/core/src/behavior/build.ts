// 動き（設計書 3.3。2026-11-04）を呼び出しの線から組む。決定的（原則 7）。LLM は使わない（題は 2 回目の LLM が後で付ける）。
//
// 規則:
// - 線は call だけ（テストからの呼び出しと参照は辿らない）。追従グループの代表でないメンバーは使わない（コースと同じ）
// - 始まり = 差分があり、差分のある呼び出し元を持たないシンボル。call の線を 1 本も出さないものは動きにしない。
//   「API 層から」にしないのは、層の名前に頼らずどのリポジトリでも同じ規則にするため（2026-11-04。見本で決めた）
// - 始まりから深さ優先で、呼ぶ順に並べる。同じ呼ぶ側の中は呼んでいる行（Edge.lines）の順。1 本の線が何行かで呼んでいれば行ごとに 1 回。
//   行の無い線は後ろに、層の順 → FQ 名で
// - 同じシンボルの中へは 1 回だけ入る（2 回目からは呼び出しだけを並べる。輪になっても終わる）
// - 同じ呼ぶ側・同じ行・同じ名前の呼び出しが 2 本あれば 1 本にする（言語サーバーはインターフェースと実装の両方を返す。
//   fixture の OrderRepository.save と OrderRepositoryImpl.save）。差分のある方 → FQ 名の順で先の方を残す
// - 動きの並びは始まりの層の順 → FQ 名 → id
// - 戻り型は線の types.out（言語サーバーの事実）。呼び出しの式はここでは付けない（calls.ts が構文木から付ける）
import type { Behavior, BehaviorMessage, Edge, Hunk, Symbol as OndinaSymbol } from '../model.js';

export interface BuildBehaviorsArgs {
  symbols: readonly OndinaSymbol[];
  edges: readonly Edge[];
  /** 追従グループの代表でないメンバーを外すのに使う */
  hunks: readonly Pick<Hunk, 'id' | 'group'>[];
  /** 設定の layers の並び */
  layers: ReadonlyArray<{ name: string }>;
}

export function buildBehaviors(args: BuildBehaviorsArgs): Behavior[] {
  const byId = new Map(args.symbols.map((s) => [s.id, s]));
  const byHunk = new Map(args.symbols.filter((s) => s.hunkId !== undefined).map((s) => [s.hunkId!, s.id]));
  const layerIndex = (s: OndinaSymbol): number => {
    const i = args.layers.findIndex((l) => l.name === s.layer);
    return i === -1 ? args.layers.length : i;
  };
  const order = (a: OndinaSymbol, b: OndinaSymbol): number => layerIndex(a) - layerIndex(b) || cmp(a.fqName, b.fqName) || cmp(a.id, b.id);
  const hidden = new Set(args.hunks.filter((h) => h.group !== undefined && h.group.representative !== h.id).map((h) => byHunk.get(h.id)));
  const calls = args.edges.filter((e) => e.kind === 'call' && byId.has(e.from) && byId.has(e.to) && !hidden.has(e.from) && !hidden.has(e.to));

  // 呼ぶ側ごとの呼び出し（行ごとに 1 回）を、呼ぶ順に
  const outOf = new Map<string, BehaviorMessage[]>();
  for (const from of new Set(calls.map((e) => e.from))) {
    const raw = calls
      .filter((e) => e.from === from)
      .flatMap((e): BehaviorMessage[] => {
        const returns = e.types?.out === undefined ? {} : { returns: e.types.out };
        const lines = e.lines ?? [];
        return lines.length === 0 ? [{ from, to: e.to, ...returns }] : lines.map((line) => ({ from, to: e.to, line, ...returns }));
      })
      .sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER) || order(byId.get(a.to)!, byId.get(b.to)!));
    const kept: BehaviorMessage[] = [];
    for (const m of raw) {
      const twin = m.line === undefined ? -1 : kept.findIndex((k) => k.line === m.line && lastName(byId.get(k.to)!) === lastName(byId.get(m.to)!));
      if (twin === -1) kept.push(m);
      else if (prefer(byId.get(m.to)!, byId.get(kept[twin]!.to)!)) kept[twin] = m;
    }
    outOf.set(from, kept);
  }

  const changedCallers = new Set(calls.filter((e) => byId.get(e.from)!.changed).map((e) => e.to));
  const starts = args.symbols.filter((s) => s.changed && !hidden.has(s.id) && !changedCallers.has(s.id) && (outOf.get(s.id)?.length ?? 0) > 0).sort(order);

  return starts.map((start, i) => {
    const messages: BehaviorMessage[] = [];
    const entered = new Set<string>();
    const enter = (id: string): void => {
      entered.add(id);
      for (const m of outOf.get(id) ?? []) {
        messages.push(m);
        if (!entered.has(m.to)) enter(m.to);
      }
    };
    enter(start.id);
    return { id: `b${i + 1}`, title: shortName(start), titleProvenance: 'ast', start: start.id, messages };
  });
}

/** a を b より先に残すか。差分のある方 → FQ 名 → id */
function prefer(a: OndinaSymbol, b: OndinaSymbol): boolean {
  if (a.changed !== b.changed) return a.changed;
  return cmp(a.fqName, b.fqName) < 0 || (a.fqName === b.fqName && cmp(a.id, b.id) < 0);
}

/** FQ 名の最後の名前（"…OrderRepositoryImpl.save" → "save"）。ファイル単位のシンボルはファイル名 */
function lastName(s: OndinaSymbol): string {
  return s.fqName.split(/[./]/).pop()!;
}

/** "com.example.order.api.OrderController.apply" → "OrderController.apply"。ファイル単位のシンボルはファイル名だけ */
export function shortName(s: Pick<OndinaSymbol, 'fqName'>): string {
  if (s.fqName.includes('/')) return s.fqName.split('/').pop()!;
  return s.fqName.split('.').slice(-2).join('.');
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
