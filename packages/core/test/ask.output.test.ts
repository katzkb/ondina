// 案内人に聞く（設計書 10.5）のプロンプト・出力の読み取り・検証。LLM は起動しない。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAskInput } from '../src/ask/input.js';
import { renderAskPrompt } from '../src/ask/prompt.js';
import { parseAskOutput } from '../src/ask/schema.js';
import { verifyAskAnswer } from '../src/ask/verify.js';
import type { AskInput, AskOutput } from '../src/ask/types.js';
import { FIXTURE_ROOT } from './fixture.js';
import { fixtureAnalysis } from './fixture-analysis.js';

const ORDER = '98dcd7c9d8d6e0ed59854b2fff454f5bf805bae7';
const ORDER_KT = 'src/main/kotlin/com/example/order/domain/Order.kt';
const PROMO_KT = 'src/main/kotlin/com/example/promo/PromoService.kt';
const input: AskInput = buildAskInput(fixtureAnalysis(), { kind: 'symbol', symbolId: ORDER, courseId: 3 }, 'promo はどこへ行った？');

describe('renderAskPrompt', () => {
  const p = renderAskPrompt(input);

  it('判断を書かない・リポジトリのファイルを読まない・JSON 1 個だけ', () => {
    for (const s of ['評価語', 'リポジトリのファイルを読まない', 'コマンドを実行しない', 'JSON オブジェクト 1 つだけ', '材料からは分からない', 'Markdown', '常体', '文の中に h12 や b6 の番号を書かない', 'field → フィールド', '直訳しない', 'サンプル']) expect(p, s).toContain(s);
  });

  it('コードの外のことにも答え、材料に無いことはネットで調べる（2026-10-15。材料だけに縛ると「これって何？」に答えなかった）', () => {
    for (const s of ['コードの外', 'ネット', '"web"', '"url"', '"title"', '"known"']) expect(p, s).toContain(s);
    // codex は知っていることを調べずに答えた（2026-10-15 の記録 llm/ask-web.json の 1 回目）。知っていても調べてページを付ける
    expect(p).toContain('知っていることでも');
    expect(p).not.toContain('ツールを使わない');
    expect(p).not.toContain('材料の事実だけで答えます');
  });

  it('行の番号の読み方と、行の場所の書き方', () => {
    for (const s of ['h12', 'b6', 'cite', '"side"', 'head', 'base']) expect(p, s).toContain(s);
  });

  it('選んだ行（place.selected）の読み方: 質問はこの行について', () => {
    expect(p).toContain('place.selected');
  });

  it('出力の形と入力を埋める。決定的', () => {
    expect(p).toContain('"lead"');
    expect(p).toContain('promo はどこへ行った？');
    expect(renderAskPrompt(input)).toBe(p);
  });
});

describe('parseAskOutput', () => {
  it('前後の文とコードフェンスを剥がして読む', () => {
    const r = parseAskOutput('答えます\n```json\n{"lead":"消えた。","items":[{"text":"a","cite":{"path":"p","side":"head","line":3}}],"tail":"t"}\n```');
    expect(r).toEqual({ output: { lead: '消えた。', items: [{ text: 'a', cite: { path: 'p', side: 'head', line: 3 } }], tail: 't' } });
  });

  it('lead が無い・空なら失敗', () => {
    expect(parseAskOutput('{"items":[]}')).toEqual({ error: 'lead がありません' });
    expect(parseAskOutput('{"lead":"  "}')).toEqual({ error: 'lead がありません' });
    expect(parseAskOutput('なし')).toEqual({ error: 'stdout に JSON オブジェクトがありません' });
  });

  it('ネットで調べた事実（web）と、元から知っている事実（known）を読む', () => {
    const r = parseAskOutput('{"lead":"x","items":[{"text":"a","web":{"url":"https://kotlinlang.org/docs/null-safety.html","title":"Null safety"}},{"text":"b","known":true},{"text":"c","web":{"url":3},"known":"yes"}]}');
    expect(r).toEqual({
      output: {
        lead: 'x',
        items: [{ text: 'a', web: { url: 'https://kotlinlang.org/docs/null-safety.html', title: 'Null safety' } }, { text: 'b', known: true }, { text: 'c', web: { url: '', title: '' } }],
      },
    });
  });

  it('items が無ければ空。文の無い項目は捨てる。cite の line が null でも読む（検証で外す）', () => {
    const r = parseAskOutput('{"lead":"x","items":[{"text":""},{"text":"b","cite":{"path":"p","side":"base","line":null}},"c"]}');
    expect(r).toEqual({ output: { lead: 'x', items: [{ text: 'b', cite: { path: 'p', side: 'base', line: null } }] } });
    expect(parseAskOutput('{"lead":"x"}')).toEqual({ output: { lead: 'x', items: [] } });
  });
});

