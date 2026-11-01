import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // eslint-rules: 製品の日本語の決まりを守らせる lint ルール（docs/wording.md）とそのテスト
    // scripts: 公開するリポジトリに書かないものを、追跡しているファイル全部から探す（scripts/public-text.test.js）
    projects: [
      'packages/*',
      { test: { name: 'eslint-rules', include: ['eslint-rules/**/*.test.js'] } },
      { test: { name: 'scripts', include: ['scripts/**/*.test.js'] } },
    ],
  },
});
