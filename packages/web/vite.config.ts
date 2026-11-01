import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 開発時は `ondina serve`（既定 4177）に /api を中継する。本番は serve が dist を配信する。
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'http://localhost:4177' } },
});
