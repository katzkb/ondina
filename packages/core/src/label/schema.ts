// LLM コマンドの stdout から出力 JSON を取り出し、型を検査する（設計書 10.2 / 5.4）。
// コマンドは Claude とは限らず、CLI によっては前後に文やコードフェンスが付くので、最初の JSON オブジェクトだけを取り出す。
// 形の強制は LLM 側に頼らず（CLI 固有の --json-schema は使わない）、ここで手書きの検査をする。JSON Schema ライブラリは足さない。
import type { LlmOutput } from './types.js';

/** プロンプトに埋める出力の形（10.2 の今回の範囲）。検査（parseLlmOutput）と同じ内容を人が読める形で */
export const LLM_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hows', 'claims', 'layerGuesses', 'themes'],
  properties: {
    hows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'why', 'hunkIds', 'groupIds'],
        properties: {
          id: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          why: { type: 'string' },
          hunkIds: { type: 'array', items: { type: 'string' } },
          groupIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    claims: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['text', 'backed', 'reason'], properties: { text: { type: 'string' }, backed: { type: 'boolean' }, reason: { type: 'string' } } },
    },
    layerGuesses: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['path', 'layer'], properties: { path: { type: 'string' }, layer: { type: 'string' } } },
    },
    themes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'howIds'],
        properties: { title: { type: 'string' }, howIds: { type: 'array', items: { type: 'integer', minimum: 1 } } },
      },
    },
  },
} as const;

/** 最初の `{` から対応する `}` までを返す。文字列の中の括弧は数えない。無ければ undefined */
export function extractJson(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

class Bad extends Error {}
// 制御フローの絞り込み（if (!Array.isArray(v)) bad(...)）が効くように関数宣言にする
function bad(msg: string): never {
  throw new Bad(msg);
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strArray = (v: unknown, where: string): string[] => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : bad(`${where} が文字列の配列ではありません`);
};

/** stdout を 10.2 の形に読む。欠けた文字列・配列は空で埋め、形が違う所は場所を言って失敗する */
export function parseLlmOutput(stdout: string): { output: LlmOutput } | { error: string } {
  const json = extractJson(stdout);
  let doc: unknown;
  try {
    doc = json === undefined ? undefined : (JSON.parse(json) as unknown);
  } catch {
    doc = undefined;
  }
  if (!isObj(doc)) return { error: 'stdout に JSON オブジェクトがありません' };
  try {
    return { output: { hows: hows(doc['hows']), claims: claims(doc['claims']), layerGuesses: layerGuesses(doc['layerGuesses']), themes: themes(doc['themes']) } };
  } catch (e) {
    if (e instanceof Bad) return { error: e.message };
    throw e;
  }
}

function hows(v: unknown): LlmOutput['hows'] {
  if (!Array.isArray(v)) bad('hows が配列ではありません');
  return v.map((h, i) => {
    if (!isObj(h)) bad(`hows[${i}] がオブジェクトではありません`);
    const id = h['id'];
    return {
      ...(Number.isInteger(id) ? { id: id as number } : {}),
      title: str(h['title']),
      why: str(h['why']),
      hunkIds: strArray(h['hunkIds'], `hows[${i}].hunkIds`),
      groupIds: strArray(h['groupIds'], `hows[${i}].groupIds`),
    };
  });
}

function claims(v: unknown): LlmOutput['claims'] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) bad('claims が配列ではありません');
  return v.map((c, i) => {
    if (!isObj(c)) bad(`claims[${i}] がオブジェクトではありません`);
    if (typeof c['text'] !== 'string') bad(`claims[${i}].text が文字列ではありません`);
    if (typeof c['backed'] !== 'boolean') bad(`claims[${i}].backed が真偽値ではありません`);
    const reason = c['reason'];
    return { text: c['text'], backed: c['backed'], ...(typeof reason === 'string' ? { reason } : {}) };
  });
}

function layerGuesses(v: unknown): LlmOutput['layerGuesses'] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) bad('layerGuesses が配列ではありません');
  return v.map((g, i) => {
    if (!isObj(g)) bad(`layerGuesses[${i}] がオブジェクトではありません`);
    if (typeof g['path'] !== 'string') bad(`layerGuesses[${i}].path が文字列ではありません`);
    if (typeof g['layer'] !== 'string') bad(`layerGuesses[${i}].layer が文字列ではありません`);
    return { path: g['path'], layer: g['layer'] };
  });
}

function themes(v: unknown): LlmOutput['themes'] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) bad('themes が配列ではありません');
  return v.map((t, i) => {
    if (!isObj(t)) bad(`themes[${i}] がオブジェクトではありません`);
    const ids = t['howIds'];
    if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n))) bad(`themes[${i}].howIds が整数の配列ではありません`);
    return { title: str(t['title']), howIds: ids as number[] };
  });
}
