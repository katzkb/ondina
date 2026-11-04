[English](../usage.md)

# ondina の使い方

入れ方・更新・困ったときの手順と、機能ごとの使い方です。概要は [README](../../README.ja.md) にあります。

## 入れる

前提: Mac、Node.js 22 以上、pnpm 12 以上、git。PR を読む（`ondina analyze <pr>`）には、PR のホスト（github.com か GitHub Enterprise Server）にログインした `gh`。gh がほかのホストにもログインしていても、ondina は gh に PR のホストを渡す

### 初回

1. clone する
   ```sh
   git clone https://github.com/katzkb/ondina.git ~/.local/share/ondina
   ```
2. 組み立てて `ondina` コマンドを置く
   ```sh
   sh ~/.local/share/ondina/scripts/install.sh
   ```
   `[1/6]`〜`[6/6]` の後に入ったバージョンが出る。`~/.local/bin` が PATH に無ければ、`~/.zshenv` に足す 1 行も出る（`~/.zshrc` は対話の zsh しか読まず、AI エージェントが実行する非対話の zsh からは ondina が見つからない）。Tab 補完の定義は `~/.zsh_functions/_ondina` に置かれ、`ondina update` のたびに作り直される。最後に普段の zsh を起こして補完が効くかを確かめ、効いていなければ `~/.zshrc` の末尾に足す `source "…/.zsh_functions/_ondina"` の 1 行が出る（足したらターミナルを開き直す）。AI エージェント（Codex・OpenCode）のスキルは `~/.agents/skills/ondina/`・`~/.agents/skills/ondina-comments/`・`~/.agents/skills/ondina-preview/` に置かれる（下の「AI エージェントから開く・コメントを入れさせる」「AI が作った変更を PR の前に見る」）
3. kotlin-lsp（地図の関連の線と色分けに使う。なくても動く）は、2 の `[6/6]` が `~/.local/share/kotlin-lsp/` に入れる。ondina が持っている最新のバージョンの番号（`scripts/kotlin-lsp-version`。GitHub Actions が毎朝 https://github.com/Kotlin/kotlin-lsp/releases を見て書き換える）で JetBrains からダウンロードし（360 MB ほど、展開後 1.1 GB ほど）、SHA-256 を確かめて展開する。github.com には問い合わせない。外へ出るのは download.jetbrains.com だけ。使うバージョンは `current` というバージョンによらない名前で指す。ondina はこの `current` を自分で見つけるので、`~/.zshrc` などに書き足すものはない（AI エージェントから実行する `ondina analyze` でも起きる）。前に `~/.zshrc` へ足した `export ONDINA_LSP_COMMAND=…/current/bin/intellij-server` は残しても消してもよい。別の場所を指していれば、そちらが先に使われるので、消すよう出る

   kotlin-lsp は試用版で、出てから約 30 日で起動しなくなる（263.4702.0 は 2026-10-09 に切れた）。切れると、解析した画面の入口に「関連の線がありません。言語サーバーが使えませんでした: … This build of kotlin-server has expired.」と出る。そのときは `ondina update` を打ってから `ondina analyze` を実行し直す。新しいバージョンが出ていれば入れ替わり、古いバージョンは消える。`ondina update` が「kotlin-lsp は最新です」と言うのに切れているときは、新しいバージョンが出るまで待つ（バージョンの間が 30 日より空くことがある。262.9593.0 → 263.4702.0 は 48 日）。新しいバージョンが ondina に届くのは、出た次の朝 6 時ごろ

### 更新する・戻す

```sh
ondina update            # main の最新を取って組み立て直す
ondina update 1857abd    # そのバージョンに戻す
ondina --version         # インストールされているバージョン（コミットと日付）
```

更新のたびに「ondina を 1857abd → 9a0b1c2 にしました」と、入ったコミットの一覧が出る。kotlin-lsp も、新しいバージョンが出ていれば入れ替わる（「kotlin-lsp を 263.4702.0 → 263.6379.0 にしました」）。kotlin-lsp だけを最新にするなら `sh ~/.local/share/ondina/scripts/install-kotlin-lsp.sh`

