// ファイルツリーの行（設計書 3.3 / 3.4。2026-10-19。見本を比べて「IDEA みたいなファイルツリー」にした）。差分一覧とコースの左で使う。
// 字下げの線・開閉の矢印・フォルダとファイルのアイコン。行の右に出す物は呼ぶ側が決める。木の形は fileTree.ts、開け閉めは reducer（tree.toggle）。
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Command } from '../commands/commands.js';
import { treeRows, type TreeName, type TreeNode } from '../fileTree.js';

export interface FileTreeProps {
  nodes: readonly TreeNode[];
  tree: TreeName;
  /** 閉じたフォルダの key（AppState.treeShut） */
  shut: readonly string[];
  /** 今のファイル（差分一覧で選んだファイル・コースの今の場所か覗いているファイル）。行を明るくし、見える所までスクロールする */
  selected: string | null;
  /** ファイルの行の右 */
  fileMeta: (path: string) => ReactNode;
  /** 閉じたフォルダの行の右（中のファイルをまとめた物）。開いているフォルダには出さない */
  dirMeta?: (files: readonly string[]) => ReactNode;
  /** 行に足す class（コースの左でほかのコースの行を薄くする。2026-10-20）。dir は中の全部のファイル */
  rowClass?: (row: { kind: 'file'; path: string } | { kind: 'dir'; files: readonly string[] }) => string;
  onFile: (path: string) => void;
  dispatch: (c: Command) => void;
}

export function FileTree({ nodes, tree, shut, selected, fileMeta, dirMeta, rowClass, onFile, dispatch }: FileTreeProps) {
  const closed = new Set(shut);
  const grad = `kt-${useId().replace(/:/g, '')}`;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.tr.on')?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);
  return (
    <div className="tree" ref={ref}>
      <svg className="defs" aria-hidden="true">
        <defs>
          <linearGradient id={grad} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="var(--mauve)" />
            <stop offset=".55" stopColor="var(--blue)" />
            <stop offset="1" stopColor="var(--peach)" />
          </linearGradient>
        </defs>
      </svg>
      {treeRows(nodes, closed).map(({ node, depth }) => {
        const style = { '--d': depth } as CSSProperties;
        if (node.kind === 'dir') {
          const open = !closed.has(node.key);
          return (
            <button key={`d-${node.key}`} type="button" className={`tr dir${open ? '' : ' shut'}${extra(rowClass?.({ kind: 'dir', files: node.files }))}`} style={style} title={node.key} aria-expanded={open} onClick={() => dispatch({ id: 'tree.toggle', tree, key: node.key })}>
              <span className="ind" />
              <span className="chev">
                <Chevron />
              </span>
              <span className="ic">
                <FolderIcon />
              </span>
              <span className="nm">{node.name}</span>
              <span className="cnt">{node.files.length}</span>
              <span className="meta">{!open && dirMeta?.(node.files)}</span>
            </button>
          );
        }
        return (
          <button key={`f-${node.path}`} type="button" className={`tr file${node.path === selected ? ' on' : ''}${extra(rowClass?.({ kind: 'file', path: node.path }))}`} style={style} title={node.path} onClick={() => onFile(node.path)}>
            <span className="ind" />
            <span className="chev" />
            <span className="ic">
              <FileIcon path={node.path} grad={grad} />
            </span>
            <span className="nm">{node.name}</span>
            <span className="meta">{fileMeta(node.path)}</span>
          </button>
        );
      })}
    </div>
  );
}

const extra = (c: string | undefined) => (c ? ` ${c}` : '');

function Chevron() {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path className="fold-ic" d="M1.5 3.5h4.2l1.5 1.6h7.3v7.4h-13z" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

/** 拡張子で見分けるだけ（Kotlin・SQL・それ以外） */
function FileIcon({ path, grad }: { path: string; grad: string }) {
  if (/\.kts?$/.test(path)) {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 2.5h11L8 8l5.5 5.5h-11z" fill={`url(#${grad})`} />
      </svg>
    );
  }
  if (path.endsWith('.sql')) {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="sql-ic">
        <ellipse cx="8" cy="4" rx="5" ry="1.8" fill="none" strokeWidth="1.1" />
        <path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" fill="none" strokeWidth="1.1" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="doc-ic">
      <path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" fill="none" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

/** 「すべて開く」「すべて閉じる」のアイコン */
export function OpenAllIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={open ? 'M4 6l4 4 4-4M4 2.5h8M4 13.5h8' : 'M4 10l4-4 4 4M4 2.5h8M4 13.5h8'} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
