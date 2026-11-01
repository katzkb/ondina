[日本語](ja/usage.md)

# Using ondina

Installation, updates, troubleshooting, and usage by feature. See the [README](../README.md) for an overview.

## Install

Requirements: Mac, Node.js 22 or later, pnpm 12 or later, git. To read a PR (`ondina analyze <pr>`), you need `gh` logged in to the PR's host (github.com or GitHub Enterprise Server). ondina passes the PR's host to gh even if gh is also logged in to other hosts

### First installation

1. Clone
   ```sh
   git clone https://github.com/katzkb/ondina.git ~/.local/share/ondina
   ```
2. Build and install the `ondina` command
   ```sh
   sh ~/.local/share/ondina/scripts/install.sh
   ```
   The installed version appears after `[1/6]`–`[6/6]`. If `~/.local/bin` is missing from PATH, it also prints a line to add to `~/.zshenv` (`~/.zshrc` is read only by interactive zsh, so non-interactive zsh run by AI agents cannot find ondina). Tab completion definitions are placed in `~/.zsh_functions/_ondina` and rebuilt on every `ondina update`. At the end, it starts your usual zsh to check completion. If completion does not work, it prints a `source "…/.zsh_functions/_ondina"` line to add at the end of `~/.zshrc` (reopen the terminal after adding it). AI agent skills (Codex and OpenCode) are placed in `~/.agents/skills/ondina/`, `~/.agents/skills/ondina-comments/`, and `~/.agents/skills/ondina-preview/` (see "Open from an AI agent and have it add comments" and "View AI-generated changes before a PR" below)
