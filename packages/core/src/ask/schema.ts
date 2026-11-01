// 案内人に聞く（設計書 10.5）の LLM の stdout から出力 JSON を取り出し、形を検査する。
// 1 回目・2 回目（label/schema.ts・narration/schema.ts）と同じく、形の強制は LLM 側に頼らずここで手書きの検査をする。
import { extractJson } from '../label/schema.js';
import type { AskOutput } from './types.js';

const text = { type: 'string' } as const;

/** プロンプトに埋める出力の形。検査（parseAskOutput）と同じ内容を人が読める形で */
export const ASK_OUTPUT_SCHEMA = {
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
        },
      },
    },
    tail: text,
  },
} as const;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** stdout を 10.5 の形に読む。lead が無ければ失敗。文の無い項目は捨てる。cite と web は形だけ見て、場所と URL の正しさは verify が見る */
export function parseAskOutput(stdout: string): { output: AskOutput } | { error: string } {
  const json = extractJson(stdout);
  let doc: unknown;
  try {
    doc = json === undefined ? undefined : (JSON.parse(json) as unknown);
  } catch {
    doc = undefined;
  }
  if (!isObj(doc)) return { error: 'stdout に JSON オブジェクトがありません' };
  const lead = str(doc['lead']);
  if (lead.trim() === '') return { error: 'lead がありません' };
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
      },
    ];
  });
  const tail = str(doc['tail']);
  return { output: { lead, items, ...(tail === '' ? {} : { tail }) } };
}
