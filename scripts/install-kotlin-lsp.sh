#!/bin/sh
# kotlin-lsp を最新版にする（設計書 5.5 clone して入れる）。scripts/install.sh の 6 段目が走らせる。単独でも走らせられる。
#
#   sh scripts/install-kotlin-lsp.sh
#
# 置き場は ONDINA_LSP_DIR（既定 ~/.local/share/kotlin-lsp）。前に README の手順で手で入れた版も、同じ形なのでそのまま使う。
#   kotlin-server-<版>/  展開した本体
#   current              使う版への symlink。ondina はこの下の bin/intellij-server を起こす（環境変数は要らない。版が変わっても書き換えない）
#
# kotlin-lsp は試用版で、出てから約 30 日で起動しなくなる。入れる版は、このスクリプトの横の kotlin-lsp-version（版の番号 1 行）で知る。
# このファイルは GitHub Actions（.github/workflows/kotlin-lsp-version.yml）が毎日 releases の最新に書き換える。
# 版を ondina の clone で届けるのは、ここから github.com に問い合わせないため。GitHub Enterprise Server だけを使う環境では、github.com に届かないことがある。
# ondina を更新できる PC なら、版の番号も同じ経路で届く。外へ出るのは JetBrains（download.jetbrains.com）だけ。
# まだ置き場に無いときだけ JetBrains から落とす。SHA-256 を確かめてから展開する。
# 入れ替えたら古い版を消す。古い版から先に切れるので、残しても戻り先にならない（1 版で展開後 1.1 GB ほど）。
# 取れなければ今の版のまま、0 以外で終わる。install.sh はそれでも止まらない。
#
# 文字列の中の変数は必ず ${name} と書く（install.sh と同じ。macOS の /bin/sh は $name の直後の全角文字を変数名に含める）。
set -eu

say() { printf '%s\n' "$*"; }
fail() {
  if [ -n "${tmp}" ]; then rm -rf "${tmp}"; fi
  if [ -n "${now}" ]; then
    printf 'kotlin-lsp: %s。今の版（%s）のまま使います\n' "$1" "${now}" >&2
  else
    printf 'kotlin-lsp: %s。kotlin-lsp は入っていません\n' "$1" >&2
  fi
  exit 1
}
# product-info.json の majorVersionReleaseDate（20260930）→ 2026-09-30 の版
released() {
  d=$(sed -n 's/.*"majorVersionReleaseDate": *"\([0-9]\{8\}\)".*/\1/p' "$1/product-info.json" 2>/dev/null | head -n 1)
  if [ -n "${d}" ]; then say "${d}" | sed 's/\(....\)\(..\)\(..\)/\1-\2-\3 の版/'; fi
}
paren() { if [ -n "$1" ]; then printf '（%s）' "$1"; fi; }

main() {
  dir=${ONDINA_LSP_DIR:-${HOME}/.local/share/kotlin-lsp}
  tmp=''
  now=''
  if [ "$(uname -s)" != Darwin ]; then
    say "kotlin-lsp: Mac 以外は自動で入れません（https://github.com/Kotlin/kotlin-lsp/releases から入れ、ONDINA_LSP_COMMAND で指す）"
    return 0
  fi
  arch=''
  if [ "$(uname -m)" = arm64 ]; then arch=-aarch64; fi
  if [ -L "${dir}/current" ]; then
    now=$(readlink "${dir}/current")
    now=${now#kotlin-server-}
  fi

  vfile="$(CDPATH='' cd "$(dirname "$0")" && pwd)/kotlin-lsp-version"
  # 版の番号は URL と置き場のパスに入るので、数字と点の 3 つ組だけを受ける
  ver=$(sed -n '1s/^\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)$/\1/p' "${vfile}" 2>/dev/null || true)
  [ -n "${ver}" ] || fail "入れる版の番号を ${vfile} から読み取れませんでした"
  new="${dir}/kotlin-server-${ver}"

  # 前に途中で止めた残り（Ctrl-C など）
  rm -rf "${dir}"/.tmp-*
  fetched=''
  if [ ! -x "${new}/bin/intellij-server" ]; then
    name="kotlin-server-${ver}${arch}.sit"
    url="https://download.jetbrains.com/language-server/kotlin-server/${ver}/${name}"
    tmp="${dir}/.tmp-${ver}"
    mkdir -p "${tmp}"
    say "最新は ${ver}。落とします（${url}）"
    curl -fL --connect-timeout 10 --progress-bar -o "${tmp}/${name}" "${url}" || fail "${name} を落とせませんでした"
    curl -fsSL --connect-timeout 10 --max-time 60 -o "${tmp}/${name}.sha256" "${url}.sha256" || fail "${name}.sha256 を落とせませんでした"
    want=$(cut -d ' ' -f 1 < "${tmp}/${name}.sha256")
    # shasum は perl。入っていない言語設定だと stderr に警告を出すので C で呼ぶ（出すのは 16 進だけ）
    got=$(LC_ALL=C shasum -a 256 "${tmp}/${name}" | cut -d ' ' -f 1)
    [ "${got}" = "${want}" ] || fail "落とした ${name} の SHA-256 が合いません"
    ditto -x -k "${tmp}/${name}" "${tmp}" || fail "${name} を展開できませんでした"
    [ -x "${tmp}/kotlin-server-${ver}/bin/intellij-server" ] || fail "展開した中に kotlin-server-${ver}/bin/intellij-server がありません"
    rm -rf "${new}" || fail "${new} を消せませんでした"
    mv "${tmp}/kotlin-server-${ver}" "${new}" || fail "kotlin-server-${ver} を置き場へ移せませんでした"
    rm -rf "${tmp}"
    tmp=''
    fetched=1
  fi
  if [ "${now}" != "${ver}" ]; then ln -sfn "kotlin-server-${ver}" "${dir}/current"; fi

  gone=''
  for p in "${dir}"/kotlin-server-*; do
    if [ ! -e "${p}" ] || [ "${p}" = "${new}" ]; then continue; fi
    rm -rf "${p}"
    gone="${gone} ${p##*/}"
  done

  rel=$(released "${new}")
  if [ "${now}" = "${ver}" ] && [ -z "${fetched}" ]; then
    say "kotlin-lsp は最新です$(paren "${ver}${rel:+、${rel}}")"
  else
    from=''
    if [ "${now}" != "${ver}" ]; then from=${now}; fi
    say "kotlin-lsp を ${from:+${from} → }${ver} にしました$(paren "${rel}")"
  fi
  if [ -n "${gone}" ]; then say "使っていない物を消しました:${gone}"; fi

  # ondina は current の下を自分で見つけるので、~/.zshrc に何も足さない（AI エージェントの非対話の zsh は ~/.zshrc を読まない）。
  # ONDINA_LSP_COMMAND はそれより先に使われるので、別の場所を指していれば消すよう出す
  cmd="${dir}/current/bin/intellij-server"
  if [ -n "${ONDINA_LSP_COMMAND:-}" ] && [ "${ONDINA_LSP_COMMAND}" != "${cmd}" ]; then
    say ""
    say "環境変数 ONDINA_LSP_COMMAND が別の場所（${ONDINA_LSP_COMMAND}）を指しているので、ondina はそちらを使います。いま入れた kotlin-lsp を使うには、${ZDOTDIR:-${HOME}}/.zshrc などの ONDINA_LSP_COMMAND の行を消して、ターミナルを開き直してください"
  fi
}

main "$@"
