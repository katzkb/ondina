// UI の状態遷移。reduce は純粋で、通信や URL を開くなどの副作用は effects として返す（App が実行する）。
// 選択 hunk へのスクロールは DiffList が selectedHunk の変化を見て行う（仮想リストの index を知っているのはそこだけ）。
// 差分一覧（全部のファイルを 1 本に並べる。2026-10-20）だけは、reducer が出す diffJump の n が進んだときに動く。
import type { Analysis, AnalysisSummary, AskCite, AskEntry, AskPlace, CommentDraft, DiffMode, DisplayConfig, PaneId, PrDetail, PrList, ReviewJob, ReviewState, ThemeSettings, TicketSettings, UiSettings } from '@ondina/model';
import { askKey, askLinesOf, askLinesPlace, askPlace, canMemo } from '../ask.js';
import type { Command, SettingsTab } from '../commands/commands.js';
import { keymapWith } from '../commands/keymap.js';
import { courseOf, courses, doneKey, firstUnseen, nextCourse, OUTSIDE, stepPath, type Step } from '../course.js';
import { defTargetAt, type DefPlaceTarget } from '../defs.js';
import { buildTree, dirKeys, under, type TreeName } from '../fileTree.js';
import { groupFiles, hunkAt, viewedChange, type FileEntry } from '../files.js';
import { READ_FAILED, setDoneMessage, setFailedMessage } from '../github.js';
import { howRows, navigable } from '../hows.js';
import { calleeDest, type PaletteTarget } from '../palette.js';
import { mapNodeOf } from '../map/graph.js';
import { mapRouteOf, snapSpeed } from '../map/groupmap/flow.js';
import { groupTree, pathTo } from '../map/groupmap/view.js';
import { openRel, relAt, relMove, relVisible, type RelView } from '../rel.js';
import { ideaUrl } from '../ide.js';
import { isMemo, memoPlace, memoStop, mergeDraft, newMemo, onGithubDiff, pickFor, pickRange, spanLabel, stopShows, type MemoPick, type PickScreen } from '../memo.js';
import { DEFAULT_PR_FILTER, reviewActive, type DetailTab, type PrFilter } from '../prs.js';
import { enqueue, finished, isActive, jobOf, mergeJobs, NO_REANALYZE, type ReanalyzeUi } from '../reanalyze.js';
import type { Page } from '../route.js';
import { DEFAULT_THEME, parseTheme } from '../theme.js';

/** PR 一覧（3.11）/ 入口（全体図。3.1）/ 目的ごとに分けた画面（How 分解。3.2）/ コース（3.3）/ 差分一覧（3.4）/ 締め（3.9） */
export type View = 'prs' | 'home' | 'hows' | 'course' | 'diff' | 'closing';

/** PR 一覧（3.11）。list は最後に取れた一覧（取り直しに失敗しても残す）、error は最後の取得の失敗の理由。保存しない */
export interface PrsUi {
  list: PrList | null;
  loading: boolean;
  error: string | null;
  filter: PrFilter;
  /** 右に出している PR の詳細。PR 一覧から離れたら閉じる */
  detail: { number: number; tab: DetailTab } | null;
  /** 番号ごとに取った PR の詳細（開き直すと出したまま取り直す）。保存しない */
  details: Record<number, PrDetailUi>;
}

/** 一覧と同じく、data は最後に取れた中身（取り直しに失敗しても残す）、error は最後の取得の失敗の理由 */
export interface PrDetailUi {
  data: PrDetail | null;
  loading: boolean;
  error: string | null;
}

const NO_PRS: PrsUi = { list: null, loading: false, error: null, filter: DEFAULT_PR_FILTER, detail: null, details: {} };

/** 入口の一時状態。tab は地図 / 説明、sel は選んだコース（道順を出す。コース外は 0、選んでいなければ null） */
export interface HomeState {
  tab: 'map' | 'text';
  sel: number | null;
  /** 説明タブのチケットの原文を開いているか（要求を抜き出したときは畳んである。保存しない） */
  ticket: boolean;
  /** 説明タブの段（1 = 背景、2 = この PR。2026-10-29）。保存しない。解析を開くたびに背景から */
  stage: 1 | 2;
  /** 入口の地図で見ているまとまりの道筋（全景の直下から。空 = 全景）。MapGroup.id。保存しない（2026-11-04） */
  path: string[];
  /** 選んだコースの道順の今の歩（1 から。0 = 全部の歩を見る）。コースを選び直すと 0。保存しない（2026-11-04） */
  step: number;
  /** 道順を再生している（地図の時計が map.tick を呼ぶ）。保存しない */
  play: boolean;
  /** 選んだ動き（Behavior.id）。コースとどちらか 1 つ。保存しない（2026-11-04） */
  behavior: string | null;
  /** 動きの見せ方（地図 / シーケンス図）。動きを外すと地図に戻す。保存しない */
  mode: 'map' | 'seq';
  /** 動きの矢印の札に引数を全部出す（押すと切り替える）。保存しない */
  args: boolean;
}

/**
 * コース（3.3）の今の場所。screen は 読む前の案内 / 停留所 / 総括（2026-10-12 から停留所ごとに 1 画面。それまでは 案内 / 実物 の 2 画面。
 * 読む前の案内は 2026-10-22。見本を比べて案 1 にした）。読む前の案内の i は「n か所目へ」の行き先（入ったときの最初の未確認の停留所）。
 * check = 選んでいる確かめることの番号（その文の根拠の行だけ光らせる）。停留所を移ると外れる（toStop に渡す場所に付けない）
 */
export interface CourseAt {
  id: number;
  i: number;
  screen: 'brief' | 'stop' | 'summary';
  check?: number;
}

/** 読む前の案内があるコース（コース外には経路も確かめることも無い） */
const hasBrief = (courseId: number): boolean => courseId !== OUTSIDE;

/** コースの地図の出し方（2026-10-11。見本を比べて「右から引き出す」を基本に「任意で真ん中に大きく」と決めた） */
export type CourseMapSize = 'side' | 'big';

/**
 * メモ（3.3）の画面の一時状態（保存しない）。pick = 選んでいる行、editing = 直しているメモの id、draft = 書いている途中の文（新しく書く・直すの両方）。
 * draft を書く枠の中ではなくここに持つのは、範囲を伸ばすと書く枠が別の行の下に移る（作り直される）ため、差分一覧（仮想リスト）では画面から外れた枠が消えるため。
 * 選び直しても書いた文は消さない。focus = 締めの「開く」で差分一覧に来たメモ（その行までスクロールする）。
 * drag = 「+」を押したままなぞっている（離すまで書く枠を出さない。出すと下の行がずれて、なぞる先がずれる）
 * hold = 押したとき開いていた枠（新しく書く枠なら pick、直す枠なら editing）とその高さ。離すまでその場所に同じ高さの空きを出す。
 * 枠が消えると下の行が上にずれ、止めたままのマウスの下に別の行が来て、押した行より下まで選ばれる（issue #4）
 */
export interface MemoUi {
  pick: MemoPick | null;
  editing: string | null;
  draft: string;
  focus: string | null;
  drag: boolean;
  hold?: MemoHold | undefined;
}

export interface MemoHold {
  pick: MemoPick | null;
  editing: string | null;
  height: number;
}

export const NO_MEMO: MemoUi = { pick: null, editing: null, draft: '', focus: null, drag: false };

/**
 * 案内人に聞く（3.10）の画面の状態。open = 引き出し（停留所の画面では使わない。右の列が質問の欄。2026-10-20）。
 * place / key = 何について。引き出しは開いたときの場所に留まり、停留所の画面では今の停留所に付いていく（reduce の後処理）。どちらも書く枠の「聞く」と「× 場所全体にする」が替える。
 * pending = 待っている問い（同時に 1 つ）。failed = 失敗した問い（保存しない）。unread = 答え（か失敗）が見ていない間に来た場所の key（「聞く」に点）。その場所の会話が見えたら外す。
 * log = 会話の記録（serve が保存する）。memoFor = 行の無い問いの「メモにする」で、行を選ぶ案内を出している（次に選んだ行の書く枠に質問の文を入れる）。
 * memoed = 「メモにする」で書く枠に入れた答えと、その行の書き方（「8〜11 行目の書く枠に入れた」）。memoFor / memoed は閉じる・送るで消す。memoed はその書く枠を閉じても消す（reduce）。
 * focusN / scroll = 停留所の画面の右の列への 1 回きりの合図（入力欄に移る・会話を一番上 / 一番下へ）。押すたびに n が進み、右の列は値が変わったときだけ動く
 */
export interface AskUi {
  open: boolean;
  place: AskPlace | null;
  key: string | null;
  draft: string;
  pending: { key: string; place: AskPlace; question: string; startedAt: number } | null;
  failed: { key: string; place: AskPlace; question: string; reason: string } | null;
  unread: readonly string[];
  log: AskEntry[];
  memoFor: { entryId: string; question: string } | null;
  memoed: { entryId: string; label: string } | null;
  focusN: number;
  scroll: { to: 'top' | 'bottom'; n: number };
}

export const NO_ASK: AskUi = { open: false, place: null, key: null, draft: '', pending: null, failed: null, unread: [], log: [], memoFor: null, memoed: null, focusN: 0, scroll: { to: 'top', n: 0 } };

/** 閉じる・送る・何についてを替えるときに消す物（行を選ぶ案内と、入れた知らせ） */
const NO_MEMO_ASK = { memoFor: null, memoed: null } as const;

/**
 * 停留所の画面で覗いている物。symbol = 地図の関連の箱（2026-09-26）、file = 左のツリーのほかのコースのファイルか、今の停留所に見えない答えの行の場所
 * （2026-10-20。line はその行。光らせるのは focusLine）
 */
export type Peek = { kind: 'symbol'; symbolId: string } | { kind: 'file'; path: string; line?: { side: 'LEFT' | 'RIGHT'; line: number } };

/** 答えの行の場所を押して来た行（光らせてスクロールする。1 回きり）。n は押すたびに進む（同じ行をもう一度押しても光らせ直す） */
export interface FocusLine {
  path: string;
  side: 'LEFT' | 'RIGHT';
  line: number;
  endLine?: number;
  n: number;
}

/** 差分の列の戻り先（名前から定義へ。3.6）: 押した名前の行。光らせて戻る（focusLine と同じ形） */
export interface DefBack {
  path: string;
  side: 'LEFT' | 'RIGHT';
  line: number;
}

/**
 * 定義の引き出し（3.6。2026-10-29。見本を比べて決めた）。stack の最後が今出している定義（⌘[ で 1 つ前へ）。big = 真ん中いっぱい（⇧R）。
 * from = 引き出しを開いた差分の列の名前の行（引き出しの中から差分の列の定義へ移るときの戻り先）
 */
export interface DefView {
  stack: Array<{ target: DefPlaceTarget; name: string }>;
  big: boolean;
  from: DefBack | null;
}

/** GitHub の Viewed（12.1）。保存しない（GitHub が持ち主） */
export interface GithubUi {
  /** GitHub で Viewed のファイル（path）。読めるまで・local・読めなかったときは null（チェックを出さない） */
  viewed: string[] | null;
  /** 右下の通知（6 秒）。null は出していない */
  toast: GithubToast | null;
  /** 通知の番号の元。出すたびに進む（閉じるタイマーが後から出た通知を閉じないように） */
  seq: number;
}

export interface GithubToast {
  n: number;
  message: string;
  /** gh のエラーの文。無ければ出さない */
  reason?: string;
  /** 「再試行」で送り直す中身。null はボタンを出さない（通った・PR の head が違う） */
  retry: { kind: 'set'; mark: string[]; unmark: string[] } | { kind: 'read' } | null;
  /** info = 知らせるだけ（名前の定義がライブラリの中。3.6） */
  tone: 'error' | 'ok' | 'info';
}

const NO_GITHUB: GithubUi = { viewed: null, toast: null, seq: 0 };

/**
 * 差分一覧のスクロールの合図（1 回きり。n が進んだときだけ DiffList が動く。2026-10-20）。
 * to: file = そのファイルの見出しを一番上、hunk = 見えていなければ見える所まで（どちらも前のファイルの末尾を一番上に残さない）
 */
/**
 * 差分の列の検索（2026-10-27。diff/find.ts）。差分一覧と目的ごとの画面のプレビューで ⌘F。画面の一時状態で保存しない。
 * at = 今の 1 件（次へ・前へで増減するだけ。DiffList が件数で回す）、n = 検索欄に入れ直す合図（開いている間にもう一度 ⌘F）
 */
export interface FindUi {
  open: boolean;
  query: string;
  at: number;
  n: number;
}

export const NO_FIND: FindUi = { open: false, query: '', at: 0, n: 0 };

/** 差分の列の検索が効く画面（差分の列を出している画面）。ほかの画面の ⌘F はブラウザのページ内検索に任せる */
export function findable(state: AppState): boolean {
  if (state.analysis === null || overlayOpen(state)) return false;
  if (state.view === 'diff') return state.analysis.hunks.length > 0;
  return state.view === 'hows' && state.analysis.hunks.some((h) => h.id === state.selectedHunk);
}

export interface DiffJump {
  hunkId: string | null;
  to: 'file' | 'hunk';
  n: number;
}

/** GitHub 送信の一時状態（永続化しない。12 章） */
/** returned = AI に返した（local。12 章）。waiting は返した時点で AI が待っていたか */
export type SendStatus = { status: 'idle' } | { status: 'sending' } | { status: 'sent'; url: string } | { status: 'returned'; waiting: boolean } | { status: 'error'; message: string };

