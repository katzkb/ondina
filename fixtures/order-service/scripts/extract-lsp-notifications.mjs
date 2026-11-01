// 実機プローブのログ（2026-09-21）から、待機の判定に使う通知だけを抜いて JSON にする。
// 残すのは $/progress と intellij/importLog の 2 種類。結末を言わない行（ビルドログの垂れ流し）は捨てて小さくする。
//
//   node fixtures/order-service/scripts/extract-lsp-notifications.mjs <probe.log> <out.json>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: extract-lsp-notifications.mjs <probe.log> <out.json>');
  process.exit(1);
}

const out = [];
for (const line of readFileSync(src, 'utf8').split('\n')) {
  const m = /^\[\s*(\d+)ms\] ← not (\S+) (.*)$/.exec(line);
  if (m === null) continue;
  const [, atMs, method, rest] = m;
  if (method !== '$/progress' && method !== 'intellij/importLog') continue;
  let params;
  try {
    params = JSON.parse(rest);
  } catch {
    continue; // プローブが 400 文字で切った行。progress と importLog の結末はどれも 400 文字未満なので落ちない
  }
  if (method === 'intellij/importLog' && params.succeeded !== true && params.failed !== true) continue;
  out.push({ atMs: Number(atMs), method, params });
}

mkdirSync(path.dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.error(`${src} → ${dest}: ${out.length} 件`);
