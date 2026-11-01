// 要求の抜き出し（設計書 10.8）の出力を記録する。テストは LLM を起動せず、ここで記録した JSON を使う。
//
//   node fixtures/order-service/scripts/record-llm-spec.mjs
//
// 先に `pnpm build`（core の dist を使う）。入力はゴールデン expected/llm-spec-input.json（core のテスト spec.input.test.ts が
// 1 回目の入力のゴールデンと、1 回目の記録の検証結果と、偽 Jira のチケット ticket/jira-issue.json から組む）なので、
// 言語サーバーも fixture の git リポジトリも Jira も要らない。
// LLM コマンドは環境変数 LLM_COMMAND で差し替えられる（既定は analyze の既定と同じ claude -p …）。出力が読めなければ保存しない。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpecOutput, renderSpecPrompt } from '../../../packages/core/dist/index.js';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.env.LLM_COMMAND || 'claude -p --tools "" --max-turns 1 --model opus';
const input = JSON.parse(readFileSync(path.join(here, 'expected/llm-spec-input.json'), 'utf8'));
const prompt = renderSpecPrompt(input);

process.stderr.write(`--- 要求の抜き出し: ${command}（プロンプト ${Math.round(prompt.length / 1024)} KB）\n`);
const started = Date.now();
const run = spawnSync('sh', ['-c', command], { input: prompt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 });
if (run.error || run.status !== 0) {
  process.stderr.write(`失敗: ${run.error?.message ?? `終了コード ${run.status}`}\n${run.stderr}\n`);
  process.exit(1);
}
const parsed = parseSpecOutput(run.stdout);
if ('error' in parsed) {
  process.stderr.write(`出力が読めません: ${parsed.error}\n${run.stdout.slice(0, 2000)}\n`);
  process.exit(1);
}
const file = path.join(here, 'llm/spec-output.json');
writeFileSync(file, JSON.stringify({ command, stdout: run.stdout, stderr: run.stderr, recordedAt: new Date().toISOString() }, null, 2) + '\n');
process.stderr.write(`保存: ${path.relative(process.cwd(), file)}（要求 ${parsed.output.specs.length}、${Math.round((Date.now() - started) / 1000)} 秒）\n`);
