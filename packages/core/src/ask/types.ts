// 案内人に聞く（設計書 3.10 / 10.5）の LLM への入力と出力の型。
// 差分・全文・抜粋の行は「h12 + 本文」の形の文字列（h = head 側の行番号、b = base 側の行番号。印は + 足した / - 消した / 空白 変わらない）。
// LLM はこの番号で行の場所を書き、検証（verify.ts）は材料に出した番号だけを採る。

/** 行を持つ材料 1 つ。path は repo 相対 */
export interface AskInputLines {
  path: string;
  lines: string[];
}

/** 差分 1 つ（hunk）。group は追従の束のときの役（代表・逸脱・メンバー）とパターン */
export interface AskInputHunk extends AskInputLines {
  symbol: string;
  kind?: 'core' | 'ripple' | 'test';
  group?: { pattern: string; members: number; role: 'representative' | 'deviation' | 'member' };
}

/** コースの停留所 1 つ。差分があればその行、無ければ抜粋（Symbol.excerpt）の行 */
export interface AskInputStop extends AskInputLines {
  symbol: string;
  changed: boolean;
  test: boolean;
}

/** コードの場所の周り。calls = この場所が呼ぶ、calledBy = この場所を呼ぶ、testedBy = この場所を確かめるテスト、referencedBy = この場所を参照する（束のメンバーは代表と逸脱だけ） */
export interface AskInputRelated extends AskInputLines {
  relation: 'calls' | 'calledBy' | 'testedBy' | 'referencedBy';
  symbol: string;
  changed: boolean;
}

export type AskInputPlace =
  | {
      kind: 'pr';
      /** 入口の説明（3.1）の要点と流れの図の箱（題・マージ前・マージ後・変えていない物）。無い = 書いていない・古い形の解析 */
      summary?: { headline: string; flow: Array<{ title: string; before: string; after: string; untouched: string[] }> };
      /** 束のメンバーは代表と逸脱だけ（残りは rippleGroups の件数） */
      hunks: AskInputHunk[];
      /** どのコースにも入らなかった差分のシンボル名 */
      unassigned: string[];
    }
  | { kind: 'course'; course: { id: number; title: string; why: string }; stops: AskInputStop[] }
  | {
      kind: 'code';
      /** 何について聞いたか（symbol = シンボル、hunk = 差分 1 つ、file = ファイル全体） */
      about: 'symbol' | 'hunk' | 'file';
      path: string;
      symbol?: string;
      changed: boolean;
      /** この場所の差分が入っているコースの id */
      courses: number[];
      /** head 側の全文（Analysis.files）。古い解析・消したファイルには無い */
      file?: string[];
      /** この場所の差分（file なら同じファイルの全部） */
      hunks: AskInputHunk[];
      related: AskInputRelated[];
      /** レビュアーが「+」で選んだ行（3.10）。質問はこの行について。lines は画面の並び（全文に消した行を差し込んだ並び）の from〜to。見つからなければ空 */
      selected?: AskInputSelected;
    };

export interface AskInputSelected extends AskInputLines {
  /** 両端の番号（h8 / b6） */
  from: string;
  to: string;
}

export interface AskInput {
  pr: { title: string };
  courses: Array<{ id: number; title: string; why: string }>;
  place: AskInputPlace;
  /** 同じ場所で前に聞いたこと（古い順、直前の 3 問まで）。answer は答えの文をつないだもの */
  history: Array<{ question: string; answer: string }>;
  question: string;
}

/** LLM の出力（検証前）。cite の line が null や欠けでも読んでおき、検証で場所を外す。web の url も形だけ読み、検証で http / https だけ採る */
export interface AskOutput {
  lead: string;
  items: Array<{ text: string; cite?: { path: string; side: string; line: number | null; endLine?: number | null }; web?: { url: string; title: string }; known?: true }>;
  tail?: string;
}
