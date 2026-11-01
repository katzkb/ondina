// どんな案件の一部か（設計書 3.1 / 5.1。2026-10-29）。Jira は手元に立てた偽サーバー、GitHub は偽の gh（fixture の GraphQL の答え）で確かめる
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Ticket } from '@ondina/model';
import { fetchProject, MAX_PROJECT_KEYS, type ProjectContext } from '../src/project.js';

const TICKETS = path.resolve(import.meta.dirname, '../../../fixtures/order-service/ticket');
const PARENT = readFileSync(path.join(TICKETS, 'jira-parent.json'), 'utf8');
const CHILDREN = readFileSync(path.join(TICKETS, 'jira-children.json'), 'utf8');
const SEARCH = readFileSync(path.join(TICKETS, 'github-search.json'), 'utf8');
const EPIC_LINK = 'com.pyxis.greenhopper.jira:gh-epic-link';

let server: Server;
let jira: string;
let seen: string[];
/** 子の検索で返す番号（既定は fixture の 3 件） */
let children: string | undefined;

const json = (res: import('node:http').ServerResponse, body: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(typeof body === 'string' ? body : JSON.stringify(body));

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '';
    seen.push(url);
    const u = new URL(url, 'http://x');
    const issue = /^\/rest\/api\/2\/issue\/([^/]+)$/.exec(u.pathname)?.[1];
    const fields = u.searchParams.get('fields');
    // Cloud: 親の欄がエピックを指す
    if (issue === 'SHOP-421' && fields === 'parent') return json(res, { key: 'SHOP-421', fields: { parent: { id: '10400', key: 'SHOP-400', fields: { summary: '春のキャンペーン' } } } });
    if (issue === 'SHOP-400' && fields === 'summary,description,issuetype,status') return json(res, PARENT);
    // Jira Server / Data Center: 親の欄は無く、エピックの欄（欄の id は Jira ごと）
    if (issue === 'DC-10' && fields === 'parent') return json(res, { key: 'DC-10', fields: {} });
    if (issue === 'DC-10' && fields === 'customfield_10008') return json(res, { key: 'DC-10', fields: { customfield_10008: 'DC-1' } });
    if (issue === 'DC-1') return json(res, { key: 'DC-1', fields: { summary: '在庫の刷新', issuetype: { name: 'エピック' } } });
    // 親もエピックも無い
    if (issue === 'NO-1' && fields === 'parent') return json(res, { key: 'NO-1', fields: { parent: null } });
    if (issue === 'NO-1') return json(res, { key: 'NO-1', fields: { customfield_10008: null } });
    // 親の中身を見る権限が無い
    if (issue === 'LOCK-2' && fields === 'parent') return json(res, { key: 'LOCK-2', fields: { parent: { key: 'LOCK-1' } } });
    if (issue === 'LOCK-1') return res.writeHead(403).end();
    // Cloud の新しい検索だけがある（古い /search は 410）
    if (issue === 'NEW-2' && fields === 'parent') return json(res, { key: 'NEW-2', fields: { parent: { key: 'NEW-1' } } });
    if (issue === 'NEW-1') return json(res, { key: 'NEW-1', fields: { summary: '新しい検索' } });
    if (u.pathname === '/rest/api/2/field') return json(res, [{ id: 'summary', schema: { type: 'string', system: 'summary' } }, { id: 'customfield_10008', name: 'エピックリンク', schema: { type: 'any', custom: EPIC_LINK } }]);
    const jql = u.searchParams.get('jql');
    if (u.pathname === '/rest/api/2/search' && jql?.startsWith('parent = NEW-1')) return res.writeHead(410).end();
    if (u.pathname === '/rest/api/2/search/jql' && jql?.startsWith('parent = NEW-1')) return json(res, { issues: [{ key: 'NEW-3' }, { key: 'NEW-2' }], isLast: true });
    if (u.pathname === '/rest/api/2/search' && jql?.startsWith('parent = SHOP-400')) return json(res, children ?? CHILDREN);
    if (u.pathname === '/rest/api/2/search' && jql?.startsWith('cf[10008] = DC-1')) return json(res, { issues: [{ key: 'DC-11' }, { key: 'DC-10' }] });
    if (u.pathname === '/rest/api/2/search' && jql?.startsWith('parent = LOCK-1')) return res.writeHead(403).end();
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  jira = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  seen = [];
  children = undefined;
});

const ticket = (key: string): Ticket => ({ ref: key, source: 'jira', at: '2026-10-29T05:00:00.000Z', key, url: `${jira}/browse/${key}`, title: '題' });

/** 偽の gh。repo view と pr view は GitHub Enterprise Server の URL、graphql は fixture の答え（呼ばれた引数を残す） */
const gh = (answer: string = SEARCH) => {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'repo') return '{"url":"https://ghe.example.com/shop/order-service"}';
    if (args[0] === 'pr') return `{"url":"https://ghe.example.com/shop/order-service/pull/${args[2]}"}`;
    if (args[0] === 'api') return answer;
    throw new Error(`gh ${args.join(' ')}`);
  };
  return { run, calls };
};