更新の前から動いている画面（serve）は、古いコードのまま新しい画面を配り続ける。`ondina serve list` で「更新前」と出たものは `ondina serve restart <ポート>`（全部なら `--all`）で起動し直す

### 困ったとき

- 「github.com から取れませんでした」: github.com に届くか（ネットワークや proxy）を確かめてから `ondina update`
- 「組み立てに失敗しました」: メッセージに出る `sh …/scripts/install.sh <前のバージョン>` で前のバージョンに戻る
- 「kotlin-lsp: …を落とせませんでした」: kotlin-lsp は今のバージョンのままで、ondina の更新は済んでいる。download.jetbrains.com に届くか（ネットワークや proxy）を確かめてから `sh ~/.local/share/ondina/scripts/install-kotlin-lsp.sh`
- `ondina` そのものが起動しないときは、`sh ~/.local/share/ondina/scripts/install.sh` を直接走らせれば直せる
- `ondina update` が途中で止まって先へ進めない（入っているバージョンのスクリプト自体が壊れている）ときは、git で取り直してからスクリプトを直接走らせる
  ```sh
  git -C ~/.local/share/ondina fetch
  git -C ~/.local/share/ondina checkout --detach origin/main
  sh ~/.local/share/ondina/scripts/install.sh
  ```

### リポジトリで初めて使うとき

- 解析の置き場 `.ondina/` と設定 `ondina.config.yaml` を、コミットしないよう `.git/info/exclude` に足す（`.ondina` は末尾に `/` を付けない。付けると、worktree に置いた `.ondina` の symlink が無視されない）
  ```sh
  printf '.ondina\nondina.config.yaml\n' >> .git/info/exclude
  ```
- 初めての `ondina analyze` は、PR の前にリポジトリ全体のファイルの一覧を LLM に渡して、構成（地図の帯になる層）を推定する。結果は `.ondina/structure.json` に残り、2 回目からはそれを使う（LLM を呼ばない）。後でファイルが増えて「構成に分類できないファイルが n 件増えました」と出たら、`ondina structure` で推定し直してから `ondina analyze` を実行し直す
- 言語サーバー（kotlin-lsp）は、`~/.local/share/kotlin-lsp/current` に入っていれば（上の 3）既定で起動する。yaml も環境変数も要らない。別の場所のものを使うときは `ONDINA_LSP_COMMAND` に `bin/intellij-server` のパスを入れる（先に使われる）。PR ごとの初回は準備に 1 分ほどかかる（大きなリポジトリではもっとかかる。待っている間は 30 秒おきに、何をしているかを 1 行出す）。起動したくないときは `ondina analyze <pr> --no-lsp`
- 層を自分で決めたいときだけ、`ondina.config.yaml` に `layers` を書く（推定より優先する）。見本は `fixtures/order-service/ondina.config.yaml`
- LLM コマンドは、使ってよいものを画面のレール下部の欄で選ぶ（下の「LLM コマンド」の表）

### PR に新しいコミットが積まれたとき

- 画面を開いていれば、上の帯の下に「新しいコミットが 2 件あります」と出る（画面に戻ったときと 2 分おきに GitHub に問い合わせる）。［解析し直す］を押すと裏で `ondina analyze` が走り、経過と進捗が同じ行に出る。その間も前のバージョンはそのまま使える
- 終わると「新しいバージョンの解析ができました」と［切り替える］が出る。押すまで前のバージョンのまま
- 切り替えると、差分が変わっていない「問題なし」と、行が変わっていない送っていないメモ・AI の下書きを引き継ぐ。変わった差分は未確認に戻り、その数と、移せずに前のバージョンに残したメモの数が同じ行に出る。前のバージョンは左上の選択でいつでも開ける
- ターミナルで `ondina analyze <pr>` を実行し直しても、画面でその新しいバージョンを開いたときに同じように引き継ぐ。画面を開いたままでよい。ブラウザのタブに戻ると、新しい解析が左上の一覧に出る

### AI エージェントから開く・コメントを入れさせる

Codex や OpenCode から ondina を動かせる。`ondina update` が `~/.agents/skills/` にスキルを置くので、対象のリポジトリで頼むだけでよい。

