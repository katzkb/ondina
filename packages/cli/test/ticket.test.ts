// --ticket で指定したチケットを取る（設計書 5.1。2026-10-12）。Jira は手元に立てた偽サーバー、コマンドは sh -c、ファイルは一時ディレクトリで確かめる
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { KeychainRead } from '../src/keychain.js';
import { fetchTicket, parseJiraRef } from '../src/ticket.js';

const ISSUE = readFileSync(path.resolve(import.meta.dirname, '../../../fixtures/order-service/ticket/jira-issue.json'), 'utf8');
const AT = new Date('2026-10-12T05:03:00.000Z');

let dir: string;
let server: Server;
let jira: string;
let seen: { path: string; headers: IncomingHttpHeaders } | undefined;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-ticket-'));
  server = createServer((req, res) => {
    seen = { path: req.url ?? '', headers: req.headers };
    const key = /\/rest\/api\/2\/issue\/([^?]+)/.exec(req.url ?? '')?.[1];
    if (key === 'SHOP-421') return res.writeHead(200, { 'content-type': 'application/json' }).end(ISSUE);
    if (key === 'SHOP-422') {
      const raw = JSON.parse(ISSUE) as Record<string, unknown>;
      delete raw['renderedFields'];
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...raw, key: 'SHOP-422' }));
    }
    if (key === 'SHOP-401') return res.writeHead(401).end();
    if (key === 'SHOP-404') return res.writeHead(404, { 'content-type': 'application/json' }).end('{"errorMessages":["Issue does not exist or you do not have permission to see it."],"errors":{}}');
    if (key === 'SHOP-500') return res.writeHead(500).end();
    if (key === 'SHOP-200') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><body>ログイン</body></html>');
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  jira = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => (seen = undefined));

// キーチェーンは既定で「無い」。テストが手元の Mac のキーチェーンを読まないように、いつも差し替える
const deps = (env: Record<string, string> = {}, keychain: KeychainRead | undefined = { none: true }) => ({ cwd: dir, env, now: () => AT, keychain: async () => keychain });

describe('parseJiraRef', () => {
  it('番号は設定の Jira の場所で引く（末尾の / は落とす。小文字は大文字に）', () => {
    expect(parseJiraRef('SHOP-421', 'https://x.atlassian.net/')).toEqual({ base: 'https://x.atlassian.net', key: 'SHOP-421' });
    expect(parseJiraRef('shop-421', 'https://x.atlassian.net')).toEqual({ base: 'https://x.atlassian.net', key: 'SHOP-421' });
  });
  it('番号で、設定に Jira の場所が無ければ理由', () => {
    expect(parseJiraRef('SHOP-421', undefined)).toEqual({ error: 'Jira の URL が設定にありません。設定画面の「チケット」で設定するか、URL で指定してください' });
  });
  it('/browse/ の URL は、その前を Jira の場所にする（Jira Server / Data Center の /jira のような前置きも残す）。設定は要らない', () => {
    expect(parseJiraRef('https://x.atlassian.net/browse/SHOP-421', undefined)).toEqual({ base: 'https://x.atlassian.net', key: 'SHOP-421' });
    expect(parseJiraRef('https://jira.example.com/jira/browse/SHOP-421?focusedCommentId=1#c1', undefined)).toEqual({ base: 'https://jira.example.com/jira', key: 'SHOP-421' });
  });
  it('ボードの selectedIssue も読む。Jira Server / Data Center は /secure/ の前、Cloud は origin', () => {
    expect(parseJiraRef('https://jira.example.com/jira/secure/RapidBoard.jspa?rapidView=1&selectedIssue=SHOP-421', undefined)).toEqual({ base: 'https://jira.example.com/jira', key: 'SHOP-421' });
    expect(parseJiraRef('https://x.atlassian.net/jira/software/projects/SHOP/boards/1?selectedIssue=SHOP-421', undefined)).toEqual({ base: 'https://x.atlassian.net', key: 'SHOP-421' });
  });
  it('Cloud の新しい画面（…/issues/SHOP-421）も読む', () => {
    expect(parseJiraRef('https://x.atlassian.net/jira/software/c/projects/SHOP/issues/SHOP-421', undefined)).toEqual({ base: 'https://x.atlassian.net', key: 'SHOP-421' });
  });
  it('URL が設定の Jira の場所で始まれば、設定の場所を使う', () => {
    expect(parseJiraRef('https://jira.example.com/jira/projects/SHOP/issues/SHOP-421', 'https://jira.example.com/jira')).toEqual({ base: 'https://jira.example.com/jira', key: 'SHOP-421' });
  });
  it('番号も URL の形でもなければ理由', () => {
    expect(parseJiraRef('foo bar', 'https://x.atlassian.net')).toEqual({ error: 'チケットの番号か URL の形式ではありません: foo bar' });
    expect(parseJiraRef('https://x.atlassian.net/jira/your-work', undefined)).toEqual({ error: 'URL からチケットの番号を読めません: https://x.atlassian.net/jira/your-work' });
  });
});

