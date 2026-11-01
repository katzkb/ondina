// 統合形式の lines を左右に整列する。docs/prototype.html の alignRows を純粋関数として移植（設計書 17 章）。
// 連続する削除と追加を段ごとに対にし、余った側は null（UI は斜線で塗る）。

export type SideKind = 'c' | 'a' | 'r'; // 共通 / 追加 / 削除

export interface Side {
  /** lines のインデックス */
  i: number;
  t: SideKind;
  /** その側の行番号 */
  ln: number;
}

export interface Row {
  o: Side | null;
  n: Side | null;
}

export function alignRows(lines: readonly string[], lnOld: number, lnNew: number): Row[] {
  const rows: Row[] = [];
  let o = lnOld;
  let n = lnNew;
  let i = 0;
  while (i < lines.length) {
    const c = lines[i]![0];
    if (c === '-') {
      const del: number[] = [];
      const add: number[] = [];
      while (i < lines.length && lines[i]![0] === '-') del.push(i++);
      while (i < lines.length && lines[i]![0] === '+') add.push(i++);
      for (let k = 0; k < Math.max(del.length, add.length); k++) {
        rows.push({
          o: k < del.length ? { i: del[k]!, t: 'r', ln: o++ } : null,
          n: k < add.length ? { i: add[k]!, t: 'a', ln: n++ } : null,
        });
      }
    } else if (c === '+') {
      rows.push({ o: null, n: { i, t: 'a', ln: n++ } });
      i++;
    } else {
      rows.push({ o: { i, t: 'c', ln: o++ }, n: { i, t: 'c', ln: n++ } });
      i++;
    }
  }
  return rows;
}
