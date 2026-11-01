// GitHub の PR の差分の塊（Analysis.githubDiff。12 章）。GitHub が行コメントを付けられるのは、この塊に入る行だけ。
// web の memo.ts の onGithubDiff と同じ規則（web は core を読めないので写しを置く。原則 5）。cli が AI の下書きを受けるときと送るときに使う
import type { CommentDraft, GithubDiffFile } from '@ondina/model';

/**
 * 行（範囲なら始まりと終わりのそれぞれ）がその side の塊に入るか。塊をまたぐ範囲も入る（2026-10-06 に本物の PR で確認）。
 * githubDiff が無い解析（local と古い解析）は決めない（undefined。どの行にも書けて、送れる）
 */
export function onGithubDiff(diff: readonly GithubDiffFile[] | undefined, c: Pick<CommentDraft, 'path' | 'line' | 'side' | 'startLine' | 'startSide'>): boolean | undefined {
  if (!diff) return undefined;
  const file = diff.find((f) => f.path === c.path);
  const inDiff = (side: 'LEFT' | 'RIGHT', line: number): boolean =>
    file !== undefined && file.hunks.some((h) => (side === 'RIGHT' ? line >= h.newStart && line < h.newStart + h.newLines : line >= h.oldStart && line < h.oldStart + h.oldLines));
  const startOk = c.startLine === undefined || inDiff(c.startSide ?? c.side, c.startLine);
  return startOk && inDiff(c.side, c.line);
}
