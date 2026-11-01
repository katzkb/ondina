// 追従検出（設計書 8 章。AST 判定のみ。LLM フォールバック（8 章 6）は M4）。
//
// 入力: 変更ファイル（before / after）と Stage 1 の hunk、解析設定、テストの見分け。出力: kind / group を書いた新しい hunk 配列と RippleGroup[]。
// 手順:
//   0. テストの見分け（layers/assign.ts の testPathsFor。設定か構成の推定。5.2 の 7）でテストの hunk は kind 'test'（決めた出どころ）。束には入れない
//   1. 候補（candidates.ts）: 宣言の追加・削除・シグネチャ変更を含む hunk。R / A を取る。候補どうしは束にならない
//   2. 参照: 他の hunk のうち、削除行の識別子に R があり、追加行の識別子に A があるものをその候補の追従候補にする
//      （複数の候補に当たる hunk は最初の候補につける）
//   3. 形（tokens.ts / shape.ts）: 変更行の単語列 → 正規化 → R∪A 以外を $n → 旧・新の差分
//   4. 束: 最も多い形を束の形にし、その形で最初の hunk を代表にする（同数なら先に出た形）。uniform 'ast'
//   5. 逸脱: 形が違うもの。代表の形との距離を記録し、閾値以下を near に入れる
//   6. kind: 束を持つ候補だけ 'core'（束の無い候補は 'none' のまま。LLM ラベリングの入力にする）。束の全 hunk は 'ripple' + 同じ group
//   7. パターン: R / A のうち束の hunk が実際に参照した名前だけ。関数は `()` 付き。R が空なら `+A`
//   8. n は全 hunk で 1 のまま（グループの閲覧規則はメーター側。3.7）
import type { AnalysisConfig, Hunk, RippleGroup } from '@ondina/model';
import type { Tree } from 'web-tree-sitter';
import { changedLines } from '../hunks/changed-lines.js';
import type { ChangedFile } from '../hunks/extract.js';
import { parseKotlin } from '../hunks/kotlin-parser.js';
import { testPathsFor, type TestPaths } from '../layers/assign.js';
import { coreCandidate, type CandidateName, type CoreCandidate } from './candidates.js';
import { NEAR_THRESHOLD, shapeDistance, shapeOf } from './shape.js';
import { DEFERRED_RULES, leafTokens, NORMALIZE_RULES, normalizeTokens, placeholders, type Token } from './tokens.js';

export interface RippleResult {
  hunks: Hunk[];
  groups: RippleGroup[];
  /** analyze が stderr に出す要約と注意 */
  info: string[];
  /** 核候補（8 章 1）の hunk id。hunk 順（path 順 → 行順）。束の無い候補は LLM ラベリング（10 章）の kindHint 'candidate' になる */
  candidateIds: string[];
}

interface Trees {
  old: Tree;
  new: Tree;
}

interface Follower {
  hunk: Hunk;
  removedRefs: Set<string>;
  addedRefs: Set<string>;
  shape: string[];
}

