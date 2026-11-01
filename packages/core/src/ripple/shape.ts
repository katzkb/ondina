// 「形」（設計書 8 章 3〜6）。旧・新の単語列の差分のうち、消えた単語（-）と足された単語（+）だけを並べたもの。
// 周りに何が書いてあっても差分に出ないので無視される。案 3（木の編集距離）に替えるときはこのファイルだけ差し替える。
import { diffArrays } from 'diff';

/** 逸脱の形が代表の形とこの語数以下しか違わなければ「近い逸脱」（単語列の比較では決めきれない場所） */
export const NEAR_THRESHOLD = 2;

export function shapeOf(oldWords: readonly string[], newWords: readonly string[]): string[] {
  const out: string[] = [];
  for (const part of diffArrays([...oldWords], [...newWords])) {
    if (part.removed) for (const w of part.value) out.push(`-${w}`);
    else if (part.added) for (const w of part.value) out.push(`+${w}`);
  }
  return out;
}

/** 形どうしの単語単位の編集距離（Levenshtein） */
export function shapeDistance(a: readonly string[], b: readonly string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}
