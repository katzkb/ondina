// プロンプト本文（設計書 10.3）。CLI 固有のフラグに頼らず、指示・出力の形・入力 JSON を全部 stdin の本文に入れる。
import { describe, expect, it } from 'vitest';
import { renderPrompt } from '../src/label/prompt.js';
import { LLM_OUTPUT_SCHEMA } from '../src/label/schema.js';
import type { LlmInput } from '../src/label/types.js';

const input: LlmInput = {
  pr: { title: 'T', body: 'B' },
  hunks: [{ id: 'h1', path: 'a/B.kt', symbol: 'f()', kindHint: 'candidate', lines: ['-x', '+y'] }],
  rippleGroups: [],
};

describe('renderPrompt', () => {
  it('入力 JSON と出力の形（JSON Schema）を本文に含む', () => {
    const p = renderPrompt(input);
    expect(p).toContain(JSON.stringify(input, null, 2));
    expect(p).toContain(JSON.stringify(LLM_OUTPUT_SCHEMA, null, 2));
  });
  it('10.3 の制約と、ファイルを読まない・ツールを使わない・JSON だけ返す指示を含む', () => {
    const p = renderPrompt(input);
    for (const s of ['評価', '観測', '依存順', '「〜する」の形', '未帰属', 'ファイルを読', 'ツールを使', 'JSON オブジェクト 1 つだけ', 'kindHint', 'groupIds', '繋がらない変更']) expect(p, s).toContain(s);
  });
  it('題の長さは字で数え、命令形と言わない。用語は直訳しない（日本語に語の区切りは無く、命令形は「〜せよ」になる）', () => {
    const p = renderPrompt(input);
    expect(p).toContain('20 字以内');
    expect(p).toContain('直訳しない');
    for (const s of ['命令形', '語以内']) expect(p, s).not.toContain(s);
  });
  it('入口の説明（summary）は頼まない（2 回目の呼び出しが書く。5.3）', () => {
    expect(renderPrompt(input)).not.toContain('summary');
  });
  it('previous があれば維持の指示を出し、無ければ出さない', () => {
    expect(renderPrompt(input)).not.toContain('previous');
    const withPrev = renderPrompt({ ...input, previous: { hows: [{ id: 1, title: 'a', why: 'b' }], assignment: { h1: [1] } } });
    expect(withPrev).toContain('previous');
    expect(withPrev).toContain('維持');
  });
  it('層は設定か構成の推定で決まったものと伝え、推定の層名は layers から選ばせる', () => {
    const p = renderPrompt({ pr: { title: 't', body: '' }, hunks: [], rippleGroups: [] });
    expect(p).toContain('リポジトリ全体の構成の推定');
    expect(p).toContain('layer は layers の名前のどれか');
  });

  it('同じ入力には同じ本文（決定的）', () => {
    expect(renderPrompt(input)).toBe(renderPrompt(structuredClone(input)));
  });
});
