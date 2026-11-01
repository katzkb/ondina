// 差分一覧のファイル列（設計書 3.4）。hunk を path ごとにまとめ、ファイルツリーの並び（fileTree.ts。フォルダが先）に並べる。追従の件数（8 章）は How 分解の画面の束の行に出す（hows.ts）。
import type { Hunk } from '@ondina/model';
import { compareTreeOrder } from './fileTree.js';

export interface FileEntry {
  path: string;
  /** 末尾の '/' まで。packagePrefix（11 章）があればその下から */
  dir: string;
  base: string;
  hunks: Hunk[];
  /** ファイル内の全 hunk が閲覧済み */
  viewed: boolean;
  /** ファイル内で閲覧済み（問題なし）の hunk の数。点の 全部 / 一部 / 無し に使う */
  viewedCount: number;
  /** How に属さない hunk を含む */
  unassigned: boolean;
}

/** `com.example` → `com/example/`。path にこれが含まれていればそこまでを表示から落とす */
function prefixDir(packagePrefix: string | undefined): string | undefined {
  return packagePrefix ? packagePrefix.replace(/\./g, '/') + '/' : undefined;
}

/** ディレクトリ境界に揃った位置でだけ一致させる（`mycom/example/` は `com/example/` ではない） */
function prefixAt(path: string, prefix: string): number {
  let at = path.indexOf(prefix);
  while (at > 0 && path[at - 1] !== '/') at = path.indexOf(prefix, at + 1);
  return at;
}

/** 表示用のパス。packagePrefix（11 章）があればその下から。ディレクトリを含まないパス（SQL など）はそのまま */
export function shortPath(path: string, packagePrefix?: string): string {
  const prefix = prefixDir(packagePrefix);
  const at = prefix === undefined ? -1 : prefixAt(path, prefix);
  return at >= 0 ? path.slice(at + prefix!.length) : path;
}

export function groupFiles(hunks: readonly Hunk[], viewedIds: readonly string[], packagePrefix?: string): FileEntry[] {
  const viewed = new Set(viewedIds);
  const prefix = prefixDir(packagePrefix);
  const byPath = new Map<string, Hunk[]>();
  for (const h of hunks) {
    const list = byPath.get(h.path);
    if (list) list.push(h);
    else byPath.set(h.path, [h]);
  }
  return [...byPath.keys()].sort(compareTreeOrder).map((path) => {
    const list = byPath.get(path)!;
    const cut = path.lastIndexOf('/') + 1;
    const at = prefix === undefined ? -1 : prefixAt(path, prefix);
    const from = at >= 0 ? at + prefix!.length : 0;
    return {
      path,
      dir: path.slice(from, cut),
      base: path.slice(cut),
      hunks: list,
      viewed: list.every((h) => viewed.has(h.id)),
      viewedCount: list.filter((h) => viewed.has(h.id)).length,
      unassigned: list.some((h) => h.hows.length === 0),
    };
  });
}

/** 差分が全部問題なしのファイル（GitHub の Viewed を付けておくファイル。設計書 12.1） */
export function viewedFiles(hunks: readonly Hunk[], viewedIds: readonly string[]): Set<string> {
  const viewed = new Set(viewedIds);
  const out = new Set<string>();
  const notAll = new Set<string>();
  for (const h of hunks) (viewed.has(h.id) ? out : notAll).add(h.path);
  for (const p of notAll) out.delete(p);
  return out;
}

/** 問題なしの前後から、GitHub の Viewed に付ける（新しく全部になった）・外す（全部でなくなった）ファイル */
export function viewedChange(hunks: readonly Hunk[], before: readonly string[], after: readonly string[]): { mark: string[]; unmark: string[] } {
  const was = viewedFiles(hunks, before);
  const now = viewedFiles(hunks, after);
  return { mark: [...now].filter((p) => !was.has(p)).sort(), unmark: [...was].filter((p) => !now.has(p)).sort() };
}

/** 下書き（path:line、side）の行を含む hunk。RIGHT は head 側（lnNew から）、LEFT は base 側（lnOld から）の行番号で探す */
export function hunkAt(hunks: readonly Hunk[], path: string, line: number, side: 'LEFT' | 'RIGHT'): Hunk | undefined {
  const skip = side === 'RIGHT' ? '-' : '+';
  return hunks.find((h) => {
    if (h.path !== path) return false;
    const from = side === 'RIGHT' ? h.lnNew : h.lnOld;
    const count = h.lines.filter((l) => !l.startsWith(skip)).length;
    return line >= from && line < from + count;
  });
}
