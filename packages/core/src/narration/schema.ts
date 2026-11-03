// 2 回目の LLM（文を書く。設計書 5.3 / 10.2）の stdout から出力 JSON を取り出し、型を検査する。
// 1 回目（label/schema.ts）と同じく、形の強制は LLM 側に頼らずここで手書きの検査をする。
import { extractJson } from '../label/schema.js';
import type { NarrationOutput, NarrationOutputCheck, NarrationOutputNode } from './types.js';

const text = { type: 'string' } as const;

/** プロンプトに埋める出力の形。検査（parseNarrationOutput）と同じ内容を人が読める形で */
export const NARRATION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'background', 'courses', 'behaviors'],
  properties: {
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['headline', 'example', 'flows'],
      properties: {
        headline: text,
        example: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'at'],
          properties: {
            text,
            at: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['symbolId', 'lines'], properties: { symbolId: text, lines: { type: 'array', items: { type: 'integer' } } } } },
          },
        },
        flows: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['nodes'],
            properties: {
              nodes: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['title', 'howIds', 'symbolId', 'before', 'after', 'untouched', 'pass'],
                  properties: { title: text, howIds: { type: 'array', items: { type: 'integer' } }, symbolId: text, before: text, after: text, untouched: { type: 'array', items: text }, pass: text },
                },
              },
            },
          },
        },
      },
    },
    background: {
      type: 'object',
      additionalProperties: false,
      required: ['existing', 'terms'],
      properties: {
        existing: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['symbols', 'text'], properties: { symbols: { type: 'array', items: text }, text } },
        },
        terms: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: ['word', 'code', 'meaning'], properties: { word: text, code: text, meaning: text } },
        },
      },
    },
    courses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['howId', 'change', 'checks', 'stops'],
        properties: {
          howId: { type: 'integer' },
          change: { type: 'object', additionalProperties: false, required: ['before', 'after'], properties: { before: text, after: text } },
          checks: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'at'],
              properties: {
                text,
                at: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: false, required: ['symbolId', 'lines', 'say'], properties: { symbolId: text, lines: { type: 'array', items: { type: 'integer' } }, say: text } },
                },
              },
            },
          },
          stops: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['symbolId', 'role'], properties: { symbolId: text, role: text } },
          },
        },
      },
    },
    behaviors: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'title'], properties: { id: text, title: text } },
    },
  },
} as const;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

