// 案内人に聞く（設計書 3.10）の引き出し。右から出し、暗くする幕は掛けない（答えを読みながらコードが見え、行の場所を押すとコードが動くのが見える）。
// 停留所の画面では引き出しを使わず、右の列（StopColumn）が質問の欄（2026-10-20）。何について・会話の並び・入力欄はここの部品を両方で使う。
// - 何について: 引き出しは開いたときの画面の場所（開いている間は替えない）
// - 会話が空のときは決まった形の候補（自動）。押すとそのまま送る
// - 答えは LLM の文なので点線の枠と「AI」のチップ（原則 4）。行の場所は青い下線（押すとその行へ）、材料にない場所は「場所を確かめられません」
// - ネットで調べた事実は末尾に脚注の番号、答えの下に「調べたページ」（別のタブで開く）。行もページも無い事実は「出典なし」（2026-10-15）
// - 作者が書いていない「なぜ」を材料から推し量った項目（guess）は、点線の下線と「推定」のチップ（2026-11-11。原則 2）
// - 待っている間は経過秒と「止める」。失敗は理由と「もう一度」「LLM コマンドを設定する」
// - 別の場所の答えが見ていない間に来ていれば、入力欄の上にその場所の名前（2026-10-20。答えが来た印は場所ごと）
// - 「+」で選んだ行について聞いているときは、何についての右に「× 場所全体にする」
// - コードの場所の答えには「メモにする」（質問の文を聞いた行の書く枠に入れる。行の無い問いは行を選ぶ案内）
import type { Analysis, AskAnswer, AskPlace } from '@ondina/model';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { askSuggestions, askTitle, askWebRefs, canMemo, citeLabel } from '../ask.js';
import type { Command } from '../commands/commands.js';
import { composingKey } from '../commands/keymap.js';
import type { AskUi } from '../state/reducer.js';
import { Lines } from './Lines.js';

interface AskProps {
  analysis: Analysis;
  ask: AskUi;
  dispatch: (c: Command) => void;
}

/** 今の何についての会話（記録・待っている問い・失敗した問い） */
export function askHere(ask: AskUi) {
  return {
    place: ask.place ?? ({ kind: 'pr' } as const),
    entries: ask.log.filter((e) => e.key === ask.key),
    pending: ask.pending?.key === ask.key ? ask.pending : null,
    failed: ask.failed?.key === ask.key ? ask.failed : null,
  };
}

const linesOf = (place: AskPlace) => (place.kind === 'symbol' || place.kind === 'hunk' || place.kind === 'file' ? place.lines : undefined);

export function AskDrawer({ analysis, ask, dispatch }: AskProps) {
  const { entries, pending, failed } = askHere(ask);
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = threadRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, [entries.length, pending, failed]);
  return (
    <aside className="askd" aria-label="案内人に聞く">
      <div className="dh">
        <b>案内人に聞く</b>
        <span className="sp" />
        <button type="button" className="btn sm" onClick={() => dispatch({ id: 'ask.close' })}>
          閉じる <kbd>Esc</kbd>
        </button>
      </div>
      <AskAbout analysis={analysis} ask={ask} dispatch={dispatch} />
      <div className="thread" ref={threadRef}>
        <AskThread analysis={analysis} ask={ask} dispatch={dispatch} />
      </div>
      <AskForm analysis={analysis} ask={ask} dispatch={dispatch} autoFocus onEscape={() => dispatch({ id: 'ask.close' })} />
    </aside>
  );
}

/** 何について（選んだ行について聞いているときは「× 場所全体にする」） */
export function AskAbout({ analysis, ask, dispatch }: AskProps) {
  const { place } = askHere(ask);
  return (
    <div className="about">
      <span className="lbl">何について</span>
      <b>{askTitle(analysis, place)}</b>
      {linesOf(place) && (
        <button type="button" className="x" onClick={() => dispatch({ id: 'ask.whole' })}>
          × 場所全体にする
        </button>
      )}
    </div>
  );
}

