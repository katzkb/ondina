// 差分一覧のファイル列（設計書 3.4）。IDEA のようなファイルツリー（2026-10-19。見本を比べて決めた。それまではディレクトリの見出しで束ねた平らな行）。
// 中身が 1 つのフォルダはつなげて 1 行。ファイルの行は名前・コースの色の丸（どのコースにも入らない差分は赤い「外」）・印（問題なしのまる 全部 / 一部 / 無し、GitHub で Viewed ならチェック。12.1）。
// 閉じたフォルダの右に、中のファイルをまとめた印。見出しに「問題なし n / N」と「すべて開く / すべて閉じる」。
// 追従の件数は How 分解の画面の束の行に移した（2026-09-19）。
import { useMemo } from 'react';
import type { Command } from '../commands/commands.js';
import type { FileEntry } from '../files.js';
import { buildTree } from '../fileTree.js';
import { FileTree, OpenAllIcon } from './FileTree.js';
import { ViewMark } from './ViewMark.js';
import { courseBg, OUTSIDE } from '../course.js';

export interface FileListProps {
  files: FileEntry[];
  selected: string | null;
  /** 閉じたフォルダ（AppState.treeShut.diff） */
  shut: readonly string[];
  /** GitHub で Viewed のファイル（12.1）。読めていない・local なら null でチェックを出さない */
  github?: readonly string[] | null | undefined;
  dispatch: (c: Command) => void;
}

export function FileList({ files, selected, shut, github, dispatch }: FileListProps) {
  const onGithub = new Set(github ?? []);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const nodes = useMemo(() => buildTree(files.map((f) => f.path)), [files]);
  const total = files.reduce((n, f) => n + f.hunks.length, 0);
  const viewed = files.reduce((n, f) => n + f.viewedCount, 0);
  return (
    <div className="col">
      <div className="hd">
        <b>ファイル</b>
        <span>{`${files.length} ファイル`}</span>
        <span className="sp">
          <span className="chip ok">{`問題なし ${viewed} / ${total}`}</span>
          <button type="button" className="ib" title="すべて開く" aria-label="すべて開く" onClick={() => dispatch({ id: 'tree.openAll', tree: 'diff' })}>
            <OpenAllIcon open />
          </button>
          <button type="button" className="ib" title="すべて閉じる" aria-label="すべて閉じる" onClick={() => dispatch({ id: 'tree.closeAll', tree: 'diff' })}>
            <OpenAllIcon open={false} />
          </button>
        </span>
      </div>
      <FileTree
        nodes={nodes}
        tree="diff"
        shut={shut}
        selected={selected}
        onFile={(path) => dispatch({ id: 'file.select', path })}
        dispatch={dispatch}
        fileMeta={(path) => <FileMarks file={byPath.get(path)!} github={onGithub.has(path)} />}
        dirMeta={(paths) => {
          const list = paths.map((p) => byPath.get(p)!);
          return <ViewMark total={list.reduce((n, f) => n + f.hunks.length, 0)} viewed={list.reduce((n, f) => n + f.viewedCount, 0)} github={paths.every((p) => onGithub.has(p))} />;
        }}
      />
    </div>
  );
}

/** ファイルの行の右: コースの色の丸（どのコースにも入らない差分は赤い「外」）と問題なしの印。コースの左のほかのコースのファイルの行でも使う（2026-10-20） */
export function FileMarks({ file, github }: { file: FileEntry; github: boolean }) {
  const hows = [...new Set(file.hunks.flatMap((h) => h.hows))];
  return (
    <>
      {hows.map((n) => (
        <span key={n} className={`cb sm cc${n}`} style={courseBg(n)}>
          {n}
        </span>
      ))}
      {file.unassigned && <span className="cb sm cc0" style={courseBg(OUTSIDE)}>外</span>}
      <ViewMark total={file.hunks.length} viewed={file.viewedCount} github={github} />
    </>
  );
}
