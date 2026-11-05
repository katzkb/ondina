// コースの停留所のコード（設計書 3.3）: 変わった行から離れた行は帯にまとめる（2026-10-13。差分一覧と同じ帯）。
// 見ている hunk の中も畳む。今の「前後 3 行」の範囲の外のメモ・AI の下書きは帯に数を出す（範囲の中なら畳まない）。
import type { Analysis, CommentDraft, Hunk, TokenLine } from '@ondina/model';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FileView } from '../src/diff/FileView.js';
import { NO_MEMO } from '../src/state/reducer.js';
import { fixtureAnalysis } from './fixture.js';

const PATH = 'A.kt';
// head 30 行。1〜10 行目は hunk の外、11〜30 行目が hunk h1（変わらない 8 行 → 19 行目の置き換え → 変わらない 11 行）
const headText = Array.from({ length: 30 }, (_, k) => (k + 1 === 19 ? 'new19' : `l${k + 1}`));
const tokens: TokenLine[] = headText.map((t) => [[t, null, 0]]);
const h1: Hunk = {
  id: 'h1', path: PATH, lang: 'kotlin', symbol: 'Big', symbolFqName: 'Big', symbolKind: 'class', kind: 'core', kindProvenance: 'ast', hows: [1], n: 1, lnOld: 11, lnNew: 11,
  lines: [...headText.slice(10, 18).map((t) => ` ${t}`), '-old19', '+new19', ...headText.slice(19).map((t) => ` ${t}`)],
};
const analysis = (): Analysis => ({ ...fixtureAnalysis(), hunks: [h1], files: [{ path: PATH, tokens }] });
const memo = (id: string, line: number): CommentDraft => ({ id, path: PATH, line, side: 'RIGHT', body: `本文 ${id}`, source: 'reviewer', state: 'adopted' });
const memoProp = (comments: CommentDraft[]) => ({ comments, ui: NO_MEMO, githubDiff: undefined, draftText: {} });
const bands = (c: HTMLElement) => [...c.querySelectorAll('.fold .fl')].map((e) => e.textContent);
const keys = (...ks: Array<string | [string, number, number]>) => ks.flatMap((k) => (typeof k === 'string' ? [k] : Array.from({ length: k[2] - k[1] + 1 }, (_, i) => `${k[0]}${k[1] + i}`)));

describe('FileView の検索', () => {
  it.each(['uni', 'sbs'] as const)('%s: 見つかった行は全部帯から出し、文字に印と件数を出す。閉じると印と欄を消す', (mode) => {
    const props = { analysis: analysis(), path: PATH, hunkId: 'h1', symbol: undefined, full: false, mode, viewed: [], dispatch: vi.fn() };
    const find = { open: true, query: 'l2', at: -1, n: 1 };
    const { container, rerender } = render(<FileView {...props} find={find} />);
    expect(screen.getByRole('searchbox', { name: 'このファイルの中を検索' })).toHaveValue('l2');
    expect(screen.getByText('11 / 11')).toBeInTheDocument();
    expect(container.querySelectorAll('mark')).toHaveLength(11);
    expect(container.querySelector('mark.cur')?.closest('.mrow')).toHaveTextContent('l29');
    if (mode === 'sbs') expect(container.querySelector('mark')?.closest('.mside')?.previousElementSibling).not.toBeNull();
    rerender(<FileView {...props} find={{ ...find, open: false }} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(container.querySelector('mark')).toBeNull();
    expect(container.querySelector('.fv-body')).not.toHaveTextContent('l29');
  });

  it.each([['old19', 'r', false], ['new19', 'a', true]] as const)('左右: %s の印はその文字のある側だけ', (query, cls, right) => {
    const { container } = render(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full mode="sbs" viewed={[]} dispatch={() => {}} find={{ open: true, query, at: 0, n: 1 }} />);
    const hits = container.querySelectorAll('mark');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.closest('.cd')).toHaveClass(cls);
    expect(hits[0]?.closest('.mside')?.previousElementSibling !== null).toBe(right);
  });

  it('今の印へ真ん中にスクロールする。件数で回ったとき・同じ件を開き直したときも動く', () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    const scroll = vi.fn(function (this: Element) { scrolled.push(this); });
    Element.prototype.scrollIntoView = scroll;
    try {
      const props = { analysis: analysis(), path: PATH, hunkId: 'h1', symbol: undefined, full: false, mode: 'uni' as const, viewed: [], dispatch: vi.fn() };
      const find = { open: true, query: 'l2', at: 0, n: 1 };
      const { container, rerender } = render(<FileView {...props} find={find} />);
      expect(scrolled.at(-1)).toBe(container.querySelector('mark.cur'));
      scroll.mockClear();
      rerender(<FileView {...props} find={{ ...find, at: 11 }} />);
      expect(scroll).toHaveBeenCalledWith({ block: 'center' });
      scroll.mockClear();
      rerender(<FileView {...props} find={{ ...find, at: 11, n: 2 }} />);
      expect(scroll).toHaveBeenCalledWith({ block: 'center' });
      rerender(<FileView {...props} find={{ ...find, query: 'old19' }} />);
      expect(scrolled.at(-1)).toBe(container.querySelector('mark.cur'));
      expect(scrolled.at(-1)).toHaveTextContent('old19');
    } finally {
      if (original) Element.prototype.scrollIntoView = original;
      else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });
});

