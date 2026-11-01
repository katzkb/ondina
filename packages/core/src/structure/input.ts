// 構成の推定（設計書 10.6）への入力を、追跡ファイルの一覧から組む。決定的（原則 7）。
// パスをディレクトリごとにまとめ、.kt には最上位の宣言を添える。大きすぎれば宣言を落とし、それでも大きければ推定しない。
import type { StructureInput, StructureInputFile } from './types.js';

/** 入力 JSON の上限（文字数）。LLM が一度に読める量の目安 */
export const STRUCTURE_INPUT_LIMIT = 500_000;

export function buildStructureInput(
  files: ReadonlyArray<{ path: string; decls?: readonly string[] }>,
  { limit = STRUCTURE_INPUT_LIMIT, previous }: { limit?: number; previous?: readonly string[] } = {},
): { input: StructureInput; declsDropped: boolean } | { error: string } {
  const prev = previous === undefined || previous.length === 0 ? {} : { previous: { layers: [...previous] } };
  const full = { ...group(files, true), ...prev };
  if (JSON.stringify(full).length <= limit) return { input: full, declsDropped: false };
  const bare = { ...group(files, false), ...prev };
  if (JSON.stringify(bare).length <= limit) return { input: bare, declsDropped: true };
  return { error: `ファイルが多すぎて構成を推定できません（${files.length} 件）。ondina.config.yaml の layers で層を指定できます` };
}

function group(files: ReadonlyArray<{ path: string; decls?: readonly string[] }>, withDecls: boolean): StructureInput {
  const byDir = new Map<string, StructureInputFile[]>();
  for (const f of files) {
    const i = f.path.lastIndexOf('/');
    const dir = i < 0 ? '.' : f.path.slice(0, i);
    const entry: StructureInputFile = { name: f.path.slice(i + 1), ...(withDecls && f.decls !== undefined && f.decls.length > 0 ? { decls: [...f.decls] } : {}) };
    byDir.set(dir, [...(byDir.get(dir) ?? []), entry]);
  }
  const dirs = [...byDir.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dir, list]) => ({ dir, files: list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) }));
  return { files: files.length, dirs };
}
