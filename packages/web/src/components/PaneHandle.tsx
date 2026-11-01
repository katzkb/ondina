// 列の境目（2026-10-20）。ドラッグで列の幅を変え、ダブルクリックで既定の幅に戻す（どちらも ui.pane）。
// グリッドのコンテナの直下に重ねる（列の中に置くと列の overflow で切れる）。位置は列の幅の CSS 変数から決まる。
// ドラッグ中は React を通さずコンテナの CSS 変数を書き、離したときだけ dispatch する（毎フレーム dispatch すると画面全体を描き直し、ui.json を書き続ける）。
// キーボードでは変えない（← → は停留所の移動と重なる）
import type { PaneId } from '@ondina/model';
import { useEffect, useRef } from 'react';
import type { Command } from '../commands/commands.js';
import { PANES, paneValue, paneWidth } from '../panes.js';

interface Drag {
  handle: HTMLElement;
  box: HTMLElement;
  /** 押したときのポインターの x */
  x: number;
  /** 押したときの列の幅と今の幅（px の整数） */
  from: number;
  px: number;
  /** 押す前のコンテナの CSS 変数（保存した幅。無ければ空）。やめたとき・幅が変わらなかったときに戻す */
  before: string;
}

export function PaneHandle({ pane, dispatch }: { pane: PaneId; dispatch: (c: Command) => void }) {
  const { name, cssVar, side } = PANES[pane];
  const drag = useRef<Drag | null>(null);
  const write = (box: HTMLElement, value: string) => (value === '' ? box.style.removeProperty(cssVar) : box.style.setProperty(cssVar, value));
  const end = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    d.handle.classList.remove('on');
    document.documentElement.classList.remove('resizing');
    if (commit && d.px !== d.from) dispatch({ id: 'ui.pane', pane, px: d.px });
    else write(d.box, d.before);
  };
  // 押したまま境目が消えたとき（押したまま B で右の列をたたんだなど）も、ドラッグ中のカーソルと幅を残さない
  useEffect(() => () => end(false), []);
  return (
    <div
      className="ph"
      role="separator"
      aria-orientation="vertical"
      aria-label={`${name}の幅を変更`}
      title="ドラッグで幅を変更できます。ダブルクリックで元の幅に戻ります。"
      style={side === 'left' ? { left: `calc(var(${cssVar}) - 3px)` } : { right: `calc(var(${cssVar}) - 3px)` }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const handle = e.currentTarget;
        const box = handle.parentElement!;
        const h = handle.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const edge = h.left + h.width / 2;
        const from = Math.round(side === 'left' ? edge - b.left : b.right - edge);
        drag.current = { handle, box, x: e.clientX, from, px: from, before: box.style.getPropertyValue(cssVar) };
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('on');
        document.documentElement.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const px = paneWidth(pane, d.from + (side === 'left' ? e.clientX - d.x : d.x - e.clientX), window.innerWidth);
        if (px === d.px) return;
        d.px = px;
        write(d.box, paneValue(pane, px));
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onLostPointerCapture={() => end(false)}
      onDoubleClick={() => dispatch({ id: 'ui.pane', pane, px: null })}
    />
  );
}