describe('FileView の帯（変わった行から離れた行）', () => {
  it('見ている hunk の中の変わらない行も畳む。ファイルの先頭の帯は ↑ だけ、末尾の帯は ↓ だけ', () => {
    const dispatch = vi.fn();
    const { container } = render(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={dispatch} />);
    expect(bands(container)).toEqual(['⋯ 15 行', '⋯ 8 行']);
    expect(container.querySelector('.fv-body')!.textContent).not.toContain('l12');
    fireEvent.click(screen.getByRole('button', { name: '上へ 15 行表示' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'fold.open', path: PATH, keys: keys(['n', 1, 10], ['h1:', 0, 4]) });
    fireEvent.click(screen.getByRole('button', { name: '下へ 8 行表示' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'fold.open', path: PATH, keys: keys(['h1:', 13, 20]) });
  });

  it('開いた行（open）は出す。ファイル全体（full）なら帯を出さない', () => {
    const { container, rerender } = render(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} open={keys(['h1:', 13, 20])} />);
    expect(bands(container)).toEqual(['⋯ 15 行']);
    rerender(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full mode="uni" viewed={[]} dispatch={() => {}} />);
    expect(container.querySelector('.fold')).toBeNull();
  });

  it('前後 3 行の範囲の中のメモの行は畳まない（前後も残す）。範囲の外のメモは帯に「メモ n」', () => {
    const { container } = render(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} memo={memoProp([memo('near', 12), memo('far', 2)])} />);
    expect(bands(container)).toEqual(['⋯ 8 行 · メモ 1', '⋯ 8 行']);
    expect(container.querySelector('[data-memo="near"]')).not.toBeNull();
    expect(container.querySelector('[data-memo="far"]')).toBeNull();
  });

  it('左右でも同じ帯。「+」の行の並び（order）は畳む前のファイルの行の位置', () => {
    const dispatch = vi.fn();
    const { container } = render(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="sbs" viewed={[]} dispatch={dispatch} memo={memoProp([])} />);
    expect(bands(container)).toEqual(['⋯ 15 行', '⋯ 8 行']);
    fireEvent.mouseDown(screen.getByRole('button', { name: '20 行目にメモ' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'memo.pick', path: PATH, side: 'RIGHT', line: 20, order: 20 });
  });

  it('GitHub の差分に出ない行は点線の「?」（…について聞く）、出る行は「+」。押したときはどちらも memo.pick。選ぶと聞く枠', () => {
    // GitHub の差分の塊は head 16〜22 行目（19 行目の前後 3 行）
    const githubDiff = [{ path: PATH, hunks: [{ oldStart: 16, oldLines: 7, newStart: 16, newLines: 7 }] }];
    const dispatch = vi.fn();
    const props = { analysis: analysis(), path: PATH, hunkId: 'h1', symbol: undefined, full: true, mode: 'uni' as const, viewed: [], dispatch };
    const { container, rerender } = render(<FileView {...props} memo={{ ...memoProp([]), githubDiff }} />);
    expect(screen.getByRole('button', { name: '20 行目にメモ' })).toHaveTextContent('+');
    const ask = screen.getByRole('button', { name: '5 行目について聞く' });
    expect(ask).toHaveTextContent('?');
    expect(ask).toHaveAttribute('title', 'この行について聞く（GitHub の差分に出ないので、メモは書けません）');
    expect(screen.queryByRole('button', { name: '5 行目にメモ' })).toBeNull();
    fireEvent.mouseDown(ask);
    expect(dispatch).toHaveBeenCalledWith({ id: 'memo.pick', path: PATH, side: 'RIGHT', line: 5, order: 4 });
    const at = { side: 'RIGHT' as const, line: 5, order: 4 };
    rerender(<FileView {...props} memo={{ ...memoProp([]), githubDiff, ui: { ...NO_MEMO, pick: { path: PATH, anchor: at, head: at } } }} />);
    const box = container.querySelector('.fv-body .mbox.edit') as HTMLElement;
    expect(box.querySelector('.mh')!.textContent).toBe('聞くA.kt 5 行目');
    expect(box.querySelector('textarea')).toBeNull();
    expect(box.querySelector('.mnote')!.textContent).toBe('この行は GitHub の差分に出ないので、メモは書けません。案内人に聞くことはできます');
  });

  it('「+」を押したままなぞると、入った行で memo.drag。左右では入った列の行（左の変わらない行は右と同じ head 側の行）', () => {
    const dispatch = vi.fn();
    const ui = { ...NO_MEMO, pick: { path: PATH, anchor: { side: 'RIGHT' as const, line: 17, order: 16 }, head: { side: 'RIGHT' as const, line: 17, order: 16 } }, drag: true };
    const { container } = render(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="sbs" viewed={[]} dispatch={dispatch} memo={{ ...memoProp([]), ui }} />);
    const cellOf = (name: string) => screen.getByRole('button', { name }).closest('.mside')!;
    fireEvent.mouseEnter(cellOf('base 19 行目にメモ'));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'memo.drag', path: PATH, side: 'LEFT', line: 19, order: 18 });
    fireEvent.mouseEnter(cellOf('20 行目にメモ'));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'memo.drag', path: PATH, side: 'RIGHT', line: 20, order: 20 });
    // 20 行目の左の列（変わらない行の写し。「+」は無い）
    fireEvent.mouseEnter(cellOf('20 行目にメモ').previousElementSibling!);
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'memo.drag', path: PATH, side: 'RIGHT', line: 20, order: 20 });
    // なぞっている間は書く枠を出さない
    expect(container.querySelector('.mbox.edit')).toBeNull();
    expect(container.querySelectorAll('.cd.msel').length).toBeGreaterThan(0);
  });

  it('なぞっている間は、選んだ行のそばの帯を開かない（開くと行が下にずれて、なぞる先がずれる）。離すと開く', () => {
    // 16 行目（並び 15）は見えている行の一番上。選んで書く枠を開くと、その前後 3 行も残す
    const at = { side: 'RIGHT' as const, line: 16, order: 15 };
    const view = (drag: boolean) => <FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} memo={{ ...memoProp([]), ui: { ...NO_MEMO, pick: { path: PATH, anchor: at, head: at }, drag } }} />;
    const { container, rerender } = render(view(true));
    expect(bands(container)).toEqual(['⋯ 15 行', '⋯ 8 行']);
    rerender(view(false));
    expect(bands(container)).toEqual(['⋯ 12 行', '⋯ 8 行']);
  });

  it('なぞっている間、hold があれば元の書く枠の場所に同じ高さの空きを出し、その帯も開いたままにする（離すまで行をずらさない）', () => {
    const old = { side: 'RIGHT' as const, line: 16, order: 15 };
    const now = { side: 'RIGHT' as const, line: 25, order: 25 };
    const ui = { ...NO_MEMO, pick: { path: PATH, anchor: now, head: now }, drag: true, hold: { pick: { path: PATH, anchor: old, head: old }, editing: null, height: 150 } };
    const { container } = render(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} memo={{ ...memoProp([]), ui }} />);
    expect(container.querySelector('.mbox.edit')).toBeNull();
    const hold = container.querySelectorAll<HTMLElement>('.mhold');
    expect(hold.length).toBe(1);
    expect(hold[0]!.style.height).toBe('150px');
    expect(bands(container)).toEqual(['⋯ 12 行', '⋯ 8 行']);
  });

  it('直す枠を開いたまま押したときは、そのメモの代わりに同じ高さの空きを出す', () => {
    const now = { side: 'RIGHT' as const, line: 25, order: 25 };
    const ui = { ...NO_MEMO, pick: { path: PATH, anchor: now, head: now }, drag: true, hold: { pick: null, editing: 'm1', height: 90 } };
    const { container } = render(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} memo={{ ...memoProp([memo('m1', 19)]), ui }} />);
    expect(container.querySelector('[data-memo="m1"] .mhold')?.getAttribute('style')).toContain('height: 90px');
    expect(container.textContent).not.toContain('本文 m1');
  });

  it('統合でも、なぞると入った行で memo.drag。なぞっていなければ何も送らない', () => {
    const dispatch = vi.fn();
    const pick = { path: PATH, anchor: { side: 'RIGHT' as const, line: 17, order: 16 }, head: { side: 'RIGHT' as const, line: 17, order: 16 } };
    const view = (drag: boolean) => <FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={dispatch} memo={{ ...memoProp([]), ui: { ...NO_MEMO, pick, drag } }} />;
    const { container, rerender } = render(view(false));
    const rowOf = (name: string) => screen.getByRole('button', { name }).closest('.mrow')!;
    fireEvent.mouseEnter(rowOf('20 行目にメモ'));
    expect(dispatch).not.toHaveBeenCalled();
    expect(container.querySelector('.mbox.edit')).not.toBeNull();
    rerender(view(true));
    fireEvent.mouseEnter(rowOf('base 19 行目にメモ'));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'memo.drag', path: PATH, side: 'LEFT', line: 19, order: 18 });
    expect(container.querySelector('.mbox.edit')).toBeNull();
  });

  it('hunk の見出しへのスクロール先（id）は、見えている最初の行の 1 つだけ', () => {
    const { container } = render(<FileView analysis={analysis()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="sbs" viewed={[]} dispatch={() => {}} />);
    expect(container.querySelectorAll('#hunk-h1')).toHaveLength(1);
  });

  it('差分の無い停留所の中心の行が 2 つの hunk の変わらない行に重なれば、その hunk ごとに 1 つずつ id', () => {
    // h2: 3 行目の後に 1 行足す（head の 4 行目）。h3: 25 行目の後に 1 行足す（head の 26 行目）。中心の行は h2 の 3 行目と h3 の 25 行目
    const h2: Hunk = { ...h1, id: 'h2', lnOld: 3, lnNew: 3, lines: [' l3', '+l4'] };
    const h3: Hunk = { ...h1, id: 'h3', lnOld: 24, lnNew: 25, lines: [' l25', '+l26'] };
    const a: Analysis = { ...analysis(), hunks: [h2, h3] };
    const symbol = { excerpt: [{ start: 1, lines: [], centers: [3, 25] }] } as unknown as Parameters<typeof FileView>[0]['symbol'];
    const { container } = render(<FileView analysis={a} path={PATH} hunkId={null} symbol={symbol} full={false} mode="uni" viewed={[]} dispatch={() => {}} />);
    expect(container.querySelectorAll('#hunk-h2')).toHaveLength(1);
    expect(container.querySelectorAll('#hunk-h3')).toHaveLength(1);
  });
});

