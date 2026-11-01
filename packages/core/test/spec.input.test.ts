// 要求の抜き出し（設計書 10.8）への入力を、1 回目の入力と How の割当とチケットから組む。決定的。
// ゴールデンは expected/llm-spec-input.json（record-llm-spec.mjs がこれを LLM コマンドに渡す）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { How, Hunk, ParentTicket, Spec, Ticket } from '@ondina/model';
import type { LlmInput } from '../src/label/types.js';
import { buildSpecInput, SPEC_BODY_LIMIT, ticketPlainText } from '../src/spec/input.js';
import { FIXTURE_ROOT } from './fixture.js';

const base: Pick<LlmInput, 'hunks' | 'rippleGroups'> = {
  hunks: [
    { id: 'h1', path: 'a/Order.kt', symbol: 'Order', kindHint: 'core', lines: ['-x', '+y'] },
    { id: 'h2', path: 'a/Api.kt', symbol: 'post', lines: ['+p'] },
    { id: 'h3', path: 'a/Logger.kt', symbol: 'format', lines: ['-l', '+m'] },
  ],
  rippleGroups: [
    {
      id: 'g1',
      pattern: 'a → b',
      coreHunkId: 'h1',
      members: 3,
      representative: { hunkId: 'r1', path: 'b/View.kt', symbol: 'field', lines: ['-a', '+b'] },
      deviations: [],
    },
    {
      id: 'g2',
      pattern: 'c → d',
      coreHunkId: 'h3',
      members: 2,
      representative: { hunkId: 'r2', path: 'b/Log.kt', symbol: 'log', lines: ['-c', '+d'] },
      deviations: [],
    },
  ],
};
const hows: How[] = [
  { id: 1, title: 'Order に割引を持たせる', why: 'W1', specIds: [] },
  { id: 2, title: '入口でコードを受け取る', why: 'W2', specIds: [] },
];
const hunk = (id: string, hs: number[]) => ({ id, hows: hs });
const hunks: Pick<Hunk, 'id' | 'hows'>[] = [hunk('h1', [1]), hunk('h2', [1, 2]), hunk('h3', []), hunk('r1', [1]), hunk('r2', [])];
const ticket: Ticket = { ref: 'SHOP-421', source: 'jira', at: '2026-10-12T05:00:00Z', key: 'SHOP-421', title: '割引', kind: 'ストーリー', status: '進行中', body: '- 割引できる', format: 'markdown' };

describe('buildSpecInput', () => {
  const input = buildSpecInput({ base, hows, hunks, ticket });

  it('How ごとに入った hunk と束（束は代表の How）を並べる', () => {
    expect(input.hows).toEqual([
      { id: 1, title: 'Order に割引を持たせる', why: 'W1', hunkIds: ['h1', 'h2'], groupIds: ['g1'] },
      { id: 2, title: '入口でコードを受け取る', why: 'W2', hunkIds: ['h2'], groupIds: [] },
    ]);
  });

  it('どの How にも入らなかった hunk と束は渡さない（選べるのは How だけ）', () => {
    expect(input.hunks.map((h) => h.id)).toEqual(['h1', 'h2']);
    expect(input.rippleGroups.map((g) => g.id)).toEqual(['g1']);
  });

  it('チケットは番号・題・種類と本文の文字だけ（状態・取った時刻は渡さない）', () => {
    expect(input.ticket).toEqual({ key: 'SHOP-421', title: '割引', kind: 'ストーリー', body: '- 割引できる' });
  });

  it('前回の要求があれば文と対応だけを previous に入れる。無ければ欄ごと無い', () => {
    expect(input).not.toHaveProperty('previous');
    const previous: Spec[] = [{ id: 's1', text: '割引できる', hows: [1] }];
    expect(buildSpecInput({ base, hows, hunks, ticket, previous }).previous).toEqual({ specs: [{ text: '割引できる', hows: [1] }] });
    expect(buildSpecInput({ base, hows, hunks, ticket, previous: [] })).not.toHaveProperty('previous');
  });

  it('親チケットは番号・題・種類と本文の文字だけ（2026-10-29）。無ければ欄ごと無い', () => {
    expect(input).not.toHaveProperty('parent');
    const parent: ParentTicket = { key: 'SHOP-400', url: 'https://x/browse/SHOP-400', via: 'parent', title: '春', kind: 'エピック', status: '進行中', body: '<p>目的の文。</p>', format: 'html' };
    expect(buildSpecInput({ base, hows, hunks, ticket, parent }).parent).toEqual({ key: 'SHOP-400', title: '春', kind: 'エピック', body: '目的の文。' });
    const long = buildSpecInput({ base, hows, hunks, ticket, parent: { ...parent, body: 'あ'.repeat(SPEC_BODY_LIMIT + 1), format: 'text' } });
    expect(long.parent?.body).toHaveLength(SPEC_BODY_LIMIT);
    expect(long.parent?.truncated).toBe(true);
  });

  it(`本文が ${SPEC_BODY_LIMIT} 字を超えたら切って truncated を付ける`, () => {
    const long = buildSpecInput({ base, hows, hunks, ticket: { ...ticket, body: 'あ'.repeat(SPEC_BODY_LIMIT + 5) } });
    expect(long.ticket.body).toHaveLength(SPEC_BODY_LIMIT);
    expect(long.ticket.truncated).toBe(true);
  });
});

