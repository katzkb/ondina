// 見つけたチケットの場所の名前と、行の引用（設計書 3.1。2026-10-12）。長い行は拾った文字列の前後だけを残す
import { describe, expect, it } from 'vitest';
import { placeName, quoteOf, QUOTE_AFTER, QUOTE_BEFORE } from '../src/ticketPlace.js';

describe('placeName', () => {
  it('題 / ブランチ名 / 本文 N 行目', () => {
    expect(placeName({ in: 'title', text: '', start: 0, end: 0 })).toBe('題');
    expect(placeName({ in: 'branch', text: '', start: 0, end: 0 })).toBe('ブランチ名');
    expect(placeName({ in: 'body', line: 3, text: '', start: 0, end: 0 })).toBe('本文 3 行目');
  });
});

describe('quoteOf', () => {
  it('拾った文字列とその前後に分ける', () => {
    expect(quoteOf({ in: 'body', line: 2, text: '関連: SHOP-399（前回）', start: 4, end: 12 })).toEqual({ before: '関連: ', hit: 'SHOP-399', after: '（前回）' });
  });

  it(`長い行は前 ${QUOTE_BEFORE} 文字・後ろ ${QUOTE_AFTER} 文字だけ残し、切ったところに … を付ける`, () => {
    const text = `${'a'.repeat(100)}SHOP-421${'b'.repeat(100)}`;
    expect(quoteOf({ in: 'body', line: 1, text, start: 100, end: 108 })).toEqual({ before: `…${'a'.repeat(QUOTE_BEFORE)}`, hit: 'SHOP-421', after: `${'b'.repeat(QUOTE_AFTER)}…` });
  });
});
