// 自分（ondina）の clone の場所と版（設計書 5.5 clone して入れる）。
// clone して組み立てた物を使うので、版は package.json の version ではなく git のコミットで示す。
import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 自分の clone の最上位。dist/self.js（組み立て後）からも src/self.ts（tsx）からも 3 つ上 */
export function selfRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
}

function gitOut(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** clone の HEAD の短いコミット（`1857abd`）。root が clone の最上位でなければ（npm から入れた等）undefined */
export function selfCommit(root: string): string | undefined {
  try {
    if (realpathSync(gitOut(root, 'rev-parse', '--show-toplevel')) !== realpathSync(root)) return undefined;
    return gitOut(root, 'rev-parse', '--short=7', 'HEAD');
  } catch {
    return undefined;
  }
}

/** `ondina 1857abd (2026-10-08)`。clone でなければ `ondina (バージョン不明)` */
export function versionLine(root: string): string {
  const commit = selfCommit(root);
  if (commit === undefined) return 'ondina (バージョン不明)';
  try {
    return `ondina ${commit} (${gitOut(root, 'log', '-1', '--format=%cs')})`;
  } catch {
    return 'ondina (バージョン不明)';
  }
}

/** sh で走らせ、入出力はそのまま繋ぐ。終了コードを返す */
export function runScript(file: string, args: string[]): number {
  return spawnSync('sh', [file, ...args], { stdio: 'inherit' }).status ?? 1;
}