describe('fetchTicket（Jira）', () => {
  it('題・種類・状態・Jira が HTML に直した本文を取る', async () => {
    const t = await fetchTicket('SHOP-421', { jiraUrl: jira }, deps({ ONDINA_TICKET_TOKEN: 'tok' }));
    const issue = JSON.parse(ISSUE) as { renderedFields: { description: string } };
    expect(t).toEqual({
      ref: 'SHOP-421',
      source: 'jira',
      at: '2026-10-12T05:03:00.000Z',
      key: 'SHOP-421',
      url: `${jira}/browse/SHOP-421`,
      title: '注文に割引コードを適用できるようにする',
      kind: 'ストーリー',
      status: '進行中',
      body: issue.renderedFields.description,
      format: 'html',
    });
    expect(seen?.path).toBe('/rest/api/2/issue/SHOP-421?fields=summary,description,issuetype,status&expand=renderedFields');
    expect(seen?.headers['accept']).toBe('application/json');
  });
  it('メールがあれば Basic（Jira Cloud のメール + API トークン）', async () => {
    await fetchTicket('SHOP-421', { jiraUrl: jira, email: 'you@example.com' }, deps({ ONDINA_TICKET_TOKEN: 'tok' }));
    expect(seen?.headers['authorization']).toBe(`Basic ${Buffer.from('you@example.com:tok').toString('base64')}`);
  });
  it('メールが無ければ Bearer（Jira Server / Data Center の個人用アクセストークン）', async () => {
    await fetchTicket('SHOP-421', { jiraUrl: jira }, deps({ ONDINA_TICKET_TOKEN: 'tok' }));
    expect(seen?.headers['authorization']).toBe('Bearer tok');
  });
  it('環境変数が無ければ、キーチェーンの ondina-jira のトークンを使う', async () => {
    const asked: string[] = [];
    await fetchTicket('SHOP-421', { jiraUrl: jira }, { ...deps(), keychain: async (service) => (asked.push(service), { token: 'from-keychain' }) });
    expect(asked).toEqual(['ondina-jira']);
    expect(seen?.headers['authorization']).toBe('Bearer from-keychain');
  });
  it('環境変数があればキーチェーンは読まない（環境変数が先）', async () => {
    let asked = 0;
    await fetchTicket('SHOP-421', { jiraUrl: jira }, { ...deps({ ONDINA_TICKET_TOKEN: 'tok' }), keychain: async () => (asked++, { token: 'from-keychain' }) });
    expect(asked).toBe(0);
    expect(seen?.headers['authorization']).toBe('Bearer tok');
  });
  it('Jira に頼まないとき（番号の形が違う・コマンド・ファイル）はキーチェーンを読まない', async () => {
    let asked = 0;
    const keychain = async (): Promise<KeychainRead> => (asked++, { token: 'from-keychain' });
    await fetchTicket('foo bar', { jiraUrl: jira }, { ...deps(), keychain });
    await fetchTicket('X-1', { source: 'command', command: 'echo body' }, { ...deps(), keychain });
    expect(asked).toBe(0);
  });
  it('トークンが無ければ認証なしで頼む', async () => {
    const t = await fetchTicket('SHOP-421', { jiraUrl: jira }, deps());
    expect(seen?.headers['authorization']).toBeUndefined();
    expect(t.title).toBe('注文に割引コードを適用できるようにする');
  });
  it('URL で指定すれば設定は要らない（取り方の既定は Jira）', async () => {
    const t = await fetchTicket(`${jira}/browse/SHOP-421`, undefined, deps());
    expect(t).toMatchObject({ ref: `${jira}/browse/SHOP-421`, key: 'SHOP-421', url: `${jira}/browse/SHOP-421` });
  });
  it('Jira が HTML を返さなければ、元の本文を改行を保った文字で', async () => {
    const t = await fetchTicket('SHOP-422', { jiraUrl: jira }, deps());
    expect(t.format).toBe('text');
    expect(t.body).toMatch(/^h4\. 背景\n/);
  });
  it('401 はトークンの理由。トークンが無ければ環境変数の名前を添える', async () => {
    expect(await fetchTicket('SHOP-401', { jiraUrl: jira }, deps({ ONDINA_TICKET_TOKEN: 'tok' }))).toEqual({
      ref: 'SHOP-401',
      source: 'jira',
      at: '2026-10-12T05:03:00.000Z',
      key: 'SHOP-401',
      url: `${jira}/browse/SHOP-401`,
      error: 'Jira が 401 を返しました。トークンがないか、期限が切れています',
    });
    const none = await fetchTicket('SHOP-401', { jiraUrl: jira }, deps());
    expect(none.error).toBe('Jira が 401 を返しました。トークンがないか、期限が切れています（環境変数 ONDINA_TICKET_TOKEN も、キーチェーンの ondina-jira もありません）');
  });
  it('401 で、キーチェーンを読めなかったらその理由を添える', async () => {
    const t = await fetchTicket('SHOP-401', { jiraUrl: jira }, deps({}, { error: 'ユーザーが拒否しました' }));
    expect(t.error).toBe('Jira が 401 を返しました。トークンがないか、期限が切れています（環境変数 ONDINA_TICKET_TOKEN がなく、キーチェーンの ondina-jira を読めませんでした: ユーザーが拒否しました）');
  });
  it('401 で、Mac でなければ（キーチェーンを読まない）環境変数の名前だけ', async () => {
    const t = await fetchTicket('SHOP-401', { jiraUrl: jira }, { ...deps(), keychain: async () => undefined });
    expect(t.error).toBe('Jira が 401 を返しました。トークンがないか、期限が切れています（環境変数 ONDINA_TICKET_TOKEN がありません）');
  });
  it('404 は番号か権限', async () => {
    const t = await fetchTicket('SHOP-404', { jiraUrl: jira }, deps());
    expect(t.error).toBe('Jira に SHOP-404 がありません。番号か、見る権限を確かめてください');
  });
  it('その他の失敗は返した番号', async () => {
    const t = await fetchTicket('SHOP-500', { jiraUrl: jira }, deps());
    expect(t.error).toBe('Jira が 500 を返しました');
  });
  it('JSON でない答えは、ログイン画面に回された可能性', async () => {
    const t = await fetchTicket('SHOP-200', { jiraUrl: jira }, deps());
    expect(t.error).toBe('Jira の答えが JSON ではありません。ログイン画面に回された可能性があります');
  });
  it('届かなければ「接続できませんでした」と理由', async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const t = await fetchTicket('SHOP-421', { jiraUrl: `http://127.0.0.1:${port}` }, deps());
    expect(t.error).toMatch(/^Jira に接続できませんでした: .*ECONNREFUSED/);
  });
  it('番号の形が違えば頼まずに理由', async () => {
    const t = await fetchTicket('foo bar', { jiraUrl: jira }, deps());
    expect(t).toEqual({ ref: 'foo bar', source: 'jira', at: '2026-10-12T05:03:00.000Z', error: 'チケットの番号か URL の形式ではありません: foo bar' });
    expect(seen).toBeUndefined();
  });
});