describe('FileView の読む場所（コースの同じファイルの 2 か所以上。2026-10-19）', () => {
  // head 40 行。h1 は 5〜7 行目（6 行目の置き換え）、h2 は 30〜32 行目（31 行目の置き換え）
  const text = Array.from({ length: 40 }, (_, k) => (k + 1 === 6 ? 'new6' : k + 1 === 31 ? 'new31' : `l${k + 1}`));
  const hunk = (id: string, at: number): Hunk => ({
    id, path: PATH, lang: 'kotlin', symbol: id, symbolFqName: id, symbolKind: 'function', kind: 'core', kindProvenance: 'ast', hows: [1], n: 1, lnOld: at - 1, lnNew: at - 1,
    lines: [` l${at - 1}`, `-old${at}`, `+new${at}`, ` l${at + 1}`],
  });
  const two = (): Analysis => ({ ...fixtureAnalysis(), hunks: [hunk('h1', 6), hunk('h2', 31)], files: [{ path: PATH, tokens: text.map((t) => [[t, null, 0]]) }] });
  const places = [
    { hunkId: 'h1', k: 0, seen: false, test: false, name: 'A.first' },
    { hunkId: 'h2', k: 3, seen: false, test: false, name: 'A.second' },
  ];
  const dots = (c: HTMLElement) => [...c.querySelectorAll('.pdot')].map((d) => d.textContent);

  it('同じファイルのほかの場所も変わった行を畳まずに出し、各場所の最初の行に読む順の番号の丸。帯に「このファイルの n / m か所目」', () => {
    const { container, rerender } = render(<FileView analysis={two()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} />);
    expect(container.querySelector('.fv-body')!.textContent).not.toContain('new31');
    rerender(<FileView analysis={two()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} places={places} />);
    expect(container.querySelector('.fv-body')!.textContent).toContain('new31');
    expect(dots(container)).toEqual(['1', '4']);
    expect(container.querySelector('.pdot.cur')!.textContent).toBe('1');
    expect(container.querySelector('.filebar')!.textContent).toContain('このファイルの 1 / 2 か所目');
    rerender(<FileView analysis={two()} path={PATH} hunkId="h2" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} places={[{ ...places[0]!, seen: true }, places[1]!]} />);
    expect(dots(container)).toEqual(['✓', '4']);
    expect(container.querySelector('.pdot.cur')!.textContent).toBe('4');
    expect(container.querySelector('.filebar')!.textContent).toContain('このファイルの 2 / 2 か所目');
  });

  it('番号の丸を押すとその場所へ（course.jump）。左右でも丸を出す', () => {
    const dispatch = vi.fn();
    render(<FileView analysis={two()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="sbs" viewed={[]} dispatch={dispatch} places={places} />);
    fireEvent.click(screen.getByRole('button', { name: '4 か所目: A.second' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'course.jump', i: 3 });
  });

  it('そのファイルの場所が 1 つなら、丸も「か所目」も出さない', () => {
    const { container } = render(<FileView analysis={two()} path={PATH} hunkId="h1" symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} places={[places[0]!]} />);
    expect(dots(container)).toEqual([]);
    expect(container.querySelector('.filebar')!.textContent).not.toContain('か所目');
  });
});

