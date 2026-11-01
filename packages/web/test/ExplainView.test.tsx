// 説明の画面の「作者の説明」（設計書 3.1）を Markdown として描いたときの、リンク・画像・mermaid の振る舞い（2026-10-10）。
// mermaid は jsdom で図にできない（寸法を測る）ので、ライブラリを差し替えて渡し方と失敗の出し方を見る。
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Analysis, Ticket, TicketCandidate, TicketSearch } from '@ondina/model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { ExplainView } from '../src/components/ExplainView.js';
import { fixtureAnalysis } from './fixture.js';

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn<(src: string) => Promise<boolean>>(async () => true),
  render: vi.fn(async (_id: string, src: string) => ({ svg: `<svg data-testid="diagram"><text>${src.length}</text></svg>` })),
}));
vi.mock('mermaid', () => ({ default: mermaid }));

function drawBody(body: string, flavor = 'mocha') {
  const a = fixtureAnalysis();
  a.pr.body = body;
  a.claims = [];
  return view(a, flavor);
}

const author = (container: HTMLElement) => container.querySelector('.author')!;

/** 入口の状態（選んだコース・原文を開いているか）と押した物の受け口つきで描く */
function view(a: Analysis, flavor = 'mocha', home: { sel?: number | null; ticketOpen?: boolean; stage?: 1 | 2 } = {}, dispatch: (c: Command) => void = () => {}) {
  return render(<ExplainView analysis={a} flavor={flavor} sel={home.sel ?? null} ticketOpen={home.ticketOpen ?? false} stage={home.stage ?? 1} dispatch={dispatch} />);
}

describe('ExplainView（作者の説明の Markdown）', () => {
  beforeEach(() => {
    mermaid.initialize.mockClear();
    mermaid.render.mockClear();
    mermaid.parse.mockClear();
  });

  it('リンクは新しいタブで開く', () => {
    const { container } = drawBody('[設計](https://example.com/d)');
    const a = author(container).querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noreferrer');
  });

  it('画像は img で出し、読めなければ「画像: 代替テキスト」のリンクに替える', () => {
    const { container } = drawBody('![構成図](https://ghe.example.com/a.png)');
    const img = author(container).querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://ghe.example.com/a.png');
    fireEvent.error(img);
    const link = screen.getByRole('link', { name: '画像: 構成図' });
    expect(link.getAttribute('href')).toBe('https://ghe.example.com/a.png');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('mermaid のブロックは図にする。テーマはフレーバーで決める（latte = default、他 = dark）', async () => {
    const { container } = drawBody('```mermaid\ngraph TD\n  A-->B\n```\n', 'latte');
    await screen.findByTestId('diagram');
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), 'graph TD\n  A-->B');
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ startOnLoad: false, securityLevel: 'strict', theme: 'default' }));
    expect(author(container).querySelector('pre')).toBeNull();
  });

  it('図にできなければ原文のコードブロックを残し、その上に理由を出す', async () => {
    mermaid.parse.mockRejectedValueOnce(new Error('Parse error on line 2'));
    const { container } = drawBody('```mermaid\ngraph TD\n  A-->\n```\n');
    await screen.findByText(/図を描けませんでした: Parse error on line 2/);
    expect(author(container).querySelector('pre')?.textContent).toContain('A-->');
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('mermaid 以外のコードブロックは図にしない', async () => {
    const { container } = drawBody('```kotlin\nval x = 1\n```\n');
    await act(async () => {});
    expect(mermaid.render).not.toHaveBeenCalled();
    expect(author(container).querySelector('pre code')?.textContent).toBe('val x = 1\n');
  });
});