3. kotlin-lsp (used for map relationship lines and coloring; ondina works without it) is installed in `~/.local/share/kotlin-lsp/` by `[6/6]` of step 2. It downloads from JetBrains using the latest version number held by ondina (`scripts/kotlin-lsp-version`, updated by GitHub Actions every morning from https://github.com/Kotlin/kotlin-lsp/releases), checks SHA-256, and extracts it (about 360 MB, about 1.1 GB after extraction). It does not query github.com. Its only external connection is to download.jetbrains.com. A version-independent name, `current`, points to the version in use. ondina finds this `current` itself, so nothing needs to be added to `~/.zshrc` or elsewhere (it also starts for `ondina analyze` run by an AI agent). You can keep or remove an `export ONDINA_LSP_COMMAND=…/current/bin/intellij-server` previously added to `~/.zshrc`. If it points elsewhere, that location takes precedence, so a message asks you to remove it

   kotlin-lsp is a trial build and stops starting about 30 days after release (263.4702.0 expired on 2026-10-09). When it expires, the analysis entry screen shows "No relationship lines. The language server could not be used: … This build of kotlin-server has expired." (「関連の線がありません。言語サーバーが使えませんでした: … This build of kotlin-server has expired.」). Run `ondina update`, then run `ondina analyze` again. If a new version is available, it replaces the old one and the old version is removed. If `ondina update` says "kotlin-lsp is up to date" (「kotlin-lsp は最新です」) but it has expired, wait for a new version (releases can be more than 30 days apart; 262.9593.0 → 263.4702.0 took 48 days). New versions reach ondina at about 6 a.m. the morning after release

### Update or roll back

```sh
ondina update            # main の最新を取って組み立て直す
ondina update 1857abd    # そのバージョンに戻す
ondina --version         # インストールされているバージョン（コミットと日付）
```

Each update shows "Updated ondina from 1857abd → 9a0b1c2" (「ondina を 1857abd → 9a0b1c2 にしました」) and the list of included commits. kotlin-lsp is also replaced if a new version is available ("Updated kotlin-lsp from 263.4702.0 → 263.6379.0" (「kotlin-lsp を 263.4702.0 → 263.6379.0 にしました」)). To update only kotlin-lsp, run `sh ~/.local/share/ondina/scripts/install-kotlin-lsp.sh`

A screen (serve) already running before the update keeps serving the new screen with old code. Restart entries marked "Before update" (「更新前」) in `ondina serve list` with `ondina serve restart <ポート>` (or `--all` for all entries)

### Troubleshooting

- "Could not fetch from github.com" (「github.com から取れませんでした」): check access to github.com (network or proxy), then run `ondina update`
- "Build failed" (「組み立てに失敗しました」): roll back with `sh …/scripts/install.sh <前のバージョン>` shown in the message
- "kotlin-lsp: could not download …" (「kotlin-lsp: …を落とせませんでした」): kotlin-lsp remains at its current version; the ondina update is complete. Check access to download.jetbrains.com (network or proxy), then run `sh ~/.local/share/ondina/scripts/install-kotlin-lsp.sh`
- If `ondina` itself will not start, run `sh ~/.local/share/ondina/scripts/install.sh` directly to repair it
- If `ondina update` stops partway and cannot continue (the installed version's script itself is broken), fetch again with git and run the script directly
  ```sh
  git -C ~/.local/share/ondina fetch
  git -C ~/.local/share/ondina checkout --detach origin/main
  sh ~/.local/share/ondina/scripts/install.sh
  ```

### First use in a repository

- Add the analysis directory `.ondina/` and configuration `ondina.config.yaml` to `.git/info/exclude` so they are not committed (do not add a trailing `/` to `.ondina`. With it, a `.ondina` symlink in a worktree is not ignored)
  ```sh
  printf '.ondina\nondina.config.yaml\n' >> .git/info/exclude
  ```
- On the first `ondina analyze`, before the PR, the LLM receives a list of all files in the repository and infers its structure (the layers that become map bands). The result is saved in `.ondina/structure.json` and reused from the second run onward (no LLM call). If files are added later and you see "n more files could not be classified in the structure" (「構成に分類できないファイルが n 件増えました」), run `ondina structure` to infer it again, then rerun `ondina analyze`
- The language server (kotlin-lsp) starts by default if installed at `~/.local/share/kotlin-lsp/current` (step 3 above). No yaml or environment variables are needed. To use one elsewhere, set `ONDINA_LSP_COMMAND` to its `bin/intellij-server` path (takes precedence). Initial preparation for each PR takes about a minute (longer in large repositories; while waiting, one line reports what it is doing every 30 seconds). To avoid starting it, use `ondina analyze <pr> --no-lsp`
- Write `layers` in `ondina.config.yaml` only if you want to define layers yourself (takes precedence over inference). See `fixtures/order-service/ondina.config.yaml` for an example
- Choose an allowed LLM command in the field at the bottom of the screen's rail (the "LLM commands" table below)

### When new commits are added to a PR

- With the screen open, "There are 2 new commits" (「新しいコミットが 2 件あります」) appears below the top bar (GitHub is queried when you return to the screen and every 2 minutes). Press Analyze again (「解析し直す」) to run `ondina analyze` in the background. Status and progress appear on the same line. You can keep using the previous version during analysis
- When it finishes, "Analysis of the new version is ready" (「新しいバージョンの解析ができました」) and Switch (「切り替える」) appear. The previous version remains until you press it
- Switching carries over No issues (「問題なし」) marks on unchanged diffs, and unsent notes and AI drafts on unchanged lines. Changed diffs return to unreviewed, and the same line shows their count and the count of notes that could not be moved and remain in the previous version. You can open the previous version anytime using the selector at the upper left
- Rerunning `ondina analyze <pr>` in a terminal also carries these over when you open that new version on screen. You can leave the screen open. When you return to the browser tab, the new analysis appears in the list at the upper left

### Open from an AI agent and have it add comments

You can run ondina from Codex or OpenCode. `ondina update` places skills in `~/.agents/skills/`, so you only need to ask in the target repository.

```
PR 123 を ondina で開いて        … 解析して画面を開く（スキル ondina）
ondina で開いて                  … 番号がなければ、今いるブランチの PR を開く
PR 123 をレビューして ondina にコメントして   … 画面の「AI の下書き」にコメントが並ぶ（スキル ondina-comments）
```

- The intended order is: open → get an outline of the PR on screen → request comments → finish the review while reading drafts. You can also ask "Open PR 123 in ondina and add comments" in one request
- To name skills explicitly, use `$ondina` / `$ondina-comments` in Codex (example: `$ondina $ondina-comments PR 123`), or the `/ondina` / `/ondina-comments` commands in OpenCode (example: `/ondina PR 123 を開いてコメントして`)
- The opening skill runs `ondina analyze` if there is no analysis for the current version (a few minutes), starts the screen with `ondina serve --background`, and opens it in a browser. A `--background` screen remains after the agent finishes. If a screen for this repository is already running, it reuses it (including one started in another worktree of the same repository). Stop it with `ondina serve stop <ポート>` (it starts on another port if 4177 is occupied). `ondina serve list` lists running screens by port, folder, and version. Screens running since before `ondina update` show Before update. Restart with the current version using `ondina serve restart <ポート>`
- The comment skill does not analyze. If asked about a PR that is not open, it replies "Open it in ondina first" (「先に ondina で開いて」)
- Without a PR number, both skills use the PR for the current branch (the worktree's branch if in a worktree). If the branch has no PR, they ask for a number and stop
- PR analysis goes into the original checkout's `.ondina/`, even when run in a worktree. One screen shows PRs analyzed in any worktree. Analysis and configuration for changes without a PR go into `.ondina/` in the worktree where the command runs. To share configuration with the original checkout too, create a symlink to the original checkout's `.ondina` when creating the worktree
- The agent checks analyzed versions with `ondina list`, reads the diff for that version, and passes comments prefixed with `[must]` / `[imo]` / `[ask]` through `ondina comments add`
- Drafts appear in AI drafts (「AI の下書き」) on the wrap-up (「締め」) screen. If the screen is open, just return to the browser tab to see them. Choose to accept, edit, or discard them. Only accepted drafts are sent to GitHub with your notes. The agent does not send them to GitHub
- On the first `ondina update` to a version that installs skills, they are not installed yet (it runs the previously installed version's install.sh). Run `ondina update` again to install them
- Skills are replaced on every `ondina update`. Manual changes are overwritten

### View AI-generated changes before a PR

You can view AI-generated changes in ondina as a pseudo PR before creating a PR, then return comments to that agent (the ondina-preview skill).

```
作った変更を ondina で見せて       … 題と説明を書いて解析し、画面を開いて、返したコメントを待つ
ondina で返したコメントを読んで    … エージェントが待っていなかったときに、返したコメントを受け取らせる
```

- The agent analyzes with `ondina analyze --base main --title <題> --body <説明>` (without `--head`). It combines the current branch's commits, uncommitted changes, and new files into one pseudo PR. ondina does not create commits or change the working tree, index, or branch (`.ondina` may be in `.gitignore`)
- View the changes, write notes using "+" by line numbers, and press Return to AI (「AI に返す」) on the wrap-up screen. Accepted AI drafts are returned too
- The agent waits with `ondina comments wait`. When comments arrive, it makes changes and analyzes again. Switch when "Analysis of the new version … is ready" (「新しいバージョン … の解析ができました」) appears at the top of the screen. Tell the agent "OK" or similar when finished
- If "No AI is waiting now" (「いま待っている AI はいません」) appears after returning comments, the agent is not waiting. Ask it to "Read the comments returned through ondina" (「ondina で返したコメントを読んで」) (returned comments remain until received)
- Agents that can run a command in the background and receive a completion notification can keep talking while waiting. Other agents wait until the command finishes

### Show a ticket

- Use `ondina analyze <pr> --ticket SHOP-421` (ID), `--ticket https://…/browse/SHOP-421` (URL), or `--ticket ./ticket.md` (file). Spec (「仕様」) on the explain screen (key `2`) shows the title, type, status, and body. If retrieval fails, it shows the reason (analysis continues)
- Without `--ticket`, it extracts IDs and URLs from the PR title, branch name, and body. The LLM chooses and retrieves the ticket for this PR. The screen marks it as inferred and shows where it was found and candidates not chosen. If it is wrong, specify it again with `--ticket`
- When a ticket is retrieved, the LLM extracts "what should hold for this PR" (requirements) from it and chooses corresponding courses for each requirement. Spec shows requirement rows and circles for corresponding courses (press to select that course). Requirements without a match are red. The original text is collapsed below. "Spec n/N" (「仕様 n/N」) in the top bar counts requirements with a corresponding course
- Jira (Cloud or Jira Server / Data Center): enter it in Jira URL (「Jira の URL」) in the screen settings (gear) (unnecessary when specifying a URL). Store the token in the Mac keychain (service name `ondina-jira`) with `ondina token`. Paste the token and press Enter (it is not displayed or saved in shell history). The stored value is read back to verify it
  - Use `ondina token` again to replace it (overwrite). From the clipboard: `pbpaste | ondina token`
  - If the environment variable `ONDINA_TICKET_TOKEN` is set, it takes precedence over the keychain (use this outside Mac)
  - Jira Cloud: an API token created in your Atlassian account, and Jira email (「Jira のメール」) in settings
  - Jira Server / Data Center: a personal access token created in your Jira profile. Leave email blank
- Other than Jira: set Ticket retrieval (「チケットの取り方」) in settings to Command (「コマンド」) and enter a command to retrieve tickets. The value is passed through the environment variable `ONDINA_TICKET`. Output JSON (`title` / `body` / `url`) or a body (Markdown) to stdout. Example for GitHub Issues: `gh issue view "$ONDINA_TICKET" --json title,body,url`
- Jira is not yet reachable on networks requiring a proxy (the screen shows "Could not connect to Jira" (「Jira に接続できませんでした」))

## LLM commands

After extracting diffs and detecting follow-ons, `ondina analyze` calls the LLM once to divide changes into "How" (groups of what was done), summarize them, and assess support for the author's description. The LLM is not tied to a specific vendor. There is just one contract:

> Start through `sh -c <command>`, receive the full prompt on stdin, and return one JSON object on stdout

| Command | Verified version | Notes |
|---|---|---|
| `claude -p --tools "" --max-turns 1 --model opus` (default) | Claude Code 2.1.274 | Works with a subscription login. Uses API billing if `ANTHROPIC_API_KEY` is set |
| `codex exec --skip-git-repo-check -s read-only -` | codex-cli 0.154.0 | Progress on stderr, JSON on stdout |
| `opencode run` | OpenCode 1.18.31 | Reads stdin without arguments. Specify the model with `-m provider/model` |

Precedence: field at the bottom of the UI rail (`.ondina/ui.json`) > environment variable `ONDINA_LLM_COMMAND` > `llm.command` in `ondina.config.yaml` > default.
Raw output is saved in `.ondina/<pr>/llm/<headSha>.json`. It is not called again for the same headSha (use `--relabel` to call again; `--no-llm` to skip). Tests do not start the LLM.

