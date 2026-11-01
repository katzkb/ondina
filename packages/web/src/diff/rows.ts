// hunk 列を、仮想リストに流す 1 本の行列にする（設計書 18.4「長いリストは仮想化」）。
// hunk をまたいで仮想化するために、ヘッダも diff の行も同じ配列に並べる。メモ（3.3）と AI の下書きの行もその最後の行の下に差し込む。
// 差分一覧（3.4）は全部のファイルを 1 本に並べ、ファイルが替わる所にファイルの見出しの行を挟む（2026-10-20。GitHub と同じくファイルをまたいでスクロールする）。
// 目的ごとの画面のプレビュー（3.2）は、head の全文に hunk を埋め込み、hunk の外の行（ctx）も並べる（buildFileRows）。
import type { CommentDraft, FileText, Hunk, TokenLine } from '@ondina/model';
import { isMemo, pickSpan, type MemoPick } from '../memo.js';
import { alignRows, type Side, type SideKind } from './alignRows.js';
import { foldKey, foldLines, type FoldAt } from './fold.js';

export type DiffMode = 'sbs' | 'uni';

/** メモの行に並べる物: 保存したメモ、AI の下書き（2026-10-13）、選んでいる行に書く枠 */
export type MemoItem = { kind: 'saved'; memo: CommentDraft } | { kind: 'draft'; draft: CommentDraft } | { kind: 'new' };

/**
 * base = そのファイルの前の hunk の行数の合計。行の並び（メモの範囲の上下。memo.ts の MemoPos.order）は base + lines の位置で、
 * 左右と統合で同じ数になる（表示を切り替えても選んだ行はそのまま）。メモの行は left = base 側（消した行）、right = head 側
 */
export type VirtualRow =
  /** ファイルの見出しの行（差分一覧だけ。buildRows の heads）。高さは diff/follow.ts の FILE_HEAD_H 固定 */
  | { kind: 'file'; path: string }
  | { kind: 'header'; hunk: Hunk }
  | { kind: 'sbs'; hunk: Hunk; base: number; o: Side | null; n: Side | null }
  | { kind: 'uni'; hunk: Hunk; base: number; i: number; t: SideKind; lnOld: number | null; lnNew: number | null }
  | { kind: 'memo'; hunk: Hunk; key: string; left: MemoItem[]; right: MemoItem[] }
  /** hunk の外の行（buildFileRows だけが出す）。行番号は base 側と head 側の両方、文字は head の全文から */
  | { kind: 'ctx'; path: string; lnOld: number; lnNew: number; tokens: TokenLine }
  /** 変わった行から離れた行の帯（foldVirtual だけが出す。diff/fold.ts）。keys は隠れた行の key（foldKey） */
  | { kind: 'fold'; path: string; keys: string[]; top: boolean; bottom: boolean };

/** hunk 1 つ分の見出しと行を out に足す */
function pushHunk(out: VirtualRow[], hunk: Hunk, base: number, mode: DiffMode): void {
  out.push({ kind: 'header', hunk });
  if (mode === 'sbs') {
    for (const r of alignRows(hunk.lines, hunk.lnOld, hunk.lnNew)) out.push({ kind: 'sbs', hunk, base, o: r.o, n: r.n });
    return;
  }
  // 統合: lines の順のまま。削除は旧の行番号だけ、追加は新の行番号だけ、共通は両方（prototype の diffHtml と同じ）
  let o = hunk.lnOld;
  let n = hunk.lnNew;
  hunk.lines.forEach((line, i) => {
    const c = line[0];
    if (c === '-') out.push({ kind: 'uni', hunk, base, i, t: 'r', lnOld: o++, lnNew: null });
    else if (c === '+') out.push({ kind: 'uni', hunk, base, i, t: 'a', lnOld: null, lnNew: n++ });
    else out.push({ kind: 'uni', hunk, base, i, t: 'c', lnOld: o++, lnNew: n++ });
  });
}

/** heads = ファイルが替わる所にファイルの見出しの行を挟む（差分一覧）。base はファイルごとに 0 から（memo.ts の pickFor と同じ数え方） */
export function buildRows(hunks: readonly Hunk[], mode: DiffMode, heads = false): VirtualRow[] {
  const out: VirtualRow[] = [];
  let base = 0;
  let path: string | null = null;
  for (const hunk of hunks) {
    if (hunk.path !== path) {
      path = hunk.path;
      base = 0;
      if (heads) out.push({ kind: 'file', path });
    }
    pushHunk(out, hunk, base, mode);
    base += hunk.lines.length;
  }
  return out;
}

/**
 * 目的ごとの画面のプレビュー（設計書 3.2）: head の全文（Analysis.files）にそのファイルの hunk を行の順に埋め込む。
 * 数え方はコースの画面の fileRows と同じ（head を 1 行目から歩き、hunk の lnNew までは hunk の外、hunk の中は lines）。hunk の見出しと行は buildRows と同じ
 */
export function buildFileRows(file: FileText, hunks: readonly Hunk[], mode: DiffMode): VirtualRow[] {
  const out: VirtualRow[] = [];
  const head = file.tokens;
  let o = 1;
  let p = 1;
  let base = 0;
  const ctx = () => {
    out.push({ kind: 'ctx', path: file.path, lnOld: o++, lnNew: p, tokens: head[p - 1] ?? [] });
    p++;
  };
  for (const hunk of [...hunks].sort((a, b) => a.lnNew - b.lnNew)) {
    while (p < hunk.lnNew && p <= head.length) ctx();
    pushHunk(out, hunk, base, mode);
    base += hunk.lines.length;
    for (const line of hunk.lines) {
      if (line[0] !== '+') o++;
      if (line[0] !== '-') p++;
    }
  }
  while (p <= head.length) ctx();
  return out;
}

