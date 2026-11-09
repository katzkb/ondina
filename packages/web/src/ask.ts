// 案内人に聞く（設計書 3.10）。純粋関数だけ（画面と reducer が使う）。
// - 何について（AskPlace）は画面で決まる（2026-10-07。見本を比べて「どの画面でも聞ける」にした）
// - 候補は決まった形の問いを、場所の事実から選ぶ（2026-10-08。見本を比べて決めた。LLM に書かせない。原則 3）
// - 「+」で選んだ行があれば、その行について聞く（2026-10-08。見本を比べて決めた。決めごと 2）
// - ネットで調べた事実は脚注の番号と、答えの下の「調べたページ」（2026-10-15。見本を比べて決めた）
import type { Analysis, AskAnswer, AskCite, AskLines, AskPlace, GithubDiffFile, Hunk } from '@ondina/model';
import { courseOf, courses, OUTSIDE, stepPath } from './course.js';
import { hunkAt } from './files.js';
import { shortName } from './map/graph.js';
import { onGithubDiff, pickSpan, spanLabel, type MemoPick } from './memo.js';

/** askPlace が見る画面の状態（AppState の一部。reducer を import しない） */
export interface AskScreen {
  view: 'req' | 'prs' | 'home' | 'hows' | 'course' | 'diff' | 'closing';
  course: { id: number; i: number; screen: 'brief' | 'stop' | 'summary' } | null;
  selectedHunk: string | null;
  selectedFile: string | null;
}

/**
 * 今の画面の「何について」。入口・締め = PR 全体、読む前の案内・総括 = コース、停留所の画面 = 停留所、差分一覧 = 選んだ差分（無ければファイル）、目的ごと = 選んだ差分（無ければ PR 全体）。
 * 停留所の画面は覗いている間も停留所（2026-10-20。右の列はその停留所の案内と会話のまま）
 */
export function askPlace(analysis: Analysis, s: AskScreen): AskPlace {
  if (s.view === 'course' && s.course) {
    if (s.course.screen !== 'stop') return { kind: 'course', courseId: s.course.id };
    const step = courseOf(courses(analysis), s.course.id)?.steps[s.course.i];
    if (!step) return { kind: 'course', courseId: s.course.id };
    // コース外の停留所はシンボルではなく差分 1 つ（course.ts が hunk の id を symbolId に入れている）
    if (s.course.id === OUTSIDE) return { kind: 'hunk', hunkId: step.hunkId ?? step.symbolId };
    return { kind: 'symbol', symbolId: step.symbolId, courseId: s.course.id };
  }
  if (s.view === 'diff') return s.selectedHunk !== null ? { kind: 'hunk', hunkId: s.selectedHunk } : s.selectedFile !== null ? { kind: 'file', path: s.selectedFile } : { kind: 'pr' };
  if ((s.view === 'hows' || s.view === 'req') && s.selectedHunk !== null) return { kind: 'hunk', hunkId: s.selectedHunk };
  return { kind: 'pr' };
}

/** 選んでいる行（画面の LEFT / RIGHT）を聞く行の範囲にする。始まりと終わりは画面の上からの順 */
export function askLinesOf(pick: MemoPick): AskLines {
  const { start, end } = pickSpan(pick);
  const side = (s: 'LEFT' | 'RIGHT') => (s === 'LEFT' ? ('base' as const) : ('head' as const));
  return { path: pick.path, start: { side: side(start.side), line: start.line }, end: { side: side(end.side), line: end.line } };
}

/**
 * 選んでいる行についての「何について」。停留所の画面 = 今の場所に行を足す（覗いているほかのファイルの行は差分一覧と同じ）。
 * 差分一覧 = 両端が同じ差分ならその差分、またぐならファイル。行を選べない画面（入口・総括・締め・目的ごと）は null
 */
export function askLinesPlace(analysis: Analysis, s: AskScreen, pick: MemoPick): AskPlace | null {
  const lines = askLinesOf(pick);
  const stop = s.view === 'course' && s.course?.screen === 'stop' ? s.course : null;
  if (stop === null && s.view !== 'diff' && s.view !== 'req') return null;
  const step = stop === null ? undefined : courseOf(courses(analysis), stop.id)?.steps[stop.i];
  if (stop !== null && (!step || stepPath(analysis, step) === lines.path)) {
    const place = askPlace(analysis, s);
    return place.kind === 'symbol' || place.kind === 'hunk' ? { ...place, lines } : null;
  }
  const side = (x: AskLines['start']) => (x.side === 'base' ? ('LEFT' as const) : ('RIGHT' as const));
  const a = hunkAt(analysis.hunks, lines.path, lines.start.line, side(lines.start));
  const b = hunkAt(analysis.hunks, lines.path, lines.end.line, side(lines.end));
  return a && a === b ? { kind: 'hunk', hunkId: a.id, lines } : { kind: 'file', path: lines.path, lines };
}

