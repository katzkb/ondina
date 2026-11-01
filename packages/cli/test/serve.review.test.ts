// PR 一覧から AI にレビューを頼む（設計書 3.11 / 5.5）の serve の口: POST / GET / DELETE /api/review。解析の列（/api/analyze）と同じ serve で動く。
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnalyzeJob, ReviewJob, ReviewState } from '@ondina/model';
import type { AnalyzeChild } from '../src/reanalyze.js';
import { startServer, type RunningServer } from '../src/serve.js';
import { writeUi } from '../src/store.js';
import { buildFixtureRepo, FIXTURE_ROOT } from './fixture-repo.js';

const HEAD = 'a'.repeat(40);
const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
let repo: string;
let cleanup: () => void;
let dist: string;
let server: RunningServer;
const spawned: string[][] = [];
const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;
const getJson = async <T,>(p: string): Promise<T> => (await (await fetch(url(p))).json()) as T;
const post = (key: string, body: unknown) => fetch(url(`/api/review/${key}`), { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

function fakeChild(): AnalyzeChild {
  const ev = new EventEmitter();
  return { stdout: new PassThrough(), stderr: new PassThrough(), once: (e: string, f: (...a: never[]) => void) => ev.once(e, f) } as unknown as AnalyzeChild;
}

beforeAll(async () => {
  ({ dir: repo, cleanup } = buildFixtureRepo());
  const githubDiff: unknown = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'expected/github-diff.json'), 'utf8'));
  mkdirSync(path.join(repo, '.ondina', '7'), { recursive: true });
  writeFileSync(path.join(repo, '.ondina', '7', `${HEAD}.json`), JSON.stringify({ pr: { number: 7, title: 't', base: 'main', head: 'f', baseSha: 'b'.repeat(40), headSha: HEAD }, githubDiff, hunks: [] }));
  dist = mkdtempSync(path.join(os.tmpdir(), 'ondina-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ondina</title>');
  server = await startServer({ repo, port: 0, distDir: dist, log: () => undefined, reanalyze: { spawn: (_r, args) => (spawned.push(args), fakeChild()), now: () => 1234 } });
});
afterAll(async () => {
  await server.close();
  cleanup();
  rmSync(dist, { recursive: true, force: true });
});

describe('AI にレビューを頼む（/api/review）', () => {
  it('始める前は空。コマンドが空なら 400 と設定への案内', async () => {
    expect(await getJson<ReviewJob[]>('/api/review')).toEqual([]);
    const res = await post('7', { headSha: HEAD });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/AI レビューのコマンド/);
  });

  it('本文が { headSha } でなければ 400、PR 番号でなければ 404', async () => {
    writeUi(repo, { reviewCommand: 'cat >/dev/null' });
    expect((await post('7', 'x')).status).toBe(400);
    expect((await post('7', { headSha: 'abc' })).status).toBe(400);
    expect((await post('local', { headSha: HEAD })).status).toBe(404);
  });

  it('今の head の解析があれば 202 と running。走っている間は 409 と今のジョブ。DELETE で止める（動いていなければ 404）', async () => {
    writeUi(repo, { reviewCommand: 'sleep 5' });
    const res = await post('7', { headSha: HEAD });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: 'running', key: '7', headSha: HEAD });
    const busy = await post('7', { headSha: HEAD });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ status: 'running', key: '7' });
    const stop = await fetch(url('/api/review/7'), { method: 'DELETE' });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toEqual({ status: 'stopped', key: '7', headSha: HEAD });
    expect(await getJson<ReviewJob[]>('/api/review')).toEqual([{ status: 'stopped', key: '7', headSha: HEAD }]);
    expect((await fetch(url('/api/review/7'), { method: 'DELETE' })).status).toBe(404);
  });

  it('終わると stdout の JSON が AI の下書きに入り、GET で done と下書きの数', async () => {
    writeUi(repo, { reviewCommand: `cat >/dev/null; printf '%s' '${JSON.stringify({ source: 'fake', comments: [{ path: ORDER, line: 3, side: 'RIGHT', body: '[ask] 一つ目' }, { path: ORDER, line: 40, side: 'RIGHT', body: '塊の外' }] })}'` });
    expect((await post('7', { headSha: HEAD })).status).toBe(202);
    await vi.waitFor(async () => expect(await getJson<ReviewJob[]>('/api/review')).toEqual([{ status: 'done', key: '7', headSha: HEAD, drafts: 1, skipped: 1 }]), { timeout: 5000, interval: 50 });
    const state = await getJson<ReviewState>(`/api/state/7/${HEAD}`);
    expect(state.comments.map((c) => [c.source, c.body, c.state])).toEqual([['fake', '[ask] 一つ目', 'draft']]);
  });

  it('解析の無い PR は解析を列に入れて 202 と waiting（GET /api/analyze にも出る）', async () => {
    const res = await post('8', { headSha: 'c'.repeat(40) });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'waiting', key: '8', headSha: 'c'.repeat(40) });
    expect(spawned).toEqual([['analyze', '8']]);
    expect(await getJson<AnalyzeJob[]>('/api/analyze')).toEqual([{ status: 'running', key: '8', startedAt: 1234 }]);
  });
});
