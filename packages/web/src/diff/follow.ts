// 差分一覧の列（全部のファイルを 1 本に並べる。設計書 3.4。2026-10-20）の位置の計算。DOM を読まない（行の位置は仮想リストが測った物を受け取る）。
// 一番上のファイルと見えている差分（diff.viewport で reducer に知らせる）、スクロールの行き先、貼り付くファイルの見出しと押し上げ。
import type { VirtualRow } from './rows.js';

/** ファイルの見出しの行の高さ = 貼り付く見出しの高さ = 仮想リストの scrollPaddingStart（.fh の CSS と同じ） */
export const FILE_HEAD_H = 34;

/** 行のファイルと差分。ファイルの見出しの行と hunk の外の行は差分 null、帯は直前の行の差分 */
export interface Owner {
  path: string;
  hunk: string | null;
}

/** owners = 行ごとの持ち主（rows と同じ長さ）、heads = ファイルの見出しの行の位置（上から） */
export interface Layout {
  owners: Owner[];
  heads: number[];
}

export function layoutOf(rows: readonly VirtualRow[]): Layout {
  const owners: Owner[] = [];
  const heads: number[] = [];
  let last: Owner = { path: '', hunk: null };
  rows.forEach((r, i) => {
    if (r.kind === 'file') heads.push(i);
    if (r.kind === 'file' || r.kind === 'ctx') last = { path: r.path, hunk: null };
    else if (r.kind === 'fold') last = { path: r.path, hunk: last.hunk };
    else last = { path: r.hunk.path, hunk: r.hunk.id };
    owners.push(last);
  });
  return { owners, heads };
}

/** 行 i のファイルの最初の中身の行（ファイルの見出しの次）。見出しの無い列（1 ファイルの画面）なら 0 */
export function bodyStart(l: Layout, i: number): number {
  let head = -1;
  for (const k of l.heads) if (k <= i) head = k;
  return head + 1;
}

/** 仮想リストの行の位置（virtual-core の VirtualItem の形） */
export interface Item {
  index: number;
  start: number;
  end: number;
}

/** 一番上のファイル（ツリーで明るくする）と、見えている差分（上から） */
export interface Seen {
  file: string;
  hunks: string[];
}

/**
 * 見えている範囲は貼り付く見出しの下 [offset + FILE_HEAD_H, offset + height)。file は一番上の行（貼り付く見出しの下に隠れた行）のファイル。
 * ただし一番下まで来ていて選んだ差分が見えていれば、そのファイル（最後の短いファイルは一番上まで来られない）。items は上から並んだ全部の行
 */
export function viewportOf(l: Layout, items: readonly Item[], v: { offset: number; height: number; total: number }, selected: string | null): Seen | null {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.end > v.offset) hi = mid;
    else lo = mid + 1;
  }
  const top = items[lo];
  if (!top) return null;
  const hunks: string[] = [];
  let selPath: string | null = null;
  for (let k = lo; k < items.length && items[k]!.start < v.offset + v.height; k++) {
    if (items[k]!.end <= v.offset + FILE_HEAD_H) continue;
    const o = l.owners[items[k]!.index];
    if (!o?.hunk) continue;
    if (hunks.at(-1) !== o.hunk) hunks.push(o.hunk);
    if (o.hunk === selected) selPath = o.path;
  }
  const atEnd = v.offset + v.height >= v.total - 1;
  return { file: (atEnd ? selPath : null) ?? l.owners[top.index]?.path ?? '', hunks };
}

/** スクロールの行き先。null は動かさない */
export type Reveal = { index: number; align: 'start' | 'auto' | 'center' } | null;

/**
 * 行 i へ移る行き先。to: file = ファイルの見出しを一番上、hunk = 見えていなければ見える所まで、line = 真ん中。
 * 移った後に前のファイルの末尾を一番上に残さない（ツリーと貼り付く見出しが i のファイルになる）: 行き先がファイルの頭より上になるなら、ファイルの頭へ。
 * そのとき i はファイルの頭から 1 画面（line は半画面）以内なので見えている。first = bodyStart、offsetOf = virtualizer.getOffsetForIndex
 */
export function revealPlan(i: number, to: 'file' | 'hunk' | 'line', first: number, offsetOf: (i: number, align: 'start' | 'auto' | 'center') => readonly [number, string] | undefined): Reveal {
  // padding（FILE_HEAD_H）の分だけ上に揃うので、ファイルの見出しの行がちょうど一番上に来る
  if (to === 'file') return { index: first, align: 'start' };
  const align = to === 'line' ? 'center' : 'auto';
  const want = offsetOf(i, align);
  const floor = offsetOf(first, 'start');
  // auto のまま返る = もう見えている
  if (!want || !floor || want[1] === 'auto') return null;
  return want[0] < floor[0] ? { index: first, align: 'start' } : { index: i, align };
}

/** 貼り付く見出し: offset の所のファイル（head = その見出しの行）。次のファイルの見出しが見出しの高さより近づいたら、その分だけ押し上げる（shift <= 0） */
export function stickyOf(l: Layout, startOf: (i: number) => number, offset: number): { head: number; path: string; shift: number } | null {
  let k = 0;
  while (k + 1 < l.heads.length && startOf(l.heads[k + 1]!) <= offset) k++;
  const head = l.heads[k];
  if (head === undefined) return null;
  const next = l.heads[k + 1];
  return { head, path: l.owners[head]!.path, shift: next === undefined ? 0 : Math.min(0, startOf(next) - offset - FILE_HEAD_H) };
}
