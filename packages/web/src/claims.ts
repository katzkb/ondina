// 説明の画面の「作者の説明」（設計書 3.1）。原文から、裏付けのない文（backed: false）と完全一致する箇所を探す。
// 画面は authorBody がこの区切りを原文の offset にして、Markdown として描いた後の文字にマーカーを打つ（2026-10-10）。
// 完全一致は近似（LLM が文を少し変えて写すと当たらない）。当たらなかった文は unmatched に返し、画面で別枠に出す（2026-09-19 決定）。
import type { Claim } from '@ondina/model';

export interface ClaimSegment {
  text: string;
  /** この区間に当たった裏付けなしの文。無ければ地の文 */
  claim?: Claim;
}

export interface MarkedClaims {
  /** 連結すると body に戻る */
  segments: ClaimSegment[];
  /** backed: false のうち body に見つからなかった文（出現順は claims の順） */
  unmatched: Claim[];
}

export function markClaims(body: string, claims: readonly Claim[]): MarkedClaims {
  // 先に出現位置を全部求め、位置順に並べてから重なりを落とす（先に見つかった方を優先）
  const found: Array<{ at: number; claim: Claim }> = [];
  const unmatched: Claim[] = [];
  for (const claim of claims) {
    if (claim.backed) continue;
    const at = claim.text === '' ? -1 : body.indexOf(claim.text);
    if (at < 0) unmatched.push(claim);
    else found.push({ at, claim });
  }
  found.sort((a, b) => a.at - b.at);

  const segments: ClaimSegment[] = [];
  let cursor = 0;
  for (const { at, claim } of found) {
    if (at < cursor) {
      unmatched.push(claim);
      continue;
    }
    if (at > cursor) segments.push({ text: body.slice(cursor, at) });
    segments.push({ text: claim.text, claim });
    cursor = at + claim.text.length;
  }
  if (cursor < body.length) segments.push({ text: body.slice(cursor) });
  // unmatched は claims の順に揃える（重なりで落ちた分が後ろに付くので）
  const order = new Map(claims.map((c, i) => [c, i]));
  unmatched.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { segments, unmatched };
}