export interface AppState {
  view: View;
  analyses: AnalysisSummary[];
  current: AnalysisSummary | null;
  analysis: Analysis | null;
  review: ReviewState | null;
  selectedFile: string | null;
  selectedHunk: string | null;
  /**
   * 差分一覧でツリーが明るくするファイル（DiffList が diff.viewport で知らせる一番上のファイル。2026-10-20）。
   * 選んだ差分（selectedHunk）は見えている間は動かないので、別のファイルのことがある。差分一覧の外では null
   */
  diffFile: string | null;
  diffJump: DiffJump;
  /** How 分解の画面の絞り込み（3.2）。null は絞り込み無し */
  selectedHow: number | null;
  /** 展開している追従グループ（RippleGroup.representative）。画面の一時状態で保存しない */
  openGroups: string[];
  /** 入口のタブと選んだコース。画面の一時状態で保存しない */
  home: HomeState;
  /** コース（3.3）の今の場所。null はコースに入っていない。画面の一時状態で保存しない（進み具合は ReviewState.course） */
  course: CourseAt | null;
  /** 停留所の画面の地図。null = 閉じている、side = 右からの引き出し（M）、big = 真ん中いっぱい（Shift+M）。大きさは覚えない（閉じると null） */
  courseMap: CourseMapSize | null;
  /**
   * 今のファイルを全部出しているか（F）。停留所はファイル全体、差分一覧・目的ごとの画面は畳んだ帯を全部開く（2026-10-13）。
   * 停留所を移る・ファイルを選び替える・画面を替えると戻る（「開く」と答えの行の場所で全体にしたときを除く）。差分一覧は列全体に効き、ファイルが替わっても戻らない
   */
  fullFile: boolean;
  /** 変わった行から離れた行の帯で開いた行（path → 行の key。diff/fold.ts）。画面やファイルを替えても残す。保存しない。別の解析を開くと空 */
  fold: Record<string, string[]>;
  /**
   * 停留所の画面の案内の列をたたんでいるか（B。2026-10-12。見本を比べて決めた。2026-10-20 から右の水先案内と質問の列）。
   * 停留所・コースを移っても、コースを出ても保つ（行の長い PR では広いまま進む）。画面の一時状態で保存しない
   */
  courseFolded: boolean;
  /** 停留所の画面で覗いている物。停留所の画面のコードだけがそれに替わる。画面の一時状態で保存しない */
  peek: Peek | null;
  /** 地図の倍率。既定 1（100%）。画面の一時状態で保存しない */
  mapZoom: number;
  /**
   * 差分の無い相手の引き出し（2026-10-11）。null = 閉じている。地図の引き出しとは同時に開かない。
   * 画面の一時状態で保存しない。停留所を移る・画面を替える・別の解析を開くと閉じる
   */
  rel: RelView | null;
  /** 定義の引き出し（3.6）。null = 閉じている。コード欄が替わる（defMoved）・別の解析を開くと閉じる */
  def: DefView | null;
  /** コード欄で定義へ移る前の場所（⌘[ と「← 戻る」で 1 つずつ戻る）。コード欄が替わる（defMoved）・別の解析を開くと空 */
  defBack: DefBack[];
  showKeymap: boolean;
  /** 設定のモーダル（上の帯の歯車）で開いているタブ。null = 閉じている */
  settings: SettingsTab | null;
  /** コマンドパレット（18.2）を開いているか。画面の一時状態で保存しない */
  showPalette: boolean;
  /** パレットを「このシンボルが呼んでいる相手」の一覧として開いている（Symbol.id）。null は普通のパレット */
  paletteFrom: string | null;
  /** 画面の設定（.ondina/ui.json。PR をまたぐ）。テーマ・左右 / 統合・worktree の置き場所・LLM コマンド */
  ui: UiSettings;
  send: SendStatus;
  github: GithubUi;
  memo: MemoUi;
  /**
   * AI の下書きを直している途中の文（下書きの id → 文。2026-10-13）。行の下の箱と締めの箱が同じ文を見る。
   * 箱の中に持たないのは、差分一覧（仮想リスト）では画面から外れた箱が消え、画面を移っても消えるため（MemoUi.draft と同じ理由）。
   * 保存しない（下書きの state が edit のまま開き直したら、今の本文から直す）。採用・戻す・破棄で消す
   */
  draftText: Record<string, string>;
  ask: AskUi;
  focusLine: FocusLine | null;
  /** ondina.config.yaml の表示だけの部分（11 章）。届くまで null */
  config: DisplayConfig | null;
  /** 解析し直す（3.0 の帯の下の 1 行）。新しい head の答えと serve の解析の列（PR 一覧と共有）。保存しない */
  reanalyze: ReanalyzeUi;
  prs: PrsUi;
  /** serve の AI レビュー（3.11。key ごとの最新）と、serve に頼めなかった失敗。解析の列とは別。保存しない */
  reviews: ReviewJob[];
  /**
   * ファイルツリーで閉じたフォルダの key（fileTree.ts。差分一覧とコースの左で別々。2026-10-19）。既定は全部開いている。
   * 見ているファイル（差分一覧で選んだファイル・今の場所のファイル）が変わったら、その上のフォルダを開く。保存しない。別の解析を開くと空
   */
  treeShut: Record<TreeName, string[]>;
  find: FindUi;
}

const NO_TREE: Record<TreeName, string[]> = { diff: [], course: [] };

export type Effect =
  /** PR 一覧を GitHub から取る（GET /api/prs）。結果は prs.loaded / prs.failed */
  | { type: 'fetchPrs' }
  /** PR の詳細を GitHub から取る（GET /api/prs/:n）。結果は prDetail.loaded / prDetail.failed */
  | { type: 'fetchPrDetail'; number: number }
  | { type: 'saveState' }
  | { type: 'saveUi' }
  /** view は着く画面（AI レビューの「見る」は締め） */
  | { type: 'loadAnalysis'; key: string; headSha: string; view?: 'closing' }
  /** AI にレビューを頼む（POST /api/review）。状態は review.jobs で戻る（頼めなければ review.startFailed） */
  | { type: 'startReview'; key: string; headSha: string }
  | { type: 'stopReview'; key: string }
  /** その解析の state を読み直し、知らない AI の下書きを並べる（comments.arrived） */
  | { type: 'loadComments'; key: string; headSha: string }
  | { type: 'openUrl'; url: string }
  /** 新しいタブで開く（GitHub の PR ページ。ondina の画面は残す） */
  | { type: 'openTab'; url: string }
  | { type: 'sendComments' }
  /** 案内人に聞く（POST /api/ask）。答えは ask.done / ask.failed で戻る */
  | { type: 'ask'; key: string; place: AskPlace; question: string }
  | { type: 'askStop' }
  | { type: 'loadAsk'; key: string; headSha: string }
  /** 新しい head を聞く（GET /api/latest）。答えは reanalyze.checked で戻る */
  | { type: 'checkLatest'; key: string; headSha: string }
  /** 解析を頼む（POST /api/analyze）。from は解析し直す元の版（無ければ PR 番号で解析する）。状態は reanalyze.job で戻る */
  | { type: 'startAnalyze'; key: string; from?: string }
  /** 解析の一覧を読み直す（解析し直しが終わったとき） */
  | { type: 'refreshAnalyses' }
  /** 一覧を読み直してからそのバージョンを開く（一覧に無いバージョンは開けないため） */
  | { type: 'switchTo'; key: string; headSha: string }
  /** GitHub の Viewed を読む（12.1）。結果は github.loaded / github.loadFailed */
  | { type: 'githubRead'; key: string; headSha: string; quiet: boolean }
  /** GitHub の Viewed を付ける・外す。送った順に 1 つずつ送る。結果は github.set / github.setFailed */
  | { type: 'githubSet'; key: string; headSha: string; mark: string[]; unmark: string[]; retried: boolean };

export interface Reduced {
  state: AppState;
  effects: Effect[];
}

export function initialState(): AppState {
  return { view: 'home', analyses: [], current: null, analysis: null, review: null, selectedFile: null, selectedHunk: null, diffFile: null, diffJump: { hunkId: null, to: 'hunk', n: 0 }, selectedHow: null, openGroups: [], home: { tab: 'text', sel: null, ticket: false, stage: 1, path: [], step: 0, play: false, behavior: null, mode: 'map', args: false }, course: null, courseMap: null, fullFile: false, fold: {}, courseFolded: false, peek: null, mapZoom: 1, rel: null, def: null, defBack: [], showKeymap: false, settings: null, showPalette: false, paletteFrom: null, ui: {}, send: { status: 'idle' }, github: NO_GITHUB, reanalyze: NO_REANALYZE, prs: NO_PRS, reviews: [], memo: NO_MEMO, draftText: {}, ask: NO_ASK, focusLine: null, config: null, treeShut: NO_TREE, find: NO_FIND };
}

const none = (state: AppState): Reduced => ({ state, effects: [] });

/** 今の PR の解析が順番待ちか解析中 */
const isRunning = (s: AppState): boolean => s.current !== null && isActive(jobOf(s.reanalyze.jobs, s.current.key));

type Place = Pick<AppState, 'view' | 'selectedFile' | 'selectedHunk' | 'selectedHow' | 'course'>;

/**
 * 同じ PR の別のバージョンを開くときに残す場所（3.0。2026-10-13）。別の PR・最初の読み込みは undefined（入口に着く）。
 * 画面・選んでいるファイルと hunk・目的の絞り込みは、新しいバージョンにもあれば残す。コースは同じコースの最初の未確認の停留所へ（無ければ入口）
 */
function sameVersionPlace(state: AppState, to: AnalysisSummary, analysis: Analysis, review: ReviewState, files: readonly FileEntry[]): Place | undefined {
  // PR 一覧から開いたときは入口へ（PR 一覧は解析の中の場所ではない）
  if (!state.current || state.current.key !== to.key || state.view === 'prs') return undefined;
  const file = files.find((f) => f.path === state.selectedFile);
  const hunk = file?.hunks.find((h) => h.id === state.selectedHunk) ?? file?.hunks[0];
  const place = {
    selectedFile: file?.path ?? files[0]?.path ?? null,
    selectedHunk: hunk?.id ?? files[0]?.hunks[0]?.id ?? null,
    selectedHow: analysis.hows.some((h) => h.id === state.selectedHow) ? state.selectedHow : null,
  };
  if (state.view !== 'course') return { ...place, view: state.view, course: null };
  const course = state.course ? courseOf(courses(analysis), state.course.id) : undefined;
  if (!course || course.steps.length === 0) return { ...place, view: 'home', course: null };
  const i = firstUnseen(analysis, course, review);
  return { ...place, view: 'course', course: { id: course.id, i, screen: state.course?.screen === 'brief' ? 'brief' : 'stop' } };
}

/** コースを出るときに畳む物 */
const LEAVE = { course: null, peek: null, courseMap: null, fullFile: false, rel: null } as const;

/** PR 一覧を取り直す（取っている間は重ねない） */
function fetchPrs(state: AppState): Reduced {
  if (state.prs.loading) return none(state);
  return { state: { ...state, prs: { ...state.prs, loading: true, error: null } }, effects: [{ type: 'fetchPrs' }] };
}

/** PR の詳細を取り直す（その番号を取っている間は重ねない。前の中身は出したまま） */
function fetchDetail(state: AppState, number: number): Reduced {
  const was = state.prs.details[number];
  if (was?.loading) return none(state);
  const details = { ...state.prs.details, [number]: { data: was?.data ?? null, loading: true, error: null } };
  return { state: { ...state, prs: { ...state.prs, details } }, effects: [{ type: 'fetchPrDetail', number }] };
}

const withDetail = (state: AppState, number: number, d: PrDetailUi): AppState => ({ ...state, prs: { ...state.prs, details: { ...state.prs.details, [number]: d } } });

/** 「更新」: 一覧と、開いている PR の詳細 */
function refreshPrs(state: AppState): Reduced {
  const list = fetchPrs(state);
  const open = list.state.prs.detail;
  if (open === null) return list;
  const detail = fetchDetail(list.state, open.number);
  return { state: detail.state, effects: [...list.effects, ...detail.effects] };
}

/** PR 一覧では効かせない、選んでいる差分に効くキーの操作（PR 一覧は開いている解析を出していないので、見えない差分に印を付けたり選び直したりしない） */
const NOT_ON_PRS: ReadonlySet<Command['id']> = new Set(['hunk.next', 'hunk.prev', 'hunk.markViewed', 'file.next', 'file.prev', 'jump.ide']);

// 差分は 3 つの画面とも左右が既定（2026-10-11。目的ごとの画面も左右に。片側が狭いので長い行は折り返す）
const DEFAULT_DIFF_MODE: Record<'b' | 'c' | 'd', DiffMode> = { b: 'sbs', c: 'sbs', d: 'sbs' };

/** 今のテーマ: 設定（ui.json） > ondina.config.yaml の theme > 既定。解析の有無に関係なく決まる */
export function themeOf(state: AppState): ThemeSettings {
  return state.ui.theme ?? state.config?.theme ?? DEFAULT_THEME;
}

/** テーマの 1 項目を変えて保存する。ほかの項目は今の値（yaml・既定のときもそれを ui.json に書く） */
function withTheme(state: AppState, change: Partial<ThemeSettings>): Reduced {
  return { state: { ...state, ui: { ...state.ui, theme: { ...themeOf(state), ...change } } }, effects: [{ type: 'saveUi' }] };
}

/** 今の左右 / 統合（画面ごと）。設定に無い画面は左右 */
export function diffModeOf(state: AppState): Record<'b' | 'c' | 'd', DiffMode> {
  return { ...DEFAULT_DIFF_MODE, ...state.ui.diffMode };
}

/** 重なった画面（設定・? の一覧・パレット）のどれかが開いている */
export function overlayOpen(state: AppState): boolean {
  return state.showKeymap || state.showPalette || state.settings !== null;
}

/**
 * 手で編集した・古い形式の state でも UI が落ちないように、欠けた項目を既定値で補う。
 * 2026-10-11 より前の state にある ui（テーマ・左右 / 統合）は読まない（設定は ui.json に移した）
 */
export function normalizeReview(review: Partial<ReviewState>): ReviewState {
  const course = review.course;
  return {
    viewed: Array.isArray(review.viewed) ? review.viewed : [],
    comments: Array.isArray(review.comments) ? review.comments : [],
    ...(course && typeof course === 'object' ? { course: { done: Array.isArray(course.done) ? course.done : [], completed: Array.isArray(course.completed) ? course.completed : [] } } : {}),
    // 前のバージョンからの引き継ぎの記録（帯の下の 1 行）。保存し直しても消さない
    ...(review.carried && typeof review.carried === 'object' ? { carried: review.carried } : {}),
  };
}