export async function detectRipples(files: readonly ChangedFile[], hunks: readonly Hunk[], config: AnalysisConfig, tests: TestPaths = testPathsFor(config)): Promise<RippleResult> {
  const info: string[] = [];
  const rules = config.normalize['kotlin'] ?? [];
  const testKind = tests.provenance;
  const out: Hunk[] = hunks.map((h) => (testKind !== undefined && tests.isTest(h.path) ? { ...h, kind: 'test', kindProvenance: testKind } : { ...h }));

  const trees = await parseKotlinFiles(files, out);
  const inScope = (h: Hunk): boolean => h.kind !== 'test' && h.symbolKind !== 'file' && trees.has(h.path);

  // 1. 候補
  const candidates = new Map<string, CoreCandidate>();
  for (const h of out) {
    if (!inScope(h)) continue;
    const t = trees.get(h.path)!;
    const c = coreCandidate(h, t.old, t.new);
    if (c !== undefined) candidates.set(h.id, c);
  }

  // 2〜5. 候補ごとに追従候補を集めて束にする
  const groups: RippleGroup[] = [];
  const taken = new Set<string>();
  for (const [coreId, c] of candidates) {
    const R = new Set(c.removed.map((n) => n.name));
    const A = new Set(c.added.map((n) => n.name));
    const keep = new Set([...R, ...A]);
    const followers: Follower[] = [];
    for (const h of out) {
      if (!inScope(h) || candidates.has(h.id) || taken.has(h.id)) continue;
      const t = trees.get(h.path)!;
      const { oldLines, newLines } = changedLines(h);
      const oldTokens = normalizeTokens(leafTokens(t.old, oldLines), rules);
      const newTokens = normalizeTokens(leafTokens(t.new, newLines), rules);
      const removedRefs = identifiers(oldTokens, R);
      const addedRefs = identifiers(newTokens, A);
      if (removedRefs.size === 0 || addedRefs.size === 0) continue;
      const [o, n] = placeholders(oldTokens, newTokens, keep);
      followers.push({ hunk: h, removedRefs, addedRefs, shape: shapeOf(o, n) });
    }
    if (followers.length === 0) continue;
    const group = buildGroup(coreId, c, followers);
    groups.push(group);
    for (const id of [...group.members, ...group.deviations]) taken.add(id);
  }

  // 6. kind と group を書く
  const groupOf = new Map<string, RippleGroup>();
  const coreIds = new Set<string>();
  for (const g of groups) {
    coreIds.add(g.derivedFrom.coreHunkId);
    for (const id of [...g.members, ...g.deviations]) groupOf.set(id, g);
  }
  const result = out.map((h) => {
    if (coreIds.has(h.id)) return { ...h, kind: 'core' as const, kindProvenance: 'ast' as const };
    const g = groupOf.get(h.id);
    return g === undefined ? h : { ...h, kind: 'ripple' as const, kindProvenance: 'ast' as const, group: g };
  });

  const deviations = groups.reduce((a, g) => a + g.deviations.length, 0);
  const near = groups.reduce((a, g) => a + g.near.length, 0);
  info.push(`追従グループ ${groups.length}、差異あり ${deviations}、わずかな差異 ${near}`);
  for (const r of rules) {
    if ((NORMALIZE_RULES as readonly string[]).includes(r)) continue;
    info.push((DEFERRED_RULES as readonly string[]).includes(r) ? `normalize.kotlin の ${r} は未対応です` : `normalize.kotlin の ${r} は不明なルールです`);
  }
  return { hunks: result, groups, info, candidateIds: [...candidates.keys()] };
}

async function parseKotlinFiles(files: readonly ChangedFile[], hunks: readonly Hunk[]): Promise<Map<string, Trees>> {
  const wanted = new Set(hunks.filter((h) => h.lang === 'kotlin' && h.kind !== 'test' && h.symbolKind !== 'file').map((h) => h.path));
  const trees = new Map<string, Trees>();
  for (const f of files) {
    if (!wanted.has(f.path)) continue;
    trees.set(f.path, { old: await parseKotlin(f.before ?? ''), new: await parseKotlin(f.after ?? '') });
  }
  return trees;
}

function identifiers(tokens: readonly Token[], names: ReadonlySet<string>): Set<string> {
  return new Set(tokens.filter((t) => t.type === 'identifier' && names.has(t.text)).map((t) => t.text));
}

function buildGroup(coreId: string, c: CoreCandidate, followers: Follower[]): RippleGroup {
  // 4. 最も多い形（同数なら先に出た形）
  const count = new Map<string, number>();
  for (const f of followers) {
    const k = f.shape.join(' ');
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  let best = '';
  let bestN = -1;
  for (const [k, n] of count) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  const members = followers.filter((f) => f.shape.join(' ') === best);
  const deviations = followers.filter((f) => f.shape.join(' ') !== best);
  const repShape = members[0]!.shape;
  const distance: Record<string, number> = {};
  const near: string[] = [];
  for (const d of deviations) {
    const dist = shapeDistance(repShape, d.shape);
    distance[d.hunk.id] = dist;
    if (dist <= NEAR_THRESHOLD) near.push(d.hunk.id);
  }
  // 7. パターン: 実際に参照された名前だけ
  const usedR = new Set(followers.flatMap((f) => [...f.removedRefs]));
  const usedA = new Set(followers.flatMap((f) => [...f.addedRefs]));
  const label = (n: CandidateName): string => (n.kind === 'function' || n.kind === 'constructor' ? `${n.name}()` : n.name);
  const r = c.removed.filter((n) => usedR.has(n.name)).map(label);
  const a = c.added.filter((n) => usedA.has(n.name)).map(label);
  return {
    pattern: r.length === 0 ? `+${a.join(', ')}` : `${r.join(', ')} → ${a.join(', ')}`,
    derivedFrom: { coreHunkId: coreId, removed: c.removed.map((n) => n.name), added: c.added.map((n) => n.name) },
    uniform: 'ast',
    representative: members[0]!.hunk.id,
    members: members.map((f) => f.hunk.id),
    deviations: deviations.map((f) => f.hunk.id),
    distance,
    near,
  };
}
