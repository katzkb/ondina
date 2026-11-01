// @ts-check
import tseslint from 'typescript-eslint';
import wording from './eslint-rules/wording.js';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'fixtures/**', 'docs/**'],
  },
  ...tseslint.configs.recommended,
  {
    // 設計書 18.5: UI から Node API を呼ばない規約を lint で強制する。
    // packages/web は Analysis.json と ReviewState を読んで描くだけ（原則5）。
    files: ['packages/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'packages/web から node:* を import しない（設計書 18.5）' },
            { group: ['@ondina/core', '@ondina/core/*'], message: 'packages/web から packages/core を直接 import しない（設計書 18.5）' },
          ],
        },
      ],
    },
  },
  {
    // 製品の日本語（画面・CLI・LLM への指示文）の決まり（docs/wording.md）。テストとコメントは見ない。
    files: ['packages/{web,cli,core}/src/**/*.{ts,tsx}'],
    plugins: { ondina: wording },
    rules: {
      'ondina/wording-words': 'error',
      'ondina/wording-endings': 'error',
    },
  },
  {
    // LLM への指示文は常体で指示し、常体の例文を見せる（LLM が書く文は常体。docs/wording.md）
    files: ['packages/core/src/*/prompt.ts', 'packages/core/src/ticket/choice.ts'],
    rules: { 'ondina/wording-endings': 'off' },
  },
);
