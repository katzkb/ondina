// PR のブランチをレビュー用に開く。外部コマンドはシェルを通さず、アプリごとの表から実行する。
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkspaceApp, WorkspaceJob, WorkspaceRecord, WorkspaceSettings, WorkspaceTools } from '@ondina/model';
import { readUi, readWorkspaces, writeWorkspaces } from './store.js';

export const DEFAULT_WORKSPACE_PROMPT = 'PR #{pr}「{title}」のレビューを手伝ってください。\nこの worktree は PR のブランチ {branch} です。';
export interface WorkspaceInput { branch: string; title: string; url: string }
export interface WorkspaceDeps {
  exec(cmd: string, args: string[], options: { cwd: string }): Promise<{ code: number; stdout: string; stderr: string }>;
  which(cmd: string): boolean;
  home: string;
  now(): string;
}
export interface WorkspaceRunner {
  start(key: string, input: WorkspaceInput): WorkspaceJob | { error: 'busy' | 'missing' | 'noapp' | 'invalid' };
  jobs(): WorkspaceJob[];
  tools(): WorkspaceTools;
}
export function fillWorkspacePrompt(template: string, values: WorkspaceInput & { pr: string }): string {
  return template.replace(/\{(pr|title|branch|url)\}/g, (_, key: keyof typeof values) => values[key]);
}
/** シェルは使わない。空白と単一・二重引用符だけで argv に分ける */
export function splitAgent(command: string): string[] {
  const words: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s"']+)/g;
  let word = '';
  let end = 0;
  for (const match of command.matchAll(re)) {
    if (match.index > end && word !== '') { words.push(word); word = ''; }
    word += match[1]?.replace(/\\(["\\])/g, '$1') ?? match[2] ?? match[3] ?? '';
    end = match.index + match[0].length;
  }
  if (word !== '') words.push(word);
  return words;
}
const defaultDeps: WorkspaceDeps = {
  home: os.homedir(), now: () => new Date().toISOString(),
  which: (cmd) => (process.env['PATH'] ?? '').split(path.delimiter).some((dir) => {
    try { accessSync(path.join(dir, cmd), constants.X_OK); return true; } catch { return false; }
  }),
  exec: (cmd, args, options) => new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (s: Buffer) => { stdout += s.toString(); });
    child.stderr.on('data', (s: Buffer) => { stderr += s.toString(); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  }),
};

// ツールの理由に日本語の説明を付けた失敗と、予期しない例外を分ける。
class WorkspaceError extends Error {}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Json : {};
function parsed(stdout: string): Json { return obj(JSON.parse(stdout)); }
function rows(value: unknown, key: string): Json[] {
  if (Array.isArray(value)) return value.map(obj);
  const doc = obj(value);
  if (Array.isArray(doc[key])) return (doc[key] as unknown[]).map(obj);
  if (doc['result'] !== undefined) return rows(doc['result'], key);
  if (doc['data'] !== undefined) return rows(doc['data'], key);
  return [];
}
function result(stdout: string): Json {
  const doc = parsed(stdout);
  return obj(doc['result'] ?? doc['data'] ?? doc);
}
function required(v: unknown, name: string): string {
  if (typeof v !== 'string' || v === '') throw new WorkspaceError(`${name} を取得できませんでした`);
  return v;
}
interface Context {
  doneBranch(): void;
  key: string; repo: string; input: WorkspaceInput; job: WorkspaceJob;
  argv: string[]; prompt: string; deps: WorkspaceDeps;
  pane?: string; workspace?: string; created?: boolean; focused?: boolean;
  run(cmd: string, args: string[]): Promise<string>;
}
const folder = (c: Context): string => required(c.job.path, 'worktree のパス');
async function checkedOut(c: Context): Promise<string | undefined> {
  const text = await c.run('git', ['worktree', 'list', '--porcelain']);
  for (const block of text.split(/\n\n/)) {
    const lines = block.split('\n');
    if (lines.includes(`branch refs/heads/${c.input.branch}`)) return lines.find((l) => l.startsWith('worktree '))?.slice(9);
  }
  return undefined;
}
function herdrIds(c: Context, stdout: string): void {
  const data = result(stdout);
  c.pane = required(obj(data['root_pane'])['pane_id'], 'herdr の pane_id');
  c.workspace = required(obj(data['workspace'])['workspace_id'], 'herdr の workspace_id');
  c.job.path = required(obj(data['worktree'])['path'], 'herdr の worktree.path');
}
async function herdrFocus(c: Context): Promise<boolean> {
  const list = rows(JSON.parse(await c.run('herdr', ['worktree', 'list'])), 'worktrees');
  const id = list.find((w) => w['path'] === folder(c))?.['open_workspace_id'];
  if (typeof id !== 'string' || !id) return false;
  await c.run('herdr', ['workspace', 'focus', id]);
  return true;
}
const ORCA_UNKNOWN = 'orca にこの worktree が出ていません。orca のリポジトリ設定で、orca の外で作った worktree を出すようにしてください';
async function orcaLaunch(c: Context): Promise<void> {
  const args = c.argv.length ? ['agent', 'launch', '--agent', c.argv[0]!, '--worktree', `path:${folder(c)}`, ...(c.prompt ? ['--prompt', c.prompt] : []), '--focus', '--json'] : ['terminal', 'create', '--worktree', `path:${folder(c)}`];
  await c.run('orca', args);
}
async function orcaFocus(c: Context): Promise<void> {
  const list = rows(JSON.parse(await c.run('orca', ['terminal', 'list', '--worktree', `path:${folder(c)}`, '--json'])), 'terminals');
  const terminal = list[0];
  if (terminal) await c.run('orca', ['terminal', 'switch', '--terminal', required(terminal['handle'] ?? terminal['id'] ?? terminal['terminalId'], 'orca の terminal id')]);
  else await orcaLaunch(c);
}
async function appSpace(c: Context, launch = true): Promise<void> {
  const spaces = rows(JSON.parse(await c.run('herdr-app', ['ls'])), 'spaces');
  const space = spaces.find((s) => s['folder'] === folder(c));
  if (space) { await c.run('herdr-app', ['do', 'space.select', JSON.stringify({ id: required(space['id'], 'Herdr の space id') })]); return; }
  await c.run('herdr-app', ['do', 'space.new', JSON.stringify({ folder: folder(c), ...(launch && c.argv.length ? { argv: c.argv } : {}), ...(launch && c.prompt ? { task: c.prompt } : {}) })]);
}
interface AppAdapter {
  create(c: Context): Promise<void>;
  register(c: Context): Promise<void>;
  agent?: (c: Context) => Promise<void>;
  focus(c: Context): Promise<void>;
}
// herdr agent start --help の対応 kind（2026-11-06）。任意コマンドは kind に対応する実行名を使う
const HERDR_KINDS = new Set(['pi', 'claude', 'codex', 'gemini', 'cursor', 'devin', 'agy', 'cline', 'omp', 'mastracode', 'opencode', 'copilot', 'kimi', 'kiro', 'droid', 'amp', 'grok', 'hermes', 'kilo', 'qodercli', 'qwen', 'letta', 'maki', 'muse']);
const apps: Record<WorkspaceApp, AppAdapter> = {
  'herdr-app': {
    async create(c) {
      c.job.path = path.join(c.deps.home, '.herdr', 'worktrees', path.basename(c.repo), c.input.branch);
      await c.run('git', ['worktree', 'add', folder(c), c.input.branch]);
    },
    register: appSpace, focus: (c) => appSpace(c, false),
  },
  herdr: {
    async create(c) {
      herdrIds(c, await c.run('herdr', ['worktree', 'create', '--cwd', c.repo, '--branch', c.input.branch, '--no-focus']));
      c.created = true;
    },
    async register(c) {
      if (c.created) {
        await c.run('herdr', ['workspace', 'focus', c.workspace!]);
        return;
      }
      c.focused = await herdrFocus(c);
      if (!c.focused) herdrIds(c, await c.run('herdr', ['worktree', 'open', '--cwd', c.repo, '--path', folder(c), '--focus']));
    },
    async agent(c) {
      if (c.focused || c.argv.length === 0) return;
      const kind = path.basename(c.argv[0]!);
      if (!HERDR_KINDS.has(kind)) throw new WorkspaceError(`herdr では ${c.argv[0]} を起動できません。起動する AI のコマンドを変えてください`);
      await c.run('herdr', ['agent', 'start', `review-${c.key}`, '--kind', kind, '--pane', required(c.pane, 'herdr の pane_id'), '--', ...c.argv.slice(1)]);
      if (c.prompt) await c.run('herdr', ['agent', 'prompt', c.pane!, c.prompt]);
    },
    async focus(c) {
      if (!(await herdrFocus(c))) await c.run('herdr', ['worktree', 'open', '--cwd', c.repo, '--path', folder(c), '--focus']);
    },
  },
  orca: {
    async create(c) {
      // Orca は base と違う既存ブランチ名に接尾辞を付けるため、別名を作る前に止める。
      const local = (await c.run('git', ['rev-parse', `refs/heads/${c.input.branch}`])).trim();
      const remote = (await c.run('git', ['rev-parse', `refs/remotes/origin/${c.input.branch}`])).trim();
      if (local !== remote) throw new WorkspaceError(`ローカルのブランチ ${c.input.branch} が origin/${c.input.branch} と異なります。ブランチの内容を確認して origin とそろえてから、もう一度開いてください`);

      const args = ['worktree', 'create', '--repo', `path:${c.repo}`, '--name', c.input.branch.replaceAll('/', '-'), '--branch', c.input.branch, '--base-branch', `origin/${c.input.branch}`, '--pr', c.key, '--no-parent', '--activate', '--json', ...(c.argv.length ? ['--agent', c.argv[0]!, ...(c.prompt ? ['--prompt', c.prompt] : [])] : [])];
      const data = result(await c.run('orca', args));
      c.job.path = required(obj(data['worktree'])['path'] ?? data['worktreePath'] ?? data['path'] ?? await checkedOut(c), 'orca の worktree.path');
      const branch = (await c.run('git', ['-C', folder(c), 'branch', '--show-current'])).trim();
      if (branch !== c.input.branch) throw new WorkspaceError(`orca が別のブランチ ${branch} を開きました。PR のブランチ ${c.input.branch} を開けませんでした`);
      c.created = true;
    },
    async register(c) { if (!c.created) await orcaFocus(c); },
    focus: orcaFocus,
  },
};
const makers = {
  async gct(c: Context) {
    let stdout: string;
    try { stdout = await c.run('gct', ['wt', c.input.branch]); }
    catch (e) {
      if (/couldn't find remote ref|not.*(?:on|in) origin|remote branch.*not found/i.test(e instanceof Error ? e.message : String(e))) throw new WorkspaceError(missingBranch(c.input.branch));
      throw e;
    }
    const last = stdout.trim().split('\n').at(-1)?.trim();
    c.job.path = realpathSync(path.resolve(c.repo, required(last, 'gct の worktree パス')));
  },
  async app(c: Context, app: AppAdapter) {
    try { await c.run('git', ['fetch', 'origin', c.input.branch]); }
    catch (e) {
      if (/couldn't find remote ref|remote branch.*not found/i.test(e instanceof Error ? e.message : String(e))) throw new WorkspaceError(missingBranch(c.input.branch));
      throw e;
    }
    const local = await c.deps.exec('git', ['show-ref', '--verify', '--quiet', `refs/heads/${c.input.branch}`], { cwd: c.repo });
    if (local.code !== 0) await c.run('git', ['branch', '--track', c.input.branch, `origin/${c.input.branch}`]);
    c.doneBranch();
    const existing = await checkedOut(c);
    if (existing) c.job.path = existing;
    else await app.create(c);
  },
};
function missingBranch(branch: string): string {
  return `PR のブランチ ${branch} が origin にありません（fork からの PR は今は開けません）`;
}

export function createWorkspaceRunner(repo: string, deps: Partial<WorkspaceDeps> = {}): WorkspaceRunner {
  const d = { ...defaultDeps, ...deps };
  const latest = new Map<string, WorkspaceJob>();
  for (const [key, r] of Object.entries(readWorkspaces(repo))) {
    latest.set(key, { key, app: r.app, status: 'done', steps: [], done: 0, path: r.path, startedAt: r.openedAt });
  }
  async function launch(job: WorkspaceJob, input: WorkspaceInput, settings: WorkspaceSettings, record?: WorkspaceRecord): Promise<void> {
    const adapter = apps[job.app];
    const maker = settings.maker ?? 'app';
    const c: Context = {
      key: job.key, repo, input, job, deps: d,
      argv: splitAgent(settings.agent ?? 'claude'),
      prompt: fillWorkspacePrompt(settings.prompt ?? DEFAULT_WORKSPACE_PROMPT, { pr: job.key, ...input }),
      doneBranch: () => { job.done++; },
      async run(cmd, args) {
        try {
          const out = await d.exec(cmd, args, { cwd: repo });
          if (out.code !== 0) throw new WorkspaceError(out.stderr.trim().split('\n')[0] || `終了コード ${out.code}`);
          return out.stdout;
        } catch (e) {
          const reason = e instanceof Error ? e.message.split('\n')[0]! : String(e);
          if (cmd === 'orca' && /unknown.*worktree|worktree.*(?:unknown|not found)|worktree_not_found/i.test(reason)) throw new WorkspaceError(ORCA_UNKNOWN);
          throw new WorkspaceError(`${reason}（${cmd} を実行できませんでした）`);
        }
      },
    };
    try {
      if (record) { job.path = record.path; await adapter.focus(c); job.done++; }
      else {
        await makers[maker](c, adapter); job.done++;
        await adapter.register(c); job.done++;
        if (adapter.agent && c.argv.length) { await adapter.agent(c); job.done++; }
      }
      writeWorkspaces(repo, { ...readWorkspaces(repo), [job.key]: { app: job.app, path: folder(c), branch: record?.branch ?? input.branch, openedAt: d.now() } });
      job.status = 'done';
    } catch (e) {
      job.status = 'failed';
      job.error = e instanceof WorkspaceError ? e.message : `${e instanceof Error ? e.message.split('\n')[0] : String(e)}（作業場を開けませんでした）`;
    }
  }
  return {
    jobs: () => [...latest.values()],
    tools: () => ({ gct: d.which('gct'), herdrApp: d.which('herdr-app'), herdr: d.which('herdr'), orca: d.which('orca'), defaultPrompt: DEFAULT_WORKSPACE_PROMPT }),
    start(key, input) {
      if (!/^[1-9][0-9]*$/.test(key)) return { error: 'missing' };
      if (latest.get(key)?.status === 'running') return { error: 'busy' };
      const settings = readUi(repo).workspace ?? {};
      if (!settings.app) return { error: 'noapp' };
      if (!input.branch || input.branch.startsWith('-') || /[\s\x00-\x1f]/.test(input.branch) || input.branch.split('/').some((part) => part === '..' || part === '.' || part === '')) return { error: 'invalid' };
      const saved = readWorkspaces(repo)[key];
      const record = saved && existsSync(saved.path) ? saved : undefined;
      const app = record?.app ?? settings.app;
      const agent = splitAgent(settings.agent ?? 'claude');
      const steps = record ? ['作業場を開く'] : [...((settings.maker ?? 'app') === 'app' ? ['PR のブランチを取得する'] : []), 'worktree を用意する', 'アプリで開く', ...(apps[app].agent && agent.length ? ['AI を起動して指示を送る'] : [])];
      const job: WorkspaceJob = { key, app, status: 'running', steps, done: 0, startedAt: d.now() };
      latest.set(key, job);
      void launch(job, input, settings, record);
      return job;
    },
  };
}
