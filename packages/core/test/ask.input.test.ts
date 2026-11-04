// 案内人に聞く（設計書 3.10 / 10.5）の材料を、Analysis と「何について」から組む。決定的。
// ゴールデンは expected/ask-input-{pr,symbol,hunk,lines,web,why}.json（record-llm-ask.mjs がこれを LLM コマンドに渡す）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Analysis, AskEntry, Background, Hunk, Ticket } from '@ondina/model';
import { ASK_TEXT_LIMIT, buildAskInput, excerptLines, fileLines, hunkLines } from '../src/ask/input.js';
import { FIXTURE_ROOT } from './fixture.js';
import { fixtureAnalysis } from './fixture-analysis.js';

const analysis = fixtureAnalysis();
const ORDER = '98dcd7c9d8d6e0ed59854b2fff454f5bf805bae7';
const RATE_FOR = '2d34cf1c445b513eec0e31ad87b68bdaf5ab9cc8';
const EXECUTE = 'a135ba90941c193b82bb22bc319e52347521ee99';
const hunkOf = (suffix: string, symbol: string): Hunk => analysis.hunks.find((h) => h.path.endsWith(suffix) && h.symbol === symbol)!;

describe('行に番号を付ける', () => {
  it('差分: 変わらない行は head の番号、消した行は base の番号、足した行は head の番号', () => {
    expect(hunkLines(analysis.hunks.find((h) => h.id === ORDER)!)).toEqual([
      'h3   class Order(',
      'h4       val id: OrderId,',
      'h5       val subtotal: Money,',
      'b6 -     val promo: Promo? = null,',
      'h6 +     var discount: Money = Money.ZERO,',
      'h7   ) {',
      'b8 -     fun getDiscount(): Money = promo?.amount ?: Money.ZERO',
      'h8 +     fun applyDiscount(cmd: DiscountCommand) {',
      'h9 +         val rate = DiscountPolicy.rateFor(cmd.code)',
      'h10 +         discount = subtotal * rate',
      'h11 +     }',
      'h12   ',
      'b10 -     fun total(): Money = subtotal',
      'h13 +     fun total(): Money = subtotal - discount',
      'h14   }',
    ]);
  });

  it('全文: head の 1 行目から', () => {
    const f = analysis.files!.find((x) => x.path.endsWith('domain/DiscountPolicy.kt'))!;
    expect(fileLines(f.tokens).slice(8, 10)).toEqual(['h9       fun rateFor(code: String): Rate =', 'h10           TABLE[code] ?: Rate.ZERO']);
  });

  it('抜粋: まとまりの間は ⋯', () => {
    expect(excerptLines([{ start: 9, lines: ['a', 'b'], centers: [9] }, { start: 20, lines: ['c'], centers: [20] }])).toEqual(['h9   a', 'h10   b', '⋯', 'h20   c']);
  });
});

