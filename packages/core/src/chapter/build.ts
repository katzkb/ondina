// 要求ごとの章をプログラムで組む。意味の対応は Spec.hunkIds、読む順は既存コースと同じ（原則 3）。
import type { Chapter, Spec } from '../model.js';
import { readingOrder, type BuildToursArgs } from '../tour/build.js';

export interface BuildChaptersArgs extends Omit<BuildToursArgs, 'hows'> {
  specs: readonly Spec[];
}

export function buildChapters(args: BuildChaptersArgs): Chapter[] {
  const read = readingOrder(args);
  const chapters: Chapter[] = args.specs.map((s) => ({ kind: 'spec', specId: s.id, hunkIds: read(new Set(s.hunkIds)).hunkIds }));
  const assigned = new Set(chapters.flatMap((c) => c.hunkIds));
  const byId = new Map(args.hunks.map((h) => [h.id, h]));

  // 未選択の import は、同じファイルを読む最初の要求の末尾へ。
  for (const h of args.hunks) {
    if (!h.importsOnly || assigned.has(h.id)) continue;
    const chapter = chapters.find((c) => c.hunkIds.some((id) => byId.get(id)?.path === h.path));
    if (chapter === undefined) continue;
    chapter.hunkIds.push(h.id);
    assigned.add(h.id);
  }

  const groups = new Map(args.hunks.flatMap((h) => h.group === undefined ? [] : [[h.group.representative, h.group] as const]));
  const follow: string[] = [];
  for (const g of groups.values()) {
    const members = new Set(g.members);
    const deviations = new Set(g.deviations);
    const ordered = [byId.get(g.representative), ...args.hunks.filter((h) => h.id !== g.representative)];
    for (const h of ordered) {
      if (h === undefined || assigned.has(h.id) || !members.has(h.id) || deviations.has(h.id) || h.id === g.derivedFrom.coreHunkId) continue;
      follow.push(h.id);
      assigned.add(h.id);
    }
  }
  if (follow.length > 0) chapters.push({ kind: 'follow', hunkIds: follow });
  const extra = args.hunks.filter((h) => !assigned.has(h.id)).map((h) => h.id);
  if (extra.length > 0) chapters.push({ kind: 'extra', hunkIds: extra });
  return chapters;
}
