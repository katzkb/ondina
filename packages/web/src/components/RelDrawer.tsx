// 差分のない相手の引き出し（設計書 3.3。2026-10-11。見本 3 版を比べて決めた）。
// 地図の「差分なし n か所」の箱か R で右から出し、Shift+R で真ん中いっぱい（地図の引き出しと同じ形）。
// 左に名前の一覧（層ごと）、右にそのコード（ファイル全体。宣言と、差分を呼んでいる行へスクロールして印）。↑↓ で次の相手、Esc・外側で閉じて読んでいた差分に戻る。
// 差分の無いコードは「関係がある」と分かれば十分なので、見た印は付けない（差分が責任の単位という方針）
import type { Analysis } from '@ondina/model';
import { useEffect, useRef } from 'react';
import type { Command } from '../commands/commands.js';
import type { DiffMemo } from '../diff/DiffList.js';
import { FileView } from '../diff/FileView.js';
import { Key } from './Key.js';
import { layerText } from '../map/graph.js';
import { relHostLabel, relItems, relLayers, relVisible, type RelView } from '../rel.js';
import type { FindUi, FocusLine } from '../state/reducer.js';

export interface RelDrawerProps {
  analysis: Analysis;
  rel: RelView;
  viewed: readonly string[];
  /** メモ（3.3）と AI の下書き。差分の無いコードの行は GitHub の差分に出ないので、メモは書けず聞くだけ（行番号の印は「?」） */
  memo: DiffMemo;
  /** 案内人の答えの行の場所で来た行 */
  focusLine: FocusLine | null;
  find?: FindUi;
  dispatch: (c: Command) => void;
}

const WORD = { in: '呼び出し元', out: '呼び出し先' } as const;

export function RelDrawer({ analysis, rel, viewed, memo, focusLine, find, dispatch }: RelDrawerProps) {
  const big = rel.size === 'big';
  const items = relVisible(analysis, rel);
  const sel = items.find((x) => x.id === rel.sel) ?? items[0];
  const symbol = sel === undefined ? undefined : analysis.symbols.find((s) => s.id === sel.id);
  const layers = relLayers(analysis, rel.host, rel.dir);
  const n = { in: relItems(analysis, rel.host, 'in').length, out: relItems(analysis, rel.host, 'out').length };
  const listRef = useRef<HTMLDivElement>(null);
  // ↑↓ で選んだ相手を一覧の中に入れる
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [rel.sel]);

  const open = (patch: Partial<Pick<RelView, 'dir' | 'layer'>>) => dispatch({ id: 'rel.open', host: rel.host, dir: patch.dir ?? rel.dir, layer: patch.layer === undefined ? rel.layer : patch.layer });
  let heading: string | null = null;
  return (
    <>
      <div className="veil" onClick={() => dispatch({ id: 'rel.close' })} />
      <div className={`${big ? 'mapbig' : 'drawer'} reldrawer`} role={big ? 'dialog' : 'complementary'} aria-label="差分のない相手" aria-modal={big ? true : undefined}>
        <div className="rhd">
          <span className="chip">差分なし</span>
          <b>{`${relHostLabel(analysis, rel.host)} の${WORD[rel.dir]}`}</b>
          <span className="sp" />
          <button className="btn sm" type="button" onClick={() => dispatch({ id: 'rel.big' })}>
            {big ? '元の大きさ' : '大きく'} <Key action="rel.big" />
          </button>
          <button className="btn sm" type="button" onClick={() => dispatch({ id: 'rel.close' })}>
            閉じる <kbd>Esc</kbd>
          </button>
        </div>
        <div className="rtabs">
          {(['in', 'out'] as const).map((d) =>
            n[d] > 0 ? (
              <button key={d} type="button" aria-pressed={rel.dir === d} onClick={() => open({ dir: d, layer: null })}>
                {`${WORD[d]} ${n[d]}`}
              </button>
            ) : null,
          )}
          {layers.length > 1 && (
            <>
              <span className="gap" />
              <button type="button" aria-pressed={rel.layer === null} onClick={() => open({ layer: null })}>
                すべての層
              </button>
              {layers.map((l) => (
                <button key={l.layer} type="button" aria-pressed={rel.layer === l.layer} onClick={() => open({ layer: l.layer })}>
                  {`${l.layer} ${l.n}`}
                </button>
              ))}
            </>
          )}
        </div>
        <div className="rbody">
          <div className="rlist" ref={listRef} aria-label="相手">
            {items.flatMap((x) => {
              const out = [];
              if (x.layer !== heading) {
                heading = x.layer;
                out.push(<h5 key={`h:${x.layer}`}>{layerText(analysis.symbols.find((s) => s.id === x.id))}</h5>);
              }
              out.push(
                <button key={x.id} type="button" title={x.path} aria-current={x.id === sel?.id} onClick={() => dispatch({ id: 'rel.select', symbolId: x.id })}>
                  {x.name}
                </button>,
              );
              return out;
            })}
          </div>
          <div className="rcode">
            {/* 相手の関数の全体を読めるよう、ファイル全体を出して中心の行（宣言と差分を呼ぶ行）へスクロールする */}
            {symbol && <FileView key={symbol.id} analysis={analysis} path={symbol.path} hunkId={null} symbol={symbol} full mode="uni" viewed={viewed} dispatch={dispatch} memo={memo} focusLine={focusLine} controls={false} {...(find ? { find } : {})} />}
          </div>
        </div>
        <div className="rfoot">
          <span>
            <Key action="hunk.prev" prefer="ArrowUp" /> <Key action="hunk.next" prefer="ArrowDown" /> 次の相手
          </span>
          <span>
            <kbd>Esc</kbd> 読んでいた場所に戻る
          </span>
          <span className="sp" />
          <span>見た印は付きません</span>
        </div>
      </div>
    </>
  );
}
