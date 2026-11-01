[日本語](README.ja.md)

# ondina

A review aid for reading large PRs.
It groups changes by purpose and puts them in reading order.
It does not judge whether code is correct. The reviewer does that.

## Screens

- **Overview (「全体図」)** — Places changes on a map of layers. The explain tab (「説明」) shows what the PR is for (from the original ticket) and what changes in this PR (changes in test values and a diagram of the flow of changes). It marks sentences in the author's description that the diff does not support
- **Course (「コース」)** — Starts at the overview and follows each path by purpose, one place at a time. It also shows unchanged code along the path
- **By purpose (「目的ごと」)** — Groups changes by purpose. Repeated rewrites are folded into one sample and the ones with differences. It also shows changes that belong to no purpose and changes that span multiple purposes
- **Diff list (「差分一覧」)** — A diff with the same appearance as an IDE. You can write notes on lines and send them to GitHub. You can also receive AI agent comments as drafts

Inferences (such as LLM inferences) are shown separately from facts, with dotted lines and an inferred (「推定」) mark.

## What it does not do

- Judge correctness or bugs
- Enforce rules or block approval
- Ask the author to split a PR

## Install

You need a Mac, Node.js 22 or later, pnpm 12 or later, git, and `gh` logged in to the PR's host.

```sh
git clone https://github.com/katzkb/ondina.git ~/.local/share/ondina
sh ~/.local/share/ondina/scripts/install.sh
```

Run `ondina update` to update. The Kotlin language server (kotlin-lsp) is installed too. ondina works without it.

## Use

```sh
printf '.ondina\nondina.config.yaml\n' >> .git/info/exclude   # リポジトリごとに初回だけ
ondina analyze 123    # PR 123 を解析する
ondina serve          # http://127.0.0.1:4177/ で開く
```

- Any command that can run through `sh -c` can serve as the LLM (verified with Claude Code, Codex, and OpenCode). Choose it in the screen settings
- In Codex or OpenCode, you can ask "Open PR 123 in ondina." You can also view AI-generated changes in ondina before creating a PR

See [docs/usage.md](docs/usage.md) for usage details.

## Development

```sh
pnpm install
pnpm build       # typecheck より先に通す
pnpm test
pnpm typecheck
pnpm lint
```

The design doc is [docs/design.md](docs/design.md). The screen specification is [docs/prototype.html](docs/prototype.html).
