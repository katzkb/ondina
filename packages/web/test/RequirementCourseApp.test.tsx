import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { fakeApi } from './fakeApi.js';
import { requirementAnalysis } from './requirementFixture.js';

// jsdom に Web Worker が無いので、地図の配置は elkjs を同じスレッドで走らせる
vi.mock('../src/map/elk.js', async () => {
  const ELK = (await import('elkjs/lib/elk.bundled.js')).default;
  const elk = new ELK();
  return { workerElk: () => elk };
});

describe('requirement course in App', () => {
  it('opens from top bar and explain Enter, writes chapter URL, restores a history entry', async () => {
    render(<App api={fakeApi(requirementAnalysis()).api} />);
    await screen.findByLabelText('入口');
    fireEvent.click(screen.getByRole('button', { name: '要求コース' }));
    expect(await screen.findByLabelText('要求コース')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/start');
    fireEvent.click(within(screen.getByRole('navigation', { name: '章' })).getByRole('button', { name: /^要求 1/ }));
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/0');
    const current = screen.getByText('いまここ').closest('[data-req-hunk]')!;
    const id = current.getAttribute('data-req-hunk')!;
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(within(current as HTMLElement).getByRole('button', { name: '「わかった」を外す' })).toBeInTheDocument());
    // App responds to browser history changes, using the same reducer route command.
    await act(async () => {
      window.history.replaceState(null, '', '/local/aaaaaaa/req/end');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Approve の前に' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^全体図/ }));
    await screen.findByLabelText('入口');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'はじめに' })).toBeInTheDocument();
    expect(id).toBe('130e7d62f211839eec7c68582ae3565629d8c673');
  });
  it('saves labelled reviewer drafts through existing App persistence', async () => {
    const a = requirementAnalysis();
    window.history.replaceState(null, '', '/local/aaaaaaa/req/0');
    const fake = fakeApi(a);
    render(<App api={fake.api} />);
    await screen.findByLabelText('要求コース');
    const hunk = screen.getByText('いまここ').closest('[data-req-hunk]')! as HTMLElement;
    fireEvent.click(within(hunk).getByRole('button', { name: '聞く' }));
    fireEvent.change(within(hunk).getByRole('textbox', { name: '聞くこと' }), { target: { value: '理由を教えてください' } });
    expect(within(hunk).getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.mouseDown(within(hunk).getAllByRole('button', { name: /行目にメモ/ })[0]!, { button: 0 });
    fireEvent.mouseUp(window);
    fireEvent.click(within(hunk).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(fake.states.get(`local/${a.pr.headSha}`)?.comments).toEqual([expect.objectContaining({ label: 'ask', source: 'reviewer', body: '理由を教えてください' })]));
    expect(fake.states.get(`local/${a.pr.headSha}`)?.viewed).toContain(hunk.getAttribute('data-req-hunk'));
  });
});

it.each(['ArrowRight', 'Enter'])('explain %s opens the requirement course URL', async (key) => {
  render(<App api={fakeApi(requirementAnalysis()).api} />);
  await screen.findByLabelText('入口');
  fireEvent.keyDown(window, { key });
  await screen.findByLabelText('要求コース');
  expect(window.location.pathname).toBe('/local/aaaaaaa/req/start');
});

it('a legacy course URL is redirected to the requirement course URL', async () => {
  window.history.replaceState(null, '', '/local/aaaaaaa/course/1/summary');
  render(<App api={fakeApi(requirementAnalysis()).api} />);
  await screen.findByLabelText('要求コース');
  await waitFor(() => expect(window.location.pathname).toBe('/local/aaaaaaa/req/start'));
});


it('f toggles between all files and chapter cards in the requirement course', async () => {
  window.history.replaceState(null, '', '/local/aaaaaaa/req/0');
  const a = requirementAnalysis();
  const fake = fakeApi(a);
  const { container } = render(<App api={fake.api} />);
  await screen.findByLabelText('要求コース');
  expect(container.querySelector('[data-req-file]')).not.toBeNull();
  fireEvent.keyDown(window, { key: 'f' });
  expect(container.querySelectorAll('.req-card')).toHaveLength(a.chapters![0]!.hunkIds.length);
  expect(container.querySelector('[data-req-file]')).toBeNull();
  fireEvent.keyDown(window, { key: 'f' });
  expect(container.querySelector('.req-card')).toBeNull();
  expect(container.querySelector('[data-req-file]')).not.toBeNull();
});


it.each(['missing', 'reduce', 'animate'] as const)('keeps focus height with %s view transition support', async (support) => {
  const { withViewTransition } = await import('../src/viewTransition.js');
  const start = vi.fn((update: () => void) => { update(); });
  const descriptor = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: support === 'missing' ? undefined : start });
  const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: support === 'reduce' } as MediaQueryList);
  const center = document.createElement('div');
  center.className = 'req-center';
  const before = document.createElement('section');
  const after = document.createElement('section');
  center.append(before);
  center.scrollTop = 80;
  vi.spyOn(before, 'getBoundingClientRect').mockReturnValue({ top: 120 } as DOMRect);
  vi.spyOn(after, 'getBoundingClientRect').mockReturnValue({ top: 200 } as DOMRect);
  let current: HTMLElement | null = before;
  try {
    withViewTransition(() => { before.replaceWith(after); current = after; }, () => current);
    expect(center.scrollTop).toBe(160);
    expect(start).toHaveBeenCalledTimes(support === 'animate' ? 1 : 0);
    current = null;
    withViewTransition(() => { current = after; }, () => current);
    expect(center.scrollTop).toBe(160);
    withViewTransition(() => { current = null; }, () => current);
    expect(center.scrollTop).toBe(160);
  } finally {
    media.mockRestore();
    if (descriptor) Object.defineProperty(document, 'startViewTransition', descriptor);
    else Reflect.deleteProperty(document, 'startViewTransition');
  }
});
