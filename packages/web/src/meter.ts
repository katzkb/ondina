// 完了メーター（設計書 3.7）。プログラムが計算し、LLM に書かせない（原則 3）。
// 閲覧は「見た」を押した hunk を 1 件ずつ数える（追従グループの代表を見てもメンバーには付かない。2026-09-19 決定）。
import type { Analysis } from '@ondina/model';

export interface Ratio {
  n: number;
  total: number;
}

export interface Meter {
  /** How に属する hunk の重み / 全 hunk の重み */
  assigned: Ratio;
  /** 閲覧済み hunk の重み / 全 hunk の重み */
  viewed: Ratio;
  /** 2 つ以上の How に属す hunk の数 */
  tangled: number;
  /** 差分のある停留所を全部見たコース数 / コース数（コース外は数えない） */
  tours: Ratio;
  /** 対応する How がある仕様項目数 / 仕様項目数 */
  specs: Ratio;
  /** チケットのある PR だけ。全部の差分が「わかった」か「聞く」の要求の数 / 差分のある要求の数（差分が見つからない要求は数えない） */
  requirements?: Ratio;
}

export function meter(analysis: Analysis, viewedIds: readonly string[]): Meter {
  const viewed = new Set(viewedIds);
  const total = analysis.hunks.reduce((a, h) => a + h.n, 0);
  const assigned = analysis.hunks.filter((h) => h.hows.length > 0).reduce((a, h) => a + h.n, 0);
  const seen = analysis.hunks.filter((h) => viewed.has(h.id)).reduce((a, h) => a + h.n, 0);
  const tangled = analysis.hunks.filter((h) => h.hows.length > 1).length;
  const toursDone = analysis.tours.filter((t) => t.steps.every((s) => s.hunkId === undefined || viewed.has(s.hunkId))).length;
  const specsDone = analysis.specs.filter((s) => s.hows.length > 0).length;
  const specChapters = (analysis.chapters ?? []).filter((c) => c.kind === 'spec' && c.hunkIds.length > 0);
  return {
    assigned: { n: assigned, total },
    viewed: { n: seen, total },
    tangled,
    tours: { n: toursDone, total: analysis.tours.length },
    specs: { n: specsDone, total: analysis.specs.length },
    ...(analysis.chapters ? { requirements: { n: specChapters.filter((c) => c.hunkIds.every((id) => viewed.has(id))).length, total: specChapters.length } } : {}),
  };
}
