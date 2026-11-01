// 並びを保ったまま空白を詰める（見本 map.html の packer / offAt）。How で絞ったとき、全体の配置から残った物だけを寄せる。
// 左右の順番・上下の順番を変えないので、動く距離が短く、目で追える（2026-09-24「視覚的差分を抑えながら位置を移動する」）。

export interface Span {
  a: number;
  b: number;
}

/** まとめた区間。off = 新しい位置 - 元の位置 */
export interface Packed extends Span {
  off: number;
}

/** 重なる・接する区間をまとめ、まとまりを start から gap 空けて並べ直す。end は最後のまとまりの終わり */
export function packer(spans: readonly Span[], start: number, gap: number): { merged: Packed[]; end: number } {
  const sorted = [...spans].sort((p, q) => p.a - q.a);
  const merged: Packed[] = [];
  for (const v of sorted) {
    const last = merged[merged.length - 1];
    if (last && v.a <= last.b + 1) last.b = Math.max(last.b, v.b);
    else merged.push({ a: v.a, b: v.b, off: 0 });
  }
  let cursor = start;
  for (const m of merged) {
    m.off = cursor - m.a;
    cursor = m.b + m.off + gap;
  }
  return { merged, end: cursor - gap };
}

/** 点 v のずらし量。区間の外（辺の曲がり点）はいちばん近い区間に従う */
export function offAt(merged: readonly Packed[], v: number): number {
  let best: Packed | undefined;
  let bd = Infinity;
  for (const m of merged) {
    const d = v < m.a ? m.a - v : v > m.b ? v - m.b : 0;
    if (d < bd) {
      bd = d;
      best = m;
    }
    if (d === 0) break;
  }
  return best ? best.off : 0;
}
