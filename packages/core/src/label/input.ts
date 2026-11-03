// LLM への入力（設計書 10.1 を今回の範囲に絞ったもの）を Stage 1 の成果物から組む。決定的（原則 7）。
// - 追従グループの hunk は hunks[] に入れず、rippleGroups[] に代表と逸脱の行だけ入れる（メンバー 22 件の同型は数だけ）
// - kindHint は読むだけのヒント。LLM に kind を書かせない（kind は verify.ts の規則で決める。原則 3）
// - previous は同じ PR の直近の解析から、id も lines も同じ hunk の割当だけ（5.3「変わっていない hunk の割当と How ID は維持」）
import type { Edge, How, Hunk, MapGroups, RippleGroup } from '../model.js';
import { createLayerAssigner, type LayerRule } from '../layers/assign.js';
import type { LlmInput, LlmInputGroup, LlmInputHunk, LlmPrevious } from './types.js';

export interface BuildLlmInputArgs {
  hunks: readonly Hunk[];
  groups: readonly RippleGroup[];
  /** detectRipples の candidateIds */
  candidateIds: readonly string[];
  pr: { title: string; body: string };
  previous?: LlmPrevious;
  /** 層の規則（設定の layers か、構成の推定から組んだ規則。5.2 の 4 / 10.6）。hunks[].layer・layers・unlayeredPaths を出すのに使う */
  layers?: readonly LayerRule[];
  /** LSP が取った辺（9 章）。LSP を動かしていなければ渡さない */
  edges?: readonly Edge[];
}

export function buildLlmInput({ hunks, groups, candidateIds, pr, previous, layers = [], edges }: BuildLlmInputArgs): LlmInput {
  const layerOf = createLayerAssigner(layers);
  const byId = new Map(hunks.map((h) => [h.id, h]));
  const candidates = new Set(candidateIds);
  const inGroups = new Set(groups.flatMap((g) => [...g.members, ...g.deviations]));
  const brief = (id: string) => {
    const h = byId.get(id)!;
    return { hunkId: id, path: h.path, symbol: h.symbol, lines: h.lines };
  };
  const rippleGroups: LlmInputGroup[] = groups.map((g, i) => ({
    id: `g${i + 1}`,
    pattern: g.pattern,
    coreHunkId: g.derivedFrom.coreHunkId,
    members: g.members.length,
    representative: brief(g.representative),
    deviations: g.deviations.map(brief),
  }));
  const inputHunks: LlmInputHunk[] = hunks
    .filter((h) => !inGroups.has(h.id))
    .map((h) => {
      const hint = h.kind === 'core' ? 'core' : h.kind === 'test' ? 'test' : candidates.has(h.id) ? 'candidate' : undefined;
      const layer = layerOf(h.path);
      return { id: h.id, path: h.path, symbol: h.symbol, ...(hint === undefined ? {} : { kindHint: hint }), ...(layer === undefined ? {} : { layer }), lines: h.lines };
    });
  // 層が付かない変更ファイル。重複を落として昇順（同じ headSha に同じ入力。原則 7）
  const unlayeredPaths = [...new Set(hunks.map((h) => h.path).filter((p) => layerOf(p) === undefined))].sort();
  // 選べる層の名前。構成の推定から組んだ規則は同じ名前が何度も出るので、最初に出た順で重複を落とす
  const layerNames = [...new Set(layers.map((l) => l.name))];
  return {
    pr,
    ...(previous === undefined ? {} : { previous }),
    hunks: inputHunks,
    rippleGroups,
    // 参照辺は LLM に渡さない（LLM 入力は呼び出し・テスト・schema まで。参照は地図に描くだけ。2026-09-24 決定）
    ...(edges === undefined ? {} : { edges: edges.flatMap((e) => (e.kind === 'reference' ? [] : [{ from: e.from, to: e.to, kind: e.kind }])) }),
    ...(unlayeredPaths.length === 0 || layerNames.length === 0 ? {} : { layers: layerNames }),
    ...(unlayeredPaths.length === 0 ? {} : { unlayeredPaths }),
  };
}

/** 前回の解析から previous を作る。前回に hows が無ければ（LLM を飛ばした回）undefined */
export function previousFrom(prev: { hows: readonly How[]; hunks: readonly Pick<Hunk, 'id' | 'lines' | 'hows'>[]; mapGroups?: MapGroups }, hunks: readonly Pick<Hunk, 'id' | 'lines'>[]): LlmPrevious | undefined {
  if (prev.hows.length === 0) return undefined;
  const now = new Map(hunks.map((h) => [h.id, h.lines.join('\n')]));
  const assignment: Record<string, number[]> = {};
  for (const h of prev.hunks) {
    if (h.hows.length === 0) continue;
    if (now.get(h.id) !== h.lines.join('\n')) continue;
    assignment[h.id] = [...h.hows];
  }
  const themes = themesOf(prev.mapGroups);
  return { hows: prev.hows.map((h) => ({ id: h.id, title: h.title, why: h.why })), assignment, ...(themes.length === 0 ? {} : { themes }) };
}

/** 前回の題と、その中のコース（題の中が箱でも、箱のコースから引く） */
function themesOf(m: MapGroups | undefined): Array<{ title: string; howIds: number[] }> {
  if (m === undefined) return [];
  const course = new Map(m.boxes.map((b) => [b.id, b.course]));
  const howOf = new Map(m.groups.flatMap((g) => (g.howId === undefined ? [] : [[g.id, g.howId] as const])));
  return m.groups.flatMap((g) =>
    g.kind !== 'theme' || g.title === undefined ? [] : [{ title: g.title, howIds: [...new Set(g.children.map((c) => howOf.get(c) ?? course.get(c) ?? 0).filter((n) => n > 0))] }],
  );
}
