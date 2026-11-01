#!/bin/sh
# LLM ラベリング（設計書 10 章）の入出力を記録する。テストは LLM を起動せず、ここで記録した JSON を使う。
#
#   sh fixtures/order-service/scripts/record-llm.sh <workdir>
#
# 先に `pnpm build`（cli の dist を使う）。LLM コマンドは環境変数 LLM_COMMAND で差し替えられる（既定は claude -p …）。
# ONDINA_LSP_COMMAND を渡すと --lsp も付ける（LLM 入力に辺が載る。設計書 9 章 / 10.1）。
# 1 回目: previous なし → llm/output.json
# 2 回目: 1 回目の How の id を回転させたものを「前回の解析」として置き、id が維持されるかを見る → llm/input-previous.json / llm/output-previous.json
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$here/../.." && pwd)
dir=${1:?usage: record-llm.sh <workdir>}
cmd=${LLM_COMMAND:-'claude -p --tools "" --max-turns 1 --model opus'}
cli="node $root/packages/cli/dist/index.js"
# LSP コマンドがあれば辺つきで記録する（無ければ辺なしの入力になる）
lsp=""
if [ -n "${ONDINA_LSP_COMMAND:-}" ]; then lsp="--lsp"; fi

sh "$here/scripts/build-repo.sh" "$dir"
mkdir -p "$here/llm"
sha=$(git -C "$dir" rev-parse feature/discount)

echo "--- 1 回目（previous なし）: $cmd" >&2
(cd "$dir" && ONDINA_LLM_COMMAND="tee '$dir/prompt1.txt' | $cmd" $cli analyze --base main --head feature/discount --body "$here/pr-body.md" --relabel $lsp)
cp "$dir/.ondina/local/llm/$sha.json" "$here/llm/output.json"

echo "--- 前回の解析を作る（How の id を回転）" >&2
node - "$dir" "$sha" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [dir, sha] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(path.join(dir, '.ondina/local', `${sha}.json`), 'utf8'));
if (a.hows.length === 0) throw new Error('1 回目の hows が空です。llm/output.json を確認してください');
const ids = a.hows.map((h) => h.id);
const rotated = new Map(ids.map((id, i) => [id, ids[(i + 1) % ids.length]]));
const fake = 'f'.repeat(40);
a.pr = { ...a.pr, headSha: fake };
a.hows = a.hows.map((h) => ({ ...h, id: rotated.get(h.id) }));
a.hunks = a.hunks.map((h) => ({ ...h, hows: h.hows.map((id) => rotated.get(id)).sort((x, y) => x - y) }));
fs.writeFileSync(path.join(dir, '.ondina/local', `${fake}.json`), JSON.stringify(a, null, 2) + '\n');
console.error(`  ${[...rotated].map(([f, t]) => `${f}→${t}`).join(', ')}`);
NODE

echo "--- 2 回目（previous あり）" >&2
(cd "$dir" && ONDINA_LLM_COMMAND="tee '$dir/prompt2.txt' | $cmd" $cli analyze --base main --head feature/discount --body "$here/pr-body.md" --relabel $lsp)
cp "$dir/.ondina/local/llm/$sha.json" "$here/llm/output-previous.json"
node - "$dir" "$here" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [dir, here] = process.argv.slice(2);
const prompt = fs.readFileSync(path.join(dir, 'prompt2.txt'), 'utf8');
const input = prompt.slice(prompt.lastIndexOf('入力:\n') + '入力:\n'.length);
fs.writeFileSync(path.join(here, 'llm/input-previous.json'), JSON.stringify(JSON.parse(input), null, 2) + '\n');
NODE
echo "記録しました: $here/llm/{output,input-previous,output-previous}.json" >&2
