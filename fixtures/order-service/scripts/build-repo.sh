#!/usr/bin/env sh
# fixtures/order-service の base/ と head/ から、main と feature/discount の 2 ブランチを持つ
# git リポジトリを <dest> に作る。CLI の worktree 連携や gh 無しの動作確認に使う。
#
#   sh fixtures/order-service/scripts/build-repo.sh /tmp/order-service
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
dest=${1:?usage: build-repo.sh <dest-dir>}

# 利用者のグローバル設定（hooks / 署名 / 名前）に依存しないよう、毎回同じ設定で git を呼ぶ
g() {
  git -C "$dest" \
    -c core.hooksPath=/dev/null \
    -c commit.gpgsign=false \
    -c user.name=fixture \
    -c user.email=fixture@example.com \
    "$@"
}

if [ -e "$dest" ] && [ -n "$(ls -A "$dest")" ]; then
  echo "build-repo.sh: $dest is not empty" >&2
  exit 1
fi
mkdir -p "$dest"
git -c init.templateDir= init -q -b main "$dest"

cp -R "$here/base/." "$dest/"
# ondina.config.yaml は base/ の外にあるので別にコピーする（両ブランチに入る）
cp "$here/ondina.config.yaml" "$dest/"
g add -A
g commit -q -m "Add order-service"

g checkout -q -b feature/discount
# base にあって head に無いファイルを消してから head を重ねる
(cd "$here/base" && find . -type f) | while IFS= read -r f; do
  [ -e "$here/head/$f" ] || rm -f "$dest/$f"
done
cp -R "$here/head/." "$dest/"
g add -A
g commit -q -m "Apply discount to orders"

g checkout -q main
printf '%s\n' "$dest"