/** ui.json の文字の 1 項目を入れ替える。空文字は項目ごと消す（yaml / 既定に戻る） */
function withUi(ui: UiSettings, key: 'worktreeRoot' | 'llmCommand' | 'reviewCommand', value: string): UiSettings {
  const rest = { ...ui };
  delete rest[key];
  return value === '' ? rest : { ...rest, [key]: value };
}

/** チケットの取り方（5.1）の 1 項目を入れ替える。空文字は項目ごと消し、全部消えたら ticket ごと消す */
function withTicket(ui: UiSettings, field: keyof TicketSettings, value: string): UiSettings {
  const ticket: Record<string, string> = { ...ui.ticket };
  delete ticket[field];
  if (value !== '') ticket[field] = value;
  const rest = { ...ui };
  delete rest.ticket;
  return Object.keys(ticket).length === 0 ? rest : { ...rest, ticket: ticket as TicketSettings };
}

/** ショートカットキーの変更を入れ替える。無ければ項目ごと消す（exactOptionalPropertyTypes で undefined を置けない） */
function withKeymap(ui: UiSettings, keymap: UiSettings['keymap']): UiSettings {
  const rest = { ...ui };
  delete rest.keymap;
  return keymap === undefined ? rest : { ...rest, keymap };
}

/** 列の幅を px の整数で入れ替える。null は消し（既定の幅）、全部消えたら panes ごと消す */
function withPane(ui: UiSettings, pane: PaneId, px: number | null): UiSettings {
  const panes = { ...ui.panes };
  delete panes[pane];
  if (px !== null) panes[pane] = Math.round(px);
  const rest = { ...ui };
  delete rest.panes;
  return Object.keys(panes).length === 0 ? rest : { ...rest, panes };
}

/** 移った先でファイル全体にすることがあるコマンド（行が前後 3 行の外にあるとき。openStop / openCite） */
const FULL_ON_MOVE: readonly Command['id'][] = ['comment.open', 'ask.cite', 'ask.memo'];

export function reduce(state: AppState, command: Command): Reduced {
  const r = withGithubSet(state, reduceAll(state, command));
  // スクロールは「移った」ではない（書く枠・光らせた行・すべて表示・ツリーのフォルダをそのままにし、スクロールの合図も出さない）
  if (command.id === 'diff.viewport') return r;
  // 画面・停留所・覗く箱・ファイルが変わったら、選んでいる行と直す枠は外す（見えない所に残さない）。
  // 「開く」の focus（メモの行までスクロールする印）は 1 回きり: 「開く」の後に画面・停留所・選んだ hunk が変わったら外す（戻るたびに古いメモへ跳ばない）
  const s = r.state;
  const moved = placeMoved(state, s);
  const focus = command.id !== 'comment.open' && (moved || s.selectedHunk !== state.selectedHunk) ? null : s.memo.focus;
  // 行の場所（案内人の答え・知っておくことの「覗く」）で来た行の印も 1 回きり。答えの「メモにする」は聞いた行へ移って選び直すので、移っても外さない
  const memoed = command.id === 'ask.memo';
  const lit = command.id === 'ask.cite' || (command.id === 'map.peek' && command.line !== undefined) || command.id === 'def.go' || command.id === 'def.back';
  const focusLine = !lit && !memoed && (moved || s.selectedHunk !== state.selectedHunk) ? null : s.focusLine;
  const memo = moved && !memoed && (s.memo.pick !== null || s.memo.editing !== null) ? { ...NO_MEMO, focus } : focus === s.memo.focus ? s.memo : { ...s.memo, focus };
  // 「メモにする」の入れた知らせは、その書く枠が開いている間だけ（保存・やめる・移ると消し、もう一度押せるようにする）
  const followed = followStop(state, s);
  const ask = followed.memoed !== null && memo.pick === null ? { ...followed, memoed: null } : followed;
  // 差分の無い相手の引き出しは、画面を替えたら閉じる（停留所を移るときは toStop が閉じる）
  const rel = s.rel !== null && s.view !== state.view ? null : s.rel;
  // 定義の引き出しと戻り先は、コード欄が替わったら消す（差分一覧の中のスクロールでは消さない）
  const defGone = defMoved(state, s);
  const def = s.def !== null && defGone ? null : s.def;
  const defBack = s.defBack.length > 0 && defGone ? [] : s.defBack;
  const prs = s.prs.detail !== null && s.view !== 'prs' ? { ...s.prs, detail: null } : s.prs;
  // すべて表示（F）は、画面・ファイルを替えたら戻す。「開く」と答えの行の場所は、行が見えるように全体にして移るので残す
  const fullFile = s.fullFile && (s.view !== state.view || fileMoved(state, s)) && !FULL_ON_MOVE.includes(command.id) ? false : s.fullFile;
  const treeShut = revealTree(state, s);
  const diffJump = nextJump(state, s, fullFile);
  const diffFile = s.view === 'diff' ? s.diffFile : null;
  // 差分の列の検索は、画面を替えたら閉じる（入れた文字は残す）
  const find = s.find.open && s.view !== state.view ? { ...s.find, open: false } : s.find;
  return memo === s.memo && focusLine === s.focusLine && ask === s.ask && rel === s.rel && def === s.def && defBack === s.defBack && prs === s.prs && fullFile === s.fullFile && treeShut === s.treeShut && diffJump === s.diffJump && diffFile === s.diffFile && find === s.find
    ? r
    : { ...r, state: { ...s, memo, focusLine, ask, rel, def, defBack, prs, fullFile, treeShut, diffJump, diffFile, find } };
}

/** 選んだファイルが替わった。差分一覧の中では数えない（全部のファイルが 1 本の列にあり、見えなくなるわけではない。2026-10-20） */
const fileMoved = (a: AppState, b: AppState): boolean => a.selectedFile !== b.selectedFile && !(a.view === 'diff' && b.view === 'diff');

/**
 * 書く枠と選んだ行を外す「移った」: 画面・停留所・覗く箱・ファイルが変わった。差分の無い相手の引き出しで相手を替えたときも（その相手のファイルで選んだ行を残さない）。
 * reduce の後始末と askMemo で同じ規則を使う
 */
const placeMoved = (a: AppState, b: AppState): boolean => stopMoved(a, b) || a.peek !== b.peek || a.rel?.sel !== b.rel?.sel || fileMoved(a, b);

/**
 * 差分一覧のスクロールの合図。コマンドが自分で出していなければ、選んだ差分・左右 / 統合・すべて表示・解析が替わったとき、
 * 差分一覧に入ったときに、選んだ差分へ（見えていなければ見える所まで）。問題なし・帯・メモの行では動かさない
 */
function nextJump(before: AppState, after: AppState, fullFile: boolean): DiffJump {
  const j = after.diffJump;
  if (after.view !== 'diff' || j !== before.diffJump) return j;
  const changed = before.view !== 'diff' || after.selectedHunk !== before.selectedHunk || diffModeOf(after).d !== diffModeOf(before).d || fullFile !== before.fullFile || after.analysis !== before.analysis;
  return changed ? { hunkId: after.selectedHunk, to: 'hunk', n: j.n + 1 } : j;
}

/** 画面・コース・停留所のどれかが変わった */
const stopMoved = (a: AppState, b: AppState): boolean => a.view !== b.view || a.course?.id !== b.course?.id || a.course?.i !== b.course?.i || a.course?.screen !== b.course?.screen;

/** 定義の引き出しと戻り先を消す「移った」: コード欄（defColumn）が替わった。目的ごとの画面は、プレビューのファイルが替わったときだけ */
function defMoved(a: AppState, b: AppState): boolean {
  if (stopMoved(a, b) || a.peek !== b.peek) return true;
  if (b.view !== 'hows' || a.selectedHunk === b.selectedHunk) return false;
  const path = (s: AppState) => s.analysis?.hunks.find((h) => h.id === s.selectedHunk)?.path;
  return path(a) !== path(b);
}

/** 停留所の画面（右の列が質問の欄。3.10。2026-10-20） */
const onStop = (s: AppState): boolean => s.view === 'course' && s.course?.screen === 'stop';

/** 会話が見えている場所の key（引き出しが開いているか、停留所の画面で右の列をたたんでいない）。見えていなければ null */
const askSeen = (s: AppState): string | null => (s.ask.open || (onStop(s) && !s.courseFolded) ? s.ask.key : null);

/**
 * 停留所の画面では、右の列の何についてを今の停留所にする（コース・停留所・画面が変わったとき、別の解析を開いたとき。覗くでは替えない）。引き出しは閉じる。
 * 答えが来た印は、その場所の会話が見えたら外す
 */
function followStop(before: AppState, after: AppState): AskUi {
  let ask = after.ask;
  if (onStop(after) && after.analysis && (stopMoved(before, after) || before.analysis !== after.analysis)) {
    const place = askPlace(after.analysis, after);
    ask = { ...ask, open: false, place, key: askKey(place), ...NO_MEMO_ASK };
  }
  const seen = askSeen({ ...after, ask });
  return seen !== null && ask.unread.includes(seen) ? { ...ask, unread: ask.unread.filter((k) => k !== seen) } : ask;
}

/** 今の場所のファイル */
function stopPath(state: AppState): string | null {
  const step = currentStop(state);
  return step && state.analysis ? stepPath(state.analysis, step) : null;
}

/**
 * 見ているファイルが変わったら、そのツリーで上のフォルダを開く（差分一覧は選んだファイル、コースは今の場所のファイル）。
 * 画面に依らず、ファイルが変わったときだけ（ほかの画面で選び替えたときも）。同じファイルのまま（フォルダを閉じただけ・同じファイルの次の場所・
 * ほかの画面へ行って戻っただけ）なら開き直さない
 */
function revealTree(before: AppState, after: AppState): AppState['treeShut'] {
  const t = after.treeShut;
  const open = (name: TreeName, path: string | null, was: string | null) => (path !== null && path !== was && t[name].some((k) => under(path, k)) ? t[name].filter((k) => !under(path, k)) : t[name]);
  const diff = open('diff', after.selectedFile, before.selectedFile);
  const moved = before.course?.id !== after.course?.id || before.course?.i !== after.course?.i;
  const course = moved ? open('course', stopPath(after), stopPath(before)) : t.course;
  return diff === t.diff && course === t.course ? t : { diff, course };
}

