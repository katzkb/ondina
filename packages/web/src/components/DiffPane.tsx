// diff 列のヘッダ（左右 / 統合、すべて表示、定義から戻る、聞く、IDEA で開く）と DiffList（設計書 3.4）。
// 全部のファイルを 1 本の列に並べる（2026-10-20）。ヘッダの操作は列全体に効き、パスと「差分の外のメモ n」「差分の外の下書き n」はファイルごとの見出し（DiffList の FileHead）に出す。
// 変わった行から離れた行は帯にまとめ、「すべて表示 F」で全部開く（2026-10-13）。
import type { Hunk } from '@ondina/model';
import type { Command } from '../commands/commands.js';
import { DiffList, type DiffMemo } from '../diff/DiffList.js';
import { FullButton } from '../diff/FoldBand.js';
import type { DiffMode } from '../diff/rows.js';
import type { DiffJump, FindUi, FocusLine } from '../state/reducer.js';
import { AskButton } from './AskButton.js';
import { Key } from './Key.js';

export interface DiffPaneProps {
  /** 全部のファイルの差分（ツリーの順） */
  hunks: readonly Hunk[];
  /** スクロールの合図（AppState.diffJump） */
  jump: DiffJump;
  mode: DiffMode;
  viewed: readonly string[];
  selectedHunk: string | null;
  repoName: string | null;
  /** メモ（3.3）。差分一覧の画面が渡す */
  memo?: DiffMemo;
  /** 案内人の答えの行の場所で来た行（3.10。光らせる） */
  focusLine?: FocusLine | null;
  /** 帯で開いた行の key（AppState.fold の全部のファイルの分） */
  open?: readonly string[] | undefined;
  /** すべて表示（F） */
  full?: boolean;
  /** 差分の列の検索（⌘F） */
  find?: FindUi;
  /** 名前から定義へ（3.6）の戻り先の数。無い = 名前から移れない解析（ボタンを出さない） */
  defBack?: number;
  dispatch: (c: Command) => void;
}

export function DiffPane({ hunks, jump, mode, viewed, selectedHunk, repoName, memo, focusLine = null, open, full = false, find, defBack, dispatch }: DiffPaneProps) {
  return (
    <div className="col dpane">
      <div className="hd">
        <span className="seg">
          <button type="button" className={mode === 'sbs' ? 'on' : ''} onClick={() => dispatch({ id: 'diff.mode.sbs' })}>
            左右
          </button>
          <button type="button" className={mode === 'uni' ? 'on' : ''} onClick={() => dispatch({ id: 'diff.mode.unified' })}>
            統合
          </button>
        </span>
        {hunks.length > 0 && <FullButton full={full} dispatch={dispatch} />}
        {/* 名前を ⌘+クリックして定義へ移る前の場所へ（⌘[ と同じコマンド）。戻り先が無い間も出して、移れることを見せる */}
        {hunks.length > 0 && defBack !== undefined && (
          <button type="button" className="btn sm" disabled={defBack === 0} onClick={() => dispatch({ id: 'def.back' })}>
            ← 戻る <Key action="def.back" />
          </button>
        )}
        <span className="sp">
          <AskButton />
          {repoName && selectedHunk && (
            // `gi` と同じコマンド（原則 6）。URL は reducer が組み、App が開く
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'jump.ide' })}>
              IDEA で開く
            </button>
          )}
        </span>
      </div>
      {hunks.length === 0 ? <div className="empty">変更ファイルがありません</div> : <DiffList hunks={hunks} jump={jump} mode={mode} viewed={viewed} selectedHunk={selectedHunk} dispatch={dispatch} focusLine={focusLine} open={open} full={full} {...(memo ? { memo } : {})} {...(find ? { find } : {})} />}
    </div>
  );
}
