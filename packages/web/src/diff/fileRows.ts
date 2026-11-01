// 停留所の画面（設計書 3.3）のコードの行。head の全文（Analysis.files）にそのファイルの hunk を埋め込み、見ている場所の前後以外を畳む。
// 行の番号は head を 1 行目から歩いて数える（hunk の lnNew までは文脈、hunk の中は hunk の lines）。
import type { Hunk, TokenLine } from '@ondina/model';
import { foldKey } from './fold.js';
import { wordDiff, type ChangeSpan } from './wordDiff.js';

export interface FileRow {
  kind: 'ctx' | 'add' | 'del';
  old: number | null;
  new: number | null;
  tokens: TokenLine[number][];
  /** hunk の中の行ならその id */
  hunkId: string | null;
  /** 見ている場所（今の hunk の行、差分の無い停留所なら中心の行） */
  focus: boolean;
  /** 差分の無い停留所の中心の行（宣言と、変更シンボルを呼ぶ行） */
  center: boolean;
  /** 帯で開いた行の記録の key（fold.ts の foldKey。差分一覧と同じ） */
  key: string;
  /** 行の中の変わった所（wordDiff。差分一覧と同じ組）。塗る所が無ければ無い */
  chg?: readonly ChangeSpan[];
}

/** 見ている場所の前後に残す行数 */
export const FOLD_CONTEXT = 3;

const plain = (s: string): TokenLine[number][] => [[s, null, 0]];

/**
 * head: そのファイルの全文のトークン。hunks: そのファイルの hunk（順不同）。
 * current: 見ている hunk。centers: 差分の無い停留所の中心の行（head の行番号）
 */
export function fileRows(head: readonly TokenLine[], hunks: readonly Hunk[], current: string | null, centers: readonly number[] | null): FileRow[] {
  const rows: FileRow[] = [];
  const centerSet = new Set(centers ?? []);
  let p = 1;
  let o = 1;
  const ctx = () => {
    rows.push({ kind: 'ctx', old: o++, new: p, tokens: head[p - 1] ?? plain(''), hunkId: null, focus: centerSet.has(p), center: centerSet.has(p), key: foldKey(null, 0, p) });
    p++;
  };
  for (const h of [...hunks].sort((a, b) => a.lnNew - b.lnNew)) {
    while (p < h.lnNew && p <= head.length) ctx();
    const changes = wordDiff(h.lines);
    h.lines.forEach((line, i) => {
      const tokens = h.tokens?.[i] ?? plain(line.slice(1));
      const focus = h.id === current;
      const key = foldKey(h.id, i, null);
      const chg = changes[i];
      // 差分の無い停留所の中心の行（head の行番号）が、別の hunk の行に重なることもある（その行も見ている場所）
      if (line[0] === '-') {
        rows.push({ kind: 'del', old: o++, new: null, tokens, hunkId: h.id, focus, center: false, key, ...(chg ? { chg } : {}) });
        return;
      }
      const center = centerSet.has(p);
      if (line[0] === '+') rows.push({ kind: 'add', old: null, new: p++, tokens, hunkId: h.id, focus: focus || center, center, key, ...(chg ? { chg } : {}) });
      else rows.push({ kind: 'ctx', old: o++, new: p++, tokens, hunkId: h.id, focus: focus || center, center, key });
    });
  }
  while (p <= head.length) ctx();
  return rows;
}

export interface Folded {
  /** 上に畳んだ行数 */
  above: number;
  rows: FileRow[];
  below: number;
}

/** focus の前後 FOLD_CONTEXT 行を残して上下を畳む。full か、focus が無ければ畳まない */
export function foldRows(rows: FileRow[], full: boolean): Folded {
  const first = rows.findIndex((r) => r.focus);
  if (full || first < 0) return { above: 0, rows, below: 0 };
  const last = rows.length - 1 - [...rows].reverse().findIndex((r) => r.focus);
  const lo = Math.max(0, first - FOLD_CONTEXT);
  const hi = Math.min(rows.length - 1, last + FOLD_CONTEXT);
  return { above: lo, rows: rows.slice(lo, hi + 1), below: rows.length - 1 - hi };
}

/** 左右表示の片側。order は畳む前の行の並び（統合と同じ数。メモの範囲の始まりと終わりを決める） */
export interface SplitSide {
  row: FileRow;
  order: number;
}

/** 左右表示の 1 段。o = 左（base 側）、n = 右（head 側）。無い側は null（UI は斜線で塗る） */
export interface SplitRow {
  o: SplitSide | null;
  n: SplitSide | null;
}

/**
 * 畳んだ後の行を左右に並べる（差分一覧の alignRows と同じ並べ方）。変わらない行は両側に同じ行、
 * 続く消した行と足した行は段ごとに対にし、余った側は null。別の hunk の行どうしは対にしない。start は上に畳んだ行数
 */
export function splitRows(rows: readonly FileRow[], start = 0): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  const at = (k: number): SplitSide => ({ row: rows[k]!, order: start + k });
  while (i < rows.length) {
    const r = rows[i]!;
    if (r.kind === 'ctx') {
      out.push({ o: at(i), n: at(i) });
      i++;
      continue;
    }
    const del: number[] = [];
    const add: number[] = [];
    while (i < rows.length && rows[i]!.kind === 'del' && rows[i]!.hunkId === r.hunkId) del.push(i++);
    while (i < rows.length && rows[i]!.kind === 'add' && rows[i]!.hunkId === r.hunkId) add.push(i++);
    for (let k = 0; k < Math.max(del.length, add.length); k++) {
      out.push({ o: k < del.length ? at(del[k]!) : null, n: k < add.length ? at(add[k]!) : null });
    }
  }
  return out;
}
