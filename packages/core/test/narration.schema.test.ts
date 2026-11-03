// 2 回目の LLM（文を書く）の stdout から出力 JSON を取り出して型を検査する（設計書 5.4 / 10.2）。
import { describe, expect, it } from 'vitest';
import { parseNarrationOutput } from '../src/narration/schema.js';

const good = {
  summary: {
    headline: '注文に割引コードを使えるようにする。',
    example: { text: '小計 1,000 円に SPRING10 を使うと、合計が 900 円になる。', at: [{ symbolId: 't1', lines: [15, 17] }] },
    flows: [{ nodes: [{ title: '計算', howIds: [3], symbolId: 's1', before: '合計は小計のまま。', after: '割引額を引く。', untouched: ['割引率の表'], pass: '割引額 100' }] }],
  },
  background: {
    existing: [{ symbols: ['com.example.DiscountPolicy.rateFor'], text: 'コードから割引率を引く。' }],
    terms: [{ word: '小計', code: 'subtotal', meaning: '割引の前の、品物の額の合計。' }],
  },
  courses: [
    {
      howId: 3,
      change: { before: '合計は小計のまま。', after: '合計から割引額を引く。' },
      checks: [{ text: '合計から割引額を引く', at: [{ symbolId: 's1', lines: [15, 16], say: '引くのはここ。' }] }],
      stops: [{ symbolId: 's1', role: '注文。割引額を持つ。' }],
    },
  ],
  behaviors: [{ id: 'b1', title: '割引コードで割り引く' }],
};

