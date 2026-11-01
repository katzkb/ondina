// 未変更シンボルの行の切り出し（設計書 3.3）。ファイルを読まない純粋な処理。本文は cli が head の worktree から読んで渡す。
// 画面は切り出さない（原則 5）: web は Symbol.excerpt をそのまま描く。
import type { ExcerptBlock } from '../model.js';

/**
 * 中心の行（0 始まり。LSP の行番号のまま）の前後 context 行を切り出す。
 * 前後が重なる・隙間なく隣り合う中心は 1 つの塊につなぐ（⋯ で 0 行を隠さない）。ファイルの外の中心は捨てる。
 */
export function cutExcerpt(text: string, centers: readonly number[], context = 2): ExcerptBlock[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const sorted = [...new Set(centers)].filter((c) => Number.isInteger(c) && c >= 0 && c < lines.length).sort((a, b) => a - b);

  const blocks: Array<{ from: number; to: number; centers: number[] }> = [];
  for (const c of sorted) {
    const from = Math.max(0, c - context);
    const to = Math.min(lines.length - 1, c + context);
    const last = blocks.at(-1);
    if (last !== undefined && from <= last.to + 1) {
      last.to = to;
      last.centers.push(c);
    } else {
      blocks.push({ from, to, centers: [c] });
    }
  }
  return blocks.map((b) => ({ start: b.from + 1, lines: lines.slice(b.from, b.to + 1), centers: b.centers.map((c) => c + 1) }));
}
