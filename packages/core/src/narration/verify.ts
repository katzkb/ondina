// 2 回目の LLM（文を書く）の出力の検証と、tours への重ね合わせ（Stage 3。設計書 5.4）。全部プログラムで決める（原則 3）。
// 捨てたものは info に 1 行ずつ（黙って直さない）。最後の行は埋まった数（書き漏らしが stderr で分かる。画面は「自動」の文で分かる）。
// 規則:
//   1. 知らない howId のコース、そのコースの停留所に無い symbolId の文は捨てる
//   2. 空・空白だけの文は無いものとして扱う（欄を付けない = 画面は事実から組んだ自動の文）。前後の空白は落とす
//   3. 同じコース・同じ停留所が 2 回来たら最初だけ。最初の文が空でも後の分は使わない（コースなら変わることも確かめることも停留所も丸ごと捨てる）。
//      1 回目の layerGuesses（同じパスは最初だけ。5.4 の 8）と同じ規則で、どちらが正しいかを LLM の出力の並び以外で選ばない
//   4. 経路（停留所の並び・呼ばれ方）は変えない。文を重ねるだけ
//   5. summary（2026-10-29）: 要点・例の文・箱の文は前後の空白を落とし、空なら欄を付けない。例の根拠の場所は確かめることと同じ規則（規則 6。
//      停留所はどのコースのものでもよい）で、残らなければ場所なし。図の箱のコースは実在するものだけ、1 つのコースは全部の図で最初の 1 回だけ。
//      コースが残らない箱・題が空の箱・箱が残らない図は捨てる。箱の下の名前はその箱のコースの停留所だけ。札は空の項目を捨てる。
//      入口の説明を 1 つでも書いていれば、最後の行に要点・例・図の数と、どの箱にも入らなかったコースを出す
//   6. 確かめること（2026-10-22）: 根拠の場所はそのコースの停留所だけ、行はその停留所の hunk の head 側（文脈か追加の行）にある番号だけ残す。
//      行が残らない場所・場所が残らない文・文が空の確かめることは捨てる。同じ文で同じ場所は最初だけ。場所は読む順に並べ直し、行は昇順・重複なし。
//      MAX_CHECKS 個を超えた分は捨てる（LLM の並びのまま前から）。LLM が書いた番号を画面で光らせるので、実在しない行を残さない
//   7. 背景（2026-10-29）: 前からあるものの名前は候補（入力の existing）にある物だけ。1 つの候補は最初の行だけ。削除と変更なしが混ざったら
//      最初の名前と同じ方だけ（チップの事実を 1 つにする）。同じ行で同じ名前は最初だけ。文が空の行・名前が残らない行は捨て、MAX_EXISTING 行まで。消えるかはプログラムが候補から付ける。
//      言葉は言葉が空なら捨てる。コードの名前は差分の行に出る識別子（後ろの () と、識別子を . で繋いだ物は認める）だけ。同じ名前は最初だけ、MAX_TERMS 個まで。
//      背景を 1 つでも書いていれば、最後の行に行数と候補の数・言葉の数を出す
import { headLines } from '../hunks/changed-lines.js';
import type { Background, ExistingItem, Flow, FlowNode, Hunk, Summary, Term, Tour, TourCheck } from '../model.js';
import type { NarrationInputExisting, NarrationOutput, NarrationOutputCheck } from './types.js';

export interface NarrationResult {
  tours: Tour[];
  summary: Summary;
  /** 背景の段の前からあるものと言葉（why は要求の抜き出しが別に出す） */
  background: Pick<Background, 'existing' | 'terms'>;
  info: string[];
}

/** 確かめることの上限（指示文は 2〜5 個） */
export const MAX_CHECKS = 5;
/** 前からあるものの行の上限（指示文は 1〜3 行。画面は層の行を足して 4 行まで） */
export const MAX_EXISTING = 3;
/** 言葉の上限（指示文は 2〜4 個。画面は 2 列のグリッド） */
export const MAX_TERMS = 4;

const clean = (s: string): string | undefined => {
  const t = s.trim();
  return t === '' ? undefined : t;
};

