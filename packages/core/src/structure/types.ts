// 構成の推定（設計書 10.6）の入出力の型。リポジトリ全体の追跡ファイルから、層の名前・並び・振り分けを LLM に推定させる。
// 推定はそのリポジトリで初めて analyze するときに 1 回だけ走らせ、.ondina/structure.json に保存して使い回す。

export interface StructureInputFile {
  name: string;
  /** .kt の最上位の宣言（`class Order` など）。入力が大きすぎるときは落とす */
  decls?: string[];
}

export interface StructureInput {
  /** 追跡ファイルの総数 */
  files: number;
  /** ディレクトリごと。リポジトリ直下は "." */
  dirs: Array<{ dir: string; files: StructureInputFile[] }>;
  /** 推定し直すとき: 前回の層の名前（上から）。当てはまる限り同じ名前と並びを使わせる（原則 7） */
  previous?: { layers: string[] };
}

export interface StructureLayer {
  name: string;
  why: string;
}

/** LLM の出力（検査前）と、検査を通った構成（同じ形） */
export interface Structure {
  /** 上から下へ。呼ぶ側 → 呼ばれる側 */
  layers: StructureLayer[];
  /** ディレクトリ丸ごとの層（下のディレクトリも含む）。"." はリポジトリ直下のファイルだけ */
  dirs: Array<{ dir: string; layer: string }>;
  /** 同じディレクトリの中で層が分かれるときのファイル */
  files: Array<{ path: string; layer: string }>;
  /** コードの構成に入らないディレクトリ（文書・ビルド設定など）。増えても未分類に数えない */
  outside: string[];
  /** テストのコード（テストとテストだけが使う補助）の置き場。ディレクトリ（下も含む）かファイル。設定にテストの置き場が無いときのテストの見分けに使う（5.2 の 7） */
  tests: string[];
}

/** .ondina/structure.json。known は推定したときの追跡ファイル全部（増えた分を数えるのに使う） */
export interface SavedStructure extends Omit<Structure, 'tests'> {
  version: 1;
  /** 2026-10-12 より前の保存には無い。無ければ analyze が LLM を使えるときに推定し直す */
  tests?: string[];
  headSha: string;
  /** ISO 8601 */
  at: string;
  command: string;
  known: string[];
}
