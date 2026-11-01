// 2 回目の LLM（文を書く。設計書 5.3 / 10 章）の出力を記録する。テストは LLM を起動せず、ここで記録した JSON を使う。
//
//   node fixtures/order-service/scripts/record-llm-text.mjs
//
// 先に `pnpm build`（core の dist を使う）。入力はゴールデン expected/llm-text-input.json（core のテスト narration.input.test.ts が
// 1 回目の記録の検証結果と経路のゴールデンから組む）なので、言語サーバーも fixture の git リポジトリも要らない。
// LLM コマンドは環境変数 LLM_COMMAND で差し替えられる（既定は analyze の既定と同じ claude -p …）。
// 1 回目の記録（record-llm.sh / llm/output.json）は触らない。出力が読めなければ保存しない。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNarrationOutput, renderNarrationPrompt } from '../../../packages/core/dist/index.js';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.env.LLM_COMMAND || 'claude -p --tools "" --max-turns 1 --model opus';
const input = JSON.parse(readFileSync(path.join(here, 'expected/llm-text-input.json'), 'utf8'));
const prompt = renderNarrationPrompt(input);

process.stderr.write(`--- 2 回目（文を書く）: ${command}（プロンプト ${Math.round(prompt.length / 1024)} KB）\n`);
const run = spawnSync('sh', ['-c', command], { input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 });
if (run.error || run.status !== 0) {
  process.stderr.write(`失敗: ${run.error?.message ?? `終了コード ${run.status}`}\n${run.stderr}\n`);
  process.exit(1);
}
const parsed = parseNarrationOutput(run.stdout);
if ('error' in parsed) {
  process.stderr.write(`出力が読めません: ${parsed.error}\n${run.stdout.slice(0, 2000)}\n`);
  process.exit(1);
}
const file = path.join(here, 'llm/text-output.json');
writeFileSync(file, JSON.stringify({ command, stdout: run.stdout, stderr: run.stderr, recordedAt: new Date().toISOString() }, null, 2) + '\n');
process.stderr.write(`保存: ${path.relative(process.cwd(), file)}（コース ${parsed.output.courses.length}）\n`);
