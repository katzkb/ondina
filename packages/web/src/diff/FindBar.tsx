import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Command } from '../commands/commands.js';
import { composingKey } from '../commands/keymap.js';
import type { FindUi } from '../state/reducer.js';
import { FILE_HEAD_H } from './follow.js';

/**
 * 列の中の検索欄（⌘F）。列の右上に重ねる（差分一覧は貼り付く見出しの下）。Enter で次、Shift+Enter で前、Esc で閉じる。
 * 入力欄の中のキーは App のキー操作に届かないので、ここで同じコマンドを出す（原則 6）
 */
export function FindBar({ find, count, cur, below = false, label, dispatch }: { find: FindUi; count: number; cur: number; below?: boolean; label: string; dispatch: (c: Command) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  // 開いたとき・開いている間にもう一度 ⌘F を押したときは、入れた文字を選んで入れ直せるように
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [find.n]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (composingKey(e.nativeEvent)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      dispatch({ id: e.shiftKey ? 'find.prev' : 'find.next' });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      dispatch({ id: 'find.close' });
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
      // 検索欄の中の ⌘F はブラウザの検索を開かず、入れた文字を選び直す
      e.preventDefault();
      ref.current?.select();
    }
  };
  const status = find.query === '' ? '' : count === 0 ? '見つかりません' : `${cur + 1} / ${count}`;
  return (
    <div className="dfind" style={below ? { top: FILE_HEAD_H } : undefined}>
      <div className="fbox" role="search">
        <input ref={ref} type="search" value={find.query} placeholder={label} aria-label={label} spellCheck={false} onChange={(e) => dispatch({ id: 'find.query', text: e.target.value })} onKeyDown={onKey} />
        <span className={`fcount${find.query !== '' && count === 0 ? ' none' : ''}`} aria-live="polite">
          {status}
        </span>
        <button type="button" className="ib" title="前へ（⇧Enter）" aria-label="前へ" disabled={count === 0} onClick={() => dispatch({ id: 'find.prev' })}>
          ↑
        </button>
        <button type="button" className="ib" title="次へ（Enter）" aria-label="次へ" disabled={count === 0} onClick={() => dispatch({ id: 'find.next' })}>
          ↓
        </button>
        <button type="button" className="ib" title="閉じる（Esc）" aria-label="閉じる" onClick={() => dispatch({ id: 'find.close' })}>
          ×
        </button>
      </div>
    </div>
  );
}
