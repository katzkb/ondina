// メモ（設計書 3.3）の 1 件。選んだ行のすぐ下に出す: 書く枠（新しく書く・直す）と、保存したメモ（直す・消す）。
// 押したものは全部コマンド（原則 6）。書く枠の中のキーは全体のキー（App）に届かないので、⌘⏎ と Esc はここで受ける。
// 新しく書く枠には「聞く」（選んでいる行について案内人に聞く。3.10）。書く枠の中では Q が文字になるので、キーの表示は付けない。
// GitHub の差分に出ない行にはメモを書けない（GitHub がコメントを付けられない）。行番号の印は点線の「?」で、押すと聞く枠（メモの欄は無い。2026-10-22。見本を比べて決めた）。
// 行番号の印（LineMark）と AI の下書きの箱（DraftBox。2026-10-13）もここ。メモと同じ所（その行の下）に出す
import type { CommentDraft, GithubDiffFile } from '@ondina/model';
import { useContext } from 'react';
import type { Command } from '../commands/commands.js';
import { composingKey } from '../commands/keymap.js';
import { onGithubDiff, spanLabel } from '../memo.js';
import { AskContext } from './AskButton.js';

/** 聞く枠（GitHub の差分に出ない行を選んだとき）の注記 */
const ASK_NOTE = 'この行は GitHub の差分に出ないので、メモは書けません。案内人に聞くことはできます';

const fileName = (path: string) => path.split('/').pop() ?? path;

/**
 * GitHub の差分に出ない行のメモ・AI の下書きのチップ（12 章）。2026-10-22 より前に書いた物と、新しい版で差分から外れた物。
 * 消さずに残し、送る数に入れず、送らない（レビュアーが見て消すか直す）。送った物・破棄した物には付けない
 */
export function OffDiffChip({ comment: c, githubDiff }: { comment: CommentDraft; githubDiff: readonly GithubDiffFile[] | undefined }) {
  if (c.state === 'sent' || c.state === 'discarded' || onGithubDiff(githubDiff, c) !== false) return null;
  return (
    <span className="chip off" title="GitHub の差分に出ない行です。GitHub はこの行にコメントを付けられないので、送りません">
      GitHub に送れません
    </span>
  );
}

/** AI の下書きの、レビュアーに向けた説明（12 章。2026-11-04）。送るのは本文だけなので、本文と分けて「送信対象外」と書く。直している間も出す */
export function DraftNote({ note }: { note: string | undefined }) {
  if (!note) return null;
  return (
    <div className="dnote">
      <span className="dl">説明（送信対象外）</span>
      <p>{note}</p>
    </div>
  );
}

/**
 * 行番号の印。GitHub の差分に出る行は「+」（メモを書く）、出ない行は点線の「?」（聞くだけ）。
 * どちらも押すと同じ memo.pick で、押したまま上下になぞると範囲。印が違うだけで、書く枠と聞く枠は MemoEditor が分ける
 */
export function LineMark({ path, side, line, order, githubDiff, dispatch }: { path: string; side: 'LEFT' | 'RIGHT'; line: number; order: number; githubDiff: readonly GithubDiffFile[] | undefined; dispatch: (c: Command) => void }) {
  const ask = onGithubDiff(githubDiff, { path, side, line }) === false;
  const at = `${side === 'LEFT' ? 'base ' : ''}${line} 行目`;
  return (
    <button
      type="button"
      className={`mplus${ask ? ' ask' : ''}`}
      tabIndex={-1}
      aria-label={ask ? `${at}について聞く` : `${at}にメモ`}
      title={ask ? 'この行について聞く（GitHub の差分に出ないので、メモは書けません）' : 'この行にメモ（押したまま上下になぞると範囲）'}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        // 押したまま動かしても文字を選ばない
        e.preventDefault();
        const hold = openBoxHeight();
        dispatch({ id: 'memo.pick', path, side, line, order, ...(hold > 0 ? { hold } : {}) });
      }}
    >
      {ask ? '?' : '+'}
    </button>
  );
}

