// diff 列（設計書 3.4）。hunk 要素は hunk-<id>（18.5）、行番号、追加・削除の背景、対の無い側は斜線（x）。
import type { CommentDraft, FileText, Hunk, TokenLine } from '@ondina/model';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiffPane } from '../src/components/DiffPane.js';
import { DiffList } from '../src/diff/DiffList.js';
import { FILE_HEAD_H } from '../src/diff/follow.js';
import { buildFileRows } from '../src/diff/rows.js';
import type { MemoUi } from '../src/state/reducer.js';
import css from '../src/styles.css?raw';
import { fixtureFiles, fixtureHunks } from './fixture.js';

const hunk = (): Hunk => {
  const h: Hunk = { ...fixtureHunks()[0]!, lnOld: 7, lnNew: 9, lines: [' a', '-b', '-c', '+d'] };
  delete h.tokens; // プレーンテキストの経路を見る
  return h;
};

describe('DiffList', () => {
  it('左右: hunk ヘッダに hunk-<id> と @@ symbol、削除行と追加行が対になり余りは x', () => {
    const h = hunk();
    const { container } = render(<DiffList hunks={[h]} mode="sbs" viewed={[]} selectedHunk={h.id} dispatch={() => {}} />);
    const header = container.querySelector(`#hunk-${h.id}`)!;
    expect(header).not.toBeNull();
    expect(header.textContent).toContain(`@@ ${h.symbol}`);
    expect(container.querySelectorAll('.cd.r')).toHaveLength(2);
    expect(container.querySelectorAll('.cd.a')).toHaveLength(1);
    expect(container.querySelectorAll('.cd.x')).toHaveLength(1);
    const lns = [...container.querySelectorAll('.ln')].map((e) => e.textContent);
    expect(lns).toEqual(['7', '9', '8', '10', '9', '']);
  });

  it('統合: 旧・新 2 列の行番号で、追加は旧が空、削除は新が空', () => {
    const h = hunk();
    const { container } = render(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={h.id} dispatch={() => {}} />);
    const lns = [...container.querySelectorAll('.ln')].map((e) => e.textContent);
    expect(lns).toEqual(['7', '9', '8', '', '9', '', '', '10']);
  });

  it('「問題なし」ボタンは hunk.markViewed を dispatch し、付いていれば「問題なし ✓」', () => {
    const h = hunk();
    const dispatch = vi.fn();
    const { rerender } = render(<DiffList hunks={[h]} mode="sbs" viewed={[]} selectedHunk={h.id} dispatch={dispatch} />);
    fireEvent.click(screen.getByRole('button', { name: '問題なし' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'hunk.markViewed', hunkId: h.id });
    rerender(<DiffList hunks={[h]} mode="sbs" viewed={[h.id]} selectedHunk={h.id} dispatch={dispatch} />);
    expect(screen.getByRole('button', { name: '問題なし ✓' })).toBeInTheDocument();
  });

  it('コースの色の丸（How の id）。どのコースにも入らない hunk は赤い「外」の丸', () => {
    const hunks = fixtureHunks();
    const inCourse = hunks.find((h) => h.hows.length === 1 && h.hows[0] === 4)!;
    const outside = hunks.find((h) => h.hows.length === 0)!;
    const { container } = render(<DiffList hunks={[inCourse, outside]} mode="uni" viewed={[]} selectedHunk={null} dispatch={() => {}} />);
    expect(container.querySelector(`#hunk-${inCourse.id} .cb.cc4`)!.textContent).toBe('4');
    expect(container.querySelector(`#hunk-${outside.id} .cb.cc0`)!.textContent).toBe('外');
  });

  it('種別チップ: 核 / 追従 / 逸脱（代表と n 語差）/ テスト。種別の無い hunk はチップを出さない（未帰属は「外」の丸で出す。設計書 3.4、8 章）', () => {
    const hunks = fixtureHunks();
    const core = hunks.find((h) => h.kind === 'core')!;
    const member = hunks.find((h) => h.group?.members.includes(h.id))!;
    const dev = hunks.find((h) => h.group?.deviations.includes(h.id))!;
    const test = hunks.find((h) => h.kind === 'test')!;
    const none = hunks.find((h) => h.kind === 'none')!;
    const { container } = render(<DiffList hunks={[core, member, dev, test, none]} mode="uni" viewed={[]} selectedHunk={null} dispatch={() => {}} />);
    const chip = (h: Hunk) => container.querySelector(`#hunk-${h.id} .chip`)!;
    expect(chip(core).textContent).toBe('核');
    expect(chip(member).textContent).toBe('追従');
    expect(chip(dev).textContent).toBe('差異あり');
    expect(chip(dev).className).not.toContain('d');
    expect(chip(test).textContent).toBe('テスト');
    expect(container.querySelector(`#hunk-${none.id} .chip`)).toBeNull();
  });

  it('テストの見分けが構成の推定から来たテストは「テスト（推定）」（原則 2。5.2 の 7）', () => {
    const test = { ...fixtureHunks().find((h) => h.kind === 'test')!, kindProvenance: 'llm' as const };
    const { container } = render(<DiffList hunks={[test]} mode="uni" viewed={[]} selectedHunk={null} dispatch={() => {}} />);
    expect(container.querySelector(`#hunk-${test.id} .chip`)!.textContent).toBe('テスト（推定）');
  });

  it('近い逸脱（group.near）は赤いチップ', () => {
    const dev = fixtureHunks().find((h) => h.group?.deviations.includes(h.id))!;
    dev.group!.near = [dev.id];
    dev.group!.distance[dev.id] = 1;
    const { container } = render(<DiffList hunks={[dev]} mode="uni" viewed={[]} selectedHunk={null} dispatch={() => {}} />);
    const chip = container.querySelector(`#hunk-${dev.id} .chip`)!;
    expect(chip.textContent).toBe('差異あり');
    expect(chip.className).toContain('d');
  });

  it('選択中の hunk のヘッダに on が付く', () => {
    const [a, b] = fixtureHunks();
    const { container } = render(<DiffList hunks={[a!, b!]} mode="sbs" viewed={[]} selectedHunk={b!.id} dispatch={() => {}} />);
    expect(container.querySelector(`#hunk-${a!.id}`)!.className).not.toContain('on');
    expect(container.querySelector(`#hunk-${b!.id}`)!.className).toContain('on');
  });

  it('変わらない行に中心の行の印（ctr。コースの画面の紫）を付けない', () => {
    const h = hunk();
    for (const mode of ['sbs', 'uni'] as const) {
      const { container, unmount } = render(<DiffList hunks={[h]} mode={mode} viewed={[]} selectedHunk={h.id} dispatch={() => {}} />);
      const same = [...container.querySelectorAll('.cd')].filter((e) => e.textContent === 'a');
      expect(same.length).toBeGreaterThan(0);
      expect(container.querySelectorAll('.ctr')).toHaveLength(0);
      unmount();
    }
  });
});

describe('DiffList のファイル全体（目的ごとの画面のプレビュー。3.2）。すべて表示（full）のとき', () => {
  const PATH = 'src/main/kotlin/com/example/order/infra/OrderRepositoryImpl.kt';
  const repo = () => fixtureHunks().filter((h) => h.path === PATH);
  const file = () => fixtureFiles([PATH])[0]!;
  const original = HTMLElement.prototype.scrollTo;
  const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')!;
  afterEach(() => {
    HTMLElement.prototype.scrollTo = original;
    Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeight);
  });

  it('file を渡すと差分の外の行も出し、同じファイルの差分の見出しを全部挟む。選んだ差分は見出しに on、行番号に紫の線（cur）', () => {
    const [save, find] = repo();
    const { container } = render(<DiffList hunks={repo()} file={file()} mode="uni" viewed={[]} selectedHunk={find!.id} dispatch={() => {}} full />);
    expect(container.textContent).toContain('package com.example.order.infra');
    expect(container.querySelector(`#hunk-${save!.id}`)).not.toBeNull();
    expect(container.querySelector(`#hunk-${find!.id}`)!.classList.contains('on')).toBe(true);
    expect(container.querySelector(`#hunk-${save!.id}`)!.classList.contains('on')).toBe(false);
    // 統合は 1 行に行番号が 2 つ。紫の線は左の 1 つだけ、選んだ差分の行の数だけ
    expect(container.querySelectorAll('.ln.cur')).toHaveLength(find!.lines.length);
  });

  it('左右でも差分の外の行を出し、紫の線は選んだ差分の段だけ', () => {
    const [save] = repo();
    const { container } = render(<DiffList hunks={repo()} file={file()} mode="sbs" viewed={[]} selectedHunk={save!.id} dispatch={() => {}} full />);
    expect(container.textContent).toContain('package com.example.order.infra');
    const rows = buildFileRows(file(), repo(), 'sbs').filter((r) => r.kind === 'sbs' && r.hunk.id === save!.id);
    expect(container.querySelectorAll('.ln.cur')).toHaveLength(rows.length);
  });

  it('選んだ差分の見出しを一番上に合わせてスクロールする（差分一覧の画面は見える所までの最小のスクロール）', () => {
    // 200 行のファイルに差分 2 つ。後ろの差分の見出しは画面（900px）の外
    const tokens = Array.from({ length: 200 }, (_, i): TokenLine => [[`l${i + 1}`, null, 0]]);
    const long: FileText = { path: PATH, tokens };
    const [a0, b0] = repo();
    const a: Hunk = { ...a0!, lnOld: 10, lnNew: 10, lines: [' l10', '-x', '+l11'] };
    const b: Hunk = { ...b0!, lnOld: 120, lnNew: 120, lines: [' l120', '+l121', ' l122'] };
    delete a.tokens;
    delete b.tokens;
    const rows = buildFileRows(long, [a, b], 'uni');
    const at = rows.findIndex((r) => r.kind === 'header' && r.hunk.id === b.id);
    const top = rows.slice(0, at).reduce((n, r) => n + (r.kind === 'header' ? 34 : 21), 0);
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof original;
    // jsdom はスクロールできる高さを 0 と返す（仮想リストが行き先を 0 に切り詰める）。スクロール要素にだけ全体の高さを与える
    Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get(this: Element) { return this.classList.contains('dscroll') ? 10000 : 0; } });
    render(<DiffList hunks={[a, b]} file={long} mode="uni" viewed={[]} selectedHunk={b.id} dispatch={() => {}} full />);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top }));
  });

  it('同じファイルの中で選び替えると、近ければなめらかに、画面 2 枚分より遠ければ一瞬で移る', () => {
    const tokens = Array.from({ length: 300 }, (_, i): TokenLine => [[`l${i + 1}`, null, 0]]);
    const long: FileText = { path: PATH, tokens };
    const [a0, b0] = repo();
    const near: Hunk = { ...a0!, id: 'near', lnOld: 10, lnNew: 10, lines: [' l10', '+l11'] };
    const next: Hunk = { ...a0!, id: 'next', lnOld: 30, lnNew: 31, lines: [' l31', '+l32'] };
    const far: Hunk = { ...b0!, id: 'far', lnOld: 250, lnNew: 252, lines: [' l252', '+l253'] };
    for (const h of [near, next, far]) delete h.tokens;
    const hunks = [near, next, far];
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof original;
    Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get(this: Element) { return this.classList.contains('dscroll') ? 10000 : 0; } });
    const { rerender } = render(<DiffList hunks={hunks} file={long} mode="uni" viewed={[]} selectedHunk="near" dispatch={() => {}} full />);
    scrollTo.mockClear();
    rerender(<DiffList hunks={hunks} file={long} mode="uni" viewed={[]} selectedHunk="next" dispatch={() => {}} full />);
    expect(scrollTo.mock.calls[0]![0]).toMatchObject({ behavior: 'smooth' });
    scrollTo.mockClear();
    rerender(<DiffList hunks={hunks} file={long} mode="uni" viewed={[]} selectedHunk="far" dispatch={() => {}} full />);
    expect(scrollTo.mock.calls[0]![0].behavior).not.toBe('smooth');
  });

  it('file を渡さなければ差分の行だけ（差分一覧の画面と総括の逸脱）', () => {
    const [save, find] = repo();
    const { container } = render(<DiffList hunks={repo()} mode="uni" viewed={[]} selectedHunk={find!.id} dispatch={() => {}} />);
    expect(container.textContent).not.toContain('package com.example.order.infra');
    expect(container.querySelector(`#hunk-${save!.id}`)).not.toBeNull();
    expect(container.querySelectorAll('.ln.cur')).toHaveLength(0);
  });
});

