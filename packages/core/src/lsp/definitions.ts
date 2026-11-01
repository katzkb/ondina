// 名前から定義へ移る（設計書 3.6 / 9.2。2026-10-29）。言語サーバーの textDocument/definition の答えを Analysis.defs にする。
//
// 画面から後で聞くと、serve の言語サーバーは別の PR の中身に切り替わっていることがあるので、解析のときに聞いておく（原則 5・7）。
// 聞く名前は 2 段: 画面に出る行の名前と、その行き先のうち差分の列に無いファイル全体の名前（引き出しで続けて移るため）。
// 画面に出る行は、head は全文（コースと目的ごとの画面はファイル全体を出す。差分の無いシンボルのファイルも）、base は差分の行（2026-10-29 に広げた）。
// 2 段目の行き先のファイルは全文だけ入れ、名前は聞かない（画面は「このファイルの名前からは移動できません」と出す）。
// 2026-10-29 の実測（fixture、kotlin-lsp 263.6379.0）: 1 段目 1441 か所が 1.6 秒、2 段目 274 か所が 0.2 秒（差分の行だけだったときは 782 か所と 547 か所で 1.5 秒）。
// 移れる名前は 808 個（差分の行だけのときは 742 個）
import type { DefFile, DefTarget, Definitions, Hunk } from '../model.js';
import { decodeSemanticTokens, type SemanticLegend } from '../highlight/semantic.js';

export type DefSide = 'head' | 'base';

/** 聞く名前の位置。line は 0 始まり（LSP のまま） */
export interface NamePosition {
  line: number;
  col: number;
  len: number;
}

/** 名前でない意味トークン。聞かない */
const NOT_NAMES: ReadonlySet<string> = new Set(['keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator']);

/** 意味トークンのうち名前の位置。keep を渡せば、その行（0 始まり）だけ */
export function namePositions(data: readonly number[], legend: SemanticLegend, keep?: (line: number) => boolean): NamePosition[] {
  return decodeSemanticTokens(data, legend)
    .filter((t) => !NOT_NAMES.has(t.type) && (keep === undefined || keep(t.line)))
    .map((t) => ({ line: t.line, col: t.char, len: t.length }));
}

/** 答えの行き先。head / base の付け替えと差分の列の見え方（shown）を付ける前 */
export type RawDefTarget = { side: DefSide; path: string; line: number; col: number } | { lib: string };

/** 言語サーバーに聞いた 1 つの名前と、その答え（fixture に記録する形）。行は 1 始まり。to が null = 答えが無い */
export interface DefinitionAnswer {
  side: DefSide;
  path: string;
  line: number;
  col: number;
  len: number;
  to: RawDefTarget | null;
}

export interface DefinitionSource {
  /** 名前を聞いたファイル。part = 差分の行だけ聞いた（ファイルの残りの名前は聞いていない） */
  files: Array<{ side: DefSide; path: string; part?: true }>;
  answers: DefinitionAnswer[];
}

interface Position {
  line: number;
  character: number;
}

/**
 * definition の答え（Location / Location[] / LocationLink[]）の最初を行き先にする。roots はその側の worktree の file URL
 * （末尾の / 無し。実体のパスと違う書き方があれば両方）。どの root の下でもなければリポジトリの外
 */
export function defTargetOf(res: unknown, roots: Readonly<Record<DefSide, readonly string[]>>): RawDefTarget | null {
  const first = Array.isArray(res) ? res[0] : res;
  if (typeof first !== 'object' || first === null) return null;
  const link = first as { uri?: string; range?: { start: Position }; targetUri?: string; targetSelectionRange?: { start: Position } };
  const uri = link.targetUri ?? link.uri;
  const start = link.targetSelectionRange?.start ?? link.range?.start;
  if (uri === undefined || start === undefined) return null;
  for (const side of ['head', 'base'] as const) {
    const root = roots[side].find((r) => uri.startsWith(`${r}/`));
    if (root !== undefined) return { side, path: decodeURIComponent(uri.slice(root.length + 1)), line: start.line + 1, col: start.character };
  }
  return { lib: libName(uri) };
}

/**
 * リポジトリの外の行き先の名前。jar の中なら jar の名前（spring-web-6.2.0.jar）、JDK（jrt）ならモジュール名（java.base）、
 * ほかはファイル名
 */
export function libName(uri: string): string {
  const bang = uri.indexOf('!/');
  if (uri.startsWith('jrt:') && bang >= 0) return uri.slice(bang + 2).split('/')[0] ?? uri;
  const archive = bang >= 0 ? uri.slice(0, bang) : uri;
  return archive.split('/').pop() ?? archive;
}

