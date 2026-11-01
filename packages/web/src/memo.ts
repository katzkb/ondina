// メモ（設計書 3.3 / 12 章）。レビュアーが行を選んでから書く下書き。純粋関数だけ（画面と reducer が使う）。
// GitHub の差分に出ない行にはメモを書けない（GitHub がコメントを付けられない）。その判定 onGithubDiff は core の review/github-diff.ts と同じ規則の写し（web は core を読めない。原則 5）。
import type { Analysis, AskLines, CommentDraft, GithubDiffFile, Hunk } from '@ondina/model';
import { courses, type Course } from './course.js';
import { fileRows, foldRows, type FileRow } from './diff/fileRows.js';

/** レビュアー自身のメモの出所（CommentDraft.source） */
export const REVIEWER = 'reviewer';

export type Side = 'LEFT' | 'RIGHT';

/** 選んだ行。order は画面の上からの並び（LEFT と RIGHT の行番号は比べられないので、始まりと終わりはこれで決める） */
export interface MemoPos {
  side: Side;
  line: number;
  order: number;
}

/** 選んでいる行。anchor = 「+」を押した行、head = 押したままなぞって入った行（1 行なら同じ） */
export interface MemoPick {
  path: string;
  anchor: MemoPos;
  head: MemoPos;
}

type Span = Pick<CommentDraft, 'line' | 'side' | 'startLine' | 'startSide'>;

export const isMemo = (c: Pick<CommentDraft, 'source'>): boolean => c.source === REVIEWER;

/** まだ採用も破棄もしていない AI の下書き（コースの印に数える物。2026-10-13。見本を比べて決めた） */
export const isOpenDraft = (c: Pick<CommentDraft, 'source' | 'state'>): boolean => !isMemo(c) && (c.state === 'draft' || c.state === 'edit');

/** 画面の上にある方が始まり */
export function pickSpan(p: MemoPick): { start: MemoPos; end: MemoPos } {
  return p.anchor.order <= p.head.order ? { start: p.anchor, end: p.head } : { start: p.head, end: p.anchor };
}

function inDiff(file: GithubDiffFile | undefined, side: Side, line: number): boolean {
  if (!file) return false;
  return file.hunks.some((h) => (side === 'RIGHT' ? line >= h.newStart && line < h.newStart + h.newLines : line >= h.oldStart && line < h.oldStart + h.oldLines));
}

/**
 * 行（範囲なら始まりと終わりのそれぞれ）がその side の GitHub の差分の塊に入るか。入らない行には GitHub がコメントを付けられないので、メモを書けず、送らない。
 * 塊をまたぐ範囲も入る（2026-10-06 に本物の PR で確認）。githubDiff が無い解析（local と古い解析）は決めない（undefined。どの行にも書けて、送れる）
 */
export function onGithubDiff(diff: readonly GithubDiffFile[] | undefined, c: Pick<CommentDraft, 'path'> & Span): boolean | undefined {
  if (!diff) return undefined;
  const file = diff.find((f) => f.path === c.path);
  const startOk = c.startLine === undefined || inDiff(file, c.startSide ?? c.side, c.startLine);
  return startOk && inDiff(file, c.side, c.line);
}

const sideName = (side: Side): string => (side === 'LEFT' ? 'base' : 'head');

/**
 * 行の書き方。base 側は「（base 側）」、base と head にまたがる範囲は始まりと終わりをそれぞれの側の行番号で（cli の本文と同じ書き方）。
 * またがる向きは両方ある: 消した行から下の足した行（base → head）と、変わらない行・足した行から下の消した行（head → base。GitHub も受け付ける。2026-10-15 に本物の PR で確認）
 */
export function spanLabel(c: Span): string {
  if (c.startLine === undefined) return `${c.line} 行目${c.side === 'LEFT' ? '（base 側）' : ''}`;
  const startSide = c.startSide ?? c.side;
  if (startSide !== c.side) return `${sideName(startSide)} ${c.startLine} 行目〜${sideName(c.side)} ${c.line} 行目`;
  return `${c.startLine}〜${c.line} 行目${c.side === 'LEFT' ? '（base 側）' : ''}`;
}

