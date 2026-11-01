// 変わった行から離れた行の帯（2026-10-13。見本を比べて「20 行ずつ（GitHub と同じ）」にした）。差分一覧・目的ごとのプレビュー（DiffList）とコースの停留所（FileView）で同じ帯。
// ↓ は上側から、↑ は下側から FOLD_STEP 行ずつ、↕ は全部開く（fold.open）。畳んだ行の中のメモと AI の下書きは数を出す（見えない所に隠さない）
import type { Command } from '../commands/commands.js';
import { Key } from '../components/Key.js';
import { foldButtons, foldKeys, type Fold, type FoldDir } from './fold.js';

const ARROW: Record<FoldDir, string> = { down: '↓', up: '↑', all: '↕' };

function label(dir: FoldDir, n: number): string {
  if (dir === 'all') return `${n} 行を全部表示`;
  return `${dir === 'down' ? '下へ' : '上へ'} ${n} 行表示`;
}

export function FoldBand({ path, fold, memos = 0, drafts = 0, dispatch }: { path: string; fold: Pick<Fold, 'keys' | 'top' | 'bottom'>; memos?: number; drafts?: number; dispatch: (c: Command) => void }) {
  const f = { kind: 'fold' as const, rows: [], ...fold };
  return (
    <div className="fold">
      <span className="fx">
        {foldButtons(f).map((dir) => {
          const keys = foldKeys(f, dir);
          const name = label(dir, keys.length);
          return (
            <button key={dir} type="button" title={name} aria-label={name} onClick={() => dispatch({ id: 'fold.open', path, keys })}>
              {ARROW[dir]}
            </button>
          );
        })}
      </span>
      <span className="fl">{`⋯ ${fold.keys.length} 行${memos > 0 ? ` · メモ ${memos}` : ''}${drafts > 0 ? ` · 下書き ${drafts}` : ''}`}</span>
    </div>
  );
}

/** すべて表示 / 変更の近くだけ（F。差分一覧と目的ごとの画面の帯。コースの停留所は「ファイル全体」/「前後だけ」） */
export function FullButton({ full, dispatch }: { full: boolean; dispatch: (c: Command) => void }) {
  return (
    <button type="button" className="btn sm" onClick={() => dispatch({ id: 'file.full' })}>
      {full ? '変更の近くだけ' : 'すべて表示'} <Key action="file.full" />
    </button>
  );
}
