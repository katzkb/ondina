// 読む前の案内と、停留所の右の列の確かめること（設計書 3.3。2026-10-22。見本を比べて案 1「まず水先案内、それを確かめるようにコードを追う」にした）。
// 確かめることの文と場所は 2 回目の LLM（Tour.checks。場所は core が確かめた物だけ）。見た印・PR の流れ・知っておくことはプログラムが Analysis から組む（原則 3）。
// 事実の文に判断の語は入れない（原則 1）。差分の無い相手は数えない（差分だけを回る。2026-10-11）
import type { Analysis, Edge } from '@ondina/model';
import { OUTSIDE, type Course, type StopInfo } from './course.js';
import { shortName } from './map/graph.js';

/** 確かめることの根拠の場所 1 つ。k = 読む順の番号（0 始まり） */
export interface CheckAt {
  k: number;
  symbolId: string;
  lines: number[];
  say?: string;
  /** 「execute 16 行」「テスト 18–19 行」 */
  label: string;
}

/** 確かめること 1 つ。n = 番号（1 始まり）。seen = 場所を全部「問題なし」にした */
export interface CourseCheck {
  n: number;
  text: string;
  at: CheckAt[];
  seen: boolean;
}

/** 場所の短い呼び名（チップと上の帯）。テストは「テスト」、ファイル単位はファイル名、ほかは名前の最後 */
export function placeLabel(info: Pick<StopInfo, 'name' | 'test' | 'file'>): string {
  if (info.test) return 'テスト';
  if (info.file) return info.name;
  return info.name.split('.').pop() ?? info.name;
}

/** 行番号の書き方。続いていれば「18–19」、離れていれば「16, 20」 */
export function lineLabel(lines: readonly number[]): string {
  const runs: Array<[number, number]> = [];
  for (const l of lines) {
    const last = runs.at(-1);
    if (last && l === last[1] + 1) last[1] = l;
    else runs.push([l, l]);
  }
  return runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join(', ');
}

/** このコースの確かめること。古い解析・LLM の無い解析は空。停留所に無い場所は落とす（コースの停留所は古い解析で減ることがある） */
export function courseChecks(analysis: Analysis, course: Course, infos: readonly StopInfo[]): CourseCheck[] {
  const tour = analysis.tours.find((t) => t.howId === course.id);
  const kOf = new Map(course.steps.map((s, k) => [s.symbolId, k]));
  return (tour?.checks ?? []).flatMap((c) => {
    const at = c.at.flatMap((a): CheckAt[] => {
      const k = kOf.get(a.symbolId);
      if (k === undefined) return [];
      return [{ k, symbolId: a.symbolId, lines: a.lines, ...(a.say === undefined ? {} : { say: a.say }), label: `${placeLabel(infos[k]!)} ${lineLabel(a.lines)} 行` }];
    });
    return at.length === 0 ? [] : [{ text: c.text, at }];
  }).map((c, i) => ({ n: i + 1, ...c, seen: c.at.every((a) => infos[a.k]!.seen) }));
}

/** PR の流れの中でのこのコース: このコースを呼ぶコースと、このコースが呼ぶコース（call の辺の両端の差分のコースが違うもの）。id 順 */
export function courseFlow(analysis: Analysis, course: Course): { callers: number[]; callees: number[] } {
  const mine = new Set(course.hunkIds);
  const hunkOf = new Map(analysis.symbols.filter((s) => s.hunkId !== undefined).map((s) => [s.id, s.hunkId!]));
  const hows = new Map(analysis.hunks.map((h) => [h.id, h.hows]));
  const callers = new Set<number>();
  const callees = new Set<number>();
  for (const e of analysis.edges) {
    if (e.kind !== 'call') continue;
    const from = hunkOf.get(e.from);
    const to = hunkOf.get(e.to);
    if (from === undefined || to === undefined) continue;
    if (mine.has(from) && !mine.has(to)) for (const id of hows.get(to) ?? []) callees.add(id);
    if (mine.has(to) && !mine.has(from)) for (const id of hows.get(from) ?? []) callers.add(id);
  }
  const ids = (xs: Set<number>) => [...xs].filter((id) => id !== course.id && id !== OUTSIDE).sort((a, b) => a - b);
  return { callers: ids(callers), callees: ids(callees) };
}