describe('FileView の覗いているファイル（all。2026-10-20）', () => {
  // head 40 行。h1 は 6 行目、h2 は 31 行目の置き換え
  const text = Array.from({ length: 40 }, (_, k) => (k + 1 === 6 ? 'new6' : k + 1 === 31 ? 'new31' : `l${k + 1}`));
  const hunk = (id: string, at: number): Hunk => ({
    id, path: PATH, lang: 'kotlin', symbol: id, symbolFqName: id, symbolKind: 'function', kind: 'core', kindProvenance: 'ast', hows: [1], n: 1, lnOld: at - 1, lnNew: at - 1,
    lines: [` l${at - 1}`, `-old${at}`, `+new${at}`, ` l${at + 1}`],
  });
  const two = (): Analysis => ({ ...fixtureAnalysis(), hunks: [hunk('h1', 6), hunk('h2', 31)], files: [{ path: PATH, tokens: text.map((t) => [[t, null, 0]]) }] });

  it('どの差分も薄くせず、変わった行の前後以外を畳む。差分の無い停留所の「位置なし」は出さない', () => {
    const { container } = render(<FileView analysis={two()} path={PATH} hunkId={null} all symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} />);
    const body = container.querySelector('.fv-body')!;
    expect(body.textContent).toContain('new6');
    expect(body.textContent).toContain('new31');
    expect(body.querySelector('.o')).toBeNull();
    expect(container.querySelectorAll('.fold').length).toBeGreaterThan(0);
    expect(body.textContent).not.toContain('l20');
    expect(container.querySelector('.filebar')!.textContent).not.toContain('位置なし');
  });

  it('答えの行（focusLine）は差分から離れていても畳まずに出す', () => {
    const { container } = render(<FileView analysis={two()} path={PATH} hunkId={null} all symbol={undefined} full={false} mode="uni" viewed={[]} dispatch={() => {}} focusLine={{ path: PATH, side: 'RIGHT', line: 20, n: 1 }} />);
    expect(container.querySelector('.mrow.lflash')!.textContent).toContain('l20');
  });
});

describe('行の中の変わった語（2026-10-30。差分一覧と同じ塗り方）', () => {
  it.each(['sbs', 'uni'] as const)('%s: コースの画面のファイルでも、組になった行の変わった語だけを塗る', (mode) => {
    const a = fixtureAnalysis();
    const h = a.hunks.find((x) => x.path.endsWith('OrderAdminView.kt'))!;
    const { container } = render(<FileView analysis={a} path={h.path} hunkId={h.id} symbol={undefined} full={false} mode={mode} viewed={[]} dispatch={() => {}} />);
    const painted = (sel: string) => [...container.querySelectorAll(sel)].map((e) => e.textContent).join('');
    expect(painted('.cd.r .wd')).toBe('getDiscount()');
    expect(painted('.cd.a .wd')).toBe('discount');
  });
});