describe('verifyAskAnswer', () => {
  const out = (items: AskOutput['items'], extra: Partial<AskOutput> = {}): AskOutput => ({ lead: 'L', items, ...extra });

  it('材料にある行の場所は採る（全文の head の行・差分の base の行・周りの場所の行）', () => {
    const r = verifyAskAnswer(
      out([
        { text: 'a', cite: { path: ORDER_KT, side: 'head', line: 13 } },
        { text: 'b', cite: { path: ORDER_KT, side: 'base', line: 6 } },
        { text: 'c', cite: { path: PROMO_KT, side: 'head', line: 10 } },
      ]),
      input,
    );
    expect(r.items).toEqual([
      { text: 'a', cite: { path: ORDER_KT, side: 'head', line: 13 } },
      { text: 'b', cite: { path: ORDER_KT, side: 'base', line: 6 } },
      { text: 'c', cite: { path: PROMO_KT, side: 'head', line: 10 } },
    ]);
  });

  it('選んだ行（selected）も材料に数える（全文の無い古い解析の形でも）', () => {
    const lines = { path: ORDER_KT, start: { side: 'head' as const, line: 1 }, end: { side: 'head' as const, line: 1 } };
    const withLines = buildAskInput(fixtureAnalysis({ files: false }), { kind: 'symbol', symbolId: ORDER, courseId: 3, lines }, 'Q');
    if (withLines.place.kind !== 'code') throw new Error(withLines.place.kind);
    const cite = { path: ORDER_KT, side: 'head', line: 1 };
    expect(verifyAskAnswer(out([{ text: 'a', cite }]), withLines).items[0]).toEqual({ text: 'a', unverified: true });
    const picked: AskInput = { ...withLines, place: { ...withLines.place, selected: { path: ORDER_KT, from: 'h1', to: 'h1', lines: ['h1   package com.example.order.domain'] } } };
    expect(verifyAskAnswer(out([{ text: 'a', cite }]), picked).items[0]).toEqual({ text: 'a', cite });
  });

  it('材料に無い行・パス・side、line が null なら場所を外して印を付ける', () => {
    const r = verifyAskAnswer(
      out([
        { text: 'a', cite: { path: ORDER_KT, side: 'base', line: 13 } },
        { text: 'b', cite: { path: 'x/Nope.kt', side: 'head', line: 1 } },
        { text: 'c', cite: { path: ORDER_KT, side: 'left', line: 6 } },
        { text: 'd', cite: { path: ORDER_KT, side: 'head', line: null } },
        { text: 'e' },
      ]),
      input,
    );
    expect(r.items).toEqual([
      { text: 'a', unverified: true },
      { text: 'b', unverified: true },
      { text: 'c', unverified: true },
      { text: 'd', unverified: true },
      { text: 'e' },
    ]);
  });

  it('範囲は両端が材料にあれば採る。終わりが始まり以下なら 1 行にする', () => {
    const r = verifyAskAnswer(
      out([
        { text: 'a', cite: { path: ORDER_KT, side: 'head', line: 8, endLine: 11 } },
        { text: 'b', cite: { path: ORDER_KT, side: 'head', line: 8, endLine: 8 } },
        { text: 'c', cite: { path: ORDER_KT, side: 'head', line: 8, endLine: 400 } },
      ]),
      input,
    );
    expect(r.items).toEqual([
      { text: 'a', cite: { path: ORDER_KT, side: 'head', line: 8, endLine: 11 } },
      { text: 'b', cite: { path: ORDER_KT, side: 'head', line: 8 } },
      { text: 'c', unverified: true },
    ]);
  });

  it('文の中に漏れた材料の番号（h10 / b6）は「10 行目」「base 側 6 行目」に直す。識別子の一部は触らない', () => {
    const r = verifyAskAnswer(out([{ text: 'h10 の takeIf と b6 を見る' }], { lead: 'sha1 と h2o はそのまま。', tail: '作者に聞くなら h10 を指す。' }), input);
    expect(r).toEqual({ lead: 'sha1 と h2o はそのまま。', items: [{ text: '10 行目の takeIf と base 側 6 行目を見る' }], tail: '作者に聞くなら 10 行目を指す。' });
  });

  it('ネットのページは http / https の URL だけ採る。題のバッククォートを剥がす（番号の置き換えはしない）', () => {
    const url = 'https://kotlinlang.org/docs/null-safety.html#elvis-operator';
    const r = verifyAskAnswer(out([{ text: 'a', web: { url, title: '`Null safety` h2' } }, { text: 'b', web: { url: 'http://example.com/x', title: '' } }]), input);
    expect(r.items).toEqual([
      { text: 'a', web: { url, title: 'Null safety h2' } },
      { text: 'b', web: { url: 'http://example.com/x', title: '' } },
    ]);
  });

  it('URL として読めない・http / https 以外のページは外し、出典なし（known）にする', () => {
    const r = verifyAskAnswer(
      out([
        { text: 'a', web: { url: 'javascript:alert(1)', title: 't' } },
        { text: 'b', web: { url: 'kotlinlang.org/docs', title: 't' } },
        { text: 'c', web: { url: '', title: '' } },
      ]),
      input,
    );
    expect(r.items).toEqual([
      { text: 'a', known: true },
      { text: 'b', known: true },
      { text: 'c', known: true },
    ]);
  });

  it('known は、行の場所もページも無い事実にだけ付ける', () => {
    const cite = { path: ORDER_KT, side: 'head', line: 13 };
    const r = verifyAskAnswer(
      out([
        { text: 'a', known: true },
        { text: 'b', cite, known: true },
        { text: 'c', web: { url: 'https://example.com/', title: 't' }, known: true },
        { text: 'd', cite: { ...cite, line: 999 }, known: true },
      ]),
      input,
    );
    expect(r.items).toEqual([
      { text: 'a', known: true },
      { text: 'b', cite },
      { text: 'c', web: { url: 'https://example.com/', title: 't' } },
      { text: 'd', unverified: true },
    ]);
  });

  it('バッククォートを剥がす。空の tail は無いものに', () => {
    const r = verifyAskAnswer(out([{ text: '`discount` を持つ' }], { lead: '`promo` は消えた。', tail: ' ' }), input);
    expect(r).toEqual({ lead: 'promo は消えた。', items: [{ text: 'discount を持つ' }] });
  });
});