/** 開いている書く枠・直す枠（1 つだけ）の高さ（上下の余白も含む）。無ければ 0 */
function openBoxHeight(): number {
  const box = document.querySelector<HTMLElement>('.mbox.edit');
  if (!box) return 0;
  const css = getComputedStyle(box);
  return box.getBoundingClientRect().height + (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0);
}

/** 「+」を押したとき開いていた枠の代わりの空き。離すまで同じ高さを保ち、下の行をずらさない（MemoUi.hold） */
export function MemoHoldSpace({ height }: { height: number }) {
  return <div className="mhold" style={{ height }} aria-hidden="true" />;
}

/**
 * 書く枠。memo があれば直す（memo.update）、無ければ選んでいる行に足す（memo.save）。
 * 新しく書く枠で、選んだ範囲が GitHub の差分に出なければ、書く欄の代わりに聞く枠（githubDiff は新しく書く枠だけが渡す）。
 * 直す枠は前から残っている物（差分に出ない行のメモも）を直すので、いつも書く欄。
 * 文は新しく書く・直すの両方とも reducer の draft が持つ（範囲を伸ばすと枠が別の行の下で作り直され、差分一覧では画面から外れた枠が消えるので、ここに持つと消える）
 */
export function MemoEditor({
  path,
  span,
  githubDiff,
  memo,
  draft,
  dispatch,
}: {
  path: string;
  span: Pick<CommentDraft, 'line' | 'side' | 'startLine' | 'startSide'>;
  githubDiff?: readonly GithubDiffFile[] | undefined;
  memo?: CommentDraft;
  draft: string;
  dispatch: (c: Command) => void;
}) {
  const askable = useContext(AskContext) !== null && !memo;
  const where = `${fileName(path)} ${spanLabel(span)}`;
  if (!memo && onGithubDiff(githubDiff, { path, ...span }) === false) {
    return (
      <div className="mbox edit ask">
        <div className="mh">
          <span>聞く</span>
          <b>{where}</b>
        </div>
        <div className="mnote">{ASK_NOTE}</div>
        <div className="ma">
          <button className="btn sm" type="button" onClick={() => dispatch({ id: 'memo.cancel' })}>
            やめる <kbd>Esc</kbd>
          </button>
          <button className="btn sm primary" type="button" onClick={() => dispatch({ id: 'ask.lines' })}>
            聞く
          </button>
        </div>
      </div>
    );
  }
  const text = draft;
  const setText = (v: string) => dispatch({ id: 'memo.draft', body: v });
  const empty = text.trim() === '';
  const save = () => {
    if (empty) return;
    dispatch(memo ? { id: 'memo.update', commentId: memo.id, body: text } : { id: 'memo.save', body: text });
  };
  return (
    <div className="mbox edit">
      <div className="mh">
        <span>メモ</span>
        <b>{where}</b>
      </div>
      <textarea
        aria-label="メモ"
        autoFocus
        value={text}
        placeholder="この行についてのメモ。締めの画面でまとめて送れます（PR がなければ AI に返します）"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (composingKey(e.nativeEvent)) return;
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            dispatch({ id: 'memo.cancel' });
          }
        }}
      />
      <div className="ma">
        {askable && (
          <button className="btn sm" type="button" onClick={() => dispatch({ id: 'ask.lines' })}>
            聞く
          </button>
        )}
        <button className="btn sm" type="button" onClick={() => dispatch({ id: 'memo.cancel' })}>
          やめる <kbd>Esc</kbd>
        </button>
        <button className="btn sm primary" type="button" disabled={empty} onClick={save}>
          保存 <kbd>⌘⏎</kbd>
        </button>
      </div>
    </div>
  );
}

