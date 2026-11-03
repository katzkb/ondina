// 2 回目の LLM 呼び出し（文を書く。設計書 5.3 / 10 章）の入出力の型。1 回目（label/）の How の割当から
// プログラムがコースの読む順番（tours）を組んだ後に呼ぶ。入口の説明（summary。要点・例・流れの図）と、コースの変わること・確かめること・停留所のこの場所を書かせる。
// どちらも Analysis.json には入れない（入力はゴールデン、出力は .ondina/<key>/llm/<headSha>.text.json に生のまま残す）。
import type { SymbolKind } from '../model.js';
import type { LlmInputGroup, LlmInputHunk } from '../label/types.js';

/** 停留所 1 つ（Tour のステップ 1 つ）。差分の行は hunks[] か rippleGroups[] にあり、hunkId で引く */
export interface NarrationInputStop {
  symbolId: string;
  /** FQ 名。ファイル単位のシンボルならパス */
  symbol: string;
  path: string;
  /** テストの停留所（地図に出ない） */
  test: boolean;
  /** 差分のある停留所の hunk id */
  hunkId?: string;
  /** 追従の束の hunk なら、その束の id（"g1" など） */
  groupId?: string;
  /** 呼ばれ方「呼ぶ側 → 呼ばれる側(引数の型)」。経路の始点や辺に乗らない停留所には無い */
  call?: string;
}

/**
 * 停留所の差分の無い相手（2026-10-11）。停留所ではない（差分だけを回る。差分が責任の単位）。図の箱の「変えていない」の札（nodes[].untouched）の材料。
 * 言語サーバーが 1 段聞いた呼び出しの相手で、テストからの呼び出し先も入る。参照は入らない
 */
export interface NarrationInputRelated {
  /** どの停留所の相手か（symbolId） */
  of: string;
  /** in = 停留所を呼んでいる、out = 停留所が呼んでいる */
  dir: 'in' | 'out';
  /** FQ 名 */
  symbol: string;
  path: string;
}

export interface NarrationInputCourse {
  howId: number;
  title: string;
  why: string;
  stops: NarrationInputStop[];
  /** 停留所の順、同じ停留所は呼び出し元 → 呼び出し先、名前順。同じ相手はコースの中で 1 回だけ */
  related: NarrationInputRelated[];
}

/**
 * 前からあるものの候補 1 つ（説明タブの背景。2026-10-29）。LLM はここから選んで文を書く。removed はプログラムが決めた事実で、画面のチップになる
 */
export interface NarrationInputExisting {
  /** FQ 名 */
  symbol: string;
  path: string;
  kind: SymbolKind;
  /** true = この PR で消える（base にだけある宣言）。false = 停留所が呼んでいて、この PR で変えていない */
  removed: boolean;
}

/** 動き 1 本（2026-11-04）。呼ぶ順はプログラムが組んだもの。LLM は題を付けて、見せる順に並べるだけ */
export interface NarrationInputBehavior {
  id: string;
  /** 始まりの FQ 名 */
  start: string;
  /** 呼ぶ順の呼び出し。「呼ぶ側の短い名前: 呼び出しの式」（式が無ければ呼ばれる側の短い名前） */
  calls: string[];
}

export interface NarrationInput {
  /** 作者の説明（pr.body）は渡さない。入口の説明は差分だけから書く（10.3） */
  pr: { title: string };
  /** 1 回目と同じ物の行の頭に head の行番号と「|」を付けたもの（削除の行は空白）。追従の束の hunk は rippleGroups[] の代表と逸脱にだけ入る */
  hunks: LlmInputHunk[];
  rippleGroups: LlmInputGroup[];
  /** How の順。停留所は tours の順 */
  courses: NarrationInputCourse[];
  /** どの How にも入らなかった hunk の id（コースの文に混ぜない。「変えていない」の札にも入れない） */
  unassigned: string[];
  /** 前からあるものの候補。停留所が呼んでいる差分の無い相手（courses[].related の out。コースの順に 1 回）の後に、この PR で消える宣言（base の並び） */
  existing: NarrationInputExisting[];
  /** 動き（2026-11-04）。無い = 動きが 0 本 */
  behaviors?: NarrationInputBehavior[];
}

/** 確かめることの 1 文（検証の前）。at は根拠の場所（停留所の symbolId と、入力の行の頭の番号） */
export interface NarrationOutputCheck {
  text: string;
  at: Array<{ symbolId: string; lines: number[]; say: string }>;
}

/** 流れの図の箱（検証の前）。symbolId は箱の下に出す停留所 */
export interface NarrationOutputNode {
  title: string;
  howIds: number[];
  symbolId: string;
  before: string;
  after: string;
  untouched: string[];
  pass: string;
}

export interface NarrationOutput {
  /** 入口の説明（2026-10-29 から要点・例・流れの図。それまでは問題・方針・触らないもの・前後表） */
  summary: { headline: string; example: { text: string; at: Array<{ symbolId: string; lines: number[] }> }; flows: Array<{ nodes: NarrationOutputNode[] }> };
  /** 説明タブの背景（2026-10-29）。existing = この PR の前からあるもの（symbols は入力の existing[].symbol）、terms = 出てくる言葉（code は差分の行の識別子） */
  background: { existing: Array<{ symbols: string[]; text: string }>; terms: Array<{ word: string; code: string; meaning: string }> };
  /** change = 変わること、checks = 確かめること、stops[].role = この場所（2026-10-22。それまでは intro と停留所の guide / say） */
  courses: Array<{ howId: number; change: { before: string; after: string }; checks: NarrationOutputCheck[]; stops: Array<{ symbolId: string; role: string }> }>;
  /** 動きの題（2026-11-04）。並びが見せる順。古い記録には無い（空） */
  behaviors: Array<{ id: string; title: string }>;
}
