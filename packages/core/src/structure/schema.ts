// 構成の推定の stdout から出力 JSON を取り出し、型を検査する（設計書 10.6。label/schema.ts と同じ方針）。
import { extractJson } from '../label/schema.js';
import type { Structure } from './types.js';

/** プロンプトに埋める出力の形。検査（parseStructureOutput）と同じ内容を人が読める形で */
export const STRUCTURE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['layers', 'dirs', 'files', 'outside', 'tests'],
  properties: {
    layers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'why'], properties: { name: { type: 'string' }, why: { type: 'string' } } } },
    dirs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['dir', 'layer'], properties: { dir: { type: 'string' }, layer: { type: 'string' } } } },
    files: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'layer'], properties: { path: { type: 'string' }, layer: { type: 'string' } } } },
    outside: { type: 'array', items: { type: 'string' } },
    tests: { type: 'array', items: { type: 'string' } },
  },
} as const;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

class Bad extends Error {}
function bad(msg: string): never {
  throw new Bad(msg);
}

/** stdout を出力の形に読む。欠けた配列は空で埋め、形が違う所は場所を言って失敗する */
export function parseStructureOutput(stdout: string): { output: Structure } | { error: string } {
  const json = extractJson(stdout);
  let doc: unknown;
  try {
    doc = json === undefined ? undefined : (JSON.parse(json) as unknown);
  } catch {
    doc = undefined;
  }
  if (!isObj(doc)) return { error: 'stdout に JSON オブジェクトがありません' };
  try {
    return {
      output: {
        layers: list(doc['layers'], 'layers', (o, w) => ({ name: text(o['name'], `${w}.name`), why: typeof o['why'] === 'string' ? o['why'] : '' })),
        dirs: list(doc['dirs'], 'dirs', (o, w) => ({ dir: text(o['dir'], `${w}.dir`), layer: text(o['layer'], `${w}.layer`) })),
        files: list(doc['files'], 'files', (o, w) => ({ path: text(o['path'], `${w}.path`), layer: text(o['layer'], `${w}.layer`) })),
        outside: strings(doc['outside'], 'outside'),
        tests: strings(doc['tests'], 'tests'),
      },
    };
  } catch (e) {
    if (e instanceof Bad) return { error: e.message };
    throw e;
  }
}

function text(v: unknown, where: string): string {
  return typeof v === 'string' ? v : bad(`${where} が文字列ではありません`);
}

function list<T>(v: unknown, key: string, item: (o: Obj, where: string) => T): T[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) bad(`${key} が配列ではありません`);
  return v.map((o, i) => (isObj(o) ? item(o, `${key}[${i}]`) : bad(`${key}[${i}] がオブジェクトではありません`)));
}

function strings(v: unknown, key: string): string[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : bad(`${key} が文字列の配列ではありません`);
}