/** 選んでいる行を CommentDraft の行の欄にする（1 行なら startLine を付けない） */
export function pickRange(pick: MemoPick): Span {
  const { start, end } = pickSpan(pick);
  return start.side === end.side && start.line === end.line ? { line: end.line, side: end.side } : { startLine: start.line, startSide: start.side, line: end.line, side: end.side };
}

/** 保存するメモ。保存した時点で採用済み（自分で書いた物なので採用の手間を置かない）。id は m と通し番号 */
export function newMemo(comments: readonly CommentDraft[], pick: MemoPick, body: string): CommentDraft {
  const n = Math.max(0, ...comments.map((c) => /^m(\d+)$/.exec(c.id)).map((m) => (m ? Number(m[1]) : 0))) + 1;
  return { id: `m${n}`, path: pick.path, ...pickRange(pick), body: body.trim(), source: REVIEWER, state: 'adopted' };
}

type At = Pick<CommentDraft, 'path' | 'line' | 'side'>;

/** その行がメモの最後の行か（消した行は base 側、他は head 側） */
export const endsAt = (c: Pick<CommentDraft, 'line' | 'side'>, r: FileRow): boolean => (c.side === 'LEFT' ? r.kind === 'del' && r.old === c.line : r.new === c.line);

/** 停留所の画面のコードの行（ファイル全体と、畳んだときに見える行）。全文が無ければ null */
function stopRows(analysis: Analysis, course: Course, k: number): { path: string; rows: FileRow[]; shown: FileRow[] } | null {
  const step = course.steps[k];
  if (!step) return null;
  const symbol = analysis.symbols.find((s) => s.id === step.symbolId);
  const hunkId = step.hunkId ?? symbol?.hunkId;
  const hunk = hunkId === undefined ? undefined : analysis.hunks.find((h) => h.id === hunkId);
  const path = hunk?.path ?? symbol?.path;
  const file = path === undefined ? undefined : analysis.files?.find((f) => f.path === path);
  if (!file || path === undefined) return null;
  const centers = hunk ? null : (symbol?.excerpt?.flatMap((b) => b.centers) ?? null);
  const rows = fileRows(file.tokens, analysis.hunks.filter((h) => h.path === path), hunk?.id ?? null, centers);
  return { path, rows, shown: foldRows(rows, false).rows };
}

/**
 * 停留所を開いたときに見える行（見ている場所の前後 3 行。ファイル全体にしていないとき）に、メモの最後の行が入るか。
 * 締めの「開く」（差分の無いファイルのメモ）と、メモの印（総括・行程）が使う
 */
export function stopShows(analysis: Analysis, course: Course, k: number, c: At): boolean {
  const s = stopRows(analysis, course, k);
  return s !== null && s.path === c.path && s.shown.some((r) => endsAt(c, r));
}

/**
 * コースの中でメモを置く停留所: メモの行が見える最初の停留所。どの停留所の前後にも入らなければ、同じファイルを通る最初の停留所を
 * ファイル全体で（その停留所では畳みの帯に「メモ n」が出ている）。同じファイルを通らなければ null
 */
export function memoPlace(analysis: Analysis, course: Course, c: At): { k: number; full: boolean } | null {
  const stops = course.steps.map((_, k) => stopRows(analysis, course, k));
  const shown = stops.findIndex((s) => s !== null && s.path === c.path && s.shown.some((r) => endsAt(c, r)));
  if (shown >= 0) return { k: shown, full: false };
  const same = stops.findIndex((s) => s !== null && s.path === c.path);
  return same >= 0 ? { k: same, full: true } : null;
}

/** 停留所ごとに置く（1 件は memoPlace の 1 か所だけ。停留所の中は行の上から順） */
function placeAll(analysis: Analysis, course: Course, comments: readonly CommentDraft[], keep: (c: CommentDraft) => boolean): CommentDraft[][] {
  const out: Array<Array<{ c: CommentDraft; at: number }>> = course.steps.map(() => []);
  for (const c of comments) {
    if (!keep(c)) continue;
    const place = memoPlace(analysis, course, c);
    if (!place) continue;
    out[place.k]!.push({ c, at: stopRows(analysis, course, place.k)!.rows.findIndex((r) => endsAt(c, r)) });
  }
  return out.map((list) => list.sort((a, b) => a.at - b.at).map((x) => x.c));
}