describe('fetchTicket（コマンド）', () => {
  const cmd = (command: string) => ({ source: 'command' as const, command });
  it('JSON を出せばその形で読む。値は環境変数 ONDINA_TICKET で渡る', async () => {
    const t = await fetchTicket('GH-12', cmd(`printf '{"title":"題","body":"本文 %s","url":"https://example.com/i/12","key":"#12","kind":"issue","status":"open"}' "$ONDINA_TICKET"`), deps());
    expect(t).toEqual({ ref: 'GH-12', source: 'command', at: '2026-10-12T05:03:00.000Z', key: '#12', url: 'https://example.com/i/12', title: '題', kind: 'issue', status: 'open', body: '本文 GH-12', format: 'markdown' });
  });
  it('body の無い JSON でも、知っている欄（title など）が 1 つでもあればその形で読む（本文なし）', async () => {
    const t = await fetchTicket('X-1', cmd(`printf '{"title":"題だけ","url":"https://example.com/i/1"}'`), deps());
    expect(t).toEqual({ ref: 'X-1', source: 'command', at: '2026-10-12T05:03:00.000Z', url: 'https://example.com/i/1', title: '題だけ' });
  });
  it('知っている欄が 1 つも無い JSON は、全体を本文として読む（黙って消さない）', async () => {
    const t = await fetchTicket('X-1', cmd(`printf '{"fields":{"summary":"x"}}'`), deps());
    expect(t).toMatchObject({ body: '{"fields":{"summary":"x"}}', format: 'markdown' });
  });
  it('JSON でなければ全体を Markdown の本文として読む', async () => {
    const t = await fetchTicket('X-1', cmd(`printf '## 背景\\n\\n%s です' "$ONDINA_TICKET"`), deps());
    expect(t).toEqual({ ref: 'X-1', source: 'command', at: '2026-10-12T05:03:00.000Z', body: '## 背景\n\nX-1 です', format: 'markdown' });
  });
  it('他の環境変数もそのまま渡る（トークンなど）', async () => {
    const t = await fetchTicket('X-1', cmd('printf "%s" "$MY_TOKEN"'), deps({ MY_TOKEN: 'secret' }));
    expect(t.body).toBe('secret');
  });
  it('終了コードが 0 でなければ、stderr の最後の行を理由に', async () => {
    const t = await fetchTicket('X-1', cmd('echo first >&2; echo "not found" >&2; exit 2'), deps());
    expect(t).toEqual({ ref: 'X-1', source: 'command', at: '2026-10-12T05:03:00.000Z', error: 'チケットを取得するコマンドが失敗しました（終了コード 2）: not found' });
  });
  it('何も出さなければ理由', async () => {
    const t = await fetchTicket('X-1', cmd('true'), deps());
    expect(t.error).toBe('チケットを取得するコマンドが何も出力しませんでした');
  });
  it('時間内に終わらなければ打ち切って理由', async () => {
    const t = await fetchTicket('X-1', cmd('sleep 5'), { ...deps(), commandTimeoutMs: 100 });
    expect(t.error).toBe('チケットを取得するコマンドが 0.1 秒以内に終わりませんでした');
  });
  it('コマンドが設定に無ければ理由', async () => {
    const t = await fetchTicket('X-1', { source: 'command' }, deps());
    expect(t.error).toBe('チケットを取得するコマンドが設定にありません。設定画面の「チケット」で設定してください');
  });
});

describe('fetchTicket（ファイル）', () => {
  it('値がファイルとして在れば、設定に関係なくそれを Markdown として読む', async () => {
    writeFileSync(path.join(dir, 'SHOP-421.md'), '## 背景\n\n本文\n');
    const t = await fetchTicket('SHOP-421.md', { source: 'command', command: 'exit 1' }, deps());
    expect(t).toEqual({ ref: 'SHOP-421.md', source: 'file', at: '2026-10-12T05:03:00.000Z', body: '## 背景\n\n本文\n', format: 'markdown' });
  });
  it('ディレクトリはファイルとして扱わない（同じ名前の番号として Jira に頼む）', async () => {
    const t = await fetchTicket('.', { jiraUrl: jira }, deps());
    expect(t.source).toBe('jira');
  });
});
