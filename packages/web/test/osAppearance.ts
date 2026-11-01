// jsdom には matchMedia が無い。OS の外観（prefers-color-scheme）だけを持つ偽物を置き、テストは setOsDark で OS の切り替えを起こす。
// 既定はライト。setup.ts がテストごとにライトへ戻す
const DARK_QUERY = '(prefers-color-scheme: dark)';
type Listener = (e: MediaQueryListEvent) => void;

let dark = false;
const listeners = new Set<Listener>();

/** OS の外観を変え、ブラウザと同じく change を送る */
export function setOsDark(next: boolean): void {
  dark = next;
  for (const l of listeners) l({ matches: next, media: DARK_QUERY } as MediaQueryListEvent);
}

/** change を送らずにライトへ戻す（画面を片付けた後に呼ぶ） */
export function resetOs(): void {
  dark = false;
}

window.matchMedia = (media: string): MediaQueryList => {
  const tracked = media === DARK_QUERY;
  return {
    media,
    get matches() {
      return tracked && dark;
    },
    onchange: null,
    addEventListener: (_type: string, l: Listener) => {
      if (tracked) listeners.add(l);
    },
    removeEventListener: (_type: string, l: Listener) => {
      listeners.delete(l);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
};