/** 差分の列に出る行（hunk の行）。側ごと・path ごとの行番号（1 始まり）。変わらない行は両側に入る */
export function diffLines(hunks: readonly Hunk[]): Record<DefSide, Map<string, Set<number>>> {
  const out = { head: new Map<string, Set<number>>(), base: new Map<string, Set<number>>() };
  const add = (side: DefSide, path: string, line: number) => {
    const set = out[side].get(path) ?? new Set<number>();
    out[side].set(path, set.add(line));
  };
  for (const h of hunks) {
    let o = h.lnOld;
    let n = h.lnNew;
    for (const l of h.lines) {
      if (l[0] !== '+') add('base', h.path, o++);
      if (l[0] !== '-') add('head', h.path, n++);
    }
  }
  return out;
}

/** 差分の列に出る行なら、その見え方。消した行は LEFT と base の行番号、変わらない行と足した行は RIGHT と head の行番号 */
export function shownAt(hunks: readonly Hunk[], side: DefSide, path: string, line: number): { hunkId: string; side: 'LEFT' | 'RIGHT'; line: number } | undefined {
  for (const h of hunks) {
    if (h.path !== path) continue;
    let o = h.lnOld;
    let n = h.lnNew;
    for (const l of h.lines) {
      const c = l[0];
      if (c === '-') {
        if (side === 'base' && o === line) return { hunkId: h.id, side: 'LEFT', line: o };
        o++;
      } else if (c === '+') {
        if (side === 'head' && n === line) return { hunkId: h.id, side: 'RIGHT', line: n };
        n++;
      } else {
        if ((side === 'base' ? o : n) === line) return { hunkId: h.id, side: 'RIGHT', line: n };
        o++;
        n++;
      }
    }
  }
  return undefined;
}

/** base の行き先が PR で変わっていないファイルなら head の同じ場所（中身が同じ）。差分の列の見え方を付ける */
export function placeTarget(to: RawDefTarget, hunks: readonly Hunk[], changed: ReadonlySet<string>): DefTarget {
  if ('lib' in to) return to;
  const t = to.side === 'base' && !changed.has(to.path) ? { ...to, side: 'head' as const } : to;
  const shown = shownAt(hunks, t.side, t.path, t.line);
  return shown === undefined ? t : { ...t, shown };
}

const key = (side: DefSide, path: string) => `${side}\n${path}`;
const byPlace = (a: { side: DefSide; path: string }, b: { side: DefSide; path: string }) => (a.side === b.side ? (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) : a.side === 'head' ? -1 : 1);

/** 行き先のうち差分の列に無いファイル（引き出しに出すファイル）。side・path の順 */
export function drawerFiles(targets: readonly DefTarget[]): Array<{ side: DefSide; path: string }> {
  const out = new Map<string, { side: DefSide; path: string }>();
  for (const t of targets) if (!('lib' in t) && t.shown === undefined) out.set(key(t.side, t.path), { side: t.side, path: t.path });
  return [...out.values()].sort(byPlace);
}

/** 次に全体の名前を聞くファイル: 答えの行き先のうち差分の列に無いファイルで、まだ全体を聞いていないもの */
export function filesToAsk(src: DefinitionSource, hunks: readonly Hunk[], changed: ReadonlySet<string>): Array<{ side: DefSide; path: string }> {
  const whole = new Set(src.files.filter((f) => f.part !== true).map((f) => key(f.side, f.path)));
  const targets = src.answers.flatMap((a) => (a.to === null ? [] : [placeTarget(a.to, hunks, changed)]));
  return drawerFiles(targets).filter((f) => !whole.has(key(f.side, f.path)));
}

const same = (a: DefinitionAnswer, t: DefTarget) => !('lib' in t) && t.side === a.side && t.path === a.path && t.line === a.line && t.col === a.col;

/** 答えを Analysis.defs にする。答えの無い名前と、自分自身（宣言の名前）は除く。targets は出てきた順（名前は side・path・行・列の順） */
export function buildDefinitions(src: DefinitionSource, hunks: readonly Hunk[], changed: ReadonlySet<string>): Definitions {
  const targets: DefTarget[] = [];
  const index = new Map<string, number>();
  const files = new Map<string, Omit<DefFile, 'part'> & { part: boolean }>();
  for (const f of src.files) {
    const k = key(f.side, f.path);
    const had = files.get(k);
    files.set(k, { side: f.side, path: f.path, names: [], part: (had?.part ?? true) && f.part === true });
  }
  const answers = [...src.answers].sort((a, b) => byPlace(a, b) || a.line - b.line || a.col - b.col);
  for (const a of answers) {
    if (a.to === null) continue;
    const t = placeTarget(a.to, hunks, changed);
    if (same(a, t)) continue;
    const tk = JSON.stringify(t);
    let i = index.get(tk);
    if (i === undefined) {
      i = targets.push(t) - 1;
      index.set(tk, i);
    }
    const k = key(a.side, a.path);
    const f = files.get(k) ?? { side: a.side, path: a.path, names: [], part: true };
    files.set(k, f);
    const last = f.names[f.names.length - 1];
    if (last === undefined || last[0] !== a.line || last[1] !== a.col) f.names.push([a.line, a.col, a.len, i]);
  }
  return {
    targets,
    files: [...files.values()].sort(byPlace).map(({ part, ...f }) => (part ? { ...f, part: true as const } : f)),
  };
}