/** コースの停留所ごとの自分のメモ（印の数と総括の一覧） */
export function courseMemos(analysis: Analysis, course: Course, comments: readonly CommentDraft[]): CommentDraft[][] {
  return placeAll(analysis, course, comments, (c) => isMemo(c) && c.state !== 'discarded');
}

/** コースの停留所ごとの AI の下書き（状態を問わない。印の数は isOpenDraft の物だけ、総括の一覧は全部） */
export function courseDrafts(analysis: Analysis, course: Course, comments: readonly CommentDraft[]): CommentDraft[][] {
  return placeAll(analysis, course, comments, (c) => !isMemo(c));
}

/** 締めの「開く」の停留所: どれかのコースでメモの行が見える停留所（コースの順）。無ければ同じファイルを通る停留所をファイル全体で */
export function memoStop(analysis: Analysis, c: At): { courseId: number; i: number; full: boolean } | null {
  const places = courses(analysis).map((course) => ({ course, place: memoPlace(analysis, course, c) }));
  const hit = places.find((p) => p.place && !p.place.full) ?? places.find((p) => p.place);
  return hit?.place ? { courseId: hit.course.id, i: hit.place.k, full: hit.place.full } : null;
}

/** 選び直す画面: 停留所の画面か、差分一覧のファイル（その画面に並ぶ差分。DiffPane に渡す順） */
export type PickScreen = { kind: 'stop'; course: Course; k: number } | { kind: 'diff'; hunks: readonly Hunk[] };

/**
 * 案内人に行について聞いた問いの「メモにする」（3.10）: 聞いた行を、着いた画面の行の並び（MemoPos.order）で選び直す。
 * 停留所の画面はファイル全体の行の何番目か（FileView）、差分一覧はそのファイルの差分の行の何番目か（rows.ts の base + i）。
 * その画面に両端の行が無ければ null
 */
export function pickFor(analysis: Analysis, screen: PickScreen, lines: AskLines): MemoPick | null {
  const sideOf = (x: AskLines['start']): Side => (x.side === 'base' ? 'LEFT' : 'RIGHT');
  const at = (x: AskLines['start'], order: number): MemoPos | null => (order < 0 ? null : { side: sideOf(x), line: x.line, order });
  let orderOf: (x: AskLines['start']) => number;
  if (screen.kind === 'stop') {
    const s = stopRows(analysis, screen.course, screen.k);
    if (!s || s.path !== lines.path) return null;
    orderOf = (x) => s.rows.findIndex((r) => endsAt({ side: sideOf(x), line: x.line }, r));
  } else {
    const found = new Map<string, number>();
    let base = 0;
    for (const h of screen.hunks) {
      if (h.path !== lines.path) continue;
      let o = h.lnOld;
      let n = h.lnNew;
      h.lines.forEach((l, i) => {
        if (l[0] === '-') found.set(`LEFT:${o++}`, base + i);
        else {
          found.set(`RIGHT:${n++}`, base + i);
          if (l[0] !== '+') o++;
        }
      });
      base += h.lines.length;
    }
    orderOf = (x) => found.get(`${sideOf(x)}:${x.line}`) ?? -1;
  }
  const anchor = at(lines.start, orderOf(lines.start));
  const head = at(lines.end, orderOf(lines.end));
  return anchor && head ? { path: lines.path, anchor, head } : null;
}

/** 質問の文を書く枠に入れる（3.10）。空なら質問の文だけ。書きかけは消さずに改行して後ろに足す。同じ文がもう入っていれば足さない */
export function mergeDraft(draft: string, question: string): string {
  if (draft.trim() === '') return question;
  if (draft.includes(question)) return draft;
  return `${draft.replace(/\s+$/, '')}\n${question}`;
}
