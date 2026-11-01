// LLM コマンドの stdout から出力 JSON を取り出して型を検査する（設計書 10.2 / 5.4）。
// コマンドは Claude とは限らず、前後に文やコードフェンスが付くことがあるので、ondina 側で剥がして検査する。
import { describe, expect, it } from 'vitest';
import { extractJson, parseLlmOutput } from '../src/label/schema.js';

const good = {
  hows: [{ id: 1, title: 'ドメインに割引を追加', why: '割引を Order が持つ', hunkIds: ['a'], groupIds: ['g1'] }],
  claims: [{ text: 'キャッシュ層を横断的に更新し', backed: false, reason: '該当する変更が無い' }],
  layerGuesses: [{ path: 'src/main/kotlin/com/example/common/Logger.kt', layer: 'Infrastructure' }],
};

describe('extractJson', () => {
  it('素の JSON はそのまま返す', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it('コードフェンスと前後の文を剥がして最初の JSON オブジェクトを返す', () => {
    expect(extractJson('結果です。\n```json\n{"a": {"b": 1}}\n```\n以上。')).toBe('{"a": {"b": 1}}');
  });
  it('文字列の中の括弧に惑わされない', () => {
    expect(extractJson('x {"a":"}","b":"\\"{"} y')).toBe('{"a":"}","b":"\\"{"}');
  });
  it('JSON オブジェクトが無ければ undefined', () => {
    expect(extractJson('')).toBeUndefined();
    expect(extractJson('だめでした')).toBeUndefined();
    expect(extractJson('{"a":')).toBeUndefined();
  });
});

describe('parseLlmOutput', () => {
  it('10.2 の形をそのまま読む', () => {
    expect(parseLlmOutput(JSON.stringify(good))).toEqual({ output: good });
  });
  it('フェンス付きでも読める', () => {
    expect(parseLlmOutput('```json\n' + JSON.stringify(good) + '\n```')).toEqual({ output: good });
  });
  it('欠けた claims / hunkIds / groupIds / title / why は空で埋める', () => {
    const r = parseLlmOutput('{"hows":[{"id":2}]}');
    expect(r).toEqual({
      output: { hows: [{ id: 2, title: '', why: '', hunkIds: [], groupIds: [] }], claims: [], layerGuesses: [] },
    });
  });
  it('summary が来ても読まない（入口の説明は 2 回目の呼び出しが書く。5.3）', () => {
    const r = parseLlmOutput(JSON.stringify({ ...good, summary: { problem: 'p', approach: 'a', untouched: 'u', beforeAfter: [] } }));
    expect(r).toEqual({ output: good });
  });
  it('id が整数でなければ無しとして読む（振り直しは検証側）', () => {
    const r = parseLlmOutput('{"hows":[{"id":"one","hunkIds":["a"]}]}');
    expect('output' in r && r.output.hows[0]!.id).toBeUndefined();
  });
  it('hows が無い・配列でない・hunkIds が文字列の配列でないときは場所を言って失敗する', () => {
    expect(parseLlmOutput('{"summary":{}}')).toEqual({ error: 'hows が配列ではありません' });
    expect(parseLlmOutput('{"hows":{}}')).toEqual({ error: 'hows が配列ではありません' });
    expect(parseLlmOutput('{"hows":[{"hunkIds":[1]}]}')).toEqual({ error: 'hows[0].hunkIds が文字列の配列ではありません' });
    expect(parseLlmOutput('{"hows":[1]}')).toEqual({ error: 'hows[0] がオブジェクトではありません' });
  });
  it('claims の要素は text（文字列）と backed（真偽値）が要る', () => {
    expect(parseLlmOutput('{"hows":[],"claims":[{"text":"a"}]}')).toEqual({ error: 'claims[0].backed が真偽値ではありません' });
  });
  it('JSON が取り出せない・壊れているときは失敗する', () => {
    expect(parseLlmOutput('')).toEqual({ error: 'stdout に JSON オブジェクトがありません' });
    expect(parseLlmOutput('{"hows": [}')).toEqual({ error: 'stdout に JSON オブジェクトがありません' });
  });
});

describe('parseLlmOutput と layerGuesses（M2）', () => {
  it('欄が無ければ空配列（返さない LLM もある）', () => {
    const out = parseLlmOutput(JSON.stringify({ ...good, layerGuesses: undefined }));
    expect('output' in out && out.output.layerGuesses).toEqual([]);
  });

  it('配列でなければ場所を言って失敗する', () => {
    expect(parseLlmOutput(JSON.stringify({ ...good, layerGuesses: 'Infrastructure' }))).toEqual({ error: 'layerGuesses が配列ではありません' });
  });

  it('path や layer が文字列でなければ失敗する', () => {
    expect(parseLlmOutput(JSON.stringify({ ...good, layerGuesses: [{ path: 1, layer: 'Domain' }] }))).toEqual({ error: 'layerGuesses[0].path が文字列ではありません' });
    expect(parseLlmOutput(JSON.stringify({ ...good, layerGuesses: [{ path: 'a.kt' }] }))).toEqual({ error: 'layerGuesses[0].layer が文字列ではありません' });
  });
});