type Line = Exclude<VirtualRow, { kind: 'file' } | { kind: 'header' } | { kind: 'memo' } | { kind: 'ctx' } | { kind: 'fold' }>;

/**
 * 変わった行から離れた変わらない行を帯にまとめる（2026-10-13。diff/fold.ts）。見出しは常に出して帯を切り、メモの行は常に出す（前後も残す）。
 * keep に当たる行（案内人の答えの行）も畳まない。open = 開いた行の key、all = すべて表示。
 * ファイルの見出しの行（差分一覧）ごとに分けて畳む（ファイルの末尾の帯は 1 ファイルの画面と同じく ↓ だけ）
 */
export function foldVirtual(rows: readonly VirtualRow[], open: ReadonlySet<string>, all: boolean, keep: (r: VirtualRow) => boolean = () => false): VirtualRow[] {
  const at = (r: VirtualRow): FoldAt => {
    if (r.kind === 'file' || r.kind === 'header' || r.kind === 'fold') return 'break';
    if (r.kind === 'memo') return 'keep';
    if (r.kind === 'ctx') return { key: foldKey(null, 0, r.lnNew), anchor: keep(r) };
    if (r.kind === 'uni') return { key: foldKey(r.hunk.id, r.i, null), anchor: r.t !== 'c' || keep(r) };
    // 左右の変わらない行は両側が同じ lines の位置（統合と同じ key）
    const i = r.n?.i ?? r.o!.i;
    return { key: foldKey(r.hunk.id, i, null), anchor: r.o?.t !== 'c' || r.n?.t !== 'c' || keep(r) };
  };
  const pathOf = (r: VirtualRow) => (r.kind === 'file' || r.kind === 'ctx' || r.kind === 'fold' ? r.path : r.hunk.path);
  const fold = (part: readonly VirtualRow[]) => foldLines(part, at, open, all).map((p): VirtualRow => (p.kind === 'row' ? p.row : { kind: 'fold', path: pathOf(p.rows[0]!), keys: p.keys, top: p.top, bottom: p.bottom }));
  const starts = rows.flatMap((r, i) => (r.kind === 'file' && i > 0 ? [i] : []));
  return [0, ...starts].flatMap((from, k) => fold(rows.slice(from, starts[k] ?? rows.length)));
}

/** その行の base 側（消した行）と head 側（足した行・変わらない行）の行番号。無い側は null。at は行の並び（メモの行の key） */
function sidesOf(r: Line): { left: number | null; right: number | null; at: number } {
  if (r.kind === 'uni') return { left: r.t === 'r' ? r.lnOld : null, right: r.t === 'r' ? null : r.lnNew, at: r.base + r.i };
  return { left: r.o?.t === 'r' ? r.o.ln : null, right: r.n?.ln ?? null, at: r.base + Math.max(r.o?.i ?? -1, r.n?.i ?? -1) };
}

/**
 * 保存したメモ・AI の下書き・書く枠を、その最後の行の下に差し込む（決めごと 3）。行ごとに自分のファイルの物だけを引く（別のファイルの物を渡してもよい）。
 * 同じ行の下では 保存したメモ → AI の下書き → 書く枠（コースの画面の FileView と同じ）。破棄した下書きも 1 行にたたんで出すので入れる
 */
export function withMemos(rows: readonly VirtualRow[], comments: readonly CommentDraft[], pick: MemoPick | null): VirtualRow[] {
  const byLine = new Map<string, MemoItem[]>();
  const add = (path: string, side: 'LEFT' | 'RIGHT', line: number, item: MemoItem) => {
    const k = `${path}:${side}:${line}`;
    byLine.set(k, [...(byLine.get(k) ?? []), item]);
  };
  for (const memo of comments) if (isMemo(memo) && memo.state !== 'discarded') add(memo.path, memo.side, memo.line, { kind: 'saved', memo });
  for (const draft of comments) if (!isMemo(draft)) add(draft.path, draft.side, draft.line, { kind: 'draft', draft });
  if (pick) {
    const end = pickSpan(pick).end;
    add(pick.path, end.side, end.line, { kind: 'new' });
  }
  if (byLine.size === 0) return [...rows];
  const out: VirtualRow[] = [];
  for (const r of rows) {
    out.push(r);
    // hunk の外の行（ctx）にはメモを差し込まない（ctx を出す目的ごとの画面のプレビューは、メモを書く場所にしない。3.4）
    if (r.kind === 'file' || r.kind === 'header' || r.kind === 'memo' || r.kind === 'ctx' || r.kind === 'fold') continue;
    const s = sidesOf(r);
    const items = (side: 'LEFT' | 'RIGHT', ln: number | null): MemoItem[] => (ln === null ? [] : (byLine.get(`${r.hunk.path}:${side}:${ln}`) ?? []));
    const left = items('LEFT', s.left);
    const right = items('RIGHT', s.right);
    if (left.length > 0 || right.length > 0) out.push({ kind: 'memo', hunk: r.hunk, key: `m-${r.hunk.id}-${s.at}`, left, right });
  }
  return out;
}
