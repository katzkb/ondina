// 案内人に聞く（設計書 3.10 / 10.5）の材料を、Analysis と「何について」から組む。決定的（原則 7）。
// - 差分・全文・抜粋の行には番号を付ける（h12 = head 側の 12 行目、b6 = base 側の 6 行目）。LLM はこの番号で行の場所を書き、検証は材料にある番号だけを採る
//   （2026-10-08 に測った: 番号の無い材料では、答えの行の場所が全部 null になった）
// - 束のメンバーは代表と逸脱だけ渡す（1 回目の LLM の入力と同じ絞り方）
// - ファイルを読ませないので、要る行は全部ここで入れる
import type { Analysis, AskEntry, AskLines, AskPlace, ExcerptBlock, Hunk, Symbol as OndinaSymbol, TokenLine } from '../model.js';
import type { AskInput, AskInputHunk, AskInputPlace, AskInputRelated, AskInputSelected, AskInputStop } from './types.js';

/** 周りの場所（呼ぶ・呼ばれる・テスト）の上限。大きなシンボルでもプロンプトが膨らみすぎないように */
const MAX_RELATED = 12;
/** 続けて聞くときに渡す前の問いの数 */
const MAX_HISTORY = 3;

const OUTSIDE = 0;

/** 差分の行に番号を付ける。変わらない行と足した行は head の番号、消した行は base の番号 */
export function hunkLines(h: Pick<Hunk, 'lnOld' | 'lnNew' | 'lines'>): string[] {
  let o = h.lnOld;
  let n = h.lnNew;
  return h.lines.map((l) => {
    const mark = l[0] ?? ' ';
    const text = l.slice(1);
    if (mark === '-') return `b${o++} - ${text}`;
    if (mark === '+') return `h${n++} + ${text}`;
    o++;
    return `h${n++}   ${text}`;
  });
}

/** head の全文に番号を付ける */
export function fileLines(tokens: readonly TokenLine[]): string[] {
  return tokens.map((t, i) => `h${i + 1}   ${t.map((x) => x[0]).join('')}`);
}

/** 抜粋（Symbol.excerpt）に番号を付ける。まとまりの間は ⋯ */
export function excerptLines(blocks: readonly ExcerptBlock[]): string[] {
  return blocks.flatMap((b, i) => [...(i === 0 ? [] : ['⋯']), ...b.lines.map((l, k) => `h${b.start + k}   ${l}`)]);
}

/**
 * 画面の並び（実物の画面の FileView と同じ）: head の全文を 1 行目から歩き、差分の所はその差分の行（消した行を含む）に替える。
 * 全文が無い（古い解析・消したファイル）ときは差分の行だけをつなぐ
 */
export function diffFileLines(tokens: readonly TokenLine[] | undefined, hunks: readonly Hunk[]): string[] {
  const sorted = [...hunks].sort((a, b) => a.lnNew - b.lnNew);
  if (!tokens) return sorted.flatMap((h) => hunkLines(h));
  const out: string[] = [];
  const text = (n: number) => (tokens[n - 1] ?? []).map((x) => x[0]).join('');
  let p = 1;
  for (const h of sorted) {
    while (p < h.lnNew && p <= tokens.length) out.push(`h${p}   ${text(p++)}`);
    out.push(...hunkLines(h));
    p = Math.max(p, h.lnNew + h.lines.filter((l) => l[0] !== '-').length);
  }
  while (p <= tokens.length) out.push(`h${p}   ${text(p++)}`);
  return out;
}

const tagOf = (at: AskLines['start']) => `${at.side === 'base' ? 'b' : 'h'}${at.line}`;

/** 選んだ行を画面の並びから切り出す。両端のどちらかが無ければ空 */
function selectedLines(listing: readonly string[], lines: AskLines): AskInputSelected {
  const from = tagOf(lines.start);
  const to = tagOf(lines.end);
  const i = listing.findIndex((l) => l.startsWith(`${from} `));
  const j = listing.findIndex((l) => l.startsWith(`${to} `));
  return { path: lines.path, from, to, lines: i < 0 || j < 0 ? [] : listing.slice(Math.min(i, j), Math.max(i, j) + 1) };
}


export function buildAskInput(analysis: Analysis, place: AskPlace, question: string, history: readonly AskEntry[] = []): AskInput {
  return {
    pr: { title: analysis.pr.title },
    courses: analysis.hows.map((w) => ({ id: w.id, title: w.title, why: w.why })),
    place: buildPlace(analysis, place),
    history: history.slice(-MAX_HISTORY).map((e) => ({ question: e.question, answer: [e.answer.lead, ...e.answer.items.map((i) => i.text), ...(e.answer.tail ? [e.answer.tail] : [])].join('\n') })),
    question,
  };
}