function reduceAll(state: AppState, command: Command): Reduced {
  switch (command.id) {
    case 'analyses.loaded': {
      const next = { ...state, analyses: command.analyses };
      // 一度も解析していなければ、最初から PR 一覧（解析する PR を選ぶところから始める）
      if (command.analyses.length === 0 && state.analysis === null && state.view !== 'prs') return fetchPrs({ ...next, view: 'prs' });
      return none(next);
    }
    case 'view.prs':
      return fetchPrs({ ...state, view: 'prs', peek: null });
    case 'prs.refresh':
      return refreshPrs(state);
    case 'prs.loaded': {
      // 開いていた PR が閉じた・マージされた（一覧から消えた）ら、詳細も閉じる
      const open = state.prs.detail;
      const detail = open !== null && command.list.prs.some((p) => p.number === open.number) ? open : null;
      return none({ ...state, prs: { ...state.prs, list: command.list, loading: false, error: null, detail } });
    }
    case 'prs.failed':
      return none({ ...state, prs: { ...state.prs, loading: false, error: command.reason } });
    case 'prs.filter': {
      const { mine = state.prs.filter.mine, drafts = state.prs.filter.drafts } = command;
      return none({ ...state, prs: { ...state.prs, filter: { mine, drafts } } });
    }
    case 'pr.analyze': {
      const { key, from, now } = command;
      if (isActive(jobOf(state.reanalyze.jobs, key))) return none(state);
      return { state: { ...state, reanalyze: { ...state.reanalyze, jobs: enqueue(state.reanalyze.jobs, key, from, now) } }, effects: [{ type: 'startAnalyze', key, ...(from === undefined ? {} : { from }) }] };
    }
    case 'pr.detail':
      if (state.prs.detail?.number === command.number) return none({ ...state, prs: { ...state.prs, detail: null } });
      return fetchDetail({ ...state, prs: { ...state.prs, detail: { number: command.number, tab: 'desc' } } }, command.number);
    case 'pr.detail.tab':
      return state.prs.detail === null ? none(state) : none({ ...state, prs: { ...state.prs, detail: { ...state.prs.detail, tab: command.tab } } });
    case 'pr.detail.refresh':
      return state.prs.detail === null ? none(state) : fetchDetail(state, state.prs.detail.number);
    case 'prDetail.loaded':
      return none(withDetail(state, command.number, { data: command.detail, loading: false, error: null }));
    case 'prDetail.failed':
      return none(withDetail(state, command.number, { data: state.prs.details[command.number]?.data ?? null, loading: false, error: command.reason }));
    case 'pr.github': {
      const url = state.prs.list?.prs.find((p) => p.number === command.number)?.url;
      return url === undefined ? none(state) : { state, effects: [{ type: 'openTab', url }] };
    }
    case 'pr.open':
      if (state.current?.key === command.key && state.current.headSha === command.headSha) return none({ ...state, view: 'home', ...LEAVE });
      return { state, effects: [{ type: 'loadAnalysis', key: command.key, headSha: command.headSha }] };
    case 'pr.review':
      if (reviewActive(state.reviews.find((j) => j.key === command.key))) return none(state);
      return { state, effects: [{ type: 'startReview', key: command.key, headSha: command.headSha }] };
    case 'pr.review.stop':
      return { state, effects: [{ type: 'stopReview', key: command.key }] };
    case 'pr.drafts':
      // 今開いている解析でも読み直す（開いている間に AI が足した下書きを並べる）
      return { state, effects: [{ type: 'loadAnalysis', key: command.key, headSha: command.headSha, view: 'closing' }] };
    case 'review.jobs': {
      const reviews = mergeJobs(state.reviews, command.jobs);
      // 今開いている解析のレビューが終わったら、その下書きを並べる
      const cur = state.current;
      const mine = cur ? reviews.find((j) => j.key === cur.key) : undefined;
      const ended = cur !== null && mine?.status === 'done' && mine.headSha === cur.headSha && reviewActive(state.reviews.find((j) => j.key === cur.key));
      return { state: { ...state, reviews }, effects: ended ? [{ type: 'loadComments', key: cur.key, headSha: cur.headSha }] : [] };
    }
    case 'review.startFailed': {
      const { key, headSha, reason } = command;
      return none({ ...state, reviews: [...state.reviews.filter((j) => j.key !== key), { status: 'failed', key, headSha, reason }] });
    }
    case 'ui.loaded': {
      // 2026-10-22 より前の ui.json のテーマは古い形（{ flavor, accent }）。読み替えておけば、次の保存で新しい形になる
      const { theme, ...rest } = command.ui;
      const parsed = parseTheme(theme);
      return none({ ...state, ui: parsed === undefined ? rest : { ...rest, theme: parsed } });
    }
    case 'config.loaded':
      return none({ ...state, config: command.config });
    case 'data.loaded': {
      const review = normalizeReview(command.review);
      const files = groupFiles(command.analysis.hunks, review.viewed, state.config?.packagePrefix);
      const first = files[0];
      // 入口（全体図の地図タブ。3.1）に着く。会話の記録を取りに行き、前の解析で待っていた問いは止める。新しい head も聞く（3.0）
      // GitHub の Viewed も読みにいく（12.1。local は PR が無いので読まない）
      const { key, headSha } = command.summary;
      const effects: Effect[] = [
        ...(state.ask.pending ? [{ type: 'askStop' } as const] : []),
        { type: 'loadAsk', key, headSha },
        ...(key === 'local' ? [] : [{ type: 'githubRead', key, headSha, quiet: false } as const]),
        { type: 'checkLatest', key, headSha },
      ];
      // 同じ PR のバージョン（解析し直して切り替えた・同じ版を解析し直した・左上で選んだ）なら、今の画面と選んでいるファイルのまま。コースにいれば同じコースの最初の未確認の停留所へ
      const keep = sameVersionPlace(state, command.summary, command.analysis, review, files);
      return { effects, state: {
        ...state,
        view: command.view ?? keep?.view ?? 'home',
        home: { tab: 'text', sel: null, ticket: false, stage: 1, path: [], step: 0, play: false, behavior: null, mode: 'map', args: false },
        memo: NO_MEMO,
        draftText: {},
        current: command.summary,
        analysis: command.analysis,
        review,
        selectedFile: keep?.selectedFile ?? first?.path ?? null,
        selectedHunk: keep?.selectedHunk ?? first?.hunks[0]?.id ?? null,
        diffFile: null,
        selectedHow: keep?.selectedHow ?? null,
        openGroups: [],
        course: keep?.course ?? null,
        courseMap: null,
        fullFile: false,
        fold: {},
        peek: null,
        rel: null,
        def: null,
        defBack: [],
        // 前の解析のシンボルを起点にした一覧を残さない
        showPalette: false,
        paletteFrom: null,
        send: { status: 'idle' },
        github: { ...NO_GITHUB, seq: state.github.seq },
        // 「解析し直しました」は、解析し直した版を読み直したときだけ残す（別の版を開いてから戻ったときには出さない）
        reanalyze: { ...state.reanalyze, redone: state.reanalyze.redone?.key === key && state.reanalyze.redone.headSha === headSha ? state.reanalyze.redone : null },
        ask: NO_ASK,
        focusLine: null,
        treeShut: NO_TREE,
      } };
    }
    case 'analysis.select':
      return { state, effects: [{ type: 'loadAnalysis', key: command.key, headSha: command.headSha }] };
    case 'reanalyze.check':
      if (!state.current || isRunning(state)) return none(state);
      return { state, effects: [{ type: 'checkLatest', key: state.current.key, headSha: state.current.headSha }] };
    case 'reanalyze.checked':
      if (state.current?.key !== command.key || state.current.headSha !== command.headSha) return none(state);
      return none({ ...state, reanalyze: { ...state.reanalyze, latest: command.latest === null ? null : { key: command.key, headSha: command.headSha, head: command.latest } } });
    case 'reanalyze.start': {
      if (!state.current || isRunning(state)) return none(state);
      const { key, headSha } = state.current;
      return { state: { ...state, reanalyze: { ...state.reanalyze, jobs: enqueue(state.reanalyze.jobs, key, headSha, command.now) } }, effects: [{ type: 'startAnalyze', key, from: headSha }] };
    }
    case 'reanalyze.job': {
      const jobs = mergeJobs(state.reanalyze.jobs, command.jobs);
      const done = finished(state.reanalyze.jobs, jobs);
      const next = { ...state, reanalyze: { ...state.reanalyze, jobs } };
      if (done.length === 0) return none(next);
      const cur = state.current;
      const mine = cur ? done.find((j) => j.key === cur.key) : undefined;
      if (!cur || mine?.status !== 'done') return { state: next, effects: [{ type: 'refreshAnalyses' }] };
      if (mine.headSha === cur.headSha) {
        return { state: { ...next, reanalyze: { ...next.reanalyze, redone: { key: cur.key, headSha: cur.headSha } } }, effects: [{ type: 'refreshAnalyses' }, { type: 'loadAnalysis', key: cur.key, headSha: cur.headSha }] };
      }
      // 今の PR の解析ができた。聞き直すまでは変わった差分の数が無いまま「できた」を出す
      const latest = { key: cur.key, headSha: cur.headSha, head: { headSha: mine.headSha, analyzed: true } };
      return { state: { ...next, reanalyze: { ...next.reanalyze, latest } }, effects: [{ type: 'refreshAnalyses' }, { type: 'checkLatest', key: cur.key, headSha: cur.headSha }] };
    }
    case 'reanalyze.startFailed': {
      const { key, from, reason } = command;
      const failed = { status: 'failed' as const, ...(from === undefined ? { key } : { key, from }), reason };
      return none({ ...state, reanalyze: { ...state.reanalyze, jobs: [...state.reanalyze.jobs.filter((j) => j.key !== key), failed] } });
    }
    case 'reanalyze.switch': {
      const l = state.reanalyze.latest;
      const cur = state.current;
      if (!cur || !l || l.key !== cur.key || l.headSha !== cur.headSha || !l.head.analyzed || l.head.headSha === cur.headSha) return none(state);
      return { state, effects: [{ type: 'switchTo', key: cur.key, headSha: l.head.headSha }] };
    }
    case 'reanalyze.dismiss':
      if (state.reanalyze.redone !== null) return none({ ...state, reanalyze: { ...state.reanalyze, redone: null } });
      if (!state.review?.carried || state.review.carried.dismissed) return none(state);
      return { state: { ...state, review: { ...state.review, carried: { ...state.review.carried, dismissed: true } } }, effects: [{ type: 'saveState' }] };
    case 'view.home':
      return none({ ...state, view: 'home', ...LEAVE });
    case 'view.hows':
      return none({ ...state, view: 'hows', peek: null });
    case 'view.diff':
      return none({ ...state, view: 'diff', peek: null });
    case 'view.closing':
      return none({ ...state, view: 'closing', peek: null });
    case 'view.course':
      return state.course === null ? none(state) : none({ ...state, view: 'course', peek: null });
    case 'home.tab':
      return state.view === 'home' ? none({ ...state, home: { ...state.home, tab: command.tab, play: false } }) : none(state);
    case 'home.ticket':
      return none({ ...state, home: { ...state.home, ticket: !state.home.ticket } });
    case 'home.stage':
      if (state.view !== 'home') return none(state);
      return none({ ...state, home: { ...state.home, tab: 'text', stage: command.stage ?? (state.home.stage === 1 ? 2 : 1) } });
    case 'settings.open': {
      // 重なる物（キーマップ表示・パレット）とは同時に開かない
      const settings = command.tab ?? (state.settings === null ? 'general' : null);
      return none({ ...state, settings, showPalette: false, showKeymap: false });
    }
    case 'settings.tab':
      return state.settings === null ? none(state) : none({ ...state, settings: command.tab });
    case 'settings.close':
      return none({ ...state, settings: null });
    case 'palette.open':
      // 解析が読めていないうちは開かない（見えないまま true になり、届いた瞬間に不意に開くのを避ける）
      if (!state.analysis) return none(state);
      // キーマップ表示・設定とは同時に開かない（同じ .overlay が重なる）
      return none({ ...state, showPalette: !state.showPalette, paletteFrom: null, showKeymap: false, settings: null });
    case 'palette.close':
      return none({ ...state, showPalette: false });
    case 'help.keymap':
      return none({ ...state, showKeymap: !state.showKeymap, showPalette: false, settings: null });
    case 'escape':
      // 上に重なっているものから順に閉じる: キーマップ表示 → パレット → 設定 → 地図の引き出し → 覗く → How の絞り込み。PR 一覧では PR の詳細を閉じるだけ。
      // 最後は入口へ（目的ごと・差分一覧・締めの画面は、コースから来ていればそのコースへ戻る）。入口では選んだコースを外す
      if (state.showKeymap) return none({ ...state, showKeymap: false });
      if (state.showPalette) return none({ ...state, showPalette: false });
      if (state.settings !== null) return none({ ...state, settings: null });
      if (state.ask.open) return none({ ...state, ask: { ...state.ask, open: false, ...NO_MEMO_ASK } });
      if (state.find.open && findable(state)) return none({ ...state, find: { ...state.find, open: false } });
      if (state.memo.pick !== null || state.memo.editing !== null) return none({ ...state, memo: NO_MEMO });
      // 差分の無い相手の引き出しと定義の引き出しは、読んでいた差分に戻るだけ（コースは出ない）
      if (state.rel !== null) return none({ ...state, rel: null });
      if (state.def !== null) return none({ ...state, def: null });
      if (state.view === 'prs') return state.prs.detail === null ? none(state) : none({ ...state, prs: { ...state.prs, detail: null } });
      if (state.view === 'course') {
        if (state.courseMap !== null) return none({ ...state, courseMap: null });
        if (state.peek !== null) return none({ ...state, peek: null });
        return none({ ...state, view: 'home', ...LEAVE });
      }
      if (state.view === 'hows' && state.selectedHow !== null) return none({ ...state, selectedHow: null });
      if (state.view === 'hows' || state.view === 'diff' || state.view === 'closing') return none(state.course === null ? { ...state, view: 'home' } : { ...state, view: 'course', peek: null });
      // 入口の地図: まず 1 段上へ。全景ならコースを外す（2026-11-04）
      if (state.home.tab === 'map' && state.home.path.length > 0) return none({ ...state, home: { ...state.home, path: state.home.path.slice(0, -1) } });
      return none({ ...state, home: { ...state.home, sel: null, behavior: null, mode: 'map', step: 0, play: false } });
    case 'map.zoom':
      return none({ ...state, mapZoom: command.zoom });
    case 'map.speed':
      return { state: { ...state, ui: { ...state.ui, mapSpeed: snapSpeed(command.speed) } }, effects: [{ type: 'saveUi' }] };
    case 'map.enter': {
      // 入口の地図のまとまりの中へ（札からはそのまとまりへ）。木に無い id と入口の外では何もしない
      const mg = state.analysis?.mapGroups;
      const path = mg && state.view === 'home' ? pathTo(groupTree(mg), command.group) : null;
      return path === null ? none(state) : none({ ...state, home: { ...state.home, tab: 'map', path } });
    }
    case 'ask.toggle':
    case 'ask.close':
    case 'ask.draft':
    case 'ask.send':
    case 'ask.retry':
    case 'ask.stop':
    case 'ask.done':
    case 'ask.failed':
    case 'ask.loaded':
    case 'ask.lines':
    case 'ask.whole':
    case 'ask.memoCancel':
    case 'ask.top':
    case 'ask.bottom':
      return askCommand(state, command);
    case 'ui.worktreeRoot':
      return { state: { ...state, ui: withUi(state.ui, 'worktreeRoot', command.value) }, effects: [{ type: 'saveUi' }] };
    case 'ui.llmCommand':
      return { state: { ...state, ui: withUi(state.ui, 'llmCommand', command.value) }, effects: [{ type: 'saveUi' }] };
    case 'ui.reviewCommand':
      return { state: { ...state, ui: withUi(state.ui, 'reviewCommand', command.value) }, effects: [{ type: 'saveUi' }] };
    case 'ui.ticket':
      return { state: { ...state, ui: withTicket(state.ui, command.field, command.value) }, effects: [{ type: 'saveUi' }] };
    case 'ui.keymap':
      return { state: { ...state, ui: withKeymap(state.ui, keymapWith(state.ui.keymap, command.changes)) }, effects: [{ type: 'saveUi' }] };
    case 'ui.keymap.reset':
      return { state: { ...state, ui: withKeymap(state.ui, undefined) }, effects: [{ type: 'saveUi' }] };
    case 'ui.pane':
      return { state: { ...state, ui: withPane(state.ui, command.pane, command.px) }, effects: [{ type: 'saveUi' }] };
    // 画面の設定は解析が無くても変えられる（ui.json に入る。2026-10-11）
    case 'theme.mode':
      return withTheme(state, { mode: command.mode });
    case 'theme.light':
      return withTheme(state, { light: command.flavor });
    case 'theme.dark':
      return withTheme(state, { dark: command.flavor });
    case 'theme.accent':
      return withTheme(state, { accent: command.accent });
    case 'diff.mode.sbs':
    case 'diff.mode.unified': {
      // 今いる画面の設定に効く（鍵は How 分解のプレビューが b、コースの停留所の画面が c、差分一覧が d）。他の画面では何もしない
      const key = state.view === 'hows' ? 'b' : state.view === 'diff' ? 'd' : state.view === 'course' && state.course?.screen === 'stop' ? 'c' : null;
      if (key === null) return none(state);
      const mode = command.id === 'diff.mode.sbs' ? 'sbs' : 'uni';
      return { state: { ...state, ui: { ...state.ui, diffMode: { ...state.ui.diffMode, [key]: mode } } }, effects: [{ type: 'saveUi' }] };
    }
    default:
      break;
  }
  if (!state.analysis || !state.review || (state.view === 'prs' && NOT_ON_PRS.has(command.id))) return none(state);
  return reduceLoaded(state as Loaded, command);
}

type Loaded = AppState & { analysis: Analysis; review: ReviewState };

/** コースの今の停留所。コースに入っていなければ null */
export function currentStop(state: AppState): Step | null {
  if (!state.analysis || !state.course) return null;
  return courseOf(courses(state.analysis), state.course.id)?.steps[state.course.i] ?? null;
}

