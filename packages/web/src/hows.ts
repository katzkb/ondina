// How 分解の画面（設計書 3.2）の中央列の行を作る。純粋関数。
// 並び: How の id 順（= 依存順）に、その How に属す hunk を 核 → 追従 → テスト、同じ種別は path 順。
// 2 つ以上の How に属す hunk は最初の How の位置に 1 回。どの How にも属さない hunk は最後。
// 追従グループ（同じ書き換えの束）は 1 行にまとめ、展開すると 代表 → 逸脱 → メンバー の行が続く。
// 「見た」は 1 件ずつ（束の行を見ても代表以外には付かない。2026-09-19 決定）。
import type { Analysis, Hunk, RippleGroup } from '@ondina/model';

export type HowRow =
  | { kind: 'hunk'; hunk: Hunk; dim: boolean }
  | {
      kind: 'group';
      group: RippleGroup;
      representative: Hunk;
      /** 代表・逸脱・メンバーの全部（代表 → 逸脱 → メンバーの順） */
      hunks: Hunk[];
      /** 束が触るファイル数 */
      files: number;
      /** hunks のうち閲覧済みの数 */
      viewedCount: number;
      open: boolean;
      dim: boolean;
    }
  | { kind: 'member'; hunk: Hunk; role: 'representative' | 'deviation' | 'member'; dim: boolean };

const KIND_ORDER: Record<Hunk['kind'], number> = { core: 0, ripple: 1, test: 2, none: 3 };

function byKindThenPath(a: Hunk, b: Hunk): number {
  const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (k !== 0) return k;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function byPath(a: Hunk, b: Hunk): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** 束の hunk を 代表 → 逸脱（path 順）→ メンバー（path 順）に並べる */
function groupMembers(group: RippleGroup, byId: Map<string, Hunk>): Array<Extract<HowRow, { kind: 'member' }>> {
  const pick = (ids: readonly string[]) => ids.map((id) => byId.get(id)).filter((h): h is Hunk => h !== undefined);
  const rep = byId.get(group.representative);
  const deviations = pick(group.deviations).sort(byPath);
  const members = pick(group.members.filter((id) => id !== group.representative)).sort(byPath);
  return [
    ...(rep ? [{ kind: 'member' as const, hunk: rep, role: 'representative' as const, dim: false }] : []),
    ...deviations.map((h) => ({ kind: 'member' as const, hunk: h, role: 'deviation' as const, dim: false })),
    ...members.map((h) => ({ kind: 'member' as const, hunk: h, role: 'member' as const, dim: false })),
  ];
}

export function howRows(analysis: Analysis, viewedIds: readonly string[], openGroups: readonly string[], selectedHow: number | null): HowRow[] {
  const viewed = new Set(viewedIds);
  const open = new Set(openGroups);
  const byId = new Map(analysis.hunks.map((h) => [h.id, h]));
  const emitted = new Set<string>();
  const rows: HowRow[] = [];

  const dimOf = (hunk: Hunk) => selectedHow !== null && !hunk.hows.includes(selectedHow);

  const emit = (hunk: Hunk) => {
    if (emitted.has(hunk.id)) return;
    const g = hunk.group;
    if (hunk.kind === 'ripple' && g) {
      const members = groupMembers(g, byId);
      for (const m of members) emitted.add(m.hunk.id);
      emitted.add(hunk.id);
      const rep = byId.get(g.representative) ?? hunk;
      const dim = dimOf(rep);
      const hunks = members.map((m) => m.hunk);
      rows.push({
        kind: 'group',
        group: g,
        representative: rep,
        hunks,
        files: new Set(hunks.map((h) => h.path)).size,
        viewedCount: hunks.filter((h) => viewed.has(h.id)).length,
        open: open.has(g.representative),
        dim,
      });
      if (open.has(g.representative)) for (const m of members) rows.push({ ...m, dim });
      return;
    }
    emitted.add(hunk.id);
    rows.push({ kind: 'hunk', hunk, dim: dimOf(hunk) });
  };

  for (const how of analysis.hows) {
    for (const hunk of analysis.hunks.filter((h) => h.hows.includes(how.id)).sort(byKindThenPath)) emit(hunk);
  }
  for (const hunk of analysis.hunks.filter((h) => !emitted.has(h.id)).sort(byKindThenPath)) emit(hunk);
  return rows;
}

/** j / k で通る hunk id の列。dim の行は飛ばし、畳んだ束は代表 1 つ、展開した束はメンバーの行を通る */
export function navigable(rows: readonly HowRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.dim) continue;
    if (r.kind === 'hunk') out.push(r.hunk.id);
    else if (r.kind === 'group') {
      if (!r.open) out.push(r.representative.id);
    } else out.push(r.hunk.id);
  }
  return out;
}

export interface HowCount {
  core: number;
  ripple: number;
  test: number;
  total: number;
  viewed: number;
  /** 見た割合（0〜100 の整数）。total が 0 なら 0 */
  pct: number;
}

/** How カードのチップと進捗バー（設計書 3.2）。束のメンバーも 1 件ずつ数える */
export function howCounts(analysis: Analysis, viewedIds: readonly string[]): Map<number, HowCount> {
  const viewed = new Set(viewedIds);
  const out = new Map<number, HowCount>();
  for (const how of analysis.hows) {
    const mine = analysis.hunks.filter((h) => h.hows.includes(how.id));
    const total = mine.length;
    const seen = mine.filter((h) => viewed.has(h.id)).length;
    out.set(how.id, {
      core: mine.filter((h) => h.kind === 'core').length,
      ripple: mine.filter((h) => h.kind === 'ripple').length,
      test: mine.filter((h) => h.kind === 'test').length,
      total,
      viewed: seen,
      pct: total === 0 ? 0 : Math.round((seen / total) * 100),
    });
  }
  return out;
}

export interface RippleCounts {
  /** kind が ripple の hunk 数（メンバーと逸脱の合計） */
  ripple: number;
  /** 束から外れた hunk 数 */
  deviations: number;
  /** 逸脱のうち代表の形と近いもの（8 章。単語列の比較では決めきれない場所） */
  near: number;
}

/** 追従の件数（8 章）。束の行の 2 行目に出す */
export function rippleCounts(hunks: readonly Hunk[]): RippleCounts {
  let ripple = 0;
  let deviations = 0;
  let near = 0;
  for (const h of hunks) {
    if (h.kind !== 'ripple') continue;
    ripple++;
    if (h.group?.deviations.includes(h.id)) deviations++;
    if (h.group?.near.includes(h.id)) near++;
  }
  return { ripple, deviations, near };
}
