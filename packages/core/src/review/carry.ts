// 前の版の state を新しい版に引き継ぐ（3.0 の帯の下の 1 行 / 12 章。2026-10-13）。
// PR に新しいコミットが積まれて解析し直したとき、変わっていない差分の「問題なし」と、行が変わっていないメモ・下書きを移す。
// 純関数。serve が新しい版の state を初めて読むときに呼んで書く（前の版の state は書き換えない）。
import type { Analysis, CommentDraft, FileText, How, Hunk, ReviewState } from '@ondina/model';
import { changeBlocks } from '../hunks/line-diff.js';

/** 引き継ぎに要る部分だけ */
export interface CarrySource {
  pr: Pick<Analysis['pr'], 'headSha' | 'baseSha'>;
  hunks: ReadonlyArray<Pick<Hunk, 'id' | 'lines' | 'hows' | 'path' | 'lnOld' | 'lnNew'>>;
  hows: ReadonlyArray<Pick<How, 'id'>>;
  files?: readonly FileText[];
}

const sameLines = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((l, i) => l === b[i]);

/** 前の版と id も lines も同じ hunk の id（新しい版の側） */
function unchangedIds(prev: CarrySource, next: CarrySource): Set<string> {
  const before = new Map(prev.hunks.map((h) => [h.id, h.lines]));
  return new Set(next.hunks.filter((h) => before.has(h.id) && sameLines(before.get(h.id)!, h.lines)).map((h) => h.id));
}

/** 新しい版で変わった差分（lines が違う hunk と、新しい hunk）の id。消えた hunk は入れない */
export function changedHunks(prev: CarrySource, next: CarrySource): string[] {
  const same = unchangedIds(prev, next);
  return next.hunks.filter((h) => !same.has(h.id)).map((h) => h.id);
}

/** 前の全文の行番号 → 新しい全文の行番号。変わった行・範囲外は undefined（1 始まり） */
export function mapLines(oldLines: readonly string[], newLines: readonly string[]): (line: number) => number | undefined {
  const blocks = changeBlocks(oldLines, newLines);
  return (line) => {
    if (line < 1 || line > oldLines.length) return undefined;
    let shift = 0;
    for (const b of blocks) {
      if (line >= b.oldStart && line <= b.oldEnd) return undefined;
      // 挿入（oldEnd = oldStart - 1）も置換・削除も、oldEnd より後ろの行がずれる
      if (line > b.oldEnd) shift += b.newEnd - b.newStart + 1 - (b.oldEnd - b.oldStart + 1);
    }
    return line + shift;
  };
}

/** その base 側の行と head 側の行を両方含む hunk（base 側は lnOld から ' ' と '-' の行、head 側は lnNew から ' ' と '+' の行を数える） */
function hunkAround(hunks: CarrySource['hunks'], path: string, base: number, head: number): CarrySource['hunks'][number] | undefined {
  return hunks.find((h) => {
    if (h.path !== path) return false;
    const oldLen = h.lines.filter((l) => !l.startsWith('+')).length;
    const newLen = h.lines.filter((l) => !l.startsWith('-')).length;
    return base >= h.lnOld && base < h.lnOld + oldLen && head >= h.lnNew && head < h.lnNew + newLen;
  });
}

const textOf = (files: readonly FileText[] | undefined, path: string): string[] | undefined =>
  files?.find((f) => f.path === path)?.tokens.map((line) => line.map((t) => t[0]).join(''));

/**
 * メモ・下書き 1 件を新しい版の行に移す。移せなければ undefined。
 * head 側（RIGHT）は前後の全文を突き合わせ、範囲の行が全部変わっていなければずらす。base 側（LEFT）は baseSha が同じときだけそのまま
 */
function moveComment(c: CommentDraft, prev: CarrySource, next: CarrySource, same: ReadonlySet<string>, maps: Map<string, ((line: number) => number | undefined) | undefined>): CommentDraft | undefined {
  const mapFor = (side: 'LEFT' | 'RIGHT'): ((line: number) => number | undefined) | undefined => {
    if (side === 'LEFT') return prev.pr.baseSha === next.pr.baseSha ? (line) => line : undefined;
    if (!maps.has(c.path)) {
      const before = textOf(prev.files, c.path);
      const after = textOf(next.files, c.path);
      maps.set(c.path, before === undefined || after === undefined ? undefined : mapLines(before, after));
    }
    return maps.get(c.path);
  };
  const startSide = c.startSide ?? c.side;
  const start = c.startLine ?? c.line;
  const end = mapFor(c.side)?.(c.line);
  const begin = mapFor(startSide)?.(start);
  if (end === undefined || begin === undefined) return undefined;
  // 同じ側の範囲は、間の行も全部変わっていないこと（1 行を 1 行に書き換えるとずれ幅は同じなので、行ごとに見る）
  if (startSide === c.side) {
    const map = mapFor(c.side)!;
    for (let line = start + 1; line < c.line; line++) if (map(line) === undefined) return undefined;
  } else {
    // base と head にまたがる範囲（消した行から下の足した行、変わらない行・足した行から下の消した行）は、間の行が両側に分かれていて行の差分では追えない。
    // 範囲を含む差分が前後で変わっていない（id も lines も同じ）ときだけ移す
    const [base, head] = startSide === 'LEFT' ? [start, c.line] : [c.line, start];
    const around = hunkAround(prev.hunks, c.path, base, head);
    if (around === undefined || !same.has(around.id)) return undefined;
  }
  return { ...c, line: end, ...(c.startLine === undefined ? {} : { startLine: begin }) };
}

/** 前の版の state から新しい版の state を作る。carried に何を戻し・何を残したかを記録する */
export function carryReview(prev: CarrySource, prevState: ReviewState, next: CarrySource): ReviewState {
  const same = unchangedIds(prev, next);
  const inNext = new Set(next.hunks.map((h) => h.id));
  const viewed = prevState.viewed.filter((id) => same.has(id));
  const reset = prevState.viewed.filter((id) => inNext.has(id) && !same.has(id));

  // コースの完了は、新しい版でそのコースの差分が全部「問題なし」のときだけ残す
  const seen = new Set(viewed);
  const howIds = new Set(next.hows.map((h) => h.id));
  const allSeen = (course: number) => next.hunks.filter((h) => h.hows.includes(course)).every((h) => seen.has(h.id));
  const completed = prevState.course?.completed ?? [];
  const kept = completed.filter((c) => howIds.has(c) && allSeen(c));
  const coursesReset = completed.filter((c) => howIds.has(c) && !kept.includes(c));

  const maps = new Map<string, ((line: number) => number | undefined) | undefined>();
  const comments: CommentDraft[] = [];
  const left: string[] = [];
  for (const c of prevState.comments) {
    if (c.state === 'sent' || c.state === 'discarded') continue;
    const moved = moveComment(c, prev, next, same, maps);
    if (moved === undefined) left.push(c.id);
    else comments.push(moved);
  }

  return {
    viewed,
    comments,
    ...(prevState.course === undefined ? {} : { course: { done: [], completed: kept } }),
    carried: { from: prev.pr.headSha, reset, coursesReset, left },
  };
}
