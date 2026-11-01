import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetOs } from './osAppearance.js';

afterEach(resetOs);

// jsdom はレイアウトしないので offsetHeight / getBoundingClientRect が常に 0 になり、
// 仮想リスト（@tanstack/react-virtual）が 1 行も描かない。スクロール要素（.dscroll）と仮想行（.vrow）にだけ寸法を与える。
// 本番コードはブラウザの実測を使う。
const rectOf = (el: HTMLElement): { width: number; height: number } | null => {
  if (el.classList.contains('dscroll')) return { width: 1200, height: 900 };
  if (el.classList.contains('vrow')) return { width: 1200, height: el.querySelector('.hh, .fh') ? 34 : 21 };
  return null;
};
const originalRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
  const r = rectOf(this);
  if (!r) return originalRect.call(this);
  return { x: 0, y: 0, top: 0, left: 0, right: r.width, bottom: r.height, ...r, toJSON: () => ({}) } as DOMRect;
};
for (const [prop, axis] of [
  ['offsetWidth', 'width'],
  ['offsetHeight', 'height'],
] as const) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)!;
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get(this: HTMLElement) {
      return rectOf(this)?.[axis] ?? (original.get!.call(this) as number);
    },
  });
}

// jsdom はスクロールもしない（要素の scrollTo が無く、scrollHeight と clientHeight が 0）。差分一覧はファイルをまたいで 1 本の列なので（2026-10-20）、
// 押したファイルの行を描かせるには動かす必要がある。.dscroll だけ、scrollTo で scrollTop を動かし、ブラウザと同じく scroll を後から送る。
// スクロールできる高さは中身（.dbody）の高さ、見える高さは rectOf と同じ 900
for (const [prop, of] of [
  ['scrollHeight', (el: Element) => parseFloat((el.querySelector(':scope > .dbody') as HTMLElement | null)?.style.height ?? '') || 0],
  ['clientHeight', () => 900],
] as const) {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, prop)!;
  Object.defineProperty(Element.prototype, prop, {
    configurable: true,
    get(this: Element) {
      return this.classList.contains('dscroll') ? of(this) : (original.get!.call(this) as number);
    },
  });
}
HTMLElement.prototype.scrollTo = function (this: HTMLElement, to?: ScrollToOptions | number) {
  if (!this.classList.contains('dscroll') || typeof to !== 'object' || to.top === undefined) return;
  this.scrollTop = Math.max(0, Math.min(this.scrollHeight - this.clientHeight, to.top));
  setTimeout(() => this.dispatchEvent(new Event('scroll')), 0);
};
