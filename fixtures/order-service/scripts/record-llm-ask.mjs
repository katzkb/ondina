// 案内人に聞く（設計書 10.5）の答えを記録する。テストは LLM を起動せず、ここで記録した JSON を使う。
//
//   node fixtures/order-service/scripts/record-llm-ask.mjs [pr|symbol|hunk|lines|why ...]
//   LLM_COMMAND='codex exec --skip-git-repo-check -s read-only -' node fixtures/order-service/scripts/record-llm-ask.mjs web
//
// 先に `pnpm build`（core の dist を使う）。入力はゴールデン expected/ask-input-<name>.json（core のテスト ask.input.test.ts が組む）なので、
// 言語サーバーも fixture の git リポジトリも要らない。LLM コマンドは環境変数 LLM_COMMAND で差し替えられる（既定は analyze の既定と同じ claude -p …）。
// 出力が読めなければ保存しない。かかった時間を記録に残す（設計書 10.5 の待ち時間）。
// web（コードの外の問い「?: って何？」）は、ネットを調べられる codex で採る（既定の claude -p --tools "" は調べられない）。既定の 4 つには入れない。
// why（PR の本文・チケット・背景のある入力で「なぜ」を聞く。2026-11-04）も既定の 4 つには入れない。
// 答えの代わりに need（読みたいコード）が返ったら保存しない（読んで聞き直すのは serve だけ。ここは 1 回しか聞かない）。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAskOutput, renderAskPrompt } from '../../../packages/core/dist/index.js';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.env.LLM_COMMAND || 'claude -p --tools "" --max-turns 1 --model opus';
const names = process.argv.length > 2 ? process.argv.slice(2) : ['pr', 'symbol', 'hunk', 'lines'];

let failed = false;
for (const name of names) {
  const input = JSON.parse(readFileSync(path.join(here, `expected/ask-input-${name}.json`), 'utf8'));
  const prompt = renderAskPrompt(input);
  process.stderr.write(`--- ${name}: ${input.question}（プロンプト ${Math.round(prompt.length / 1024)} KB）\n`);
  const started = Date.now();
  const run = spawnSync('sh', ['-c', command], { input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60 * 1000 });
  const ms = Date.now() - started;
  if (run.error || run.status !== 0) {
    process.stderr.write(`失敗: ${run.error?.message ?? `終了コード ${run.status}`}\n${run.stderr}\n`);
    failed = true;
    continue;
  }
  const parsed = parseAskOutput(run.stdout);
  if ('error' in parsed) {
    process.stderr.write(`出力が読めません: ${parsed.error}\n${run.stdout.slice(0, 2000)}\n`);
    failed = true;
    continue;
  }
  if ('need' in parsed) {
    process.stderr.write(`答えの代わりに need が返りました（保存しません）: ${JSON.stringify(parsed.need)}\n`);
    failed = true;
    continue;
  }
  const file = path.join(here, `llm/ask-${name}.json`);
  // codex の stderr は会話の写し（作業場所・セッション id・フックの出力）なので、調べた跡（web search: の行）だけ残す
  const stderr = command.startsWith('codex') ? run.stderr.split('\n').filter((l) => l.startsWith('web search:')).join('\n') : run.stderr;
  writeFileSync(file, JSON.stringify({ command, stdout: run.stdout, stderr, ms, recordedAt: new Date().toISOString() }, null, 2) + '\n');
  process.stderr.write(`保存: ${path.relative(process.cwd(), file)}（${Math.round(ms / 1000)} 秒、項目 ${parsed.output.items.length}）\n`);
}
process.exit(failed ? 1 : 0);