/** 確かめることの場所の行を確かめるのに使う hunk の欄 */
export type NarrationHunk = Pick<Hunk, 'id' | 'lnNew' | 'lines'>;

/** existing は前からあるものの候補（入力の existing）。hunks は言葉の名前を確かめる差分の行にも使う */
export function applyNarration(tours: readonly Tour[], output: NarrationOutput, hunks: readonly NarrationHunk[], existing: readonly NarrationInputExisting[] = []): NarrationResult {
  const info: string[] = [];
  const tourOf = new Map(tours.map((t) => [t.howId, t]));
  const headSide = new Map(hunks.map((h) => [h.id, new Set(headLines(h).filter((n): n is number => n !== null))]));
  const course = new Map<number, Pick<Tour, 'change' | 'checks'>>();
  const roles = new Map<string, string | undefined>();
  const key = (howId: number, symbolId: string) => `${howId}:${symbolId}`;

  for (const c of output.courses) {
    const tour = tourOf.get(c.howId);
    if (tour === undefined) {
      info.push(`不明なコースの文を除外しました: howId ${c.howId}`);
      continue;
    }
    if (course.has(c.howId)) {
      info.push(`コース ${c.howId} の文が 2 回来たので最初だけ使いました`);
      continue;
    }
    const stops = new Set(tour.steps.map((s) => s.symbolId));
    for (const s of c.stops) {
      if (!stops.has(s.symbolId)) {
        info.push(`コース ${c.howId} にない停留所の文を除外しました: ${s.symbolId}`);
        continue;
      }
      if (roles.has(key(c.howId, s.symbolId))) {
        info.push(`コース ${c.howId} の同じ停留所の文が 2 回来たので最初だけ使いました: ${s.symbolId}`);
        continue;
      }
      roles.set(key(c.howId, s.symbolId), clean(s.role));
    }
    const before = clean(c.change.before);
    const after = clean(c.change.after);
    const checks = verifyChecks(tour, c.checks, headSide, info);
    course.set(c.howId, {
      ...(before === undefined && after === undefined ? {} : { change: { ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) } }),
      ...(checks.length === 0 ? {} : { checks }),
    });
  }

  const out = tours.map((t): Tour => ({
    ...t,
    ...course.get(t.howId),
    steps: t.steps.map((s) => {
      const role = roles.get(key(t.howId, s.symbolId));
      return role === undefined ? { ...s } : { ...s, role };
    }),
  }));

  const steps = out.flatMap((t) => t.steps);
  const checks = out.flatMap((t) => t.checks ?? []);
  info.push(
    `案内文: 変わること ${out.filter((t) => t.change !== undefined).length} / ${out.length}、この場所 ${steps.filter((s) => s.role !== undefined).length} / ${steps.length}、確かめること ${checks.length}（場所 ${checks.reduce((n, c) => n + c.at.length, 0)}）`,
  );

  const summary = verifySummary(tours, output.summary, headSide, info);
  return { tours: out, summary, background: verifyBackground(output.background, existing, hunks, info), info };
}