describe('DiffList のメモ（差分一覧で書く。3.3 / 3.4）', () => {
  const NO: MemoUi = { pick: null, editing: null, draft: '', focus: null, drag: false };
  const memo = (id: string, line: number, side: 'LEFT' | 'RIGHT', over: Partial<CommentDraft> = {}): CommentDraft => ({ id, path: hunk().path, line, side, body: `本文 ${id}`, source: 'reviewer', state: 'adopted', ...over });
  const at = (side: 'LEFT' | 'RIGHT', line: number, order: number) => ({ side, line, order });
  const plusLabels = (c: HTMLElement) => [...c.querySelectorAll('.mplus')].map((b) => b.getAttribute('aria-label'));

  it('memo を渡さなければ「+」もメモも出ない（目的ごとの画面のプレビューなど）', () => {
    const { container } = render(<DiffList hunks={[hunk()]} mode="sbs" viewed={[]} selectedHunk={null} dispatch={() => {}} />);
    expect(container.querySelector('.mplus')).toBeNull();
  });

  it('左右: 消した行は左の行番号、足した行・変わらない行は右の行番号に「+」。押すと memo.pick（行の並びは左右・統合で同じ）', () => {
    const h = hunk(); // ' a' / '-b' / '-c' / '+d'。base 7 行目から、head 9 行目から
    const dispatch = vi.fn();
    const { container } = render(<DiffList hunks={[h]} mode="sbs" viewed={[]} selectedHunk={null} dispatch={dispatch} memo={{ comments: [], ui: NO, githubDiff: undefined, draftText: {} }} />);
    expect(plusLabels(container)).toEqual(['9 行目にメモ', 'base 8 行目にメモ', '10 行目にメモ', 'base 9 行目にメモ']);
    fireEvent.mouseDown(screen.getByRole('button', { name: '10 行目にメモ' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'memo.pick', path: h.path, side: 'RIGHT', line: 10, order: 3 });
    fireEvent.mouseDown(screen.getByRole('button', { name: 'base 9 行目にメモ' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'memo.pick', path: h.path, side: 'LEFT', line: 9, order: 2 });
    // 左以外のボタン（右クリックなど）では選ばない
    dispatch.mockClear();
    fireEvent.mouseDown(screen.getByRole('button', { name: '9 行目にメモ' }), { button: 2 });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('左右: なぞっている間、入った列の行で memo.drag。左の変わらない行は右と同じ head 側の行、行の無い側は送らない。書く枠は出さない', () => {
    const h = hunk();
    const dispatch = vi.fn();
    const ui: MemoUi = { ...NO, pick: { path: h.path, anchor: at('RIGHT', 9, 0), head: at('RIGHT', 9, 0) }, drag: true };
    const { container } = render(<DiffList hunks={[h]} mode="sbs" viewed={[]} selectedHunk={null} dispatch={dispatch} memo={{ comments: [], ui, githubDiff: undefined, draftText: {} }} />);
    // 行ごとに 左・右 の列: a | a、b | d、c | （無し）
    const cells = [...container.querySelectorAll('.mside')];
    const sent = (k: number) => {
      dispatch.mockClear();
      fireEvent.mouseEnter(cells[k]!);
      return dispatch.mock.calls.map((c) => c[0]);
    };
    expect(sent(0)).toEqual([{ id: 'memo.drag', path: h.path, side: 'RIGHT', line: 9, order: 0 }]);
    expect(sent(2)).toEqual([{ id: 'memo.drag', path: h.path, side: 'LEFT', line: 8, order: 1 }]);
    expect(sent(3)).toEqual([{ id: 'memo.drag', path: h.path, side: 'RIGHT', line: 10, order: 3 }]);
    expect(sent(4)).toEqual([{ id: 'memo.drag', path: h.path, side: 'LEFT', line: 9, order: 2 }]);
    expect(sent(5)).toEqual([]);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('なぞっている間、hold があれば元の書く枠・直す枠の場所に同じ高さの空きを出す（離すまで行をずらさない）', () => {
    const h = hunk();
    const pick = { path: h.path, anchor: at('RIGHT', 10, 3), head: at('RIGHT', 10, 3) };
    const old = { path: h.path, anchor: at('RIGHT', 9, 0), head: at('RIGHT', 9, 0) };
    const view = (ui: MemoUi, comments: CommentDraft[] = []) => <DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={null} dispatch={() => {}} memo={{ comments, ui, githubDiff: undefined, draftText: {} }} />;
    const { container, rerender } = render(view({ ...NO, pick, drag: true, hold: { pick: old, editing: null, height: 150 } }));
    expect(container.querySelector('textarea')).toBeNull();
    expect([...container.querySelectorAll<HTMLElement>('.mhold')].map((e) => e.style.height)).toEqual(['150px']);
    rerender(view({ ...NO, pick, drag: true, hold: { pick: null, editing: 'm1', height: 90 } }, [memo('m1', 9, 'RIGHT')]));
    expect([...container.querySelectorAll<HTMLElement>('.mhold')].map((e) => e.style.height)).toEqual(['90px']);
    expect(container.textContent).not.toContain('本文 m1');
  });

  it('統合: なぞっている間、入った行で memo.drag。なぞっていなければ何も送らない', () => {
    const h = hunk();
    const dispatch = vi.fn();
    const pick = { path: h.path, anchor: at('RIGHT', 9, 0), head: at('RIGHT', 9, 0) };
    const view = (drag: boolean) => <DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={null} dispatch={dispatch} memo={{ comments: [], ui: { ...NO, pick, drag }, githubDiff: undefined, draftText: {} }} />;
    const { container, rerender } = render(view(false));
    const rowOf = (name: string) => screen.getByRole('button', { name }).closest('.diff')!;
    fireEvent.mouseEnter(rowOf('10 行目にメモ'));
    expect(dispatch).not.toHaveBeenCalled();
    rerender(view(true));
    fireEvent.mouseEnter(rowOf('10 行目にメモ'));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'memo.drag', path: h.path, side: 'RIGHT', line: 10, order: 3 });
    fireEvent.mouseEnter(rowOf('base 8 行目にメモ'));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'memo.drag', path: h.path, side: 'LEFT', line: 8, order: 1 });
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('GitHub の差分に出ない行は、点線の「?」（聞くだけの印）。押したときは「+」と同じ memo.pick', () => {
    const h = hunk(); // ' a' / '-b' / '-c' / '+d'。base 7 行目から、head 9 行目から
    // GitHub の差分の塊は base 7〜8 行目と head 9〜10 行目。base 9 行目（消した行 c）は外
    const githubDiff = [{ path: h.path, hunks: [{ oldStart: 7, oldLines: 2, newStart: 9, newLines: 2 }] }];
    const dispatch = vi.fn();
    const { container } = render(<DiffList hunks={[h]} mode="sbs" viewed={[]} selectedHunk={null} dispatch={dispatch} memo={{ comments: [], ui: NO, githubDiff, draftText: {} }} />);
    expect(plusLabels(container)).toEqual(['9 行目にメモ', 'base 8 行目にメモ', '10 行目にメモ', 'base 9 行目について聞く']);
    const ask = screen.getByRole('button', { name: 'base 9 行目について聞く' });
    expect(ask).toHaveTextContent('?');
    expect(ask).toHaveAttribute('title', 'この行について聞く（GitHub の差分に出ないので、メモは書けません）');
    expect(screen.getByRole('button', { name: '10 行目にメモ' })).toHaveTextContent('+');
    fireEvent.mouseDown(ask);
    expect(dispatch).toHaveBeenCalledWith({ id: 'memo.pick', path: h.path, side: 'LEFT', line: 9, order: 2 });
  });

  it('GitHub の差分に出ない行を選ぶと、書く欄の代わりに聞く枠（注記と「やめる」「聞く」）。直す枠は書く欄のまま', () => {
    const h = hunk();
    const githubDiff = [{ path: h.path, hunks: [{ oldStart: 7, oldLines: 2, newStart: 9, newLines: 2 }] }];
    const dispatch = vi.fn();
    const ui: MemoUi = { ...NO, pick: { path: h.path, anchor: at('LEFT', 9, 2), head: at('LEFT', 9, 2) } };
    const { container, rerender } = render(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={null} dispatch={dispatch} memo={{ comments: [], ui, githubDiff, draftText: {} }} />);
    const box = container.querySelector('.dmemo .mbox') as HTMLElement;
    expect(box.querySelector('.mh')!.textContent).toBe(`聞く${h.path.split('/').pop()} 9 行目（base 側）`);
    expect(box.querySelector('textarea')).toBeNull();
    expect(box.querySelector('.mnote')!.textContent).toBe('この行は GitHub の差分に出ないので、メモは書けません。案内人に聞くことはできます');
    expect([...box.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['やめる Esc', '聞く']);
    fireEvent.click(screen.getByRole('button', { name: '聞く' }));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'ask.lines' });
    fireEvent.click(screen.getByRole('button', { name: /やめる/ }));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'memo.cancel' });
    // 前から残っている差分に出ない行のメモは、今どおり直せる
    rerender(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={null} dispatch={dispatch} memo={{ comments: [memo('m1', 9, 'LEFT')], ui: { ...NO, editing: 'm1', draft: '前の文' }, githubDiff, draftText: {} }} />);
    expect((container.querySelector('.dmemo textarea') as HTMLTextAreaElement).value).toBe('前の文');
  });

  it('GitHub の差分に出ない行の保存したメモと AI の下書きには「GitHub に送れません」。送った物と差分に出る行の物には付けない', () => {
    const h = hunk();
    const githubDiff = [{ path: h.path, hunks: [{ oldStart: 7, oldLines: 2, newStart: 9, newLines: 2 }] }];
    const comments = [memo('m1', 9, 'LEFT'), memo('m2', 10, 'RIGHT'), memo('m3', 9, 'LEFT', { state: 'sent' }), memo('d1', 9, 'LEFT', { source: 'codex', state: 'draft' })];
    const { container } = render(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={null} dispatch={() => {}} memo={{ comments, ui: NO, githubDiff, draftText: {} }} />);
    const boxes = [...container.querySelectorAll('.dmemo .mbox')].map((b) => [b.querySelector('p')!.textContent, b.querySelector('.chip.off')?.textContent ?? '']);
    expect(boxes.sort()).toEqual([
      ['本文 d1', 'GitHub に送れません'],
      ['本文 m1', 'GitHub に送れません'],
      ['本文 m2', ''],
      ['本文 m3', ''],
    ]);
  });

  it('統合: 行ごとに 1 つ「+」（コースの画面と同じく old 列の行番号）', () => {
    const { container } = render(<DiffList hunks={[hunk()]} mode="uni" viewed={[]} selectedHunk={null} dispatch={() => {}} memo={{ comments: [], ui: NO, githubDiff: undefined, draftText: {} }} />);
    expect(plusLabels(container)).toEqual(['9 行目にメモ', 'base 8 行目にメモ', 'base 9 行目にメモ', '10 行目にメモ']);
  });

  it('左右: 保存したメモは、その行の側の列の下（base 側は左、head 側は右）。選んでいる行は色が付き、最後の行の下に書く枠', () => {
    const ui: MemoUi = { ...NO, pick: { path: hunk().path, anchor: at('RIGHT', 9, 0), head: at('RIGHT', 10, 3) }, draft: '書きかけ' };
    const { container } = render(<DiffList hunks={[hunk()]} mode="sbs" viewed={[]} selectedHunk={null} dispatch={() => {}} memo={{ comments: [memo('m1', 8, 'LEFT'), memo('m2', 10, 'RIGHT')], ui, githubDiff: undefined, draftText: {} }} />);
    const row = container.querySelector('.dmemo')!;
    expect(row.querySelector('.mhalf.l')!.textContent).toContain('本文 m1');
    expect(row.querySelector('.mhalf.r')!.textContent).toContain('本文 m2');
    expect((row.querySelector('.mhalf.r textarea') as HTMLTextAreaElement).value).toBe('書きかけ');
    // 選んでいる 9〜10 行目（右）だけに色。左の消した行には付かない
    expect([...container.querySelectorAll('.ln.msel')].map((e) => e.textContent)).toEqual(['+9', '+10']);
  });

  it('統合: メモはその行の下に全幅で。直している物は書く枠（文は draft）', () => {
    const ui: MemoUi = { ...NO, editing: 'm1', draft: '直している' };
    const { container } = render(<DiffList hunks={[hunk()]} mode="uni" viewed={[]} selectedHunk={null} dispatch={() => {}} memo={{ comments: [memo('m1', 8, 'LEFT')], ui, githubDiff: undefined, draftText: {} }} />);
    expect(container.querySelector('.dmemo.uni')).not.toBeNull();
    expect((container.querySelector('.dmemo textarea') as HTMLTextAreaElement).value).toBe('直している');
  });
});

describe('DiffPane', () => {
  const jump = { hunkId: null, to: 'hunk' as const, n: 1 };

  it('IDEAで開く はコマンド jump.ide を dispatch する（原則 6: マウスもキーボードも同じコマンド）', () => {
    const h = hunk();
    const dispatch = vi.fn();
    render(<DiffPane hunks={[h]} jump={jump} mode="sbs" viewed={[]} selectedHunk={h.id} repoName="order-service" dispatch={dispatch} />);
    fireEvent.click(screen.getByRole('button', { name: 'IDEA で開く' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'jump.ide' });
  });

  it('差分が無ければ「変更ファイルがありません」', () => {
    render(<DiffPane hunks={[]} jump={jump} mode="sbs" viewed={[]} selectedHunk={null} repoName={null} dispatch={() => {}} />);
    expect(screen.getByText('変更ファイルがありません')).toBeInTheDocument();
  });
});

describe('差分一覧の列（全部のファイルを 1 本に。2026-10-20。GitHub と同じくファイルをまたいでスクロールする）', () => {
  const original = HTMLElement.prototype.scrollTo;
  afterEach(() => {
    HTMLElement.prototype.scrollTo = original;
  });
  /** n 行足しただけの差分（帯にならない）。行の高さは 21、見出しは 34 */
  const mk = (id: string, path: string, n: number): Hunk => {
    const h: Hunk = { ...fixtureHunks()[0]!, id, path, lnOld: 1, lnNew: 1, lines: Array.from({ length: n }, (_, k) => `+${path} ${k + 1}`) };
    delete h.tokens;
    return h;
  };
  // 上から: A の見出し 0、a1 34、B の見出し 908、b1 942、C の見出し 1816、c1 1850。全体 2724（画面は 900）
  const hunks = [mk('a1', 'A.kt', 40), mk('b1', 'B.kt', 40), mk('c1', 'C.kt', 40)];
  const NO: MemoUi = { pick: null, editing: null, draft: '', focus: null, drag: false };
  const list = (over: Partial<Parameters<typeof DiffList>[0]> = {}) => <DiffList hunks={hunks} mode="uni" viewed={[]} selectedHunk="a1" dispatch={() => {}} jump={{ hunkId: 'a1', to: 'hunk', n: 1 }} {...over} />;
  const stuck = (c: HTMLElement) => c.querySelector('.dstick .fh b')?.textContent;
  const spy = () => {
    const scrollTo = vi.fn();
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof original;
    return scrollTo;
  };

  it('ファイルごとに見出しの行（パス）を挟み、一番上には今のファイルの見出しが貼り付く', () => {
    const { container } = render(list({ hunks: [mk('a1', 'A.kt', 3), mk('b1', 'B.kt', 3)] }));
    expect([...container.querySelectorAll('.dbody .fh b')].map((b) => b.textContent)).toEqual(['A.kt', 'B.kt']);
    expect(stuck(container)).toBe('A.kt');
  });

  it('差分一覧に出ない行（hunk の外）のメモと AI の下書きは、そのファイルの見出しに「差分の外のメモ n」「差分の外の下書き n」。押すと 1 件目を開く', () => {
    const dispatch = vi.fn();
    const note = (id: string, path: string, line: number, source = 'reviewer'): CommentDraft => ({ id, path, line, side: 'RIGHT', body: id, source, state: 'adopted' });
    const comments = [note('m1', 'B.kt', 30), note('m2', 'B.kt', 2), note('m3', 'B.kt', 20), note('c1', 'B.kt', 40, 'claude-code'), note('m4', 'A.kt', 2)];
    render(list({ hunks: [mk('a1', 'A.kt', 3), mk('b1', 'B.kt', 3)], dispatch, memo: { comments, ui: NO, githubDiff: undefined, draftText: {} } }));
    expect(screen.queryByRole('button', { name: /差分の外の下書き/ })).toHaveTextContent('差分の外の下書き 1');
    fireEvent.click(screen.getByRole('button', { name: '差分の外のメモ 2' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'comment.open', commentId: 'm3' });
  });

  it('スクロールすると、一番上のファイルと見えている差分を diff.viewport で知らせ、貼り付く見出しもそのファイルになる', () => {
    const dispatch = vi.fn();
    const { container } = render(list({ dispatch }));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'diff.viewport', file: 'A.kt', hunks: ['a1'], n: 1 });
    const el = container.querySelector('.dscroll') as HTMLElement;
    el.scrollTop = 908;
    fireEvent.scroll(el);
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'diff.viewport', file: 'B.kt', hunks: ['b1'], n: 1 });
    expect(stuck(container)).toBe('B.kt');
  });

  it('行き先を出し終えるまでの知らせは前の jump の番号のまま（reducer が選びを動かさない）', () => {
    const dispatch = vi.fn();
    const { container, rerender } = render(list({ dispatch }));
    spy();
    rerender(list({ dispatch, selectedHunk: 'c1', jump: { hunkId: 'c1', to: 'hunk', n: 2 } }));
    // scrollTo を止めたので画面は A のまま。c1 はまだ見えていない
    const el = container.querySelector('.dscroll') as HTMLElement;
    el.scrollTop = 908;
    fireEvent.scroll(el);
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'diff.viewport', file: 'B.kt', hunks: ['b1'], n: 1 });
  });

  it('jump の行き先が列に無ければ（解析を読み直したなど）出し終えたことにする（付いてくる選びを止めたままにしない）', () => {
    for (const hunkId of ['gone', null]) {
      const dispatch = vi.fn();
      const { unmount } = render(list({ dispatch, jump: { hunkId, to: 'hunk', n: 7 } }));
      expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'diff.viewport', n: 7 }));
      unmount();
    }
  });

  it('選んだ差分が変わっただけでは動かさない。jump の n が進んだときだけ動く', () => {
    const { rerender } = render(list());
    const scrollTo = spy();
    rerender(list({ selectedHunk: 'c1' }));
    expect(scrollTo).not.toHaveBeenCalled();
    rerender(list({ selectedHunk: 'c1', jump: { hunkId: 'c1', to: 'file', n: 2 } }));
    // ファイルの見出しの行がちょうど一番上（行の位置の和）
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 1816 }));
  });

  it('下のファイルの差分へ跳ぶときは、前のファイルの末尾を一番上に残さず、そのファイルの見出しを一番上へ', () => {
    const { rerender } = render(list());
    const scrollTo = spy();
    rerender(list({ selectedHunk: 'b1', jump: { hunkId: 'b1', to: 'hunk', n: 2 } }));
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 908 }));
  });

  it('答えの行の場所（focusLine）がファイルの頭近くなら、真ん中ではなくファイルの見出しを一番上へ', () => {
    const scrollTo = spy();
    render(list({ focusLine: { path: 'B.kt', side: 'RIGHT', line: 2, n: 1 } }));
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 908 }));
  });

  it('jump を渡さない（目的ごとの画面のプレビュー・コース）と、ファイルの見出しも貼り付く見出しも出さず、知らせない', () => {
    const dispatch = vi.fn();
    const { container } = render(<DiffList hunks={hunks} mode="uni" viewed={[]} selectedHunk="a1" dispatch={dispatch} />);
    expect(container.querySelector('.fh')).toBeNull();
    expect(container.querySelector('.dstick')).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ファイルの見出しの高さ（.fh）は FILE_HEAD_H（ファイルの頭へ揃える計算と貼り付く見出しが乗っている）', () => {
    const rule = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => sel!.split(',').some((x) => x.trim() === '.fh'));
    expect(rule?.[2]).toContain(`height:${FILE_HEAD_H}px`);
  });
});

