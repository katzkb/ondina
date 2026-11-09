import { flushSync } from 'react-dom';

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => unknown };

/** 描き直す前後で現在地の高さを保ち、対応するブラウザでは差分の移動を見せる。 */
export function withViewTransition(update: () => void, keep?: () => HTMLElement | null): void {
  const top = keep?.()?.getBoundingClientRect().top;
  const fixScroll = () => {
    const element = keep?.();
    if (top === undefined || !element) return;
    const container = element.closest<HTMLElement>('.req-center');
    if (container) container.scrollTop += element.getBoundingClientRect().top - top;
  };
  const change = () => { flushSync(update); fixScroll(); };
  const doc: TransitionDocument = document;
  if (!doc.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) change();
  else doc.startViewTransition(change);
}
