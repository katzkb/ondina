// 2 回目の LLM（文を書く）のプロンプト本文（設計書 10.3）。指示・出力の形・入力 JSON を全部 stdin の本文に入れる。
import { describe, expect, it } from 'vitest';
import { renderNarrationPrompt } from '../src/narration/prompt.js';
import { NARRATION_OUTPUT_SCHEMA } from '../src/narration/schema.js';
import type { NarrationInput } from '../src/narration/types.js';

const input: NarrationInput = {
  pr: { title: 'T' },
  hunks: [{ id: 'h1', path: 'a/B.kt', symbol: 'f()', lines: ['-x', '+y'] }],
  rippleGroups: [],
  courses: [{ howId: 1, title: 'A', why: 'W', stops: [{ symbolId: 'h1', symbol: 'a.B.f', path: 'a/B.kt', changed: true, test: false, hunkId: 'h1' }] }],
  unassigned: [],
  existing: [{ symbol: 'a.C.g', path: 'a/C.kt', kind: 'function', removed: false }],
};

describe('renderNarrationPrompt', () => {
  it('入力 JSON と出力の形（JSON Schema）を本文に含む', () => {
    const p = renderNarrationPrompt(input);
    expect(p).toContain(JSON.stringify(input, null, 2));
    expect(p).toContain(JSON.stringify(NARRATION_OUTPUT_SCHEMA, null, 2));
  });

  it('判断を書かない・ファイルを読まない・JSON だけ返す指示と、文の形（短文・句点・チップの事実を繰り返さない・振る舞いの言葉）を含む', () => {
    const p = renderNarrationPrompt(input);
    for (const s of ['評価', '観測', 'ファイルを読', 'ツールを使', 'JSON オブジェクト 1 つだけ', '短文', '句点', 'チップ', '繰り返さない', '振る舞い']) expect(p, s).toContain(s);
  });

  it('入口の説明（要点・例・流れの図）とコースの文（変わること・確かめることと根拠の場所・この場所）の書き方を含む', () => {
    const p = renderNarrationPrompt(input);
    for (const s of ['headline', 'example.at', 'flows[].nodes', 'nodes[].pass', 'change', 'checks', 'checks[].at', 'role', 'unassigned', 'related', 'groupId']) expect(p, s).toContain(s);
    for (const s of ['intro:', 'guide:', 'say: 実物', 'problem', 'approach', 'beforeAfter']) expect(p, s).not.toContain(s);
  });

  // 2026-10-22: 読む前の案内。確かめることは観測の 1 文で、根拠の行は入力の行の頭の番号から選ぶ（プログラムが実在を確かめる）
  it('確かめることは 2〜5 個の観測の 1 文。根拠は stops[] の symbolId と行の頭の番号（削除の行は選べない）', () => {
    const p = renderNarrationPrompt(input);
    const rule = (k: string) => p.split('\n').find((l) => l.startsWith(`- ${k}:`)) ?? '';
    expect(rule('checks')).toContain('2〜5 個');
    expect(rule('checks')).toContain('観測だけ');
    expect(rule('checks[].at')).toContain('「|」の前の数字');
    expect(rule('checks[].at')).toContain('削除の行は選べない');
    expect(p).toContain('行番号は head（マージ後）の行番号');
  });

  // 2026-10-29: 入口の説明は要点・例・流れの図（見本を比べて新案にした）。図の箱はコースから組み、札は領域の名前だけ
  it('要点は PR が何をするかの 1 文。例はテストの値。箱は全部のコースを 1 回ずつ入れ、札は領域の名前だけでどのコースにも入らなかった変更は入れない', () => {
    const p = renderNarrationPrompt(input);
    const rule = (k: string) => p.split('\n').find((l) => l.startsWith(`- ${k}:`)) ?? '';
    expect(rule('headline')).toContain('1 文');
    expect(rule('headline')).toContain('変更の前の様子から書き始めない');
    expect(rule('example')).toContain('test: true');
    expect(rule('flows[].nodes')).toContain('全部のコース');
    expect(rule('flows[].nodes')).toContain('1 つの箱にだけ');
    expect(rule('nodes[].untouched')).toContain('領域の名前だけ');
    expect(rule('nodes[].untouched')).toContain('unassigned）は入れない');
    expect(NARRATION_OUTPUT_SCHEMA.properties.summary.required).toEqual(['headline', 'example', 'flows']);
  });

  // 2026-10-29: 説明タブの背景。前からあるものは入力の existing[] から選び、言葉は差分の行に出る識別子（どちらもプログラムが確かめる）
  it('背景: 前からあるものは existing[] の symbol から 1〜3 行で、削除・変更なしは書かない（チップ）。言葉は差分の行に出る識別子で 2〜4 個', () => {
    const p = renderNarrationPrompt(input);
    const rule = (k: string) => p.split('\n').find((l) => l.startsWith(`- ${k}:`)) ?? '';
    expect(rule('background.existing')).toContain('existing[] から');
    expect(rule('background.existing')).toContain('1〜3 行');
    expect(rule('existing[].symbols')).toContain('existing[].symbol をそのまま');
    expect(rule('existing[].symbols')).toContain('removed が同じものだけ');
    expect(rule('existing[].text')).toContain('チップ');
    expect(rule('background.terms')).toContain('2〜4 個');
    expect(rule('terms[].code')).toContain('差分の行に出てくる識別子をそのまま 1 つ');
    expect(p).toContain('existing[] は前からあるものの候補');
    expect(NARRATION_OUTPUT_SCHEMA.required).toEqual(['summary', 'background', 'courses', 'behaviors']);
  });

  it('動き: 題だけを書かせ、並びは見せる順。呼ぶ順はプログラムが決めたもの', () => {
    const p = renderNarrationPrompt(input);
    const rule = (k: string) => p.split('\n').find((l) => l.startsWith(`- ${k}:`)) ?? '';
    expect(rule('title')).toContain('「〜する」で終える');
    expect(p).toContain('並びは画面に見せる順');
    expect(p).toContain('順はプログラムが決めたもの');
  });

  it('例文は fixture（注文と割引の PR）の題材を使わない（記録を手書きの文に寄せて見せかけない）', () => {
    const instructions = renderNarrationPrompt(input).split('入力:\n')[0]!;
    for (const s of ['Order', 'Discount', 'Promo', '割引', '注文']) expect(instructions, s).not.toContain(s);
  });

  it('この場所の例文は呼ばれ方を書かない（画面が辺から出す）。「〜が呼ぶ先」と書かない。束はサンプル。用語は直訳しない', () => {
    const instructions = renderNarrationPrompt(input).split('入力:\n')[0]!;
    const role = instructions.split('\n').find((l) => l.startsWith('- role:'))!;
    expect(role).toContain('「同じ書き換え 12 か所のサンプル。」');
    expect(role).not.toContain('呼ばれる');
    expect(instructions).toContain('field → フィールド');
    expect(instructions).toContain('直訳しない');
    expect(instructions).not.toContain('呼ぶ先');
  });

  it('同じ入力には同じ本文（決定的）', () => {
    expect(renderNarrationPrompt(input)).toBe(renderNarrationPrompt(structuredClone(input)));
  });
});
