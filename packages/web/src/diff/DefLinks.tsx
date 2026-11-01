// 名前から定義へ（設計書 3.6。2026-10-29。見本を比べて決めた）。包んだ所（差分一覧の列・目的ごとのプレビュー・コースのコード欄・定義の引き出し）だけ、行の名前（Analysis.defs）を
// TokenSpans に渡し、⌘+クリック（Windows・Linux は Ctrl+クリック）で def.go を出す（原則 6）。ほかの画面は包まないので名前は切り出さない。
// ⌘ を押している間だけ、ルートに defkeys を付けて、移れる名前にマウスを乗せると下線を出す（styles.css）
import type { Definitions } from '@ondina/model';
import { createContext, useContext, useEffect, useMemo, type MouseEvent, type ReactNode } from 'react';
import type { Command } from '../commands/commands.js';
import { defIndex, type DefIndex, type DefName, type DefSide } from '../defs.js';

/** 行の場所。back は差分の列の行のとき、その行の見え方（戻り先） */
export interface DefAt {
  side: DefSide;
  path: string;
  line: number;
  back?: { path: string; side: 'LEFT' | 'RIGHT'; line: number };
}

interface DefLinksValue {
  index: DefIndex;
  dispatch: (c: Command) => void;
}

const DefContext = createContext<DefLinksValue | null>(null);

export function DefLinks({ defs, dispatch, children }: { defs: Definitions | undefined; dispatch: (c: Command) => void; children: ReactNode }) {
  const index = defIndex(defs);
  const value = useMemo(() => (index === null ? null : { index, dispatch }), [index, dispatch]);
  return <DefContext.Provider value={value}>{children}</DefContext.Provider>;
}

/** その行の名前と、押したときの動き。包まれていない・行の場所が無ければ null */
export function useDefNames(at: DefAt | undefined): { names: readonly DefName[]; go: (e: MouseEvent, col: number, name: string) => void } | null {
  const ctx = useContext(DefContext);
  if (ctx === null || at === undefined) return null;
  const names = ctx.index.names(at.side, at.path, at.line);
  if (names.length === 0) return null;
  return {
    names,
    go: (e, col, name) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      ctx.dispatch({ id: 'def.go', side: at.side, path: at.path, line: at.line, col, name, ...(at.back ? { back: at.back } : {}) });
    },
  };
}

/** ⌘ / Ctrl を押している間、ルートに defkeys。窓を離れたら外す（押したまま別の窓に移ると keyup が来ない） */
export function useHeldModifier(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const root = document.documentElement;
    const set = (held: boolean) => root.classList.toggle('defkeys', held);
    const onKey = (e: KeyboardEvent) => set(e.metaKey || e.ctrlKey);
    const onMove = (e: globalThis.MouseEvent) => {
      if (root.classList.contains('defkeys') !== (e.metaKey || e.ctrlKey)) set(e.metaKey || e.ctrlKey);
    };
    const off = () => set(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('blur', off);
      off();
    };
  }, [on]);
}
