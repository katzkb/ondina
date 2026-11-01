// 設定のショートカットキーのタブ（2026-10-20。見本を比べて「設定画面に足す」にした）。
// キーの欄を押すと記録し、次に押したキーに変わる。記録中のキーは欄が受け取って止める（window の keydown に届けない）。
// 記録中の欄・2 つ続けての 1 つ目・重なりの知らせはこの中の状態で、決まった変更だけ ui.keymap に流す。
import { useContext, useState, type KeyboardEvent } from 'react';
import type { Command } from '../commands/commands.js';
import { conflictOf, DEFAULT_BINDINGS, KEY_ACTIONS, KEY_IDS, keyOfEvent, placeKey, showKey, type KeyActionId } from '../commands/keymap.js';
import { KeyColumns, KeysContext } from './Key.js';

/** 記録している欄（slot は替える欄。null は足す欄）か、押したキーが別の操作と重なった知らせ */
type Edit = { kind: 'rec'; action: KeyActionId; slot: number | null; first: string | null } | { kind: 'warn'; action: KeyActionId; slot: number | null; key: string; other: KeyActionId };

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

export function KeysSettings({ dispatch }: { dispatch: (c: Command) => void }) {
  const bindings = useContext(KeysContext);
  const [edit, setEdit] = useState<Edit | null>(null);
  const change = (changes: Array<{ action: KeyActionId; keys: readonly string[] }>) => {
    setEdit(null);
    dispatch({ id: 'ui.keymap', changes });
  };

  const onRecordKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    // Tab はキーにせずフォーカスを動かす（キーボードだけで欄から出られるように。離れると onBlur で記録をやめる）
    if (e.key === 'Tab') return;
    e.preventDefault();
    if (edit?.kind !== 'rec') return;
    if (e.key === 'Escape') return setEdit(null);
    const k = keyOfEvent(e);
    if (k === null) return;
    // 既定が 2 つ続けての操作（IDEA で開く）だけ、2 つ押して決める
    if (edit.first === null && KEY_ACTIONS[edit.action].keys.some((x) => x.includes(' '))) return setEdit({ ...edit, first: k });
    const key = edit.first === null ? k : `${edit.first} ${k}`;
    const other = conflictOf(bindings, edit.action, key);
    if (other !== null) return setEdit({ kind: 'warn', action: edit.action, slot: edit.slot, key, other });
    change(placeKey(bindings, edit.action, edit.slot, key));
  };

  const row = (id: KeyActionId) => {
    const keys = bindings[id];
    const fixed = KEY_ACTIONS[id].group === 'fixed';
    const changed = !same(keys, DEFAULT_BINDINGS[id]);
    const rec = edit?.kind === 'rec' && edit.action === id ? edit : null;
    const warn = edit?.kind === 'warn' && edit.action === id ? edit : null;
    // 欄からフォーカスが離れたら記録をやめる（離れたあとのキーは欄に届かないので、記録中の見た目を残さない）。
    // 消すのはこの記録がまだ続いているときだけ（知らせや別の欄の記録に変わって欄が消えたときの blur で、そちらを消さない）
    const recording = (
      <button key="rec" type="button" className="kc rec" autoFocus onKeyDown={onRecordKey} onClick={() => setEdit(null)} onBlur={() => setEdit((e) => (e === rec ? null : e))}>
        {rec?.first ? `${showKey(rec.first)} → …` : 'キーを押す…'}
      </button>
    );
    return (
      <>
        <div className="krow" role="group" aria-label={KEY_ACTIONS[id].label}>
          <span className="kl">
            {KEY_ACTIONS[id].label}
            {changed && <span className="chg" title="既定から変えています" />}
          </span>
          {/* 記録中は行のボタンを押してもフォーカスを動かさない（動くと記録をやめて行が描き直り、外す・やめるが消えたり後ろのボタンがずれたりして押せない） */}
          <span className="kk" onMouseDown={rec ? (e) => e.preventDefault() : undefined}>
            {keys.length === 0 && !rec && <span className="kfix">なし</span>}
            {keys.map((k, i) =>
              rec?.slot === i ? (
                recording
              ) : fixed ? (
                <kbd key={k} className="kc ro">
                  {showKey(k)}
                </kbd>
              ) : (
                <button key={k} type="button" className="kc" onClick={() => setEdit({ kind: 'rec', action: id, slot: i, first: null })}>
                  {showKey(k)}
                </button>
              ),
            )}
            {!fixed &&
              (rec?.slot === null ? (
                recording
              ) : (
                <button type="button" className="kadd" title="キーを足す" aria-label="キーを足す" onClick={() => setEdit({ kind: 'rec', action: id, slot: null, first: null })}>
                  ＋
                </button>
              ))}
            {rec && rec.slot !== null && (
              <button type="button" className="klink" onClick={() => change([{ action: id, keys: keys.filter((_, i) => i !== rec.slot) }])}>
                外す
              </button>
            )}
            {rec ? (
              <button type="button" className="klink" onClick={() => setEdit(null)}>
                やめる
              </button>
            ) : (
              changed && (
                <button type="button" className="klink" onClick={() => change([{ action: id, keys: DEFAULT_BINDINGS[id] }])}>
                  既定に戻す
                </button>
              )
            )}
          </span>
        </div>
        {warn && <Conflict warn={warn} onPlace={(how) => change(placeKey(bindings, warn.action, warn.slot, warn.key, how))} onCancel={() => setEdit(null)} />}
      </>
    );
  };

  return (
    <>
      <KeyColumns row={row} />
      <div className="kfoot">
        <span>.ondina/ui.json に保存します。どの PR でも同じキーです。押した時点で効きます。</span>
        {KEY_IDS.some((id) => !same(bindings[id], DEFAULT_BINDINGS[id])) && (
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setEdit(null);
              dispatch({ id: 'ui.keymap.reset' });
            }}
          >
            すべて既定に戻す
          </button>
        )}
      </div>
    </>
  );
}

/** 押したキーが別の操作にあるときの知らせ（行の下）。入れ替えるのは、ある欄を替えたときだけ（足したときは渡すキーが無い）。
 *  出たら最初のボタンにフォーカスを移す（記録の欄が消えてフォーカスが行き場を失うため） */
function Conflict({ warn, onPlace, onCancel }: { warn: Extract<Edit, { kind: 'warn' }>; onPlace: (how: 'move' | 'swap') => void; onCancel: () => void }) {
  const fixed = KEY_ACTIONS[warn.other].group === 'fixed';
  return (
    <div
      className="kwarn"
      onKeyDown={(e) => {
        // 知らせの中のキーは画面の操作に届けない（Enter はボタンに効かせ、Esc は設定ではなく知らせを閉じる）
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
      }}
    >
      <span>
        <kbd>{showKey(warn.key)}</kbd> は「{KEY_ACTIONS[warn.other].label}」で使っています。{fixed && '変えられないキーなので、ほかのキーを選んでください。'}
      </span>
      <span className="acts">
        {fixed ? (
          <button type="button" className="btn sm" autoFocus onClick={onCancel}>
            わかりました
          </button>
        ) : (
          <>
            {warn.slot !== null && (
              <button type="button" className="btn sm" autoFocus onClick={() => onPlace('swap')}>
                入れ替える
              </button>
            )}
            <button type="button" className="btn sm" autoFocus={warn.slot === null} onClick={() => onPlace('move')}>
              こちらに移す
            </button>
            <button type="button" className="btn sm" onClick={onCancel}>
              やめる
            </button>
          </>
        )}
      </span>
    </div>
  );
}
