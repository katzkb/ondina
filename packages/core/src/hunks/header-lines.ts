// package 行と import 行の行番号（1 始まり）。ファイル hunk の importsOnly（設計書 5.2）を構文木で決めるのに使う。
// 先頭のコメントや @file: アノテーションは含めない。
import type { Tree } from 'web-tree-sitter';

const HEADER_NODE_TYPES = new Set(['package_header', 'import']);

export function headerLines(tree: Tree): Set<number> {
  const lines = new Set<number>();
  for (const node of tree.rootNode.children) {
    if (!HEADER_NODE_TYPES.has(node.type)) continue;
    for (let row = node.startPosition.row; row <= node.endPosition.row; row++) lines.add(row + 1);
  }
  return lines;
}
