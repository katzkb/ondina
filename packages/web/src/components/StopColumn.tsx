// 停留所の画面の右の列（設計書 3.3 / 3.10。2026-10-20。動く見本を比べて「案 2: 案内も会話の中」にし、一番上へ・一番下へを足した）。
// 水先案内を会話の最初の発言にし、質問と答えをその下に続ける。「問題なし · 次へ」「前へ」は入力欄のすぐ上に固定。
// 何については今の停留所に付いていく（reducer）。何について・会話の並び・入力欄は引き出し（AskDrawer）と同じ部品。
// たたむ（B）と 44px の帯になる。幅を動かして畳むので消さずに inert にする（入力欄に移る合図と会話の位置を保つ）。
// 会話の位置: 停留所が替わった（何についての key が替わった）ら一番上（案内を先に読む）。同じ場所で答え・待ち・失敗が増えたら一番下。
// 「一番上へ」「一番下へ」は会話が溢れているときだけ右下に出し、端にいる側は押せなくする（位置は部品の中で持ち、reducer には持たない）。
import type { Analysis } from '@ondina/model';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Command } from '../commands/commands.js';
import type { AskUi } from '../state/reducer.js';
import { AskAbout, AskForm, askHere, AskThread } from './AskDrawer.js';
import { Key } from './Key.js';

/** 会話の位置。fits = 溢れていない（ボタンを出さない） */
type Edge = 'fits' | 'top' | 'middle' | 'bottom';

function edgeOf(t: HTMLElement): Edge {
  const max = t.scrollHeight - t.clientHeight;
  if (max <= 1) return 'fits';
  if (t.scrollTop <= 1) return 'top';
  return t.scrollTop >= max - 1 ? 'bottom' : 'middle';
}

export interface StopColumnProps {
  analysis: Analysis;
  ask: AskUi;
  /** 見出しの「i / N」 */
  where: string;
  folded: boolean;
  /** 会話の最初の発言（最初の停留所はコースの紹介、名前・水先案内・事実のチップ） */
  guide: ReactNode;
  /** 「問題なし · 次へ」「前へ」 */
  actions: ReactNode;
  dispatch: (c: Command) => void;
}

export function StopColumn({ analysis, ask, where, folded, guide, actions, dispatch }: StopColumnProps) {
  const { entries, pending, failed } = askHere(ask);
  const threadRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<Edge>('fits');
  const measure = () => {
    if (threadRef.current) setEdge(edgeOf(threadRef.current));
  };
  const shownKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const t = threadRef.current;
    if (!t) return;
    t.scrollTop = shownKey.current === ask.key ? t.scrollHeight : 0;
    shownKey.current = ask.key;
    measure();
  }, [ask.key, entries.length, pending, failed]);
  const scrolled = useRef(ask.scroll.n);
  useEffect(() => {
    const t = threadRef.current;
    if (!t || scrolled.current === ask.scroll.n) return;
    scrolled.current = ask.scroll.n;
    t.scrollTop = ask.scroll.to === 'top' ? 0 : t.scrollHeight;
    measure();
  }, [ask.scroll]);
  // 窓の大きさ・列の幅を変えた・たたみを開いたときも、溢れているかを見直す（jsdom に ResizeObserver は無い）
  useEffect(() => {
    measure();
    const t = threadRef.current;
    if (!t || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(t);
    return () => watch.disconnect();
  }, [folded]);
  return (
    <aside className="askd rcol" aria-label="水先案内" inert={folded} aria-hidden={folded || undefined}>
      <div className="dh">
        <b>水先案内</b>
        <span className="where">{where}</span>
        <span className="sp" />
        <button className="btn sm" type="button" onClick={() => dispatch({ id: 'course.fold' })}>
          たたむ » <Key action="course.fold" />
        </button>
      </div>
      <AskAbout analysis={analysis} ask={ask} dispatch={dispatch} />
      <div className="tw">
        <div className="thread" ref={threadRef} onScroll={measure}>
          {guide}
          <AskThread analysis={analysis} ask={ask} dispatch={dispatch} short />
        </div>
        {edge !== 'fits' && (
          <div className="jump">
            <button type="button" title="一番上へ" aria-label="一番上へ" disabled={edge === 'top'} onClick={() => dispatch({ id: 'ask.top' })}>
              <Arrow up />
            </button>
            <button type="button" title="一番下へ" aria-label="一番下へ" disabled={edge === 'bottom'} onClick={() => dispatch({ id: 'ask.bottom' })}>
              <Arrow up={false} />
            </button>
          </div>
        )}
      </div>
      <div className="acts">{actions}</div>
      <AskForm analysis={analysis} ask={ask} dispatch={dispatch} focusN={ask.focusN} onEscape={(t) => t.blur()} />
    </aside>
  );
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d={up ? 'M8 13V3M3.5 7.5 8 3l4.5 4.5' : 'M8 3v10M3.5 8.5 8 13l4.5-4.5'} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
