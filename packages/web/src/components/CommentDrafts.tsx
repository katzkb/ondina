// 締め（設計書 3.9 / 12 章）の右の列: 「自分のメモ」（そのまま送る）と「AI の下書き」（採用したものだけ送る）の 2 箱と、送るボタン 1 つ。
// 両方を GitHub のレビュー 1 件として送る。PR の無い解析（local。AI が作った変更など）は、GitHub でなくこの変更を作った AI に返す（2026-10-15）。「開く」で差分一覧のその行へ（差分の無いファイルのメモは、その行が見えるコースの停留所へ）。
// 2026-10-03 に差分一覧の右の列から締めへ移した（送る所を 1 か所にし、承認の直前に見直す）。2026-10-06 にメモの箱を足した（見本を比べて決めた）。
// 2026-10-13 から AI の下書きは差分一覧とコースの行の下にも出る（MemoBox の DraftBox）。直している途中の文は両方とも reducer の draftText。
import type { CommentDraft, GithubDiffFile } from '@ondina/model';
import type { Command } from '../commands/commands.js';
import { shortPath } from '../files.js';
import { isMemo, onGithubDiff, spanLabel } from '../memo.js';
import type { MemoUi, SendStatus } from '../state/reducer.js';
import { DraftNote, MemoEditor, OffDiffChip } from './MemoBox.js';

export function CommentDrafts({
  comments,
  send,
  canSend,
  local,
  githubDiff,
  memo,
  draftText,
  packagePrefix,
  dispatch,
}: {
  comments: CommentDraft[];
  send: SendStatus;
  canSend: boolean;
  /** PR 番号の無い解析。GitHub でなく AI に返す（`ondina comments wait` が受け取る） */
  local: boolean;
  /** GitHub の差分の塊（Analysis.githubDiff）。差分に出ない行の採用は送らない。無ければ（local と古い解析）全部を送る */
  githubDiff: readonly GithubDiffFile[] | undefined;
  memo: MemoUi;
  /** AI の下書きを直している途中の文（AppState.draftText） */
  draftText: Readonly<Record<string, string>>;
  /** ondina.config.yaml の packagePrefix（11 章）。パスをその下から出す */
  packagePrefix?: string | undefined;
  dispatch: (c: Command) => void;
}) {
  const memos = comments.filter((c) => isMemo(c) && c.state !== 'discarded');
  const drafts = comments.filter((c) => !isMemo(c));
  // 送る数は送れる物だけ。GitHub の差分に出ない行の採用は送らないので数えず、ボタンの下にその数を出す
  const adopted = (c: CommentDraft) => c.state === 'adopted';
  const sendable = (c: CommentDraft) => adopted(c) && onGithubDiff(githubDiff, c) !== false;
  const memoN = memos.filter(sendable).length;
  const draftN = drafts.filter(sendable).length;
  const offN = [...memos, ...drafts].filter((c) => adopted(c) && !sendable(c)).length;
  const parts = [memoN > 0 ? `メモ ${memoN}` : null, draftN > 0 ? `下書き ${draftN}` : null].filter(Boolean).join(' · ');
  const title = local
    ? '自分のメモと採用した下書きを、この変更を作った AI に返します（PR がないので GitHub には送りません）'
    : parts === ''
      ? '自分のメモと、採用した下書きを送る'
      : `${parts} を、GitHub で公開していない 1 つのレビューとして送る`;
  const label = send.status === 'sending' ? '送信中…' : parts === '' ? (local ? '返すコメントはまだありません' : '送るコメントはまだありません') : local ? `AI に返す（${parts}）` : `GitHub にコメントを送る（${parts}）`;
  return (
    <>
      <div className="box memos">
        <h3>
          自分のメモ<span className="sub">そのまま送る</span>
          <span className="sp" />
          <span className="chip">{memos.length}</span>
        </h3>
        {memos.length === 0 && <div className="empty">メモはまだありません。コースの画面か差分一覧で、行番号の「+」を押して書きます</div>}
        {memos.map((c) => (
          <Memo key={c.id} memo={c} editing={memo.editing === c.id} draft={memo.draft} githubDiff={githubDiff} packagePrefix={packagePrefix} dispatch={dispatch} />
        ))}
      </div>
      <div className="box drafts">
        <h3>
          AI の下書き<span className="sub">採用したものだけ送る</span>
          <span className="sp" />
          <span className="chip">{`${drafts.filter(adopted).length} / ${drafts.filter((c) => c.state !== 'discarded' && c.state !== 'sent').length}`}</span>
        </h3>
        {drafts.length === 0 && <div className="empty">下書きはまだありません。`ondina comments add --from comments.json` か POST /api/comments で受け取ります</div>}
        {drafts.map((c) => (
          <Draft key={c.id} comment={c} text={draftText[c.id]} githubDiff={githubDiff} packagePrefix={packagePrefix} dispatch={dispatch} />
        ))}
      </div>
      <div className="send">
        <button type="button" className="btn primary" disabled={!canSend} title={title} onClick={() => dispatch({ id: 'comment.send' })}>
          {label}
        </button>
        {offN > 0 && <div className="muted">{`GitHub の差分に出ない行のメモ・下書き ${offN} 件は送りません。GitHub はこの行にコメントを付けられません`}</div>}
        {githubDiff === undefined && !local && memos.length + drafts.length > 0 && <div className="muted">この解析には GitHub の差分の範囲がありません。analyze を実行し直すと、GitHub の差分に出ない行を見分けられます</div>}
        {send.status === 'error' && <div className="err">{send.message}</div>}
        {send.status === 'returned' && (
          <div className="ok">
            {send.waiting ? 'AI に返しました。待っている AI が受け取ります' : <>AI に返しました。いま待っている AI はいません。AI に「ondina で返したコメントを読んで」と伝えてください</>}
          </div>
        )}
        {send.status === 'sent' && (
          <div className="ok">
            送信しました。まだ公開されていません。GitHub で確かめてから公開してください。
            <a href={send.url} target="_blank" rel="noreferrer">
              GitHub で見る
            </a>
          </div>
        )}
      </div>
    </>
  );
}

