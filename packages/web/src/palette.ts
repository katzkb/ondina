// コマンドパレット（設計書 18.2）の候補作りとあいまい一致。純粋関数だけ（原則 5: UI は Analysis を読んで描くだけ）。
// 点数を合成しない: (かたまりの数, 最初に当たった位置, 種別, 元の並び) を上から順に見る。
// 当たった文字の位置を返し、画面で下線にする（なぜこの行が出たかを行の上で見せる。近似には破綻の見える指標を付ける）。
import type { Analysis } from '@ondina/model';
import { groupFiles, shortPath } from './files.js';
import { layerText, shortName } from './map/graph.js';

/** パレットで選んだときの飛び先。callee は呼んでいる相手（3.6。行き先は calleeDest で決める） */
export type PaletteTarget = { kind: 'how'; howId: number } | { kind: 'hunk'; hunkId: string } | { kind: 'file'; path: string } | { kind: 'callee'; symbolId: string };

export interface PaletteItem {
  /** target.kind の写し。並べ替えと種別の表示に使う */
  kind: PaletteTarget['kind'];
  target: PaletteTarget;
  /** 1 列目 */
  label: string;
  /** 2 列目（薄字）。空のこともある */
  sub: string;
}

export interface PaletteHit {
  item: PaletteItem;
  /** haystack（label + ' ' + sub）への添字。空クエリなら [] */
  positions: number[];
}

/** 一致を当てる文字列。画面に出ている文字だけを対象にする */
export function haystack(item: PaletteItem): string {
  return `${item.label} ${item.sub}`;
}

/** How / シンボル / ファイルの 3 種。シンボルは追従グループのメンバーも 1 件ずつ出す（2026-09-19 に決めた「1 件ずつ確認する」と揃える） */
export function paletteItems(analysis: Analysis, packagePrefix?: string): PaletteItem[] {
  const files = groupFiles(analysis.hunks, [], packagePrefix);
  // チケットのある PR は目的ごとの画面を出さないので How も出さない
  const hows: PaletteItem[] = analysis.chapters ? [] : analysis.hows.map((h) => ({ kind: 'how', target: { kind: 'how', howId: h.id }, label: h.title, sub: h.why }));
  const hunks: PaletteItem[] = files.flatMap((f) =>
    f.hunks.map((h) => ({ kind: 'hunk' as const, target: { kind: 'hunk' as const, hunkId: h.id }, label: h.symbol, sub: shortPath(h.path, packagePrefix) })),
  );
  const paths: PaletteItem[] = files.map((f) => ({ kind: 'file', target: { kind: 'file', path: f.path }, label: f.base, sub: f.dir }));
  return [...hows, ...hunks, ...paths];
}

/** 呼んでいる相手の行き先。step = そのコース（How）の停留所 / hunk = How 分解の画面で差分 / none = 飛び先なし */
/** rel = 差分の無い相手（停留所にならない。2026-10-11）。差分の無い相手の引き出しでそのコードを出す */
export type CalleeDest = { kind: 'step'; howId: number } | { kind: 'hunk'; hunkId: string } | { kind: 'rel' } | { kind: 'none' };

/** 今のコースの停留所 → 別のコースの停留所（tours の並び） → 差分 → 差分の無い相手（引き出し）→ なし の順に探す（3.6） */
export function calleeDest(analysis: Analysis, symbolId: string, currentHow: number | null): CalleeDest {
  const has = (howId: number) => analysis.tours.some((t) => t.howId === howId && t.steps.some((s) => s.symbolId === symbolId));
  if (currentHow !== null && has(currentHow)) return { kind: 'step', howId: currentHow };
  const other = analysis.tours.find((t) => t.steps.some((s) => s.symbolId === symbolId));
  if (other) return { kind: 'step', howId: other.howId };
  const sym = analysis.symbols.find((s) => s.id === symbolId);
  if (sym?.hunkId !== undefined) return { kind: 'hunk', hunkId: sym.hunkId };
  return sym?.changed === false ? { kind: 'rel' } : { kind: 'none' };
}