// 仕様の箱（設計書 3.1。2026-10-12）: --ticket で指定したチケットをそのまま出す
const ISSUE_HTML = '<h4>背景</h4><p>春のキャンペーンで割引コードを配る。</p><p><img src="/secure/attachment/1/discount.png" alt="discount.png"></p>';
const AT = '2026-10-12T05:03:00.000Z';
/** 画面と同じく手元の時刻で「10/12 14:03」 */
function when(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function drawTicket(ticket?: Analysis['pr']['ticket']) {
  const a = fixtureAnalysis();
  if (ticket === undefined) delete a.pr.ticket;
  else a.pr.ticket = ticket;
  a.specs = [];
  return view(a);
}
const specBox = (container: HTMLElement) => [...container.querySelectorAll('.box')].find((b) => b.querySelector('h3')?.textContent?.startsWith('仕様'))!;

describe('ExplainView（仕様の箱のチケット）', () => {
  it('指定が無ければ「チケット未指定」と --ticket の使い方', () => {
    const { container } = drawTicket();
    const box = specBox(container);
    expect(box.textContent).toContain('チケット未指定');
    expect(box.textContent).toContain('--ticket');
  });

  it('Jira から取れたら、番号のリンク・題・種類・状態・取った時刻・本文', () => {
    const { container } = drawTicket({ ref: 'SHOP-421', source: 'jira', at: AT, key: 'SHOP-421', url: 'https://jira.example.com/browse/SHOP-421', title: '注文に割引コードを適用できるようにする', kind: 'ストーリー', status: '進行中', body: ISSUE_HTML, format: 'html' });
    const box = specBox(container);
    const link = screen.getByRole('link', { name: /SHOP-421/ });
    expect(link.getAttribute('href')).toBe('https://jira.example.com/browse/SHOP-421');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(box.querySelector('.tkt-title')?.textContent).toBe('注文に割引コードを適用できるようにする');
    const chips = [...box.querySelectorAll('.tkt-meta .chip')].map((c) => c.textContent);
    expect(chips).toEqual(['ストーリー', '進行中', `Jira から ${when(AT)} に取得`]);
    expect(box.querySelector('.tkt-body h4')?.textContent).toBe('背景');
    expect(box.classList.contains('ai')).toBe(false);
  });

  it('本文の画像は、読めなければ「画像: 代替テキスト」のリンク（Jira の添付はログインが要る）', () => {
    drawTicket({ ref: 'SHOP-421', source: 'jira', at: AT, key: 'SHOP-421', url: 'https://jira.example.com/browse/SHOP-421', body: ISSUE_HTML, format: 'html' });
    const img = screen.getByRole('img', { name: 'discount.png' });
    expect(img.getAttribute('src')).toBe('https://jira.example.com/secure/attachment/1/discount.png');
    fireEvent.error(img);
    expect(screen.getByRole('link', { name: '画像: discount.png' }).getAttribute('target')).toBe('_blank');
  });

  it('ファイルから読んだら、番号の代わりにファイルの名前（リンクなし）', () => {
    const { container } = drawTicket({ ref: 'SHOP-421.md', source: 'file', at: AT, body: '## 背景\n\n割引コードを配る。\n', format: 'markdown' });
    const box = specBox(container);
    expect(box.querySelector('h3')?.textContent).toContain('SHOP-421.md');
    expect(box.querySelector('h3 a')).toBeNull();
    expect([...box.querySelectorAll('.tkt-meta .chip')].map((c) => c.textContent)).toEqual([`ファイルから ${when(AT)} に取得`]);
    expect(box.querySelector('.tkt-body h2')?.textContent).toBe('背景');
  });

  it('取れなかったら、番号と理由。解析は続けていると添える', () => {
    const { container } = drawTicket({ ref: 'SHOP-421', source: 'jira', at: AT, key: 'SHOP-421', url: 'https://jira.example.com/browse/SHOP-421', error: 'Jira が 401 を返しました。トークンがないか、期限が切れています' });
    const box = specBox(container);
    expect(box.querySelector('.tkt-fail b')?.textContent).toBe('SHOP-421 を取得できませんでした');
    expect(box.textContent).toContain('Jira が 401 を返しました。トークンがないか、期限が切れています');
    expect(screen.getByRole('link', { name: /SHOP-421/ }).getAttribute('href')).toBe('https://jira.example.com/browse/SHOP-421');
  });
});

// --ticket が無いとき、題・ブランチ名・本文から LLM が選んだチケット（設計書 3.1 / 5.1。2026-10-12）。選んだことは推定なので点線の枠
const JIRA = 'https://jira.example.com/browse/SHOP-421';
const C421: TicketCandidate = {
  ref: JIRA,
  label: 'SHOP-421',
  places: [
    { in: 'title', text: '[SHOP-421] 割引を足す', start: 1, end: 9 },
    { in: 'body', line: 1, text: `チケット: ${JIRA}`, start: 6, end: 6 + JIRA.length },
  ],
};
const C399: TicketCandidate = { ref: 'SHOP-399', label: 'SHOP-399', places: [{ in: 'body', line: 2, text: '関連: SHOP-399（前回）', start: 4, end: 12 }] };
const OK_RUN = { command: 'claude -p', status: 'ok' as const };
function drawSearch(search: TicketSearch, ticket?: Ticket) {
  const a = fixtureAnalysis();
  a.pr.ticketSearch = search;
  if (ticket === undefined) delete a.pr.ticket;
  else a.pr.ticket = ticket;
  a.specs = [];
  return view(a);
}

describe('ExplainView（題と本文から見つけたチケット）', () => {
  it('選んだら、見出しに「推定」、点線の枠に見つけた場所と選ばなかった候補。その下は取ったチケット', () => {
    const { container } = drawSearch({ candidates: [C421, C399], chosen: JIRA, llm: OK_RUN }, { ref: JIRA, source: 'jira', at: AT, key: 'SHOP-421', url: JIRA, title: '注文に割引コードを適用できるようにする', body: ISSUE_HTML, format: 'html' });
    const box = specBox(container);
    expect([...box.querySelectorAll('h3 .chip')].map((c) => c.textContent)).toEqual(['チケット', '推定']);
    const guess = box.querySelector('.tkt-guess')!;
    expect(guess.textContent).toContain('たぶん、この PR のチケット');
    const where = [...guess.querySelectorAll('.tkt-where .tkt-q')].map((q) => [q.querySelector('.at')?.textContent, q.querySelector('.hit')?.textContent]);
    expect(where).toEqual([
      ['題', 'SHOP-421'],
      ['本文 1 行目', JIRA],
    ]);
    const others = [...guess.querySelectorAll('.tkt-cands .tkt-cand')];
    expect(others.map((c) => c.querySelector('code')?.textContent)).toEqual(['SHOP-399']);
    expect(others[0]!.textContent).toContain('本文 2 行目');
    expect(guess.textContent).toContain('--ticket');
    expect(box.querySelector('.tkt-title')?.textContent).toBe('注文に割引コードを適用できるようにする');
  });

  it('選んだが取れなかったら、見つけた場所はそのままで、取れなかった理由', () => {
    const { container } = drawSearch({ candidates: [C421], chosen: JIRA, llm: OK_RUN }, { ref: JIRA, source: 'jira', at: AT, key: 'SHOP-421', url: JIRA, error: 'Jira が 401 を返しました' });
    const box = specBox(container);
    expect(box.querySelector('.tkt-guess')).not.toBeNull();
    expect(box.querySelector('.tkt-guess .tkt-cands')).toBeNull();
    expect(box.querySelector('.tkt-fail b')?.textContent).toBe('SHOP-421 を取得できませんでした');
  });

  it('候補が無ければ「見つかりませんでした」と、探した場所', () => {
    const { container } = drawSearch({ candidates: [] });
    const box = specBox(container);
    expect(box.querySelector('h3 .chip')).toBeNull();
    expect(box.querySelector('.tkt-none b')?.textContent).toBe('チケットは見つかりませんでした');
    expect(box.textContent).toContain('PR の題・ブランチ名・本文に、チケットの番号や URL がありませんでした');
    expect(box.textContent).toContain('--ticket');
    expect(box.textContent).not.toContain('チケット未指定');
  });

  it('LLM がどれも選ばなければ「見つかりませんでした」と、チケットではないと判断した候補', () => {
    const utf: TicketCandidate = { ref: 'UTF-8', label: 'UTF-8', places: [{ in: 'body', line: 3, text: 'CSV は UTF-8', start: 7, end: 12 }] };
    const { container } = drawSearch({ candidates: [utf], llm: OK_RUN });
    const box = specBox(container);
    expect(box.querySelector('.tkt-none b')?.textContent).toBe('チケットは見つかりませんでした');
    expect(box.textContent).toContain('LLM がこの PR のチケットではないと判断しました');
    expect([...box.querySelectorAll('.tkt-cand code')].map((c) => c.textContent)).toEqual(['UTF-8']);
  });

  it('LLM を使わなかった・失敗したら「選んでいません」と理由、候補の並び', () => {
    const skipped = specBox(drawSearch({ candidates: [C421, C399], llm: { command: 'c', status: 'skipped', reason: '--no-llm' } }).container);
    expect(skipped.querySelector('.tkt-none b')?.textContent).toBe('チケットを選んでいません');
    expect(skipped.textContent).toContain('LLM を使わずに解析したので（--no-llm）、候補を並べるだけにしています');
    expect([...skipped.querySelectorAll('.tkt-cand code')].map((c) => c.textContent)).toEqual(['SHOP-421', 'SHOP-399']);
    const failed = specBox(drawSearch({ candidates: [C421], llm: { command: 'c', status: 'failed', reason: '終了コード 2: boom' } }).container);
    expect(failed.textContent).toContain('LLM が失敗したので、候補を並べるだけにしています: 終了コード 2: boom');
  });
});

// チケットから抜き出した要求（設計書 3.1 / 10.8。2026-10-12）。要求は LLM の推定なので点線の枠と「AI」。
// 行の右はコースの丸（下のカード・地図と同じ色と番号。押すとそのコースを選ぶ）。原文は下に畳む（見本を比べて決めた形）
const SHOP421: Ticket = { ref: 'SHOP-421', source: 'jira', at: AT, key: 'SHOP-421', url: JIRA, title: '注文に割引コードを適用できるようにする', kind: 'ストーリー', status: '進行中', body: ISSUE_HTML, format: 'html' };
function drawSpecs(over: Partial<Pick<Analysis, 'specs' | 'llmSpecs'>> = {}, home: { sel?: number | null; ticketOpen?: boolean; stage?: 1 | 2 } = {}, dispatch: (c: Command) => void = () => {}) {
  const a = fixtureAnalysis();
  a.pr.ticket = SHOP421;
  a.specs = over.specs ?? [
    { id: 's1', text: '割引コードを 1 つ適用できる', hows: [3, 5] },
    { id: 's2', text: '期限切れのコードは 400 を返す', hows: [] },
  ];
  a.llmSpecs = over.llmSpecs ?? OK_RUN;
  const r = view(a, 'mocha', home, dispatch);
  return { ...r, a, box: specBox(r.container) };
}

describe('ExplainView（チケットから抜き出した要求）', () => {
  it('要求は点線の枠に「AI」と並べる。チケットの番号のリンクは見出しのまま', () => {
    const { box } = drawSpecs();
    const ai = box.querySelector('.spec-ai')!;
    expect(ai.querySelector('.chip.ai')?.textContent).toBe('AI');
    expect(ai.textContent).toContain('チケットから抜き出した要求');
    expect([...ai.querySelectorAll('.spec')].map((r) => r.querySelector('.t')?.textContent)).toEqual(['割引コードを 1 つ適用できる', '期限切れのコードは 400 を返す']);
    expect(box.querySelector('h3 a')?.getAttribute('href')).toBe(JIRA);
  });

  it('行の右はコースの丸（色と番号）。指を乗せるとコースの題', () => {
    const { box, a } = drawSpecs();
    const marks = [...box.querySelectorAll('.spec')[0]!.querySelectorAll('button.cb')];
    expect(marks.map((b) => [b.textContent, b.classList.contains(`cc${b.textContent}`)])).toEqual([['3', true], ['5', true]]);
    const title = a.hows.find((h) => h.id === 3)!.title;
    expect(marks[0]!.getAttribute('title')).toBe(`コース 3: ${title}（押すと下のコースを選ぶ）`);
  });

  it('対応するコースが無い行は、赤のチップ「対応するコースなし」', () => {
    const { box } = drawSpecs();
    const row = box.querySelectorAll('.spec')[1]!;
    expect(row.querySelector('.chip.d')?.textContent).toBe('対応するコースなし');
    expect(row.querySelector('button.cb')).toBeNull();
  });

  it('丸を押すと、そのコースを選ぶ（下のカードを押すのと同じ home.select）。選んでいるコースの丸は押された形', () => {
    const dispatch = vi.fn<(c: Command) => void>();
    const { box } = drawSpecs({}, { sel: 5 }, dispatch);
    const [c3, c5] = [...box.querySelectorAll('.spec')[0]!.querySelectorAll('button.cb')];
    expect(c3!.getAttribute('aria-pressed')).toBe('false');
    expect(c5!.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(c3!);
    expect(dispatch).toHaveBeenCalledWith({ id: 'home.select', courseId: 3 });
  });

  it('チケットの原文は畳んである。「チケットの原文」を押すと home.ticket、開いていれば題と本文', () => {
    const dispatch = vi.fn<(c: Command) => void>();
    const closed = drawSpecs({}, { ticketOpen: false }, dispatch);
    const toggle = screen.getByRole('button', { name: /チケットの原文/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('注文に割引コードを適用できるようにする');
    expect(closed.box.querySelector('.tkt-body')).toBeNull();
    fireEvent.click(toggle);
    expect(dispatch).toHaveBeenCalledWith({ id: 'home.ticket' });
    closed.unmount();
    const open = drawSpecs({}, { ticketOpen: true });
    expect(screen.getByRole('button', { name: /チケットの原文/ }).getAttribute('aria-expanded')).toBe('true');
    expect(open.box.querySelector('.tkt-body h4')?.textContent).toBe('背景');
    expect([...open.box.querySelectorAll('.tkt-meta .chip')].map((c) => c.textContent)).toContain('ストーリー');
  });

  it('抜き出しが失敗したら、理由と、開いたままの原文（開け閉めのボタンは無い）', () => {
    const { box } = drawSpecs({ specs: [], llmSpecs: { command: 'c', status: 'failed', reason: '時間切れ（0 KB 受信）' } });
    const fail = box.querySelector('.spec-fail')!;
    expect(fail.textContent).toContain('要求を抜き出せませんでした');
    expect(fail.textContent).toContain('時間切れ（0 KB 受信）');
    expect(fail.textContent).toContain('もう一度 analyze すると抜き出し直します');
    expect(box.querySelector('.tkt-body')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /チケットの原文/ })).toBeNull();
  });

  it('LLM が 0 件と答えたら、そう知らせて原文を開いたまま', () => {
    const { box } = drawSpecs({ specs: [] });
    expect(box.querySelector('.spec-fail')?.textContent).toContain('チケットに要求を見つけませんでした');
    expect(box.querySelector('.tkt-body')).not.toBeNull();
  });

  it('抜き出していない解析（llmSpecs が無い）は今までどおり原文だけ', () => {
    const a = fixtureAnalysis();
    a.pr.ticket = SHOP421;
    a.specs = [];
    delete a.llmSpecs;
    const box = specBox(view(a).container);
    expect(box.querySelector('.spec-ai')).toBeNull();
    expect(box.querySelector('.spec-fail')).toBeNull();
    expect(box.querySelector('.tkt-body')).not.toBeNull();
  });
});

// 2026-10-29: 左の箱は 1 背景 / 2 この PR の 2 段（見本の新案「背景を 1 段目に分ける」にした）
describe('ExplainView（左の箱の 2 段）', () => {
  const ticket: Ticket = { ref: 'SHOP-421', source: 'jira', at: AT, key: 'SHOP-421', body: '<h2>背景</h2><p>春のキャンペーン（SHOP-400）で割引コードを配る。</p>', format: 'html' };

  it('1 背景: 要点と、チケットの原文から写した「なぜ」をチケットの番号つきで出す。段のボタンは home.stage', () => {
    const a = fixtureAnalysis();
    a.pr.ticket = ticket;
    a.background = { why: ['春のキャンペーン（SHOP-400）で割引コードを配る。'] };
    const got: Command[] = [];
    const { container } = view(a, 'mocha', {}, (c) => got.push(c));
    expect(container.querySelector('.ex-headline')?.textContent).toBe(a.summary.headline);
    const quote = container.querySelector('.ex-quote')!;
    expect(quote.querySelector('.chip')?.textContent).toBe('チケット SHOP-421 の原文');
    expect(quote.textContent).toContain('春のキャンペーン（SHOP-400）で割引コードを配る。');
    fireEvent.click(screen.getByRole('button', { name: /2 この PR へ/ }));
    fireEvent.click(screen.getByRole('tab', { name: /この PR/ }));
    expect(got).toEqual([
      { id: 'home.stage', stage: 2 },
      { id: 'home.stage', stage: 2 },
    ]);
  });

  it('1 背景: チケットはあるが「なぜ」が無ければそう言う', () => {
    const a = fixtureAnalysis();
    a.pr.ticket = ticket;
    view(a);
    expect(screen.getByText('チケットに、なぜこの変更をするかの文が見つかりませんでした。')).toBeInTheDocument();
  });

  // 2026-10-29（PR 3）: 背景に「どんな案件の一部？」。親チケット・同じ案件の PR はプログラムが Jira と GitHub から取った事実、親の目的の文は親の本文から写した物
  const parent = { key: 'SHOP-400', url: 'https://jira.example.com/browse/SHOP-400', via: 'parent' as const, title: '春のキャンペーン', kind: 'エピック' };
  const pr = (number: number, title: string, state: 'open' | 'draft' | 'merged' | 'closed', repo = 'shop/order-service', self = false) => ({
    repo,
    number,
    title,
    url: `https://ghe.example.com/${repo}/pull/${number}`,
    state,
    keys: ['SHOP-420'],
    ...(self ? { self: true as const } : {}),
  });
  const projectOf = (container: HTMLElement) => container.querySelector('.ex-project')!;
  const prsOf = (container: HTMLElement) => [...projectOf(container).querySelectorAll('.ex-pr')].map((e) => [e.querySelector('.chip')?.textContent, e.querySelector('a')?.textContent, e.classList.contains('ex-me')]);

  it('1 背景: どんな案件の一部？ は「何のための PR？」の次。親チケットの原文の引用（題は Jira へのリンク）と、同じ案件の PR を状態のチップつきで', () => {
    const a = fixtureAnalysis();
    a.pr.ticket = ticket;
    a.background = {
      why: ['春のキャンペーン（SHOP-400）で割引コードを配る。'],
      project: {
        parent,
        why: ['4 月の 1 か月、割引コードを配って初めての注文を増やす。'],
        children: ['SHOP-420', 'SHOP-421', 'SHOP-422'],
        searched: ['SHOP-400', 'SHOP-421', 'SHOP-420', 'SHOP-422'],
        repo: 'shop/order-service',
        prs: [pr(40, '割引率の表を足す', 'merged'), pr(47, '注文に割引コードを適用する', 'open', undefined, true), pr(49, 'キャンペーンのお知らせメール', 'open'), pr(12, 'お知らせメールの文面', 'draft', 'shop/mail-templates'), pr(8, '前の案', 'closed', 'shop/mail-templates')],
      },
    };
    const { container } = view(a);
    expect([...container.querySelectorAll('.ex-qa h4')].map((h) => h.textContent).slice(0, 2)).toEqual(['何のための PR？', 'どんな案件の一部？']);
    const quote = projectOf(container).querySelector('.ex-quote')!;
    expect(quote.querySelector('.chip')?.textContent).toBe('親チケット SHOP-400 の原文');
    const title = quote.querySelector('a')!;
    expect([title.textContent, title.getAttribute('href'), title.getAttribute('target')]).toEqual(['春のキャンペーン', 'https://jira.example.com/browse/SHOP-400', '_blank']);
    expect(quote.textContent).toContain('4 月の 1 か月、割引コードを配って初めての注文を増やす。');
    expect(projectOf(container).querySelector('.ex-rel .ex-rl')?.textContent).toBe('同じ案件の PR');
    expect(prsOf(container)).toEqual([
      ['マージ済み', '#40 割引率の表を足す', false],
      ['この PR', '#47 注文に割引コードを適用する', true],
      ['レビュー中', '#49 キャンペーンのお知らせメール', false],
      ['Draft', 'mail-templates#12 お知らせメールの文面', false],
      ['クローズ', 'mail-templates#8 前の案', false],
    ]);
    const link = projectOf(container).querySelector('.ex-pr a')!;
    expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('title')]).toEqual(['https://ghe.example.com/shop/order-service/pull/40', '_blank', 'shop/order-service#40']);
  });

  it('1 背景: 親の目的の文が無ければ、引用は親の題だけ。PR が見つからなければ、探した番号の数を添えてそう言う', () => {
    const a = fixtureAnalysis();
    a.background = { project: { parent, children: ['SHOP-420', 'SHOP-421'], searched: ['SHOP-400', 'SHOP-421', 'SHOP-420'], repo: 'shop/order-service', prs: [] } };
    const { container } = view(a);
    expect(projectOf(container).querySelector('.ex-quote')?.textContent).toBe('親チケット SHOP-400 の原文春のキャンペーン');
    expect(projectOf(container).querySelector('.ex-rel')).toBeNull();
    expect(screen.getByText('同じ案件の PR は見つかりませんでした。親と子のチケットの番号 3 個で、PR の題と本文を探しました。')).toBeInTheDocument();
  });

  it('1 背景: 探さなかった番号の数と、取れなかった物の理由は、問いの中に 1 行ずつ。親を調べられなければ理由だけ', () => {
    const a = fixtureAnalysis();
    a.background = { project: { parent, searched: ['SHOP-400'], skipped: 12, repo: 'shop/order-service', prs: [pr(40, '割引率の表を足す', 'merged')], errors: ['同じ親の下のチケットを探せませんでした: Jira が 500 を返しました'] } };
    const { container, unmount } = view(a);
    expect([...projectOf(container).querySelectorAll('.muted')].map((p) => p.textContent)).toEqual([
      '同じ親の下のチケットが多いので、番号 1 個だけで探しました（残り 12 個）。',
      '同じ親の下のチケットを探せませんでした: Jira が 500 を返しました',
    ]);
    unmount();
    a.background = { project: { errors: ['親チケットを調べられませんでした: Jira が 500 を返しました'] } };
    const again = view(a);
    expect(screen.getByRole('heading', { name: 'どんな案件の一部？' })).toBeInTheDocument();
    expect(projectOf(again.container).querySelector('.ex-quote')).toBeNull();
    expect(screen.getByText('親チケットを調べられませんでした: Jira が 500 を返しました')).toBeInTheDocument();
  });

  it('1 背景: 親が無い（project が無い）なら、どんな案件の一部？ は出さない', () => {
    const a = fixtureAnalysis();
    a.pr.ticket = ticket;
    view(a);
    expect(screen.queryByRole('heading', { name: 'どんな案件の一部？' })).toBeNull();
  });

  // 2026-10-29（PR 2）: 背景に「この PR の前からあるものは？」「出てくる言葉は？」。候補はプログラム、選ぶ・書くのは 2 回目の LLM
  const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
  const rowsOf = (container: HTMLElement) =>
    [...container.querySelectorAll('.ex-pre .ex-row')].map((r) => [r.querySelector('code')?.textContent, r.querySelector('.ex-pre-text')?.textContent, r.querySelector('.chip')?.textContent]);
  /** 図の箱を API → Application → Domain → Infrastructure の停留所で組み直す（層の行の材料） */
  const withFlow = (a: Analysis) => {
    const id = (fq: string) => a.symbols.find((s) => s.fqName === fq)!.id;
    const box = (title: string, howId: number, fq: string) => ({ title, howIds: [howId], symbol: id(fq), before: '', after: '', untouched: [] });
    a.summary.flows = [
      {
        nodes: [
          box('受け付け', 6, 'com.example.order.api.OrderController.apply'),
          box('適用', 5, 'com.example.order.application.ApplyDiscountUseCase.execute'),
          box('計算', 3, 'com.example.order.domain.Order'),
          box('保存', 4, 'com.example.order.infra.OrderRepositoryImpl.save'),
          box('応答', 7, 'com.example.order.api.OrderResponse'),
        ],
      },
    ];
    return a;
  };

  it('1 背景: 前からあるものは名前・1 文・事実のチップ（この PR で削除 / 変更なし）。最後の行は図の箱の層（設定ファイルの分け方）', () => {
    const a = withFlow(fixtureAnalysis());
    a.background = {
      existing: [
        { names: [{ fqName: 'com.example.order.domain.DiscountPolicy.rateFor', path: 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt', kind: 'function' }], text: 'コードから割引率を引く。', removed: false },
        {
          names: [
            { fqName: 'com.example.order.domain.Order.promo', path: ORDER, kind: 'property' },
            { fqName: 'com.example.order.domain.Order.getDiscount', path: ORDER, kind: 'function' },
          ],
          text: '前の割引の持ち方。',
          removed: true,
        },
        { names: [{ fqName: 'com.example.order.domain.Money.Companion.ZERO', path: 'src/main/kotlin/com/example/order/domain/Money.kt', kind: 'property' }], text: '0 円の金額。', removed: false },
      ],
    };
    const { container } = view(a);
    expect(screen.getByRole('heading', { name: 'この PR の前からあるものは？' })).toBeInTheDocument();
    expect(rowsOf(container)).toEqual([
      ['DiscountPolicy.rateFor()', 'コードから割引率を引く。', 'この PR で変更なし'],
      ['Order.promo · getDiscount()', '前の割引の持ち方。', 'この PR で削除'],
      ['Money.ZERO', '0 円の金額。', 'この PR で変更なし'],
      ['層 4 つ', 'API · Application · Domain · Infrastructure。「この PR」の図の箱に付く層の名前。', '設定ファイルの分け方'],
    ]);
    expect(container.querySelectorAll('.ex-pre .chip.ex-gone')).toHaveLength(1);
  });

  it('1 背景: 層を推定した解析では、層の行のチップは点線の「分け方は推定」。前からあるものがなくても層の行は出す', () => {
    const a = withFlow(fixtureAnalysis());
    delete a.background;
    for (const s of a.symbols) if (s.layer !== undefined) s.layerProvenance = 'llm';
    const { container } = view(a);
    expect(rowsOf(container)).toEqual([['層 4 つ', 'API · Application · Domain · Infrastructure。「この PR」の図の箱に付く層の名前。', '分け方は推定']]);
    expect(container.querySelector('.ex-pre .chip')?.classList.contains('ex-guess')).toBe(true);
  });

  it('1 背景: 出てくる言葉は「意味は推定」のチップと、言葉・コードの名前・意味の 2 列', () => {
    const a = fixtureAnalysis();
    a.background = {
      terms: [
        { word: '小計', code: 'subtotal', meaning: '割引の前の、品物の額の合計。' },
        { word: '合計', code: 'total()' },
      ],
    };
    const { container } = view(a);
    const h = screen.getByRole('heading', { name: /出てくる言葉は？/ });
    expect(h.querySelector('.chip.ai')?.textContent).toBe('意味は推定');
    expect([...container.querySelectorAll('.ex-terms > div')].map((d) => [d.querySelector('b')?.textContent, d.querySelector('code')?.textContent, d.querySelector('span')?.textContent ?? null])).toEqual([
      ['小計', 'subtotal', '割引の前の、品物の額の合計。'],
      ['合計', 'total()', null],
    ]);
  });

  it('1 背景: 前からあるもの・層の行・言葉がなければ、その問いは出さない', () => {
    const a = fixtureAnalysis();
    delete a.background;
    a.summary.flows = [];
    view(a);
    expect(screen.queryByRole('heading', { name: 'この PR の前からあるものは？' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /出てくる言葉は？/ })).toBeNull();
  });

  it('2 この PR: 例は根拠のファイルと行を添え、図は箱ごとにコースの丸（押すと home.select）・前と後・変えていない物・次へ渡る値', () => {
    const a = fixtureAnalysis();
    const got: Command[] = [];
    const { container } = view(a, 'mocha', { stage: 2 }, (c) => got.push(c));
    expect(screen.getByText(/^値は OrderTest\.kt 15〜17 行/)).toBeInTheDocument();
    const nodes = a.summary.flows![0]!.nodes;
    expect([...container.querySelectorAll('.flow-box .flow-title')].map((t) => t.firstChild?.textContent)).toEqual(nodes.map((n) => n.title));
    expect([...container.querySelectorAll('.flow-arrow code')].map((c) => c.textContent)).toEqual(nodes.flatMap((n) => n.pass ?? []));
    expect(screen.getByText('変えていない: 割引率の決め方')).toBeInTheDocument();
    const dot = container.querySelectorAll('.flow-box .cpick')[0]!;
    fireEvent.click(dot);
    expect(got).toEqual([{ id: 'home.select', courseId: nodes[0]!.howIds[0] }]);
  });

  it('2 この PR: どの箱にも入らなかったコースは図の下に丸で並べる', () => {
    const a = fixtureAnalysis();
    a.summary.flows = [{ nodes: a.summary.flows![0]!.nodes.slice(1) }];
    const { container } = view(a, 'mocha', { stage: 2 });
    expect([...container.querySelectorAll('.flow-miss .cpick')].map((b) => b.textContent)).toEqual(a.summary.flows === undefined ? [] : ['6']);
  });

  it('古い形の説明（問題・方針・触らないもの・前後表）の解析は、解析し直しを案内する', () => {
    const a = fixtureAnalysis();
    a.summary = { problem: '前は外にあった。', approach: '持たせた。', untouched: ['率'], beforeAfter: [] };
    view(a);
    expect(screen.getByText(/この解析は前の形の説明です/)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});
