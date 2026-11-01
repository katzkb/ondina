// 要求の抜き出し（設計書 10.8）に stdin で渡すプロンプト本文。決定的で、指示・出力の形・入力 JSON を全部含む。
import { describe, expect, it } from 'vitest';
import { renderSpecPrompt } from '../src/spec/prompt.js';
import { SPEC_OUTPUT_SCHEMA } from '../src/spec/schema.js';
import type { SpecInput } from '../src/spec/types.js';

const input: SpecInput = {
  ticket: { key: 'SHOP-421', title: '割引', body: '- 割引できる' },
  hows: [{ id: 1, title: 'A', why: 'W', hunkIds: ['h1'], groupIds: [] }],
  hunks: [{ id: 'h1', path: 'a/Order.kt', symbol: 'Order', lines: ['+x'] }],
  rippleGroups: [],
  previous: { specs: [{ text: '割引できる', hows: [1] }] },
};

describe('renderSpecPrompt', () => {
  it('入力 JSON と出力の形を本文に含み、同じ入力には同じ本文（原則 7）', () => {
    const p = renderSpecPrompt(input);
    expect(p).toContain(`入力:\n${JSON.stringify(input, null, 2)}`);
    expect(p).toContain(JSON.stringify(SPEC_OUTPUT_SCHEMA, null, 2));
    expect(renderSpecPrompt(input)).toBe(p);
  });

  it('抜き出すのはチケットに書かれた「この PR で成り立つべきこと」だけで、最大 10 個、句点なしの 1 文', () => {
    const p = renderSpecPrompt(input);
    for (const s of ['この PR で成り立つべきこと', 'チケットに書かれていないことを足さない', '10 個まで', '句点を付けない']) expect(p, s).toContain(s);
  });

  it('hows は入力の How から選び、差分が振る舞いを足す・変えるときだけ入れる。満たしているかは書かない', () => {
    const p = renderSpecPrompt(input);
    for (const s of ['hows[].id', '同じ領域なだけ', '空の配列', '満たしているか', '評価語']) expect(p, s).toContain(s);
  });

  it('previous があれば同じ要求は同じ文にし、ツールを使わず JSON 1 つだけ返すよう指示する', () => {
    const p = renderSpecPrompt(input);
    for (const s of ['previous', '同じ文', 'ツールを使わない', 'JSON オブジェクト 1 つだけ']) expect(p, s).toContain(s);
  });

  it('親チケットがあれば、その本文から案件の目的の文を原文のまま写す（parentWhy。2026-10-29）', () => {
    const p = renderSpecPrompt({ ...input, parent: { key: 'SHOP-400', title: '春', body: '目的' } });
    for (const s of ['parentWhy', 'parent の body', '原文のまま写す', 'parent がない']) expect(p, s).toContain(s);
  });

  it('例文は fixture と別の題材（在庫の引き当て）', () => {
    const p = renderSpecPrompt(input);
    expect(p).toContain('在庫');
    expect(p.slice(0, p.indexOf('出力の形'))).not.toMatch(/割引|注文/);
  });
});