function destText(dest: CalleeDest, currentHow: number | null): string {
  if (dest.kind === 'step') return dest.howId === currentHow ? 'このコース' : `コース ${dest.howId}`;
  if (dest.kind === 'hunk') return '差分（How 分解の画面）';
  if (dest.kind === 'rel') return '差分なし（右に出す）';
  return '飛び先なし（シンボルの情報がありません）';
}

/**
 * symbolId が呼んでいる相手（call の辺の to。辺の並びで、同じ相手は 1 件）。
 * 飛び先が無い相手も消さずに出す（消すと「呼んでいない」と「飛べない」の区別が画面から消える）
 */
export function calleeItems(analysis: Analysis, symbolId: string, currentHow: number | null): PaletteItem[] {
  const to = [...new Set(analysis.edges.filter((e) => e.from === symbolId && e.kind === 'call').map((e) => e.to))];
  return to.map((id) => {
    // 辺の相手が symbols に無い（データの不整合）ときも消さず、id の頭で出して分かるようにする
    const sym = analysis.symbols.find((s) => s.id === id);
    const dest = destText(calleeDest(analysis, id, currentHow), currentHow);
    const label = sym ? shortName(sym.fqName, sym.path, sym.kind) : id.slice(0, 8);
    const sub = sym ? `${layerText(sym)} · ${dest}` : `? シンボルの情報なし · ${dest}`;
    return { kind: 'callee' as const, target: { kind: 'callee' as const, symbolId: id }, label, sub };
  });
}

export interface Match {
  positions: number[];
  /** 続けて当たったかたまりの数。少ないほど上 */
  chunks: number;
  /** 最初に当たった位置。早いほど上 */
  first: number;
}

/**
 * クエリの文字を左から順に拾う。開始位置を変えて試し、いちばんかたまりが少ない当て方を採る。
 * 単純に左から貪欲に当てると最良を取り逃す（'ab' を 'a b ab' に当てると 2 かたまりになるが 1 かたまりで当たる）。
 */
export function matchQuery(query: string, target: string): Match | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (q === '') return { positions: [], chunks: 0, first: 0 };
  const h = target.toLowerCase();
  let best: Match | null = null;
  for (let start = 0; start < h.length; start++) {
    if (h[start] !== q[0]) continue;
    const positions = pickGreedy(q, h, start);
    if (positions === null) continue;
    const chunks = countChunks(positions);
    if (best === null || chunks < best.chunks || (chunks === best.chunks && start < best.first)) best = { positions, chunks, first: start };
  }
  return best;
}

/** start から右へ、クエリの残りを順に拾う。拾いきれなければ null */
function pickGreedy(q: string, h: string, start: number): number[] | null {
  const positions = [start];
  let at = start + 1;
  for (let i = 1; i < q.length; i++) {
    const found = h.indexOf(q[i]!, at);
    if (found < 0) return null;
    positions.push(found);
    at = found + 1;
  }
  return positions;
}

function countChunks(positions: readonly number[]): number {
  let chunks = 1;
  for (let i = 1; i < positions.length; i++) if (positions[i]! !== positions[i - 1]! + 1) chunks++;
  return chunks;
}

const KIND_ORDER: Record<PaletteItem['kind'], number> = { how: 0, hunk: 1, file: 2, callee: 3 };

/** 一覧に出す上限。超えた分は件数だけ出して「絞り込め」の合図にする */
export const PALETTE_LIMIT = 20;

/** 当たったものを並べ替えて上限まで返す。more はあふれた件数 */
export function searchPalette(items: readonly PaletteItem[], query: string, limit = PALETTE_LIMIT): { hits: PaletteHit[]; more: number } {
  const scored: Array<{ item: PaletteItem; index: number; match: Match }> = [];
  items.forEach((item, index) => {
    const match = matchQuery(query, haystack(item));
    if (match !== null) scored.push({ item, index, match });
  });
  scored.sort(
    (a, b) => a.match.chunks - b.match.chunks || a.match.first - b.match.first || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.index - b.index,
  );
  return { hits: scored.slice(0, limit).map((s) => ({ item: s.item, positions: s.match.positions })), more: Math.max(0, scored.length - limit) };
}
