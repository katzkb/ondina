// 定義の引き出し（設計書 3.6。2026-10-29。見本を比べて「右に出す」にし、呼び出し先と同じく大きくできるようにした）。
// コード欄に出ていない定義へ移るときに右から出す（差分一覧・目的ごと・コース。差分のない相手の引き出しと同じ形）。⇧R で真ん中いっぱい。
// 中身はファイル全体（head は変わった行を埋め込む。base は変更前の全文）で、定義の行へスクロールして光らせる。中の名前も ⌘+クリックで続けて移る。
// ⌘[ で前の定義（最初の定義なら閉じる）、Esc・外側で閉じて読んでいた差分に戻る。差分の無いコードなので見た印は付けない
import type { Analysis } from '@ondina/model';
import { useMemo } from 'react';
import type { Command } from '../commands/commands.js';
import { defIndex } from '../defs.js';
import { FileView } from '../diff/FileView.js';
import type { DefView, FindUi, FocusLine } from '../state/reducer.js';
import { Key } from './Key.js';

/** 引き出しの下の 1 行目。名前を聞いていないファイル（行き先の行き先）では、移れない訳を出す（黙って下線を出さないままにしない） */
const ASKED = {
  whole: '名前を ⌘+クリックで続けて移動',
  part: 'このファイルは、差分の行の名前からだけ移動できます',
  none: 'このファイルの名前からは移動できません（解析のときに聞いたのは、差分と、そこから移った先のファイルの名前までです）',
} as const;

export function DefDrawer({ analysis, def, viewed, find, dispatch }: { analysis: Analysis; def: DefView; viewed: readonly string[]; find?: FindUi; dispatch: (c: Command) => void }) {
  const { target: t, name } = def.stack[def.stack.length - 1]!;
  const asked = defIndex(analysis.defs)?.asked(t.side, t.path) ?? 'none';
  // 前の定義に戻ったときは n で光らせ直す。検索中の描き直しでは定義の行へ戻さない
  const focus = useMemo<FocusLine>(() => ({ path: t.path, side: 'RIGHT', line: t.line, n: def.stack.length }), [t.path, t.line, def.stack.length]);
  return (
    <>
      <div className="veil" onClick={() => dispatch({ id: 'def.close' })} />
      <div className={`${def.big ? 'mapbig' : 'drawer'} reldrawer defdrawer`} role={def.big ? 'dialog' : 'complementary'} aria-label="定義" aria-modal={def.big ? true : undefined}>
        <div className="rhd">
          <span className="chip">差分なし</span>
          {t.side === 'base' && <span className="chip">変更前（base）</span>}
          <b>{name}</b>
          <span className="where">{`${t.path}:${t.line}`}</span>
          <span className="sp" />
          {def.stack.length > 1 && (
            <button className="btn sm" type="button" onClick={() => dispatch({ id: 'def.back' })}>
              ← 前の定義 <Key action="def.back" />
            </button>
          )}
          <button className="btn sm" type="button" onClick={() => dispatch({ id: 'rel.big' })}>
            {def.big ? '元の大きさ' : '大きく'} <Key action="rel.big" />
          </button>
          <button className="btn sm" type="button" onClick={() => dispatch({ id: 'def.close' })}>
            閉じる <kbd>Esc</kbd>
          </button>
        </div>
        <div className="rcode">
          <FileView key={`${t.side}:${t.path}`} analysis={analysis} path={t.path} side={t.side} hunkId={null} symbol={undefined} all full mode="uni" viewed={viewed} dispatch={dispatch} focusLine={focus} controls={false} {...(find ? { find } : {})} />
        </div>
        <div className="rfoot">
          <span>{ASKED[asked]}</span>
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
