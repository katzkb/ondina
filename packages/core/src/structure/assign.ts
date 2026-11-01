// 保存した構成（設計書 10.6）を、層の割当に使う規則に組み直す。
// 当たる順は ファイルの完全一致 > 深いディレクトリ > 浅いディレクトリ。設定の layers と同じ LayerRule[]（上から最初に当たったもの）
// にして createLayerAssigner に渡すので、層を使う側（シンボル・辺・LLM の入力）は設定の層と同じ道を通る。
import { createLayerAssigner, type LayerRule } from '../layers/assign.js';
import type { SavedStructure, Structure } from './types.js';

/** パスの中の glob の特殊文字を、そのままの文字として当たるようにする */
function literal(path: string): string {
  return path.replace(/[\\*?[\]{}()!+@|^$]/g, (c) => `\\${c}`);
}

const depth = (dir: string) => (dir === '.' ? 0 : dir.split('/').length);

export function structureRules(s: Pick<Structure, 'dirs' | 'files'>): LayerRule[] {
  const files = s.files.map((f) => ({ name: f.layer, match: [literal(f.path)] }));
  // "." はリポジトリ直下のファイルだけ（入力で直下のファイルを "." にまとめているので。下のディレクトリは含まない）
  const dirs = [...s.dirs].sort((a, b) => depth(b.dir) - depth(a.dir)).map((d) => ({ name: d.layer, match: [d.dir === '.' ? '*' : `${literal(d.dir)}/**`] }));
  return [...files, ...dirs];
}

/** 推定の後に増えたファイルのうち、どの層にも対象外（outside）にも入らないもの。昇順 */
export function unclassifiedSince(saved: Pick<SavedStructure, 'dirs' | 'files' | 'outside' | 'known'>, paths: readonly string[]): string[] {
  // 規則は dirs / files だけから組む（層の並びは要らない）
  const layerOf = createLayerAssigner(structureRules({ dirs: saved.dirs, files: saved.files }));
  const known = new Set(saved.known);
  const outside = (p: string) => saved.outside.some((d) => (d === '.' ? !p.includes('/') : p.startsWith(`${d}/`)));
  return paths.filter((p) => !known.has(p) && layerOf(p) === undefined && !outside(p)).sort();
}

/** 推定し直しを促すか。推定時のファイル数の 5% 以上、ただし最低 5 件 */
export function isStructureWarn(count: number, total: number): boolean {
  return count >= Math.max(5, Math.ceil(total * 0.05));
}