describe('変わった行から離れた行の帯（2026-10-13。GitHub と同じく 20 行ずつ）', () => {
  const ctx = (n: number) => Array.from({ length: n }, (_, k) => ` c${k}`);
  // 変わらない行 30（lines の 0〜29）→ 消した行 → 足した行 → 変わらない行 10（32〜41）
  const big = (lines = [...ctx(30), '-b', '+c', ...ctx(10)]): Hunk => {
    const h: Hunk = { ...fixtureHunks()[0]!, id: 'h1', lnOld: 1, lnNew: 1, lines };
    delete h.tokens;
    return h;
  };
  const keys = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => `h1:${from + k}`);

  it('離れた行は帯「⋯ n 行」。↓ は上側から 20 行、↑ は下側から 20 行を fold.open で開く。末尾の帯は ↓ だけ', () => {
    const h = big();
    const dispatch = vi.fn();
    const { container } = render(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={h.id} dispatch={dispatch} />);
    expect([...container.querySelectorAll('.fold .fl')].map((e) => e.textContent)).toEqual(['⋯ 27 行', '⋯ 7 行']);
    fireEvent.click(screen.getByRole('button', { name: '下へ 20 行表示' }));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'fold.open', path: h.path, keys: keys(0, 19) });
    fireEvent.click(screen.getByRole('button', { name: '上へ 20 行表示' }));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'fold.open', path: h.path, keys: keys(7, 26) });
    fireEvent.click(screen.getByRole('button', { name: '下へ 7 行表示' }));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'fold.open', path: h.path, keys: keys(35, 41) });
    expect(screen.queryByRole('button', { name: '上へ 7 行表示' })).toBeNull();
  });

  it('20 行以下の真ん中の帯は ↕ 1 つで全部', () => {
    const h = big(['-a', ...ctx(12), '+b']);
    const dispatch = vi.fn();
    render(<DiffList hunks={[h]} mode="sbs" viewed={[]} selectedHunk={h.id} dispatch={dispatch} />);
    fireEvent.click(screen.getByRole('button', { name: '6 行を全部表示' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'fold.open', path: h.path, keys: keys(4, 9) });
  });

  it('開いた行（open）は出し、すべて表示（full）なら帯を出さない', () => {
    const h = big();
    const { container, rerender } = render(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={h.id} dispatch={() => {}} open={keys(7, 26)} />);
    expect([...container.querySelectorAll('.fold .fl')].map((e) => e.textContent)).toEqual(['⋯ 7 行', '⋯ 7 行']);
    rerender(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={h.id} dispatch={() => {}} full />);
    expect(container.querySelector('.fold')).toBeNull();
  });
});