```
PR 123 を ondina で開いて        … 解析して画面を開く（スキル ondina）
ondina で開いて                  … 番号がなければ、今いるブランチの PR を開く
PR 123 をレビューして ondina にコメントして   … 画面の「AI の下書き」にコメントが並ぶ（スキル ondina-comments）
```

- 開いて → 画面で PR をざっくり理解 → コメントを頼む → 下書きを見ながら最後までレビュー、の順を想定している。「PR 123 を ondina で開いてコメントして」と一度に頼んでもよい
- スキルを名指しするときは、Codex は `$ondina` / `$ondina-comments`（例: `$ondina $ondina-comments PR 123`）、OpenCode はコマンドの `/ondina` / `/ondina-comments`（例: `/ondina PR 123 を開いてコメントして`）
- 開くスキルは、今のバージョンの解析がなければ `ondina analyze` を走らせ（数分）、`ondina serve --background` で画面を起動してブラウザで開く。`--background` の画面はエージェントが終わっても残る。このリポジトリの画面が既に動いていれば、それを使う（同じリポジトリの別の worktree で起動した画面も）。止めるときは `ondina serve stop <ポート>`（4177 番が埋まっていたときは別のポートで起動する）。動いている画面は `ondina serve list` でポート・フォルダ・バージョンを一覧にでき、`ondina update` の前から動いているものには「更新前」と出る。`ondina serve restart <ポート>` で今のバージョンで起動し直す
- コメントのスキルは解析しない。開いていない PR を頼むと「先に ondina で開いて」と返す
- PR 番号を言わなければ、どちらのスキルも今いるブランチ（worktree ならその worktree のブランチ）の PR を使う。ブランチに PR がなければ、番号を聞いて止まる
- PR の解析は、worktree の中で実行しても元の checkout の `.ondina/` に入る。1 つの画面に、どの worktree で解析した PR も出る。PR の無い変更の解析と設定は、コマンドを実行した worktree の `.ondina/` にできる。元の checkout と設定も分けたくなければ、worktree を作るときに元の checkout の `.ondina` への symlink を置く
- エージェントは `ondina list` で解析したバージョンを調べ、そのバージョンの差分を読み、`[must]` / `[imo]` / `[ask]` を頭に付けたコメントを `ondina comments add` で渡す。PR を書いた人に送る本文は短くし、根拠はレビュアーだけが読む説明（画面では本文の下の「説明（送信対象外）」。GitHub には送らない）に分けて書く
- 下書きは締めの画面の「AI の下書き」に並ぶ。画面を開いていれば、ブラウザのタブに戻るだけで出る。採用・編集・破棄を選び、採用したものだけが自分のメモと一緒に GitHub に送られる。エージェントは GitHub に送らない
- スキルを置くバージョンに上げた最初の `ondina update` では、まだ置かれない（走るのは入っていたバージョンの install.sh）。もう一度 `ondina update` を実行すると置かれる
- スキルは `ondina update` のたびに置き直す。手で書き換えても戻る

### AI が作った変更を PR の前に見る

AI エージェントに作らせた変更を、PR を作る前に ondina で疑似 PR として見て、コメントをそのエージェントに返せる（スキル ondina-preview）。

```
作った変更を ondina で見せて       … 題と説明を書いて解析し、画面を開いて、返したコメントを待つ
ondina で返したコメントを読んで    … エージェントが待っていなかったときに、返したコメントを受け取らせる
```

- エージェントは `ondina analyze --base main --title <題> --body <説明>`（`--head` 無し）で解析する。今のブランチのコミットと、コミットしていない変更・新しいファイルを合わせて 1 つの疑似 PR にする。ondina はコミットを作らず、作業ツリー・index・ブランチも変えない（`.ondina` を `.gitignore` に入れていてもよい）
- 画面で変更を見て、行番号の「+」でメモを書き、締めの画面の「AI に返す」を押す。採用した AI の下書きも一緒に返る
- エージェントは `ondina comments wait` で待っていて、受け取ると直し、解析し直す。画面の上に「新しいバージョン … の解析ができました」と出たら切り替える。終わったらエージェントに「OK」などと伝える
- 返した後に「いま待っている AI はいません」と出たら、エージェントは待っていない。エージェントに「ondina で返したコメントを読んで」と頼む（返したコメントは受け取るまで消えない）
- 終わったら知らせが来る形でコマンドをバックグラウンドで走らせられるエージェントは、待つ間も話せる。そうでないエージェントは、コマンドが終わるまで待つ