const tagOf = (x: AskLines['start']) => `${x.side === 'base' ? 'b' : 'h'}${x.line}`;

/** 場所の鍵（会話を分ける単位）。同じシンボルはコースの有無にかかわらず同じ会話。選んだ行があれば行の範囲ごとに別の会話（#h8-h11） */
export function askKey(p: AskPlace): string {
  const lines = 'lines' in p && p.lines ? `#${tagOf(p.lines.start)}-${tagOf(p.lines.end)}` : '';
  switch (p.kind) {
    case 'pr':
      return 'pr';
    case 'course':
      return `course:${p.courseId}`;
    case 'symbol':
      return `symbol:${p.symbolId}${lines}`;
    case 'hunk':
      return `hunk:${p.hunkId}${lines}`;
    case 'file':
      return `file:${p.path}${lines}`;
  }
}

const fileName = (path: string): string => path.split('/').pop() ?? path;

/** 行の範囲の書き方（メモの見出しと同じ。spanLabel） */
export function linesLabel(lines: AskLines): string {
  const side = (x: AskLines['start']) => (x.side === 'base' ? ('LEFT' as const) : ('RIGHT' as const));
  const same = lines.start.side === lines.end.side && lines.start.line === lines.end.line;
  return spanLabel(same ? { line: lines.end.line, side: side(lines.end) } : { startLine: lines.start.line, startSide: side(lines.start), line: lines.end.line, side: side(lines.end) });
}

/** 引き出しの「何について」に出す名前。選んだ行があれば `Order.kt 8〜11 行目（domain.Order）` */
export function askTitle(analysis: Analysis, p: AskPlace): string {
  if ((p.kind === 'symbol' || p.kind === 'hunk' || p.kind === 'file') && p.lines) {
    const head = `${fileName(p.lines.path)} ${linesLabel(p.lines)}`;
    if (p.kind === 'file') return head;
    const s = p.kind === 'symbol' ? analysis.symbols.find((x) => x.id === p.symbolId) : undefined;
    const h = p.kind === 'hunk' ? analysis.hunks.find((x) => x.id === p.hunkId) : undefined;
    const name = s ? shortName(s.fqName, s.path, s.kind) : h ? shortName(h.symbolFqName, h.path, h.symbolKind) : null;
    return name === null ? head : `${head}（${name}）`;
  }
  switch (p.kind) {
    case 'pr':
      return 'PR 全体';
    case 'course': {
      const c = courseOf(courses(analysis), p.courseId);
      return p.courseId === OUTSIDE ? 'コースに入っていない場所' : `コース ${p.courseId} · ${c?.title ?? ''}`;
    }
    case 'symbol': {
      const s = analysis.symbols.find((x) => x.id === p.symbolId);
      const name = s ? shortName(s.fqName, s.path, s.kind) : p.symbolId;
      if (p.courseId === undefined) return name;
      const i = courseOf(courses(analysis), p.courseId)?.steps.findIndex((st) => st.symbolId === p.symbolId) ?? -1;
      return i < 0 ? name : `${name}（コース ${p.courseId} の ${i + 1} か所目）`;
    }
    case 'hunk': {
      const h = analysis.hunks.find((x) => x.id === p.hunkId);
      return h ? `${shortName(h.symbolFqName, h.path, h.symbolKind)}（${fileName(h.path)}）` : p.hunkId;
    }
    case 'file':
      return fileName(p.path);
  }
}

/**
 * 選んだ行に足した行か消した行があるか。消した行（base 側）を含めば変わった行。head の行だけなら、その間に足した行か消した行があるか
 * （消した行は、直前の head の行と次の head の行の間にある。画面の並びと同じ）
 */
export function linesChanged(hunks: readonly Hunk[], lines: AskLines): boolean {
  if (lines.start.side === 'base' || lines.end.side === 'base') return true;
  const s = lines.start.line;
  const e = lines.end.line;
  return hunks.some((h) => {
    if (h.path !== lines.path) return false;
    let p = h.lnNew;
    return h.lines.some((l) => {
      if (l[0] === '-') return p - 1 >= s && p <= e;
      const hit = l[0] === '+' && p >= s && p <= e;
      p++;
      return hit;
    });
  });
}

