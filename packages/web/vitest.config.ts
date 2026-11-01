import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'jsdom',
    // testing-library の自動 cleanup（afterEach）に要る
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    // CSS は既定で空の文字列に置き換わる。styles.css だけは中身を読む（DiffList.test.tsx が行の高さを見る）
    css: { include: [/styles\.css/] },
    passWithNoTests: true,
  },
});
