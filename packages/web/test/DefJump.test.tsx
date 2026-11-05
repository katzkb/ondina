// 名前から定義へ（設計書 3.6。2026-10-29。見本を比べて「右に出す」にした）。差分一覧・コース・目的ごとの画面で名前を ⌘+クリックする。
// 差分の無いファイルの定義は右の引き出し（⇧R で大きく、Esc で閉じる）、コード欄に出ている行の定義はそこへ動かして「← 戻る」が押せるようになる
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { fakeApi } from './fakeApi.js';
import { fixtureAnalysis } from './fixture.js';

vi.mock('../src/map/elk.js', async () => {
  const ELK = (await import('elkjs/lib/elk.bundled.js')).default;
  const elk = new ELK();
  return { workerElk: () => elk };
});

afterEach(cleanup);

async function renderDiffList(analysis = fixtureAnalysis()) {
  const r = render(<App api={fakeApi(analysis).api} />);
  await screen.findByLabelText('入口');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /^差分一覧/ }));
  });
  return r;
}

/** 差分の列で、その文字の名前（右の列 = head 側の最後の 1 つ）。列の最初のファイルは admin/OrderAdminView.kt */
const nameIn = (container: HTMLElement, text: string) => [...container.querySelectorAll<HTMLElement>('.dscroll .dj')].filter((e) => e.textContent === text).at(-1);

const cmdClick = async (el: HTMLElement, init: { metaKey?: boolean; ctrlKey?: boolean } = { metaKey: true }) => {
  await act(async () => {
    fireEvent.click(el, init);
  });
};

describe('差分一覧の名前から定義へ', () => {
  it('検索した後で引き出しを大きくしても、定義の行へ戻さない', async () => {
    const original = Element.prototype.scrollIntoView;
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
    try {
      const { container } = await renderDiffList();
      await cmdClick(nameIn(container, 'Money')!);
      fireEvent.keyDown(window, { key: 'f', metaKey: true });
      fireEvent.change(screen.getByRole('searchbox', { name: 'このファイルの中を検索' }), { target: { value: 'package' } });
      const hit = container.querySelector('.defdrawer mark.cur');
      expect(hit).not.toBeNull();
      expect(scrolled.at(-1)).toBe(hit);
      fireEvent.keyDown(window, { key: 'R', shiftKey: true });
      expect(screen.getByRole('dialog', { name: '定義' })).toBeInTheDocument();
      expect(scrolled.at(-1)).toBe(hit);
    } finally {
      if (original) Element.prototype.scrollIntoView = original;
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('定義の引き出しが開いている間の ⌘F はファイルの中を探し、背後の差分の検索欄は出さない', async () => {
    const { container } = await renderDiffList();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(screen.getByRole('searchbox', { name: '差分の中を検索' })).toBeInTheDocument();
    await cmdClick(nameIn(container, 'Money')!);
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    const drawer = screen.getByRole('complementary', { name: '定義' });
    const input = within(drawer).getByRole('searchbox', { name: 'このファイルの中を検索' });
    fireEvent.change(input, { target: { value: 'package' } });
    expect(within(drawer).getByText('1 / 1')).toBeInTheDocument();
    expect(drawer.querySelector('mark.cur')).toHaveTextContent('package');
    expect(container.querySelector('.dscroll .dfind')).toBeNull();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(drawer).queryByRole('searchbox')).toBeNull();
    expect(drawer).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: '定義' })).toBeNull();
  });

  it('移れる名前だけ押せる形（dj）にする。⌘ を押さずに押しても何もしない', async () => {
    const { container } = await renderDiffList();
    const money = nameIn(container, 'Money');
    expect(money).toBeDefined();
    // 宣言の名前（自分自身）は移れない
    expect(nameIn(container, 'OrderAdminView')).toBeUndefined();
    await cmdClick(money!, {});
    expect(screen.queryByRole('complementary', { name: '定義' })).toBeNull();
  });

  it('差分の無いファイルの定義は右の引き出しにファイル全体を出し、定義の行を光らせる。⇧R で大きく、Esc で閉じる', async () => {
    const { container } = await renderDiffList();
    await cmdClick(nameIn(container, 'Money')!);
    const drawer = screen.getByRole('complementary', { name: '定義' });
    expect(within(drawer).getByText('Money', { selector: 'b' })).toBeInTheDocument();
    expect(within(drawer).getByText('src/main/kotlin/com/example/order/domain/Money.kt:4')).toBeInTheDocument();
    expect(within(drawer).getByText('名前を ⌘+クリックで続けて移動')).toBeInTheDocument();
    // 定義の行（4 行目）を光らせる
    const lit = drawer.querySelector('.mrow.lflash');
    expect(lit?.querySelectorAll('.ln')[1]?.textContent).toBe('4');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'R', shiftKey: true });
    });
    expect(screen.getByRole('dialog', { name: '定義' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: '定義' })).toBeNull();
  });

  it('引き出しの中の名前も ⌘+クリックで続けて移り、「← 前の定義」で戻る', async () => {
    const { container } = await renderDiffList();
    await cmdClick(nameIn(container, 'Money')!);
    const drawer = () => screen.getByRole('complementary', { name: '定義' });
    // Money.kt の中の名前（Long などライブラリでない名前）を押す
    const inner = [...drawer().querySelectorAll<HTMLElement>('.dj')];
    expect(inner.length).toBeGreaterThan(0);
    const rate = inner.find((e) => e.textContent === 'Rate');
    expect(rate).toBeDefined();
    await cmdClick(rate!);
    expect(within(drawer()).getByText('Rate', { selector: 'b' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: /← 前の定義/ }));
    });
    expect(within(drawer()).getByText('Money', { selector: 'b' })).toBeInTheDocument();
  });

  it('差分の列の定義なら引き出しを開かず、「← 戻る」が押せるようになる。押すと戻り先が無くなる', async () => {
    const { container } = await renderDiffList();
    const back = screen.getByRole('button', { name: /← 戻る/ });
    expect(back).toBeDisabled();
    await cmdClick(nameIn(container, 'discount')!);
    expect(screen.queryByRole('complementary', { name: '定義' })).toBeNull();
    expect(back).toBeEnabled();
    await act(async () => {
      fireEvent.keyDown(window, { key: '[', metaKey: true });
    });
    expect(back).toBeDisabled();
  });
});