/** 決まった形の候補。場所の事実から当てはまる物だけ（呼んでいる所が無い場所には「ここを呼んでいる所は？」を出さない） */
export function askSuggestions(analysis: Analysis, p: AskPlace): string[] {
  // 選んだ行: 行の範囲では呼ぶ側・テストの辺が分からないので、変わったかどうかだけで選ぶ
  if ((p.kind === 'symbol' || p.kind === 'hunk' || p.kind === 'file') && p.lines) {
    return linesChanged(analysis.hunks, p.lines) ? ['変更前はどう動いていた？', 'ここは何をしている？'] : ['ここは何をしている？'];
  }
  switch (p.kind) {
    case 'pr': {
      const outside = analysis.hunks.filter((h) => h.hows.length === 0).length;
      return ['振る舞いが変わる所は？', '振る舞いが変わらない所は？', ...(outside > 0 ? [`コースに入っていない ${outside} か所は何？`] : [])];
    }
    case 'course':
      return p.courseId === OUTSIDE ? ['それぞれの場所で何が変わった？'] : ['このコースで振る舞いが変わる所は？', 'このコースはどこから始まる？'];
    case 'file':
      return ['このファイルで変わったことは？'];
    case 'hunk':
    case 'symbol': {
      const symbol = p.kind === 'symbol' ? analysis.symbols.find((s) => s.id === p.symbolId) : analysis.symbols.find((s) => s.hunkId === p.hunkId);
      const hunk = analysis.hunks.find((h) => h.id === (p.kind === 'hunk' ? p.hunkId : symbol?.hunkId));
      const id = symbol?.id;
      const test = hunk?.kind === 'test' || (id !== undefined && analysis.edges.some((e) => e.kind === 'test' && e.from === id));
      const deviation = hunk?.group !== undefined && hunk.group.deviations.includes(hunk.id);
      const callers = id !== undefined && analysis.edges.some((e) => e.kind === 'call' && e.to === id);
      const tested = id !== undefined && ((symbol?.testCount ?? 0) > 0 || analysis.edges.some((e) => e.kind === 'test' && e.to === id));
      const steps = p.kind === 'symbol' && p.courseId !== undefined ? (courseOf(courses(analysis), p.courseId)?.steps ?? []) : [];
      const at = steps.findIndex((st) => p.kind === 'symbol' && st.symbolId === p.symbolId);
      return [
        test ? '何を確かめている？' : hunk ? '変更前はどう動いていた？' : 'ここは何をしている？',
        ...(deviation ? ['同じ書き換えのほかの場所と何が違う？'] : []),
        ...(callers ? ['ここを呼んでいる所は？'] : []),
        ...(tested && !test ? ['どのテストが確かめている？'] : []),
        ...(at >= 0 && at < steps.length - 1 ? ['次の場所とどうつながる？'] : []),
      ];
    }
  }
}

/**
 * 答えに「メモにする」を出すか。メモは行に付く物なので、コードの場所（シンボル・差分・ファイル）の答えだけ（決めごと 2）。
 * 行について聞いた問いは、その行が GitHub の差分に出るときだけ（出ない行にはメモを書けない）
 */
export function canMemo(p: AskPlace, githubDiff: readonly GithubDiffFile[] | undefined): boolean {
  if (p.kind !== 'symbol' && p.kind !== 'hunk' && p.kind !== 'file') return false;
  if (!p.lines) return true;
  const side = (x: AskLines['start']) => (x.side === 'base' ? ('LEFT' as const) : ('RIGHT' as const));
  return onGithubDiff(githubDiff, { path: p.lines.path, startLine: p.lines.start.line, startSide: side(p.lines.start), line: p.lines.end.line, side: side(p.lines.end) }) !== false;
}

/** 答えの下の「調べたページ」の 1 行。n は脚注の番号、host はリンクに出す場所（URL から） */
export interface AskWebRef {
  n: number;
  url: string;
  title: string;
  host: string;
}

/** 調べたページ。URL が初めて出た順に 1 から番号を振り、同じ URL は 1 回だけ。題は同じ URL の項目で最初に空でない物 */
export function askWebRefs(answer: AskAnswer): AskWebRef[] {
  const refs: AskWebRef[] = [];
  for (const { web } of answer.items) {
    if (!web) continue;
    const title = web.title.trim();
    const seen = refs.find((r) => r.url === web.url);
    if (!seen) refs.push({ n: refs.length + 1, url: web.url, title, host: hostOf(web.url) });
    else if (seen.title === '') seen.title = title;
  }
  return refs;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 答えの行の場所の文字（青い下線のリンク） */
export function citeLabel(c: AskCite): string {
  const lines = c.endLine === undefined ? `${c.line}` : `${c.line}〜${c.endLine}`;
  return `${c.side === 'base' ? 'base 側 ' : ''}${fileName(c.path)} ${lines}`;
}