/** 保存したメモ。送信済みなら読むだけ */
export function MemoSaved({ memo, githubDiff, dispatch }: { memo: CommentDraft; githubDiff: readonly GithubDiffFile[] | undefined; dispatch: (c: Command) => void }) {
  const sent = memo.state === 'sent';
  return (
    <div className={`mbox${sent ? ' sent' : ''}`}>
      <div className="mh">
        <span>メモ</span>
        <b>{`${fileName(memo.path)} ${spanLabel(memo)}`}</b>
        <OffDiffChip comment={memo} githubDiff={githubDiff} />
        {sent && <span className="chip h">送信済み</span>}
      </div>
      <p>{memo.body}</p>
      {!sent && (
        <div className="ma">
          <button className="btn sm" type="button" onClick={() => dispatch({ id: 'memo.edit', commentId: memo.id })}>
            編集
          </button>
          <button className="btn sm" type="button" onClick={() => dispatch({ id: 'memo.delete', commentId: memo.id })}>
            削除
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * AI の下書き 1 件（2026-10-13。見本を比べて「開いた箱」にした）。AI が書いた物の印は水先案内と同じ点線、採用すると緑の実線。
 * ボタンは締めの箱と同じ（採用 / 編集 / 破棄、編集中は この文で採用 / 戻す、採用は戻す）。破棄した物は 1 行にたたみ「戻す」だけ残す。送信済みは読むだけ。
 * 直している途中の文は reducer の draftText（text。無ければ今の本文）
 */
export function DraftBox({ draft: c, text, githubDiff, dispatch }: { draft: CommentDraft; text: string | undefined; githubDiff: readonly GithubDiffFile[] | undefined; dispatch: (c: Command) => void }) {
  if (c.state === 'discarded') {
    return (
      <div className="aigone">
        <span>破棄した AI の下書き</span>
        <span className="t">{c.body}</span>
        <button className="btn sm" type="button" onClick={() => dispatch({ id: 'comment.reset', commentId: c.id })}>
          戻す
        </button>
      </div>
    );
  }
  const adopted = c.state === 'adopted';
  const sent = c.state === 'sent';
  const body = text ?? c.body;
  return (
    <div className={`mbox ai${adopted ? ' ad' : ''}${sent ? ' sent' : ''}`}>
      <div className="mh">
        <span className="who">AI の下書き</span>
        <span className="chip">{c.source}</span>
        <b>{`${fileName(c.path)} ${spanLabel(c)}`}</b>
        {adopted && <span className="chip ok">採用</span>}
        <OffDiffChip comment={c} githubDiff={githubDiff} />
        {sent && <span className="chip h">送信済み</span>}
      </div>
      {c.state === 'edit' ? <textarea aria-label="コメント本文" value={body} onChange={(e) => dispatch({ id: 'comment.text', commentId: c.id, body: e.target.value })} /> : <p>{c.body}</p>}
      <DraftNote note={c.note} />
      {!sent && (
        <div className="ma">
          {c.state === 'draft' && (
            <>
              <button className="btn sm" type="button" onClick={() => dispatch({ id: 'comment.adopt', commentId: c.id })}>
                採用
              </button>
              <button className="btn sm" type="button" onClick={() => dispatch({ id: 'comment.edit', commentId: c.id })}>
                編集
              </button>
              <button className="btn sm" type="button" onClick={() => dispatch({ id: 'comment.discard', commentId: c.id })}>
                破棄
              </button>
            </>
          )}
          {c.state === 'edit' && (
            <>
              <button className="btn sm primary" type="button" disabled={body.trim() === ''} onClick={() => dispatch({ id: 'comment.save', commentId: c.id, body })}>
                この文で採用
              </button>
              <button className="btn sm" type="button" onClick={() => dispatch({ id: 'comment.reset', commentId: c.id })}>
                戻す
              </button>
            </>
          )}
          {adopted && (
            <button className="btn sm" type="button" onClick={() => dispatch({ id: 'comment.reset', commentId: c.id })}>
              戻す
            </button>
          )}
        </div>
      )}
    </div>
  );
}