/** 停留所の hunk（Step.hunkId、無ければシンボルの hunkId） */
function stopHunk(state: Loaded, step: Step | null): string | null {
  if (!step) return null;
  return step.hunkId ?? state.analysis.symbols.find((s) => s.id === step.symbolId)?.hunkId ?? null;
}

/**
 * コースの画面では、v と「IDEAで開く」は出ている hunk（覗いている箱、無ければ今の停留所）に効く（差分が無ければ何もしない）。
 * 覗いているファイルは、その行の hunk か、そのファイルの最初の hunk（差分一覧でファイルを選んだときと同じ）
 */
function targetHunk(state: Loaded): string | null {
  if (state.view === 'course' && state.course !== null) {
    const p = state.peek;
    if (p?.kind === 'symbol') return state.analysis.symbols.find((s) => s.id === p.symbolId)?.hunkId ?? null;
    if (p?.kind === 'file') return (p.line && hunkAt(state.analysis.hunks, p.path, p.line.line, p.line.side)?.id) ?? state.analysis.hunks.find((h) => h.path === p.path)?.id ?? null;
    return stopHunk(state, currentStop(state));
  }
  return state.selectedHunk;
}

/** コースの場所を移す。覗く・地図の引き出し・ファイル全体は閉じる。hunk があれば選ぶ（目的ごと・差分一覧の画面へ移っても同じ hunk が選ばれている） */
function toStop(state: Loaded, at: CourseAt): Loaded {
  const step = courseOf(courses(state.analysis), at.id)?.steps[at.i];
  const hunk = state.analysis.hunks.find((h) => h.id === stopHunk(state, step ?? null));
  return { ...state, view: 'course', course: at, peek: null, courseMap: null, fullFile: false, rel: null, ...(hunk ? { selectedFile: hunk.path, selectedHunk: hunk.id } : {}) };
}

/** 「開く」の行き先の停留所の画面。full ならファイル全体（メモの行が前後 3 行の外にある）。メモの行までスクロールする印（focus）を付ける */
function openStop(state: Loaded, courseId: number, i: number, full: boolean, mark: (s: AppState) => AppState): Reduced {
  const r = enterCourse({ ...state, peek: null }, courseId, i);
  if (r.state.view !== 'course') return r;
  return none(mark({ ...r.state, fullFile: full }));
}

/** at を省くと読む前の案内（コース外は最初の未確認の停留所）、at を渡すとその停留所 */
function enterCourse(state: Loaded, courseId: number, at?: number): Reduced {
  const course = courseOf(courses(state.analysis), courseId);
  if (!course || course.steps.length === 0) return none(state);
  const i = at === undefined ? firstUnseen(state.analysis, course, state.review) : Math.min(Math.max(at, 0), course.steps.length - 1);
  return none(toStop(state, { id: courseId, i, screen: at === undefined && hasBrief(courseId) ? 'brief' : 'stop' }));
}

/** 今の停留所に問題なしを付ける（トグルしない）。差分があれば viewed、無ければ course.done */
function markStop(state: Loaded): { state: Loaded; changed: boolean } {
  const step = currentStop(state);
  if (!step || !state.course) return { state, changed: false };
  const hunkId = stopHunk(state, step);
  if (hunkId !== null) {
    if (state.review.viewed.includes(hunkId)) return { state, changed: false };
    return { state: { ...state, review: { ...state.review, viewed: [...state.review.viewed, hunkId] } }, changed: true };
  }
  const key = doneKey(state.course.id, step.symbolId);
  const course = state.review.course ?? { done: [], completed: [] };
  if (course.done.includes(key)) return { state, changed: false };
  return { state: { ...state, review: { ...state.review, course: { ...course, done: [...course.done, key] } } }, changed: true };
}

function courseCommand(state: Loaded, command: Command): Reduced | null {
  // 目的ごと・差分一覧・締めの画面の state.course は Esc で戻る先。そこではコースの操作を効かせない
  const at = state.view === 'course' ? state.course : null;
  const course = at ? courseOf(courses(state.analysis), at.id) : undefined;
  switch (command.id) {
    case 'course.enter':
      return enterCourse(state, command.courseId, command.at);
    case 'course.leave':
      return none({ ...state, view: 'home', ...LEAVE });
    case 'course.again':
      return at ? none(toStop(state, { id: at.id, i: 0, screen: hasBrief(at.id) ? 'brief' : 'stop' })) : none(state);
    case 'course.brief':
      if (!at || !hasBrief(at.id)) return none(state);
      return none(toStop(state, { id: at.id, i: at.i, screen: 'brief' }));
    case 'course.check': {
      if (!at || at.screen === 'summary') return none(state);
      const { check, ...rest } = at;
      return none({ ...state, course: check === command.n ? rest : { ...rest, check: command.n } });
    }
    // 地図・ファイル全体・右の列をたたむは停留所の画面で効く。読む前の案内と総括では何もしない
    case 'course.map':
      if (!at || at.screen !== 'stop') return none(state);
      return none({ ...state, courseMap: state.courseMap === null ? 'side' : null, rel: null, def: null });
    case 'course.mapBig':
      if (!at || at.screen !== 'stop') return none(state);
      return none({ ...state, courseMap: state.courseMap === 'big' ? 'side' : 'big', rel: null, def: null });
    case 'find.open':
      // 開いていればもう一度検索欄へ（入れた文字は選んだ状態）。閉じて開き直したときも前の文字を残す（ブラウザのページ内検索と同じ）
      if (!findable(state)) return none(state);
      return none({ ...state, find: { ...state.find, open: true, n: state.find.n + 1 } });
    case 'find.query':
      return none({ ...state, find: { ...state.find, query: command.text, at: 0 } });
    case 'find.next':
    case 'find.prev':
      if (!state.find.open || state.find.query === '') return none(state);
      return none({ ...state, find: { ...state.find, at: state.find.at + (command.id === 'find.next' ? 1 : -1) } });
    case 'find.close':
      return state.find.open ? none({ ...state, find: { ...state.find, open: false } }) : none(state);
    case 'file.full':
      // 差分一覧・目的ごとの画面は畳んだ帯を全部開く / 畳み直す（2026-10-13）。停留所はファイル全体 / 前後だけ。他の画面と総括では何もしない
      if (state.view === 'diff' || state.view === 'hows') return none({ ...state, fullFile: !state.fullFile });
      if (!at || at.screen !== 'stop') return none(state);
      return none({ ...state, fullFile: !state.fullFile });
    case 'course.fold':
      if (!at || at.screen !== 'stop') return none(state);
      return none({ ...state, courseFolded: !state.courseFolded });
    case 'course.jump':
      if (!at || !course || command.i < 0 || command.i >= course.steps.length) return none(state);
      return none(toStop(state, { id: at.id, i: command.i, screen: 'stop' }));
    case 'course.ok': {
      if (at?.screen === 'brief' && course) return none(toStop(state, { id: at.id, i: firstUnseen(state.analysis, course, state.review), screen: 'stop' }));
      if (!at || !course || at.screen !== 'stop') return none(state);
      const marked = markStop(state);
      const last = at.i === course.steps.length - 1;
      const next = toStop(marked.state, last ? { ...at, screen: 'summary' } : { id: at.id, i: at.i + 1, screen: 'stop' });
      return { state: next, effects: marked.changed ? [{ type: 'saveState' }] : [] };
    }
    case 'course.prev': {
      if (!at && routeLen(state) !== null) return none(withStep(state, state.home.step - 1));
      if (!at || at.screen === 'brief') return none(state);
      if (at.screen === 'summary') return none(toStop(state, { id: at.id, i: at.i, screen: 'stop' }));
      if (at.i > 0) return none(toStop(state, { id: at.id, i: at.i - 1, screen: 'stop' }));
      return hasBrief(at.id) ? none(toStop(state, { id: at.id, i: 0, screen: 'brief' })) : none(state);
    }
    case 'course.complete': {
      if (!at) return none(state);
      const progress = state.review.course ?? { done: [], completed: [] };
      const completed = at.id === OUTSIDE || progress.completed.includes(at.id) ? progress.completed : [...progress.completed, at.id];
      const saved: Loaded = { ...state, review: { ...state.review, course: { ...progress, completed } } };
      const nx = nextCourse(courses(state.analysis), saved.review);
      // 次が無ければ（最後のコース）締めへ。コースは出る
      const moved = nx ? enterCourse(saved, nx.id).state : { ...saved, view: 'closing' as const, ...LEAVE };
      return { state: moved as Loaded, effects: [{ type: 'saveState' }] };
    }
    case 'course.forward':
      // 入口の地図で道順を見ているときは次の歩へ（コースに入るのは Enter と「入る」。2026-11-04）
      if (!at && routeLen(state) !== null) return none(withStep(state, state.home.step + 1));
      if (!at) return state.view === 'home' ? startHome(state) : none(state);
      if (at.screen !== 'summary') return courseCommand(state, { id: 'course.ok' });
      return courseCommand(state, { id: 'course.complete' });
    default:
      return null;
  }
}

/** 入口で進む: 選んだコース、無ければ未完了の最初のコースに入る。全部完了なら締めへ（コースが無くコース外だけなら、コース外に入る） */
/** 入口の地図で選んだコースの道順の歩の数。地図タブで、まとまりのある解析でコースを選んでいるときだけ（それ以外は null） */
function routeLen(state: Loaded): number | null {
  const mg = state.analysis.mapGroups;
  if (state.view !== 'home' || state.home.tab !== 'map' || !mg) return null;
  if (state.home.behavior !== null) {
    // 動きの歩は 1 歩目（呼び出し元 → 始まり）+ 呼び出しの数（behaviorSteps と同じ）
    const b = state.analysis.behaviors?.find((x) => x.id === state.home.behavior);
    return b ? b.messages.length + 1 : null;
  }
  if (state.home.sel === null) return null;
  const c = courseOf(courses(state.analysis), state.home.sel);
  return c ? mapRouteOf(state.analysis, groupTree(mg), c).steps.length : null;
}

/** 道順の歩へ（0〜歩の数に収める）。手で動かしたので再生は止める */
function withStep(state: Loaded, to: number): Loaded {
  const n = routeLen(state) ?? 0;
  return { ...state, home: { ...state.home, step: Math.max(0, Math.min(n, to)), play: false } };
}

function startHome(state: Loaded): Reduced {
  if (state.home.sel !== null) return enterCourse(state, state.home.sel);
  const all = courses(state.analysis);
  const nx = nextCourse(all, state.review);
  if (nx) return enterCourse(state, nx.id);
  if (all.some((c) => c.id !== OUTSIDE)) return none({ ...state, view: 'closing', ...LEAVE });
  return all[0] ? enterCourse(state, all[0].id) : none(state);
}

/** URL の画面（route.go）へ。画面を移すコマンドと同じ処理で移る。無いコース・停留所・目的・ファイルは入口の説明タブ */
function goTo(state: Loaded, page: Page): Reduced {
  const via = (...commands: Command[]): Reduced =>
    commands.reduce((r, c) => {
      const next = reduceAll(r.state, c);
      return { state: next.state, effects: [...r.effects, ...next.effects] };
    }, none(state));
  const explain = () => via({ id: 'view.home' }, { id: 'home.tab', tab: 'text' });
  switch (page.kind) {
    case 'explain':
      return explain();
    case 'map':
      return via({ id: 'view.home' }, { id: 'home.tab', tab: 'map' });
    case 'hows': {
      if (page.how !== null && !state.analysis.hows.some((h) => h.id === page.how)) return explain();
      const r = via({ id: 'view.hows' });
      return { ...r, state: { ...r.state, selectedHow: page.how } };
    }
    case 'course': {
      const n = courseOf(courses(state.analysis), page.course)?.steps.length ?? 0;
      if (n === 0) return explain();
      if (page.at.kind === 'brief') return enterCourse(state, page.course);
      if (page.at.kind === 'summary') return none(toStop(state, { id: page.course, i: n - 1, screen: 'summary' }));
      return page.at.i >= 0 && page.at.i < n ? enterCourse(state, page.course, page.at.i) : explain();
    }
    case 'diff':
      if (page.file === null) return via({ id: 'view.diff' });
      return state.analysis.hunks.some((h) => h.path === page.file) ? via({ id: 'view.diff' }, { id: 'file.select', path: page.file }) : explain();
    case 'closing':
      return via({ id: 'view.closing' });
  }
}

function withReview(state: Loaded, review: ReviewState): Reduced {
  return { state: { ...state, review }, effects: [{ type: 'saveState' }] };
}

function select(state: Loaded, hunkId: string): Reduced {
  const hunk = state.analysis.hunks.find((h) => h.id === hunkId);
  if (!hunk) return none(state);
  return none({ ...state, selectedFile: hunk.path, selectedHunk: hunk.id });
}

/** ファイルとその最初の hunk を選ぶ。差分一覧ではそのファイルの見出しを一番上へ（同じファイルを押し直しても戻す） */
function selectFile(state: Loaded, path: string): Reduced {
  const file = groupFiles(state.analysis.hunks, state.review.viewed, state.config?.packagePrefix).find((f) => f.path === path);
  if (!file) return none(state);
  const first = file.hunks[0]?.id ?? null;
  return none({ ...state, selectedFile: path, selectedHunk: first, diffFile: path, diffJump: { hunkId: first, to: 'file', n: state.diffJump.n + 1 } });
}

function updateComment(state: Loaded, id: string, patch: Partial<CommentDraft>): Reduced {
  const comments = state.review.comments.map((c) => (c.id === id ? { ...c, ...patch } : c));
  return withReview(state, { ...state.review, comments });
}

/** AI の下書きを直し終えた（採用・戻す・破棄）。直している途中の文を消す */
function decideDraft(state: Loaded, id: string, patch: Partial<CommentDraft>): Reduced {
  if (!(id in state.draftText)) return updateComment(state, id, patch);
  const draftText = Object.fromEntries(Object.entries(state.draftText).filter(([k]) => k !== id));
  return updateComment({ ...state, draftText }, id, patch);
}

/**
 * 送れるのは、送れる採用が 1 件以上あり、送信中でないとき（local は GitHub でなく AI に返す。12 章）。
 * GitHub の差分に出ない行の採用は送らない（GitHub がコメントを付けられない）ので数えない
 */
