// LLM 出力の検証（Stage 3。設計書 5.4）。全部プログラムで決める（原則 3）。捨てたものは info に 1 行ずつ（黙って直さない）。
// 規則（2026-09-17 の計画）:
//   1. 知らない hunk id / 束 id は捨てる。空になった How も捨てる
//   2. How の id は 1 以上の整数で重複が無ければそのまま。重複・欠け・不正は出てきた順に 1 から振り直す。並びは LLM の順（辺での並べ替えは M2）
//   3. hunk.hows は How 側の hunkIds / groupIds から計算する。束は代表・メンバー・逸脱の全員へ。未帰属・絡みは数えるだけ
//   4. How に入った none は core（kindProvenance 'llm'）。他の kind は変えない
//   5. LLM が入れなかったファイル hunk は、同じファイルの他の hunk が全部同じ hows ならそれを引き継ぐ
//   6. claims[].text は pr.body にそのまま含まれる文だけ残す（改変検知）
// summary（入口の説明）は 2 回目の呼び出し（narration/）が書く
import type { Claim, How, Hunk, RippleGroup } from '../model.js';
import type { LlmInput, LlmOutput } from './types.js';

export interface LabelResult {
  hunks: Hunk[];
  hows: How[];
  claims: Claim[];
  /** 捨てたもの・振り直し・要約（最後の行が `How n、未帰属 n、絡み n`） */
  info: string[];
}

export function applyLlmOutput(hunks: readonly Hunk[], groups: readonly RippleGroup[], input: LlmInput, output: LlmOutput): LabelResult {
  const info: string[] = [];
  const known = new Set(hunks.map((h) => h.id));
  // 入力の束（g1 …）と groups は代表の hunk id で対応付ける（配列の位置に頼らない）
  const byRepresentative = new Map(groups.map((g) => [g.representative, [...g.members, ...g.deviations]]));
  const groupMembers = new Map(input.rippleGroups.map((g) => [g.id, byRepresentative.get(g.representative.hunkId) ?? []]));

  // 1. 知らない id を捨て、空になった How を捨てる
  const kept = output.hows.flatMap((h) => {
    const hunkIds = h.hunkIds.filter((id) => known.has(id) || (info.push(`不明な hunk id を除外しました: ${id}`), false));
    const groupIds = h.groupIds.filter((id) => groupMembers.has(id) || (info.push(`不明な束 id を除外しました: ${id}`), false));
    if (hunkIds.length === 0 && groupIds.length === 0) {
      info.push(`空になった How を除外しました: ${h.title}`);
      return [];
    }
    return [{ ...h, hunkIds, groupIds }];
  });

  // 2. id
  const ids = kept.map((h) => h.id);
  const valid = ids.every((id): id is number => id !== undefined && id >= 1) && new Set(ids).size === ids.length;
  if (!valid && kept.length > 0) info.push('How の id を振り直しました（重複か欠け）');
  const hows: How[] = kept.map((h, i) => ({ id: valid ? h.id! : i + 1, title: h.title, why: h.why, specIds: [] }));

  // 3. hunk.hows
  const assigned = new Map<string, Set<number>>();
  const add = (hunkId: string, howId: number) => {
    const s = assigned.get(hunkId) ?? new Set<number>();
    s.add(howId);
    assigned.set(hunkId, s);
  };
  kept.forEach((h, i) => {
    const howId = hows[i]!.id;
    for (const id of h.hunkIds) add(id, howId);
    for (const g of h.groupIds) for (const id of groupMembers.get(g)!) add(id, howId);
  });

  // 5. ファイル hunk の引き継ぎ
  // 前提: 1 ファイルに symbolKind 'file' の hunk は高々 1 つ（extract.ts が宣言の外側の変更を 1 hunk にまとめる）。
  // 複数になると、先に引き継いだファイル hunk が後のファイル hunk の「同じファイルの他の hunk」に数えられ、hunk の順に依存する
  const byPath = new Map<string, Hunk[]>();
  for (const h of hunks) byPath.set(h.path, [...(byPath.get(h.path) ?? []), h]);
  for (const h of hunks) {
    if (h.symbolKind !== 'file' || assigned.has(h.id)) continue;
    const siblings = byPath.get(h.path)!.filter((s) => s.id !== h.id);
    if (siblings.length === 0) continue;
    const first = key(assigned.get(siblings[0]!.id));
    if (first === '' || siblings.some((s) => key(assigned.get(s.id)) !== first)) continue;
    assigned.set(h.id, new Set(assigned.get(siblings[0]!.id)));
  }

  // 3 の書き込みと 4
  const out = hunks.map((h): Hunk => {
    const hs = [...(assigned.get(h.id) ?? [])].sort((a, b) => a - b);
    const kind = hs.length > 0 && h.kind === 'none' ? { kind: 'core' as const, kindProvenance: 'llm' as const } : {};
    return { ...h, hows: hs, ...kind };
  });

  // 6. claims
  const claims: Claim[] = input.pr.body === '' ? [] : output.claims.filter((c) => input.pr.body.includes(c.text) || (info.push(`本文にない主張を除外しました: ${c.text}`), false));

  const unassigned = out.filter((h) => h.hows.length === 0).length;
  const tangled = out.filter((h) => h.hows.length >= 2).length;
  info.push(`How ${hows.length}、未帰属 ${unassigned}、絡み ${tangled}`);
  return { hunks: out, hows, claims, info };
}

const key = (s: Set<number> | undefined): string => (s === undefined ? '' : [...s].sort((a, b) => a - b).join(','));
