// コース（設計書 3.3）。How 1 本を 1 本のコースとして案内する: 停留所 → 停留所 → … → 総括。承認したデモ（2026-09-29、版 11）が画面の正。
// 停留所は 1 か所 1 画面（2026-10-12。動く見本を比べて決めた。それまでは 案内 → 実物 の 2 画面）。
// 案内の文は 2 回目の LLM の文（点線と「AI」）、無い場所は事実から組む 1 行（「自動」。course.ts）。事実はチップ（原則 3）。「問題なし」は見たの印で、承認ではない（原則 8）。
// 状態と移動は reducer。ここは描くだけで、押したものは全部コマンドにする（原則 6）。
// メモの印（2026-10-06。見本を比べて決めた）: 上の丸の右肩と停留所の画面の左のファイルの行に「メモ n」（そのファイルの場所の合計）、総括に数・行の「メモ n」・「このコースのメモ」。
// メモは行が見える最初の停留所に 1 回だけ数える（memo.ts の courseMemos）。
// AI の下書きの印（2026-10-13。見本を比べて「メモと分けて数える」にした）: まだ採用も破棄もしていない下書きを、上の丸の左肩（点線）・左のファイルの行と総括の行の「AI n」・
// 総括の数に。総括に「このコースの AI の下書き」（状態を問わず全部）。置き場所はメモと同じ（memo.ts の courseDrafts）。
// 読む前の案内（2026-10-22。見本を比べて案 1「まず水先案内、それを確かめるようにコードを追う」にした）: コースに入るとまず読む前の案内（BriefBody）。
// 停留所の右の列に確かめること（ここにある文は明るく、根拠の行のチップ）、コードの根拠の行に文の番号の丸、上の帯に「読む前の案内」と確かめることのメーター。
import type { Analysis, CommentDraft, DiffMode, GithubDiffFile, Hunk, ReviewState, UiSettings } from '@ondina/model';
import { AskButton } from './AskButton.js';
import { Fragment, useMemo } from 'react';
import type { Command } from '../commands/commands.js';
import { courseBg, courseIntro, courseOf, courseRipples, courses, nextCourse, OUTSIDE, stopInfo, type Course, type CourseRipple, type StopInfo } from '../course.js';
import { DefLinks } from '../diff/DefLinks.js';
import { DiffList } from '../diff/DiffList.js';
import { FileView, type FilePlace, type LineMarks } from '../diff/FileView.js';
import { courseChecks, placeLabel, type CourseCheck } from '../brief.js';
import { BriefBody, BriefPill, CourseMeter, StopChecks, StopNotes, SummaryChecks } from './CourseChecks.js';
import { CourseMap } from '../map/CourseMap.js';
import { OffDiffChip } from './MemoBox.js';
import { Narr } from './Narr.js';
import type { ElkLike } from '../map/layout.js';
import { GROUP_PREFIX, layerText, mapNodeOf } from '../map/graph.js';
import { courseDrafts, courseMemos, isOpenDraft, spanLabel } from '../memo.js';
import { buildTree } from '../fileTree.js';
import { groupFiles } from '../files.js';
import { FileMarks } from './FileList.js';
import { FileTree, OpenAllIcon } from './FileTree.js';
import { StopColumn } from './StopColumn.js';
import { PaneHandle } from './PaneHandle.js';
import { paneStyle } from '../panes.js';
import { Key, useKey } from './Key.js';
import { ViewMark } from './ViewMark.js';
import { relItems, relLayers } from '../rel.js';
import { NO_MEMO, type AskUi, type CourseAt, type CourseMapSize, type FocusLine, type MemoUi, type Peek } from '../state/reducer.js';

export interface CourseViewProps {
  analysis: Analysis;
  review: ReviewState;
  /** 停留所の画面の左右 / 統合（設定の diffMode.c） */
  diffMode: DiffMode;
  course: CourseAt | null;
  /** 地図の重ね物（null = 閉じている） */
  courseMap: CourseMapSize | null;
  fullFile: boolean;
  /** 帯で開いた行（AppState.fold。path → 行の key。2026-10-13） */
  fold?: Readonly<Record<string, readonly string[]>>;
  /** 停留所の画面の右の列をたたんでいるか（B） */
  folded: boolean;
  /** 列の幅（ui.json の panes）。停留所の画面の左のツリーと右の水先案内 */
  panes?: UiSettings['panes'];
  peek: Peek | null;
  zoom: number;
  repoName: string | null;
  /** メモ（3.3）の選んでいる行・直している物。停留所の画面のコードに渡す */
  memo?: MemoUi;
  /** AI の下書きを直している途中の文（AppState.draftText） */
  draftText?: Readonly<Record<string, string>>;
  /** 案内人の答えの行の場所で来た行（3.10。光らせる）と、名前から定義へ（3.6）で移った行 */
  focusLine?: FocusLine | null;
  /** 名前から定義へ（3.6）の戻り先の数（AppState.defBack）。無い = 名前から移れない解析（コード欄の帯に「← 戻る」を出さない） */
  defBack?: number | undefined;
  /** 左のファイルのツリーで閉じたフォルダ（AppState.treeShut.course） */
  treeShut?: readonly string[];
  /** 案内人に聞く（3.10）。停留所の画面の右の列が質問の欄 */
  ask: AskUi;
  dispatch: (c: Command) => void;
  /** 差し替えはテスト用（jsdom に Web Worker が無い） */
  elk?: () => ElkLike;
}