describe('ticketPlainText', () => {
  const html = (body: string): Ticket => ({ ...ticket, body, format: 'html' });

  it('Markdown と文字はそのまま。本文が無ければ空', () => {
    expect(ticketPlainText(ticket)).toBe('- 割引できる');
    expect(ticketPlainText({ ...ticket, body: 'a\nb', format: 'text' })).toBe('a\nb');
    expect(ticketPlainText({ ref: 'X-1', source: 'jira', at: '' })).toBe('');
  });

  it('Jira の HTML はタグを外す。見出し・段落・改行は行に、リストの項目は「- 」にする', () => {
    expect(ticketPlainText(html('<h4><a name="x"></a>やること</h4>\n<ul>\n\t<li>割引できる（<tt>POST /a</tt>）</li>\n\t<li>保存する</li>\n</ul><p>一行目<br/>二行目</p>'))).toBe(
      'やること\n- 割引できる（POST /a）\n- 保存する\n一行目\n二行目',
    );
  });

  it('実体参照を戻し、script と style とコメントの中身は落とす', () => {
    expect(ticketPlainText(html('<p>a &amp;&lt;b&gt; &quot;c&quot; &#39;d&#39; &#x41;&#66;&nbsp;e</p><script>alert(1)</script><style>p{}</style><!-- x -->'))).toBe(`a &<b> "c" 'd' AB e`);
  });

  it('表のセルは空白で区切り、行は改行にする', () => {
    expect(ticketPlainText(html('<table><tr><th>コード</th><th>率</th></tr><tr><td>SPRING10</td><td>10%</td></tr></table>'))).toBe('コード 率\nSPRING10 10%');
  });
});

describe('buildSpecInput（fixture）', () => {
  const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8')) as T;
  type Hows = { hows: How[]; hunks: Array<{ id: string; hows: number[] }> };
  type JiraIssue = { key: string; fields: { summary: string; issuetype: { name: string }; status: { name: string } }; renderedFields: { description: string } };
  const labeled = read<Hows>('expected/hows.json');
  const jira = read<JiraIssue>('ticket/jira-issue.json');
  const epic = read<JiraIssue>('ticket/jira-parent.json');
  // 偽 Jira（cli の ticket.test.ts）が返すのと同じチケット。HTML の本文から抜き出す（実際の Jira と同じ道）
  const fixtureTicket: Ticket = {
    ref: 'SHOP-421',
    source: 'jira',
    at: '2026-10-12T05:00:00.000Z',
    key: jira.key,
    url: 'https://example.atlassian.net/browse/SHOP-421',
    title: jira.fields.summary,
    kind: jira.fields.issuetype.name,
    status: jira.fields.status.name,
    body: jira.renderedFields.description,
    format: 'html',
  };
  // 偽 Jira の親（cli の project.test.ts と同じ。SHOP-421 の親の欄が指すエピック）
  const parent: ParentTicket = {
    key: epic.key,
    url: 'https://example.atlassian.net/browse/SHOP-400',
    via: 'parent',
    title: epic.fields.summary,
    kind: epic.fields.issuetype.name,
    status: epic.fields.status.name,
    body: epic.renderedFields.description,
    format: 'html',
  };
  const input = buildSpecInput({ base: read<LlmInput>('expected/llm-input.json'), hows: labeled.hows, hunks: labeled.hunks, ticket: fixtureTicket, parent });

  it('7 つの How が全部入り、本文はタグの無い文字', () => {
    expect(input.hows.map((h) => h.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(input.ticket.body).not.toMatch(/<[a-z]/);
    expect(input.ticket.body).toContain('- 期限切れのコードは 400 を返す');
    expect(input.parent?.body).toContain('4 月の 1 か月、割引コードを配って初めての注文を増やす。');
  });

  it('ゴールデン expected/llm-spec-input.json と一致する', async () => {
    await expect(JSON.stringify(input, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/llm-spec-input.json'));
  });
});
