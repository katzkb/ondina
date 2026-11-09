// 要求コースの表示用の導出。読む順は chapters、ファイル順は githubDiff をそのまま使う。
import type { Analysis, Chapter, Hunk, HunkIntent } from '@ondina/model';
import { groupFiles, hunkAt } from './files.js';
import { onGithubDiff, pickRange, type MemoPick } from './memo.js';

export type RequirementChapter = 'start' | number | 'end';
export interface RequirementUi {
  chapter: RequirementChapter;
  narrow: boolean;
  /** 同じ章や場所を押し直しても、その見出しへ戻す一時的な合図 */
  focusN: number;
  openHunks: string[];
  files: Record<string, boolean>;
  editor: { hunkId: string; label: 'ask' | 'imo' } | null;
  scroll: { path: string; n: number } | null;
}
export const NO_REQUIREMENT: RequirementUi = { chapter: 'start', narrow: false, focusN: 0, openHunks: [], files: {}, editor: null, scroll: null };

/** local と古い解析には GitHub の並びが無いので、従来のファイル順で表示する。 */
export function requirementFiles(analysis: Analysis): Array<{ path: string }> {
  return analysis.githubDiff ?? groupFiles(analysis.hunks, []);
}

export function chapterLabel(analysis: Analysis, index: number): string {
  const chapter = analysis.chapters?.[index];
  if (chapter?.kind === 'follow') return 'つられた所';
  if (chapter?.kind === 'extra') return '要求の外';
  return `要求 ${(analysis.chapters ?? []).slice(0, index + 1).filter((c) => c.kind === 'spec').length}`;
}
export function chapterText(analysis: Analysis, chapter: Chapter): string {
  return chapter.kind === 'spec' ? analysis.specs.find((s) => s.id === chapter.specId)?.text ?? chapter.specId : '';
}
export function intentOf(analysis: Analysis, hunk: Hunk): HunkIntent | undefined {
  return analysis.intents?.find((i) => i.hunkId === (hunk.group?.representative ?? hunk.id));
}
/** 両端がこの hunk 内で、範囲が GitHub の差分にあるときだけ保存できる。行は選び直さない。 */
export function requirementPick(analysis: Analysis, hunkId: string, pick: MemoPick | null): boolean {
  if (!pick || (!analysis.githubDiff && analysis.pr.number !== 0)) return false;
  const within = (p: MemoPick['anchor']) => hunkAt(analysis.hunks, pick.path, p.line, p.side)?.id === hunkId;
  return within(pick.anchor) && within(pick.head) && onGithubDiff(analysis.githubDiff, { path: pick.path, ...pickRange(pick) }) !== false;
}
