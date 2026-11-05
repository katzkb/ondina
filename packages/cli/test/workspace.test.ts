import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceApp, WorkspaceMaker } from '@ondina/model';
import { createWorkspaceRunner, fillWorkspacePrompt, splitAgent, type WorkspaceDeps } from '../src/workspace.js';
import { readWorkspaces, writeUi } from '../src/store.js';

const dirs: string[] = [];
const temp = () => { const p = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ondina-workspace-'))); dirs.push(p); return p; };
afterEach(() => dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));
const input = { branch: 'feature/discount', title: '割引 {url}', url: 'https://example.com/pull/7' };
const cases = [
  ['{pr}:{title}:{branch}:{url}:{other}', '7:割引 {url}:feature/discount:https://example.com/pull/7:{other}'],
  ['{pr} {pr} {{pr}} {unknown}', '7 7 {7} {unknown}'],
  ['', ''],
];
it.each(cases)('fills only known variables once: %s', (template, expected) => {
  expect(fillWorkspacePrompt(template!, { pr: '7', ...input })).toBe(expected);
});
it('splits agent arguments with simple quotes', () => {
  expect(splitAgent('claude --model "some model" \'two words\'')).toEqual(['claude', '--model', 'some model', 'two words']);
});

function fixture(app: WorkspaceApp, maker: WorkspaceMaker, options: { existing?: boolean; open?: boolean; fail?: string; stderr?: string; staleBranch?: boolean; omitOrcaPath?: boolean; currentBranch?: string; agent?: string; prompt?: string } = {}) {
  const repo = temp();
  const worktree = temp();
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const exec: WorkspaceDeps['exec'] = async (cmd, args, { cwd }) => {
    calls.push({ cmd, args, cwd });
    if (options.fail && `${cmd} ${args.join(' ')}`.includes(options.fail)) return { code: 1, stdout: '', stderr: options.stderr ?? 'first reason\nsecond reason' };
    if (cmd === 'git' && args[0] === '-C') return { code: 0, stdout: options.currentBranch ?? input.branch, stderr: '' };
    if (cmd === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: options.staleBranch && args[1]?.startsWith('refs/heads/') ? 'local-head' : 'remote-head', stderr: '' };
    let out: unknown = {};
    if (cmd === 'git' && args[0] === 'show-ref') return { code: 1, stdout: '', stderr: '' };
    if (cmd === 'git' && args[0] === 'worktree' && args[1] === 'list') return { code: 0, stdout: options.existing || (options.omitOrcaPath && calls.some((c) => c.cmd === 'orca' && c.args[1] === 'create')) ? `worktree ${worktree}\nHEAD abc\nbranch refs/heads/${input.branch}\n` : '', stderr: '' };
    if (cmd === 'gct') return { code: 0, stdout: `created\n${worktree}\n`, stderr: 'Warning: post-create hook failed' };
    if (cmd === 'herdr-app' && args[0] === 'ls') out = { spaces: options.open ? [{ id: 'space1', folder: worktree }] : [] };
    if (cmd === 'herdr' && args[1] === 'list') out = { result: { worktrees: options.open ? [{ path: worktree, open_workspace_id: 'workspace1' }] : [] } };
    if (cmd === 'herdr' && ['create', 'open'].includes(args[1]!)) out = { result: { worktree: { path: worktree }, root_pane: { pane_id: 'pane1' }, workspace: { workspace_id: 'workspace1' } } };
    if (cmd === 'orca') out = args[1] === 'list' ? { terminals: options.open ? [{ handle: 'terminal1' }] : [] } : options.omitOrcaPath ? { result: { launch: { worktreeId: `repo::${worktree}` } } } : { worktree: { path: worktree } };
    return { code: 0, stdout: JSON.stringify(out), stderr: '' };
  };
  writeUi(repo, { workspace: { app, maker, agent: options.agent ?? 'claude --model "some model"', prompt: options.prompt ?? '{pr} {title}' } });
  const deps = { exec, which: (cmd: string) => cmd !== 'gct', home: repo };
  const runner = createWorkspaceRunner(repo, deps);
  const finish = async () => { await vi.waitFor(() => expect(runner.jobs()[0]?.status).not.toBe('running')); return runner.jobs()[0]!; };
  return { repo, worktree, calls, runner, finish, deps };
}

