#!/bin/sh
# ondina を入れる・更新する（設計書 5.5 clone して入れる）。初回も更新も同じ 1 本。
# この clone を main の最新（または引数の版）にして組み立て、ondina コマンドと AI エージェントのスキルを置く。kotlin-lsp も最新にする（scripts/install-kotlin-lsp.sh）。
#
#   sh scripts/install.sh          main の最新にする（ondina update と同じ）
#   sh scripts/install.sh <版>     その版にする（戻すとき）
#
# コマンドの置き場は ONDINA_BIN_DIR（既定 ~/.local/bin）。rc ファイルは書き換えない。
#
# 文字列の中の変数は必ず ${name} と書く。macOS の /bin/sh（bash 3.2）は UTF-8 の環境で、$name の直後の全角文字（「（」など）を
# 変数名に含めてしまい、set -u で止まる。
#
# 本体は関数に包んで最後に呼ぶ。途中の git checkout がこのファイル自身を書き換えても、
# sh は関数を読み終えてから走らせるので、読みかけのファイルが変わって壊れることがない。
set -eu

say() { printf '%s\n' "$*"; }
fail() {
  printf 'ondina install: %s\n' "$*" >&2
  exit 1
}
step() { say "[$1/6] $2"; }
# v22.3.0 / 12.4.1 → 22 / 12
major() {
  v=${1#v}
  say "${v%%.*}"
}
short() { git rev-parse --short=7 "$1"; }
cdate() { git log -1 --format=%cs "$1"; }
# 版の間のコミットを 10 件まで並べる
commits() {
  say "$1"
  git log --abbrev=7 --format='  %h %s' -n 10 "$2"
  n=$(git rev-list --count "$2")
  if [ "${n}" -gt 10 ]; then say "  ほか $((n - 10)) 件"; fi
}
# 普段の zsh（~/.zshrc を読む対話の zsh）を起こし、「ondina-completion:<compinit が走ったか 1/0>:<ondina の補完関数>」の行を出す。
# ~/.zshrc が先に制御文字などを出しても拾えるよう、行の途中から切り出す。~/.zshrc が何かを待って止まっても、perl があれば 20 秒で打ち切る
zsh_completion() {
  set -- zsh -i -c 'print -r -- "ondina-completion:${+functions[compdef]}:${_comps[ondina]-}"'
  if command -v perl >/dev/null 2>&1; then set -- perl -e 'alarm 20; exec @ARGV' "$@"; fi
  "$@" </dev/null 2>/dev/null | sed -n 's/^.*\(ondina-completion:[01]:.*\)$/\1/p' | tail -n 1
}

main() {
  root=$(cd "$(dirname "$0")/.." && pwd)
  bin=${ONDINA_BIN_DIR:-${HOME}/.local/bin}
  target=${1:-origin/main}
  cd "${root}"

  step 1 "前提を確かめる"
  command -v git >/dev/null 2>&1 || fail "git が見つかりません"
  command -v node >/dev/null 2>&1 || fail "Node.js が見つかりません。Node.js 22 以上を入れてください"
  node_v=$(node -v)
  [ "$(major "${node_v}")" -ge 22 ] 2>/dev/null || fail "Node.js 22 以上が要ります（今は ${node_v}）"
  command -v pnpm >/dev/null 2>&1 || fail "pnpm が見つかりません。pnpm 12 以上を入れてください"
  pnpm_v=$(pnpm -v)
  [ "$(major "${pnpm_v}")" -ge 12 ] 2>/dev/null || fail "pnpm 12 以上が要ります（今は ${pnpm_v}）"

  step 2 "clone の状態を確かめる"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    fail "${root} のファイルが書き換わっています。入れた ondina は直接直さない前提です。git -C ${root} status で確かめてください"
  fi
  branch=$(git symbolic-ref --quiet --short HEAD || true)
  if [ -n "${branch}" ] && [ "${branch}" != main ]; then
    fail "ブランチ '${branch}' にいるので止めました。開発用の clone では走らせません（clone した直後の main か、前にこのスクリプトで入れた状態でだけ走らせます）"
  fi
  old=$(git rev-parse HEAD)

  step 3 "最新を取る（${target}）"
  git fetch --quiet origin || fail "github.com から取れませんでした。ネットワークを確かめてから、もう一度走らせてください"
  git -c advice.detachedHead=false checkout --quiet --detach "${target}" || fail "版 '${target}' に切り替えられませんでした"
  new=$(git rev-parse HEAD)

  step 4 "組み立てる（pnpm install と pnpm build）"
  pnpm install --frozen-lockfile && pnpm build || fail "組み立てに失敗しました。前の版に戻すには: sh ${root}/scripts/install.sh $(short "${old}")"

  step 5 "ondina コマンドと Tab 補完とスキルを置く（${bin}/ondina）"
  chmod +x packages/cli/dist/index.js
  mkdir -p "${bin}"
  ln -sfn "${root}/packages/cli/dist/index.js" "${bin}/ondina"
  zdir=${ZDOTDIR:-${HOME}}/.zsh_functions
  mkdir -p "${zdir}"
  "${root}/packages/cli/dist/index.js" completion zsh > "${zdir}/_ondina" || fail "Tab 補完の定義を書けませんでした: ${zdir}/_ondina"
  # AI エージェント（Codex・OpenCode）が読むスキル（設計書 12 章）。取った版の skills/ を 1 つずつ置き直す。ほかのスキルには触らない
  sdir=${HOME}/.agents/skills
  if [ -d skills ]; then
    mkdir -p "${sdir}"
    for s in skills/*/; do
      name=$(basename "${s}")
      rm -rf "${sdir:?}/${name}"
      cp -R "skills/${name}" "${sdir}/${name}" || fail "スキルを置けませんでした: ${sdir}/${name}"
      say "スキルを置きました: ${sdir}/${name}"
    done
  else
    say "この版はスキルを置きません"
  fi

  # 取った版の install-kotlin-lsp.sh を走らせる（取り方や入れる版の番号 scripts/kotlin-lsp-version を直せば、その回の更新から効く）。失敗しても ondina の更新は止めない
  step 6 "kotlin-lsp を最新にする"
  if [ -f scripts/install-kotlin-lsp.sh ]; then
    sh scripts/install-kotlin-lsp.sh || true
  else
    say "この版は kotlin-lsp を入れません"
  fi

  say ""
  if [ "${old}" = "${new}" ]; then
    say "ondina は最新です（$(short "${new}")、$(cdate "${new}")）"
  else
    say "ondina を $(short "${old}") → $(short "${new}") にしました（$(cdate "${new}")）"
    if git merge-base --is-ancestor "${old}" "${new}"; then
      commits "入ったコミット:" "${old}..${new}"
    elif git merge-base --is-ancestor "${new}" "${old}"; then
      commits "外れたコミット:" "${new}..${old}"
    fi
  fi

  # ~/.zshrc ではなく ~/.zshenv。~/.zshrc は対話の zsh しか読まず、AI エージェントが打つ非対話の zsh（zsh -lc）からは ondina が見つからない
  case ":${PATH}:" in
    *":${bin}:"*) ;;
    *)
      say ""
      say "${bin} が PATH にありません。${ZDOTDIR:-${HOME}}/.zshenv に次の 1 行を足して、ターミナルを開き直してください:"
      say "  export PATH=\"${bin}:\$PATH\""
      ;;
  esac

  # Tab 補完が効くかは、~/.zshrc の文字を探さず、普段の zsh を起こして ondina が補完の対象に登録されたかで確かめる。
  # prezto などが ~/.zshrc の先頭で compinit を走らせると、後ろで fpath に足しても効かない。末尾で source すれば compinit の後に
  # compdef が走るので、行の順番にも、補完の一覧の使い回し（prezto は 20 時間）にも左右されない
  if command -v zsh >/dev/null 2>&1; then
    zrc=${ZDOTDIR:-${HOME}}/.zshrc
    case "$(zsh_completion)" in
      ondina-completion:1:_ondina) ;;
      ondina-completion:1:*)
        say ""
        say "Tab 補完が zsh に読まれていません。${zrc} の末尾に次の 1 行を足して、ターミナルを開き直してください:"
        say "  source \"${zdir}/_ondina\""
        ;;
      ondina-completion:0:*)
        say ""
        say "zsh の補完の仕組み（compinit）が起動していません。${zrc} の末尾に次の 2 行を足して、ターミナルを開き直してください:"
        say "  autoload -Uz compinit && compinit"
        say "  source \"${zdir}/_ondina\""
        ;;
      *)
        say ""
        say "Tab 補完が効くか確かめられませんでした（zsh が 20 秒で終わらなかったか、起動できませんでした）。効かなければ ${zrc} の末尾に次の 1 行を足して、ターミナルを開き直してください:"
        say "  source \"${zdir}/_ondina\""
        ;;
    esac
  fi
}

main "$@"
