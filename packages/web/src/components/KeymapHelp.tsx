// `?` で出すショートカットキーの一覧（設計書 18.2）。見るだけで、変えるのは設定のショートカットキーのタブ（2026-10-20。見本を比べて決めた）。
import { useContext } from 'react';
import type { Command } from '../commands/commands.js';
import { KEY_ACTIONS, showKey, type KeyActionId } from '../commands/keymap.js';
import { KeyColumns, KeysContext } from './Key.js';

export function KeymapHelp({ dispatch }: { dispatch: (c: Command) => void }) {
  const bindings = useContext(KeysContext);
  const row = (id: KeyActionId) => {
    const a: { label: string; help?: string } = KEY_ACTIONS[id];
    return (
      <div className="krow">
        <span className="kl">{a.help ?? a.label}</span>
        <span className="kk">
          {bindings[id].length === 0 ? <span className="kfix">なし</span> : bindings[id].map((k) => <kbd key={k} className="kc ro">{showKey(k)}</kbd>)}
        </span>
      </div>
    );
  };
  return (
    <div className="overlay" onClick={() => dispatch({ id: 'escape' })}>
      <div className="dialog keys" role="dialog" aria-label="ショートカットキー" onClick={(e) => e.stopPropagation()}>
        <div className="sh">
          <h2>ショートカットキー</h2>
          <button type="button" className="btn sm" onClick={() => dispatch({ id: 'escape' })}>
            閉じる <kbd>Esc</kbd>
          </button>
        </div>
        <KeyColumns row={row} />
        <div className="kfoot">
          <span>キーは設定で変えられます。</span>
          <button type="button" className="btn sm" onClick={() => dispatch({ id: 'settings.open', tab: 'keys' })}>
            設定で変える
          </button>
        </div>
      </div>
    </div>
  );
}
