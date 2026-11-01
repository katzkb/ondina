// コマンドパレット（設計書 18.2）。How / シンボル / ファイルを横断で探して飛ぶ。
// from があるときは、そのシンボルが呼んでいる相手だけを並べる（3.6。コースの o）。
// 当たった文字に下線を引いて「なぜこの行が出たか」を行の上で見せる（あいまい一致の点数が外から見えない分の埋め合わせ）。
import type { Analysis } from '@ondina/model';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Command } from '../commands/commands.js';
import { composingKey } from '../commands/keymap.js';
import { shortName } from '../map/graph.js';
import { calleeItems, haystack, paletteItems, searchPalette, type PaletteHit, type PaletteTarget } from '../palette.js';

const KIND_LABEL: Record<PaletteTarget['kind'], string> = { how: 'How', hunk: 'シンボル', file: 'ファイル', callee: '呼ぶ相手' };

const keyOf = (t: PaletteTarget): string => (t.kind === 'how' ? `how:${t.howId}` : t.kind === 'hunk' ? `hunk:${t.hunkId}` : t.kind === 'file' ? `file:${t.path}` : `callee:${t.symbolId}`);

/** 呼んでいる相手が 0 件のときの理由。「呼んでいない」と「測れていない」を分ける（原則 2） */
function emptyText(analysis: Analysis, from: string): string {
  const measured = analysis.symbols.find((s) => s.id === from)?.edgesMeasured;
  if (measured === false) return '? 呼び出し関係を取得できていません（LSP が応答しませんでした）';
  if (measured === undefined) return '? 呼び出し関係を取得していません';
  return '呼んでいる相手なし';
}

export interface PaletteProps {
  analysis: Analysis;
  packagePrefix?: string | undefined;
  /** 呼んでいる相手を並べる起点（Symbol.id）。null なら普通のパレット */
  from?: string | null;
  /** 飛び先の表示（「この読む順番」か「How n の読む順番」か）に使う */
  selectedHow?: number | null;
  dispatch: (c: Command) => void;
}

export function Palette({ analysis, packagePrefix, from = null, selectedHow = null, dispatch }: PaletteProps) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const items = useMemo(() => (from === null ? paletteItems(analysis, packagePrefix) : calleeItems(analysis, from, selectedHow)), [analysis, packagePrefix, from, selectedHow]);
  const fromSym = from === null ? undefined : analysis.symbols.find((s) => s.id === from);
  const { hits, more } = useMemo(() => searchPalette(items, query), [items, query]);
  const cur = hits.length === 0 ? 0 : Math.min(at, hits.length - 1);

  const step = (d: number) => setAt(hits.length === 0 ? 0 : (cur + d + hits.length) % hits.length);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (composingKey(e.nativeEvent)) return;
    const act: Record<string, () => void> = {
      ArrowDown: () => step(1),
      ArrowUp: () => step(-1),
      Enter: () => {
        const hit = hits[cur];
        if (hit) dispatch({ id: 'palette.pick', target: hit.item.target });
      },
      // 閉じる順序（キーマップ表示 → パレット → 絞り込み）の判断は reducer 一箇所に置く
      Escape: () => dispatch({ id: 'escape' }),
    };
    const run = act[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };

  return (
    <div className="overlay" onClick={() => dispatch({ id: 'palette.close' })}>
      <div className="dialog palette" role="dialog" aria-label="コマンドパレット" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          type="text"
          aria-label="探す"
          placeholder={from === null ? 'How・シンボル・ファイルを探す' : `${fromSym ? shortName(fromSym.fqName, fromSym.path, fromSym.kind) : from.slice(0, 8)} が呼んでいる相手`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAt(0);
          }}
          onKeyDown={onKeyDown}
        />
        {hits.length === 0 ? (
          <div className="none">{from !== null && items.length === 0 ? emptyText(analysis, from) : '該当なし'}</div>
        ) : (
          <ul>
            {hits.map((hit, i) => (
              <li
                key={keyOf(hit.item.target)}
                className={i === cur ? 'on' : undefined}
                ref={i === cur ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
                onMouseEnter={() => setAt(i)}
                onClick={() => dispatch({ id: 'palette.pick', target: hit.item.target })}
              >
                <span className="kind">{KIND_LABEL[hit.item.kind]}</span>
                <span className="lbl">{underlined(hit, 0, hit.item.label.length)}</span>
                <span className="sub">{underlined(hit, hit.item.label.length + 1, haystack(hit.item).length)}</span>
              </li>
            ))}
          </ul>
        )}
        {more > 0 && <div className="more">他 {more} 件</div>}
      </div>
    </div>
  );
}

/** haystack の [from, to) を、当たった文字だけ下線にして描く */
function underlined(hit: PaletteHit, from: number, to: number): ReactNode[] {
  const text = haystack(hit.item).slice(from, to);
  const on = new Set(hit.positions.filter((p) => p >= from && p < to).map((p) => p - from));
  const out: ReactNode[] = [];
  for (let i = 0; i < text.length; ) {
    const lit = on.has(i);
    let j = i + 1;
    while (j < text.length && on.has(j) === lit) j++;
    const chunk = text.slice(i, j);
    out.push(
      lit ? (
        <u className="hit" key={i}>
          {chunk}
        </u>
      ) : (
        <span key={i}>{chunk}</span>
      ),
    );
    i = j;
  }
  return out;
}
