// 横の列の幅（2026-10-20）。列ごとの違い（画面での列の名前・幅を持つ CSS 変数・どちらの端の列か・幅の範囲）はこの表だけに置く。
// 保存した幅（ui.json の panes）はグリッドのコンテナの style の CSS 変数に入れる。保存していない列は styles.css の既定の幅のまま
import type { PaneId, UiSettings } from '@ondina/model';
import type { CSSProperties } from 'react';

interface Pane {
  /** 画面での列の名前。境目の読み上げの名前（「〜の幅を変更」）に使う。停留所の画面は境目が 2 つ並ぶので、列ごとに違う名前にする */
  name: string;
  /** 列の幅を持つ CSS 変数（styles.css でグリッドのコンテナに既定の幅を置いている） */
  cssVar: `--${string}`;
  /** コンテナのどちらの端の列か。境目はこの列の内側の端に出す */
  side: 'left' | 'right';
  /** 狭めても残す幅（px）。見出しが崩れない幅を実物で測って決めた（停留所の左は 240px 未満で「n ファイル」が折り返す） */
  min: number;
  /** 広げられる上限（窓の幅の %）。窓を狭めたときに真ん中の列が潰れないように */
  maxVw: number;
}

export const PANES: Record<PaneId, Pane> = {
  stopTree: { name: 'ファイルの列', cssVar: '--lt-w', side: 'left', min: 240, maxVw: 30 },
  stopGuide: { name: '水先案内の列', cssVar: '--say-w', side: 'right', min: 280, maxVw: 35 },
  diffTree: { name: 'ファイルの列', cssVar: '--tree-w', side: 'left', min: 220, maxVw: 50 },
};

/** 保存した幅を描く値（CSS 変数の中身） */
export const paneValue = (id: PaneId, px: number): string => `clamp(${PANES[id].min}px, ${px}px, ${PANES[id].maxVw}vw)`;

/** コンテナの style。保存していない列（と手で書き換えて数でなくなった列）は入れない */
export function paneStyle(panes: UiSettings['panes'], ids: readonly PaneId[]): CSSProperties {
  const style: Record<string, string> = {};
  for (const id of ids) {
    const px = panes?.[id];
    if (typeof px === 'number' && Number.isFinite(px)) style[PANES[id].cssVar] = paneValue(id, px);
  }
  return style;
}

/** ドラッグ中の幅（px の整数）。描くときと同じ範囲に収め、見えている幅を保存する */
export function paneWidth(id: PaneId, px: number, viewport: number): number {
  const { min, maxVw } = PANES[id];
  return Math.round(Math.max(min, Math.min(px, (viewport * maxVw) / 100)));
}