class Bad extends Error {}
function bad(msg: string): never {
  throw new Bad(msg);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** リストの欄。文字列で来たら 1 要素の配列に（空文字なら空配列） */
const list = (v: unknown, where: string): string[] => {
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') return v === '' ? [] : [v];
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : bad(`${where} が文字列の配列ではありません`);
};

/** stdout を 10.2 の形に読む。欠けた文字列・配列は空で埋め、形が違う所は場所を言って失敗する */
export function parseNarrationOutput(stdout: string): { output: NarrationOutput } | { error: string } {
  const json = extractJson(stdout);
  let doc: unknown;
  try {
    doc = json === undefined ? undefined : (JSON.parse(json) as unknown);
  } catch {
    doc = undefined;
  }
  if (!isObj(doc)) return { error: 'stdout に JSON オブジェクトがありません' };
  try {
    return { output: { summary: summary(doc['summary']), background: background(doc['background']), courses: courses(doc['courses']), behaviors: behaviors(doc['behaviors']) } };
  } catch (e) {
    if (e instanceof Bad) return { error: e.message };
    throw e;
  }
}

function summary(v: unknown): NarrationOutput['summary'] {
  const s = isObj(v) ? v : {};
  const ex = s['example'] ?? {};
  if (!isObj(ex)) bad('summary.example がオブジェクトではありません');
  const at = ex['at'] ?? [];
  if (!Array.isArray(at)) bad('summary.example.at が配列ではありません');
  const example = {
    text: str(ex['text']),
    at: at.map((a, k) => {
      if (!isObj(a)) bad(`summary.example.at[${k}] がオブジェクトではありません`);
      if (typeof a['symbolId'] !== 'string') bad(`summary.example.at[${k}].symbolId が文字列ではありません`);
      return { symbolId: a['symbolId'], lines: ints(a['lines'], `summary.example.at[${k}].lines`) };
    }),
  };
  const flows = s['flows'] ?? [];
  if (!Array.isArray(flows)) bad('summary.flows が配列ではありません');
  return { headline: str(s['headline']), example, flows: flows.map((f, i) => ({ nodes: nodes(f, `summary.flows[${i}]`) })) };
}

function background(v: unknown): NarrationOutput['background'] {
  const b = v ?? {};
  if (!isObj(b)) bad('background がオブジェクトではありません');
  const items = (x: unknown, where: string): Obj[] => {
    if (x === undefined || x === null) return [];
    if (!Array.isArray(x)) bad(`${where} が配列ではありません`);
    return x.map((e, k) => (isObj(e) ? e : bad(`${where}[${k}] がオブジェクトではありません`)));
  };
  return {
    existing: items(b['existing'], 'background.existing').map((e, k) => ({ symbols: list(e['symbols'], `background.existing[${k}].symbols`), text: str(e['text']) })),
    terms: items(b['terms'], 'background.terms').map((t) => ({ word: str(t['word']), code: str(t['code']), meaning: str(t['meaning']) })),
  };
}

function nodes(f: unknown, where: string): NarrationOutputNode[] {
  if (!isObj(f)) bad(`${where} がオブジェクトではありません`);
  const ns = f['nodes'] ?? [];
  if (!Array.isArray(ns)) bad(`${where}.nodes が配列ではありません`);
  return ns.map((n, k) => {
    const at = `${where}.nodes[${k}]`;
    if (!isObj(n)) bad(`${at} がオブジェクトではありません`);
    return {
      title: str(n['title']),
      howIds: ints(n['howIds'], `${at}.howIds`),
      symbolId: str(n['symbolId']),
      before: str(n['before']),
      after: str(n['after']),
      untouched: list(n['untouched'], `${at}.untouched`),
      pass: str(n['pass']),
    };
  });
}

function courses(v: unknown): NarrationOutput['courses'] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) bad('courses が配列ではありません');
  return v.map((c, i) => {
    if (!isObj(c)) bad(`courses[${i}] がオブジェクトではありません`);
    if (!Number.isInteger(c['howId'])) bad(`courses[${i}].howId が整数ではありません`);
    const stops = c['stops'] ?? [];
    if (!Array.isArray(stops)) bad(`courses[${i}].stops が配列ではありません`);
    const change = c['change'] ?? {};
    if (!isObj(change)) bad(`courses[${i}].change がオブジェクトではありません`);
    return {
      howId: c['howId'] as number,
      change: { before: str(change['before']), after: str(change['after']) },
      checks: checks(c['checks'], `courses[${i}].checks`),
      stops: stops.map((s, k) => {
        if (!isObj(s)) bad(`courses[${i}].stops[${k}] がオブジェクトではありません`);
        if (typeof s['symbolId'] !== 'string') bad(`courses[${i}].stops[${k}].symbolId が文字列ではありません`);
        return { symbolId: s['symbolId'], role: str(s['role']) };
      }),
    };
  });
}

function behaviors(v: unknown): NarrationOutput['behaviors'] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) bad('behaviors が配列ではありません');
  return v.map((b, i) => {
    if (!isObj(b)) bad(`behaviors[${i}] がオブジェクトではありません`);
    if (typeof b['id'] !== 'string') bad(`behaviors[${i}].id が文字列ではありません`);
    return { id: b['id'], title: str(b['title']) };
  });
}

function checks(v: unknown, where: string): NarrationOutputCheck[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) bad(`${where} が配列ではありません`);
  return v.map((c, j) => {
    if (!isObj(c)) bad(`${where}[${j}] がオブジェクトではありません`);
    const at = c['at'] ?? [];
    if (!Array.isArray(at)) bad(`${where}[${j}].at が配列ではありません`);
    return {
      text: str(c['text']),
      at: at.map((a, k) => {
        if (!isObj(a)) bad(`${where}[${j}].at[${k}] がオブジェクトではありません`);
        if (typeof a['symbolId'] !== 'string') bad(`${where}[${j}].at[${k}].symbolId が文字列ではありません`);
        return { symbolId: a['symbolId'], lines: ints(a['lines'], `${where}[${j}].at[${k}].lines`), say: str(a['say']) };
      }),
    };
  });
}

/** 行番号の欄。数 1 つで来たら 1 要素の配列に */
const ints = (v: unknown, where: string): number[] => {
  if (v === undefined || v === null) return [];
  if (Number.isInteger(v)) return [v as number];
  return Array.isArray(v) && v.every((n) => Number.isInteger(n)) ? (v as number[]) : bad(`${where} が整数の配列ではありません`);
};
