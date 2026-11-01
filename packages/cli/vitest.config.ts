import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // テストは core のビルド（dist）に依存させず、ソースを直接読む
    alias: { '@ondina/core': path.resolve(import.meta.dirname, '../core/src/index.ts') },
  },
  test: {
    name: 'cli',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