/** memos = 停留所ごとの自分のメモ、drafts = 停留所ごとの AI の下書き（総括の一覧）、open = 停留所ごとの、まだ決めていない AI の下書きの数（印）、checks = 確かめること */
type ScreenProps = Omit<CourseViewProps, 'course'> & { course: Course; infos: StopInfo[]; memos: CommentDraft[][]; drafts: CommentDraft[][]; open: number[]; checks: CourseCheck[] };

const label = (id: number) => (id === OUTSIDE ? '外' : String(id));
const courseName = (c: Course) => (c.id === OUTSIDE ? 'コース外' : `コース ${c.id}`);


function Chips({ items }: { items: readonly string[] }) {
  return (
    <div className="chips">
      {items.map((f) => (
        <span key={f} className="chip">
          {f}
        </span>
      ))}
    </div>
  );
}

function Dot({ info, k, cur }: { info: StopInfo; k: number; cur: boolean }) {
  return <span className={`dot${info.seen ? ' done' : cur ? ' cur' : ''}${info.test ? ' test' : ''}`}>{info.seen ? '✓' : k + 1}</span>;
}

/** 停留所のメモの数と、まだ決めていない AI の下書きの数のチップ。0 なら出さない（列は 1 つ取って行を揃える） */
function MarkChips({ memo, ai }: { memo: number; ai: number }) {
  return (
    <span className="mchips">
      {memo > 0 && <span className="chip mc">{`メモ ${memo}`}</span>}
      {ai > 0 && <span className="chip ai">{`AI ${ai}`}</span>}
    </span>
  );
}

export function CourseView(props: CourseViewProps) {
  const { analysis, review, course: at } = props;
  const all = useMemo(() => courses(analysis), [analysis]);
  const course = at ? courseOf(all, at.id) : undefined;
  // コースに入っていないときは入口（HomeView）が受け持つ
  if (!at || !course) return null;
  const infos = course.steps.map((_, k) => stopInfo(analysis, course, k, review));
  const memos = courseMemos(analysis, course, review.comments);
  const drafts = courseDrafts(analysis, course, review.comments);
  const open = drafts.map((list) => list.filter(isOpenDraft).length);
  const checks = courseChecks(analysis, course, infos);
  const screen = { course, infos, memos, drafts, open, checks };
  if (at.screen === 'summary') return <Summary {...props} {...screen} all={all} />;
  if (at.screen === 'brief') return <Brief {...props} {...screen} at={at} />;
  return <Stop {...props} {...screen} at={at} />;
}

/**
 * 停留所の画面の左のファイルのツリー（2026-10-20。動く見本を比べて「ア: ほかのコースは薄く」にした。2026-10-19 からはこのコースのファイルだけ。それまでは行程表）。
 * 差分の全ファイルを差分一覧と同じツリーで出し、ほかのコースのファイルの行と、このコースのファイルが中に無いフォルダは薄く。たたまない。
 * このコースのファイルの行（同じファイルの読む場所が何か所あっても 1 行）の右は読む場所の メモ n / AI n の合計と問題なしの印。押すとそのファイルでまだ問題なしにしていない最初の場所へ。
 * ほかのファイルの行の右は差分一覧と同じ（コースの丸・「外」・問題なしの印）。押すとそのファイルを覗く。覗いているファイルの行は青みの背景
 */
function CourseFiles({ analysis, review, course, infos, memos, open, i, peekPath, shut, dispatch }: { analysis: Analysis; review: ReviewState; course: Course; infos: StopInfo[]; memos: CommentDraft[][]; open: number[]; i: number; peekPath: string | null; shut: readonly string[]; dispatch: (c: Command) => void }) {
  const byPath = filePlaces(infos);
  const files = useMemo(() => groupFiles(analysis.hunks, review.viewed), [analysis, review.viewed]);
  const byFile = new Map(files.map((f) => [f.path, f]));
  const nodes = useMemo(() => buildTree(files.map((f) => f.path)), [files]);
  const sum = (ks: readonly number[], list: readonly number[]) => ks.reduce((n, k) => n + (list[k] ?? 0), 0);
  const memoN = memos.map((list) => list.length);
  const seenN = (ks: readonly number[]) => ks.filter((k) => infos[k]!.seen).length;
  const mine = (path: string) => byPath.has(path);
  return (
    <aside className="lt" aria-label="ファイル">
      <div className="hd">
        <b>ファイル</b>
        <span>{`${files.length} ファイル`}</span>
        <span className="sp">
          <button type="button" className="ib" title="すべて開く" aria-label="すべて開く" onClick={() => dispatch({ id: 'tree.openAll', tree: 'course' })}>
            <OpenAllIcon open />
          </button>
          <button type="button" className="ib" title="すべて閉じる" aria-label="すべて閉じる" onClick={() => dispatch({ id: 'tree.closeAll', tree: 'course' })}>
            <OpenAllIcon open={false} />
          </button>
        </span>
      </div>
      <div className="legend">
        <span className={`cb sm cc${course.id}`} style={courseBg(course.id)}>{label(course.id)}</span>
        このコースのファイル <b>{byPath.size}</b>
      </div>
      <FileTree
        nodes={nodes}
        tree="course"
        shut={shut}
        selected={peekPath ?? infos[i]?.path ?? null}
        dispatch={dispatch}
        rowClass={(row) => (row.kind === 'file' ? (row.path === peekPath ? 'peek' : mine(row.path) ? '' : 'oth') : row.files.some(mine) ? '' : 'oth')}
        onFile={(path) => {
          const ks = byPath.get(path);
          dispatch(ks ? { id: 'course.jump', i: ks.find((k) => !infos[k]!.seen) ?? ks[0]! } : { id: 'course.peekFile', path });
        }}
        fileMeta={(path) => {
          const ks = byPath.get(path);
          if (!ks) return <FileMarks file={byFile.get(path)!} github={false} />;
          return (
            <>
              <MarkChips memo={sum(ks, memoN)} ai={sum(ks, open)} />
              <ViewMark total={ks.length} viewed={seenN(ks)} github={false} />
            </>
          );
        }}
        dirMeta={(paths) => {
          const ks = paths.flatMap((p) => byPath.get(p) ?? []);
          if (ks.length > 0) return <ViewMark total={ks.length} viewed={seenN(ks)} github={false} />;
          const list = paths.flatMap((p) => byFile.get(p) ?? []);
          return <ViewMark total={list.reduce((n, f) => n + f.hunks.length, 0)} viewed={list.reduce((n, f) => n + f.viewedCount, 0)} github={false} />;
        }}
      />
    </aside>
  );
}

