// How ごとの読む順番（Tour）を組む（設計書 3.3 / 10.2）。
// 2026-09-24 決定: 経路はプログラムが call の辺だけを辿って組む。LLM に経路（symbolFqName の列）を書かせない。
// 理由: LLM に出させるとメーターが揺れる（同じ fixture で層の推定が 22 件 → 3 件になった実績）、経路は辺の列 = 事実（原則 3）、
// 「辺が無い経路」が構造上作れないので検証が要らない。
//
// 規則:
// - 種は How の hunk のシンボル。call の辺（参照とテストは辿らない）のうち種から出るものを部分グラフにする（呼ばれる側の 1 ホップ先まで。
//   呼ぶ側の隣は入れない: 他の How の入口から始まってしまう。fixture の How 5 で実測）
// - 停留所は差分だけ（2026-10-11）。差分の無い呼ばれる側は停留所にしない（差分が責任の単位。Approve する人は全部の差分に責任を持つ。
//   差分の無い関連は関係があると分かれば十分で、差分と同じ扱いにしない。地図の「差分なし n か所」と引き出しが受け持つ）。
//   ただし並びを決める部分グラフには残す: 外すと、差分の無い物だけを呼ぶ種が始点にならず後ろへ回る（fixture のコース 3 で Order が先頭でなくなった）
// - 始点 = 部分グラフの中で他から呼ばれていないもの。層の並び（設定の順）→ FQ 名 → id で安定させる
// - 始点から幅優先。1 シンボル 1 ステップ。呼ばれ方は「呼ぶ側の短い名前 → 呼ばれる側の短い名前(引数の型)」
// - 同じ呼ぶ側から出る枝は、呼んでいる行（Edge.lines）が早い順（2026-10-22。呼ぶ側のコードを上から読む順。見本を比べて決めた）。行の無い辺は後ろに層の順 → FQ 名
// - 辺に乗らない種は経路の後ろに hunk の並び順で 1 件ずつ足す（辺 0 本の How はこれだけ）。追従グループは代表 1 件だけ（B の画面で 1 件ずつ見る）
// - 文（変わること・確かめること・この場所）はここでは付けない（2 回目の LLM が書き、narration/verify.ts が重ねる。設計書 5.3）
import type { Edge, How, Hunk, Symbol as OndinaSymbol, Tour } from '../model.js';

export interface BuildToursArgs {
  hows: readonly How[];
  hunks: readonly Hunk[];
  symbols: readonly OndinaSymbol[];
  edges: readonly Edge[];
  /** 設定の layers の並び。始点と枝の順を決めるのに使う */
  layers: ReadonlyArray<{ name: string }>;
}

export function buildTours(args: BuildToursArgs): Tour[] {
  const byId = new Map(args.symbols.map((s) => [s.id, s]));
  const byHunk = new Map(args.symbols.filter((s) => s.hunkId !== undefined).map((s) => [s.hunkId!, s]));
  const layerIndex = (s: OndinaSymbol): number => {
    const i = args.layers.findIndex((l) => l.name === s.layer);
    return i === -1 ? args.layers.length : i;
  };
  const order = (a: OndinaSymbol, b: OndinaSymbol): number => layerIndex(a) - layerIndex(b) || cmp(a.fqName, b.fqName) || cmp(a.id, b.id);
  // 追従グループの代表ではないメンバー（どの How でも呼ぶ側にも呼ばれる側にも出さない。束は代表 1 件だけ）
  const hidden = new Set(args.hunks.filter((h) => h.group !== undefined && h.group.representative !== h.id).map((h) => byHunk.get(h.id)?.id));
  const callEdges = args.edges
    .filter((e) => e.kind === 'call' && byId.has(e.from) && byId.has(e.to) && !hidden.has(e.from) && !hidden.has(e.to))
    .slice()
    .sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));

  return args.hows.map((how) => {
    // 種は How の hunk のうち、追従グループは代表だけ
    const seedHunks = args.hunks.filter((h) => h.hows.includes(how.id) && (h.group === undefined || h.group.representative === h.id));
    const seeds = new Set(seedHunks.map((h) => byHunk.get(h.id)?.id).filter((id): id is string => id !== undefined));
    const sub = callEdges.filter((e) => seeds.has(e.from));
    const nodes = [...new Set(sub.flatMap((e) => [e.from, e.to]))].map((id) => byId.get(id)!).sort(order);
    const called = new Set(sub.map((e) => e.to));
    const entries = nodes.filter((s) => !called.has(s.id));
    const queue: Array<{ symbol: OndinaSymbol; call: string }> = (entries.length > 0 ? entries : nodes.slice(0, 1)).map((symbol) => ({ symbol, call: '' }));

    const steps: Tour['steps'] = [];
    const visited = new Set<string>();
    const push = (symbol: OndinaSymbol, call: string): void => {
      visited.add(symbol.id);
      steps.push({ symbolId: symbol.id, ...(symbol.hunkId === undefined ? {} : { hunkId: symbol.hunkId }), call });
    };
    while (queue.length > 0) {
      const { symbol, call } = queue.shift()!;
      if (visited.has(symbol.id)) continue;
      if (symbol.changed) push(symbol, call);
      else visited.add(symbol.id);
      const outs = sub
        .filter((e) => e.from === symbol.id)
        .map((e) => ({ e, to: byId.get(e.to)! }))
        .sort((a, b) => firstLine(a.e) - firstLine(b.e) || order(a.to, b.to));
      for (const { e, to } of outs) {
        if (visited.has(to.id)) continue;
        queue.push({ symbol: to, call: `${shortName(symbol)} → ${shortName(to)}${e.types?.in === undefined ? '' : `(${e.types.in})`}` });
      }
    }
    for (const h of seedHunks) {
      const symbol = byHunk.get(h.id);
      if (symbol === undefined || visited.has(symbol.id)) continue;
      push(symbol, '');
    }
    return { howId: how.id, steps };
  });
}

/** "com.example.order.domain.Order.applyDiscount" → "Order.applyDiscount"。ファイル単位のシンボルはファイル名だけ */
function shortName(s: OndinaSymbol): string {
  if (s.fqName.includes('/')) return s.fqName.split('/').pop()!;
  return s.fqName.split('.').slice(-2).join('.');
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 呼んでいる最初の行。行の無い辺は行のある辺の後ろ */
const firstLine = (e: Edge): number => (e.lines !== undefined && e.lines.length > 0 ? e.lines[0]! : Number.MAX_SAFE_INTEGER);
