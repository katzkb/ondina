// 入口の地図のまとまり（設計書 3.3。2026-11-04 に見本 6 の案 A で決定）。分け方は全部プログラムが決める（原則 3）。
// 規則:
// - 箱は差分のあるファイル 1 つ（テストの hunk は除く。地図はテストを出さない）か、畳んだ束 1 つ（メンバー全部）。逸脱は自分のファイルの箱に入る
// - 箱のコースは、箱の hunk の How の id のうち一番小さいもの（いまの地図の丸と同じ「最初のコース」）。どの How にも無ければコース外
// - コースが MAP_LIMIT 以下なら、全景はコース（How の並び）とコース外
// - コースが MAP_LIMIT を超えたら、1 回目の LLM が付けた題（themes）で全景を作る。題の中は、箱が MAP_LIMIT を超えればコース、以下なら箱を並べる。
//   題が規則に合わなければ使わず、全景にコースを全部並べる（7 を超えたまま出す。黙って直さない）
// - 箱の並びは、コースの読む順（tours）に出てくる順。読む順に無い箱は path 順
// TODO: 1 つのコースの箱が MAP_LIMIT を超えたときの中の段（見本の「機能」）は未実装。いまはそのまま並べる
import type { How, Hunk, MapBox, MapGroup, MapGroups, Tour } from '../model.js';

/** 1 枚の図に並べるまとまり・箱の数の上限 */
export const MAP_LIMIT = 7;

export const OUTSIDE_GROUP = 'outside';
export const courseGroupId = (howId: number): string => `course:${howId}`;

export interface Theme {
  title: string;
  howIds: number[];
}

export interface BuildMapGroupsArgs {
  hunks: readonly Hunk[];
  hows: readonly How[];
  tours: readonly Tour[];
  /** 1 回目の LLM の themes。コースが MAP_LIMIT 以下なら見ない */
  themes?: readonly Theme[];
}

export function buildMapGroups({ hunks, hows, tours, themes = [] }: BuildMapGroupsArgs): { mapGroups: MapGroups; info: string[] } {
  const info: string[] = [];
  const boxes = buildBoxes(hunks, hows, tours);
  const byCourse = new Map<number, MapBox[]>();
  for (const b of boxes) byCourse.set(b.course, [...(byCourse.get(b.course) ?? []), b]);

  const groups: MapGroup[] = [];
  const courseGroup = (howId: number): string | undefined => {
    const inside = byCourse.get(howId);
    if (inside === undefined) return undefined;
    const id = courseGroupId(howId);
    groups.push({ id, kind: 'course', howId, provenance: 'ast', children: inside.map((b) => b.id) });
    return id;
  };

  const root: string[] = [];
  const checked = hows.length > MAP_LIMIT ? checkThemes(themes, hows) : undefined;
  if (checked !== undefined && 'error' in checked) info.push(`地図のまとまりの名前を使いませんでした: ${checked.error}`);
  if (checked !== undefined && 'themes' in checked) {
    checked.themes.forEach((t, i) => {
      const inside = t.howIds.flatMap((h) => byCourse.get(h) ?? []);
      if (inside.length === 0) return;
      const children = inside.length > MAP_LIMIT ? t.howIds.flatMap((h) => courseGroup(h) ?? []) : inside.map((b) => b.id);
      const id = `theme:${i + 1}`;
      groups.push({ id, kind: 'theme', title: t.title, provenance: 'llm', children });
      root.push(id);
    });
  } else {
    for (const h of hows) {
      const id = courseGroup(h.id);
      if (id !== undefined) root.push(id);
    }
  }
  const outside = byCourse.get(0);
  if (outside !== undefined) {
    groups.push({ id: OUTSIDE_GROUP, kind: 'outside', provenance: 'ast', children: outside.map((b) => b.id) });
    root.push(OUTSIDE_GROUP);
  }
  return { mapGroups: { root, groups, boxes }, info };
}

function buildBoxes(hunks: readonly Hunk[], hows: readonly How[], tours: readonly Tour[]): MapBox[] {
  const howIds = new Set(hows.map((h) => h.id));
  const courseOf = (hs: readonly Hunk[]): number => {
    const first = Math.min(...hs.flatMap((h) => h.hows.filter((id) => howIds.has(id))));
    return Number.isFinite(first) ? first : 0;
  };
  const members = new Set<string>();
  const out: MapBox[] = [];
  const seen = new Set<string>();
  for (const h of hunks) {
    const g = h.group;
    if (g === undefined || seen.has(g.representative)) continue;
    seen.add(g.representative);
    for (const m of g.members) members.add(m);
    const inside = hunks.filter((x) => g.members.includes(x.id));
    const rep = hunks.find((x) => x.id === g.representative);
    out.push({ id: `group:${g.representative}`, label: g.pattern, hunkIds: inside.map((x) => x.id), course: courseOf(rep === undefined ? inside : [rep]) });
  }
  const byPath = new Map<string, Hunk[]>();
  for (const h of hunks) {
    if (h.kind === 'test' || members.has(h.id)) continue;
    byPath.set(h.path, [...(byPath.get(h.path) ?? []), h]);
  }
  for (const [p, hs] of byPath) out.push({ id: `file:${p}`, label: fileLabel(p), path: p, hunkIds: hs.map((h) => h.id), course: courseOf(hs) });

  // 読む順に出てくる順。読む順に無い箱は path 順（束は代表の path）
  const rank = new Map<string, number>();
  const boxOfHunk = new Map(out.flatMap((b) => b.hunkIds.map((id) => [id, b.id] as const)));
  for (const t of tours) for (const s of t.steps) {
    const b = s.hunkId === undefined ? undefined : boxOfHunk.get(s.hunkId);
    if (b !== undefined && !rank.has(b)) rank.set(b, rank.size);
  }
  const pathOf = new Map(hunks.map((h) => [h.id, h.path]));
  const sortKey = (b: MapBox): string => b.path ?? pathOf.get(b.hunkIds[0] ?? '') ?? b.id;
  return out.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || cmp(sortKey(a), sortKey(b)) || cmp(a.id, b.id));
}

/** 拡張子を除いたファイル名（OrderController.kt → OrderController）。拡張子が無ければそのまま */
function fileLabel(p: string): string {
  const name = p.split('/').pop() ?? p;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 題の規則: MAP_LIMIT 以下・名前が空でない・どの How もちょうど 1 つの題に入る・不明な How が無い */
function checkThemes(themes: readonly Theme[], hows: readonly How[]): { themes: Theme[] } | { error: string } {
  if (themes.length === 0) return { error: 'AI が名前を返しませんでした' };
  if (themes.length > MAP_LIMIT) return { error: `まとまりが ${themes.length} あります（${MAP_LIMIT} まで）` };
  if (themes.some((t) => t.title.trim() === '')) return { error: '名前が空のまとまりがあります' };
  const known = new Set(hows.map((h) => h.id));
  const used = themes.flatMap((t) => t.howIds);
  const unknown = used.filter((id) => !known.has(id));
  if (unknown.length > 0) return { error: `不明なコースの番号があります（${unknown.join('、')}）` };
  if (new Set(used).size !== used.length) return { error: '2 つのまとまりに入ったコースがあります' };
  const missing = hows.filter((h) => !used.includes(h.id));
  if (missing.length > 0) return { error: `どのまとまりにも入らないコースがあります（${missing.map((h) => h.id).join('、')}）` };
  const order = new Map(hows.map((h, i) => [h.id, i]));
  return { themes: themes.map((t) => ({ title: t.title, howIds: [...t.howIds].sort((a, b) => order.get(a)! - order.get(b)!) })) };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
