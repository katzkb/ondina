// 差分一覧とコースの左のファイルツリー（設計書 3.3 / 3.4。2026-10-19。見本を比べて決めた）。
// IDEA のように フォルダ → ファイル の順、どちらも名前順。中身がフォルダ 1 つだけのフォルダは次とつなげて 1 行にする（`kotlin/com/example`）。
// フォルダの key は、つなげた中で一番深いフォルダのパス（開閉の記録に使う）。

export interface TreeDir {
  kind: 'dir';
  /** つなげた中で一番深いフォルダのパス */
  key: string;
  /** 表示名。つなげたフォルダは `/` でつなぐ */
  name: string;
  kids: TreeNode[];
  /** 下にある全部のファイル（木の順） */
  files: string[];
}

export interface TreeFile {
  kind: 'file';
  path: string;
  name: string;
}

export type TreeNode = TreeDir | TreeFile;

export interface TreeRow {
  node: TreeNode;
  depth: number;
}

interface Raw {
  dirs: Map<string, Raw>;
  files: string[];
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function buildTree(paths: readonly string[]): TreeNode[] {
  const root: Raw = { dirs: new Map(), files: [] };
  for (const p of new Set(paths)) {
    const parts = p.split('/');
    let n = root;
    for (const part of parts.slice(0, -1)) {
      let next = n.dirs.get(part);
      if (!next) n.dirs.set(part, (next = { dirs: new Map(), files: [] }));
      n = next;
    }
    n.files.push(p);
  }
  return kidsOf(root, '');
}

function kidsOf(raw: Raw, prefix: string): TreeNode[] {
  const dirs = [...raw.dirs.keys()].sort(byName).map((name) => dirOf(raw.dirs.get(name)!, name, `${prefix}${name}`));
  const files = raw.files.map((path): TreeFile => ({ kind: 'file', path, name: path.slice(path.lastIndexOf('/') + 1) })).sort((a, b) => byName(a.name, b.name));
  return [...dirs, ...files];
}

function dirOf(raw: Raw, name: string, key: string): TreeDir {
  let n = raw;
  let label = name;
  let at = key;
  while (n.files.length === 0 && n.dirs.size === 1) {
    const [next, child] = [...n.dirs.entries()][0]!;
    n = child;
    label += `/${next}`;
    at += `/${next}`;
  }
  const kids = kidsOf(n, `${at}/`);
  return { kind: 'dir', key: at, name: label, kids, files: kids.flatMap((k) => (k.kind === 'file' ? [k.path] : k.files)) };
}

/** 木の並びと同じ順の比較（同じフォルダの中ではフォルダが先、あとは名前順）。`[` `]` や `j` `k` の順に使う */
export function compareTreeOrder(a: string, b: string): number {
  const pa = a.split('/');
  const pb = b.split('/');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] === pb[i]) continue;
    const fa = i === pa.length - 1;
    const fb = i === pb.length - 1;
    if (fa !== fb) return fa ? 1 : -1;
    return byName(pa[i]!, pb[i]!);
  }
  return pa.length - pb.length;
}

/** 開いているフォルダの中を上から順に。shut は閉じたフォルダの key */
export function treeRows(nodes: readonly TreeNode[], shut: ReadonlySet<string>, depth = 0, out: TreeRow[] = []): TreeRow[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (node.kind === 'dir' && !shut.has(node.key)) treeRows(node.kids, shut, depth + 1, out);
  }
  return out;
}

/** 全部のフォルダの key（「すべて閉じる」） */
export function dirKeys(nodes: readonly TreeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === 'dir' ? [n.key, ...dirKeys(n.kids)] : []));
}

/** path が key のフォルダの下にあるか */
export function under(path: string, key: string): boolean {
  return path.startsWith(`${key}/`);
}

/** ツリーの名前（開け閉めを別々に持つ）。diff = 差分一覧、course = コースの左 */
export type TreeName = 'diff' | 'course';