/** 規則 7 */
function verifyBackground(b: NarrationOutput['background'], candidates: readonly NarrationInputExisting[], hunks: readonly NarrationHunk[], info: string[]): NarrationResult['background'] {
  const candidateOf = new Map(candidates.map((c) => [c.symbol, c]));
  const used = new Set<string>();
  const existing: ExistingItem[] = [];
  b.existing.forEach((e, k) => {
    const where = `前からあるもの ${k + 1}`;
    const text = clean(e.text);
    if (text === undefined) {
      info.push(`${where} は文が空なので除外しました`);
      return;
    }
    let removed: boolean | undefined;
    const names: ExistingItem['names'] = [];
    for (const name of e.symbols) {
      const c = candidateOf.get(name.trim());
      if (c === undefined) info.push(`${where} から候補にない名前を除外しました: ${name}`);
      else if (used.has(c.symbol)) info.push(`${where} の ${c.symbol} は前の行にあるので除外しました`);
      else if (names.some((n) => n.fqName === c.symbol)) info.push(`${where} の同じ名前が 2 回来たので最初だけ使いました: ${c.symbol}`);
      else if (removed !== undefined && c.removed !== removed) info.push(`${where} の ${c.symbol} は、削除と変更なしが混ざるので除外しました`);
      else {
        removed = c.removed;
        names.push({ fqName: c.symbol, path: c.path, kind: c.kind });
      }
    }
    if (removed === undefined) {
      info.push(`${where} は名前が残らないので除外しました`);
      return;
    }
    for (const n of names) used.add(n.fqName);
    existing.push({ names, text, removed });
  });
  if (existing.length > MAX_EXISTING) info.push(`前からあるものが ${existing.length} 行あったので最初の ${MAX_EXISTING} 行だけ使いました`);

  const identifiers = new Set(hunks.flatMap((h) => h.lines.flatMap((l) => l.slice(1).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])));
  const seen = new Set<string>();
  const terms: Term[] = [];
  b.terms.forEach((t, k) => {
    const where = `言葉 ${k + 1}`;
    const word = clean(t.word);
    const code = t.code.trim();
    const bare = code.replace(/\(\)$/, '');
    if (word === undefined) info.push(`${where} は言葉が空なので除外しました`);
    else if (!bare.split('.').every((x) => identifiers.has(x))) info.push(`${where} を除外しました（差分の行にない名前）: ${code}`);
    else if (seen.has(bare)) info.push(`${where} の ${bare} は前の言葉にあるので除外しました`);
    else {
      seen.add(bare);
      const meaning = clean(t.meaning);
      terms.push({ word, code, ...(meaning === undefined ? {} : { meaning }) });
    }
  });
  if (terms.length > MAX_TERMS) info.push(`言葉が ${terms.length} 個あったので最初の ${MAX_TERMS} 個だけ使いました`);

  const kept = { existing: existing.slice(0, MAX_EXISTING), terms: terms.slice(0, MAX_TERMS) };
  if (kept.existing.length > 0 || kept.terms.length > 0) info.push(`背景: 前からあるもの ${kept.existing.length} 行（候補 ${candidates.length}）、言葉 ${kept.terms.length} 個`);
  return { ...(kept.existing.length === 0 ? {} : { existing: kept.existing }), ...(kept.terms.length === 0 ? {} : { terms: kept.terms }) };
}

/** 規則 5 */
function verifySummary(tours: readonly Tour[], s: NarrationOutput['summary'], headSide: ReadonlyMap<string, ReadonlySet<number>>, info: string[]): Summary {
  const hunkOf = new Map(tours.flatMap((t) => t.steps.map((st) => [st.symbolId, st.hunkId] as const)));
  const headline = clean(s.headline);
  const text = clean(s.example.text);
  const at = s.example.at.flatMap((a) => {
    const hunkId = hunkOf.get(a.symbolId);
    const valid = hunkId === undefined ? undefined : headSide.get(hunkId);
    const lines = [...new Set(a.lines)].filter((l) => valid?.has(l) === true).sort((x, y) => x - y);
    if (lines.length === 0) {
      info.push(`例の根拠の場所を除外しました（停留所の差分にない）: ${a.symbolId} ${a.lines.join(', ')}`);
      return [];
    }
    return [{ symbolId: a.symbolId, lines }];
  });

  const stopsOf = new Map(tours.map((t) => [t.howId, new Set(t.steps.map((st) => st.symbolId))]));
  const placed = new Set<number>();
  const flows: Flow[] = [];
  s.flows.forEach((f, i) => {
    const nodes: FlowNode[] = [];
    f.nodes.forEach((n, k) => {
      const where = `図 ${i + 1} の箱 ${k + 1}`;
      const title = clean(n.title);
      const howIds = [...new Set(n.howIds)].filter((id) => {
        if (!stopsOf.has(id)) info.push(`${where} から不明なコースを除外しました: howId ${id}`);
        else if (placed.has(id)) info.push(`${where} のコース ${id} は前の箱にあるので除外しました`);
        else return true;
        return false;
      });
      if (title === undefined || howIds.length === 0) {
        info.push(title === undefined ? `${where} は題が空なので除外しました` : `${where} はコースが残らないので除外しました`);
        return;
      }
      for (const id of howIds) placed.add(id);
      const symbol = howIds.some((id) => stopsOf.get(id)!.has(n.symbolId)) ? n.symbolId : undefined;
      if (symbol === undefined && n.symbolId.trim() !== '') info.push(`${where} の名前を除外しました（箱のコースの停留所にない）: ${n.symbolId}`);
      const pass = clean(n.pass);
      nodes.push({ title, howIds, ...(symbol === undefined ? {} : { symbol }), before: n.before.trim(), after: n.after.trim(), untouched: n.untouched.flatMap((x) => clean(x) ?? []), ...(pass === undefined ? {} : { pass }) });
    });
    if (nodes.length > 0) flows.push({ nodes });
  });
  const missing = tours.map((t) => t.howId).filter((id) => !placed.has(id));
  if (s.headline.trim() !== '' || s.example.text.trim() !== '' || s.flows.length > 0)
    info.push(`入口の説明: 要点 ${headline === undefined ? 'なし' : 'あり'}、例 ${text === undefined ? 'なし' : `あり（場所 ${at.length}）`}、図 ${flows.length} 本（箱 ${flows.reduce((m, f) => m + f.nodes.length, 0)}${missing.length === 0 ? '' : `、図にないコース ${missing.join(', ')}`}）`);

  return {
    ...(headline === undefined ? {} : { headline }),
    ...(text === undefined ? {} : { example: { text, at } }),
    ...(flows.length === 0 ? {} : { flows }),
  };
}