describe('DiffPane のすべて表示（2026-10-13）', () => {
  it('「すべて表示 F」で file.full。すべて表示のときは「変更の近くだけ F」。開いた行は DiffList に渡す', () => {
    const h: Hunk = { ...fixtureHunks()[0]!, id: 'h1', lnOld: 1, lnNew: 1, lines: [...Array.from({ length: 10 }, (_, k) => ` c${k}`), '+x'] };
    delete h.tokens;
    const dispatch = vi.fn();
    const jump = { hunkId: 'h1', to: 'hunk' as const, n: 1 };
    const { container, rerender } = render(<DiffPane hunks={[h]} jump={jump} mode="uni" viewed={[]} selectedHunk={h.id} repoName={null} open={['h1:0', 'h1:1']} full={false} dispatch={dispatch} />);
    expect([...container.querySelectorAll('.fold .fl')].map((e) => e.textContent)).toEqual(['⋯ 5 行']);
    fireEvent.click(screen.getByRole('button', { name: 'すべて表示 F' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'file.full' });
    rerender(<DiffPane hunks={[h]} jump={jump} mode="uni" viewed={[]} selectedHunk={h.id} repoName={null} open={[]} full dispatch={dispatch} />);
    expect(screen.getByRole('button', { name: '変更の近くだけ F' })).toBeInTheDocument();
    expect(container.querySelector('.fold')).toBeNull();
  });
});

describe('コードの行の高さ（2026-10-15）', () => {
  // 仮想リストは測った行の高さを整数に丸めて並べる。13px × 1.6 = 20.8px の行は 21px おきに置かれ、行の間が 0.2px ずつ空いて
  // 折り返した行の下に 1px の暗い線が出た（コースの画面の FileView は 1 枚の表なので出ない）。行の高さを整数の px にして 3 画面をそろえる
  it('行番号（.ln）とコード（.cd）の line-height は整数の px で、仮想リストの行の見積もり（21）と同じ', () => {
    const heights = (cell: string) =>
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, sel]) => sel!.split(',').some((x) => x.trim() === `.diff ${cell}`))
        .flatMap(([, , body]) => [...body!.matchAll(/line-height:([^;}]+)/g)].map((m) => m[1]!.trim()));
    expect(heights('.ln')).toEqual(['21px']);
    expect(heights('.cd')).toEqual(['21px']);
  });
});

