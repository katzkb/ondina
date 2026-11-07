// コース（設計書 3.3）。How 1 本 = コース 1 本、停留所 = 読む順番（Analysis.tours）。どの How にも属さない差分はコース外（id 0）。
// 停留所は差分だけ（2026-10-11）。2026-10-11 より前の解析の tours に残る差分の無い停留所は落とす（差分の無い相手は「差分なしの関係」と引き出しで見る）。
// 案内の文は 2 回目の LLM（文を書く。設計書 5.3）が tours に書いた文（ai）。無い場所は事実から組む 1 行（自動。承認したデモの stopInfo と同じ規則）。
// 2026-10-22 からの解析はこの場所（role）と変わること（change）。何を変えたかの枠にこの場所、紹介に変わることの後を出す（読む前の案内の画面ができるまでのつなぎ）。
// 事実の文に判断の語は入れない（原則 1）。コース外は tours に無いので、いつも自動の文。
import type { Analysis, Hunk, ReviewState, Symbol as Sym, Tour } from '@ondina/model';
import type { CSSProperties } from 'react';
import { layerText, OUTSIDE_SCOPE, shortName, testsGuessed } from './map/graph.js';

export type Step = Tour['steps'][number];

/** コース外（どの How にも属さない差分）の id */
export const OUTSIDE = OUTSIDE_SCOPE;

/** 水先案内の文。ai = LLM の文（点線の枠と「AI」）、false = 事実から組んだ文（「自動」）。原則 2 */
export interface Narration {
  text: string;
  ai: boolean;
}

export interface Course {
  id: number;
  title: string;
  why: string;
  /** コースの紹介（2 回目の LLM の文）。無ければ自動の文 */
  intro?: string;
  steps: Step[];
  /** このコースの hunk（How に属す hunk。コース外は未帰属の hunk） */
  hunkIds: string[];
}

export type StopKind = '新規' | '変更' | '未変更';

export interface StopInfo {
  step: Step;
  symbol: Sym | undefined;
  hunk: Hunk | undefined;
  name: string;
  kind: StopKind;
  layer: string;
  /** テストの停留所（地図に出ない） */
  test: boolean;
  /** テストの見分けが推定（5.2 の 7）。「テスト」と「テスト n」に（推定）を付ける（原則 2） */
  testGuess: boolean;
  /** ファイル単位のシンボル（import など） */
  file: boolean;
  /** 停留所のファイル（stepPath）。左のファイルのツリーの行と、右のファイル表示の読む場所の束ね方に使う */
  path: string | null;
  /** 他のコースの差分を通るとき、その hunk の最初のコース */
  other: number | null;
  /** 問題なしを付けた（差分があれば viewed、無ければ course.done） */
  seen: boolean;
  /** なぜここか（停留所の画面の右の列。2026-10-11 までの案内の画面の 1 行） */
  guide: Narration;
  /** 何を変えたか（停留所の画面の右の列。たたむとコードの上） */
  say: Narration;
  /** 事実のチップ */
  facts: string[];
}

/**
 * コースの色（styles.css の --tone1〜7）。番号ではなくコースの並び順で割り当て、8 本目から繰り返す。
 * 番号で引くと、番号が 8 以上のコースに色が無く、番号が飛ぶと（1, 2, 9）7 本以下でも色が重なる（2026-10-30）。
 * App が画面の根元に --c<番号> を置き、丸は courseBg で引く（<style> の規則で付けると、jsdom の App のテストが 27 秒 → 48 秒になった）
 */
export function courseColorVars(ids: readonly number[]): CSSProperties {
  return Object.fromEntries(ids.map((id, i) => [`--c${id}`, `var(--tone${(i % 7) + 1})`]));
}

/** コースの丸の背景（コース外 0 は styles.css の --c0 = 赤） */
export const courseBg = (id: number): CSSProperties => ({ background: `var(--c${id})` });

