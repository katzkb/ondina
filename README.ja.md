[English](README.md)

# ondina

大きな PR を読むためのレビュー支援ツールです。
変更を目的ごとにまとめ、読む順に並べます。
コードが正しいかどうかの判断はしません。それはレビューする人がします。

## 画面

- **全体図** — 変更を層の地図に置きます。「説明」のタブでは、何のための PR か（チケットの原文から）と、この PR で何が変わるか（テストの値の変化と、変更の流れの図）を見せます。作者の説明のうち、差分に裏付けのない文に印を付けます
- **コース** — 全体図から入り、目的ごとの道筋を 1 か所ずつたどります。道筋の上にある変わっていないコードも見せます
- **目的ごと** — 変更を目的ごとに分けます。同じ書き換えの繰り返しは、サンプル 1 件と差異のあるものだけにまとめます。どの目的にも入らない変更と、複数の目的にまたがる変更も出します
- **差分一覧** — IDE と同じ見た目の差分です。行にメモを書いて GitHub に送れます。AI エージェントのコメントも下書きとして受け取れます

推測で出したもの（LLM の推定など）は、点線と「推定」の印で、事実と分けて見せます。

## しないこと

- 正しさやバグの判断
- ルールの強制や、承認を止めること
- PR を分けるよう作者に求めること

## 入れる

Mac、Node.js 22 以上、pnpm 12 以上、git と、PR のホストにログインした `gh` が要ります。

```sh
git clone https://github.com/katzkb/ondina.git ~/.local/share/ondina
sh ~/.local/share/ondina/scripts/install.sh
```

更新は `ondina update` です。Kotlin の言語サーバー（kotlin-lsp）も一緒に入ります。なくても動きます。

## 使う

```sh
printf '.ondina\nondina.config.yaml\n' >> .git/info/exclude   # リポジトリごとに初回だけ
ondina analyze 123    # PR 123 を解析する
ondina serve          # http://127.0.0.1:4177/ で開く
```

- LLM は、`sh -c` で起動できるコマンドなら何でも使えます（Claude Code・Codex・OpenCode で確認済み）。画面の設定で選びます
- Codex や OpenCode からは「PR 123 を ondina で開いて」と頼めます。AI が作った変更を、PR の前に ondina で見ることもできます

詳しい使い方は [docs/ja/usage.md](docs/ja/usage.md) にあります。

## 開発

```sh
pnpm install
pnpm build       # typecheck より先に通す
pnpm test
pnpm typecheck
pnpm lint
```

設計書は [docs/ja/design.md](docs/ja/design.md)、画面の仕様は [docs/prototype.html](docs/prototype.html) です。
