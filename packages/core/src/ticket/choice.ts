// チケット選び（設計書 10.7。2026-10-12）。プログラムが拾った候補（candidates.ts）から、この PR のチケットを LLM に 1 つ選ばせる。
// LLM は候補の id か null しか返せない（原則 3）。label/prompt.ts と同じく、指示・出力の形・入力 JSON をすべて本文に入れる。決定的（原則 7）。
import type { TicketCandidate } from '@ondina/model';
import { extractJson } from '../label/schema.js';
import type { TicketSource } from './candidates.js';

export interface TicketChoiceInput {
  pr: TicketSource;
  candidates: Array<{ id: string; label: string; places: Array<{ in: 'title' | 'branch' | 'body'; line?: number; match: string; text: string }> }>;
}

/** LLM の出力。choice は candidates[].id か null（どれでもない） */
export interface TicketChoice {
  choice: string | null;
}

export const TICKET_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['choice'],
  properties: { choice: { type: ['string', 'null'] } },
} as const;

const INSTRUCTIONS = `あなたはコードレビューの道具の一部です。プルリクエストの題・ブランチ名・本文から、この PR が対応しているチケット（課題管理の項目）を選びます。結果は、チケットを取ってきてレビューの画面に出すのに使います。人の代わりに判断はしません。

守ること:
- 正しさ・品質についての意見を書かない
- ファイルを読まない。ツールを使わない。コマンドを実行しない。入力 JSON にある情報だけで答える
- 返答は下の JSON Schema に合う JSON オブジェクト 1 つだけ。前後に文やコードフェンスを付けない

入力:
- pr は PR の題（title。ないこともある）・ブランチ名（branch）・本文（body）の原文
- candidates はプログラムが拾ったチケットらしい文字列（番号の形と URL）。places は見つけた場所（title / branch / body と本文の行番号）、match は拾った文字列、text はその行

choice:
- この PR が対応しているチケットを candidates から 1 つ選び、その id を書く
- 関連・参考・前回・親として触れているだけのチケットは選ばない
- 番号の形でもチケットでないもの（文字コードの名前、規格やバージョンの番号など）は選ばない
- この PR が対応しているチケットが candidates になければ null`;

export function buildTicketInput(src: TicketSource, candidates: readonly TicketCandidate[]): TicketChoiceInput {
  return {
    pr: { ...(src.title === undefined ? {} : { title: src.title }), branch: src.branch, body: src.body },
    candidates: candidates.map((c, i) => ({
      id: `c${i + 1}`,
      label: c.label,
      places: c.places.map((p) => ({ in: p.in, ...(p.line === undefined ? {} : { line: p.line }), match: p.text.slice(p.start, p.end), text: p.text })),
    })),
  };
}

export function renderTicketPrompt(input: TicketChoiceInput): string {
  return [INSTRUCTIONS, `出力の形（JSON Schema）:\n${JSON.stringify(TICKET_OUTPUT_SCHEMA, null, 2)}`, `入力:\n${JSON.stringify(input, null, 2)}`].join('\n\n') + '\n';
}

/** stdout を出力の形に読む。choice が無ければ null（どれでもない） */
export function parseTicketOutput(stdout: string): { output: TicketChoice } | { error: string } {
  const json = extractJson(stdout);
  let doc: unknown;
  try {
    doc = json === undefined ? undefined : (JSON.parse(json) as unknown);
  } catch {
    doc = undefined;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return { error: 'stdout に JSON オブジェクトがありません' };
  const choice = (doc as Record<string, unknown>)['choice'];
  if (choice === undefined || choice === null) return { output: { choice: null } };
  if (typeof choice !== 'string') return { error: 'choice が文字列でも null でもありません' };
  return { output: { choice } };
}

/** 候補の id なら候補を返す。候補に無い id は捨てて知らせる（LLM は候補からしか選べない） */
export function verifyTicketChoice(out: TicketChoice, candidates: readonly TicketCandidate[]): { chosen?: TicketCandidate; info?: string } {
  if (out.choice === null) return {};
  const m = /^c(\d+)$/.exec(out.choice);
  const chosen = m === null ? undefined : candidates[Number(m[1]) - 1];
  return chosen === undefined ? { info: `LLM が候補にないチケット（${out.choice}）を選んだので除外しました` } : { chosen };
}
