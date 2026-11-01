// hunk の統合形式 lines を lnOld / lnNew から歩いて、消した行と足した行の番号を出す。束の検出（ripple/detect.ts）と呼び出し辺（lsp/edges.ts）が使う。
// headLines は行ごとの head の番号。2 回目の LLM の入力（narration/input.ts）と、確かめることの根拠の行の検証（narration/verify.ts）が同じ番号を使う
import type { Hunk } from '../model.js';

/** hunk の削除行（旧側の行番号）と追加行（新側の行番号）。1 始まり */
export function changedLines(h: Pick<Hunk, 'lnOld' | 'lnNew' | 'lines'>): { oldLines: number[]; newLines: number[] } {
  const oldLines: number[] = [];
  const newLines: number[] = [];
  let o = h.lnOld;
  let n = h.lnNew;
  for (const line of h.lines) {
    const c = line[0];
    if (c === '-') oldLines.push(o++);
    else if (c === '+') newLines.push(n++);
    else {
      o++;
      n++;
    }
  }
  return { oldLines, newLines };
}

/** 行ごとの head の行番号（1 始まり）。文脈と追加の行は lnNew から 1 ずつ、削除の行は null */
export function headLines(h: Pick<Hunk, 'lnNew' | 'lines'>): Array<number | null> {
  let n = h.lnNew;
  return h.lines.map((l) => (l[0] === '-' ? null : n++));
}