### チケットを出すとき

- `ondina analyze <pr> --ticket SHOP-421`（番号）、`--ticket https://…/browse/SHOP-421`（URL）、`--ticket ./ticket.md`（ファイル）。説明の画面（キー `2`）の「仕様」に、題・種類・状態・本文が出る。取れなければ理由が出る（解析は止まらない）
- `--ticket` を付けなければ、PR の題・ブランチ名・本文から番号や URL を拾い、LLM がこの PR のチケットを選んで取る。画面には推定として、見つけた場所と選ばなかった候補が出る。違うときは `--ticket` で指定し直す
- チケットが取れたら、LLM がチケットから「この PR で成り立つべきこと」（要求）を抜き出し、要求ごとに対応するコースを選ぶ。「仕様」には要求の行と、対応するコースの丸（押すとそのコースを選ぶ）が出て、対応がない要求は赤。原文は下に畳まれる。上の帯の「仕様 n/N」は対応するコースがある要求の数
- Jira（Cloud でも Jira Server / Data Center でも）: 画面の設定（歯車）の「Jira の URL」に入れる（URL で指定するなら要らない）。トークンは `ondina token` で Mac のキーチェーン（サービス名 `ondina-jira`）に入れる。トークンを貼って Enter（画面には出ない。シェルの履歴にも残らない）。入れたものを読み戻して確かめる
  - 入れ直すときも `ondina token`（上書き）。クリップボードからなら `pbpaste | ondina token`
  - 環境変数 `ONDINA_TICKET_TOKEN` があれば、キーチェーンより先にそれを使う（Mac 以外はこちら）
  - Jira Cloud: Atlassian のアカウントで作る API トークンと、設定の「Jira のメール」
  - Jira Server / Data Center: Jira のプロフィールで作る個人用アクセストークン。メールは空のまま
- Jira 以外: 設定の「チケットの取り方」を「コマンド」にして、チケットを取るコマンドを書く。値は環境変数 `ONDINA_TICKET` で渡り、stdout に JSON（`title` / `body` / `url`）か本文（Markdown）を出す。例: GitHub Issues なら `gh issue view "$ONDINA_TICKET" --json title,body,url`
- プロキシが要るネットワークでは、まだ Jira に届かない（画面に「Jira に接続できませんでした」と出る）

## LLM コマンド

`ondina analyze` は差分の切り出しと追従検出のあとで LLM を 1 回呼び、変更を「How」（やったことのまとまり）に分けて要約と作者説明の裏付け判定を出す。LLM は特定ベンダーに固定しない。約束は次の 1 つだけ:

> `sh -c <command>` で起動し、stdin にプロンプト全文、stdout に JSON オブジェクト 1 つを返す

| コマンド | 確認したバージョン | 備考 |
|---|---|---|
| `claude -p --tools "" --max-turns 1 --model opus`（既定） | Claude Code 2.1.274 | サブスクのログインで動く。`ANTHROPIC_API_KEY` があれば API 課金 |
| `codex exec --skip-git-repo-check -s read-only -` | codex-cli 0.154.0 | 進捗は stderr、JSON は stdout |
| `opencode run` | OpenCode 1.18.31 | 引数なしで stdin を読む。`-m provider/model` でモデル指定 |

指定の優先順: UI のレール下部の欄（`.ondina/ui.json`） > 環境変数 `ONDINA_LLM_COMMAND` > `ondina.config.yaml` の `llm.command` > 既定。
生の出力は `.ondina/<pr>/llm/<headSha>.json` に残り、同じ headSha では呼び直さない（`--relabel` で呼び直す。`--no-llm` でスキップする）。テストは LLM を起動しない。

