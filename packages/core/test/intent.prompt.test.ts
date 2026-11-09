import { describe, expect, it } from 'vitest';
import { renderIntentPrompt } from '../src/intent/prompt.js';
import { INTENT_OUTPUT_SCHEMA } from '../src/intent/schema.js';
import type { IntentInput } from '../src/intent/types.js';

const input: IntentInput = { prBody: '理由', commits: [], hunks: [], rippleGroups: [] };
describe('renderIntentPrompt', () => {
  it('同じ入力には同じ指示・出力の形・入力 JSON を渡す', () => {
    const p = renderIntentPrompt(input);
    expect(p).toContain(JSON.stringify(INTENT_OUTPUT_SCHEMA, null, 2));
    expect(p).toContain(`入力:\n${JSON.stringify(input, null, 2)}`);
    expect(renderIntentPrompt(input)).toBe(p);
  });
  it('引用と推定を分け、書かれていないことと作者への問いを指示する', () => {
    const p = renderIntentPrompt(input);
    for (const word of ['written', 'guess', 'none', 'ask', 'commit', '原文', 'previous', '評価語', 'ツールを使わない', 'JSON オブジェクト 1 つだけ', 'です・ます', '在庫']) expect(p).toContain(word);
    expect(p.slice(0, p.indexOf('出力の形'))).not.toMatch(/割引|Logger/);
  });
});
