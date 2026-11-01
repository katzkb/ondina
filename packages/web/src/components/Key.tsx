// 画面の中のキーの表示（2026-10-20）。今のキー（既定 + 設定で変えたキー）を App が context で配り、ボタンの <kbd> はここから出す。
// キーを外した操作は何も出さない。? の一覧と設定のタブは同じ 2 列（左「どの画面でも」、右「コース」「入口」「変えられないキー」）。
import { createContext, Fragment, useContext, type ReactNode } from 'react';
import { DEFAULT_BINDINGS, KEY_ACTIONS, KEY_IDS, showKey, type Bindings, type KeyActionId, type KeyGroup } from '../commands/keymap.js';

export const KeysContext = createContext<Bindings>(DEFAULT_BINDINGS);

/** 操作の今のキーを画面に出す形で。キーが無ければ null。prefer が今のキーにあればそれを出す（↑ ↓ のように並べて見せる所） */
export function useKey(action: KeyActionId, prefer?: string): string | null {
  const keys = useContext(KeysContext)[action];
  const key = prefer !== undefined && keys.includes(prefer) ? prefer : keys[0];
  return key === undefined ? null : showKey(key);
}

export function Key({ action, prefer }: { action: KeyActionId; prefer?: string }) {
  const key = useKey(action, prefer);
  return key === null ? null : <kbd>{key}</kbd>;
}

const GROUP_NAME: Record<KeyGroup, string> = { all: 'どの画面でも', course: 'コース', home: '入口', fixed: '変えられないキー' };
const COLUMNS: KeyGroup[][] = [['all'], ['course', 'home', 'fixed']];

/** 操作を見出しごとに 2 列に並べる。行の中身は row が描く */
export function KeyColumns({ row }: { row: (action: KeyActionId) => ReactNode }) {
  return (
    <div className="kedit">
      {COLUMNS.map((groups) => (
        <div key={groups[0]} className="kcol">
          {groups.map((g) => (
            <Fragment key={g}>
              <h3>{GROUP_NAME[g]}</h3>
              {KEY_IDS.filter((id) => KEY_ACTIONS[id].group === g).map((id) => (
                <Fragment key={id}>{row(id)}</Fragment>
              ))}
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
