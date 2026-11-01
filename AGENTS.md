# AGENTS.md — ondina

ondina は大きな PR を読むためのレビュー支援ツール。変更を目的ごとにまとめ、読む順に並べる。
PRレビューの「理解」を支援する道具であって、レビューそのもの（正しさの判断）はしない。

## 最初に読むもの
- `docs/design.md` — 設計書。17章と18章が申し送り
- `docs/roadmap.md` — M0〜M4 の進捗（図とチェックリスト）。項目を終えたらここを同じ PR で更新する
- `docs/wording.md` — 製品の日本語の決まり。画面・CLI・LLM への指示文の文言を足す・直すときに読む
- `docs/prototype.html` — 画面仕様の正。`H` / `T` / `C` がサンプルデータ、`TOK` が Shiki で生成した役割トークン

## 破ってはいけない原則
1. 正しさ・バグ・品質についての判断を出力しない。事実（観測）のみ。評価語を使わない
2. 事実と推測を分ける。データには必ず `provenance`（ast / config / lsp / llm）を持たせ、UIは推測を点線と「たぶん」「推定」で表示する
3. 事実はプログラム、意味はLLM。LLMはプログラムが出した候補から選ぶ。未帰属・絡み・完了メーターはプログラムが計算し、LLMに書かせない
4. 追従グループのパターンは核hunkの削除シンボルと追加シンボルから機械的に導出する。説明文で書かない
5. `packages/web` から `node:*` と `packages/core` を直接 import しない。UIは `Analysis.json` と `ReviewState` を読んで描くだけ
6. 全操作はコマンドID経由。マウスもキーボードも同じコマンドを呼ぶ
7. 同じ headSha に対して同じ結果を出す。LLM出力は `previous` で安定化する
8. Approve をゲートしない。ルールを強制しない

## 作業の進め方
- マイルストーン順（設計書13章）。M0 の価値はデータモデルと hunk 切り出しの正しさで決まる。UIは後
- `fixtures/order-service` の差分に対するテストを先に書く
- 決定的な処理は unit test。LLM 呼び出しは fixture の入出力 JSON でスナップショット
- 設計書17章の未確認事項は推測で埋めない。確認してから進め、確認できなければ TODO として残す
- 設計書と実装がずれたら、実装に合わせて設計書を直す（設計書を放置しない）
- 画面・CLI・LLM への指示文に日本語を書くときは `docs/wording.md` に従う（英語を 1 語ずつ置いた言い方をしない。お知らせ・エラーは「です・ます」）。直訳調の語と常体のお知らせは `pnpm lint` が止める。lint の表に無い不自然な言い回しは、レビューで指摘する
- 完了と言う前に、レビュアーとして実物を開いて使う（`pnpm -F @ondina/cli dev serve` で fixture の解析を見る）。データだけの PR でも、その時点の出力で「1 つの How の経路を追う」を自分でやり、できなければ完了にしない。テストと設計書が合っていても、使う人の目で見ていなければ完了ではない

## 技術スタック
TypeScript / Node 22 / pnpm workspace（`packages/model` 型のみ / `packages/core` / `packages/cli` / `packages/web`）/ vitest / React + Vite / Shiki / web-tree-sitter + tree-sitter-kotlin / kotlin-lsp / elkjs / Anthropic API

## コマンド
- `pnpm install`
- `pnpm test` — 全パッケージの vitest。`pnpm vitest run -u` でゴールデン（`fixtures/order-service/expected/hunks.json`）を更新
- `pnpm typecheck` / `pnpm lint` / `pnpm build`
- `pnpm -F @ondina/cli dev analyze <pr>` / `pnpm -F @ondina/cli dev analyze --base <ref> --head <ref>`
- `pnpm -F @ondina/cli dev serve` — `.ondina/` の解析を http://127.0.0.1:4177/ で見る（先に `pnpm build`）。UI を直す間は別ターミナルで `pnpm -F @ondina/web dev`（`/api` を 4177 に中継）
- `pnpm -F @ondina/cli dev comments add --from <file|->` — コメント下書きを受け取る
- `sh fixtures/order-service/scripts/build-repo.sh <dir>` — fixture を main / feature/discount の2ブランチの git リポジトリにする

## 用語
設計書2章。核 / 追従 / 追従グループ / 逸脱 / 未帰属 / 絡み / How / コース（旧ツアー） / ベースライン / 仕様項目 / 主張