describe('app × maker', () => {
  for (const app of ['herdr-app', 'herdr', 'orca'] as const) for (const maker of ['gct', 'app'] as const) {
    it(`${app} / ${maker} opens the PR branch, registers and launches once`, async () => {
      const f = fixture(app, maker);
      expect(f.runner.start('7', input)).toMatchObject({ status: 'running', key: '7', app });
      expect(f.runner.start('7', input)).toEqual({ error: 'busy' });
      const job = await f.finish();
      expect(job.status).toBe('done');
      expect(job.done).toBe(job.steps.length);
      expect(readWorkspaces(f.repo)['7']).toMatchObject({ app, path: job.path, branch: input.branch });
      if (maker === 'gct') {
        expect(f.calls[0]).toEqual({ cmd: 'gct', args: ['wt', input.branch], cwd: f.repo });
        expect(f.calls.some((c) => c.cmd === 'git' && c.args[0] === 'fetch')).toBe(false);
      } else {
        expect(f.calls[0]?.args).toEqual(['fetch', 'origin', input.branch]);
        expect(f.calls.some((c) => c.args.join(' ') === `branch --track ${input.branch} origin/${input.branch}`)).toBe(true);
      }
      if (app === 'herdr-app') {
        const call = f.calls.find((c) => c.args[1] === 'space.new')!;
        expect(call.args).toHaveLength(3);
        expect(JSON.parse(call.args[2]!)).toMatchObject({ folder: job.path, argv: ['claude', '--model', 'some model'], task: '7 割引 {url}' });
      }
      if (app === 'herdr') {
        expect(f.calls.find((c) => c.args[1] === 'start')?.args).toEqual(['agent', 'start', 'review-7', '--kind', 'claude', '--pane', 'pane1', '--', '--model', 'some model']);
        expect(f.calls.find((c) => c.args[1] === 'prompt')?.args).toEqual(['agent', 'prompt', 'pane1', '7 割引 {url}']);
      }
      if (app === 'orca' && maker === 'app') {
        expect(f.calls.find((c) => c.args[1] === 'create')?.args).toEqual(['worktree', 'create', '--repo', `path:${f.repo}`, '--name', 'feature-discount', '--branch', input.branch, '--base-branch', `origin/${input.branch}`, '--pr', '7', '--no-parent', '--activate', '--json', '--agent', 'claude', '--prompt', '7 割引 {url}']);
        expect(f.calls.filter((c) => c.cmd === 'orca')).toHaveLength(1);
      }
      expect(f.runner.tools()).toMatchObject({ gct: false, herdrApp: true, herdr: true, orca: true, defaultPrompt: expect.any(String) });
      expect(createWorkspaceRunner(f.repo, f.deps).jobs()).toMatchObject([{ key: '7', status: 'done', path: job.path }]);
    });
  }
});

it.each(['herdr-app', 'herdr', 'orca'] as const)('re-press only focuses %s, including after restart', async (app) => {
  const f = fixture(app, 'gct', { open: true });
  f.runner.start('7', input);
  await f.finish();
  f.calls.length = 0;
  const restored = createWorkspaceRunner(f.repo, f.deps);
  restored.start('7', input);
  await vi.waitFor(() => expect(restored.jobs()[0]?.status).toBe('done'));
  expect(f.calls).toHaveLength(2);
  expect(f.calls.every((c) => !['create', 'launch', 'start', 'space.new'].some((word) => c.args.includes(word)))).toBe(true);
});
it.each(['herdr-app', 'herdr', 'orca'] as const)('reuses a checked-out PR branch for %s', async (app) => {
  const f = fixture(app, 'app', { existing: true, open: true });
  f.runner.start('7', input);
  expect((await f.finish()).status).toBe('done');
  expect(f.calls.some((c) => c.args.includes('create') || c.args.includes('add') || c.args.includes('start') || c.args.includes('launch') || c.args.includes('space.new'))).toBe(false);
});
it('empty agent and prompt do not launch or send (herdr-app)', async () => {
  const f = fixture('herdr-app', 'gct', { agent: '', prompt: '' });
  f.runner.start('7', input); await f.finish();
  expect(JSON.parse(f.calls.find((c) => c.args[1] === 'space.new')!.args[2]!)).toEqual({ folder: f.worktree });
});
it('empty orca agent opens a terminal', async () => {
  const f = fixture('orca', 'gct', { agent: '', prompt: '' });
  f.runner.start('7', input); await f.finish();
  expect(f.calls.at(-1)?.args).toEqual(['terminal', 'create', '--worktree', `path:${f.worktree}`]);
});
it.each([
  ['herdr-app', 'app', 'git fetch', /first reason/],
  ['herdr-app', 'gct', 'gct wt', /first reason/],
  ['herdr', 'gct', 'herdr agent start', /first reason/],
  ['orca', 'gct', 'orca agent launch', /first reason/],
] as const)('reports %s failure at %s %s', async (app, maker, fail, error) => {
  const f = fixture(app, maker, { fail });
  f.runner.start('7', input);
  expect(await f.finish()).toMatchObject({ status: 'failed', error: expect.stringMatching(error) });
});
it('rejects unsupported herdr agent commands', async () => {
  const f = fixture('herdr', 'gct', { agent: 'mystery-ai' });
  f.runner.start('7', input);
  expect(await f.finish()).toMatchObject({ status: 'failed', error: expect.stringContaining('mystery-ai') });
});
it('rejects missing settings, malformed PR keys and option-like branches', () => {
  const f = fixture('orca', 'app');
  expect(f.runner.start('local', input)).toEqual({ error: 'missing' });
  expect(f.runner.start('7', { ...input, branch: '--help' })).toEqual({ error: 'invalid' });
  writeUi(f.repo, {});
  expect(f.runner.start('7', input)).toEqual({ error: 'noapp' });
});

