// 差分ごとの意図（設計書 10.9）の出力を記録する。テストは LLM を起動せず、ここで記録した JSON を使う。
//
//   node fixtures/order-service/scripts/record-llm-intent.mjs
//
// 先に `pnpm build`（core の dist を使う）。入力はゴールデン expected/llm-intent-input.json（core のテスト intent.input.test.ts が
// 差分とチケットの既存のゴールデン、PR 本文、コミットの説明から組む）なので、
// 言語サーバーも fixture の git リポジトリも Jira も要らない。
// LLM コマンドは環境変数 LLM_COMMAND で差し替えられる（既定は analyze の既定と同じ claude -p …）。出力が読めなければ保存しない。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIntentOutput, renderIntentPrompt } from '../../../packages/core/dist/index.js';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.env.LLM_COMMAND || 'claude -p --tools "" --max-turns 1 --model opus';
const input = JSON.parse(readFileSync(path.join(here, 'expected/llm-intent-input.json'), 'utf8'));
const prompt = renderIntentPrompt(input);

process.stderr.write(`--- 差分ごとの意図: ${command}（プロンプト ${Math.round(prompt.length / 1024)} KB）\n`);
const started = Date.now();
const run = spawnSync('sh', ['-c', command], { input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 });
if (run.error || run.status !== 0) {
  process.stderr.write(`失敗: ${run.error?.message ?? `終了コード ${run.status}`}\n${run.stderr}\n`);
  process.exit(1);
}
const parsed = parseIntentOutput(run.stdout);
if ('error' in parsed) {
  process.stderr.write(`出力が読めません: ${parsed.error}\n${run.stdout.slice(0, 2000)}\n`);
  process.exit(1);
}
const file = path.join(here, 'llm/intent-output.json');
writeFileSync(file, JSON.stringify({ command, stdout: run.stdout, stderr: run.stderr, recordedAt: new Date().toISOString() }, null, 2) + '\n');
process.stderr.write(`保存: ${path.relative(process.cwd(), file)}（意図 ${parsed.output.intents.length}、${Math.round((Date.now() - started) / 1000)} 秒）\n`);
