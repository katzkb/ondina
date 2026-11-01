// 構成の推定の検査（設計書 10.6）。LLM が書いたものを採るかどうかはプログラムが決める（原則 3）。
// 通すのは、空でなく重複しない層名（8 個まで）・実在するディレクトリとファイル・層にある名前への振り分けだけ。
// テストの置き場は、実在するディレクトリ（リポジトリ全体の "." は不可）かファイルだけ。
// 同じディレクトリ・ファイルは最初だけ採る（決定的。原則 7）。振り分けが 1 つも無い層は落とす。捨てた理由は info に残す（黙って直さない。5.4）。
import type { Structure } from './types.js';

/** 地図の帯として読める数 */
export const MAX_LAYERS = 8;

/** 末尾の / と先頭の ./ を落とす。空は "." */
export function normalizeDir(dir: string): string {
  const d = dir.trim().replace(/^\.\/+/, '').replace(/\/+$/, '');
  return d === '' ? '.' : d;
}

export function verifyStructure(output: Structure, paths: readonly string[]): { structure: Structure; info: string[] } {
  const info: string[] = [];
  const pathSet = new Set(paths);
  // "." はリポジトリ直下（直下にファイルがあれば実在）。ほかは下にファイルがあれば実在
  const dirExists = (dir: string) => (dir === '.' ? paths.some((p) => !p.includes('/')) : paths.some((p) => p.startsWith(`${dir}/`)));

  const names: Structure['layers'] = [];
  for (const l of output.layers) {
    const name = l.name.trim();
    if (name === '' || names.some((n) => n.name === name)) continue;
    names.push({ name, why: l.why });
  }
  if (names.length > MAX_LAYERS) info.push(`構成の推定の層が多すぎるので ${MAX_LAYERS + 1} 個目から除外しました: ${names.slice(MAX_LAYERS).map((l) => l.name).join(', ')}`);
  const layers = names.slice(0, MAX_LAYERS);
  const known = new Set(layers.map((l) => l.name));

  const dirs: Structure['dirs'] = [];
  for (const d of output.dirs) {
    const dir = normalizeDir(d.dir);
    if (!dirExists(dir)) info.push(`構成の推定を除外しました（ないディレクトリ）: ${dir}`);
    else if (!known.has(d.layer)) info.push(`構成の推定を除外しました（層にない名前 ${d.layer}）: ${dir}`);
    else if (dirs.some((x) => x.dir === dir)) info.push(`構成の推定が重複していたので後のほうを除外しました: ${dir}`);
    else dirs.push({ dir, layer: d.layer });
  }
  const files: Structure['files'] = [];
  for (const f of output.files) {
    if (!pathSet.has(f.path)) info.push(`構成の推定を除外しました（ないファイル）: ${f.path}`);
    else if (!known.has(f.layer)) info.push(`構成の推定を除外しました（層にない名前 ${f.layer}）: ${f.path}`);
    else if (files.some((x) => x.path === f.path)) info.push(`構成の推定が重複していたので後のほうを除外しました: ${f.path}`);
    else files.push({ path: f.path, layer: f.layer });
  }
  const outside: string[] = [];
  for (const o of output.outside) {
    const dir = normalizeDir(o);
    if (!dirExists(dir)) info.push(`構成の推定を除外しました（ないディレクトリ）: ${dir}`);
    else if (dirs.some((x) => x.dir === dir)) info.push(`構成の推定を除外しました（層に振ったディレクトリ）: ${dir}`);
    else if (!outside.includes(dir)) outside.push(dir);
  }

  const tests: string[] = [];
  for (const t of output.tests) {
    const at = normalizeDir(t);
    if (at === '.') info.push(`構成の推定のテストの置き場を除外しました（リポジトリ全体は指せない）: ${at}`);
    else if (!pathSet.has(at) && !dirExists(at)) info.push(`構成の推定のテストの置き場を除外しました（ないディレクトリかファイル）: ${at}`);
    else if (tests.includes(at)) info.push(`構成の推定のテストの置き場が重複していたので後のほうを除外しました: ${at}`);
    else tests.push(at);
  }

  const used = new Set([...dirs.map((d) => d.layer), ...files.map((f) => f.layer)]);
  for (const l of layers) if (!used.has(l.name)) info.push(`構成の推定を除外しました（振り分けのない層）: ${l.name}`);
  return { structure: { layers: layers.filter((l) => used.has(l.name)), dirs, files, outside, tests }, info };
}
