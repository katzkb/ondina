// 行単位の差分。変更ブロック（旧範囲と新範囲の対）と、hunk 用の統合形式（' ' / '-' / '+'）を作る。
import { diffArrays } from 'diff';

/** 1始まり・両端含む。片側が空なら end = start - 1 で、start は挿入位置を指す */
export interface ChangeBlock {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
}

/** 末尾の改行で空行を作らない行分割 */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function changeBlocks(oldLines: readonly string[], newLines: readonly string[]): ChangeBlock[] {
  const blocks: ChangeBlock[] = [];
  let oldPos = 1;
  let newPos = 1;
  let current: ChangeBlock | undefined;
  for (const part of diffArrays([...oldLines], [...newLines])) {
    const n = part.value.length;
    if (part.removed) {
      current ??= { oldStart: oldPos, oldEnd: oldPos - 1, newStart: newPos, newEnd: newPos - 1 };
      current.oldEnd += n;
      oldPos += n;
    } else if (part.added) {
      current ??= { oldStart: oldPos, oldEnd: oldPos - 1, newStart: newPos, newEnd: newPos - 1 };
      current.newEnd += n;
      newPos += n;
    } else {
      if (current !== undefined) blocks.push(current);
      current = undefined;
      oldPos += n;
      newPos += n;
    }
  }
  if (current !== undefined) blocks.push(current);
  return blocks;
}

/** 設計書 4章 `Hunk.lines`: 1文字目が ' ' | '+' | '-' の統合形式 */
export function unifiedLines(oldLines: readonly string[], newLines: readonly string[]): string[] {
  const out: string[] = [];
  for (const part of diffArrays([...oldLines], [...newLines])) {
    const prefix = part.removed ? '-' : part.added ? '+' : ' ';
    for (const line of part.value) out.push(prefix + line);
  }
  return out;
}
