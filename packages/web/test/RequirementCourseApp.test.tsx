import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { fakeApi } from './fakeApi.js';
import { requirementAnalysis } from './requirementFixture.js';

describe('requirement course in App', () => {
  it('opens from top bar and explain Enter, writes chapter URL, restores a history entry', async () => {
    render(<App api={fakeApi(requirementAnalysis()).api} />);
    await screen.findByLabelText('入口');
    fireEvent.click(screen.getByRole('button', { name: 'コース' }));
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
