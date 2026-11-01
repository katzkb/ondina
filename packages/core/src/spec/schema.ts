// 要求の抜き出し（設計書 10.8）の出力の形と、stdout からの読み取り。形の検査だけで、中身（知らない How など）は verify.ts が見る。
import { extractJson } from '../label/schema.js';
import type { SpecOutput } from './types.js';

/** 個数の上限。プロンプトに書き、検証でも 11 個目からは捨てる（verify.ts の MAX_SPECS） */
const MAX_ITEMS = 10;
/** 「なぜ」の文の上限（verify.ts も同じ数で切る） */
export const MAX_WHY = 3;

export const SPEC_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['specs', 'why', 'parentWhy'],
  properties: {
    why: { type: 'array', maxItems: MAX_WHY, items: { type: 'string' } },
    parentWhy: { type: 'array', maxItems: MAX_WHY, items: { type: 'string' } },
    specs: {
      type: 'array',
      maxItems: MAX_ITEMS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'hows'],
        properties: { text: { type: 'string' }, hows: { type: 'array', items: { type: 'integer' } } },
      },
    },
  },
} as const;

/** stdout を出力の形に読む。hows・why・parentWhy が無ければ空。形が違えば場所を言って失敗する */
export function parseSpecOutput(stdout: string): { output: SpecOutput } | { error: string } {
  const json = extractJson(stdout);
  let doc: unknown;
  try {
    doc = json === undefined ? undefined : (JSON.parse(json) as unknown);
  } catch {
    doc = undefined;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { error: 'stdout に JSON オブジェクトがありません' };
  const { specs, why = [], parentWhy = [] } = doc as Record<string, unknown>;
  if (!isStrings(why)) return { error: 'why が文字列の配列ではありません' };
  if (!isStrings(parentWhy)) return { error: 'parentWhy が文字列の配列ではありません' };
  if (!Array.isArray(specs)) return { error: 'specs が配列ではありません' };
  const out: SpecOutput['specs'] = [];
  for (const [i, s] of specs.entries()) {
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return { error: `specs[${i}] がオブジェクトではありません` };
    const { text, hows = [] } = s as Record<string, unknown>;
    if (typeof text !== 'string') return { error: `specs[${i}].text が文字列ではありません` };
    if (!Array.isArray(hows) || !hows.every((n) => Number.isInteger(n))) return { error: `specs[${i}].hows が整数の配列ではありません` };
    out.push({ text, hows: hows as number[] });
  }
  return { output: { specs: out, why, parentWhy } };
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((w) => typeof w === 'string');