function buildPlace(analysis: Analysis, place: AskPlace): AskInputPlace {
  const hunkOf = new Map(analysis.hunks.map((h) => [h.id, h]));
  const symbolOf = new Map(analysis.symbols.map((s) => [s.id, s]));
  const hunkSymbol = new Map(analysis.symbols.flatMap((s) => (s.hunkId === undefined ? [] : [[s.hunkId, s] as const])));

  const inputHunk = (h: Hunk): AskInputHunk => {
    const g = h.group;
    const role = g === undefined ? undefined : g.representative === h.id ? 'representative' : g.deviations.includes(h.id) ? 'deviation' : 'member';
    return {
      symbol: h.symbolFqName,
      path: h.path,
      ...(h.kind === 'none' ? {} : { kind: h.kind }),
      ...(g === undefined || role === undefined ? {} : { group: { pattern: g.pattern, members: g.members.length, role } }),
      lines: hunkLines(h),
    };
  };
  /** 差分があればその行、無ければ抜粋の行 */
  const linesOf = (s: OndinaSymbol | undefined, hunk: Hunk | undefined): string[] => (hunk ? hunkLines(hunk) : s?.excerpt ? excerptLines(s.excerpt) : []);

  if (place.kind === 'pr') {
    const shown = analysis.hunks.filter((h) => h.group === undefined || h.group.representative === h.id || h.group.deviations.includes(h.id));
    const s = analysis.summary;
    const flow = (s.flows ?? []).flatMap((f) => f.nodes.map(({ title, before, after, untouched }) => ({ title, before, after, untouched })));
    return {
      kind: 'pr',
      ...(s.headline === undefined && flow.length === 0 ? {} : { summary: { headline: s.headline ?? '', flow } }),
      hunks: shown.map(inputHunk),
      unassigned: analysis.hunks.filter((h) => h.hows.length === 0).map((h) => h.symbolFqName),
    };
  }

  if (place.kind === 'course') {
    const how = analysis.hows.find((w) => w.id === place.courseId);
    const testFrom = new Set(analysis.edges.filter((e) => e.kind === 'test').map((e) => e.from));
    const steps =
      place.courseId === OUTSIDE
        ? analysis.hunks.filter((h) => h.hows.length === 0).map((h) => ({ symbolId: h.id, hunkId: h.id }))
        : (analysis.tours.find((t) => t.howId === place.courseId)?.steps ?? []);
    const stops = steps.map((step): AskInputStop => {
      const s = symbolOf.get(step.symbolId);
      const hunk = hunkOf.get(step.hunkId ?? s?.hunkId ?? '');
      return {
        symbol: s?.fqName ?? hunk?.symbolFqName ?? step.symbolId,
        path: s?.path ?? hunk?.path ?? '',
        changed: hunk !== undefined,
        test: hunk?.kind === 'test' || testFrom.has(step.symbolId),
        lines: linesOf(s, hunk),
      };
    });
    const course = place.courseId === OUTSIDE ? { id: OUTSIDE, title: 'コースに入っていない場所', why: 'どのコースにも属さない差分' } : { id: place.courseId, title: how?.title ?? '', why: how?.why ?? '' };
    return { kind: 'course', course, stops };
  }

  // コードの場所（シンボル・差分 1 つ・ファイル）
  const symbol = place.kind === 'symbol' ? symbolOf.get(place.symbolId) : place.kind === 'hunk' ? hunkSymbol.get(place.hunkId) : undefined;
  const focus = place.kind === 'hunk' ? hunkOf.get(place.hunkId) : symbol?.hunkId === undefined ? undefined : hunkOf.get(symbol.hunkId);
  const filePath = place.kind === 'file' ? place.path : (symbol?.path ?? focus?.path ?? '');
  const hunks = place.kind === 'file' ? analysis.hunks.filter((h) => h.path === filePath) : focus ? [focus] : [];
  const text = analysis.files?.find((f) => f.path === filePath);

  const related: AskInputRelated[] = [];
  if (symbol && place.kind !== 'file') {
    const rel = (relation: AskInputRelated['relation'], id: string) => {
      const s = symbolOf.get(id);
      if (!s) return;
      const hunk = s.hunkId === undefined ? undefined : hunkOf.get(s.hunkId);
      related.push({ relation, symbol: s.fqName, path: s.path, changed: hunk !== undefined, lines: linesOf(s, hunk) });
    };
    const seen = new Set<string>();
    const edges = (kind: 'call' | 'test' | 'reference', side: 'from' | 'to') => analysis.edges.filter((e) => e.kind === kind && e[side] === symbol.id).map((e) => (side === 'from' ? e.to : e.from));
    // 参照している所: 束のメンバーは代表と逸脱だけ。代表と逸脱を先に（上限で落とさない）
    const groupRole = (id: string) => {
      const h = hunkOf.get(symbolOf.get(id)?.hunkId ?? '');
      return h?.group === undefined ? 'none' : h.group.representative === h.id || h.group.deviations.includes(h.id) ? 'shown' : 'member';
    };
    const refs = edges('reference', 'to').filter((id) => groupRole(id) !== 'member');
    refs.sort((a, b) => Number(groupRole(b) === 'shown') - Number(groupRole(a) === 'shown'));
    for (const [relation, ids] of [
      ['calls', edges('call', 'from')],
      ['calledBy', edges('call', 'to')],
      ['testedBy', edges('test', 'to')],
      ['referencedBy', refs],
    ] as const) {
      for (const id of ids) {
        // 同じ相手は最初の関係だけ（呼んでいる所は参照もしている）
        if (seen.has(id)) continue;
        seen.add(id);
        rel(relation, id);
      }
    }
  }

  return {
    kind: 'code',
    about: place.kind === 'file' ? 'file' : place.kind === 'hunk' ? 'hunk' : 'symbol',
    path: filePath,
    ...(place.kind === 'file' ? {} : { symbol: symbol?.fqName ?? focus?.symbolFqName ?? '' }),
    changed: hunks.length > 0,
    courses: [...new Set(hunks.flatMap((h) => h.hows))].sort((a, b) => a - b),
    ...(text ? { file: fileLines(text.tokens) } : {}),
    hunks: hunks.map(inputHunk),
    related: related.slice(0, MAX_RELATED),
    ...(place.lines ? { selected: selectedLines(diffFileLines(analysis.files?.find((f) => f.path === place.lines!.path)?.tokens, analysis.hunks.filter((h) => h.path === place.lines!.path)), place.lines) } : {}),
  };
}
