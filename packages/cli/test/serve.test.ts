// ondina serve（設計書 5.5 / 12 章）。一時リポジトリの .ondina に対して port 0 で起動し、実際に HTTP で叩く。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AskEntry, AskLog } from '@ondina/model';
import { analyzeLocal } from '../src/analyze.js';
import { startServer, type RunningServer } from '../src/serve.js';
import { takeReturned } from '../src/store.js';
import { buildFixtureRepo, FIXTURE_ROOT } from './fixture-repo.js';

let repo: string;
let cleanup: () => void;
let headSha: string;
let server: RunningServer;
let dist: string;
let startedAfter: number;
const logged: string[] = [];
const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;

beforeAll(async () => {
  ({ dir: repo, cleanup } = buildFixtureRepo());
  headSha = (await analyzeLocal(repo, 'main', 'feature/discount')).analysis.pr.headSha;
  dist = mkdtempSync(path.join(os.tmpdir(), 'ondina-dist-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ondina</title>');
  writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  startedAfter = Date.now();
  server = await startServer({ repo, port: 0, distDir: dist, log: (s) => logged.push(s), version: 'abc1234' });
});
afterAll(async () => {
  await server.close();
  cleanup();
  rmSync(dist, { recursive: true, force: true });
});

describe('GET /api/repo', () => {
  it('どのリポジトリの serve か（serve --background が使い回してよいかを決める）と、起動したときのバージョンと時刻（serve list）', async () => {
    const body = (await (await fetch(url('/api/repo'))).json()) as { startedAt: string };
    expect(body).toEqual({ repo, pid: process.pid, version: 'abc1234', startedAt: expect.any(String) });
    expect(Date.parse(body.startedAt)).toBeGreaterThanOrEqual(startedAfter);
    expect(Date.parse(body.startedAt)).toBeLessThanOrEqual(Date.now());
  });
});

describe('GET /api/analyses', () => {
  it('解析の一覧を返す', async () => {
    const res = await fetch(url('/api/analyses'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const list = (await res.json()) as Array<{ key: string; headSha: string }>;
    expect(list).toEqual([expect.objectContaining({ key: 'local', headSha })]);
  });
});

describe('GET /api/analyses/:key/:sha', () => {
  it('Analysis.json をそのまま返す', async () => {
    const res = await fetch(url(`/api/analyses/local/${headSha}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(JSON.parse(readFileSync(path.join(repo, '.ondina', 'local', `${headSha}.json`), 'utf8')));
  });

  it('無ければ 404', async () => {
    expect((await fetch(url(`/api/analyses/local/${'0'.repeat(40)}`))).status).toBe(404);
    expect((await fetch(url('/api/analyses/..%2Flocal/x'))).status).toBe(404);
  });
});

describe('/api/state/:key/:sha', () => {
  it('GET は初期値、PUT でファイルに書かれ、次の GET で返る', async () => {
    const first = await (await fetch(url(`/api/state/local/${headSha}`))).json();
    expect(first).toMatchObject({ viewed: [], comments: [] });
    const next = { viewed: ['a'], comments: [] };
    const put = await fetch(url(`/api/state/local/${headSha}`), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
    expect(put.status).toBe(204);
    expect(JSON.parse(readFileSync(path.join(repo, '.ondina', 'local', 'state', `${headSha}.json`), 'utf8'))).toEqual(next);
    expect(await (await fetch(url(`/api/state/local/${headSha}`))).json()).toEqual(next);
  });

  it('JSON でない本文や形の違う本文は 400', async () => {
    expect((await fetch(url(`/api/state/local/${headSha}`), { method: 'PUT', body: '{' })).status).toBe(400);
    expect((await fetch(url(`/api/state/local/${headSha}`), { method: 'PUT', body: '{"viewed":"x"}' })).status).toBe(400);
    expect((await fetch(url(`/api/state/local/${headSha}`), { method: 'PUT', body: '{"viewed":[]}' })).status).toBe(400);
  });

  it('PUT は、画面が読んだ後に外から足した AI の下書きを消さない（画面は state 全体を送る）', async () => {
    const reset = { viewed: [], comments: [] };
    await fetch(url(`/api/state/local/${headSha}`), { method: 'PUT', body: JSON.stringify(reset) });
    const add = { source: 'codex', headSha, comments: [{ path: 'a.kt', line: 2, side: 'RIGHT', body: '[must] 外から' }] };
    expect((await fetch(url('/api/comments'), { method: 'POST', body: JSON.stringify(add) })).status).toBe(200);
    const fromScreen = { viewed: ['h1'], comments: [] }; // 画面は下書きが届く前の state を持っている
    expect((await fetch(url(`/api/state/local/${headSha}`), { method: 'PUT', body: JSON.stringify(fromScreen) })).status).toBe(204);
    const state = (await (await fetch(url(`/api/state/local/${headSha}`))).json()) as { viewed: string[]; comments: Array<{ body: string }> };
    expect(state.viewed).toEqual(['h1']);
    expect(state.comments.map((c) => c.body)).toEqual(['[must] 外から']);
    // PUT では AI の下書きを消せないので、後のテストのためにファイルを直接戻す
    writeFileSync(path.join(repo, '.ondina', 'local', 'state', `${headSha}.json`), JSON.stringify(reset));
  });

  it('知らない解析への PUT は 404', async () => {
    expect((await fetch(url(`/api/state/local/${'0'.repeat(40)}`), { method: 'PUT', body: '{"viewed":[],"comments":[],"ui":{}}' })).status).toBe(404);
  });
});

describe('GET /api/config', () => {
  const yaml = () => path.join(repo, 'ondina.config.yaml');

  it('ondina.config.yaml の表示だけの部分を返す（11 章）', async () => {
    const res = await fetch(url('/api/config'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ packagePrefix: 'com.example', theme: { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' }, ide: { scheme: 'jetbrains', product: 'idea', project: 'order-service' } });
  });

  it('yaml が無ければ既定値（再起動なしで毎回読む）', async () => {
    renameSync(yaml(), `${yaml()}.bak`);
    try {
      expect(await (await fetch(url('/api/config'))).json()).toEqual({ theme: { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' }, ide: { scheme: 'jetbrains', product: 'idea' } });
    } finally {
      renameSync(`${yaml()}.bak`, yaml());
    }
  });

  it('yaml が壊れていれば既定値を返し、理由を log に出す', async () => {
    const original = readFileSync(yaml(), 'utf8');
    writeFileSync(yaml(), 'theme: { mode: dusk }\n');
    logged.length = 0;
    try {
      expect(await (await fetch(url('/api/config'))).json()).toEqual({ theme: { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' }, ide: { scheme: 'jetbrains', product: 'idea' } });
      expect(logged).toEqual([expect.stringContaining('theme.mode')]);
    } finally {
      writeFileSync(yaml(), original);
    }
  });

});

describe('/api/ui', () => {
  it('GET は {}、PUT で .ondina/ui.json に書かれる', async () => {
    expect(await (await fetch(url('/api/ui'))).json()).toEqual({});
    const put = await fetch(url('/api/ui'), { method: 'PUT', body: JSON.stringify({ worktreeRoot: '/tmp/wt' }) });
    expect(put.status).toBe(204);
    expect(JSON.parse(readFileSync(path.join(repo, '.ondina', 'ui.json'), 'utf8'))).toEqual({ worktreeRoot: '/tmp/wt' });
    expect(await (await fetch(url('/api/ui'))).json()).toEqual({ worktreeRoot: '/tmp/wt' });
    const put2 = await fetch(url('/api/ui'), { method: 'PUT', body: JSON.stringify({ llmCommand: 'codex exec -' }) });
    expect(put2.status).toBe(204);
    expect(await (await fetch(url('/api/ui'))).json()).toEqual({ llmCommand: 'codex exec -' });
    expect((await fetch(url('/api/ui'), { method: 'PUT', body: JSON.stringify({ llmCommand: 1 }) })).status).toBe(400);
  });

  it('テーマと左右 / 統合も ui.json に書かれ、次の GET で返る（PR をまたぐ設定）', async () => {
    const settings = { llmCommand: 'codex exec -', theme: { mode: 'dark', light: 'latte', dark: 'frappe', accent: 'peach' }, diffMode: { b: 'uni', d: 'uni' } };
    expect((await fetch(url('/api/ui'), { method: 'PUT', body: JSON.stringify(settings) })).status).toBe(204);
    expect(await (await fetch(url('/api/ui'))).json()).toEqual(settings);
    expect((await fetch(url('/api/ui'), { method: 'PUT', body: JSON.stringify({ theme: { mode: 'light', light: 'latte' } }) })).status).toBe(400);
  });
});

describe('POST /api/comments', () => {
  it('12 章の JSON を受けて state に下書きを足し、件数を返す', async () => {
    const body = { source: 'claude-code', headSha, comments: [{ path: 'a.kt', line: 1, side: 'RIGHT', body: 'x' }] };
    const res = await fetch(url('/api/comments'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'local', headSha, added: 1 });
    const state = (await (await fetch(url(`/api/state/local/${headSha}`))).json()) as { comments: Array<{ body: string; state: string }> };
    expect(state.comments).toEqual([expect.objectContaining({ body: 'x', state: 'draft', source: 'claude-code' })]);
  });

  it('知らない headSha は 404、形の違う本文は 400', async () => {
    expect((await fetch(url('/api/comments'), { method: 'POST', body: JSON.stringify({ source: 's', headSha: 'f'.repeat(40), comments: [] }) })).status).toBe(404);
    expect((await fetch(url('/api/comments'), { method: 'POST', body: '{"source":"s"}' })).status).toBe(400);
  });

  it('GitHub の差分に出ない行があれば 400 でその行を返し、1 件も足さない', async () => {
    // PR 43 の解析。塊は fixture の本物（DiscountPolicy.kt は差分なし）
    const prSha = 'b'.repeat(40);
    const githubDiff: unknown = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'expected/github-diff.json'), 'utf8'));
    const analysis = { ...JSON.parse(readFileSync(path.join(repo, '.ondina', 'local', `${headSha}.json`), 'utf8')), pr: { number: 43, title: 'x', base: 'main', head: 'b', headSha: prSha, baseSha: 'd'.repeat(40) }, githubDiff };
    mkdirSync(path.join(repo, '.ondina', '43'), { recursive: true });
    writeFileSync(path.join(repo, '.ondina', '43', `${prSha}.json`), JSON.stringify(analysis));
    const policy = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';
    const comments = [
      { path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 3, side: 'RIGHT', body: '塊の中' },
      { path: policy, line: 10, side: 'RIGHT', body: '差分のないファイル' },
    ];
    const res = await fetch(url('/api/comments'), { method: 'POST', body: JSON.stringify({ source: 'claude-code', headSha: prSha, comments }) });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(`  ${policy} 10 行目`);
    const state = (await (await fetch(url(`/api/state/43/${prSha}`))).json()) as { comments: unknown[] };
    expect(state.comments).toEqual([]);
  });
});

describe('静的配信', () => {
  it('/ と /api 以外の未知パスは index.html（SPA）、実在するアセットはそのまま', async () => {
    expect(await (await fetch(url('/'))).text()).toContain('<title>ondina</title>');
    expect(await (await fetch(url('/some/route'))).text()).toContain('<title>ondina</title>');
    const js = await fetch(url('/assets/app.js'));
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(await js.text()).toBe('console.log(1)');
  });

  it('/api の知らないパスは 404、dist の外は読めない', async () => {
    expect((await fetch(url('/api/nope'))).status).toBe(404);
    const res = await fetch(url('/..%2F..%2Fetc%2Fpasswd'));
    expect(await res.text()).toContain('<title>ondina</title>');
  });
});

describe('dist が無いとき', () => {
  it('API は動き、ページは 503 でビルド方法を案内する', async () => {
    const s = await startServer({ repo, port: 0, distDir: path.join(dist, 'missing') });
    try {
      expect((await fetch(`http://127.0.0.1:${s.port}/api/analyses`)).status).toBe(200);
      const res = await fetch(`http://127.0.0.1:${s.port}/`);
      expect(res.status).toBe(503);
      expect(await res.text()).toMatch(/pnpm build/);
    } finally {
      await s.close();
    }
  });
});

describe('POST /api/comments/send/:key/:sha', () => {
  // PR 42 の解析を用意し、gh は注入した偽物で受ける
  const prSha = 'e'.repeat(40);
  const calls: Array<{ args: string[]; input?: string | undefined }> = [];
  let ghResult: () => string;
  let s: RunningServer;
  const post = (p: string) => fetch(`http://127.0.0.1:${s.port}${p}`, { method: 'POST' });
  const setState = (key: string, sha: string, comments: unknown[]) =>
    fetch(`http://127.0.0.1:${s.port}/api/state/${key}/${sha}`, {
      method: 'PUT',
      body: JSON.stringify({ viewed: [], comments }),
    });
  const adopted = { id: 'a1', path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 3, side: 'RIGHT', body: 'x', source: 'claude-code', state: 'adopted' };

  beforeAll(async () => {
    const analysis = { ...JSON.parse(readFileSync(path.join(repo, '.ondina', 'local', `${headSha}.json`), 'utf8')), pr: { number: 42, title: 'x', base: 'main', head: 'b', headSha: prSha, baseSha: 'd'.repeat(40) } };
    mkdirSync(path.join(repo, '.ondina', '42'), { recursive: true });
    writeFileSync(path.join(repo, '.ondina', '42', `${prSha}.json`), JSON.stringify(analysis));
    s = await startServer({
      repo,
      port: 0,
      distDir: dist,
      runGh: (args, _cwd, input) => {
        calls.push({ args, input });
        if (args[0] === 'pr') return '{"url":"https://ghe.example.co.jp/o/r/pull/42"}';
        return args[1] === 'graphql' ? '{"data":{"repository":{"pullRequest":{"reviews":{"nodes":[]}}}}}' : ghResult();
      },
    });
  });
  afterAll(() => s.close());

  it('採用分を gh で送り、sent と url を返し、state が sent になる', async () => {
    await setState('42', prSha, [adopted]);
    ghResult = () => '{"html_url":"https://github.com/o/r/pull/42#pullrequestreview-9"}';
    const res = await post(`/api/comments/send/42/${prSha}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: ['a1'], url: 'https://github.com/o/r/pull/42/files' });
    expect(calls).toHaveLength(3);
    expect(calls[0]!.args).toEqual(['pr', 'view', '42', '--json', 'url']);
    expect(calls[2]!.args.slice(0, 4)).toEqual(['api', 'repos/o/r/pulls/42/reviews', '--hostname', 'ghe.example.co.jp']);
    const state = (await (await fetch(`http://127.0.0.1:${s.port}/api/state/42/${prSha}`)).json()) as { comments: Array<{ state: string }> };
    expect(state.comments.map((c) => c.state)).toEqual(['sent']);
  });

  it('採用が無ければ 400、知らない解析は 404', async () => {
    expect((await post(`/api/comments/send/42/${prSha}`)).status).toBe(400);
    expect((await post(`/api/comments/send/local/${headSha}`)).status).toBe(400);
    expect((await post(`/api/comments/send/42/${'f'.repeat(40)}`)).status).toBe(404);
  });

  it('local は GitHub に送らず AI に返す（受け箱に書き、送信済みにする。待っている AI がいるかも返す）', async () => {
    await setState('local', headSha, [adopted]);
    const before = calls.length;
    const res = await post(`/api/comments/send/local/${headSha}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: ['a1'], waiting: false });
    expect(calls).toHaveLength(before);
    // ほかのテストが足した AI の下書きは PUT でも残る（keepOutsideDrafts）ので、返した 1 件だけを見る
    const state = (await (await fetch(`http://127.0.0.1:${s.port}/api/state/local/${headSha}`)).json()) as { comments: Array<{ id: string; state: string }> };
    expect(state.comments.find((c) => c.id === 'a1')?.state).toBe('sent');
    expect(takeReturned(repo).map((c) => c.body)).toEqual(['x']);
  });

  it('gh が失敗したら 502 でその理由を返し、state は変えない', async () => {
    await setState('42', prSha, [adopted]);
    ghResult = () => {
      throw new Error('gh api に失敗しました: HTTP 422: Unprocessable Entity');
    };
    const res = await post(`/api/comments/send/42/${prSha}`);
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/HTTP 422/);
    const state = (await (await fetch(`http://127.0.0.1:${s.port}/api/state/42/${prSha}`)).json()) as { comments: Array<{ state: string }> };
    expect(state.comments.map((c) => c.state)).toEqual(['adopted']);
  });
});

describe('/api/github/viewed/:key/:sha（GitHub の Viewed。設計書 12.1）', () => {
  // PR 43 の解析を用意し、gh（非同期）は注入した偽物で受ける
  const prSha = 'c'.repeat(40);
  const calls: string[][] = [];
  let prHead = prSha;
  let fail: string | null = null;
  let s: RunningServer;
  const at = (p: string) => `http://127.0.0.1:${s.port}${p}`;
  const page = () =>
    JSON.stringify({ data: { repository: { pullRequest: { id: 'PR_kw43', headRefOid: prHead, files: { nodes: [{ path: 'src/A.kt', viewerViewedState: 'VIEWED' }, { path: 'src/B.kt', viewerViewedState: 'UNVIEWED' }], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
  const post = (key: string, sha: string, body: unknown) => fetch(at(`/api/github/viewed/${key}/${sha}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  beforeAll(async () => {
    const analysis = { ...JSON.parse(readFileSync(path.join(repo, '.ondina', 'local', `${headSha}.json`), 'utf8')), pr: { number: 43, title: 'x', base: 'main', head: 'b', headSha: prSha, baseSha: 'd'.repeat(40) } };
    mkdirSync(path.join(repo, '.ondina', '43'), { recursive: true });
    writeFileSync(path.join(repo, '.ondina', '43', `${prSha}.json`), JSON.stringify(analysis));
    s = await startServer({
      repo,
      port: 0,
      distDir: dist,
      runGhAsync: async (args) => {
        calls.push(args);
        if (args[0] === 'pr') return '{"url":"https://ghe.example.co.jp/o/r/pull/43"}';
        if (fail !== null) throw new Error(fail);
        return args.some((a) => a.startsWith('query=mutation')) ? '{"data":{}}' : page();
      },
    });
  });
  afterAll(() => s.close());

  it('GET は GitHub で Viewed のファイルを返す', async () => {
    const res = await fetch(at(`/api/github/viewed/43/${prSha}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ viewed: ['src/A.kt'] });
    expect(calls.at(-1)).toContain('number=43');
    expect(calls.at(-1)!.slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'ghe.example.co.jp']);
  });

  it('POST は PR の head が解析と同じなら付ける・外すを送り、204', async () => {
    calls.length = 0;
    const res = await post('43', prSha, { mark: ['src/B.kt'], unmark: ['src/A.kt'] });
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(3);
    expect(calls[2]).toContain('id=PR_kw43');
    expect(calls[2]!.find((a) => a.startsWith('query='))).toMatch(/markFileAsViewed.*"src\/B\.kt".*unmarkFileAsViewed.*"src\/A\.kt"/);
  });

  it('POST は PR の head が解析と違えば送らず 409 と理由', async () => {
    calls.length = 0;
    prHead = 'f'.repeat(40);
    try {
      const res = await post('43', prSha, { mark: ['src/B.kt'], unmark: [] });
      expect(res.status).toBe(409);
      expect(await res.text()).toMatch(/新しいコミット/);
      expect(calls).toHaveLength(2);
    } finally {
      prHead = prSha;
    }
  });

  it('gh が失敗したら 502 でその理由を返す', async () => {
    fail = 'gh api graphql に失敗しました: HTTP 401: Bad credentials';
    try {
      const get = await fetch(at(`/api/github/viewed/43/${prSha}`));
      expect(get.status).toBe(502);
      expect(await get.text()).toMatch(/HTTP 401.*（宛先: ghe\.example\.co\.jp\/o\/r）/);
      const res = await post('43', prSha, { mark: ['src/B.kt'], unmark: [] });
      expect(res.status).toBe(502);
      expect(await res.text()).toMatch(/HTTP 401/);
    } finally {
      fail = null;
    }
  });

  it('local は 400、知らない解析は 404、形式の違う本文は 400', async () => {
    const local = await fetch(at(`/api/github/viewed/local/${headSha}`));
    expect(local.status).toBe(400);
    expect(await local.text()).toMatch(/ローカル解析/);
    expect((await post('local', headSha, { mark: [], unmark: [] })).status).toBe(400);
    expect((await fetch(at(`/api/github/viewed/43/${'0'.repeat(40)}`))).status).toBe(404);
    const bad = await post('43', prSha, { mark: 'src/A.kt' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toMatch(/形式/);
  });
});

describe('/api/ask/:key/:sha（案内人に聞く。設計書 3.10）', () => {
  const ask = (body: unknown, signal?: AbortSignal) =>
    fetch(url(`/api/ask/local/${headSha}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
  const withMode = async <T,>(mode: string, f: () => Promise<T>): Promise<T> => {
    process.env['FAKE_LLM_ASK_MODE'] = mode;
    try {
      return await f();
    } finally {
      delete process.env['FAKE_LLM_ASK_MODE'];
    }
  };
  const log = async () => ((await (await fetch(url(`/api/ask/local/${headSha}`))).json()) as AskLog).entries;
  // UI の設定の LLM コマンドは環境変数より強い。前のテストが書いた値（codex exec -）で本物を起動しないよう空に戻す
  beforeAll(async () => {
    await fetch(url('/api/ui'), { method: 'PUT', body: JSON.stringify({}) });
  });

  it('GET は会話の記録（無ければ空）。知らない解析は 404', async () => {
    expect(await log()).toEqual([]);
    expect((await fetch(url(`/api/ask/local/${'0'.repeat(40)}`))).status).toBe(404);
  });

  it('POST は LLM コマンドに聞いて、検証した答えを返し、記録に足す', async () => {
    const res = await ask({ key: 'pr', place: { kind: 'pr' }, question: ' 合計は変わる？ ' });
    expect(res.status).toBe(200);
    const entry = (await res.json()) as AskEntry;
    expect(entry).toMatchObject({ key: 'pr', place: { kind: 'pr' }, question: '合計は変わる？', command: process.env['ONDINA_LLM_COMMAND'] });
    expect(entry.answer.lead).toBe('答え: 合計は変わる？');
    expect(entry.answer.items[0]!.cite).toMatchObject({ side: expect.stringMatching(/head|base/) as string });
    expect(entry.answer.items[1]).toEqual({ text: '材料に無い行', unverified: true });
    expect(entry.answer.tail).toBe('前の問い 0');
    expect(await log()).toEqual([entry]);
  });

  it('選んだ行について聞く: 材料に選んだ行が入り、記録に行ごと残る', async () => {
    const path = 'src/main/kotlin/com/example/order/domain/Order.kt';
    const place = { kind: 'file', path, lines: { path, start: { side: 'head', line: 8 }, end: { side: 'head', line: 11 } } };
    const res = await ask({ key: `file:${path}#h8-h11`, place, question: '2 回呼ぶと？' });
    expect(res.status).toBe(200);
    const entry = (await res.json()) as AskEntry;
    expect(entry.place).toEqual(place);
    // 偽の LLM は選んだ行があれば、その最初の行を場所にする
    expect(entry.answer.items[0]!.cite).toEqual({ path, side: 'head', line: 8 });
    expect((await log()).at(-1)).toEqual(entry);
  });

  it('同じ場所で続けて聞くと、前の問いを材料に渡す（違う場所の問いは渡さない）', async () => {
    const other = (await (await ask({ key: 'course:1', place: { kind: 'course', courseId: 1 }, question: 'コースは？' })).json()) as AskEntry;
    expect(other.answer.tail).toBe('前の問い 0');
    const again = (await (await ask({ key: 'pr', place: { kind: 'pr' }, question: '続き' })).json()) as AskEntry;
    expect(again.answer.tail).toBe('前の問い 1');
  });

  it('形の違う本文は 400、知らない解析は 404', async () => {
    expect((await ask({ key: 'pr', place: { kind: 'pr' }, question: '' })).status).toBe(400);
    expect((await ask({ key: 'pr', place: { kind: 'nope' }, question: 'q' })).status).toBe(400);
    const res = await fetch(url(`/api/ask/local/${'0'.repeat(40)}`), { method: 'POST', body: JSON.stringify({ key: 'pr', place: { kind: 'pr' }, question: 'q' }) });
    expect(res.status).toBe(404);
  });

  it('LLM コマンドが失敗したら 502 で理由を返し、記録に足さない', async () => {
    const before = (await log()).length;
    const res = await withMode('fail', () => ask({ key: 'pr', place: { kind: 'pr' }, question: 'q' }));
    expect(res.status).toBe(502);
    expect(await res.text()).toContain('boom: the guide is on strike');
    const garbage = await withMode('garbage', () => ask({ key: 'pr', place: { kind: 'pr' }, question: 'q' }));
    expect(garbage.status).toBe(502);
    expect(await garbage.text()).toContain('JSON');
    expect((await log()).length).toBe(before);
  });

  describe('材料が足りないと need で頼み、serve が head から読んで聞き直す（2026-11-04）', () => {
    const PROMO = 'src/main/kotlin/com/example/promo/PromoService.kt';
    const need = { files: [PROMO, 'nope/Missing.kt'], search: ['legacyPromo', 'zzNoSuchThing'] };
    type Call = { last: boolean; input: { reads?: Array<{ kind: string; request: string; path: string; lines: string[] }> } };
    let inputs: string;
    beforeAll(() => {
      inputs = path.join(repo, '.ondina', 'fake-ask-inputs.jsonl');
      process.env['FAKE_LLM_ASK_NEED'] = JSON.stringify(need);
      process.env['FAKE_LLM_ASK_INPUT'] = inputs;
    });
    afterAll(() => {
      delete process.env['FAKE_LLM_ASK_NEED'];
      delete process.env['FAKE_LLM_ASK_INPUT'];
    });
    const calls = (): Call[] =>
      readFileSync(inputs, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as Call);

    it('頼んだファイルと文字列を読んで reads に足し、読んだ行を指す答えを返す', async () => {
      rmSync(inputs, { force: true });
      const res = await withMode('need', () => ask({ key: 'pr', place: { kind: 'pr' }, question: 'legacyPromo は何をする？' }));
      expect(res.status).toBe(200);
      const entry = (await res.json()) as AskEntry;
      // 偽の LLM は読んだ物があればその最初の行を場所にする。検証が読んだ行を材料に数えたので場所が残る
      expect(entry.answer.items[0]).toEqual({ text: '材料にある行', cite: { path: PROMO, side: 'head', line: 1 } });
      expect((await log()).at(-1)).toEqual(entry);
      const [first, second, ...rest] = calls();
      expect(rest).toEqual([]);
      expect(first!.input.reads).toBeUndefined();
      expect(second!.last).toBe(false);
      expect(second!.input.reads!.map((r) => [r.kind, r.request, r.path, r.lines.length])).toEqual([
        ['file', PROMO, PROMO, 15],
        ['file', 'nope/Missing.kt', 'nope/Missing.kt', 0],
        ['search', 'legacyPromo', PROMO, 2],
        ['search', 'zzNoSuchThing', '', 0],
      ]);
      expect(second!.input.reads![2]!.lines[1]).toBe('h14       private fun legacyPromo(order: Order): Money = legacy.amountFor(order.id)');
    });

    it('頼み続けても LLM を呼ぶのは 3 回まで。最後の回は need を出させず、それでも need なら 502 で記録に足さない', async () => {
      rmSync(inputs, { force: true });
      const before = (await log()).length;
      const res = await withMode('need-always', () => ask({ key: 'pr', place: { kind: 'pr' }, question: 'ずっと読みたい' }));
      expect(res.status).toBe(502);
      expect(await res.text()).toContain('2 回読んだあとも');
      expect(calls().map((c) => c.last)).toEqual([false, false, true]);
      expect((await log()).length).toBe(before);
    });
  });

  it('要求を切る（止める）と LLM をプロセスごと止め、記録に足さない', async () => {
    const before = (await log()).length;
    const pidFile = path.join(repo, '.ondina', 'fake-ask.pid');
    process.env['FAKE_LLM_PID'] = pidFile;
    const ac = new AbortController();
    try {
      await withMode('slow', async () => {
        const pending = ask({ key: 'pr', place: { kind: 'pr' }, question: '遅い' }, ac.signal).catch(() => 'aborted');
        const pid = await waitFor(() => (existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : null));
        ac.abort();
        expect(await pending).toBe('aborted');
        await waitFor(() => (alive(pid) ? null : true));
      });
    } finally {
      delete process.env['FAKE_LLM_PID'];
    }
    expect((await log()).length).toBe(before);
  });
});

/** f が null 以外を返すまで 50ms ごとに待つ（5 秒で諦める） */
async function waitFor<T>(f: () => T | null): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = f();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('待ちきれない');
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
