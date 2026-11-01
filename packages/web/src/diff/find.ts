// 差分の列の中を検索する（2026-10-27）。
// 差分の列は仮想リストで、画面の外の行と帯に畳んだ行は DOM に無く、ブラウザのページ内検索では見つからない。
// そこで行のデータ（畳む前の行列）から探す。見つけた行は DiffList が帯から出してスクロールし、文字に印を付ける。
import type { TokenLine } from '@ondina/model';
import type { DefName } from '../defs.js';
import type { VirtualRow } from './rows.js';
import type { ChangeSpan } from './wordDiff.js';

/** 行の中の、文字を出す場所。left / right は左右表示の片側、code は統合の行と hunk の外の行（左右では両側に同じ文字）、path / head はファイルと hunk の見出し */
export type FindCell = 'path' | 'head' | 'code' | 'left' | 'right';

export interface FindHit {
  row: VirtualRow;
  cell: FindCell;
  /** その場所の文字の中の位置（from から to の手前まで） */
  from: number;
  to: number;
}

/** 文字に付ける印: hit = 見つけた所、cur = 今の 1 件 */
export interface FindMark {
  from: number;
  to: number;
  cur: boolean;
}

/** 1 行分の文字（tokens があればその文字、無ければ接頭辞の 1 文字を除いた行。TokenSpans が出す文字と同じ） */
export function lineText(line: string, tokens: TokenLine | undefined): string {
  return tokens ? tokens.map(([t]) => t).join('') : line.slice(1);
}

/** 行の中の、検索する場所と文字。メモの行と帯は探さない（帯の中の行は畳む前の行列にある） */
export function cellsOf(r: VirtualRow): { cell: FindCell; text: string }[] {
  if (r.kind === 'file') return [{ cell: 'path', text: r.path }];
  if (r.kind === 'header') return [{ cell: 'head', text: r.hunk.symbol }];
  if (r.kind === 'ctx') return [{ cell: 'code', text: lineText(' ', r.tokens) }];
  if (r.kind === 'uni') return [{ cell: 'code', text: lineText(r.hunk.lines[r.i]!, r.hunk.tokens?.[r.i]) }];
  if (r.kind === 'sbs') {
    const side = (cell: 'left' | 'right', s: typeof r.o) => (s === null ? [] : [{ cell, text: lineText(r.hunk.lines[s.i]!, r.hunk.tokens?.[s.i]) }]);
    return [...side('left', r.o), ...side('right', r.n)];
  }
  return [];
}

/** 大文字と小文字を区別せずに探す（ブラウザのページ内検索と同じ）。小文字にすると長さが変わる文字を含む行は、そのままの文字で探す */
function indexesOf(text: string, query: string): number[] {
  const lower = text.toLowerCase();
  const [hay, needle] = lower.length === text.length ? [lower, query.toLowerCase()] : [text, query];
  const out: number[] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

/** 行列の上から順に、見つけた所を全部。空の問いは何も探さない */
export function findHits(rows: readonly VirtualRow[], query: string): FindHit[] {
  if (query === '') return [];
  const out: FindHit[] = [];
  for (const row of rows) {
    for (const { cell, text } of cellsOf(row)) {
      for (const from of indexesOf(text, query)) out.push({ row, cell, from, to: from + query.length });
    }
  }
  return out;
}

/** 今の 1 件の番号（AppState.find.at は次へ・前へで増減するだけなので、件数で回す） */
export const curIndex = (at: number, count: number): number => (count === 0 ? -1 : ((at % count) + count) % count);

/** 行ごと・場所ごとの印（DiffList が描くときに引く） */
export function marksByRow(hits: readonly FindHit[], cur: number): Map<VirtualRow, Partial<Record<FindCell, FindMark[]>>> {
  const out = new Map<VirtualRow, Partial<Record<FindCell, FindMark[]>>>();
  hits.forEach((h, i) => {
    const m = out.get(h.row) ?? {};
    (m[h.cell] ??= []).push({ from: h.from, to: h.to, cur: i === cur });
    out.set(h.row, m);
  });
  return out;
}

export interface MarkedPiece {
  text: string;
  role: string | null;
  style: number;
  mark: FindMark | null;
  /** 定義へ移れる名前（3.6）の中なら、その名前 */
  def: DefName | null;
  /** 行の中の変わった所（wordDiff）の中か */
  chg: boolean;
}

/** トークンの並びを印の境目と名前（defs。[列, 長さ, 行き先]）の境目と変わった所（chg）の境目で切る（印の中も役割の色は保つ） */
export function splitMarks(pieces: TokenLine, marks: readonly FindMark[], defs: readonly DefName[] = [], chg: readonly ChangeSpan[] = []): MarkedPiece[] {
  const out: MarkedPiece[] = [];
  const edges = [...marks.flatMap((m) => [m.from, m.to]), ...defs.flatMap(([c, len]) => [c, c + len]), ...chg.flat()];
  let pos = 0;
  for (const [text, role, style] of pieces) {
    const end = pos + text.length;
    const cuts = new Set([pos, end]);
    for (const x of edges) if (x > pos && x < end) cuts.add(x);
    const at = [...cuts].sort((a, b) => a - b);
    for (let k = 0; k + 1 < at.length; k++) {
      const [a, b] = [at[k]!, at[k + 1]!];
      out.push({ text: text.slice(a - pos, b - pos), role, style, mark: marks.find((m) => m.from <= a && b <= m.to) ?? null, def: defs.find(([c, len]) => c <= a && b <= c + len) ?? null, chg: chg.some(([from, to]) => from <= a && b <= to) });
    }
    pos = end;
  }
  return out;
}
