// PR 一覧から AI にレビューを頼む（設計書 3.11）ときに、設定の「AI レビューのコマンド」へ stdin で渡す指示文。決定的（同じ PR と sha には同じ本文。原則 7）。
// 相手は道具（git・ファイルの読み取り）を使えるエージェント。決まりはスキル ondina-comments の手順 2〜3 と同じで、結果は ondina comments add ではなく stdout の JSON で受け取る。
// 指摘はレビュアーが採用か破棄を選ぶ AI の下書きになる。ondina 自身は正しさを判断しない（原則 1）。
// 例文は別の題材で書く（fixture の差分に寄せた指摘を見せない）。

export interface ReviewPromptInput {
  number: number;
  title: string;
  /** base と head のブランチの名前 */
  base: string;
  head: string;
  baseSha: string;
  headSha: string;
}

export function renderReviewPrompt(p: ReviewPromptInput): string {
  const example = JSON.stringify({
    source: 'codex',
    headSha: p.headSha,
    comments: [{ path: 'src/main/kotlin/stock/Allocator.kt', line: 21, side: 'RIGHT', body: '[must] 在庫が数量より少ないときも reserve() を呼ぶため、在庫が負になる。19 行目の判定は合計の在庫だけを見ている。' }],
  });
  return `あなたはプルリクエストのレビューを頼まれたエージェントである。下の PR の差分を読み、レビューコメントの下書きを JSON で返す。
返した下書きは ondina（レビュアーが PR を理解するためのローカルツール）の「AI の下書き」に並ぶ。レビュアーが 1 件ずつ採用・編集・破棄を選び、採用したものだけをレビュアー自身が GitHub に送る。

PR:
- 番号: #${p.number}
- 題: ${p.title}
- base: ${p.base}（${p.baseSha}）
- head: ${p.head}（${p.headSha}）

やらないこと:
- GitHub に送らない（gh pr review や gh api でコメントを付けない）
- ファイルを書き換えない。コミットしない。ondina のコマンドを実行しない
- 今のチェックアウトや PR の最新の head で読まない。行番号がずれる

差分の読み方（コマンドはこのリポジトリの中で実行する）:
- git diff ${p.baseSha} ${p.headSha}
- git show ${p.headSha}:<path>   head 側のファイル全体
- git show ${p.baseSha}:<path>   base 側のファイル全体

コメントの付け方:
- path はリポジトリの最上位からのパス
- 足した行・変わっていない行は side を "RIGHT" にし、line は head 側のファイルの行番号
- 消した行は side を "LEFT" にし、line は base 側のファイルの行番号
- 行は差分に出る行（git diff の @@ の塊の中。変更の前後 3 行を含む）から選ぶ。塊の外の行には GitHub がコメントを付けられないので、ondina は受け取らない
- 1 件に付けるのは 1 行だけ（範囲は付けない）

本文の書き方:
- 頭にラベルを 1 つ付ける
  - [must]: 直さないとマージできないこと
  - [imo]: 意見・提案。直すかは作者が決めてよい
  - [ask]: 質問。意図や前提が読み取れないこと
- 日本語で書く
- 1 件に 1 つのことだけ書く。何が起きるかと、そう言える根拠（どの行・どの呼び出しか）を書く
- 指摘がなければ comments は空の配列にする

出力:
- 返答は次の形の JSON オブジェクト 1 つだけ。前後に文やコードフェンスを付けない
- source は自分の名前（codex・opencode など）。ondina の画面に出どころとして出る
- headSha は ${p.headSha} のまま

例（題材は別の PR。形だけを真似る）:
${example}
`;
}