describe('列の中の検索（⌘F。2026-10-27。ブラウザのページ内検索は画面の外の行と畳んだ行を見つけない）', () => {
  const ctx = (n: number) => Array.from({ length: n }, (_, k) => ` c${k}`);
  // 変わらない行 30 → 消した行 → 足した行 → 変わらない行 10。c5 は上の帯と下の帯の中に 1 つずつ
  const big = (): Hunk => {
    const h: Hunk = { ...fixtureHunks()[0]!, id: 'h1', lnOld: 1, lnNew: 1, lines: [...ctx(30), '-b', '+c', ...ctx(10)] };
    delete h.tokens;
    return h;
  };
  const find = (query: string, at = 0) => ({ open: true, query, at, n: 1 });

  it('畳んだ行の中の今の 1 件は帯から出して印を付け、件数を出す。次の 1 件に移ると元の帯に戻る', () => {
    const h = big();
    const { container, rerender } = render(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={h.id} dispatch={() => {}} find={find('C5')} />);
    expect(container.querySelector('mark.fhit.cur')!.textContent).toBe('c5');
    expect(container.querySelector('.dfind .fcount')!.textContent).toBe('1 / 2');
    expect(screen.getByRole('searchbox', { name: '差分の中を検索' })).toHaveFocus();
    rerender(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={h.id} dispatch={() => {}} find={find('C5', 1)} />);
    expect(container.querySelector('.dfind .fcount')!.textContent).toBe('2 / 2');
    const cur = container.querySelector('mark.fhit.cur')!.closest('.diff')!;
    expect(cur.querySelectorAll('.ln')[1]!.textContent).toBe('37');
    // 1 件目は上の帯に戻った（今の 1 件でない行は畳んだまま）
    expect(container.querySelectorAll('mark.fhit')).toHaveLength(1);
  });

  it('左右では見つけた側のセルにだけ印。見つからなければ「見つかりません」で、前へ・次へは押せない', () => {
    const h = { ...hunk(), symbol: 'S' };
    const { container, rerender } = render(<DiffList hunks={[h]} mode="sbs" viewed={[]} selectedHunk={h.id} dispatch={() => {}} find={find('d')} />);
    expect(container.querySelector('.cd.a mark.fhit.cur')!.textContent).toBe('d');
    rerender(<DiffList hunks={[h]} mode="sbs" viewed={[]} selectedHunk={h.id} dispatch={() => {}} find={find('zzz')} />);
    expect(container.querySelector('.dfind .fcount')!.textContent).toBe('見つかりません');
    expect(screen.getByRole('button', { name: '次へ' })).toBeDisabled();
  });

  it('検索欄: 文字は find.query、Enter は find.next、Shift+Enter は find.prev、変換中の Enter は何もしない、Esc と × は find.close', () => {
    const h = hunk();
    const dispatch = vi.fn();
    render(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={h.id} dispatch={dispatch} find={find('b')} />);
    const box = screen.getByRole('searchbox', { name: '差分の中を検索' });
    fireEvent.change(box, { target: { value: 'bc' } });
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'find.query', text: 'bc' });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'find.next' });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'find.prev' });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'find.close' });
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(dispatch).toHaveBeenLastCalledWith({ id: 'find.close' });
  });

  it('閉じていれば検索欄も印も出さない', () => {
    const h = hunk();
    const { container } = render(<DiffList hunks={[h]} mode="uni" viewed={[]} selectedHunk={h.id} dispatch={() => {}} find={{ open: false, query: 'b', at: 0, n: 1 }} />);
    expect(container.querySelector('.dfind')).toBeNull();
    expect(container.querySelector('mark')).toBeNull();
  });
});