/** ほかのコースの差分（このコースに無い差分）がこのコースの停留所を呼んでいる。呼ぶ側 1 つに 1 件。calls は呼んでいる行の順 */
export interface CallerFact {
  callerId: string;
  /** 呼ぶ側の差分の最初のコース。どのコースにも入っていなければ null */
  course: number | null;
  name: string;
  calls: Array<{ k: number; line?: number }>;
  /** 「コース 6 の OrderController.apply が、18 行で execute、19 行で save を呼びます。」 */
  text: string;
}

export function callerFacts(analysis: Analysis, course: Course, infos: readonly StopInfo[]): CallerFact[] {
  const kOf = new Map(course.steps.map((s, k) => [s.symbolId, k]));
  const mine = new Set(course.hunkIds);
  const symbolOf = new Map(analysis.symbols.map((s) => [s.id, s]));
  const hows = new Map(analysis.hunks.map((h) => [h.id, h.hows]));
  const byCaller = new Map<string, Array<{ k: number; line?: number }>>();
  for (const e of analysis.edges) {
    const k = e.kind === 'call' ? kOf.get(e.to) : undefined;
    const from = symbolOf.get(e.from);
    if (k === undefined || from?.hunkId === undefined || kOf.has(from.id) || mine.has(from.hunkId)) continue;
    const line = e.lines?.[0];
    byCaller.set(from.id, [...(byCaller.get(from.id) ?? []), { k, ...(line === undefined ? {} : { line }) }]);
  }
  return [...byCaller.entries()]
    .map(([callerId, calls]): CallerFact => {
      const s = symbolOf.get(callerId)!;
      const c = hows.get(s.hunkId!)?.[0] ?? null;
      const name = shortName(s.fqName, s.path, s.kind);
      const sorted = [...calls].sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER) || a.k - b.k);
      const parts = sorted.map((x) => `${x.line === undefined ? '' : `${x.line} 行で `}${placeLabel(infos[x.k]!)}`);
      return { callerId, course: c, name, calls: sorted, text: `${c === null ? 'コース外の' : `コース ${c} の`} ${name} が、${parts.join('、')} を呼びます。` };
    })
    .sort((a, b) => (a.course ?? Number.MAX_SAFE_INTEGER) - (b.course ?? Number.MAX_SAFE_INTEGER) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** このコースに対応する要求（Spec.hows。LLM が選んだ物。10.8） */
export function courseSpecs(analysis: Analysis, course: Course): string[] {
  return analysis.specs.filter((s) => s.hows.includes(course.id)).map((s) => s.text);
}

/** 停留所を呼んでいる辺（経路で呼ばれ方を付けた辺。step.call の呼ぶ側の名前で引く）。始点と辺に乗らない停留所は null */
export function callEdge(analysis: Analysis, info: Pick<StopInfo, 'step'>): Edge | null {
  if (!info.step.call) return null;
  const caller = info.step.call.split(' → ')[0]!;
  const symbolOf = new Map(analysis.symbols.map((s) => [s.id, s]));
  return (
    analysis.edges.find((e) => {
      if (e.kind !== 'call' || e.to !== info.step.symbolId) return false;
      const s = symbolOf.get(e.from);
      return s !== undefined && shortName(s.fqName, s.path, s.kind) === caller;
    }) ?? null
  );
}

/** 「次は X」の右の一言: 呼ばれ方（execute の 16 行から）・テスト・ファイルの先頭 */
export function nextReason(analysis: Analysis, info: StopInfo): string {
  if (info.test) return 'このコースのテスト';
  if (info.file) return 'ファイルの先頭（import など）';
  const e = callEdge(analysis, info);
  if (e === null) return '';
  const caller = info.step.call.split(' → ')[0]!.split('.').pop()!;
  return e.lines?.[0] === undefined ? `${caller} から` : `${caller} の ${e.lines[0]} 行から`;
}
