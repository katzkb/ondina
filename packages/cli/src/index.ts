#!/usr/bin/env node
// ondina CLI。設計書 5.5 / 13章 M0。引数の解釈と実行は main.ts。
import { readFileSync } from 'node:fs';
import { run } from './main.js';

const code = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  stdin: () => readFileSync(0, 'utf8'),
});
process.exit(code);