export function canSend(state: AppState): boolean {
  const diff = state.analysis?.githubDiff;
  return state.current !== null && state.send.status !== 'sending' && (state.review?.comments.some((c) => c.state === 'adopted' && onGithubDiff(diff, c) !== false) ?? false);
}

/** 右下の通知を出す（前の通知は置き換える）。番号を進める */
function withToast<S extends AppState>(state: S, toast: Omit<GithubToast, 'n'>): S {
  const seq = state.github.seq + 1;
  return { ...state, github: { ...state.github, seq, toast: { ...toast, n: seq } } };
}

/**
 * 同じ解析のまま問題なしが変わったら、GitHub の Viewed に付ける（ファイルの差分が新しく全部になった）・外す（全部でなくなった）副作用を足す（12.1）。
 * 解析を開いたとき（前からある問題なし）は送らない。local は PR が無いので送らない
 */
function withGithubSet(before: AppState, r: Reduced): Reduced {
  const after = r.state;
  if (!before.review || !after.review || before.review.viewed === after.review.viewed || before.analysis !== after.analysis || !after.analysis) return r;
  if (!after.current || after.current !== before.current || after.current.key === 'local') return r;
  const change = viewedChange(after.analysis.hunks, before.review.viewed, after.review.viewed);
  if (change.mark.length === 0 && change.unmark.length === 0) return r;
  const { key, headSha } = after.current;
  return { ...r, effects: [...r.effects, { type: 'githubSet', key, headSha, ...change, retried: false }] };
}

/** 送信の結果が、いま選んでいる解析のものか。送信中に切り替えると遅れて来た結果が別の解析に載るので捨てる */
function isCurrent(state: Loaded, target: { key: string; headSha: string }): boolean {
  return state.current?.key === target.key && state.current.headSha === target.headSha;
}

/** j / k で通る hunk id の列。How 分解の画面ではその並び（絞り込み・束の開閉を反映）、それ以外は path 順 */
function hunkOrder(state: Loaded, files: ReturnType<typeof groupFiles>): string[] {
  if (state.view === 'hows') return navigable(howRows(state.analysis, state.review.viewed, state.openGroups, state.selectedHow));
  return files.flatMap((f) => f.hunks.map((h) => h.id));
}

/** hunk が属する追従グループの代表 id（束に属さなければ null） */
function groupKeyOf(state: Loaded, hunkId: string | null): string | null {
  const hunk = state.analysis.hunks.find((h) => h.id === hunkId);
  return hunk?.kind === 'ripple' && hunk.group ? hunk.group.representative : null;
}

/**
 * コマンドパレット（18.2）で選んだ先へ飛ぶ。パレットは必ず閉じる。
 * hunk は「選んだ先が必ず見えている」ようにする: hunk を映さない画面なら差分一覧へ移り、
 * 畳んだ束の中なら束を開き、How の絞り込みが効いていれば解除する。
 */
function pick(state: Loaded, target: PaletteTarget): Reduced {
  const closed = { ...state, showPalette: false, peek: null };
  if (target.kind === 'how') return none({ ...closed, view: 'hows', selectedHow: target.howId });
  if (target.kind === 'file') return none({ ...selectFile(closed, target.path).state, view: 'diff', showPalette: false });
  if (target.kind === 'callee') {
    // 3.6 の分岐。今のコースの停留所 → 別のコースの停留所 → How 分解の画面で差分 → 差分の無い相手の引き出し → 何もしない
    const dest = calleeDest(state.analysis, target.symbolId, state.course?.id ?? null);
    if (dest.kind === 'step') {
      const k = courseOf(courses(state.analysis), dest.howId)?.steps.findIndex((s) => s.symbolId === target.symbolId) ?? -1;
      return k < 0 ? none(closed) : enterCourse(closed, dest.howId, k);
    }
    if (dest.kind === 'hunk') return showHunk(closed, dest.hunkId, 'hows');
    if (dest.kind === 'rel' && state.paletteFrom !== null) {
      // 差分の無い相手は、呼んでいる停留所の箱の引き出しでその相手を出す（2026-10-11）
      const rel = openRel(state.analysis, mapNodeOf(state.analysis)(state.paletteFrom), { dir: 'out', sel: target.symbolId, size: state.rel?.size ?? 'side' });
      if (rel !== null) return none({ ...closed, rel, courseMap: null });
    }
    return none(closed);
  }
  const view: View = closed.view === 'hows' || closed.view === 'diff' ? closed.view : 'diff';
  return showHunk(closed, target.hunkId, view);
}

/** hunk を view で見せる。畳んだ束の中なら束を開き、How の絞り込みは解除する */
function showHunk(state: Loaded, hunkId: string, view: View): Reduced {
  const hunk = state.analysis.hunks.find((h) => h.id === hunkId);
  if (!hunk) return none(state);
  const rep = hunk.kind === 'ripple' && hunk.group ? hunk.group.representative : null;
  const openGroups = rep !== null && rep !== hunk.id && !state.openGroups.includes(rep) ? [...state.openGroups, rep] : state.openGroups;
  return none({ ...state, view, selectedHow: null, openGroups, selectedFile: hunk.path, selectedHunk: hunk.id });
}

/** 案内人に聞く（3.10）の引き出しと問い。ask.cite（行の場所）と ask.memo（メモにする）は画面を移すので reduceLoaded */
function askCommand(state: AppState, command: Command): Reduced {
  const ask = state.ask;
  const set = (patch: Partial<AskUi>, effects: Effect[] = []): Reduced => ({ state: { ...state, ask: { ...ask, ...patch } }, effects });
  // 停留所の画面では引き出しを開かず、右の列の入力欄へ（たたんでいれば開く。2026-10-20）
  const show = (patch: Partial<AskUi>): Reduced => (onStop(state) ? none({ ...state, courseFolded: false, ask: { ...ask, ...patch, focusN: ask.focusN + 1 } }) : set({ ...patch, open: true }));
  // 答えが来た印（見えている場所なら reduce の後処理が外す）
  const unread = (key: string) => (ask.unread.includes(key) ? ask.unread : [...ask.unread, key]);
  switch (command.id) {
    case 'ask.toggle': {
      if (ask.open) return set({ open: false, ...NO_MEMO_ASK });
      if (!state.analysis) return none(state);
      // 「+」で選んでいる行があれば、その行について（3.10 の決めごと 2）。停留所の画面の何については今の停留所のまま（右の列が付いていく）
      const place = (state.memo.pick && askLinesPlace(state.analysis, state, state.memo.pick)) || (onStop(state) ? null : askPlace(state.analysis, state));
      return show(place === null ? {} : { place, key: askKey(place), ...NO_MEMO_ASK });
    }
    case 'ask.close':
      return set({ open: false, ...NO_MEMO_ASK });
    case 'ask.lines': {
      const place = state.analysis && state.memo.pick ? askLinesPlace(state.analysis, state, state.memo.pick) : null;
      if (place === null) return none(state);
      return show({ place, key: askKey(place), ...NO_MEMO_ASK });
    }
    case 'ask.whole': {
      const p = ask.place;
      if (p === null || !('lines' in p) || p.lines === undefined) return none(state);
      const place = { ...p };
      delete place.lines;
      return set({ place, key: askKey(place), ...NO_MEMO_ASK });
    }
    case 'ask.memoCancel':
      return set({ memoFor: null });
    case 'ask.draft':
      return set({ draft: command.text });
    case 'ask.send': {
      const question = command.question.trim();
      if (askSeen(state) === null || ask.place === null || ask.key === null || ask.pending !== null || question === '') return none(state);
      return set({ pending: { key: ask.key, place: ask.place, question, startedAt: command.now }, failed: null, draft: '', ...NO_MEMO_ASK }, [{ type: 'ask', key: ask.key, place: ask.place, question }]);
    }
    case 'ask.retry': {
      const f = ask.failed;
      if (f === null || ask.pending !== null) return none(state);
      return set({ pending: { key: f.key, place: f.place, question: f.question, startedAt: command.now }, failed: null }, [{ type: 'ask', key: f.key, place: f.place, question: f.question }]);
    }
    case 'ask.stop':
      return ask.pending === null ? none(state) : set({ pending: null, draft: ask.pending.question }, [{ type: 'askStop' }]);
    case 'ask.done':
      return set({ pending: null, log: [...ask.log, command.entry], unread: unread(command.entry.key) });
    case 'ask.failed': {
      const place = ask.pending?.key === command.key ? ask.pending.place : (ask.place ?? { kind: 'pr' as const });
      return set({ pending: null, failed: { key: command.key, place, question: command.question, reason: command.reason }, unread: unread(command.key) });
    }
    case 'ask.top':
    case 'ask.bottom':
      return set({ scroll: { to: command.id === 'ask.top' ? 'top' : 'bottom', n: ask.scroll.n + 1 } });
    case 'ask.loaded':
      return state.current?.key === command.key && state.current.headSha === command.headSha ? set({ log: command.entries }) : none(state);
    default:
      return none(state);
  }
}

/**
 * 行が見える所へ開く（3.9 の「開く」と 3.10 の行の場所で共用）: courseId があればそのコースでその行が見える停留所 → 差分一覧の hunk →
 * 見える停留所（全部のコース）→ 同じファイルを通る停留所をファイル全体で → 差分の無い相手の引き出し（差分の無いファイル）→ そのファイルの差分一覧（ファイル全体が無い古い解析だけ）。
 * mark は着いた先に付ける印（メモの focus / 行の focusLine）
 */
function openLine(state: Loaded, at: { path: string; side: 'LEFT' | 'RIGHT'; line: number }, courseId: number | undefined, mark: (s: AppState) => AppState): Reduced {
  const course = courseId === undefined ? undefined : courseOf(courses(state.analysis), courseId);
  const place = course ? memoPlace(state.analysis, course, at) : null;
  if (course && place) return openStop(state, course.id, place.k, place.full, mark);
  const hunk = hunkAt(state.analysis.hunks, at.path, at.line, at.side);
  if (hunk) return none(mark(showHunk({ ...state, peek: null }, hunk.id, 'diff').state));
  const stop = memoStop(state.analysis, at);
  if (stop) return openStop(state, stop.courseId, stop.i, stop.full, mark);
  // 差分の無いファイルの行（どの停留所にも見えない）は、差分の無い相手の引き出しでそのファイルを開く（2026-10-11）
  const near = relAt(state.analysis, at.path, at.line);
  const rel = near === null ? null : openRel(state.analysis, near.host, { dir: near.dir, sel: near.sel, size: state.rel?.size ?? 'side' });
  if (rel !== null) return none(mark({ ...state, peek: null, courseMap: null, rel }));
  const opened = selectFile(state, at.path).state;
  return opened === state ? none(state) : none({ ...opened, view: 'diff', peek: null });
}

/**
 * 答えの行の場所（3.10）: 停留所の画面で今の停留所に見える行なら移らない（畳まれていればファイル全体に。覗いていればやめる）。
 * ほかの行は、そのファイルの全文があれば停留所を移らずに覗く（2026-10-20。移ると右の列の会話が替わり、読んでいた答えが消える）。
 * 全文の無い古い解析は「開く」と同じ道で、停留所の画面から出るなら引き出しで同じ会話を出し続ける
 */
function openCite(state: Loaded, cite: AskCite): Reduced {
  const at = { path: cite.path, side: cite.side === 'base' ? ('LEFT' as const) : ('RIGHT' as const), line: cite.line };
  const mark = (s: AppState): AppState => ({ ...s, focusLine: { ...at, ...(cite.endLine === undefined ? {} : { endLine: cite.endLine }), n: (state.focusLine?.n ?? 0) + 1 } });
  const c = state.course;
  if (!onStop(state) || c === null) return openLine(state, at, state.view === 'course' ? (c?.id ?? undefined) : undefined, mark);
  const course = courseOf(courses(state.analysis), c.id);
  const step = course?.steps[c.i];
  const full = state.analysis.files?.some((f) => f.path === at.path) ?? false;
  if (course && step) {
    const back = { ...state, peek: null };
    if (stopShows(state.analysis, course, c.i, at)) return none(mark(back));
    if (stepPath(state.analysis, step) === at.path && full) return none(mark({ ...back, fullFile: true }));
  }
  if (full) return none(mark({ ...state, peek: { kind: 'file', path: at.path, line: { side: at.side, line: at.line } }, courseMap: null, rel: null }));
  const r = openLine(state, at, c.id, mark);
  return onStop(r.state) ? r : { ...r, state: { ...r.state, ask: { ...r.state.ask, open: true } } };
}

/**
 * 答えの「メモにする」（3.10 の決めごと 2）。メモは行に付く物なので、コードの場所の答えだけ。
 * 行について聞いた問い: 選んでいる行が聞いた行ならその書く枠に質問の文を入れる。今の画面にその行が見えればそこで選び直す。
 * どちらでもなければ締めの「開く」と同じ道（openLine）でその行が見える所へ移り、着いた画面の並びで選び直す（その行へスクロール）。
 * 行の無い問いと、行を出せないとき（全文の無い古い解析で差分の外の行）は、行を選ぶ案内（memoFor）を出す（行を勝手に選ばない）
 */
