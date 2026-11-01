// fixtures/order-service/scripts/build-repo.sh で main / feature/discount の 2 ブランチを持つ一時リポジトリを作る。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/order-service');

export function buildFixtureRepo(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-cli-'));
  execFileSync('sh', [path.join(FIXTURE_ROOT, 'scripts/build-repo.sh'), dir], { encoding: 'utf8', stdio: 'pipe' });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 利用者のグローバル設定に依存しない git */
export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
}