/** 自分のメモ 1 件。編集はその場の書く枠（memo.edit → memo.update）、送信済みは読むだけ */
function Memo({
  memo: c,
  editing,
  draft,
  githubDiff,
  packagePrefix,
  dispatch,
}: {
  memo: CommentDraft;
  editing: boolean;
  draft: string;
  githubDiff: readonly GithubDiffFile[] | undefined;
  packagePrefix: string | undefined;
  dispatch: (cmd: Command) => void;
}) {
  const sent = c.state === 'sent';
  return (
    <div className={`cm${sent ? ' sent' : ''}`}>
      <div className="loc">
        <span className="path" title={c.path}>{`${shortPath(c.path, packagePrefix)} ${spanLabel(c)}`}</span>
        <OffDiffChip comment={c} githubDiff={githubDiff} />
        {sent && <span className="chip h">送信済み</span>}
        <button type="button" className="btn sm open" title="この行を開く" onClick={() => dispatch({ id: 'comment.open', commentId: c.id })}>
          開く
        </button>
      </div>
      {editing ? (
        <MemoEditor path={c.path} span={c} memo={c} draft={draft} dispatch={dispatch} />
      ) : (
        <>
          <p>{c.body}</p>
          {!sent && (
            <div className="act">
              <button type="button" className="btn sm" onClick={() => dispatch({ id: 'memo.edit', commentId: c.id })}>
                編集
              </button>
              <button type="button" className="btn sm" onClick={() => dispatch({ id: 'memo.delete', commentId: c.id })}>
                削除
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Draft({
  comment: c,
  text: editing,
  githubDiff,
  packagePrefix,
  dispatch,
}: {
  comment: CommentDraft;
  text: string | undefined;
  githubDiff: readonly GithubDiffFile[] | undefined;
  packagePrefix: string | undefined;
  dispatch: (cmd: Command) => void;
}) {
  const text = editing ?? c.body;
  const cls = c.state === 'adopted' ? ' ad' : c.state === 'sent' ? ' sent' : c.state === 'discarded' ? ' gone' : '';
  return (
    <div className={`cm${cls}`}>
      <div className="loc">
        <span className="path" title={c.path}>{`${shortPath(c.path, packagePrefix)}:${c.line}`}</span>
        <span className="chip">{c.source}</span>
        {c.state === 'adopted' && <span className="chip ok">採用</span>}
        <OffDiffChip comment={c} githubDiff={githubDiff} />
        {c.state === 'discarded' && <span className="chip">破棄</span>}
        {c.state === 'sent' && <span className="chip h">送信済み</span>}
        <button type="button" className="btn sm open" title="差分一覧でこの行を開く" onClick={() => dispatch({ id: 'comment.open', commentId: c.id })}>
          開く
        </button>
      </div>
      {c.state === 'edit' ? <textarea aria-label="コメント本文" value={text} onChange={(e) => dispatch({ id: 'comment.text', commentId: c.id, body: e.target.value })} /> : <p>{c.body}</p>}
      <DraftNote note={c.note} />
      <div className="act">
        {c.state === 'draft' && (
          <>
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'comment.adopt', commentId: c.id })}>
              採用
            </button>
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'comment.edit', commentId: c.id })}>
              編集
            </button>
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'comment.discard', commentId: c.id })}>
              破棄
            </button>
          </>
        )}
        {c.state === 'edit' && (
          <>
            <button type="button" className="btn sm primary" disabled={text.trim() === ''} onClick={() => dispatch({ id: 'comment.save', commentId: c.id, body: text })}>
              この文で採用
            </button>
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'comment.reset', commentId: c.id })}>
              戻す
            </button>
          </>
        )}
        {(c.state === 'adopted' || c.state === 'discarded') && (
          <button type="button" className="btn sm" onClick={() => dispatch({ id: 'comment.reset', commentId: c.id })}>
            戻す
          </button>
        )}
      </div>
    </div>
  );
}