function askMemo(state: Loaded, entryId: string): Reduced {
  const e = state.ask.log.find((x) => x.id === entryId);
  if (!e || !canMemo(e.place, state.analysis.githubDiff)) return none(state);
  const question = e.question;
  const hint = (s: AppState): Reduced => none({ ...s, ask: { ...s.ask, memoFor: { entryId, question }, memoed: null } });
  const lines = e.place.kind === 'symbol' || e.place.kind === 'hunk' || e.place.kind === 'file' ? e.place.lines : undefined;
  if (!lines) return hint(state);
  const filled = (s: AppState, pick: MemoPick, draft: string, flash: boolean): AppState => ({
    ...s,
    memo: { ...s.memo, pick, editing: null, drag: false, hold: undefined, draft },
    ask: { ...s.ask, memoFor: null, memoed: { entryId, label: spanLabel(pickRange(pick)) } },
    ...(flash ? { focusLine: { path: lines.path, side: lines.end.side === 'base' ? ('LEFT' as const) : ('RIGHT' as const), line: lines.end.line, n: (state.focusLine?.n ?? 0) + 1 } } : {}),
  });
  const same = (a: typeof lines, b: typeof lines) => a.path === b.path && a.start.side === b.start.side && a.start.line === b.start.line && a.end.side === b.end.side && a.end.line === b.end.line;
  if (state.memo.pick && same(askLinesOf(state.memo.pick), lines)) return none(filled(state, state.memo.pick, mergeDraft(state.memo.draft, question), false));
  const end = { path: lines.path, side: lines.end.side === 'base' ? ('LEFT' as const) : ('RIGHT' as const), line: lines.end.line };
  /** 行を選べる画面（覗いていない停留所の画面・差分一覧。差分一覧は全部のファイルが 1 本の列にある）と、その画面の並び */
  const screenOf = (s: Loaded): PickScreen | null => {
    if (s.view === 'course' && s.course?.screen === 'stop' && s.peek === null) {
      const course = courseOf(courses(s.analysis), s.course.id);
      return course && (s.fullFile || stopShows(s.analysis, course, s.course.i, end)) ? { kind: 'stop', course, k: s.course.i } : null;
    }
    if (s.view === 'diff') return { kind: 'diff', hunks: groupFiles(s.analysis.hunks, s.review.viewed, s.config?.packagePrefix).find((f) => f.path === lines.path)?.hunks ?? [] };
    return null;
  };
  // 同じ画面で選び直すなら書きかけは消さない（memo.pick と同じ。直していた文は持ち込まない）
  const kept = mergeDraft(state.memo.editing === null ? state.memo.draft : '', question);
  const here = screenOf(state);
  const pickHere = here ? pickFor(state.analysis, here, lines) : null;
  if (pickHere) return none(filled(state, pickHere, kept, true));
  const landed = openLine(state, end, e.place.kind === 'symbol' ? e.place.courseId : undefined, (s) => s).state as Loaded;
  const there = screenOf(landed);
  const pick = there ? pickFor(landed.analysis, there, lines) : null;
  // 移った先では前の画面の書きかけを持ち込まない（画面を移ると書く枠は閉じる。reduce の後始末と同じ）
  return pick ? none(filled(landed, pick, placeMoved(state, landed) ? question : kept, true)) : hint(landed);
}

/**
 * 名前から定義へ（3.6）で、行を光らせて移れるコード欄。diff = 差分一覧の列（hunk の行。全部のファイル）。
 * path = コースの画面（覗いているファイル・覗いている箱・停留所の画面の停留所）と目的ごとの画面（プレビュー）のコード欄の 1 ファイル。
 * null = コードを出していない（入口・読む前の案内・総括など）
 */
type DefColumn = 'diff' | { path: string } | null;

function defColumn(state: Loaded): DefColumn {
  const a = state.analysis;
  if (state.view === 'diff') return 'diff';
  const at = (path: string | null | undefined) => (path === null || path === undefined ? null : { path });
  if (state.view === 'hows') return at(a.hunks.find((h) => h.id === state.selectedHunk)?.path);
  if (state.view !== 'course' || state.course === null) return null;
  const peek = state.peek;
  if (peek?.kind === 'file') return at(peek.path);
  if (peek?.kind === 'symbol') {
    const symbol = a.symbols.find((s) => s.id === peek.symbolId);
    return at(a.hunks.find((h) => h.id === symbol?.hunkId)?.path ?? symbol?.path);
  }
  const step = state.course.screen === 'stop' ? currentStop(state) : null;
  return step === null ? null : at(stepPath(a, step));
}

/**
 * 行き先がコード欄に出ている行なら、その行（光らせる行）。差分一覧は hunk の行（shown）。ほかの画面はコード欄のファイルの head の行
 * （ファイル全体に差分を埋め込んで出す）と、そのファイルの差分の中の base の行。ほかは null（引き出しに出す）
 */
function defLanding(t: DefPlaceTarget, col: Exclude<DefColumn, null>): DefBack | null {
  const shown = t.shown === undefined ? null : { path: t.path, side: t.shown.side, line: t.shown.line };
  if (col === 'diff') return shown;
  if (t.path !== col.path) return null;
  return t.side === 'head' ? { path: t.path, side: 'RIGHT', line: t.line } : shown;
}

/**
 * 名前から定義へ（3.6。2026-10-29。見本を比べて「右に出す」にし、同じ日にコースの画面と目的ごとの画面にも広げた）。
 * 行き先がコード欄に出ている行（defLanding）ならそこへ動かして光らせ（focusLine）、押した行を戻り先に積む。停留所・選んだ差分は動かさない。
 * ほかは右の引き出しに出し、引き出しの中で押せば引き出しの中で積む（コード欄は引き出しに覆われているので、引き出しが開いていれば引き出しの中で押した）。
 * 引き出しは地図・差分のない相手の引き出しと同時に開かない。ライブラリなら右下に知らせるだけ。⇧R（rel.big）は開いている定義の引き出しの大きさを替える
 */
function defCommand(state: Loaded, command: Command): Reduced | null {
  const lit = (at: DefBack): FocusLine => ({ ...at, n: (state.focusLine?.n ?? 0) + 1 });
  switch (command.id) {
    case 'def.go': {
      const col = defColumn(state);
      if (col === null) return none(state);
      const t = defTargetAt(state.analysis, command.side, command.path, command.line, command.col);
      if (t === undefined) return none(state);
      if ('lib' in t) return none(withToast(state, { message: `${command.name} の定義はライブラリの中です`, reason: `${t.lib}（ライブラリのコードは出しません）`, retry: null, tone: 'info' }));
      const land = defLanding(t, col);
      if (land !== null) {
        const back = command.back ?? state.def?.from ?? null;
        return none({ ...state, def: null, defBack: back === null ? state.defBack : [...state.defBack, back], focusLine: lit(land) });
      }
      const stop = { target: t, name: command.name };
      if (state.def !== null) return none({ ...state, def: { ...state.def, stack: [...state.def.stack, stop] } });
      return none({ ...state, rel: null, courseMap: null, def: { stack: [stop], big: false, from: command.back ?? null } });
    }
    case 'def.back': {
      if (state.def !== null) return none({ ...state, def: state.def.stack.length > 1 ? { ...state.def, stack: state.def.stack.slice(0, -1) } : null });
      // 戻り先はコード欄が替わると消える（defMoved）ので、残っていれば今のコード欄の行
      const back = state.defBack.at(-1);
      if (back === undefined) return none(state);
      return none({ ...state, defBack: state.defBack.slice(0, -1), focusLine: lit(back) });
    }
    case 'def.close':
      return none({ ...state, def: null });
    case 'rel.big':
      return state.def === null ? null : none({ ...state, def: { ...state.def, big: !state.def.big } });
    default:
      return null;
  }
}

/** 差分の無い相手の引き出し（2026-10-11）。地図の引き出しとは同時に開かない。見た印は付けない（効果は何も出さない） */
function relCommand(state: Loaded, command: Command): Reduced | null {
  const size = state.rel?.size ?? 'side';
  const open = (host: string, opt: Parameters<typeof openRel>[2]): Reduced => {
    const rel = openRel(state.analysis, host, opt);
    return rel === null ? none(state) : none({ ...state, rel, courseMap: null, def: null });
  };
  /** コースの停留所の画面の今の停留所の箱。ほかの画面では無い */
  const here = (): string | null => {
    const step = onStop(state) ? currentStop(state) : null;
    return step ? mapNodeOf(state.analysis)(step.symbolId) : null;
  };
  switch (command.id) {
    case 'rel.open':
      return open(command.host, { dir: command.dir, layer: command.layer, sel: command.sel, size });
    case 'rel.toggle': {
      if (state.rel !== null) return none({ ...state, rel: null });
      const host = here();
      return host === null ? none(state) : open(host, { size: 'side' });
    }
    case 'rel.big': {
      if (state.rel !== null) return none({ ...state, rel: { ...state.rel, size: state.rel.size === 'big' ? 'side' : 'big' } });
      const host = here();
      return host === null ? none(state) : open(host, { size: 'big' });
    }
    case 'rel.close':
      return none({ ...state, rel: null });
    case 'rel.select':
      if (state.rel === null || !relVisible(state.analysis, state.rel).some((x) => x.id === command.symbolId)) return none(state);
      return none({ ...state, rel: { ...state.rel, sel: command.symbolId } });
    case 'hunk.next':
    case 'hunk.prev':
      // 開いている間の ↑↓ / j / k は次 / 前の相手（停留所は移らない）
      if (state.rel === null) return null;
      return none({ ...state, rel: relMove(state.analysis, state.rel, command.id === 'hunk.next' ? 1 : -1) });
    default:
      return null;
  }
}