describe('buildAskInput', () => {
  it('共通: PR の題・コースの一覧・質問', () => {
    const input = buildAskInput(analysis, { kind: 'pr' }, 'Q');
    expect(input.pr).toEqual({ title: 'main..feature/discount' });
    expect(input.courses.map((c) => c.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(input.question).toBe('Q');
    expect(input.history).toEqual([]);
  });

  it('PR 全体: 束のメンバーは代表と逸脱だけ。種別と束の役を付け、未帰属はシンボル名', () => {
    const { place } = buildAskInput(analysis, { kind: 'pr' }, 'Q');
    if (place.kind !== 'pr') throw new Error(place.kind);
    const grouped = place.hunks.filter((h) => h.group);
    expect(grouped.map((h) => h.group!.role).sort()).toEqual(['deviation', 'representative']);
    expect(grouped[0]!.group).toMatchObject({ pattern: expect.stringContaining('getDiscount') as string, members: 22 });
    expect(place.hunks).toHaveLength(48 - 23 + 2); // 束はメンバー 22（代表を含む）と逸脱 1
    expect(place.hunks.find((h) => h.symbol === 'com.example.order.domain.Order')).toMatchObject({ kind: 'core', lines: expect.arrayContaining(['h13 +     fun total(): Money = subtotal - discount']) as string[] });
    expect(place.unassigned).toHaveLength(3);
    expect(place.summary!.headline).not.toBe('');
    expect(place.summary!.flow.map((n) => n.title)).toHaveLength(5);
  });

  // 2026-10-11: 停留所は差分だけ（差分の無い DiscountPolicy.rateFor は停留所にしない）
  it('コース: 読む順番の停留所（差分だけ）と、その差分の行', () => {
    const { place } = buildAskInput(analysis, { kind: 'course', courseId: 3 }, 'Q');
    if (place.kind !== 'course') throw new Error(place.kind);
    expect(place.course).toMatchObject({ id: 3, title: 'Order に discount と applyDiscount を持たせる' });
    expect(place.stops).toHaveLength(4);
    expect(place.stops.every((s) => s.changed)).toBe(true);
    expect(place.stops.slice(2).every((s) => s.test)).toBe(true);
  });

  it('コース外（0）: どのコースにも入らない差分を並べる', () => {
    const { place } = buildAskInput(analysis, { kind: 'course', courseId: 0 }, 'Q');
    if (place.kind !== 'course') throw new Error(place.kind);
    expect(place.course).toMatchObject({ id: 0 });
    expect(place.stops).toHaveLength(3);
  });

  it('シンボル: 全文・その差分・呼ぶ / 呼ばれる / テストの周り・入っているコース', () => {
    const { place } = buildAskInput(analysis, { kind: 'symbol', symbolId: ORDER, courseId: 3 }, 'Q');
    if (place.kind !== 'code') throw new Error(place.kind);
    expect(place).toMatchObject({ about: 'symbol', path: 'src/main/kotlin/com/example/order/domain/Order.kt', symbol: 'com.example.order.domain.Order', changed: true, courses: [3] });
    expect(place.file![12]).toBe('h13       fun total(): Money = subtotal - discount');
    expect(place.hunks).toHaveLength(1);
    expect(place.related.find((r) => r.relation === 'calls' && r.symbol.endsWith('rateFor'))).toMatchObject({ changed: false });
    expect(place.related.filter((r) => r.relation === 'testedBy').length).toBeGreaterThan(0);
    expect(place.related.length).toBeLessThanOrEqual(12);
  });

  it('参照している所: 束のメンバーは代表と逸脱だけ（22 か所を並べない）', () => {
    const { place } = buildAskInput(analysis, { kind: 'symbol', symbolId: ORDER, courseId: 3 }, 'Q');
    if (place.kind !== 'code') throw new Error(place.kind);
    const refs = place.related.filter((r) => r.relation === 'referencedBy').map((r) => r.symbol);
    expect(refs).toContain('com.example.promo.PromoService.apply');
    expect(refs).toContain('com.example.admin.OrderAdminView.discountField');
    expect(refs).not.toContain('com.example.cart.CartSummary.discount');
  });

  it('変わっていないシンボル: 差分は無く、全文はある', () => {
    const { place } = buildAskInput(analysis, { kind: 'symbol', symbolId: RATE_FOR }, 'Q');
    if (place.kind !== 'code') throw new Error(place.kind);
    expect(place).toMatchObject({ changed: false, hunks: [], courses: [] });
    expect(place.file).toBeDefined();
    expect(place.related.some((r) => r.relation === 'calledBy' && r.symbol === 'com.example.order.domain.Order')).toBe(true);
  });

  it('差分 1 つ: 束の逸脱なら役とパターン', () => {
    const apply = hunkOf('promo/PromoService.kt', 'apply()');
    const { place } = buildAskInput(analysis, { kind: 'hunk', hunkId: apply.id }, 'Q');
    if (place.kind !== 'code') throw new Error(place.kind);
    expect(place.about).toBe('hunk');
    expect(place.hunks[0]!.group).toMatchObject({ role: 'deviation' });
    expect(place.hunks[0]!.lines).toContain('h10 +         val d = order.discount.takeIf { it > Money.ZERO } ?: legacyPromo(order)');
  });

  it('ファイル: 同じファイルの差分を全部', () => {
    const { place } = buildAskInput(analysis, { kind: 'file', path: 'src/main/kotlin/com/example/order/domain/Order.kt' }, 'Q');
    if (place.kind !== 'code') throw new Error(place.kind);
    expect(place).toMatchObject({ about: 'file', related: [] });
    expect(place.hunks.length).toBe(analysis.hunks.filter((h) => h.path.endsWith('domain/Order.kt')).length);
  });

  it('全文の無い古い解析: file の欄が無い', () => {
    const old: Analysis = fixtureAnalysis({ files: false });
    const { place } = buildAskInput(old, { kind: 'symbol', symbolId: ORDER }, 'Q');
    expect(place.kind === 'code' && 'file' in place).toBe(false);
  });

  it('前に聞いたこと: 直前の 3 問まで、答えは文をつないで', () => {
    const entry = (n: number): AskEntry => ({
      id: `e${n}`,
      key: 'pr',
      place: { kind: 'pr' },
      question: `q${n}`,
      answer: { lead: `l${n}`, items: [{ text: `i${n}` }], tail: `t${n}` },
      command: 'c',
      ms: 1,
      at: '',
    });
    const input = buildAskInput(analysis, { kind: 'pr' }, 'Q', [1, 2, 3, 4].map(entry));
    expect(input.history).toEqual([
      { question: 'q2', answer: 'l2\ni2\nt2' },
      { question: 'q3', answer: 'l3\ni3\nt3' },
      { question: 'q4', answer: 'l4\ni4\nt4' },
    ]);
  });
});

// 2026-11-04: 題しか渡さなかったので、「なぜ」の理由が PR の本文とチケットにあっても分からないと答えた
describe('PR の本文・チケット・背景', () => {
  const fixtureText = (rel: string) => readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8');
  const jira = JSON.parse(fixtureText('ticket/jira-issue.json')) as { fields: { summary: string }; renderedFields: { description: string } };
  const spec = JSON.parse((JSON.parse(fixtureText('llm/spec-output.json')) as { stdout: string }).stdout) as { why: string[]; parentWhy: string[] };
  const written = JSON.parse(fixtureText('expected/text.json')) as { background: Background };
  const jiraTicket: Ticket = { ref: 'SHOP-421', source: 'jira', at: '2026-10-29T00:00:00.000Z', key: 'SHOP-421', url: 'https://example.atlassian.net/browse/SHOP-421', title: jira.fields.summary, body: jira.renderedFields.description, format: 'html' };
  const background: Background = { why: spec.why, project: { parent: { key: 'SHOP-400', url: 'https://example.atlassian.net/browse/SHOP-400', via: 'epic' }, why: spec.parentWhy, children: ['SHOP-421'] }, ...written.background };
  const withPr = (pr: Partial<Analysis['pr']>, extra: Partial<Analysis> = {}): Analysis => ({ ...analysis, pr: { ...analysis.pr, ...pr }, ...extra });

  it('本文はそのまま（前後の空白を除く）。空なら渡さない', () => {
    const body = fixtureText('pr-body.md');
    expect(buildAskInput(withPr({ body }), { kind: 'pr' }, 'Q').pr).toEqual({ title: 'main..feature/discount', body: body.trim() });
    expect(buildAskInput(withPr({ body: ' \n' }), { kind: 'pr' }, 'Q').pr).toEqual({ title: 'main..feature/discount' });
  });

  it(`長い本文は ${ASK_TEXT_LIMIT} 字で切って末尾に ⋯（チケットの本文も同じ）`, () => {
    const long = 'あ'.repeat(ASK_TEXT_LIMIT + 10);
    const { pr } = buildAskInput(withPr({ body: long, ticket: { ...jiraTicket, body: long, format: 'markdown' } }), { kind: 'pr' }, 'Q');
    expect(pr.body).toBe(`${'あ'.repeat(ASK_TEXT_LIMIT)}\n⋯`);
    expect(pr.ticket!.body).toBe(`${'あ'.repeat(ASK_TEXT_LIMIT)}\n⋯`);
  });

  it('チケット: 番号と題と本文。Jira の HTML はタグを外した文字にする', () => {
    const { ticket } = buildAskInput(withPr({ ticket: jiraTicket }), { kind: 'pr' }, 'Q').pr;
    expect(ticket).toMatchObject({ ref: 'SHOP-421', title: '注文に割引コードを適用できるようにする' });
    expect(ticket!.body).not.toMatch(/<[a-z/]/);
    expect(ticket!.body!.split('\n')).toEqual(expect.arrayContaining(['背景', '春のキャンペーン（SHOP-400）で割引コードを配る。今は注文に割引を付ける手段が無い。', '- 知らないコードは割引しない（小計のまま）']));
  });

  it('取れなかったチケットは ref だけ', () => {
    const failed: Ticket = { ref: 'SHOP-421', source: 'jira', at: '', key: 'SHOP-421', error: '401 Unauthorized' };
    expect(buildAskInput(withPr({ ticket: failed }), { kind: 'pr' }, 'Q').pr.ticket).toEqual({ ref: 'SHOP-421' });
  });

  it('背景: チケットの理由・親チケットの目的・前からあるもの（名前とパス）・言葉。案件の PR の一覧などは渡さない', () => {
    const input = buildAskInput(withPr({}, { background }), { kind: 'pr' }, 'Q');
    expect(input.background).toEqual({
      why: spec.why,
      projectWhy: spec.parentWhy,
      existing: written.background.existing!.map((e) => ({ names: e.names.map(({ fqName, path }) => ({ fqName, path })), text: e.text, removed: e.removed })),
      terms: written.background.terms,
    });
    expect(buildAskInput(withPr({}, { background: {} }), { kind: 'pr' }, 'Q')).not.toHaveProperty('background');
    expect(buildAskInput(analysis, { kind: 'pr' }, 'Q')).not.toHaveProperty('background');
  });

  it('ゴールデン: コース 3 の 1 か所目 domain.Order: なぜ promo を消して discount にしたの？', async () => {
    const withAll = withPr({ body: fixtureText('pr-body.md'), ticket: jiraTicket }, { background });
    const json = JSON.stringify(buildAskInput(withAll, { kind: 'symbol', symbolId: ORDER, courseId: 3 }, 'なぜ promo を消して discount にしたの？'), null, 2) + '\n';
    await expect(json).toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/ask-input-why.json'));
  });
});

describe('選んだ行（selected。3.10 の決めごと 2）', () => {
  const PATH = 'src/main/kotlin/com/example/order/domain/Order.kt';
  const at = (side: 'head' | 'base', line: number) => ({ side, line });
  const selectedOf = (a: Analysis, start: { side: 'head' | 'base'; line: number }, end: { side: 'head' | 'base'; line: number }) => {
    const { place } = buildAskInput(a, { kind: 'symbol', symbolId: ORDER, courseId: 3, lines: { path: PATH, start, end } }, 'Q');
    if (place.kind !== 'code') throw new Error(place.kind);
    return place.selected;
  };

  it('足した 8〜11 行目: 画面の並びのまま、両端を含めて切り出す', () => {
    expect(selectedOf(analysis, at('head', 8), at('head', 11))).toEqual({
      path: PATH,
      from: 'h8',
      to: 'h11',
      lines: ['h8 +     fun applyDiscount(cmd: DiscountCommand) {', 'h9 +         val rate = DiscountPolicy.rateFor(cmd.code)', 'h10 +         discount = subtotal * rate', 'h11 +     }'],
    });
  });

  it('消した行から足した行へまたぐ範囲（base 6 行目〜head 6 行目）', () => {
    expect(selectedOf(analysis, at('base', 6), at('head', 6))!.lines).toEqual(['b6 -     val promo: Promo? = null,', 'h6 +     var discount: Money = Money.ZERO,']);
    expect(selectedOf(analysis, at('base', 8), at('head', 9))!.lines).toEqual([
      'b8 -     fun getDiscount(): Money = promo?.amount ?: Money.ZERO',
      'h8 +     fun applyDiscount(cmd: DiscountCommand) {',
      'h9 +         val rate = DiscountPolicy.rateFor(cmd.code)',
    ]);
  });

  it('差分の外の変わらない行は全文から（1 行なら from と to が同じ）', () => {
    expect(selectedOf(analysis, at('head', 1), at('head', 2))!.lines).toEqual(['h1   package com.example.order.domain', 'h2   ']);
    expect(selectedOf(analysis, at('head', 14), at('head', 14))).toMatchObject({ from: 'h14', to: 'h14', lines: ['h14   }'] });
  });

  it('全文の無い古い解析: 差分の行だけから。差分の外の行は見つからないので空', () => {
    const old = fixtureAnalysis({ files: false });
    expect(selectedOf(old, at('head', 8), at('head', 11))!.lines).toHaveLength(4);
    expect(selectedOf(old, at('head', 1), at('head', 2))).toEqual({ path: PATH, from: 'h1', to: 'h2', lines: [] });
  });

  it('差分 1 つ・ファイルでも付く。行を選んでいなければ selected の欄が無い', () => {
    const lines = { path: PATH, start: at('head', 13), end: at('head', 13) };
    const hunk = buildAskInput(analysis, { kind: 'hunk', hunkId: ORDER, lines }, 'Q').place;
    const file = buildAskInput(analysis, { kind: 'file', path: PATH, lines }, 'Q').place;
    expect(hunk.kind === 'code' && hunk.selected?.lines).toEqual(['h13 +     fun total(): Money = subtotal - discount']);
    expect(file.kind === 'code' && file.selected?.lines).toEqual(['h13 +     fun total(): Money = subtotal - discount']);
    const none = buildAskInput(analysis, { kind: 'symbol', symbolId: ORDER, courseId: 3 }, 'Q').place;
    expect(none.kind === 'code' && 'selected' in none).toBe(false);
  });
});

describe('buildAskInput（fixture のゴールデン）', () => {
  const golden = (name: string) => path.join(FIXTURE_ROOT, `expected/ask-input-${name}.json`);
  const json = (x: unknown) => JSON.stringify(x, null, 2) + '\n';

  it('PR 全体: 割引コードを付けないとき、合計は前と変わる？', async () => {
    await expect(json(buildAskInput(analysis, { kind: 'pr' }, '割引コードを付けないとき、合計は前と変わる？'))).toMatchFileSnapshot(golden('pr'));
  });

  it('コース 3 の 1 か所目 domain.Order: promo はどこへ行った？', async () => {
    await expect(json(buildAskInput(analysis, { kind: 'symbol', symbolId: ORDER, courseId: 3 }, 'promo はどこへ行った？'))).toMatchFileSnapshot(golden('symbol'));
  });

  it('差分一覧の PromoService.apply: legacyPromo はいつ使われる？', async () => {
    const apply = hunkOf('promo/PromoService.kt', 'apply()');
    await expect(json(buildAskInput(analysis, { kind: 'hunk', hunkId: apply.id }, 'legacyPromo はいつ使われる？'))).toMatchFileSnapshot(golden('hunk'));
  });

  it('コース 3 の 1 か所目 domain.Order の 8〜11 行目を選んで: applyDiscount を 2 回呼ぶとどうなる？', async () => {
    const lines = { path: 'src/main/kotlin/com/example/order/domain/Order.kt', start: { side: 'head' as const, line: 8 }, end: { side: 'head' as const, line: 11 } };
    await expect(json(buildAskInput(analysis, { kind: 'symbol', symbolId: ORDER, courseId: 3, lines }, 'applyDiscount を 2 回呼ぶとどうなる？'))).toMatchFileSnapshot(golden('lines'));
  });

  // コードの外の問い（2026-10-15。材料だけでは答えられず、ネットで調べる問い）
  it('コース 5 の 2 か所目 ApplyDiscountUseCase.execute: ?: って何？', async () => {
    await expect(json(buildAskInput(analysis, { kind: 'symbol', symbolId: EXECUTE, courseId: 5 }, '?: って何？'))).toMatchFileSnapshot(golden('web'));
  });
});
