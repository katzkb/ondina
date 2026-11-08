// 要求の抜き出し（設計書 10.8）の stdout から出力 JSON を取り出して型を検査する。中身の検証（不明な差分の ID など）は verify.ts。
import { describe, expect, it } from 'vitest';
import { parseSpecOutput } from '../src/spec/schema.js';

const good = { specs: [{ text: '割引コードを適用できる', hunkIds: ['h3', 'h5'] }, { text: '期限切れのコードは 400 を返す', hunkIds: [] }], why: ['今は注文に割引を付ける手段が無い。'], parentWhy: ['4 月の 1 か月、割引コードを配る。'] };

describe('parseSpecOutput', () => {
  it('10.8 の形をそのまま読む。フェンスや前後の文は剥がす', () => {
    expect(parseSpecOutput(JSON.stringify(good))).toEqual({ output: good });
    expect(parseSpecOutput('はい。\n```json\n' + JSON.stringify(good) + '\n```')).toEqual({ output: good });
  });

  it('hunkIds・why・parentWhy が無ければ空として読む', () => {
    expect(parseSpecOutput('{"specs":[{"text":"a"}]}')).toEqual({ output: { specs: [{ text: 'a', hunkIds: [] }], why: [], parentWhy: [] } });
  });

  it('JSON が無い・specs が配列でない・文が文字列でない・hunkIds が文字列の配列でないときは場所を言って失敗する', () => {
    expect(parseSpecOutput('ごめんなさい')).toEqual({ error: 'stdout に JSON オブジェクトがありません' });
    expect(parseSpecOutput('{}')).toEqual({ error: 'specs が配列ではありません' });
    expect(parseSpecOutput('{"specs":[],"why":"a"}')).toEqual({ error: 'why が文字列の配列ではありません' });
    expect(parseSpecOutput('{"specs":[],"parentWhy":[1]}')).toEqual({ error: 'parentWhy が文字列の配列ではありません' });
    expect(parseSpecOutput('{"specs":[1]}')).toEqual({ error: 'specs[0] がオブジェクトではありません' });
    expect(parseSpecOutput('{"specs":[{"text":1}]}')).toEqual({ error: 'specs[0].text が文字列ではありません' });
    expect(parseSpecOutput('{"specs":[{"text":"a","hunkIds":"3"}]}')).toEqual({ error: 'specs[0].hunkIds が文字列の配列ではありません' });
    expect(parseSpecOutput('{"specs":[{"text":"a","hunkIds":[1.5]}]}')).toEqual({ error: 'specs[0].hunkIds が文字列の配列ではありません' });
  });
});
