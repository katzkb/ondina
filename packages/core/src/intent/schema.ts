// 差分ごとの意図の JSON の読み取り。引用と ID の検証は verify.ts に分ける。
import { extractJson } from '../label/schema.js';
import type { IntentOutput } from './types.js';

export const INTENT_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['intents'],
  properties: {
    intents: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['hunkId', 'notes'],
      properties: {
        hunkId: { type: 'string' }, ask: { type: 'string' },
        notes: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['kind', 'text'],
          properties: {
            kind: { enum: ['written', 'guess', 'none'] }, text: { type: 'string' },
            from: { enum: ['pr-body', 'ticket', 'parent', 'commit'] }, quote: { type: 'string' }, commit: { type: 'string' },
          },
        } },
      },
    } },
  },
} as const;

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseIntentOutput(stdout: string): { output: IntentOutput } | { error: string } {
  let doc: unknown;
  try { doc = JSON.parse(extractJson(stdout) ?? 'null') as unknown; } catch { doc = undefined; }
  if (!object(doc)) return { error: 'stdout に JSON オブジェクトがありません' };
  if (!Array.isArray(doc['intents'])) return { error: 'intents が配列ではありません' };
  const intents: IntentOutput['intents'] = [];
  for (const [i, entry] of doc['intents'].entries()) {
    if (!object(entry)) return { error: `intents[${i}] がオブジェクトではありません` };
    const { hunkId, notes, ask } = entry;
    if (typeof hunkId !== 'string') return { error: `intents[${i}].hunkId が文字列ではありません` };
    if (!Array.isArray(notes)) return { error: `intents[${i}].notes が配列ではありません` };
    if (ask !== undefined && typeof ask !== 'string') return { error: `intents[${i}].ask が文字列ではありません` };
    const kept: IntentOutput['intents'][number]['notes'] = [];
    for (const [j, note] of notes.entries()) {
      const at = `intents[${i}].notes[${j}]`;
      if (!object(note)) return { error: `${at} がオブジェクトではありません` };
      const { kind, text, from, quote, commit } = note;
      if (kind !== 'written' && kind !== 'guess' && kind !== 'none') return { error: `${at}.kind が written / guess / none ではありません` };
      if (typeof text !== 'string') return { error: `${at}.text が文字列ではありません` };
      if (from !== undefined && typeof from !== 'string') return { error: `${at}.from が文字列ではありません` };
      if (quote !== undefined && typeof quote !== 'string') return { error: `${at}.quote が文字列ではありません` };
      if (commit !== undefined && typeof commit !== 'string') return { error: `${at}.commit が文字列ではありません` };
      kept.push({ kind, text, ...(from === undefined ? {} : { from }), ...(quote === undefined ? {} : { quote }), ...(commit === undefined ? {} : { commit }) });
    }
    intents.push({ hunkId, notes: kept, ...(ask === undefined ? {} : { ask }) });
  }
  return { output: { intents } };
}
