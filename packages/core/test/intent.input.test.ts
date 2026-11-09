import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIntentInput } from '../src/intent/input.js';
import type { LlmInput } from '../src/label/types.js';
import type { SpecInput } from '../src/spec/types.js';
import { FIXTURE_ROOT } from './fixture.js';

const read = <T,>(p: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, p), 'utf8')) as T;
const base = read<LlmInput>('expected/llm-input.json');
const spec = read<SpecInput>('expected/llm-spec-input.json');
const message = readFileSync(path.join(FIXTURE_ROOT, 'discount-commit-message.txt'), 'utf8').trimEnd();
const [title, , ...body] = message.split('\n');
const commits = [{ sha: 'a'.repeat(40), title: title!, body: body.join('\n') }];
const args = { base, prBody: readFileSync(path.join(FIXTURE_ROOT, 'pr-body.md'), 'utf8'), commits };

describe('buildIntentInput', () => {
  it('既存の差分の行と全ソースを渡す。チケットの HTML は文字にする', () => {
    const input = buildIntentInput({ ...args, ticket: { ref: 'T-1', source: 'jira', at: '', body: '<p>理由。</p>', format: 'html' }, parent: { key: 'T-0', url: '', via: 'parent', body: '<p>目的。</p>', format: 'html' } });
    expect(input).toMatchObject({ hunks: base.hunks, rippleGroups: base.rippleGroups, prBody: args.prBody, commits, ticket: { body: '理由。' }, parent: { body: '目的。' } });
    expect(input).not.toHaveProperty('previous');
  });

  it('チケットなしでも組める。前回の意図があるときだけ渡す', () => {
    expect(buildIntentInput(args)).not.toHaveProperty('ticket');
    expect(buildIntentInput(args)).not.toHaveProperty('parent');
    expect(buildIntentInput({ ...args, ticket: { ref: 'T-1', source: 'jira', at: '', error: '取得できませんでした' } })).not.toHaveProperty('ticket');
    const previous = [{ hunkId: 'h1', notes: [{ kind: 'guess' as const, text: '理由の推定' }], ask: '理由を教えていただけますか。' }];
    expect(buildIntentInput({ ...args, previous }).previous).toEqual({ intents: previous });
    expect(buildIntentInput({ ...args, previous: [] })).not.toHaveProperty('previous');
  });

  it('fixture のゴールデンと一致する', async () => {
    const input = buildIntentInput({ ...args, ticket: { ref: 'SHOP-421', source: 'jira', at: '', ...spec.ticket }, parent: { key: 'SHOP-400', url: '', via: 'parent', ...spec.parent! } });
    await expect(JSON.stringify(input, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/llm-intent-input.json'));
  });
});