/** 規則 6。info の番号は LLM の出力の並び（1 始まり） */
function verifyChecks(tour: Tour, checks: readonly NarrationOutputCheck[], headSide: ReadonlyMap<string, ReadonlySet<number>>, info: string[]): TourCheck[] {
  const order = new Map(tour.steps.map((s, k) => [s.symbolId, k]));
  const hunkOf = new Map(tour.steps.map((s) => [s.symbolId, s.hunkId]));
  const out: TourCheck[] = [];
  checks.forEach((c, j) => {
    const where = `コース ${tour.howId} の確かめること ${j + 1}`;
    const text = clean(c.text);
    if (text === undefined) {
      info.push(`${where} は文が空なので除外しました`);
      return;
    }
    const at = new Map<string, TourCheck['at'][number]>();
    for (const a of c.at) {
      if (!order.has(a.symbolId)) {
        info.push(`${where} の場所を除外しました（コースにない停留所）: ${a.symbolId}`);
        continue;
      }
      if (at.has(a.symbolId)) {
        info.push(`${where} の同じ場所が 2 回来たので最初だけ使いました: ${a.symbolId}`);
        continue;
      }
      const hunkId = hunkOf.get(a.symbolId);
      const valid = hunkId === undefined ? undefined : headSide.get(hunkId);
      const lines = [...new Set(a.lines)].sort((x, y) => x - y);
      const kept = lines.filter((l) => valid?.has(l) === true);
      if (kept.length < lines.length) info.push(`${where} の場所 ${a.symbolId} から差分にない行を除外しました: ${lines.filter((l) => !kept.includes(l)).join(', ')}`);
      if (kept.length === 0) {
        info.push(`${where} の場所 ${a.symbolId} は行が残らないので除外しました`);
        continue;
      }
      const say = clean(a.say);
      at.set(a.symbolId, { symbolId: a.symbolId, lines: kept, ...(say === undefined ? {} : { say }) });
    }
    if (at.size === 0) {
      info.push(`${where} は場所が残らないので除外しました`);
      return;
    }
    out.push({ text, at: [...at.values()].sort((x, y) => order.get(x.symbolId)! - order.get(y.symbolId)!) });
  });
  if (out.length > MAX_CHECKS) info.push(`コース ${tour.howId} の確かめることが ${out.length} 個あったので最初の ${MAX_CHECKS} 個だけ使いました`);
  return out.slice(0, MAX_CHECKS);
}
