// ondina.config.yaml を対象リポジトリの直下から読む（設計書 11 章）。analyze と serve が共用する。
// parse と検証は core（純粋関数）。ここはファイルを開くだけ。
// 無ければ既定値 + 警告 1 行（ondina はゲートしない。2026-09-17 決定）。あるが形が違えばそのまま投げる（呼び手が止めるか既定で続けるかを決める）。
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultConfig, parseConfig, type OndinaConfig } from '@ondina/core';

export const CONFIG_FILE = 'ondina.config.yaml';

export interface ReadConfigResult {
  config: OndinaConfig;
  /** yaml が無いときの 1 行 */
  warning?: string;
}

export function readConfigFile(repo: string): ReadConfigResult {
  const file = path.join(repo, CONFIG_FILE);
  if (!existsSync(file)) return { config: defaultConfig(), warning: `${CONFIG_FILE} がないので既定の設定で解析します` };
  try {
    return { config: parseConfig(readFileSync(file, 'utf8')) };
  } catch (e) {
    throw new Error(`${CONFIG_FILE}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