it('reopening a Herdr app record without a space registers it without another agent or task', async () => {
  const f = fixture('herdr-app', 'gct');
  f.runner.start('7', input); await f.finish();
  f.calls.length = 0;
  f.runner.start('7', input); await f.finish();
  expect(JSON.parse(f.calls.find((c) => c.args[1] === 'space.new')!.args[2]!)).toEqual({ folder: f.worktree });
});
it('orca switches using the terminal handle option', async () => {
  const f = fixture('orca', 'gct', { open: true });
  f.runner.start('7', input); await f.finish();
  expect(f.calls.at(-1)?.args).toEqual(['terminal', 'switch', '--terminal', 'terminal1']);
});
it.each(['app', 'gct'] as const)('reports a missing origin branch for %s', async (maker) => {
  const f = fixture('herdr-app', maker, { fail: maker === 'app' ? 'git fetch' : 'gct wt', stderr: "fatal: couldn't find remote ref feature/discount" });
  f.runner.start('7', input);
  expect((await f.finish()).error).toBe('PR のブランチ feature/discount が origin にありません（fork からの PR は今は開けません）');
});
it.each(['', 'claude'] as const)('explains an unknown external orca worktree with agent %s', async (agent) => {
  const f = fixture('orca', 'gct', { agent, fail: 'orca terminal list', stderr: 'worktree_not_found: unknown worktree' });
  f.runner.start('7', input);
  expect((await f.finish()).error).toBe('orca にこの worktree が出ていません。orca のリポジトリ設定で、orca の外で作った worktree を出すようにしてください');
});
it('herdr supports a custom command for another supported kind', async () => {
  const f = fixture('herdr', 'gct', { agent: '/bin/pi --flag', prompt: '' });
  f.runner.start('7', input);
  expect((await f.finish()).status).toBe('done');
  expect(f.calls.find((c) => c.args[1] === 'start')?.args).toEqual(['agent', 'start', 'review-7', '--kind', 'pi', '--pane', 'pane1', '--', '--flag']);
  expect(f.calls.some((c) => c.args[1] === 'prompt')).toBe(false);
});

it('orca refuses to create a suffixed branch when the local PR branch differs from origin', async () => {
  const f = fixture('orca', 'app', { staleBranch: true });
  f.runner.start('7', input);
  expect(await f.finish()).toMatchObject({ status: 'failed', error: expect.stringContaining('origin/feature/discount') });
  expect(f.calls.some((c) => c.cmd === 'orca' && c.args[1] === 'create')).toBe(false);
});
it('focuses a newly created herdr workspace even when no agent is requested', async () => {
  const f = fixture('herdr', 'app', { agent: '' });
  f.runner.start('7', input);
  expect((await f.finish()).status).toBe('done');
  expect(f.calls.find((c) => c.cmd === 'herdr' && c.args[0] === 'workspace')?.args).toEqual(['workspace', 'focus', 'workspace1']);
  expect(f.calls.some((c) => c.args[0] === 'agent')).toBe(false);
});

it('does not report success if Orca returns a worktree on another branch', async () => {
  const f = fixture('orca', 'app', { currentBranch: 'feature/discount-2' });
  f.runner.start('7', input);
  expect(await f.finish()).toMatchObject({ status: 'failed', error: expect.stringContaining('feature/discount-2') });
});
it('recovers the path from git when Orca launched but omitted worktree details', async () => {
  const f = fixture('orca', 'app', { omitOrcaPath: true });
  f.runner.start('7', input);
  expect(await f.finish()).toMatchObject({ status: 'done', path: f.worktree });
  expect(f.calls.filter((c) => c.cmd === 'orca')).toHaveLength(1);
});
it('adds a polite explanation to an unexpected app response error', async () => {
  const f = fixture('herdr-app', 'gct');
  const runner = createWorkspaceRunner(f.repo, { ...f.deps, exec: async (cmd, args, options) => cmd === 'herdr-app' ? { code: 0, stdout: '<not JSON', stderr: '' } : f.deps.exec(cmd, args, options) });
  runner.start('7', input);
  await vi.waitFor(() => expect(runner.jobs()[0]?.status).toBe('failed'));
  expect(runner.jobs()[0]?.error).toContain('作業場を開けませんでした');
});