/** 会話の並び（.thread の中身）。short = 会話が空のときの説明を 1 行にする（停留所の画面の右の列。上に水先案内がある） */
export function AskThread({ analysis, ask, dispatch, short = false }: AskProps & { short?: boolean }) {
  const { place, entries, pending, failed } = askHere(ask);
  const empty = entries.length === 0 && pending === null && failed === null;
  const busy = ask.pending !== null;
  const send = (question: string) => dispatch({ id: 'ask.send', question, now: Date.now() });
  return (
    <>
      {empty && (
        <>
          <p className="emptyq">
            分からないことを聞けます。コードの外のことも聞けます。
            {!short && (
              <>
                <br />
                答えは差分と解析の事実から書きます。
                <br />
                足りないことは、ネットで調べるか AI の知識で答えます。
              </>
            )}
          </p>
          <div className="sugg">
            <span className="lbl">
              よく聞くこと<span className="chip">自動</span>
            </span>
            <div className="list">
              {askSuggestions(analysis, place).map((q) => (
                <button key={q} type="button" className="s" disabled={busy} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      {entries.map((e) => (
        <Fragment key={e.id}>
          <div className="qq">{e.question}</div>
          <Answer answer={e.answer} dispatch={dispatch}>
            {canMemo(e.place, analysis.githubDiff) &&
              (ask.memoed?.entryId === e.id ? (
                <span className="done">{`${ask.memoed.label}の書く枠に入れました`}</span>
              ) : (
                <button type="button" className="btn sm" onClick={() => dispatch({ id: 'ask.memo', entryId: e.id })}>
                  メモにする
                </button>
              ))}
          </Answer>
          {ask.memoFor?.entryId === e.id && (
            <div className="pickhint">
              <p>メモを付ける行を、行番号の「+」で選んでください。</p>
              <p>選ぶと、その行の書く枠に質問の文が入ります。</p>
              <div className="row">
                <button type="button" className="btn sm" onClick={() => dispatch({ id: 'ask.memoCancel' })}>
                  やめる
                </button>
              </div>
            </div>
          )}
        </Fragment>
      ))}
      {pending && (
        <>
          <div className="qq">{pending.question}</div>
          <Waiting startedAt={pending.startedAt} dispatch={dispatch} />
        </>
      )}
      {failed && (
        <>
          <div className="qq">{failed.question}</div>
          <div className="aa failed">
            <p>LLM で答えを書けませんでした。</p>
            <p>{`理由: ${failed.reason}`}</p>
            <div className="foot">
              <button type="button" className="btn sm" disabled={busy} onClick={() => dispatch({ id: 'ask.retry', now: Date.now() })}>
                もう一度
              </button>
              <button type="button" className="btn sm" onClick={() => dispatch({ id: 'settings.open' })}>
                LLM コマンドを設定する
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** 見ていない間に答え（か失敗）が来た、今の場所以外の場所の名前 */
function unreadTitles(analysis: Analysis, ask: AskUi): string[] {
  return ask.unread
    .filter((k) => k !== ask.key)
    .flatMap((k) => {
      const place = ask.log.filter((e) => e.key === k).at(-1)?.place ?? (ask.failed?.key === k ? ask.failed.place : undefined);
      return place ? [askTitle(analysis, place)] : [];
    });
}

/**
 * 入力欄（⌘⏎ で送る）と、その上の知らせ（別の場所の問いを待っている・別の場所の答えが届いた）。
 * focusN = 停留所の画面の右の列で、値が変わったら入力欄に移る（Q と書く枠の「聞く」。右の列は消さないので、出たときの値では動かない）
 */
export function AskForm({ analysis, ask, dispatch, autoFocus = false, focusN, onEscape }: AskProps & { autoFocus?: boolean; focusN?: number; onEscape: (t: HTMLTextAreaElement) => void }) {
  const { place, pending } = askHere(ask);
  const elsewhere = ask.pending !== null && pending === null;
  const arrived = unreadTitles(analysis, ask);
  const busy = ask.pending !== null;
  const send = (question: string) => dispatch({ id: 'ask.send', question, now: Date.now() });
  const lines = linesOf(place);
  const placeholder = place.kind === 'pr' ? 'PR 全体について聞く…' : place.kind === 'course' ? 'このコースについて聞く…' : lines ? 'この行について聞く…' : 'この場所について聞く…';
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(focusN);
  useEffect(() => {
    if (focusN === undefined || focused.current === focusN) return;
    focused.current = focusN;
    inputRef.current?.focus();
  }, [focusN]);
  return (
    <form
      className="askin"
      onSubmit={(e) => {
        e.preventDefault();
        send(ask.draft);
      }}
    >
      {elsewhere && <span className="muted">別の場所の問いの答えを待っています</span>}
      {arrived.length > 0 && <span className="muted arrived">{`別の場所の問いの答えが届いています（${arrived.join('、')}）`}</span>}
      <div className="row">
        <textarea
          ref={inputRef}
          aria-label="質問"
          autoFocus={autoFocus}
          value={ask.draft}
          placeholder={placeholder}
          onChange={(e) => dispatch({ id: 'ask.draft', text: e.target.value })}
          onKeyDown={(e) => {
            if (composingKey(e.nativeEvent)) return;
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send(ask.draft);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onEscape(e.currentTarget);
            }
          }}
        />
        <button type="submit" className="btn primary" disabled={busy || ask.draft.trim() === ''}>
          送る <kbd>⌘⏎</kbd>
        </button>
      </div>
    </form>
  );
}

/** children は答えの下の操作（「メモにする」か、入れた知らせ） */
function Answer({ answer, dispatch, children }: { answer: AskAnswer; dispatch: (c: Command) => void; children?: ReactNode }) {
  const refs = askWebRefs(answer);
  const numOf = new Map(refs.map((r) => [r.url, r.n]));
  return (
    <div className="aa">
      <span className="who">
        水先案内<span className="chip ai">AI</span>
      </span>
      <Lines text={answer.lead} />
      {answer.items.length > 0 && (
        <ul>
          {answer.items.map((it, i) => (
            <li key={i}>
              {it.guess ? <span className="guess">{it.text}</span> : it.text}
              {it.cite && (
                <button type="button" className="ln" onClick={() => dispatch({ id: 'ask.cite', cite: it.cite! })}>
                  {citeLabel(it.cite)}
                </button>
              )}
              {it.web && (
                <a className="fn" href={it.web.url} target="_blank" rel="noreferrer" title={it.web.url}>
                  {`[${numOf.get(it.web.url)}]`}
                </a>
              )}
              {it.unverified && (
                <span className="chip w" title="LLM が示した行は、材料の中にありませんでした">
                  場所を確かめられません
                </span>
              )}
              {it.guess && (
                <span className="chip ai" title="作者が書いていないことを、AI が材料から推し量った文です">
                  推定
                </span>
              )}
              {it.known && (
                <span className="chip nosrc" title="差分の行も、開けるページも示していない事実です。AI が元から知っていることか、AI が読めない URL を書いた事実です">
                  出典なし
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {answer.tail && <Lines text={answer.tail} />}
      {refs.length > 0 && (
        <div className="refs">
          <span className="lbl">調べたページ</span>
          <ol aria-label="調べたページ">
            {refs.map((r) => (
              <li key={r.url}>
                <span className="n">{`[${r.n}]`}</span>
                {r.title && <span className="t">{r.title}</span>}
                <a className="web" href={r.url} target="_blank" rel="noreferrer" title={r.url}>
                  {r.host}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
      {children && <div className="foot">{children}</div>}
    </div>
  );
}

function Waiting({ startedAt, dispatch }: { startedAt: number; dispatch: (c: Command) => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="aa wait">
      <span>{`答えを待っています · ${Math.max(0, Math.round((now - startedAt) / 1000))} 秒`}</span>
      <button type="button" className="btn sm" onClick={() => dispatch({ id: 'ask.stop' })}>
        止める
      </button>
    </div>
  );
}