const ctx = (run: ProjectContext['run'], pr: ProjectContext['pr'] = { number: 0, head: 'feature/discount' }): ProjectContext => ({
  repo: '/repo',
  pr,
  settings: undefined,
  deps: { cwd: '/repo', env: { ONDINA_TICKET_TOKEN: 'tok' }, keychain: async () => ({ none: true }) },
  run,
});

describe('fetchProject（親チケット）', () => {
  it('Jira の親の欄から親を辿り、親の中身は原文のまま取る', async () => {
    const p = await fetchProject(ticket('SHOP-421'), ctx(gh().run));
    const raw = JSON.parse(PARENT) as { renderedFields: { description: string } };
    expect(p?.parent).toEqual({ key: 'SHOP-400', url: `${jira}/browse/SHOP-400`, via: 'parent', title: '春のキャンペーン', kind: 'エピック', status: '進行中', body: raw.renderedFields.description, format: 'html' });
    expect(seen).toContain('/rest/api/2/issue/SHOP-421?fields=parent');
    expect(seen).toContain('/rest/api/2/issue/SHOP-400?fields=summary,description,issuetype,status&expand=renderedFields');
  });

  it('親の欄が無ければ、エピックの欄（id は schema.custom で探す）から辿る', async () => {
    const p = await fetchProject(ticket('DC-10'), ctx(gh('{"data":{}}').run));
    expect(p?.parent).toMatchObject({ key: 'DC-1', via: 'epic', title: '在庫の刷新', kind: 'エピック' });
    expect(p?.children).toEqual(['DC-10', 'DC-11']);
    expect(seen).toContain(`/rest/api/2/search?jql=${encodeURIComponent('cf[10008] = DC-1 ORDER BY key ASC')}&fields=summary&maxResults=100`);
  });

  it('親もエピックも無ければ undefined（問いごと出さない）', async () => {
    expect(await fetchProject(ticket('NO-1'), ctx(gh().run))).toBeUndefined();
  });

  it('Jira で取れなかったチケット・Jira 以外のチケットは調べない', async () => {
    expect(await fetchProject({ ...ticket('SHOP-421'), error: 'x' }, ctx(gh().run))).toBeUndefined();
    expect(await fetchProject({ ref: 'a.md', source: 'file', at: '', body: 'x' }, ctx(gh().run))).toBeUndefined();
    expect(await fetchProject({ ref: 'SHOP-421', source: 'command', at: '', key: 'SHOP-421' }, ctx(gh().run))).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('親の中身を取れなければ、番号と場所だけの親と理由。子と PR は親の番号で探す', async () => {
    const p = await fetchProject(ticket('LOCK-2'), ctx(gh('{"data":{"k0":{"issueCount":0,"nodes":[]},"k1":{"issueCount":0,"nodes":[]}}}').run));
    expect(p?.parent).toEqual({ key: 'LOCK-1', url: `${jira}/browse/LOCK-1`, via: 'parent' });
    expect(p?.errors).toEqual([
      '親チケット LOCK-1 を取得できませんでした: Jira が 403 を返しました。トークンがないか、期限が切れています',
      '同じ親の下のチケットを探せませんでした: Jira が 403 を返しました。トークンがないか、期限が切れています',
    ]);
    expect(p?.searched).toEqual(['LOCK-1', 'LOCK-2']);
    expect(p?.prs).toEqual([]);
  });

  it('古い検索（/rest/api/2/search）が無い Jira Cloud は、新しい検索（/search/jql）で子を探す', async () => {
    const p = await fetchProject(ticket('NEW-2'), ctx(gh('{"data":{}}').run));
    expect(p?.children).toEqual(['NEW-2', 'NEW-3']);
  });

  it('親を調べられなければ、親の無い project と理由', async () => {
    const p = await fetchProject({ ...ticket('SHOP-421'), url: 'http://127.0.0.1:1/browse/SHOP-421' }, ctx(gh().run));
    expect(p?.parent).toBeUndefined();
    expect(p?.errors?.[0]).toMatch(/^親チケットを調べられませんでした: Jira に接続できませんでした: /);
  });
});

describe('fetchProject（同じ案件の PR）', () => {
  it('親と子の番号をこの PR の GitHub で探す。番号は親・このチケット・残りの子の番号順', async () => {
    const { run, calls } = gh();
    const p = await fetchProject(ticket('SHOP-421'), ctx(run));
    expect(p?.children).toEqual(['SHOP-420', 'SHOP-421', 'SHOP-422']);
    expect(p?.searched).toEqual(['SHOP-400', 'SHOP-421', 'SHOP-420', 'SHOP-422']);
    expect(calls[0]).toEqual(['repo', 'view', '--json', 'url']);
    const api = calls[1]!;
    expect(api.slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'ghe.example.com']);
    expect(api).toEqual(expect.arrayContaining(['-f', 'q0="SHOP-400" is:pr in:title,body', '-f', 'q3="SHOP-422" is:pr in:title,body']));
    expect(api.find((a) => a.startsWith('query='))).toMatch(/k3: search\(query: \$q3, type: ISSUE, first: \d+\)/);
  });

  it('題・本文・ブランチ名に番号がある PR だけ残し（SHOP-4210 は外す）、この PR は同じリポジトリの同じブランチ名', async () => {
    const p = await fetchProject(ticket('SHOP-421'), ctx(gh().run));
    expect(p?.prs).toEqual([
      { repo: 'shop/order-service', number: 40, title: '割引率の表を足す', url: 'https://ghe.example.com/shop/order-service/pull/40', state: 'merged', keys: ['SHOP-420'] },
      { repo: 'shop/order-service', number: 47, title: '注文に割引コードを適用する', url: 'https://ghe.example.com/shop/order-service/pull/47', state: 'open', keys: ['SHOP-421'], self: true },
      { repo: 'shop/order-service', number: 49, title: 'SHOP-422 キャンペーンのお知らせメール', url: 'https://ghe.example.com/shop/order-service/pull/49', state: 'open', keys: ['SHOP-422'] },
      { repo: 'shop/mail-templates', number: 12, title: 'お知らせメールの文面', url: 'https://ghe.example.com/shop/mail-templates/pull/12', state: 'draft', keys: ['SHOP-422'] },
    ]);
    expect(p?.repo).toBe('shop/order-service');
    expect(p).not.toHaveProperty('errors');
  });

  it('PR の解析は PR の URL からホストを決め、この PR は同じ番号', async () => {
    const { run, calls } = gh();
    const p = await fetchProject(ticket('SHOP-421'), ctx(run, { number: 49, head: 'other' }));
    expect(calls[0]).toEqual(['pr', 'view', '49', '--json', 'url']);
    expect(p?.prs?.filter((x) => x.self).map((x) => x.number)).toEqual([49]);
  });

  it('同じ PR が 2 つの番号で見つかれば 1 つにして、番号を両方持つ', async () => {
    const node = { number: 7, title: 'SHOP-400 SHOP-422 まとめ', url: 'u7', state: 'CLOSED', isDraft: false, headRefName: 'x', body: '', repository: { nameWithOwner: 'shop/order-service' } };
    const answer = JSON.stringify({ data: { k0: { issueCount: 1, nodes: [node] }, k3: { issueCount: 1, nodes: [node] } } });
    const p = await fetchProject(ticket('SHOP-421'), ctx(gh(answer).run));
    expect(p?.prs).toEqual([{ repo: 'shop/order-service', number: 7, title: 'SHOP-400 SHOP-422 まとめ', url: 'u7', state: 'closed', keys: ['SHOP-400', 'SHOP-422'] }]);
  });

  it(`番号は ${MAX_PROJECT_KEYS} 個まで（このチケットは必ず入れる）。超えた数は skipped`, async () => {
    children = JSON.stringify({ issues: Array.from({ length: 40 }, (_, i) => ({ key: `SHOP-${500 + i}` })).concat([{ key: 'SHOP-421' }]) });
    const p = await fetchProject(ticket('SHOP-421'), ctx(gh('{"data":{}}').run));
    expect(p?.children).toHaveLength(41);
    expect(p?.searched).toHaveLength(MAX_PROJECT_KEYS);
    expect(p?.searched?.slice(0, 3)).toEqual(['SHOP-400', 'SHOP-421', 'SHOP-500']);
    expect(p?.skipped).toBe(42 - MAX_PROJECT_KEYS);
  });

  it('番号に正規表現の記号があっても、その文字どおりに確かめる（. を任意の 1 文字にしない）', async () => {
    children = JSON.stringify({ issues: [{ key: 'SHOP-421' }, { key: 'SHOP.X-1' }] });
    const node = (number: number, title: string) => ({ number, title, url: `u${number}`, state: 'OPEN', isDraft: false, headRefName: 'x', body: '', repository: { nameWithOwner: 'shop/order-service' } });
    const answer = JSON.stringify({ data: { k2: { issueCount: 2, nodes: [node(1, 'SHOPZX-1 別件'), node(2, 'SHOP.X-1 本物')] } } });
    const p = await fetchProject(ticket('SHOP-421'), ctx(gh(answer).run));
    expect(p?.searched).toEqual(['SHOP-400', 'SHOP-421', 'SHOP.X-1']);
    expect(p?.prs?.map((x) => x.number)).toEqual([2]);
  });

  it('gh が失敗したら理由を残す（prs は無い）', async () => {
    const run = async (args: string[]) => {
      if (args[0] === 'repo') throw new Error('gh repo view に失敗しました: no git remotes found');
      return '';
    };
    const p = await fetchProject(ticket('SHOP-421'), ctx(run));
    expect(p?.prs).toBeUndefined();
    expect(p?.errors).toEqual(['同じ案件の PR を探せませんでした: gh repo view に失敗しました: no git remotes found']);
  });
});
