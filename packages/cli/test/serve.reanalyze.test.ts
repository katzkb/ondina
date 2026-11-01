// 画面から解析する（設計書 5.5 / 3.0。PR 一覧 3.11）の serve の API と、新しい版の state の引き継ぎ。
// 1 本のリポジトリで「解析 → 前の版で印とメモ → コミットを積む → 解析し直す → 新しい版を開く」を順に進める。
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Analysis, AnalyzeJob, LatestHead, ReviewState } from '@ondina/model';
import { analyzeLocal } from '../src/analyze.js';
import type { AnalyzeChild } from '../src/reanalyze.js';
import { startServer, type RunningServer } from '../src/serve.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

let repo: string;
let cleanup: () => void;
let dist: string;
let server: RunningServer;
let first: Analysis;
let second: Analysis;
const children: Array<{ child: AnalyzeChild & { stdout: PassThrough; stderr: PassThrough }; close: (code: number) => Promise<void> }> = [];
const spawned: string[][] = [];
const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;
const statePath = (sha: string) => path.join(repo, '.ondina', 'local', 'state', `${sha}.json`);
const getJson = async <T,>(p: string): Promise<T> => (await (await fetch(url(p))).json()) as T;
const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';

function fakeChild(): AnalyzeChild {
  const ev = new EventEmitter();
  const child = { stdout: new PassThrough(), stderr: new PassThrough(), once: (e: string, f: (...a: never[]) => void) => (ev.once(e, f), child) } as unknown as AnalyzeChild & { stdout: PassThrough; stderr: PassThrough };
  children.push({
    child,
    close: async (code) => {
      child.stdout.end();
      child.stderr.end();
      await new Promise((r) => setImmediate(r));
      ev.emit('close', code);
    },
  });
  return child;
}

beforeAll(async () => {
  ({ dir: repo, cleanup } = buildFixtureRepo());
  first = (await analyzeLocal(repo, 'main', 'feature/discount')).analysis;
  dist = mkdtempSync(path.join(os.tmpdir(), 'ondina-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ondina</title>');
  server = await startServer({
    repo,
    port: 0,
    distDir: dist,
    log: () => undefined,
    reanalyze: { spawn: (_r, args) => (spawned.push(args), fakeChild()), now: () => 1234, prHead: async () => ({ headSha: first.pr.headSha, commits: [] }) },
  });
});
afterAll(async () => {
  await server.close();
  cleanup();
  rmSync(dist, { recursive: true, force: true });
});

describe('解析する（POST /api/analyze/:key[/:sha] と GET /api/analyze）', () => {
  it('始める前は空', async () => {
    expect(await getJson<AnalyzeJob[]>('/api/analyze')).toEqual([]);
  });

  it('今の版の引数で ondina analyze を起こし、running を返す。同じ key が走っている間は 409 と今のジョブ', async () => {
    const res = await fetch(url(`/api/analyze/local/${first.pr.headSha}`), { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'running', key: 'local', from: first.pr.headSha, startedAt: 1234 });
    expect(spawned[0]!.slice(0, 5)).toEqual(['analyze', '--base', 'main', '--head', 'feature/discount']);
    const busy = await fetch(url(`/api/analyze/local/${first.pr.headSha}`), { method: 'POST' });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ status: 'running', key: 'local' });
  });

  it('版を付けなければ PR 番号で解析する。走っている間は順番待ち', async () => {
    const res = await fetch(url('/api/analyze/7'), { method: 'POST' });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'queued', key: '7', queuedAt: 1234 });
    expect(spawned).toHaveLength(1);
  });

  it('進みと終わりを GET で読む。終わると列の次が走る', async () => {
    const { child, close } = children[0]!;
    child.stderr.write('ondina analyze: 差分を切り出しています\n');
    await new Promise((r) => setImmediate(r));
    expect(await getJson<AnalyzeJob[]>('/api/analyze')).toEqual([
      { status: 'queued', key: '7', queuedAt: 1234 },
      { status: 'running', key: 'local', from: first.pr.headSha, startedAt: 1234, line: '差分を切り出しています' },
    ]);
    await close(1);
    expect(spawned[1]).toEqual(['analyze', '7']);
    expect(await getJson<AnalyzeJob[]>('/api/analyze')).toEqual([
      { status: 'running', key: '7', startedAt: 1234 },
      { status: 'failed', key: 'local', from: first.pr.headSha, reason: '差分を切り出しています' },
    ]);
    await children[1]!.close(1);
  });

  it('解析の無い版と、版を付けない local は 404', async () => {
    expect((await fetch(url(`/api/analyze/local/${'0'.repeat(40)}`), { method: 'POST' })).status).toBe(404);
    expect((await fetch(url('/api/analyze/local'), { method: 'POST' })).status).toBe(404);
  });
});