function reduceLoaded(state: Loaded, command: Command): Reduced {
  const def = defCommand(state, command);
  if (def !== null) return def;
  const rel = relCommand(state, command);
  if (rel !== null) return rel;
  const files = groupFiles(state.analysis.hunks, state.review.viewed, state.config?.packagePrefix);
  // 覗いている間の 進む / 戻る / 呼んでいる相手 は、読んでいた停留所に戻るだけ（進まない・問題なしを付けない。2026-09-26）
  const back = ['course.ok', 'course.forward', 'course.prev', 'hunk.next', 'hunk.prev', 'jump.callee', 'enter'];
  if (state.peek !== null && state.view === 'course' && back.includes(command.id)) return none({ ...state, peek: null });
  if (command.id === 'enter') {
    if (state.view === 'hows') return reduceLoaded(state, { id: 'group.toggle' });
    // 入口の Enter はコースに入る（→ は地図の道順を進めることがあるので、course.forward を通さない。2026-11-04）
    if (state.view === 'home') return startHome(state);
    if (state.view === 'course') return reduceLoaded(state, { id: 'course.forward' });
    if (state.view === 'closing') return reduceLoaded(state, { id: 'closing.approve' });
    return none(state);
  }
  const moved = courseCommand(state, command);
  if (moved !== null) return moved;
  switch (command.id) {
    case 'hunk.next':
    case 'hunk.prev': {
      if (state.view === 'course') {
        // コースでは停留所を移るだけ（問題なしを付けない）。読む前の案内の次は最初の未確認の停留所、最初の停留所の前は読む前の案内
        if (!state.course) return none(state);
        const next = command.id === 'hunk.next';
        if (state.course.screen === 'brief') return next ? reduceLoaded(state, { id: 'course.ok' }) : none(state);
        if (!next && state.course.screen === 'stop' && state.course.i === 0) return reduceLoaded(state, { id: 'course.prev' });
        return reduceLoaded(state, { id: 'course.jump', i: state.course.i + (next ? 1 : -1) });
      }
      const ordered = hunkOrder(state, files);
      if (ordered.length === 0) return none(state);
      const i = ordered.indexOf(state.selectedHunk ?? '');
      const step = command.id === 'hunk.next' ? 1 : -1;
      // 選択中の hunk が列に無い（絞り込みの外、畳んだ束の中）ときは先頭へ
      const next = i < 0 ? ordered[0]! : ordered[(i + step + ordered.length) % ordered.length]!;
      return select(state, next);
    }
    case 'home.select': {
      if (command.courseId !== OUTSIDE && !courseOf(courses(state.analysis), command.courseId)) return none(state);
      return none({ ...state, home: { ...state.home, sel: state.home.sel === command.courseId ? null : command.courseId, behavior: null, mode: 'map', step: 0, play: false } });
    }
    case 'home.behavior': {
      // 入口の地図で動きを選ぶ。同じ動きでもう一度押すと外す。コースの選びは外す（どちらか 1 つ）
      if (!state.analysis.behaviors?.some((b) => b.id === command.behaviorId)) return none(state);
      const off = state.home.behavior === command.behaviorId;
      return none({ ...state, home: { ...state.home, tab: 'map', sel: null, behavior: off ? null : command.behaviorId, mode: off ? 'map' : state.home.mode, step: 0, play: false } });
    }
    case 'home.mode': {
      if (state.home.behavior === null) return none(state);
      const mode = command.mode ?? (state.home.mode === 'map' ? 'seq' : 'map');
      return none({ ...state, home: { ...state.home, mode } });
    }
    case 'map.args':
      return none({ ...state, home: { ...state.home, args: !state.home.args } });
    case 'map.step':
      return routeLen(state) === null ? none(state) : none(withStep(state, command.to));
    case 'map.play': {
      const n = routeLen(state);
      if (n === null || n === 0) return none(state);
      if (state.home.play) return none({ ...state, home: { ...state.home, play: false } });
      // 最後まで見ていれば 1 歩目から（見本 5）
      const step = state.home.step >= n ? 1 : state.home.step + 1;
      return none({ ...state, home: { ...state.home, step, play: true } });
    }
    case 'map.tick': {
      const n = routeLen(state);
      if (n === null || !state.home.play) return none(state);
      return none({ ...state, home: { ...state.home, ...(state.home.step >= n ? { play: false } : { step: state.home.step + 1 }) } });
    }
    case 'how.select': {
      if (state.selectedHow === command.howId) return none({ ...state, selectedHow: null });
      return none({ ...state, selectedHow: command.howId });
    }
    case 'group.reveal': {
      const hunk = state.analysis.hunks.find((h) => h.id === command.hunkId);
      const rep = hunk?.group?.representative;
      if (!hunk || rep === undefined) return none(state);
      const openGroups = state.openGroups.includes(rep) ? state.openGroups : [...state.openGroups, rep];
      // コースから来たらそのコースの How で絞り込む（束がその How に属すときだけ）
      const how = state.view === 'course' ? (state.course?.id ?? null) : state.selectedHow;
      const selectedHow = how !== null && hunk.hows.includes(how) ? how : null;
      return none({ ...state, view: 'hows', openGroups, selectedHow, peek: null, selectedFile: hunk.path, selectedHunk: hunk.id });
    }
    case 'how.clear':
      return none({ ...state, selectedHow: null, peek: null });
    case 'map.peek': {
      const symbol = state.analysis.symbols.find((s) => s.id === command.symbolId);
      if (state.course === null || symbol === undefined) return none(state);
      // 読む前の案内の知っておくことから覗くときは読む前の案内のまま（覗くのをやめると読む前の案内に戻る）
      const course = state.course.screen === 'brief' ? state.course : { ...state.course, screen: 'stop' as const };
      const path = state.analysis.hunks.find((h) => h.id === symbol.hunkId)?.path ?? symbol.path;
      const focusLine = command.line === undefined ? state.focusLine : { path, side: 'RIGHT' as const, line: command.line, ...(command.endLine === undefined ? {} : { endLine: command.endLine }), n: (state.focusLine?.n ?? 0) + 1 };
      return none({ ...state, course, courseMap: null, peek: { kind: 'symbol', symbolId: command.symbolId }, focusLine });
    }
    case 'course.peekFile': {
      if (!onStop(state) || !state.analysis.hunks.some((h) => h.path === command.path)) return none(state);
      // 同じファイルをもう一度押しても何もしない（そのファイルで選んでいる行も、答えの行の場所で覗いている行も外さない）
      if (state.peek?.kind === 'file' && state.peek.path === command.path) return none(state);
      return none({ ...state, courseMap: null, rel: null, peek: { kind: 'file', path: command.path } });
    }
    case 'map.unpeek':
      return none({ ...state, peek: null });
    case 'group.toggle': {
      const key = groupKeyOf(state, command.hunkId ?? state.selectedHunk);
      if (key === null) return none(state);
      const openGroups = state.openGroups.includes(key) ? state.openGroups.filter((k) => k !== key) : [...state.openGroups, key];
      return none({ ...state, openGroups });
    }
    case 'palette.pick':
      return pick(state, command.target);
    case 'jump.callee': {
      const cur = state.view === 'course' ? currentStop(state) : null;
      if (cur === null) return none(state);
      return none({ ...state, showPalette: true, paletteFrom: cur.symbolId, showKeymap: false });
    }
    case 'route.go':
      return goTo(state, command.page);
    case 'hunk.select':
      return select(state, command.hunkId);
    case 'diff.open':
      return showHunk({ ...state, peek: null }, command.hunkId, 'diff');
    case 'diff.viewport': {
      if (state.view !== 'diff') return none(state);
      // 選んだ差分は見えている間は動かさない。見えなくなったら見えている一番上の差分へ。行き先を出し終える前の知らせ（n が古い）では動かさない
      const follow = command.n === state.diffJump.n && command.hunks.length > 0 && !command.hunks.includes(state.selectedHunk ?? '');
      const hunk = follow ? state.analysis.hunks.find((h) => h.id === command.hunks[0]) : undefined;
      if (state.diffFile === command.file && !hunk) return none(state);
      return none({ ...state, diffFile: command.file, ...(hunk ? { selectedFile: hunk.path, selectedHunk: hunk.id } : {}) });
    }
    case 'comment.open': {
      // 下書きの行が見える所へ（3.9）: 総括の一覧から（courseId）ならそのコースの停留所。他は 差分一覧の hunk → その行が見える停留所 →
      // 同じファイルを通る停留所をファイル全体で → そのファイルの差分一覧（どのコースも通らないファイル）
      const c = state.review.comments.find((x) => x.id === command.commentId);
      if (!c) return none(state);
      return openLine(state, c, command.courseId, (s) => ({ ...s, memo: { ...s.memo, focus: c.id } }));
    }
    case 'ask.cite':
      return openCite(state, command.cite);
    case 'ask.memo':
      return askMemo(state, command.entryId);
    case 'closing.approve':
      // GitHub で承認: PR ページを開くだけ（12 章）。ゲートしない（原則 8）。PR の URL が無い解析では何もしない
      return state.current?.prUrl ? { state, effects: [{ type: 'openTab', url: state.current.prUrl }] } : none(state);
    case 'file.next':
    case 'file.prev': {
      if (files.length === 0) return none(state);
      // 差分一覧ではツリーで明るいファイル（一番上のファイル）から数える
      const i = files.findIndex((f) => f.path === (state.diffFile ?? state.selectedFile));
      const step = command.id === 'file.next' ? 1 : -1;
      return selectFile(state, files[(i + step + files.length) % files.length]!.path);
    }
    case 'file.select':
      return selectFile(state, command.path);
    case 'tree.toggle': {
      const list = state.treeShut[command.tree];
      const next = list.includes(command.key) ? list.filter((k) => k !== command.key) : [...list, command.key];
      return none({ ...state, treeShut: { ...state.treeShut, [command.tree]: next } });
    }
    case 'tree.openAll':
      return none({ ...state, treeShut: { ...state.treeShut, [command.tree]: [] } });
    case 'tree.closeAll':
      // コースの左も差分の全ファイルのツリー（2026-10-20）
      return none({ ...state, treeShut: { ...state.treeShut, [command.tree]: dirKeys(buildTree(files.map((f) => f.path))) } });
    case 'fold.open': {
      const had = state.fold[command.path] ?? [];
      const keys = [...had, ...command.keys.filter((k) => !had.includes(k))];
      return keys.length === had.length ? none(state) : none({ ...state, fold: { ...state.fold, [command.path]: keys } });
    }
    case 'hunk.markViewed': {
      const id = command.hunkId ?? targetHunk(state);
      if (id === null) return none(state);
      const viewed = state.review.viewed.includes(id) ? state.review.viewed.filter((v) => v !== id) : [...state.review.viewed, id];
      return withReview(state, { ...state.review, viewed });
    }
    case 'jump.ide': {
      const target = targetHunk(state);
      const hunk = state.analysis.hunks.find((h) => h.id === target);
      if (!hunk || !state.current) return none(state);
      // project / product は ondina.config.yaml の ide（11 章）。project が無ければ対象リポジトリのディレクトリ名
      const product = state.config?.ide.product ?? 'idea';
      const project = state.config?.ide.project ?? state.current.repoName;
      return { state, effects: [{ type: 'openUrl', url: ideaUrl(product, project, hunk.path, hunk.lnNew) }] };
    }
    case 'memo.pick': {
      const at = { side: command.side, line: command.line, order: command.order };
      const pick: MemoPick = { path: command.path, anchor: at, head: at };
      // 直していた文は新しく書く枠に持ち込まない（draft は直す枠と共用）
      const draft = state.memo.editing === null ? state.memo.draft : '';
      // 案内人の答えの「メモにする」で行を選ぶ案内を出していれば、選んだ行の書く枠に質問の文を入れる（3.10）。
      // 入れた後に選び直しても文は書く枠と一緒に動くので、入れた知らせの行も今の選び方に合わせる。
      // GitHub の差分に出ない行は書く枠を出さない（メモを書けない）ので、入れずに案内を残す
      const ask = state.ask;
      const span = pickRange(pick);
      const label = spanLabel(span);
      // 開いていた枠（離した後の書く枠か、直す枠）の場所に、離すまで同じ高さの空きを残す
      const opened = state.memo.editing !== null || (state.memo.pick !== null && !state.memo.drag);
      const hold: MemoHold | undefined = opened && command.hold !== undefined && command.hold > 0 ? { pick: state.memo.editing === null ? state.memo.pick : null, editing: state.memo.editing, height: command.hold } : undefined;
      const base = { ...state.memo, pick, editing: null, drag: true, hold };
      if (ask.memoFor !== null && onGithubDiff(state.analysis.githubDiff, { path: pick.path, ...span }) !== false) {
        return none({ ...state, memo: { ...base, draft: mergeDraft(draft, ask.memoFor.question) }, ask: { ...ask, memoFor: null, memoed: { entryId: ask.memoFor.entryId, label } } });
      }
      return none({ ...state, memo: { ...base, draft }, ...(ask.memoed ? { ask: { ...ask, memoed: { ...ask.memoed, label } } } : {}) });
    }
    case 'memo.drag': {
      const prev = state.memo.pick;
      if (!state.memo.drag || !prev || prev.path !== command.path) return none(state);
      const head = { side: command.side, line: command.line, order: command.order };
      if (prev.head.side === head.side && prev.head.line === head.line && prev.head.order === head.order) return none(state);
      const pick: MemoPick = { ...prev, head };
      const memoed = state.ask.memoed;
      return none({ ...state, memo: { ...state.memo, pick }, ...(memoed ? { ask: { ...state.ask, memoed: { ...memoed, label: spanLabel(pickRange(pick)) } } } : {}) });
    }
    case 'memo.drop':
      return state.memo.drag ? none({ ...state, memo: { ...state.memo, drag: false, hold: undefined } }) : none(state);
    case 'memo.draft':
      return none({ ...state, memo: { ...state.memo, draft: command.body } });
    case 'memo.cancel':
      return none({ ...state, memo: NO_MEMO });
    case 'memo.save': {
      const pick = state.memo.pick;
      // GitHub の差分に出ない行には書けない（GitHub がコメントを付けられない。画面も書く枠の代わりに聞く枠を出す）
      if (!pick || command.body.trim() === '' || onGithubDiff(state.analysis.githubDiff, { path: pick.path, ...pickRange(pick) }) === false) return none(state);
      const memo = newMemo(state.review.comments, pick, command.body);
      return withReview({ ...state, memo: NO_MEMO }, { ...state.review, comments: [...state.review.comments, memo] });
    }
    case 'memo.edit': {
      const c = state.review.comments.find((x) => x.id === command.commentId);
      // 書く枠は一度に 1 つ。書きかけは「やめる」と同じく捨て、直す枠の文は今の本文から始める
      return c && c.state !== 'sent' ? none({ ...state, memo: { ...NO_MEMO, editing: c.id, draft: c.body, focus: state.memo.focus } }) : none(state);
    }
    case 'memo.update': {
      const c = state.review.comments.find((x) => x.id === command.commentId);
      if (!c || c.state === 'sent' || command.body.trim() === '') return none(state);
      return updateComment({ ...state, memo: NO_MEMO }, c.id, { body: command.body.trim() });
    }
    case 'memo.delete': {
      const c = state.review.comments.find((x) => x.id === command.commentId);
      if (!c || c.state === 'sent') return none(state);
      return withReview({ ...state, memo: state.memo.editing === c.id ? NO_MEMO : state.memo }, { ...state.review, comments: state.review.comments.filter((x) => x.id !== c.id) });
    }
    case 'comment.adopt':
      return decideDraft(state, command.commentId, { state: 'adopted' });
    case 'comment.edit': {
      // 直す文は今の本文から始める。送信済みは直さない（ボタンも出さない）
      const c = state.review.comments.find((x) => x.id === command.commentId);
      if (!c || isMemo(c) || c.state === 'sent') return none(state);
      return updateComment({ ...state, draftText: { ...state.draftText, [c.id]: c.body } }, c.id, { state: 'edit' });
    }
    case 'comment.text': {
      const c = state.review.comments.find((x) => x.id === command.commentId);
      if (!c || isMemo(c) || c.state !== 'edit') return none(state);
      return none({ ...state, draftText: { ...state.draftText, [c.id]: command.body } });
    }
    case 'comment.discard':
      return decideDraft(state, command.commentId, { state: 'discarded' });
    case 'comment.save':
      return decideDraft(state, command.commentId, { state: 'adopted', body: command.body });
    case 'comment.reset':
      return decideDraft(state, command.commentId, { state: 'draft' });
    case 'comment.send': {
      if (!canSend(state)) return none(state);
      return { state: { ...state, send: { status: 'sending' } }, effects: [{ type: 'sendComments' }] };
    }
    case 'comment.sent': {
      if (!isCurrent(state, command)) return none(state);
      const ids = new Set(command.ids);
      const comments = state.review.comments.map((c) => (ids.has(c.id) ? { ...c, state: 'sent' as const } : c));
      const send: SendStatus = 'url' in command ? { status: 'sent', url: command.url } : { status: 'returned', waiting: command.waiting };
      return { state: { ...state, review: { ...state.review, comments }, send }, effects: [{ type: 'saveState' }] };
    }
    case 'comment.sendFailed':
      if (!isCurrent(state, command)) return none(state);
      return none({ ...state, send: { status: 'error', message: command.message } });
    case 'github.loaded':
      if (!isCurrent(state, command)) return none(state);
      return none({ ...state, github: { ...state.github, viewed: command.viewed } });
    case 'github.loadFailed':
      if (!isCurrent(state, command) || command.quiet) return none(state);
      return none(withToast(state, { message: READ_FAILED, reason: command.reason, retry: { kind: 'read' }, tone: 'error' }));
    case 'github.set': {
      if (!isCurrent(state, command)) return none(state);
      const off = new Set(command.unmark);
      const viewed = state.github.viewed === null ? null : [...new Set([...state.github.viewed.filter((p) => !off.has(p)), ...command.mark])];
      const next = { ...state, github: { ...state.github, viewed } };
      return none(command.retried ? withToast(next, { message: setDoneMessage(command), retry: null, tone: 'ok' }) : next);
    }
    case 'github.setFailed':
      if (!isCurrent(state, command)) return none(state);
      // PR の head が違って送らなかったときは、理由（serve の文）だけを出す。再試行しても同じなのでボタンは出さない
      if (command.conflict) return none(withToast(state, { message: command.reason, retry: null, tone: 'error' }));
      return none(withToast(state, { message: setFailedMessage(command), reason: command.reason, retry: { kind: 'set', mark: command.mark, unmark: command.unmark }, tone: 'error' }));
    case 'github.retry': {
      const retry = state.github.toast?.retry;
      if (!retry || !state.current) return none(state);
      const { key, headSha } = state.current;
      const effect: Effect = retry.kind === 'read' ? { type: 'githubRead', key, headSha, quiet: false } : { type: 'githubSet', key, headSha, mark: retry.mark, unmark: retry.unmark, retried: true };
      return { state: { ...state, github: { ...state.github, toast: null } }, effects: [effect] };
    }
    case 'github.toast.close':
      return state.github.toast?.n === command.n ? none({ ...state, github: { ...state.github, toast: null } }) : none(state);
    case 'comments.arrived': {
      // 画面が読んだ後に外から足した AI の下書き（12 章）。serve のファイルには既にあるので保存しない。自分のメモは画面が正
      if (!isCurrent(state, command)) return none(state);
      const known = new Set(state.review.comments.map((c) => c.id));
      const fresh = command.comments.filter((c) => !known.has(c.id) && !isMemo(c));
      return fresh.length === 0 ? none(state) : none({ ...state, review: { ...state.review, comments: [...state.review.comments, ...fresh] } });
    }
    default:
      return none(state);
  }
}
