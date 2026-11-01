// LLM コマンドの起動と、出力の保存・再利用、前回結果の検索（設計書 5.3 / 5.5）。コマンドは sh -c で起動し stdin にプロンプト、stdout に JSON。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Analysis } from '@ondina/model';
import { DEFAULT_LLM_COMMAND, findPrevious, llmCachePath, readLlmCache, resolveLlmCommand, runLlmCommand, writeLlmCache } from '../src/llm.js';

let dir: string;
beforeAll(() => (dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-llm-'))));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveLlmCommand', () => {
  it('引数（UI の設定）> ONDINA_LLM_COMMAND > yaml > 既定', () => {
    expect(resolveLlmCommand({ override: 'a', env: 'b', yaml: 'c' })).toBe('a');
    expect(resolveLlmCommand({ env: 'b', yaml: 'c' })).toBe('b');
    expect(resolveLlmCommand({ yaml: 'c' })).toBe('c');
    expect(resolveLlmCommand({})).toBe(DEFAULT_LLM_COMMAND);
    expect(DEFAULT_LLM_COMMAND).toBe('claude -p --tools "" --max-turns 1 --model opus');
  });
  it('空文字は無いものとして扱う（UI で欄を空にしたとき）', () => {
    expect(resolveLlmCommand({ override: '', env: '', yaml: 'c' })).toBe('c');
  });
});

describe('runLlmCommand', () => {
  it('sh -c で起動し、stdin にプロンプトを渡し、stdout / stderr / 終了コードを返す', async () => {
    const r = await runLlmCommand('cat; echo warn >&2', 'こんにちは\n{"a":1}', dir);
    expect(r).toEqual({ stdout: 'こんにちは\n{"a":1}', stderr: 'warn\n', exitCode: 0, timedOut: false });
  });
  it('終了コードが 0 でないときもそのまま返す', async () => {
    const r = await runLlmCommand('cat >/dev/null; echo boom >&2; exit 3', 'x', dir);
    expect(r).toMatchObject({ exitCode: 3, stderr: 'boom\n', timedOut: false });
  });
  it('時間切れは打ち切って timedOut。sh の子（孫）がパイプを握っていても待たない', async () => {
    const t0 = Date.now();
    const r = await runLlmCommand('sleep 5; echo late', 'x', dir, 100);
    expect(r.timedOut).toBe(true);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('signal で止めると、子（孫）ごと殺して aborted（案内人に聞くの「止める」。設計書 3.10）', async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    const run = runLlmCommand('sleep 5; echo late', 'x', dir, 60_000, ac.signal);
    setTimeout(() => ac.abort(), 100);
    const r = await run;
    expect(r.aborted).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.stdout).toBe('');
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it('始める前に止めてあれば起動しない', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await runLlmCommand('echo ran', 'x', dir, 1000, ac.signal);
    expect(r).toEqual({ stdout: '', stderr: '', exitCode: null, timedOut: false, aborted: true });
  });
  it('実行中に Ctrl-C（SIGINT）を受けたら LLM を殺してプロセスも既定どおり終わる（解析を続けない）', async () => {
    const tsx = path.resolve(import.meta.dirname, '../node_modules/.bin/tsx');
    const child = spawn(tsx, [path.resolve(import.meta.dirname, 'sigint-child.ts')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (s: string) => (out += s));
    await new Promise((r) => setTimeout(r, 1500));
    const t0 = Date.now();
    child.kill('SIGINT');
    const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((r) => child.on('close', (c, s) => r([c, s])));
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(signal === 'SIGINT' || code === 130).toBe(true);
    expect(out).not.toContain('survived');
  });

  it('コマンドが見つからなくても例外にせず終了コードで返す', async () => {
    const r = await runLlmCommand('no-such-command-xyz', 'x', dir);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain('no-such-command-xyz');
  });
});

describe('LLM 出力の保存と再利用', () => {
  const sha = 'a'.repeat(40);
  it('.ondina/<key>/llm/<headSha>.json に生の記録を書き、読める。無ければ undefined', () => {
    expect(llmCachePath(dir, 'local', sha)).toBe(path.join(dir, '.ondina', 'local', 'llm', `${sha}.json`));
    expect(readLlmCache(dir, 'local', sha)).toBeUndefined();
    const rec = { command: 'cat', stdout: '{"hows":[]}', stderr: '', recordedAt: '2026-09-17T00:00:00.000Z' };
    writeLlmCache(dir, 'local', sha, rec);
    expect(readLlmCache(dir, 'local', sha)).toEqual(rec);
    expect(JSON.parse(readFileSync(llmCachePath(dir, 'local', sha), 'utf8'))).toEqual(rec);
  });
  it('key / sha の形が違えば書かない', () => {
    expect(() => writeLlmCache(dir, '../x', sha, { command: '', stdout: '', stderr: '', recordedAt: '' })).toThrow(/key/);
  });
});

describe('findPrevious', () => {
  const analysis = (headSha: string, hows: Analysis['hows'], head = 'h'): Analysis => ({
    pr: { number: 0, title: 't', base: 'main', head, headSha, baseSha: 'b'.repeat(40) },
    hunks: [],
    hows,
    symbols: [],
    edges: [],
    tours: [],
    specs: [],
    claims: [],
    summary: { problem: '', approach: '', untouched: '', beforeAfter: [] },
    config: { sourceRoots: [], layers: [], allowedDependencies: {}, normalize: {}, lsp: {} },
  });
  const write = (repo: string, key: string, headSha: string, a: Analysis, ageSec: number) => {
    const file = path.join(repo, '.ondina', key, `${headSha}.json`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(a));
    const t = Date.now() / 1000 - ageSec;
    utimesSync(file, t, t);
  };

  it('同じ key で headSha が違う直近の解析を返す。自分自身と別の key は見ない', () => {
    const repo = path.join(dir, 'prev');
    const s1 = '1'.repeat(40);
    const s2 = '2'.repeat(40);
    const s3 = '3'.repeat(40);
    write(repo, 'local', s1, analysis(s1, [{ id: 1, title: 'old', why: '', specIds: [] }]), 300);
    write(repo, 'local', s2, analysis(s2, [{ id: 1, title: 'newer', why: '', specIds: [] }]), 100);
    write(repo, 'local', s3, analysis(s3, [{ id: 9, title: 'self', why: '', specIds: [] }]), 0);
    write(repo, '7', s1, analysis(s1, [{ id: 5, title: 'other pr', why: '', specIds: [] }]), 10);
    expect(findPrevious(repo, 'local', s3, 'h')?.hows[0]!.title).toBe('newer');
    expect(findPrevious(repo, 'local', s1, 'h')?.hows[0]!.title).toBe('self');
    expect(findPrevious(repo, '8', s1, 'h')).toBeUndefined();
    expect(existsSync(path.join(repo, '.ondina'))).toBe(true);
  });
  it('ローカル解析は同じブランチの解析だけを前回にする（別の変更の How の番号を引き継がない）', () => {
    const repo = path.join(dir, 'prev-branch');
    const s1 = '1'.repeat(40);
    const s2 = '2'.repeat(40);
    const s3 = '3'.repeat(40);
    write(repo, 'local', s1, analysis(s1, [{ id: 1, title: 'same branch', why: '', specIds: [] }], 'feature/a'), 300);
    write(repo, 'local', s2, analysis(s2, [{ id: 49, title: 'other branch', why: '', specIds: [] }], 'feature/b'), 100);
    expect(findPrevious(repo, 'local', s3, 'feature/a')?.hows[0]!.title).toBe('same branch');
    expect(findPrevious(repo, 'local', s3, 'feature/c')).toBeUndefined();
  });
  it('.ondina が無ければ undefined', () => {
    expect(findPrevious(path.join(dir, 'nothing'), 'local', 'a'.repeat(40), 'h')).toBeUndefined();
  });
});