describe('新しい版の state を初めて読むと、前の版から引き継ぐ', () => {
  const order = (a: Analysis) => a.hunks.find((h) => h.path === ORDER)!;

  beforeAll(async () => {
    // 前の版: 差分を全部「問題なし」にし、Order.kt の変わらない行と変わる行にメモを書く
    const discountLine = first.files!.find((f) => f.path === ORDER)!.tokens.findIndex((l) => l.map((t) => t[0]).join('').includes('discount = subtotal * rate')) + 1;
    const state: ReviewState = {
      viewed: first.hunks.map((h) => h.id),
      comments: [
        { id: 'm1', path: ORDER, line: 1, side: 'RIGHT', body: '変わらない行', source: 'reviewer', state: 'adopted' },
        { id: 'm2', path: ORDER, line: discountLine, side: 'RIGHT', body: '変わる行', source: 'reviewer', state: 'adopted' },
      ],
    };
    expect((await fetch(url(`/api/state/local/${first.pr.headSha}`), { method: 'PUT', body: JSON.stringify(state) })).status).toBe(204);
    // 作者がコミットを積む
    const id = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false'];
    git(repo, 'checkout', '-q', 'feature/discount');
    const file = path.join(repo, ORDER);
    writeFileSync(file, readFileSync(file, 'utf8').replace('discount = subtotal * rate', 'discount = (subtotal * rate).roundDown()'));
    git(repo, ...id, 'commit', '-q', '-am', 'Round the discount down');
    git(repo, 'checkout', '-q', 'main');
    second = (await analyzeLocal(repo, 'main', 'feature/discount')).analysis;
  });

  it('GET /api/latest は新しい head と、解析済み・変わった差分の数', async () => {
    expect(await getJson<LatestHead>(`/api/latest/local/${first.pr.headSha}`)).toEqual({ headSha: second.pr.headSha, newCommits: 1, analyzed: true, changed: 1 });
    expect((await fetch(url(`/api/latest/local/${'0'.repeat(40)}`))).status).toBe(404);
  });

  it('変わった差分の印を外し、変わらない行のメモを移して、ファイルに書く。前の版の state は変えない', async () => {
    const before = readFileSync(statePath(first.pr.headSha), 'utf8');
    const got = await getJson<ReviewState>(`/api/state/local/${second.pr.headSha}`);
    expect(got.viewed).toHaveLength(second.hunks.length - 1);
    expect(got.viewed).not.toContain(order(second).id);
    expect(got.comments.map((c) => [c.id, c.line])).toEqual([['m1', 1]]);
    expect(got.carried).toEqual({ from: first.pr.headSha, reset: [order(second).id], coursesReset: [], left: ['m2'] });
    expect(JSON.parse(readFileSync(statePath(second.pr.headSha), 'utf8'))).toEqual(got);
    expect(readFileSync(statePath(first.pr.headSha), 'utf8')).toBe(before);
  });

  it('PUT は carried を通し、形の違う carried は 400', async () => {
    const got = await getJson<ReviewState>(`/api/state/local/${second.pr.headSha}`);
    const dismissed = { ...got, carried: { ...got.carried!, dismissed: true } };
    expect((await fetch(url(`/api/state/local/${second.pr.headSha}`), { method: 'PUT', body: JSON.stringify(dismissed) })).status).toBe(204);
    expect((await getJson<ReviewState>(`/api/state/local/${second.pr.headSha}`)).carried?.dismissed).toBe(true);
    expect((await fetch(url(`/api/state/local/${second.pr.headSha}`), { method: 'PUT', body: JSON.stringify({ ...got, carried: { from: 1 } }) })).status).toBe(400);
  });

  it('AI が下書きを先に足しても、前の版から引き継いでから足す', async () => {
    rmSync(statePath(second.pr.headSha));
    const add = { source: 'codex', headSha: second.pr.headSha, comments: [{ path: ORDER, line: 2, side: 'RIGHT', body: '[ask] 外から' }] };
    expect((await fetch(url('/api/comments'), { method: 'POST', body: JSON.stringify(add) })).status).toBe(200);
    const got = await getJson<ReviewState>(`/api/state/local/${second.pr.headSha}`);
    expect(got.carried?.from).toBe(first.pr.headSha);
    expect(got.comments.map((c) => c.body)).toEqual(['変わらない行', '[ask] 外から']);
  });
});
