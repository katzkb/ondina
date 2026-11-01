// PR 一覧（設計書 3.11 / 5.5。2026-10-22）の serve の口: gh repo view で宛先を決め、gh api graphql を 1 回。gh は差し替える。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { PrDetail, PrList } from '@ondina/model';
import type { RunGhAsync } from '../src/pr.js';
import { startServer, type RunningServer } from '../src/serve.js';
import { buildFixtureRepo } from './fixture-repo.js';
import { detailNode, detailOf, graphqlOf, issueComment, prNode } from './pr-graphql.js';

let repo: string;
let cleanup: () => void;
let dist: string;
let server: RunningServer;
const calls: string[][] = [];
/** gh の答え。テストごとに替える */
let gh: (args: string[]) => Promise<string>;
const url = (p: string) => `http://127.0.0.1:${server.port}${p}`;

const answer: (args: string[]) => Promise<string> = async (args) => {
  if (args[0] === 'repo') return JSON.stringify({ url: 'https://ghe.example.co.jp/team-a/order-service' });
  return JSON.stringify({ data: graphqlOf([prNode({ number: 7 }), prNode({ number: 8 })]) });
};

beforeAll(async () => {
  ({ dir: repo, cleanup } = buildFixtureRepo());
  dist = mkdtempSync(path.join(os.tmpdir(), 'ondina-dist-'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>ondina</title>');
  const runGhAsync: RunGhAsync = (args) => {
    calls.push(args);
    return gh(args);
  };
  server = await startServer({ repo, port: 0, distDir: dist, log: () => undefined, runGhAsync });
});
afterEach(() => {
  calls.length = 0;
});
afterAll(async () => {
  await server.close();
  cleanup();
  rmSync(dist, { recursive: true, force: true });
});

const fieldOf = (args: string[], name: string) => args[args.indexOf(`${name}`) + 1];

describe('GET /api/prs', () => {
  it('リポジトリのホストに GraphQL を 1 回送り、開いている PR の一覧を返す', async () => {
    gh = answer;
    const before = Date.now();
    const res = await fetch(url('/api/prs'));
    expect(res.status).toBe(200);
    const list = (await res.json()) as PrList;
    expect(list.prs.map((p) => p.number)).toEqual([7, 8]);
    expect(list.viewer).toBe('katzkb');
    expect(list.truncated).toBe(false);
    expect(list.fetchedAt).toBeGreaterThanOrEqual(before);
    expect(calls[0]).toEqual(['repo', 'view', '--json', 'url']);
    const q = calls[1]!;
    expect(q.slice(0, 2)).toEqual(['api', 'graphql']);
    expect(fieldOf(q, '--hostname')).toBe('ghe.example.co.jp');
    expect(q).toContain('owner=team-a');
    expect(q).toContain('name=order-service');
    expect(calls).toHaveLength(2);
  });

  it('宛先は覚えておき、2 回目からは GraphQL だけ', async () => {
    gh = answer;
    expect((await fetch(url('/api/prs'))).status).toBe(200);
    expect(calls.map((c) => c[0])).toEqual(['api']);
  });

  it('gh が失敗したら 502 と理由（宛先付き）', async () => {
    gh = async () => {
      throw new Error('gh api に失敗しました: HTTP 401');
    };
    const res = await fetch(url('/api/prs'));
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('gh api に失敗しました: HTTP 401（宛先: ghe.example.co.jp/team-a/order-service）');
  });

  it('GraphQL がエラーを返したら 502 とその文', async () => {
    gh = async () => JSON.stringify({ data: null, errors: [{ message: 'Could not resolve to a Repository' }] });
    const res = await fetch(url('/api/prs'));
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/Could not resolve to a Repository/);
  });
});

describe('GET /api/prs/:n', () => {
  const detail: (args: string[]) => Promise<string> = async (args) => {
    if (args[0] === 'repo') return JSON.stringify({ url: 'https://ghe.example.co.jp/team-a/order-service' });
    return JSON.stringify({ data: detailOf(detailNode({ number: 8, timelineItems: { filteredCount: 1, nodes: [issueComment('sato', '2026-10-22T01:00:00Z', '見ました')] } })) });
  };

  it('一覧と同じ宛先に GraphQL を 1 回送り、その番号の PR の詳細を返す（番号は数として -F で渡す）', async () => {
    gh = detail;
    const res = await fetch(url('/api/prs/8'));
    expect(res.status).toBe(200);
    const d = (await res.json()) as PrDetail;
    expect(d.number).toBe(8);
    expect(d.timeline).toEqual([{ kind: 'comment', author: 'sato', at: '2026-10-22T01:00:00Z', body: '見ました' }]);
    const q = calls.at(-1)!;
    expect(q.slice(0, 2)).toEqual(['api', 'graphql']);
    expect(fieldOf(q, '--hostname')).toBe('ghe.example.co.jp');
    expect(q).toContain('owner=team-a');
    expect(q).toContain('name=order-service');
    expect(fieldOf(q, '-F')).toBe('number=8');
  });

  it('gh が失敗したら 502 と理由（宛先付き）', async () => {
    gh = async () => {
      throw new Error('gh api に失敗しました: HTTP 502');
    };
    const res = await fetch(url('/api/prs/8'));
    expect(res.status).toBe(502);
    expect(await res.text()).toBe('gh api に失敗しました: HTTP 502（宛先: ghe.example.co.jp/team-a/order-service）');
  });

  it('番号でなければ 404 で、GitHub には聞かない', async () => {
    gh = detail;
    for (const p of ['/api/prs/abc', '/api/prs/0', '/api/prs/8x', '/api/prs/-1']) expect((await fetch(url(p))).status).toBe(404);
    expect(calls).toEqual([]);
  });
});
