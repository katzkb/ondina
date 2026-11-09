import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyIntents } from '../src/intent/verify.js';
import { parseIntentOutput } from '../src/intent/schema.js';
import type { IntentInput, IntentOutput } from '../src/intent/types.js';
import { fixtureAnalysis } from './fixture-analysis.js';
import { FIXTURE_ROOT } from './fixture.js';

const hunks = fixtureAnalysis({ files: false }).hunks;
const [a, b, c] = hunks.filter((h) => h.group === undefined);
const sources = { prBody: 'なぜ **在庫** を分けるか。', ticket: { body: '子の理由。' }, parent: { body: '親の目的。' }, commits: [{ sha: 'abcdef1234'.repeat(4), title: '在庫の名前を変える', body: '倉庫ごとの値だと分かるようにする。' }] };
const run = (intents: IntentOutput['intents'], src = sources) => applyIntents(hunks, { intents }, src);
const guess = { kind: 'guess' as const, text: '推定' };

describe('applyIntents', () => {
  it('不明な ID・追従メンバー・重複を知らせて除き、入力順にする。代表と逸脱は残す', () => {
    const group = hunks.find((h) => h.group !== undefined)!.group!;
    const member = group.members.find((id) => id !== group.representative)!;
    const ids = [b!.id, 'unknown', member, a!.id, b!.id, group.representative, ...group.deviations];
    const r = run(ids.map((hunkId) => ({ hunkId, notes: [guess] })));
    expect(r.intents.map((i) => i.hunkId)).toEqual(hunks.filter((h) => new Set([a!.id, b!.id, group.representative, ...group.deviations]).has(h.id)).map((h) => h.id));
    expect(r.info.filter((s) => s.includes('除外') || s.includes('最初'))).toHaveLength(3);
  });

  it.each([['pr-body', 'なぜ 在庫 を分けるか。'], ['ticket', '子の理由。'], ['parent', '親の目的。']])('原文が %s にあれば written を残し、ask は外す', (from, quote) => {
    const r = run([{ hunkId: a!.id, notes: [{ kind: 'written', text: '理由', from, quote }], ask: '理由は何ですか。' }]);
    expect(r.intents).toEqual([{ hunkId: a!.id, notes: [{ kind: 'written', text: '理由', from, quote }] }]);
  });

  it('引用が見つからない・空・記号だけ・from が不明なら guess にする', () => {
    const r = run([{ hunkId: a!.id, notes: [
      ...['原文にない', '', ' ** '].map((quote) => ({ kind: 'written' as const, text: '理由', from: 'pr-body', quote })),
      { kind: 'written', text: '理由', from: 'unknown', quote: '子の理由。' },
    ] }]);
    expect(r.intents[0]!.notes).toEqual(Array.from({ length: 4 }, () => ({ kind: 'guess', text: '理由' })));
    expect(r.info.filter((s) => s.includes('推定に'))).toHaveLength(4);
  });

  it('他の出典にだけある引用を指定した出典の written として残さない', () => {
    const r = run([{ hunkId: a!.id, notes: [{ kind: 'written', text: '理由', from: 'pr-body', quote: '子の理由。' }, { kind: 'written', text: '理由', quote: '子の理由。' }] }]);
    expect(r.intents[0]!.notes).toEqual([{ kind: 'guess', text: '理由' }, { kind: 'guess', text: '理由' }]);
    const absent = applyIntents(hunks, { intents: [{ hunkId: a!.id, notes: [{ kind: 'written', text: '理由', from: 'ticket', quote: '子の理由。' }] }] }, { prBody: '子の理由。', commits: [] });
    expect(absent.intents[0]!.notes).toEqual([{ kind: 'guess', text: '理由' }]);
  });

  it('commit の一意な prefix と、sha がない引用を完全な sha に解決する', () => {
    for (const commit of ['abcdef', undefined]) {
      const r = run([{ hunkId: a!.id, notes: [{ kind: 'written', text: '名前の理由', from: 'commit', quote: '倉庫ごとの値だと分かるようにする。', ...(commit === undefined ? {} : { commit }) }] }]);
      expect(r.intents[0]!.notes[0]).toEqual({ kind: 'written', text: '名前の理由', from: 'commit', quote: '倉庫ごとの値だと分かるようにする。', commit: sources.commits[0]!.sha });
    }
  });

  it('commit の題も引用できる。指定した sha が不明・曖昧・別の commit の引用なら guess', () => {
    const note = { kind: 'written' as const, text: '理由', from: 'commit', quote: '在庫の名前を変える' };
    expect(run([{ hunkId: a!.id, notes: [note] }]).intents[0]!.notes[0]!.kind).toBe('written');
    const src = { ...sources, commits: [...sources.commits, { sha: 'abcdef9999'.repeat(4), title: '別の題', body: '別の理由。' }] };
    for (const commit of ['unknown', 'abcdef', src.commits[1]!.sha]) {
      expect(run([{ hunkId: a!.id, notes: [{ ...note, commit }] }], src).intents[0]!.notes).toEqual([{ kind: 'guess', text: '理由' }]);
    }
  });

  it('空の文と、メモがなくなった差分を落とす。空の ask は残さない', () => {
    const r = run([{ hunkId: a!.id, notes: [{ kind: 'none', text: '  ' }], ask: '問いですか。' }, { hunkId: b!.id, notes: [], ask: '問いですか。' }, { hunkId: c!.id, notes: [{ ...guess, text: ' 推定 ' }], ask: ' ' }]);
    expect(r.intents).toEqual([{ hunkId: c!.id, notes: [guess] }]);
  });

  it('最も強いメモで差分を数える（written > guess > none）。書かれていなければ ask を残す', () => {
    const r = run([
      { hunkId: a!.id, notes: [guess, { kind: 'written', text: '理由', from: 'ticket', quote: '子の理由。' }] },
      { hunkId: b!.id, notes: [{ kind: 'none', text: '記載なし' }, guess], ask: '理由を教えていただけますか。' },
      { hunkId: c!.id, notes: [{ kind: 'none', text: '記載なし' }] },
    ]);
    expect(r.info.at(-1)).toBe('意図: 差分 3 件（書いてある 1 件、推定 1 件、書いていない 1 件）');
    expect(r.intents[1]!.ask).toBe('理由を教えていただけますか。');
  });
});

describe('applyIntents（fixture）', () => {
  it('記録を検証したゴールデン。引用を落とさず、3 状態がある', async () => {
    const read = <T,>(p: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, p), 'utf8')) as T;
    const parsed = parseIntentOutput(read<{ stdout: string }>('llm/intent-output.json').stdout);
    if ('error' in parsed) throw new Error(parsed.error);
    const r = applyIntents(hunks, parsed.output, read<IntentInput>('expected/llm-intent-input.json'));
    expect(r.info).toHaveLength(1);
    expect(new Set(r.intents.flatMap((i) => i.notes.map((n) => n.kind)))).toEqual(new Set(['written', 'guess', 'none']));
    await expect(JSON.stringify(r.intents, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/intents.json'));
  });
});
