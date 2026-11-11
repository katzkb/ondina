// 案内人に聞く（設計書 10.5）の LLM の stdout から出力 JSON を取り出し、形を検査する。
// 1 回目・2 回目（label/schema.ts・narration/schema.ts）と同じく、形の強制は LLM 側に頼らずここで手書きの検査をする。
// 出力は答え（lead / items / tail）か、材料が足りないときの読みたい物（need）のどちらか（2026-11-04）。
import { extractJson } from '../label/schema.js';
import type { AskNeed, AskOutput } from './types.js';

const text = { type: 'string' } as const;

/** 1 回に頼める物の数（files と search それぞれ）。超えた分は読まない */
export const ASK_NEED_MAX = 5;

/** 答えの形。最後の回（もう頼めない）のプロンプトはこれだけを見せる */
export const ASK_ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lead', 'items'],
  properties: {
    lead: text,
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text'],
        properties: {
          text,
          cite: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'side', 'line'],
            properties: { path: text, side: { enum: ['head', 'base'] }, line: { type: 'integer' }, endLine: { type: 'integer' } },
          },
          web: {
            type: 'object',
            additionalProperties: false,
            required: ['url', 'title'],
            properties: { url: text, title: text },
          },
          known: { const: true },
          guess: { const: true },
        },
      },
    },
    tail: text,
  },
} as const;

/** プロンプトに埋める出力の形。検査（parseAskOutput）と同じ内容を人が読める形で */
export const ASK_OUTPUT_SCHEMA = {
  oneOf: [
    ASK_ANSWER_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      required: ['need'],
      properties: {
        need: {
          type: 'object',
          additionalProperties: false,
          properties: { files: { type: 'array', items: text }, search: { type: 'array', items: text } },
        },
      },
    },
  ],
} as const;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
/** 空でない文字列だけ、前後の空白を取って、重ねずに */
const strs = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).map((s) => str(s).trim()).filter((s) => s !== ''))];

/**
 * stdout を 10.5 の形に読む。lead があれば答え（need が一緒にあっても答えを採る）。lead が無く、need に読みたい物が 1 つでもあれば need。どちらも無ければ失敗。
 * 文の無い項目は捨てる。cite と web は形だけ見て、場所と URL の正しさは verify が見る
 */
export function parseAskOutput(stdout: string): { output: AskOutput } | { need: AskNeed } | { error: string } {
  const json = extractJson(stdout);
  let doc: unknown;
  try {
    doc = json === undefined ? undefined : (JSON.parse(json) as unknown);
  } catch {
    doc = undefined;
  }
  if (!isObj(doc)) return { error: 'stdout に JSON オブジェクトがありません' };
  const lead = str(doc['lead']);
  if (lead.trim() === '') {
    const n = doc['need'];
    const need = { files: isObj(n) ? strs(n['files']).slice(0, ASK_NEED_MAX) : [], search: isObj(n) ? strs(n['search']).slice(0, ASK_NEED_MAX) : [] };
    return need.files.length + need.search.length > 0 ? { need } : { error: 'lead がありません' };
  }
  const rawItems = Array.isArray(doc['items']) ? doc['items'] : [];
  const items = rawItems.flatMap((it): AskOutput['items'] => {
    if (!isObj(it) || str(it['text']).trim() === '') return [];
    const c = it['cite'];
    const w = it['web'];
    const end = isObj(c) ? num(c['endLine']) : null;
    return [
      {
        text: str(it['text']),
        ...(isObj(c) ? { cite: { path: str(c['path']), side: str(c['side']), line: num(c['line']), ...(end === null ? {} : { endLine: end }) } } : {}),
        ...(isObj(w) ? { web: { url: str(w['url']).trim(), title: str(w['title']) } } : {}),
        ...(it['known'] === true ? { known: true as const } : {}),
        ...(it['guess'] === true ? { guess: true as const } : {}),
      },
    ];
  });
  const tail = str(doc['tail']);
  return { output: { lead, items, ...(tail === '' ? {} : { tail }) } };
}
