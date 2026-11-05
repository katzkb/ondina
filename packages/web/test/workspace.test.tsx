import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceJob, WorkspaceTools } from '@ondina/model';
import { fillWorkspacePrompt } from '../src/prs.js';
import { initialState, reduce } from '../src/state/reducer.js';
import { SettingsModal } from '../src/components/SettingsModal.js';
import { PrListView } from '../src/components/PrListView.js';
import { openPr, prList } from './prFixture.js';

const cases = [
  ['{pr}:{title}:{branch}:{url}:{other}', '7:割引 {url}:feature/discount:https://example.com/pull/7:{other}'],
  ['{pr} {pr} {{pr}} {unknown}', '7 7 {7} {unknown}'],
  ['', ''],
];
it.each(cases)('previews only known variables once: %s', (template, expected) => {
  expect(fillWorkspacePrompt(template!, { pr: '7', title: '割引 {url}', branch: 'feature/discount', url: 'https://example.com/pull/7' })).toBe(expected);
});
const tools: WorkspaceTools = { gct: false, herdrApp: true, herdr: false, orca: true, defaultPrompt: 'PR #{pr}「{title}」 {branch} {url}' };
const job: WorkspaceJob = { key: '7', app: 'orca', status: 'running', steps: ['ブランチを取得する', 'worktree を用意する', 'アプリで開く'], done: 1, startedAt: '2026-11-06T00:00:00Z' };
it('workspace commands save settings, preserve empty values, insert at cursor and emit one start effect', () => {
  let s = initialState();
  const saved = reduce(s, { id: 'ui.workspace', patch: { app: 'orca', agent: '', prompt: '' } });
  expect(saved.effects).toEqual([{ type: 'saveUi' }]);
  s = saved.state;
  expect(s.ui.workspace).toEqual({ app: 'orca', agent: '', prompt: '' });
  s = reduce(s, { id: 'ui.workspace', patch: { prompt: 'abc xyz' } }).state;
  s = reduce(s, { id: 'ui.workspace.insert', variable: '{pr}', start: 4, end: 7 }).state;
  expect(s.ui.workspace?.prompt).toBe('abc {pr}');
  const command = { id: 'pr.workspace', now: '2026-11-06T00:00:00Z', key: '7', branch: 'feature/discount', title: '割引', url: 'https://example.com' } as const;
  const started = reduce(s, command);
  expect(started.effects).toEqual([{ type: 'startWorkspace', key: '7', branch: command.branch, title: command.title, url: command.url }]);
  expect(reduce(started.state, command).effects).toEqual([]);
  const done = reduce(started.state, { id: 'workspace.jobs', jobs: [{ ...job, status: 'done', done: 3 }] }).state;
  expect(done.workspaces[0]?.status).toBe('done');
  expect(reduce(done, command).effects).toHaveLength(1);
});
it('general settings expose missing tools, presets and a live template preview', () => {
  const dispatch = vi.fn();
  const s = initialState();
  render(<SettingsModal tab="general" theme={{ mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' }} worktreeRoot="" llmCommand="" reviewCommand="" ticket={{}} workspace={{ app: 'orca' }} workspaceTools={tools} dispatch={dispatch} />);
  expect(screen.getByText('レビュー用の作業場')).toBeInTheDocument();
  expect(screen.getByText(/gct が見つかりません/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('開く先'), { target: { value: 'herdr-app' } });
  expect(dispatch).toHaveBeenLastCalledWith({ id: 'ui.workspace', patch: { app: 'herdr-app' } });
  fireEvent.click(screen.getByRole('button', { name: '起動しない' }));
  expect(dispatch).toHaveBeenLastCalledWith({ id: 'ui.workspace', patch: { agent: '' } });
  fireEvent.change(screen.getByLabelText('最初に送る指示'), { target: { value: '{title} {other}' } });
  expect(dispatch).toHaveBeenLastCalledWith({ id: 'ui.workspace', patch: { prompt: '{title} {other}' } });
  expect(screen.getByText('#1234 だとこう送ります')).toBeInTheDocument();
  expect(screen.getByText(/PR #1234「/)).toBeInTheDocument();
  const field = screen.getByLabelText('最初に送る指示') as HTMLTextAreaElement;
  field.setSelectionRange(3, 5);
  fireEvent.click(screen.getByRole('button', { name: '{branch} ブランチ' }));
  expect(dispatch).toHaveBeenLastCalledWith({ id: 'ui.workspace.insert', variable: '{branch}', start: 3, end: 5 });
  expect(s.workspaces).toEqual([]);
});
function cards(jobs: WorkspaceJob[] = [], enabled = true, detail = false) {
  const dispatch = vi.fn();
  const s = initialState();
  render(<PrListView prs={{ ...s.prs, list: prList([openPr()]), detail: detail ? { number: 7, tab: 'desc' } : null }} analyses={[]} jobs={[]} reviews={[]} reviewEnabled={false} workspaces={jobs} workspaceEnabled={enabled} flavor="mocha" dispatch={dispatch} />);
  return dispatch;
}
describe('作業場 row', () => {
  it('starts with PR head, title and URL through a command id', () => {
    const dispatch = cards();
    fireEvent.click(screen.getByRole('button', { name: 'レビュー用に開く' }));
    expect(dispatch).toHaveBeenCalledWith({ id: 'pr.workspace', now: expect.any(String), key: '7', branch: 'feature/discount', title: '割引を足す', url: openPr().url });
  });
  it('hides disabled row on the card and shows settings guidance in the drawer', () => {
    cards([], false, true);
    expect(screen.queryByRole('button', { name: 'レビュー用に開く' })).not.toBeInTheDocument();
    expect(screen.getAllByText('作業場')).toHaveLength(1);
    const drawer = screen.getByRole('complementary', { name: 'PR の詳細' });
    expect(within(drawer).getByText(/レビュー用の作業場/)).toBeInTheDocument();
  });
  it('shows checked completed steps while running', () => {
    cards([job]);
    expect(screen.getByText('✓ ブランチを取得する')).toBeInTheDocument();
    expect(screen.getByText('worktree を用意する')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'レビュー用に開く' })).not.toBeInTheDocument();
  });
  it('shows app name and an open button on completion', () => {
    cards([{ ...job, status: 'done', done: 3 }]);
    expect(screen.getByText('orca で開いています')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '開く' })).toBeInTheDocument();
  });
  it('shows the failure reason and retry', () => {
    cards([{ ...job, status: 'failed', error: '起動できませんでした' }]);
    expect(screen.getByText('起動できませんでした')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'もう一度' })).toBeInTheDocument();
  });
});