describe('行の中の変わった語（2026-10-30。GitHub と同じく、組になった消した行と足した行の変わった所を濃く塗る）', () => {
  const pair = () => fixtureHunks().find((h) => h.path.endsWith('OrderAdminView.kt'))!;
  const painted = (c: HTMLElement, sel: string) => [...c.querySelectorAll(sel)].map((e) => e.textContent).join('');

  it.each(['sbs', 'uni'] as const)('%s: 消した行は getDiscount()、足した行は discount だけを塗り、変わらない行は塗らない', (mode) => {
    const h = pair();
    const { container } = render(<DiffList hunks={[h]} mode={mode} viewed={[]} selectedHunk={h.id} dispatch={() => {}} />);
    expect(painted(container, '.cd.r .wd')).toBe('getDiscount()');
    expect(painted(container, '.cd.a .wd')).toBe('discount');
    expect(container.querySelectorAll('.wd')).toHaveLength(container.querySelectorAll('.cd.r .wd, .cd.a .wd').length);
  });

  it('検索で見つけた所は検索の印が勝ち、印の中は塗らない', () => {
    const h = pair();
    const { container } = render(<DiffList hunks={[h]} mode="sbs" viewed={[]} selectedHunk={h.id} dispatch={() => {}} find={{ open: true, query: 'getDiscount', at: 0, n: 1 }} />);
    expect(container.querySelector('.cd.r mark.fhit')!.textContent).toBe('getDiscount');
    expect(container.querySelector('mark .wd')).toBeNull();
    expect(painted(container, '.cd.r .wd')).toBe('()');
  });
});
