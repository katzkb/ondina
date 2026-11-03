// LLM ラベリング（設計書 10 章）の入出力の型。Stage 1 の成果物から組む入力と、LLM コマンドの stdout から読む出力。
// どちらも Analysis.json には入れない（入力はゴールデン、出力は .ondina/<key>/llm/<headSha>.json に生のまま残す）。

/** 10.1 の hunk 1 件。追従グループの hunk は hunks[] に入れず rippleGroups[] の代表と逸脱にだけ入れる */
export interface LlmInputHunk {
  id: string;
  path: string;
  symbol: string;
  /** core = 束を持つ核、candidate = 束の無い核候補（8 章 8）、test = テスト。それ以外は無し */
  kindHint?: 'core' | 'candidate' | 'test';
  /** 設定の glob か構成の推定（10.6）で決まった層（5.2 の 4）。当たらなければ欄ごと無い（推定は layerGuesses で LLM が書く） */
  layer?: string;
  lines: string[];
}

export interface LlmInputGroup {
  /** "g1", "g2", … 出現順 */
  id: string;
  pattern: string;
  coreHunkId: string;
  /** メンバー数（行は渡さない） */
  members: number;
  representative: { hunkId: string; path: string; symbol: string; lines: string[] };
  deviations: Array<{ hunkId: string; path: string; symbol: string; lines: string[] }>;
}

/** 前回の解析（同じ PR の直近の headSha）。内容の変わっていない hunk の割当だけ */
export interface LlmPrevious {
  hows: Array<{ id: number; title: string; why: string }>;
  assignment: Record<string, number[]>;
  /** 前回の地図のまとまりの名前（How が 8 つ以上だった回だけ） */
  themes?: Array<{ title: string; howIds: number[] }>;
}

export interface LlmInput {
  pr: { title: string; body: string };
  previous?: LlmPrevious;
  hunks: LlmInputHunk[];
  rippleGroups: LlmInputGroup[];
  /** LSP が取った呼び出し関係（9 章）。端点は Symbol.id。LSP を動かしていなければ欄ごと無い */
  edges?: Array<{ from: string; to: string; kind: 'call' | 'schema' | 'test' }>;
  /** 選べる層の名前（重複なし）。unlayeredPaths があるときだけ。どの hunk にも層が無い PR でも layerGuesses の名前を選べるように */
  layers?: string[];
  /** どの規則（設定の glob か構成の推定。10.6）にも当たらなかった変更ファイル（10.1）。LLM は layerGuesses で推定を返す */
  unlayeredPaths?: string[];
}

/** 10.2 のうち 1 回目（目的ごとに分ける）に出させる範囲（specs / rippleVerdicts は入力が揃ってから。summary は 2 回目が書く: narration/） */
export interface LlmOutput {
  hows: Array<{ id?: number; title: string; why: string; hunkIds: string[]; groupIds: string[] }>;
  claims: Array<{ text: string; backed: boolean; reason?: string }>;
  /** どの glob にも当たらなかったファイルの層の推定（10.2）。検証を通ったものだけ使う */
  layerGuesses: Array<{ path: string; layer: string }>;
  /** How が 8 つ以上のときの、地図のまとまり（How をまとめた題）。検証は mapgroup/build.ts */
  themes: Array<{ title: string; howIds: number[] }>;
}