it('an API start failure remains visible when polling has no server job', () => {
  let s = initialState();
  s = reduce(s, { id: 'ui.workspace', patch: { app: 'orca' } }).state;
  s = reduce(s, { id: 'pr.workspace', now: '2026-11-06T00:00:00Z', key: '7', branch: 'b', title: 't', url: 'u' }).state;
  s = reduce(s, { id: 'workspace.startFailed', key: '7', reason: '起動できませんでした' }).state;
  s = reduce(s, { id: 'workspace.jobs', jobs: [] }).state;
  expect(s.workspaces[0]).toMatchObject({ status: 'failed', error: '起動できませんでした' });
});

it('App saves settings, starts a workspace from the PR list and polls it to completion', async () => {
  const { App } = await import('../src/App.js');
  const { fakeApi } = await import('./fakeApi.js');
  const { waitFor } = await import('@testing-library/react');
  const f = fakeApi(undefined, { noAnalyses: true, prs: () => prList([openPr()]), ui: { workspace: { app: 'orca' } } });
  let jobs: WorkspaceJob[] = [];
  f.api.workspaceTools = async () => tools;
  f.api.workspaceStatus = async () => jobs.map((j) => ({ ...j }));
  const start = vi.fn(async () => { jobs = [{ ...job }]; return jobs[0]!; });
  f.api.startWorkspace = start;
  render(<App api={f.api} />);
  fireEvent.click(await screen.findByRole('button', { name: 'レビュー用に開く' }));
  await screen.findByText('✓ ブランチを取得する');
  expect(start).toHaveBeenCalledExactlyOnceWith('7', { branch: openPr().head, title: openPr().title, url: openPr().url });
  jobs = [{ ...job, status: 'done', done: 3 }];
  await waitFor(() => expect(screen.getByText('orca で開いています')).toBeInTheDocument(), { timeout: 2500 });
  fireEvent.click(screen.getByRole('button', { name: '設定' }));
  await screen.findByText('#1234 だとこう送ります');
  fireEvent.change(screen.getByLabelText('開く先'), { target: { value: 'herdr-app' } });
  fireEvent.click(screen.getByRole('button', { name: '起動しない' }));
  fireEvent.change(screen.getByLabelText('最初に送る指示'), { target: { value: 'レビュー {pr} {branch}' } });
  await waitFor(async () => expect((await f.api.getUi()).workspace).toEqual({ app: 'herdr-app', agent: '', prompt: 'レビュー {pr} {branch}' }));
});

it('waits for pending settings writes before posting a workspace launch', async () => {
  const { App } = await import('../src/App.js');
  const { fakeApi } = await import('./fakeApi.js');
  const { act, waitFor } = await import('@testing-library/react');
  const f = fakeApi(undefined, { noAnalyses: true, prs: () => prList([openPr()]), ui: { workspace: { app: 'orca' } } });
  let save: (() => void) | undefined;
  f.api.putUi = () => new Promise<void>((resolve) => { save = resolve; });
  const start = vi.spyOn(f.api, 'startWorkspace');
  render(<App api={f.api} />);
  await screen.findByRole('button', { name: 'レビュー用に開く' });
  fireEvent.click(screen.getByRole('button', { name: '設定' }));
  fireEvent.click(screen.getByRole('button', { name: '起動しない' }));
  await waitFor(() => expect(save).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: /閉じる/ }));
  fireEvent.click(screen.getByRole('button', { name: 'レビュー用に開く' }));
  expect(start).not.toHaveBeenCalled();
  await act(async () => { save!(); });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
});