export function courses(analysis: Analysis): Course[] {
  const unchanged = new Set(analysis.symbols.filter((s) => !s.changed).map((s) => s.id));
  const out: Course[] = analysis.hows.map((w) => {
    const tour = analysis.tours.find((t) => t.howId === w.id);
    // 2026-10-22 からの解析は変わることの後。読む前の案内の画面ができるまでのつなぎ
    const intro = tour?.intro ?? tour?.change?.after;
    return {
      id: w.id,
      title: w.title,
      why: w.why,
      ...(intro === undefined ? {} : { intro }),
      steps: (tour?.steps ?? []).filter((st) => st.hunkId !== undefined || !unchanged.has(st.symbolId)),
      hunkIds: analysis.hunks.filter((h) => h.hows.includes(w.id)).map((h) => h.id),
    };
  });
  const unassigned = analysis.hunks.filter((h) => h.hows.length === 0);
  if (unassigned.length > 0) {
    out.push({
      id: OUTSIDE,
      title: 'コースに入っていない場所',
      why: 'どのコースにも入らない差分です。作者に聞くか、別の PR に分けるかを考えるときに見ます',
      steps: unassigned.map((h) => ({ symbolId: h.id, hunkId: h.id, call: '' })),
      hunkIds: unassigned.map((h) => h.id),
    });
  }
  return out;
}

export function courseOf(all: readonly Course[], id: number): Course | undefined {
  return all.find((c) => c.id === id);
}

export const doneKey = (courseId: number, symbolId: string) => `${courseId}:${symbolId}`;

export function kindOf(hunk: Hunk | undefined): StopKind {
  if (!hunk) return '未変更';
  return hunk.lines.every((l) => l[0] === '+') ? '新規' : '変更';
}

export function plusMinus(hunk: Hunk): string {
  return `+${hunk.lines.filter((l) => l[0] === '+').length} −${hunk.lines.filter((l) => l[0] === '-').length}`;
}

/** テストのシンボル（test 辺の元か、テストの hunk）。地図と同じ判定 */
function isTest(analysis: Analysis, symbolId: string, hunk: Hunk | undefined): boolean {
  return hunk?.kind === 'test' || analysis.edges.some((e) => e.kind === 'test' && e.from === symbolId);
}

/** 停留所のファイル（差分があれば hunk の、無ければシンボルの path） */
const pathOf = (hunk: Hunk | undefined, symbol: Sym | undefined): string | null => hunk?.path ?? symbol?.path ?? null;

/** 停留所のファイル（pathOf。停留所の情報を組まずに求める） */
export function stepPath(analysis: Analysis, step: Step): string | null {
  const symbol = analysis.symbols.find((s) => s.id === step.symbolId);
  const hunkId = step.hunkId ?? symbol?.hunkId;
  return pathOf(analysis.hunks.find((h) => h.id === hunkId), symbol);
}

export function stopInfo(analysis: Analysis, course: Course, k: number, review: Pick<ReviewState, 'viewed' | 'course'>): StopInfo {
  const step = course.steps[k]!;
  const symbol = analysis.symbols.find((s) => s.id === step.symbolId);
  const hunkId = step.hunkId ?? symbol?.hunkId;
  const hunk = hunkId === undefined ? undefined : analysis.hunks.find((h) => h.id === hunkId);
  const name = symbol ? shortName(symbol.fqName, symbol.path, symbol.kind) : hunk ? shortName(hunk.symbolFqName, hunk.path, hunk.symbolKind) : step.symbolId.slice(0, 8);
  const kind = kindOf(hunk);
  const file = (symbol?.kind ?? hunk?.symbolKind) === 'file';
  const other = hunk && hunk.hows.length > 0 && !hunk.hows.includes(course.id) ? hunk.hows[0]! : null;
  const seen = hunk ? review.viewed.includes(hunk.id) : (review.course?.done.includes(doneKey(course.id, step.symbolId)) ?? false);
  const caller = step.call ? step.call.split(' → ')[0]! : null;
  const bits = [caller ? `${caller} から` : null, other !== null ? `コース ${other} の差分` : null, file ? 'ファイルの先頭（import など）' : null].filter((b): b is string => b !== null);
  const group = hunk?.group;
  const testGuess = testsGuessed(analysis);
  const facts = [
    kind,
    layerText(symbol),
    hunk ? plusMinus(hunk) : null,
    symbol?.testCount ? `テスト ${symbol.testCount}${testGuess ? '（推定）' : ''}` : null,
    symbol?.edgesMeasured === false ? '? 未取得' : null,
    file ? 'ファイル単位' : null,
    group && hunk ? (group.representative === hunk.id ? `追従 ${group.members.length} のサンプル` : group.deviations.includes(hunk.id) ? '差異あり' : `追従 ${group.members.length}`) : null,
  ].filter((f): f is string => f !== null);
  return {
    step,
    symbol,
    hunk,
    path: pathOf(hunk, symbol),
    name,
    kind,
    layer: layerText(symbol),
    test: isTest(analysis, step.symbolId, hunk),
    testGuess,
    file,
    other,
    seen,
    guide: narration(step.guide, bits.length > 0 ? bits.join(' · ') : `${kind}。`),
    say: narration(step.say ?? step.role, `${kind}${hunk ? ` ${plusMinus(hunk)}` : ''}${bits.length > 0 ? ` · ${bits.join(' · ')}` : ''}`),
    facts,
  };
}

