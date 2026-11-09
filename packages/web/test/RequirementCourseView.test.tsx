import { useReducer } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RequirementCourseView } from '../src/components/RequirementCourseView.js';
import { initialState, reduce } from '../src/state/reducer.js';
import { emptyReview } from './fixture.js';
import { requirementAnalysis } from './requirementFixture.js';
import type { Analysis } from '@ondina/model';

function Harness({ analysis = requirementAnalysis(), chapter = 0 }: { analysis?: Analysis; chapter?: number | 'start' | 'end' }) {
  const loaded = reduce(initialState(), { id: 'data.loaded', analysis, review: emptyReview(), summary: { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' } }).state;
  const [state, dispatch] = useReducer((s: typeof loaded, c: Parameters<typeof reduce>[1]) => reduce(s, c).state, reduce(loaded, { id: 'req.go', chapter }).state);
  return <RequirementCourseView analysis={state.analysis!} review={state.review!} at={state.requirement} selectedHunk={state.selectedHunk} memo={state.memo} mode="uni" dispatch={dispatch} />;
}

describe('requirement course from goldens', () => {
  it('keeps Github file order, folds other chapters, and allows opening a file and its hunks', () => {
    const a = requirementAnalysis();
    a.githubDiff = [...a.githubDiff!].reverse();
    const { container } = render(<Harness analysis={a} />);
    expect([...container.querySelectorAll('[data-req-file]')].map((e) => e.getAttribute('data-req-file'))).toEqual(a.githubDiff.map((f) => f.path));
    const other = a.hunks.find((h) => !a.chapters![0]!.hunkIds.includes(h.id))!;
    fireEvent.click(screen.getByRole('button', { name: `ファイルを開閉 ${other.path}` }));
    const hunk = container.querySelector(`[data-req-hunk="${other.id}"]`)! as HTMLElement;
    expect(hunk.querySelector('.req-code')).toBeNull();
    fireEvent.click(within(hunk).getByRole('button', { name: /開く/ }));
    expect(hunk.querySelector('.req-code .cd')).not.toBeNull();
    expect(hunk.querySelector('.req-guide')).toBeNull();
  });
  it('renders quote and source, dotted AI guess, none, and no placeholder when intent absent', () => {
    const a = requirementAnalysis();
    const ids = a.intents!.map((i) => i.hunkId);
    const absent = a.hunks.find((h) => !h.group)!;
    a.intents = a.intents!.filter((i) => i.hunkId !== absent.id);
    a.chapters = [{ kind: 'extra', hunkIds: [...new Set([...ids, absent.id])] }];
    const { container } = render(<Harness analysis={a} />);
    const written = a.intents!.flatMap((i) => i.notes).find((n) => n.kind === 'written')!;
    expect(container.querySelector('.intent.written q')).toHaveTextContent(written.kind === 'written' ? written.quote : '');
    expect(screen.getAllByText('コミット aaaaaaa').length).toBeGreaterThan(0);
    expect(container.querySelector('.intent.guess')).toHaveTextContent('推定AI');
    expect(container.querySelector('.intent.none')).toHaveTextContent('書いていない');
    expect(container.querySelector(`[data-req-hunk="${absent.id}"] .intent`)).toBeNull();
  });
  it('shows representative full intent and members one-line guide with same actions', () => {
    const a = requirementAnalysis();
    const index = a.chapters!.findIndex((c) => c.kind === 'follow');
    const { container } = render(<Harness analysis={a} chapter={index} />);
    const member = a.hunks.find((h) => a.chapters![index]!.hunkIds.includes(h.id) && h.group && h.group.representative !== h.id)!;
    const guide = container.querySelector(`[data-req-hunk="${member.id}"] .req-guide`)! as HTMLElement;
    expect(guide).toHaveTextContent('同じ書き換え 22 件の 1 つです。パターン: getDiscount() → discount');
    expect(within(guide).getByRole('button', { name: '聞く' })).toBeInTheDocument();
    expect(within(guide).getByRole('button', { name: '意見を書く' })).toBeInTheDocument();
  });
  it('empty requirement has requirement text and no action buttons', () => {
    const a = requirementAnalysis();
    const index = a.chapters!.findIndex((c) => c.kind === 'spec' && c.hunkIds.length === 0);
    render(<Harness analysis={a} chapter={index} />);
    expect(screen.getByText('この要求に当たる差分が見つかりません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^わかった/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: '読む差分' })).getByRole('heading', { level: 2 })).not.toHaveTextContent('要求の外');
  });
  it('ask starts without selected lines; selecting with diff + enables saving and undo leaves draft', () => {
    const { container } = render(<Harness />);
    const hunk = container.querySelector('[data-req-hunk].focus')! as HTMLElement;
    fireEvent.click(within(hunk).getByRole('button', { name: '聞く' }));
    fireEvent.change(within(hunk).getByRole('textbox', { name: '聞くこと' }), { target: { value: '意図を教えてください' } });
    expect(within(hunk).getByRole('button', { name: '保存' })).toBeDisabled();
    const mark = within(hunk).getAllByRole('button', { name: /行目にメモ/ })[0]!;
    fireEvent.mouseDown(mark, { button: 0 });
    fireEvent.mouseUp(window);
    expect(within(hunk).getByRole('button', { name: '保存' })).toBeEnabled();
    fireEvent.click(within(hunk).getByRole('button', { name: '保存' }));
    expect(within(hunk).getByText('意図を教えてください')).toBeInTheDocument();
    fireEvent.click(within(hunk).getByRole('button', { name: '「聞く」を外す' }));
    expect(within(hunk).getByRole('button', { name: /^わかった/ })).toBeInTheDocument();
    expect(within(hunk).getByText('意図を教えてください')).toBeInTheDocument();
  });
  it.each(['start', 'end'] as const)('has simple %s page and existing-screen link', (chapter) => {
    render(<Harness chapter={chapter} />);
    expect(within(screen.getByRole('region', { name: '読む差分' })).getByRole('heading', { level: 2 })).toHaveTextContent(chapter === 'start' ? 'はじめに' : 'Approve の前に');
    expect(screen.getByRole('button', { name: chapter === 'start' ? '説明を開く' : '締めを開く' })).toBeInTheDocument();
  });
});

it('local analysis without Github metadata still shows code and permits reviewer-picked memo lines', () => {
  const a = requirementAnalysis();
  delete a.githubDiff;
  a.pr.number = 0;
  const { container } = render(<Harness analysis={a} />);
  const current = container.querySelector('.gh-hunk.focus')! as HTMLElement;
  expect(current).not.toBeNull();
  fireEvent.click(within(current).getByRole('button', { name: '意見を書く' }));
  fireEvent.change(within(current).getByRole('textbox', { name: '意見' }), { target: { value: '意見です' } });
  fireEvent.mouseDown(within(current).getAllByRole('button', { name: /行目にメモ/ })[0]!, { button: 0 });
  fireEvent.mouseUp(window);
  expect(within(current).getByRole('button', { name: '保存' })).toBeEnabled();
  fireEvent.click(within(current).getByRole('button', { name: '保存' }));
  expect(within(current).getByText('意見です')).toBeInTheDocument();
});


it('scrolls the #1 header on chapter entry, repeat entry, and the next hunk after understanding', () => {
  const oldScroll = HTMLElement.prototype.scrollIntoView;
  const calls: Array<{ id: string | null; badge: string | null; options: ScrollIntoViewOptions | boolean | undefined }> = [];
  HTMLElement.prototype.scrollIntoView = function(options) {
    calls.push({ id: this.closest('[data-req-hunk]')?.getAttribute('data-req-hunk') ?? null, badge: this.querySelector('.req-number')?.textContent ?? null, options });
  };
  try {
    const a = requirementAnalysis();
    const { container } = render(<Harness analysis={a} />);
    expect(calls.at(-1)).toEqual({ id: a.chapters![0]!.hunkIds[0], badge: '1', options: { block: 'start' } });
    fireEvent.click(within(screen.getByRole('navigation', { name: '章' })).getByRole('button', { name: /^要求 1/ }));
    expect(calls).toHaveLength(2);
    const current = container.querySelector('.gh-hunk.focus')! as HTMLElement;
    fireEvent.click(within(current).getByRole('button', { name: /^わかった/ }));
    expect(calls.at(-1)).toEqual({ id: a.chapters![0]!.hunkIds[1], badge: '2', options: { block: 'start' } });
  } finally {
    if (oldScroll) HTMLElement.prototype.scrollIntoView = oldScroll;
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
});

it('shows chapter completion without navigating, with a next chapter button', () => {
  const a = requirementAnalysis();
  a.chapters = [{ kind: 'spec', specId: 's1', hunkIds: [a.chapters![0]!.hunkIds[0]!] }, ...a.chapters!.slice(1)];
  const { container } = render(<Harness analysis={a} />);
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(within(container.querySelector('.gh-hunk.focus')! as HTMLElement).getByRole('button', { name: /^わかった/ }));
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('この章の差分をすべて見ました。');
  expect(container.querySelector('.gh-hunk.focus')).toHaveAttribute('data-req-hunk', a.chapters[0]!.hunkIds[0]);
  fireEvent.click(within(status).getByRole('button', { name: /^次の章/ }));
  expect(container.querySelector('.gh-hunk.focus')).toHaveAttribute('data-req-hunk', a.chapters[1]!.hunkIds[0]);
});

it('Files changed shows filename before its directory and preserves the full path title', () => {
  const a = requirementAnalysis();
  render(<Harness analysis={a} />);
  const path = a.githubDiff!.find((f) => f.path.endsWith('/OrderController.kt'))!.path;
  const button = within(screen.getByRole('complementary', { name: 'Files changed' })).getByTitle(path);
  expect(button.textContent).toMatch(/^OrderController\.kt/);
  expect(button.querySelector('.req-file-name')).toHaveTextContent('OrderController.kt');
  expect(button.querySelector('.req-file-dir')).toHaveTextContent('src/main/kotlin/com/example/order/api/');
});
