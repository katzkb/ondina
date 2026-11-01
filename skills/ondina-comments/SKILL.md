---
name: ondina-comments
description: ondina（PR レビューを理解するためのローカルツール）の「AI の下書き」にレビューコメントを入れる。PR 番号が無ければ、今いるブランチの PR に入れる。「PR 123 をレビューして ondina に入れて」「ondina にコメントを入れて」「この指摘を ondina の下書きにして」「ondina で開いてコメントして」のように、PR へのレビューコメントを ondina に渡すよう頼まれたときに使う。GitHub には送らない。
metadata:
  opencode/slash: "true"
---

# ondina にレビューコメントの下書きを入れる

ondina はレビュアーが PR を理解するためのローカルツール。あなたが入れたコメントは、ondina の締めの画面の「AI の下書き」に並ぶ。レビュアーが 1 件ずつ採用・編集・破棄を選び、採用した物だけをレビュアー自身が GitHub に送る。

## やらないこと

- GitHub に送らない（`gh pr review` や `gh api` でコメントを付けない）
- `.ondina/` の下のファイルを直接書き換えない。必ず `ondina comments add` を通す
- ondina の「問題なし」や「自分のメモ」に触らない（レビュアーの作業）
- 解析しない。解析して画面を開くのはスキル `ondina`（レビュアーが画面で PR を見てから、コメントを頼む流れ）

## 手順

コマンドは PR の対象リポジトリの中で打つ（worktree の中でもよい。PR の解析は元のフォルダの `.ondina/` にあり、どの worktree からも読める）。

### 1. 解析した版を調べる

PR 番号を言われていなければ（「ondina にコメントして」だけなど）、今いるブランチの PR を使う。番号を付けずに打つと、今のブランチ（worktree ならその worktree のブランチ）の PR が返る。

```sh
gh pr view --json number,title,state
```

- `number` を頼まれた PR の番号として、下へ進む
- `no pull requests found for branch "<ブランチ>"` と出たら、このブランチに PR は無い。何もせずに止まり、「このブランチ（<ブランチ>）の PR が見つかりません。コメントを入れる PR の番号を教えてください」と伝える
- ほかのエラー（ブランチにいない・gh の認証切れなど）でも、出力をそのまま伝えて止まり、PR の番号を聞く

```sh
ondina list
```

1 行が 1 つの解析で、新しい順。タブ区切りで `<key> <headSha> <baseSha> <題>`。key は PR 番号（ローカルの 2 つの ref の解析は `local`）。

- 頼まれた PR の key の行のうち、いちばん上を使う
- その PR の行が無いとき:
  - 同じ依頼で ondina で開くことも頼まれていれば（「開いてコメントして」など、「開いて」「見せて」がある）、スキル `ondina` の手順を先に済ませてから、もう一度 `ondina list`
  - そうでなければ（「ondina にコメントして」だけ）、解析も `ondina` スキルもせずに止まり、「PR <番号> はまだ ondina で開いていません。先に『PR <番号> を ondina で開いて』と頼んでください」と伝える。レビュアーが画面で PR を見てからコメントを頼む流れなので、先回りして開かない

### 2. 差分を読む

コメントは **headSha の版の行番号** で付ける。今のチェックアウトや PR の最新の版ではない。

```sh
git diff <baseSha> <headSha>
git show <headSha>:<path>   # head 側のファイル全体
git show <baseSha>:<path>   # base 側のファイル全体
```

何を見るかは頼まれた内容に従う。レビュアーが指摘を言葉で伝えた場合（「OrderController の 21 行目に must で…」）は、その内容を本文にする。

### 3. コメントを JSON にする

```json
{
  "source": "codex",
  "headSha": "<手順 1 の headSha（40 桁）>",
  "comments": [
    { "path": "src/main/kotlin/com/example/order/api/OrderController.kt", "line": 21, "side": "RIGHT", "body": "[must] repository.save() は ApplyDiscountUseCase.execute の中でも呼ばれるため、この経路では 2 回保存される。" }
  ]
}
```

- `source`: 自分の名前（`codex`・`opencode` など）。ondina の画面に出所として出る
- `path`: リポジトリの最上位からのパス
- `side` と `line`:
  - 足した行・変わっていない行は `"RIGHT"` で、head 側のファイルの行番号
  - 消した行は `"LEFT"` で、base 側のファイルの行番号
- 行は差分に出る行（`git diff` の `@@` の塊の中。変更の前後 3 行を含む）から選ぶ。塊の外の行には GitHub がコメントを付けられないので、ondina が受け取らない（1 件でもあると、1 件も入らない）
- 1 件に付けられるのは 1 行だけ（範囲は付けられない）

本文の書き方:

- 頭にラベルを 1 つ付ける
  - `[must]`: 直さないとマージできないこと
  - `[imo]`: 意見・提案。直すかは作者が決めてよい
  - `[ask]`: 質問。意図や前提が読み取れないこと
- 日本語で書く
- 1 件に 1 つのことだけ書く。何が起きるかと、そう言える根拠（どの行・どの呼び出しか）を書く

### 4. ondina に渡す

```sh
ondina comments add --from - <<'JSON'
{ ...手順 3 の JSON... }
JSON
```

`n 件を下書きに追加しました（<key> / <headSha の先頭 7 桁>）` と出れば成功。同じ内容を二度渡しても増えない。

失敗したとき:

- `headSha … の解析が .ondina/ にありません`: 手順 1 の headSha を使っているか確かめる
- `JSON の形が違います`: `source`・`headSha`・`comments[{path, line, side, body}]` が揃っているか、`line` が数か、`side` が `RIGHT` か `LEFT` かを確かめる
- `GitHub の差分に出ない行へのコメントが n 件あります`: 下に並んだ行は `@@` の塊の外。1 件も入っていない。それぞれ塊の中の行（その指摘に一番近い変更の行）に付け直すか、ほかのコメントにまとめてから、全部をもう一度渡す

### 5. レビュアーに伝える

入れた件数をラベルごとに伝え（番号を言われずに選んだときは、どの PR か番号と題も）、「ondina の締めの画面の『AI の下書き』で、採用・編集・破棄を選んでください」と添える。ondina の画面を開いていれば、ブラウザのタブに戻るだけで並ぶ。画面を閉じていれば、スキル `ondina` の手順 3・4 で開き直す（解析は済んでいる）。
