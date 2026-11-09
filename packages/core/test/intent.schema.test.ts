import { describe, expect, it } from 'vitest';
import { parseIntentOutput } from '../src/intent/schema.js';

describe('parseIntentOutput', () => {
  it('3 種のメモと commit・ask を読み、未知の from は検証に渡す', () => {
    const output = { intents: [{ hunkId: 'h1', notes: [{ kind: 'written', text: '理由', from: 'commit', quote: '原文', commit: 'abc' }, { kind: 'guess', text: '推定' }, { kind: 'none', text: '記載なし' }, { kind: 'written', text: '理由', from: 'other', quote: '原文' }], ask: '理由を教えていただけますか。' }] };
    expect(parseIntentOutput('```json\n' + JSON.stringify(output) + '\n```')).toEqual({ output });
    expect(parseIntentOutput('{"intents":[]}')).toEqual({ output: { intents: [] } });
  });

  it.each([
    'null', '[]', 'no json', '{"intents":{}}',
    '{"intents":[null]}', '{"intents":[{"hunkId":1,"notes":[]}]}',
    '{"intents":[{"hunkId":"h1","notes":{}}]}',
    ...[{ kind: 'bogus', text: 'x' }, { kind: 'guess', text: 1 }, null, { kind: 'written', text: 'x', quote: 1 }, { kind: 'written', text: 'x', from: 1 }, { kind: 'written', text: 'x', commit: 1 }].map((n) => JSON.stringify({ intents: [{ hunkId: 'h1', notes: [n] }] })),
    '{"intents":[{"hunkId":"h1","notes":[],"ask":1}]}',
  ])('形が違う出力は失敗する: %s', (stdout) => {
    expect(parseIntentOutput(stdout)).toHaveProperty('error');
  });
});