/** ファイル → そのファイルの停留所（読む順の番号 k）。ファイルの無い停留所は入れない */
function filePlaces(infos: readonly StopInfo[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  infos.forEach((info, k) => {
    if (info.path !== null) out.set(info.path, [...(out.get(info.path) ?? []), k]);
  });
  return out;
}

/** 地図の箱を押したとき: 停留所なら移る、束なら How 分解で開く、それ以外は覗く（「差分なし n か所」は CourseMap が差分の無い相手の引き出しを開く） */
function useNodeClick(analysis: Analysis, infos: StopInfo[], dispatch: (c: Command) => void) {
  const nodeOf = useMemo(() => mapNodeOf(analysis), [analysis]);
  return {
    nodeOf,
    onNode: (id: string) => {
      const k = infos.findIndex((info) => !info.test && nodeOf(info.step.symbolId) === id);
      if (k >= 0) dispatch({ id: 'course.jump', i: k });
      else if (id.startsWith(GROUP_PREFIX)) dispatch({ id: 'group.reveal', hunkId: id.slice(GROUP_PREFIX.length) });
      else dispatch({ id: 'map.peek', symbolId: id });
    },
  };
}

const REL_WORD = { in: '呼び出し元', out: '呼び出し先' } as const;

/**
 * 差分なしの関係（2026-10-11。見本 3 版を比べて決めた）: 今の停留所の差分の無い呼び出し元・呼び出し先の 1 行。
 * 3 か所以下は名前、多ければ層ごとの数（相手が多くても 1 行のまま）。押すと差分の無い相手の引き出しを、その相手か層で開く。相手がいなければ出さない
 */
function RelRow({ analysis, symbolId, dispatch }: { analysis: Analysis; symbolId: string; dispatch: (c: Command) => void }) {
  const host = mapNodeOf(analysis)(symbolId);
  const dirs = (['in', 'out'] as const).map((dir) => ({ dir, items: relItems(analysis, host, dir) })).filter((x) => x.items.length > 0);
  if (dirs.length === 0) return null;
  return (
    <div className="relrow" aria-label="差分なしの関係">
      <span className="lbl">差分なしの関係</span>
      {dirs.map(({ dir, items }, i) => (
        <Fragment key={dir}>
          {i > 0 && <span className="sep">|</span>}
          <span className="dir">{`${REL_WORD[dir]} ${items.length}`}</span>
          {items.length <= 3
            ? items.map((x) => (
                <button key={x.id} type="button" className="name" title={x.path} onClick={() => dispatch({ id: 'rel.open', host, dir, sel: x.id })}>
                  {x.name}
                </button>
              ))
            : relLayers(analysis, host, dir).map((l) => (
                <button key={l.layer} type="button" className="lchip" onClick={() => dispatch({ id: 'rel.open', host, dir, layer: l.layer })}>
                  {l.layer}
                  <b>{l.n}</b>
                </button>
              ))}
        </Fragment>
      ))}
      <span className="sp" />
      <button className="btn sm" type="button" onClick={() => dispatch({ id: 'rel.toggle' })}>
        右に出す <Key action="rel.toggle" />
      </button>
    </div>
  );
}

/** 上の帯（2026-10-22 から停留所の丸に名前。左に「読む前の案内」、右に確かめることと問題なしの数） */
function CourseBar({ course, infos, memos, open, at, checks, dispatch }: { course: Course; infos: StopInfo[]; memos: CommentDraft[][]; open: number[]; at: CourseAt; checks: readonly CourseCheck[]; dispatch: (c: Command) => void }) {
  const title = (name: string, k: number) => [name, (memos[k]?.length ?? 0) > 0 ? `メモ ${memos[k]!.length}` : null, (open[k] ?? 0) > 0 ? `AI の下書き ${open[k]}` : null].filter(Boolean).join(' · ');
  return (
    <div className="cbar">
      <span className={`cb cc${course.id}`} style={courseBg(course.id)}>{label(course.id)}</span>
      <b>{course.title}</b>
      {course.id !== OUTSIDE && <BriefPill cur={at.screen === 'brief'} dispatch={dispatch} />}
      <span className="crumbs">
        {infos.map((info, k) => (
          <button key={info.step.symbolId} type="button" className={`pill${k === at.i && at.screen === 'stop' ? ' cur' : ''}${info.test ? ' test' : ''}`} title={title(info.name, k)} data-step={info.step.symbolId} onClick={() => dispatch({ id: 'course.jump', i: k })}>
            <span className="dw">
              <Dot info={info} k={k} cur={k === at.i && at.screen === 'stop'} />
              {(memos[k]?.length ?? 0) > 0 && <span className="mn">{memos[k]!.length}</span>}
              {(open[k] ?? 0) > 0 && <span className="an">{open[k]}</span>}
            </span>
            <span className="pn">{placeLabel(info)}</span>
            {info.other !== null && <span className={`cb sm cc${info.other}`} style={courseBg(info.other)}>{info.other}</span>}
          </button>
        ))}
      </span>
      <CourseMeter checks={checks} infos={infos} />
      {/* 入口へ戻るのは上の帯の「全体図 Esc」 */}
    </div>
  );
}

/**
 * 地図の重ね物（2026-10-11。見本を比べて決めた）: 普段は右からの引き出し（M）、箱の多い PR では真ん中いっぱい（Shift+M・「大きく」）。
 * 大きさを替えても同じ要素のまま（地図を組み直さない）。外・「閉じる」・Esc で閉じる
 */
function MapLayer({ size, title, note, analysis, scope, current, peek, zoom, onNode, dispatch, elk }: { size: CourseMapSize; title: string; note: string; analysis: Analysis; scope: number; current: string | null; peek: string | null; zoom: number; onNode: (id: string) => void; dispatch: (c: Command) => void; elk?: (() => ElkLike) | undefined }) {
  const big = size === 'big';
  const actions = (
    <>
      <button className="btn sm" type="button" onClick={() => dispatch({ id: 'course.mapBig' })}>
        {big ? '元の大きさ' : '大きく'} <Key action="course.mapBig" />
      </button>
      <button className="btn sm" type="button" onClick={() => dispatch({ id: 'course.map' })}>
        閉じる <kbd>Esc</kbd>
      </button>
    </>
  );
  return (
    <>
      <div className="veil" onClick={() => dispatch({ id: 'course.map' })} />
      <div className={big ? 'mapbig' : 'drawer'} role={big ? 'dialog' : 'complementary'} aria-label="地図" aria-modal={big ? true : undefined}>
        <CourseMap analysis={analysis} scope={scope} current={current} peek={peek} zoom={zoom} title={title} note={note} actions={actions} onNode={onNode} dispatch={dispatch} {...(elk ? { elk } : {})} />
      </div>
    </>
  );
}

/**
 * 停留所の水先案内: なぜここか（info.guide）と何を変えたか（info.say）。同じ出どころ（両方 AI か両方自動）なら 1 つの枠で、なぜここかを先に薄く。
 * 違えば枠を 2 つ（原則 2: 推測と事実を 1 つの枠に混ぜない）。最初の停留所はコースの紹介を出すので、なぜここかは出さない（2026-10-11 までの案内の画面と同じ）
 */
function StopNarr({ info, first }: { info: StopInfo; first: boolean }) {
  // 2026-10-22 からの解析と LLM の無い解析: この場所（role か事実から組む 1 行）だけ。なぜここかは呼ばれ方のチップと「次は X」が受け持つ
  if (info.step.guide === undefined && info.step.say === undefined) return <div className="sn"><Narr {...info.say} label="この場所" /></div>;
  if (first) return <div className="sn"><Narr {...info.say} /></div>;
  if (info.guide.ai === info.say.ai) return <div className="sn"><Narr {...info.say} lead={info.guide.text} /></div>;
  return (
    <div className="sn">
      <Narr {...info.guide} />
      <Narr {...info.say} />
    </div>
  );
}

/**
 * 停留所の画面（2026-10-12。動く見本を比べて「1 か所 1 画面・たためる」にした。それまでは 案内 → 「見る」→ 実物 の 2 画面）。
 * 2026-10-20 から 3 列（動く見本を比べて決めた）: 左に差分の全ファイルのツリー、真ん中に見出しとコード（メモの「+」あり）、右に水先案内と質問をまとめた列（StopColumn）。
 * 右の列は i / N・何について・会話（最初の発言が水先案内: 最初の停留所はコースの紹介、名前・水先案内・事実のチップ）・「問題なし · 次へ」「前へ」・入力欄。
 * B か「たたむ」で右の列を細い帯（開くボタンと停留所の丸）にし、水先案内とチップはコードの上、ボタンはコードの下へ移す。
 * そのため、たたんでいる間は紹介・水先案内・チップ・「前へ」「問題なし · 次へ」が右の列（inert）とコードの上下の帯の 2 か所にある（intro / chips / okBtn / prevBtn を共用）。
 * 片方に物を足すときは、もう片方にも足す
 */
function Stop({ course, infos, memos, open, checks, at, analysis, review, diffMode, courseMap, fullFile, fold, folded, panes, peek, zoom, repoName, memo, draftText, focusLine, defBack, treeShut, ask, dispatch, elk }: ScreenProps & { at: CourseAt }) {
  const memoProps = { comments: review.comments, ui: memo ?? NO_MEMO, githubDiff: analysis.githubDiff, draftText: draftText ?? {} };
  const foldKey = useKey('course.fold');
  const calleeKey = useKey('jump.callee');
  const info = infos[at.i]!;
  const first = at.i === 0;
  const last = at.i === course.steps.length - 1;
  const { nodeOf, onNode } = useNodeClick(analysis, infos, dispatch);
  const peekSym = peek?.kind === 'symbol' ? analysis.symbols.find((s) => s.id === peek.symbolId) : undefined;
  const peekHunk = peekSym?.hunkId === undefined ? undefined : analysis.hunks.find((h) => h.id === peekSym.hunkId);
  const peekFile = peek?.kind === 'file' ? peek.path : null;
  const peekFileHunks = peekFile === null ? [] : analysis.hunks.filter((h) => h.path === peekFile);
  const peekPath = peekFile ?? (peekSym ? (peekHunk?.path ?? peekSym.path) : null);
  const next = infos[at.i + 1];
  const shownHunk = peekSym ? peekHunk : peekFile !== null ? peekFileHunks[0] : info.hunk;
  // このファイルにある、このコースの読む場所（右のファイル表示の番号の丸。2026-10-19）
  const places = (info.path === null ? [] : (filePlaces(infos).get(info.path) ?? [])).flatMap((k): FilePlace[] => {
    const x = infos[k]!;
    return x.hunk ? [{ hunkId: x.hunk.id, k, seen: x.seen, test: x.test, name: x.name }] : [];
  });
  // 読む前の案内のあるコースは紹介をそこに出す（コース外だけ最初の停留所に出す）
  const intro = first && course.id === OUTSIDE && (
    <div className="intro">
      <span className="where">{`${courseName(course)} · 出発`}</span>
      <Narr {...courseIntro(course)} />
    </div>
  );
  const chips = <Chips items={[...(!first && info.step.call ? [info.step.call] : []), ...info.facts]} />;
  const unmeasured = info.symbol?.edgesMeasured === false && <span className="muted">? 呼び出し関係を取得できていません（前後の停留所とのつながりは分かりません）</span>;
  const okBtn = (
    <button className="btn primary" type="button" onClick={() => dispatch({ id: 'course.ok' })}>
      {last ? '問題なし · 総括へ' : '問題なし · 次へ'} <kbd>Enter</kbd>
    </button>
  );
  const prevBtn = at.i > 0 && (
    <button className="btn" type="button" onClick={() => dispatch({ id: 'course.prev' })}>
      前へ <Key action="course.prev" />
    </button>
  );
  // 根拠の行: 選んでいる文があればその文だけ濃く
  const marks: LineMarks[] = checks.flatMap((c) => c.at.filter((a) => a.k === at.i).map((a) => ({ n: c.n, lines: a.lines, on: at.check === undefined || at.check === c.n })));
  const narr = <StopNarr info={info} first={first && course.id === OUTSIDE} />;
  const guide = (
    <>
      {intro && <div className="gintro">{intro}</div>}
      <div className="gmsg">
        <h2 className="mono">{info.name}</h2>
        {narr}
        {chips}
        {unmeasured}
        <StopChecks checks={checks} k={at.i} check={at.check} infos={infos} dispatch={dispatch} />
        <StopNotes analysis={analysis} course={course} infos={infos} k={at.i} dispatch={dispatch} />
      </div>
    </>
  );
  return (
    <section className="view course">
      <CourseBar course={course} infos={infos} memos={memos} open={open} at={at} checks={checks} dispatch={dispatch} />
      <div className={`stop${folded ? ' shut' : ''}`} style={paneStyle(panes, ['stopTree', 'stopGuide'])}>
        <CourseFiles analysis={analysis} review={review} course={course} infos={infos} memos={memos} open={open} i={at.i} peekPath={peekPath} shut={treeShut ?? []} dispatch={dispatch} />
        <PaneHandle pane="stopTree" dispatch={dispatch} />
        <div className="code">
          <div className="chd">
            <span className="chip">{`${at.i + 1} / ${course.steps.length}`}</span>
            <span className="sym" title={info.symbol?.fqName ?? ''}>
              {info.name}
            </span>
            <span className="chip">{info.layer}</span>
            <span className={`chip${info.kind === '未変更' ? '' : ' h'}`}>{info.kind}</span>
            {info.other !== null && <span className="chip">{`コース ${info.other}`}</span>}
            {info.seen && <span className="chip ok">問題なし</span>}
            <span className="sp" />
            <button className="btn sm" type="button" onClick={() => dispatch({ id: 'course.map' })}>
              地図 <Key action="course.map" />
            </button>
            <button className="btn sm" type="button" title={calleeKey ?? undefined} onClick={() => dispatch({ id: 'jump.callee' })}>
              呼んでいる相手 <Key action="jump.callee" />
            </button>
            {repoName && shownHunk && (
              <button className="btn sm" type="button" onClick={() => dispatch({ id: 'jump.ide' })}>
                IDEA で開く
              </button>
            )}
          </div>
          {folded && (
            <div className="strip">
              {intro}
              {narr}
              {chips}
              {unmeasured}
              <StopChecks checks={checks} k={at.i} check={at.check} infos={infos} onlyHere dispatch={dispatch} />
            </div>
          )}
          <RelRow analysis={analysis} symbolId={info.step.symbolId} dispatch={dispatch} />
          {peekFile !== null ? (
            <>
              <div className="peekbar">
                <span className="chip">覗いている</span>
                <b title={peekFile}>{peekFile.split('/').pop()}</b>
                {peekFileHunks.length === 0 ? <span className="chip">差分なし</span> : fileCourses(peekFileHunks).map((c) => <span key={c} className="chip">{c === OUTSIDE ? 'コースの外' : `コース ${c}`}</span>)}
                <span className="sp" />
                <span className="muted">{`読んでいた停留所: ${info.name}`}</span>
                <button className="btn sm" type="button" onClick={() => dispatch({ id: 'map.unpeek' })}>
                  戻る <kbd>Esc</kbd>
                </button>
              </div>
              <DefLinks defs={analysis.defs} dispatch={dispatch}>
                <FileView analysis={analysis} path={peekFile} hunkId={null} all symbol={undefined} full={fullFile} mode={diffMode} viewed={review.viewed} dispatch={dispatch} memo={memoProps} focusLine={focusLine ?? null} open={fold?.[peekFile]} defBack={defBack} />
              </DefLinks>
            </>
          ) : peekSym ? (
            <>
              <div className="peekbar">
                <span className="chip">関連</span>
                <b>{nodeLabel(analysis, peekSym.id)}</b>
                <span className="chip">{layerText(peekSym)}</span>
                <span className={`chip${peekHunk ? ' h' : ''}`}>{peekHunk ? '変更' : '未変更'}</span>
                {peekHunk?.hows.map((w) => <span key={w} className="chip">{`コース ${w}`}</span>)}
                <span className="sp" />
                <span className="muted">{`読んでいた停留所: ${info.name}`}</span>
                <button className="btn sm" type="button" onClick={() => dispatch({ id: 'map.unpeek' })}>
                  戻る
                </button>
              </div>
              <DefLinks defs={analysis.defs} dispatch={dispatch}>
                <FileView analysis={analysis} path={peekHunk?.path ?? peekSym.path} hunkId={peekHunk?.id ?? null} symbol={peekSym} full={fullFile} mode={diffMode} viewed={review.viewed} dispatch={dispatch} memo={memoProps} focusLine={focusLine ?? null} open={fold?.[peekHunk?.path ?? peekSym.path ?? '']} defBack={defBack} />
              </DefLinks>
            </>
          ) : (
            <DefLinks defs={analysis.defs} dispatch={dispatch}>
              <FileView analysis={analysis} path={info.hunk?.path ?? info.symbol?.path} hunkId={info.hunk?.id ?? null} symbol={info.symbol} full={fullFile} mode={diffMode} viewed={review.viewed} dispatch={dispatch} memo={memoProps} focusLine={focusLine ?? null} open={fold?.[info.hunk?.path ?? info.symbol?.path ?? '']} places={places} marks={marks} defBack={defBack} />
            </DefLinks>
          )}
          {folded && (
            <div className="bottom">
              {prevBtn}
              <span className="sp" />
              {okBtn}
            </div>
          )}
        </div>
        {!folded && <PaneHandle pane="stopGuide" dispatch={dispatch} />}
        <div className="rs">
          <StopColumn
            analysis={analysis}
            ask={ask}
            where={`${at.i + 1} / ${course.steps.length}`}
            folded={folded}
            guide={guide}
            actions={
              <>
                {okBtn}
                {prevBtn}
              </>
            }
            dispatch={dispatch}
          />
          {folded && (
            <div className="rail" aria-label="停留所">
              <button type="button" className="open" title={foldKey === null ? '案内を出す' : `案内を出す（${foldKey}）`} aria-label="案内を出す" onClick={() => dispatch({ id: 'course.fold' })}>
                «
              </button>
              {infos.map((x, k) => (
                <button key={x.step.symbolId} type="button" data-step={x.step.symbolId} title={x.name} onClick={() => dispatch({ id: 'course.jump', i: k })}>
                  <Dot info={x} k={k} cur={k === at.i} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {courseMap && (
        <MapLayer
          size={courseMap}
          title="今ここ"
          note={next ? `次は ${next.name}${next.test ? (next.testGuess ? '（テストと推定。地図には出ません）' : '（テスト。地図には出ません）') : ''}` : '最後の停留所'}
          analysis={analysis}
          scope={course.id}
          current={info.test ? null : nodeOf(info.step.symbolId)}
          peek={peekSym?.id ?? null}
          zoom={zoom}
          onNode={onNode}
          dispatch={dispatch}
          elk={elk}
        />
      )}
    </section>
  );
}

/**
 * 読む前の案内の画面（2026-10-22）: 上の帯・左のファイルのツリーは停留所の画面と同じ。真ん中と右をまとめて BriefBody。
 * 知っておくことの「覗く」は、この画面のままコードを出す（戻る Esc で読む前の案内に戻る）
 */
function Brief({ course, infos, memos, open, checks, at, analysis, review, diffMode, fullFile, fold, panes, peek, treeShut, focusLine, defBack, dispatch }: ScreenProps & { at: CourseAt }) {
  const peekSym = peek?.kind === 'symbol' ? analysis.symbols.find((s) => s.id === peek.symbolId) : undefined;
  const peekHunk = peekSym?.hunkId === undefined ? undefined : analysis.hunks.find((h) => h.id === peekSym.hunkId);
  return (
    <section className="view course">
      <CourseBar course={course} infos={infos} memos={memos} open={open} at={at} checks={checks} dispatch={dispatch} />
      <div className="stop brief-on" style={paneStyle(panes, ['stopTree'])}>
        <CourseFiles analysis={analysis} review={review} course={course} infos={infos} memos={memos} open={open} i={at.i} peekPath={peekHunk?.path ?? peekSym?.path ?? null} shut={treeShut ?? []} dispatch={dispatch} />
        <PaneHandle pane="stopTree" dispatch={dispatch} />
        <div className="bwide">
          {peekSym ? (
            <div className="code">
              <div className="peekbar">
                <span className="chip">覗いている</span>
                <b>{nodeLabel(analysis, peekSym.id)}</b>
                {peekHunk?.hows.map((w) => <span key={w} className="chip">{`コース ${w} の差分`}</span>)}
                <span className="sp" />
                <span className="muted">読んでいた場所: 読む前の案内</span>
                <button className="btn sm" type="button" onClick={() => dispatch({ id: 'map.unpeek' })}>
                  戻る <kbd>Esc</kbd>
                </button>
              </div>
              <DefLinks defs={analysis.defs} dispatch={dispatch}>
                <FileView analysis={analysis} path={peekHunk?.path ?? peekSym.path} hunkId={peekHunk?.id ?? null} symbol={peekSym} full={fullFile} mode={diffMode} viewed={review.viewed} dispatch={dispatch} focusLine={focusLine ?? null} open={fold?.[peekHunk?.path ?? peekSym.path ?? '']} defBack={defBack} />
              </DefLinks>
            </div>
          ) : (
            <BriefBody analysis={analysis} course={course} infos={infos} check={at.check} next={at.i} dispatch={dispatch} />
          )}
        </div>
      </div>
    </section>
  );
}

/** 覗いているファイルの差分が入るコース（どのコースにも入らない差分があれば OUTSIDE も） */
function fileCourses(hunks: readonly Hunk[]): number[] {
  const ids = [...new Set(hunks.flatMap((h) => h.hows))];
  return hunks.some((h) => h.hows.length === 0) ? [...ids, OUTSIDE] : ids;
}

function nodeLabel(analysis: Analysis, symbolId: string): string {
  const s = analysis.symbols.find((x) => x.id === symbolId);
  if (!s) return symbolId.slice(0, 8);
  return s.kind === 'file' ? (s.path.split('/').pop() ?? s.path) : s.fqName.split('.').slice(-2).join('.');
}

function Summary({ course, infos, memos, drafts, open, checks, all, analysis, review, fold, dispatch }: ScreenProps & { all: Course[] }) {
  const memoN = memos.reduce((n, list) => n + list.length, 0);
  const draftN = drafts.reduce((n, list) => n + list.length, 0);
  const openDraftN = open.reduce((n, x) => n + x, 0);
  const okN = infos.filter((x) => x.seen).length;
  const unseen = infos.filter((x) => !x.seen);
  const ripples = courseRipples(analysis, course);
  const rest = ripples.flatMap((r) => r.rest);
  const viewed = new Set(review.viewed);
  const completedAfter = { course: { done: [], completed: [...(review.course?.completed ?? []), course.id] } };
  const nx = nextCourse(all, completedAfter);
  return (
    <section className="view course">
      <div className="sum">
        <div className="main">
          <div>
            <span className="eyebrow">総括</span>
            <h2>{`${courseName(course)} · ${course.title}`}</h2>
          </div>
          <div className="stat four">
            <div>
              <b>{`${okN} / ${infos.length}`}</b>
              <span>問題なし</span>
            </div>
            <div>
              <b>{ripples.length > 0 ? `${rest.filter((id) => viewed.has(id)).length} / ${rest.length}` : '—'}</b>
              <span>同じ書き換えの確認</span>
            </div>
            <div>
              <b>{memoN}</b>
              <span>メモ</span>
            </div>
            <div>
              <b>{draftN > 0 ? openDraftN : '—'}</b>
              <span>まだ決めていない AI の下書き</span>
            </div>
          </div>
          {unseen.length > 0 && <Narr text={`未確認: ${unseen.map((x) => x.name).join('、')}`} />}
          <SummaryChecks checks={checks} infos={infos} dispatch={dispatch} />
          <div className="box">
            <h3>巡った場所</h3>
            {infos.map((x, k) => (
              <div key={x.step.symbolId} className="row3 wm">
                <Dot info={x} k={k} cur={false} />
                <span className="nm">{x.name}</span>
                <MarkChips memo={memos[k]?.length ?? 0} ai={open[k] ?? 0} />
                <span className={`st${x.seen ? ' ok' : ''}`}>{x.seen ? '問題なし' : '未確認'}</span>
                <button className="btn sm" type="button" onClick={() => dispatch({ id: 'course.jump', i: k })}>
                  戻る
                </button>
              </div>
            ))}
          </div>
          {memoN > 0 && <CourseMemos course={course} memos={memos} githubDiff={analysis.githubDiff} dispatch={dispatch} />}
          {draftN > 0 && <CourseDrafts course={course} drafts={drafts} githubDiff={analysis.githubDiff} dispatch={dispatch} />}
          {ripples.map((r) => (
            <RippleBox key={r.representative} ripple={r} analysis={analysis} review={review} fold={fold} dispatch={dispatch} />
          ))}
        </div>
        <div className="side">
          <button className="btn primary" type="button" onClick={() => dispatch({ id: 'course.complete' })}>
            {course.id === OUTSIDE ? '見終えた' : '完了'}
            {nx ? ` · 次はコース ${nx.id}` : ' · 締めへ'} <kbd>Enter</kbd>
          </button>
          <button className="btn" type="button" onClick={() => dispatch({ id: 'course.again' })}>
            もう一度
          </button>
          <button className="btn" type="button" onClick={() => dispatch({ id: 'course.leave' })}>
            全体図へ
          </button>
          <AskButton className="btn" />
          <span className="muted">「問題なし」は見た印です。承認はいつでも押せます</span>
        </div>
      </div>
    </section>
  );
}

/** 総括の「このコースのメモ」。停留所の順、同じ停留所なら行の順。「開く」はそのコースの停留所の画面（行が前後 3 行の外ならファイル全体） */
function CourseMemos({ course, memos, githubDiff, dispatch }: { course: Course; memos: CommentDraft[][]; githubDiff: readonly GithubDiffFile[] | undefined; dispatch: (c: Command) => void }) {
  const all = memos.flat();
  return (
    <div className="box cmemos">
      <h3>
        このコースのメモ
        <span className="sp" />
        <span className="chip">{all.length}</span>
      </h3>
      {all.map((c) => (
        <div key={c.id} className={`cm${c.state === 'sent' ? ' sent' : ''}`}>
          <div className="loc">
            <span className="path" title={c.path}>{`${c.path.split('/').pop() ?? c.path} ${spanLabel(c)}`}</span>
            <OffDiffChip comment={c} githubDiff={githubDiff} />
            {c.state === 'sent' && <span className="chip h">送信済み</span>}
            <button type="button" className="btn sm open" title="この行を開く" onClick={() => dispatch({ id: 'comment.open', commentId: c.id, courseId: course.id })}>
              開く
            </button>
          </div>
          <p>{c.body}</p>
        </div>
      ))}
    </div>
  );
}

/** 総括の「このコースの AI の下書き」。状態を問わず全部（停留所の順、同じ停留所なら行の順）。数は まだ決めていない / 全部。「開く」はメモと同じ */
function CourseDrafts({ course, drafts, githubDiff, dispatch }: { course: Course; drafts: CommentDraft[][]; githubDiff: readonly GithubDiffFile[] | undefined; dispatch: (c: Command) => void }) {
  const all = drafts.flat();
  const cls = (c: CommentDraft) => (c.state === 'adopted' ? ' ad' : c.state === 'sent' ? ' sent' : c.state === 'discarded' ? ' gone' : '');
  return (
    <div className="box cdrafts">
      <h3>
        このコースの AI の下書き
        <span className="sp" />
        <span className="chip" title="まだ決めていない数 / 全部の数">{`${all.filter(isOpenDraft).length} / ${all.length}`}</span>
      </h3>
      {all.map((c) => (
        <div key={c.id} className={`cm${cls(c)}`}>
          <div className="loc">
            <span className="path" title={c.path}>{`${c.path.split('/').pop() ?? c.path} ${spanLabel(c)}`}</span>
            <span className="chip">{c.source}</span>
            {c.state === 'adopted' && <span className="chip ok">採用</span>}
            <OffDiffChip comment={c} githubDiff={githubDiff} />
            {c.state === 'discarded' && <span className="chip">破棄</span>}
            {c.state === 'sent' && <span className="chip h">送信済み</span>}
            <button type="button" className="btn sm open" title="この行を開く" onClick={() => dispatch({ id: 'comment.open', commentId: c.id, courseId: course.id })}>
              開く
            </button>
          </div>
          <p>{c.body}</p>
        </div>
      ))}
    </div>
  );
}

/** 総括の「同じ書き換え」1 束分: サンプル / 差異あり（差分を出し、問題なしを付けられる）/ 残り（チェックで 1 件ずつ見たにする） */
function RippleBox({ ripple, analysis, review, fold, dispatch }: { ripple: CourseRipple; analysis: Analysis; review: ReviewState; fold: CourseViewProps['fold']; dispatch: (c: Command) => void }) {
  const viewed = new Set(review.viewed);
  const hunkName = (id: string) => {
    const h = analysis.hunks.find((x) => x.id === id);
    return h ? h.symbolFqName.split('.').slice(-2).join('.') : id.slice(0, 8);
  };
  return (
    <div className="box">
      <h3>
        {`同じ書き換え ${ripple.size}`}
        <span className="chip h">{ripple.pattern}</span>
        <span className="sp" />
        <span className="chip w">{`差異あり ${ripple.deviations.length}`}</span>
      </h3>
      <div className="row3">
        <span />
        <span className="nm">
          {hunkName(ripple.representative)}
          <small>サンプル</small>
        </span>
        <span className={`st${viewed.has(ripple.representative) ? ' ok' : ''}`}>{viewed.has(ripple.representative) ? '問題なし' : '未確認'}</span>
        <span />
      </div>
      {ripple.deviations.map((dev) => {
        const devHunk = analysis.hunks.find((h) => h.id === dev.hunkId);
        return (
          <div key={dev.hunkId}>
            <div className="row3">
              <span />
              <span className="nm">
                {hunkName(dev.hunkId)}
                <small>差異あり</small>
              </span>
              <span className={`st${viewed.has(dev.hunkId) ? ' ok' : ''}`}>{viewed.has(dev.hunkId) ? '問題なし' : '未確認'}</span>
              <button className="btn sm" type="button" onClick={() => dispatch({ id: 'hunk.markViewed', hunkId: dev.hunkId })}>
                {viewed.has(dev.hunkId) ? '問題なしを外す' : '問題なし'}
              </button>
            </div>
            {devHunk && (
              <div className="devdiff">
                <DiffList hunks={[devHunk]} mode="uni" viewed={review.viewed} selectedHunk={devHunk.id} dispatch={dispatch} open={fold?.[devHunk.path]} />
              </div>
            )}
          </div>
        );
      })}
      <div className="row3">
        <span />
        <span className="nm">
          {`残り ${ripple.rest.length}`}
          <small>サンプルと同じ形（AST 判定）。抜き打ちで開けます</small>
        </span>
        <span className="st">{`${ripple.rest.filter((id) => viewed.has(id)).length} / ${ripple.rest.length}`}</span>
        <span />
      </div>
      <div className="members">
        {ripple.rest.map((id) => (
          <label key={id}>
            <input type="checkbox" checked={viewed.has(id)} onChange={() => dispatch({ id: 'hunk.markViewed', hunkId: id })} />
            {hunkName(id)}
          </label>
        ))}
      </div>
    </div>
  );
}
