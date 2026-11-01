// elkjs をブラウザの Web Worker で走らせる（2026-09-24 決定: 配置は描画時に web で。core には入れない）。
// 地図を組む間も画面の操作を止めない。テストは elk.bundled を直接使う（test/map.layout.test.ts）。
import ELK from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { ElkLike } from './layout.js';

let elk: ElkLike | null = null;

export function workerElk(): ElkLike {
  elk ??= new ELK({ workerUrl });
  return elk;
}