/** LLM の文があればそれ（ai）、無い・空白だけなら事実から組んだ文（自動）。設計書 3.3 / 決定 2 */
function narration(llm: string | undefined, auto: string): Narration {
  return llm !== undefined && llm.trim() !== '' ? { text: llm, ai: true } : { text: auto, ai: false };
}

const period = (s: string) => (s.endsWith('。') ? s : `${s}。`);

/** コースの紹介（案内の最初の画面）。LLM の文。無ければ「なぜ」と停留所の数 */
export function courseIntro(course: Course): Narration {
  return narration(course.intro, course.id === OUTSIDE ? period(course.why) : `${period(course.why)}${course.steps.length} か所。`);
}

/**
 * 設定 autoCheckImports が on のとき、コースが止まらない停留所（package と import の行だけが変わった差分。2026-11-07）。
 * 停留所は並びに残り（問題なしで出る）、course.jump で押せば開く
 */
function importsStop(analysis: Analysis, step: Step): boolean {
  const hunkId = step.hunkId ?? analysis.symbols.find((s) => s.id === step.symbolId)?.hunkId;
  return hunkId !== undefined && analysis.hunks.some((h) => h.id === hunkId && h.importsOnly === true);
}

/** i の次に止まる停留所。skip が真なら import だけの差分を飛ばす。無ければ null（最後の停留所と同じ扱い） */
export function stopAfter(analysis: Analysis, course: Course, i: number, skip: boolean): number | null {
  for (let k = i + 1; k < course.steps.length; k++) if (!skip || !importsStop(analysis, course.steps[k]!)) return k;
  return null;
}

/** i の前に止まる停留所。skip が真なら import だけの差分を飛ばす。無ければ null */
export function stopBefore(analysis: Analysis, course: Course, i: number, skip: boolean): number | null {
  for (let k = i - 1; k >= 0; k--) if (!skip || !importsStop(analysis, course.steps[k]!)) return k;
  return null;
}

/** 入る位置: 最初の未確認の停留所。全部確認済みなら先頭（skip が真なら、最初に止まる停留所） */
export function firstUnseen(analysis: Analysis, course: Course, review: Pick<ReviewState, 'viewed' | 'course'>, skip = false): number {
  const stops = (k: number) => !skip || !importsStop(analysis, course.steps[k]!);
  const k = course.steps.findIndex((_, i) => stops(i) && !stopInfo(analysis, course, i, review).seen);
  if (k >= 0) return k;
  const first = course.steps.findIndex((_, i) => stops(i));
  return first < 0 ? 0 : first;
}

/** 完了にしていない最初のコース（コース外は数えない） */
export function nextCourse(all: readonly Course[], review: Pick<ReviewState, 'course'>): Course | null {
  const done = new Set(review.course?.completed ?? []);
  return all.find((c) => c.id !== OUTSIDE && !done.has(c.id)) ?? null;
}

export interface CourseRipple {
  pattern: string;
  /** 代表を含む件数 */
  size: number;
  representative: string;
  deviations: Array<{ hunkId: string }>;
  /** 代表以外のメンバー（代表と同じ形） */
  rest: string[];
}

/** コースの hunk が触る追従の束の全部（総括の「同じ書き換え」。1 束 1 箱）。代表の id 順（決定的） */
export function courseRipples(analysis: Analysis, course: Course): CourseRipple[] {
  const ids = new Set(course.hunkIds);
  const groups = new Map<string, NonNullable<Hunk['group']>>();
  for (const h of analysis.hunks) if (ids.has(h.id) && h.group && !groups.has(h.group.representative)) groups.set(h.group.representative, h.group);
  return [...groups.values()]
    .sort((x, y) => (x.representative < y.representative ? -1 : x.representative > y.representative ? 1 : 0))
    .map((g) => ({
      pattern: g.pattern,
      size: g.members.length,
      representative: g.representative,
      deviations: g.deviations.map((d) => ({ hunkId: d })),
      rest: g.members.filter((m) => m !== g.representative),
    }));
}
