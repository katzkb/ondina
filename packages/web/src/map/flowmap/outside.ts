// 流れの外の変更（見本 flow5 の ② の横）。どの流れの呼び出しにも乗らない差分を一覧にする。差分が責任の単位なので、全部の差分がどこかから辿れること。
// ファイルごとに 1 行。同じ書き換えの束（追従グループ）は 1 行にまとめる。テストは最後に 1 行
import type { Analysis, CallFlow, Hunk } from '@ondina/model';
import { allCalls } from './steps.js';
import { hunkDiff, type Diffness } from './boxes.js';

export interface OutsideItem {
  /** 押すと差分一覧で開く hunk（束なら代表） */
  hunkId: string;
  label: string;
  /** ファイルの中の差分のシンボル（束なら「同じ書き換え n か所」） */
  sub: string;
  diff: Diffness;
  courses: number[];
}

/** 流れに乗る hunk の id（呼ぶ側と呼ばれる側のシンボルの hunk） */
export function onFlows(analysis: Pick<Analysis, 'symbols'>, flows: readonly CallFlow[]): Set<string> {
  const sym = new Map(analysis.symbols.map((s) => [s.id, s]));
  const out = new Set<string>();
  for (const f of flows) {
    for (const c of allCalls(f)) {
      for (const id of [c.from, c.to]) {
        if (id === null) continue;
        const s = sym.get(id);
        out.add(s?.hunkId ?? id);
      }
    }
  }
  return out;
}

/**
 * 流れの外の変更。ファイルごとに 1 行（名前はファイルの中の差分のシンボル。シンボルの外の行だけなら、そう書く）。
 * 新しい = そのファイルの差分が全部足した行（流れに乗る差分も含めて見る）。同じ書き換えの束は 1 行、テストは数だけ
 */
export function outsideOf(analysis: Pick<Analysis, 'symbols' | 'hunks'>, flows: readonly CallFlow[]): { items: OutsideItem[]; tests: { n: number; hunkId: string | null } } {
  const on = onFlows(analysis, flows);
  const items: OutsideItem[] = [];
  const seenGroup = new Set<string>();
  const tests = { n: 0, hunkId: null as string | null };
  const byFile = new Map<string, Hunk[]>();
  for (const h of analysis.hunks) byFile.set(h.path, [...(byFile.get(h.path) ?? []), h]);
  const fileRow = new Map<string, OutsideItem & { names: string[] }>();
  for (const h of analysis.hunks) {
    if (on.has(h.id)) continue;
    if (h.kind === 'test') {
      tests.n++;
      tests.hunkId ??= h.id;
      continue;
    }
    const g = h.group;
    if (g && g.members.includes(h.id)) {
      if (seenGroup.has(g.representative)) continue;
      seenGroup.add(g.representative);
      const n = g.members.filter((m) => !on.has(m)).length;
      items.push({ hunkId: g.representative, label: g.pattern, sub: `同じ書き換え ${n} か所`, diff: 'changed', courses: h.hows });
      continue;
    }
    const file = h.path.split('/').pop() ?? h.path;
    let row = fileRow.get(h.path);
    if (!row) {
      const all = byFile.get(h.path)!.map(hunkDiff);
      const diff: Diffness = all.every((d) => d === 'added') ? 'added' : all.every((d) => d === 'removed') ? 'removed' : 'changed';
      row = { hunkId: h.id, label: file, sub: '', diff, courses: [], names: [] };
      fileRow.set(h.path, row);
      items.push(row);
    }
    if (h.symbolKind !== 'file') row.names.push(h.symbol);
    row.courses = [...new Set([...row.courses, ...h.hows])].sort((x, y) => x - y);
  }
  for (const row of fileRow.values()) {
    row.sub = row.names.length > 0 ? row.names.join('・') : row.diff === 'added' ? '新しいファイル' : row.diff === 'removed' ? '消したファイル' : 'シンボルの外の行（import など）';
    delete (row as { names?: string[] }).names;
  }
  return { items, tests };
}
