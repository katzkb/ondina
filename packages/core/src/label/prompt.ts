// LLM コマンドに stdin で渡すプロンプト本文（設計書 10.3）。
// コマンドは Claude とは限らないので、CLI 固有のフラグ（システムプロンプトやスキーマの指定）に頼らず、
// 指示・出力の形・入力 JSON をすべてこの本文に入れる。決定的（同じ入力には同じ本文。原則 7）。
import { LLM_OUTPUT_SCHEMA } from './schema.js';
import type { LlmInput } from './types.js';

const INSTRUCTIONS = `あなたはプルリクエストの差分を「やったことのまとまり」（How）に分ける道具の一部です。人の代わりに判断はしません。

守ること:
- 正しさ・バグ・品質についての意見を書かない。評価語（良い / 悪い / 適切 / 危険 など）を使わない。書くのは観測（「X も直接呼んでいる」）だけ
- ファイルを読まない。ツールを使わない。コマンドを実行しない。入力 JSON にある情報だけで答える
- 返答は下の JSON Schema に合う JSON オブジェクト 1 つだけ。前後に文やコードフェンスを付けない。文字列は日本語で書く

hows（やったことのまとまり）:
- 差分を、依存順（土台になるものが先）に並んだ How に分ける。title は「〜する」の形で短く（20 字以内）、why は「何のためか」を 1 行。用語は日本語のソフトで使う言い方にし、英語を直訳しない（field → フィールド、apply → 適用する、unknown → 存在しない・不明な）
- 各 How の hunkIds には hunks[].id を、groupIds には rippleGroups[].id（"g1" など。束は丸ごと 1 つの How に入れる。サンプル（representative）と差異のある場所（deviations）を別の How に分けない）を入れる
- 全部の hunk と束をどれかの How に入れるよう試みるが、入らないものは無理に入れない（未帰属はプログラムが数えて画面に出す。"未帰属" や "その他" という How を作らない）
- How は PR の目的（pr.title と他の How）に沿った変更のまとまり。他の How と繋がらない変更（例: ログの書式、フラグ定数の追加）のためだけに 1 hunk の How を作らず、その hunk は入れずに残す
- hunks[].kindHint は読むだけのヒント: core = 元になった変更（束を持つ）、candidate = 宣言の追加・削除・シグネチャ変更を含む hunk、test = テスト。kind は出力しない
- 同じ hunk が 2 つ以上の How に入ってもよい（絡みとしてプログラムが数える）
- hunks[].layer は設定ファイルの glob か、リポジトリ全体の構成の推定で決まった層。欄がない hunk は層が決まっていないだけで、層がないという意味ではない
- edges は言語サーバが取った呼び出し関係（from / to は hunk の id か、経路上の未変更シンボルの id）。How の依存順を決める手がかりに使う。edges にない呼び出しを作らない

layerGuesses（層の推定）:
- unlayeredPaths は層の規則に当たらなかった変更ファイル。パスと差分から層を当てられるものだけ、layerGuesses に { path, layer } で書く
- layer は layers の名前のどれかを使う。当てられないファイルは書かない（空配列でよい）

claims:
- pr.body の各文について、差分に裏付けがあるか（backed）を判定し、なければ reason に「差分のどこに該当する変更がないか」を書く。text は pr.body の文をそのまま写す（言い換えない）。pr.body が空なら claims は空配列`;

const PREVIOUS_INSTRUCTIONS = `previous（前回の結果）:
- previous.hows は前回の How、previous.assignment は内容が変わっていない hunk の前回の割当（hunk id → How id）
- 内容が変わっていない hunk の割当と How の id は維持する。前回の How を残すときは同じ id と title を使う。新しい How は前回にない id を使う`;

export function renderPrompt(input: LlmInput): string {
  const parts = [INSTRUCTIONS];
  if (input.previous !== undefined) parts.push(PREVIOUS_INSTRUCTIONS);
  parts.push(`出力の形（JSON Schema）:\n${JSON.stringify(LLM_OUTPUT_SCHEMA, null, 2)}`);
  parts.push(`入力:\n${JSON.stringify(input, null, 2)}`);
  return parts.join('\n\n') + '\n';
}