const CONTROLLER = 'src/main/kotlin/com/example/order/api/OrderController.kt';

/** その文字の名前（左右では右の列 = head 側の最後の 1 つ） */
const nameAt = (root: Element, text: string) => [...root.querySelectorAll<HTMLElement>('.dj')].filter((e) => e.textContent === text).at(-1);
/** 光らせた行の head の行番号（行番号の欄の直下の文字だけ。メモの印「+」「?」と確かめることの番号は除く） */
const litLine = (root: Element) =>
  [...(root.querySelector('.lflash')?.querySelectorAll('.ln') ?? [])]
    .map((e) => [...e.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').replace(/\D/g, ''))
    .filter((t) => t !== '')
    .at(-1);

describe('コースの画面の名前から定義へ', () => {
  /** コース 6 の最初の停留所（OrderController.apply）の画面 */
  async function renderStop() {
    const r = render(<App api={fakeApi(fixtureAnalysis()).api} />);
    await screen.findByLabelText('入口');
    fireEvent.click(r.container.querySelectorAll('.ccard .pick')[5]!);
    fireEvent.click(r.container.querySelector('.ccard.sel .go')!);
    fireEvent.click(r.container.querySelector('.brief .bgo .btn')!);
    expect(r.container.querySelector('.code .filebar .path')!.textContent).toBe(CONTROLLER);
    return r;
  }

  it('停留所のファイルの定義はその行へ移って光らせる（畳んだ行でも）。ファイルの帯の「← 戻る」・⌘[ で押した行へ', async () => {
    const { container } = await renderStop();
    const code = container.querySelector('.code')!;
    const back = within(code.querySelector<HTMLElement>('.filebar')!).getByRole('button', { name: /← 戻る/ });
    expect(back).toBeDisabled();
    await cmdClick(nameAt(code, 'useCase')!);
    expect(litLine(code)).toBe('13');
    expect(back).toBeEnabled();
    expect(screen.queryByRole('complementary', { name: '定義' })).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: '[', metaKey: true });
    });
    expect(litLine(code)).toBe('18');
    expect(back).toBeDisabled();
  });

  it('ほかのファイルの定義は右の引き出しに出す。停留所はそのまま', async () => {
    const { container } = await renderStop();
    const sym = container.querySelector('.code .chd .sym')!.textContent;
    await cmdClick(nameAt(container.querySelector('.code')!, 'save')!);
    const drawer = screen.getByRole('complementary', { name: '定義' });
    expect(within(drawer).getByText('src/main/kotlin/com/example/order/domain/OrderRepository.kt:5')).toBeInTheDocument();
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe(sym);
  });
});

describe('目的ごとの画面の名前から定義へ', () => {
  /** 目的ごとの画面で OrderController の差分を選んだところ */
  async function renderHow() {
    const analysis = fixtureAnalysis();
    const r = render(<App api={fakeApi(analysis).api} />);
    await screen.findByLabelText('入口');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^目的ごと/ }));
    });
    await act(async () => {
      fireEvent.click(r.container.querySelector(`[data-hunk="${analysis.hunks.find((h) => h.path === CONTROLLER)!.id}"]`)!);
    });
    return r;
  }

  it('プレビューのファイルの定義はその行へ移って光らせる。ヘッダの「← 戻る」が押せるようになる', async () => {
    const { container } = await renderHow();
    const preview = container.querySelector('.preview')!;
    const back = within(preview.querySelector<HTMLElement>('.hd')!).getByRole('button', { name: /← 戻る/ });
    expect(back).toBeDisabled();
    await cmdClick(nameAt(preview, 'useCase')!);
    expect(litLine(preview)).toBe('13');
    expect(back).toBeEnabled();
    expect(screen.queryByRole('complementary', { name: '定義' })).toBeNull();
  });

  it('ほかのファイルの定義は右の引き出しに出す', async () => {
    const { container } = await renderHow();
    await cmdClick(nameAt(container.querySelector('.preview')!, 'save')!);
    expect(within(screen.getByRole('complementary', { name: '定義' })).getByText('src/main/kotlin/com/example/order/domain/OrderRepository.kt:5')).toBeInTheDocument();
  });
});