describe('parseNarrationOutput', () => {
  it('10.2 の形をそのまま読む。フェンスや前後の文は剥がす', () => {
    expect(parseNarrationOutput(JSON.stringify(good))).toEqual({ output: good });
    expect(parseNarrationOutput('はい。\n```json\n' + JSON.stringify(good) + '\n```')).toEqual({ output: good });
  });

  it('箱の untouched が文字列で来たら 1 要素の配列、howIds が数 1 つなら 1 要素の配列にする', () => {
    const node = { title: 't', howIds: 3, untouched: 'u' };
    const r = parseNarrationOutput(JSON.stringify({ summary: { flows: [{ nodes: [node] }] } }));
    expect('output' in r && r.output.summary.flows[0]!.nodes[0]).toEqual({ title: 't', howIds: [3], symbolId: '', before: '', after: '', untouched: ['u'], pass: '' });
  });

  it('動きの題: 題が欠けたら空、id が文字列でなければ失敗', () => {
    expect(parseNarrationOutput('{"behaviors":[{"id":"b1"}]}')).toMatchObject({ output: { behaviors: [{ id: 'b1', title: '' }] } });
    expect(parseNarrationOutput('{"behaviors":[{"id":1}]}')).toEqual({ error: 'behaviors[0].id が文字列ではありません' });
  });

  it('欠けた summary / courses / 文は空で埋める', () => {
    expect(parseNarrationOutput('{}')).toEqual({ output: { summary: { headline: '', example: { text: '', at: [] }, flows: [] }, background: { existing: [], terms: [] }, courses: [], behaviors: [] } });
    const r = parseNarrationOutput('{"courses":[{"howId":1,"stops":[{"symbolId":"s"}]}]}');
    expect('output' in r && r.output.courses).toEqual([{ howId: 1, change: { before: '', after: '' }, checks: [], stops: [{ symbolId: 's', role: '' }] }]);
    const r2 = parseNarrationOutput('{"courses":[{"howId":1,"checks":[{"at":[{"symbolId":"s"}]},{"text":"t"}]}]}');
    expect('output' in r2 && r2.output.courses[0]!.checks).toEqual([
      { text: '', at: [{ symbolId: 's', lines: [], say: '' }] },
      { text: 't', at: [] },
    ]);
  });

  // 2026-10-29: 説明タブの背景（この PR の前からあるもの・出てくる言葉）
  it('背景の前からあるものの symbols が文字列で来たら 1 要素の配列にする。欠けた文は空で埋める', () => {
    const r = parseNarrationOutput('{"background":{"existing":[{"symbols":"a.B"}],"terms":[{"code":"x"}]}}');
    expect('output' in r && r.output.background).toEqual({ existing: [{ symbols: ['a.B'], text: '' }], terms: [{ word: '', code: 'x', meaning: '' }] });
  });

  it('背景の形が違えば場所を言って失敗する', () => {
    expect(parseNarrationOutput('{"background":[]}')).toEqual({ error: 'background がオブジェクトではありません' });
    expect(parseNarrationOutput('{"background":{"existing":{}}}')).toEqual({ error: 'background.existing が配列ではありません' });
    expect(parseNarrationOutput('{"background":{"existing":["a"]}}')).toEqual({ error: 'background.existing[0] がオブジェクトではありません' });
    expect(parseNarrationOutput('{"background":{"existing":[{"symbols":[1]}]}}')).toEqual({ error: 'background.existing[0].symbols が文字列の配列ではありません' });
    expect(parseNarrationOutput('{"background":{"terms":"x"}}')).toEqual({ error: 'background.terms が配列ではありません' });
    expect(parseNarrationOutput('{"background":{"terms":[1]}}')).toEqual({ error: 'background.terms[0] がオブジェクトではありません' });
  });

  it('根拠の行が数 1 つで来たら 1 要素の配列にする', () => {
    const r = parseNarrationOutput('{"courses":[{"howId":1,"checks":[{"text":"t","at":[{"symbolId":"s","lines":15}]}]}]}');
    expect('output' in r && r.output.courses[0]!.checks[0]!.at[0]!.lines).toEqual([15]);
  });

  it('JSON が無い・courses が配列でない・howId が整数でない・symbolId が文字列でないときは場所を言って失敗する', () => {
    expect(parseNarrationOutput('ごめんなさい')).toEqual({ error: 'stdout に JSON オブジェクトがありません' });
    expect(parseNarrationOutput('{"courses":{}}')).toEqual({ error: 'courses が配列ではありません' });
    expect(parseNarrationOutput('{"courses":[{"howId":"3"}]}')).toEqual({ error: 'courses[0].howId が整数ではありません' });
    expect(parseNarrationOutput('{"courses":[{"howId":3,"stops":[{"symbolId":1}]}]}')).toEqual({ error: 'courses[0].stops[0].symbolId が文字列ではありません' });
    expect(parseNarrationOutput('{"summary":{"example":"x"}}')).toEqual({ error: 'summary.example がオブジェクトではありません' });
    expect(parseNarrationOutput('{"summary":{"example":{"at":[{"symbolId":"t","lines":["1"]}]}}}')).toEqual({ error: 'summary.example.at[0].lines が整数の配列ではありません' });
    expect(parseNarrationOutput('{"summary":{"flows":{}}}')).toEqual({ error: 'summary.flows が配列ではありません' });
    expect(parseNarrationOutput('{"summary":{"flows":[{"nodes":[{"howIds":["3"]}]}]}}')).toEqual({ error: 'summary.flows[0].nodes[0].howIds が整数の配列ではありません' });
    expect(parseNarrationOutput('{"summary":{"flows":[{"nodes":[{"untouched":[1]}]}]}}')).toEqual({ error: 'summary.flows[0].nodes[0].untouched が文字列の配列ではありません' });
  });

  it('確かめることの形が違えば場所を言って失敗する', () => {
    expect(parseNarrationOutput('{"courses":[{"howId":3,"checks":{}}]}')).toEqual({ error: 'courses[0].checks が配列ではありません' });
    expect(parseNarrationOutput('{"courses":[{"howId":3,"checks":["t"]}]}')).toEqual({ error: 'courses[0].checks[0] がオブジェクトではありません' });
    expect(parseNarrationOutput('{"courses":[{"howId":3,"checks":[{"at":{}}]}]}')).toEqual({ error: 'courses[0].checks[0].at が配列ではありません' });
    expect(parseNarrationOutput('{"courses":[{"howId":3,"checks":[{"at":[{"symbolId":2}]}]}]}')).toEqual({ error: 'courses[0].checks[0].at[0].symbolId が文字列ではありません' });
    expect(parseNarrationOutput('{"courses":[{"howId":3,"checks":[{"at":[{"symbolId":"s","lines":["15"]}]}]}]}')).toEqual({ error: 'courses[0].checks[0].at[0].lines が整数の配列ではありません' });
    expect(parseNarrationOutput('{"courses":[{"howId":3,"change":"x"}]}')).toEqual({ error: 'courses[0].change がオブジェクトではありません' });
  });
});
