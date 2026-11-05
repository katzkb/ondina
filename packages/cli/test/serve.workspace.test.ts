import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../src/serve.js';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeUi, writeWorkspaces } from '../src/store.js';
let repo: string;
let app: ReturnType<typeof createApp>;
function request(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Response> {
  return new Promise((resolve) => {
    const raw = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const req = Readable.from(raw ? [Buffer.from(raw)] : []) as IncomingMessage;
    req.url = route.startsWith('/api/') ? route : `/api/workspace${route}`;
    req.method = method;
    let text = '';
    const res = new Writable({ write(chunk: Buffer, _encoding, cb) { text += chunk.toString(); cb(); } }) as ServerResponse;
    res.setHeader = () => res;
    res.writeHead = (code: number) => { res.statusCode = code; return res; };
    res.on('finish', () => resolve(new Response(text || null, { status: res.statusCode })));
    app(req, res);
  });
}
const input = { branch: 'feature/discount', title: '割引', url: 'https://example.com/pull/7' };
beforeAll(async () => {
  repo = mkdtempSync(path.join(os.tmpdir(), 'ondina-serve-workspace-'));
  writeFileSync(path.join(repo, 'index.html'), '<title>ondina</title>');
  app = createApp(repo, repo, { workspace: { which: (cmd) => cmd === 'gct', exec: () => new Promise(() => undefined) } });
});
afterAll(async () => { rmSync(repo, { recursive: true, force: true }); });
it('GET tools exposes executable availability and the single default prompt', async () => {
  expect(await (await request('/tools')).json()).toEqual({ gct: true, herdrApp: false, herdr: false, orca: false, defaultPrompt: expect.stringContaining('PR #{pr}') });
});
it('GET starts empty, unset app is 400 with settings guidance, non-PR is 404', async () => {
  expect(await (await request('')).json()).toEqual([]);
  const res = await request('/7', input);
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('レビュー用の作業場');
  expect((await request('/local', input)).status).toBe(404);
});
it('rejects invalid bodies and settings, accepts empty strings in workspace settings', async () => {
  expect((await request('/7', 'not JSON')).status).toBe(400);
  expect((await request('/7', {})).status).toBe(400);
  const put = (workspace: unknown) => request('/api/ui', { workspace }, 'PUT');
  expect((await put({ app: 'unknown' })).status).toBe(400);
  expect((await put({ app: 'orca', maker: 'unknown' })).status).toBe(400);
  expect((await put({ app: 'orca', agent: 3 })).status).toBe(400);
  expect((await put({ app: 'orca', agent: '', prompt: '' })).status).toBe(204);
});
it('starts with 202, returns 409 and current job while busy, lists running job', async () => {
  writeUi(repo, { workspace: { app: 'herdr-app', maker: 'gct' } });
  expect((await request('/7', input)).status).toBe(202);
  const busy = await request('/7', input);
  expect(busy.status).toBe(409);
  expect(await busy.json()).toMatchObject({ key: '7', app: 'herdr-app', status: 'running', done: 0 });
  expect(await (await request('')).json()).toMatchObject([{ key: '7', status: 'running' }]);
});

it('restores finished records in GET after recreating the app', async () => {
  writeWorkspaces(repo, { '7': { app: 'orca', path: repo, branch: input.branch, openedAt: '2026-11-06T00:00:00Z' } });
  app = createApp(repo, repo);
  expect(await (await request('')).json()).toMatchObject([{ key: '7', app: 'orca', path: repo, status: 'done', startedAt: '2026-11-06T00:00:00Z' }]);
});