describe('記録した答え（fixtures/order-service/llm/ask-*.json。record-llm-ask.mjs）', () => {
  const read = (rel: string) => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8')) as unknown;
  for (const name of ['pr', 'symbol', 'hunk', 'lines']) {
    it(`${name}: 読めて、行の場所は全部材料にある`, () => {
      const rec = read(`llm/ask-${name}.json`) as { stdout: string };
      const parsed = parseAskOutput(rec.stdout);
      if ('error' in parsed) throw new Error(parsed.error);
      const answer = verifyAskAnswer(parsed.output, read(`expected/ask-input-${name}.json`) as AskInput);
      // 行の場所を付けない事実もある（「22 件の中で形が違う」など）。付けた場所は全部材料にある
      expect(answer.items.filter((i) => i.cite !== undefined).length).toBeGreaterThanOrEqual(2);
      expect(answer.items.every((i) => i.unverified === undefined)).toBe(true);
      expect(JSON.stringify(answer)).not.toContain('`');
      expect(JSON.stringify(answer)).not.toMatch(/(?<![A-Za-z0-9_])[hb]\d+(?![A-Za-z0-9_])/);
    });
  }

  it('symbol: promo を消した行は base 側の Order.kt 6 行目', () => {
    const rec = read('llm/ask-symbol.json') as { stdout: string };
    const parsed = parseAskOutput(rec.stdout);
    if ('error' in parsed) throw new Error(parsed.error);
    const answer = verifyAskAnswer(parsed.output, read('expected/ask-input-symbol.json') as AskInput);
    expect(answer.items.map((i) => i.cite)).toContainEqual({ path: ORDER_KT, side: 'base', line: 6 });
  });

  it('web（codex で記録。ネットを調べられる）: ?: の仕組みはネットのページ、16 行目の振る舞いは行の場所', () => {
    const rec = read('llm/ask-web.json') as { stdout: string; stderr: string; command: string };
    expect(rec.command).toMatch(/^codex /);
    // 本当に調べた跡（記録には codex の stderr のうち web search の行だけ残す）
    expect(rec.stderr).toContain('web search: https://kotlinlang.org/');
    const parsed = parseAskOutput(rec.stdout);
    if ('error' in parsed) throw new Error(parsed.error);
    const answer = verifyAskAnswer(parsed.output, read('expected/ask-input-web.json') as AskInput);
    expect(answer.items.some((i) => i.web !== undefined && new URL(i.web.url).hostname === 'kotlinlang.org')).toBe(true);
    expect(answer.items.map((i) => i.cite)).toContainEqual({ path: 'src/main/kotlin/com/example/order/application/ApplyDiscountUseCase.kt', side: 'head', line: 16 });
    expect(answer.items.every((i) => i.unverified === undefined)).toBe(true);
  });

  it('lines: 選んだ 8〜11 行目の中の行を指す', () => {
    const rec = read('llm/ask-lines.json') as { stdout: string };
    const parsed = parseAskOutput(rec.stdout);
    if ('error' in parsed) throw new Error(parsed.error);
    const answer = verifyAskAnswer(parsed.output, read('expected/ask-input-lines.json') as AskInput);
    expect(answer.items.some((i) => i.cite?.path === ORDER_KT && i.cite.side === 'head' && i.cite.line >= 8 && i.cite.line <= 11)).toBe(true);
  });
});
