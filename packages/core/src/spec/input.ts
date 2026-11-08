// 要求の抜き出し（設計書 10.8）への入力を組む。決定的（原則 7）。
// - 差分の行は 1 回目の全入力（hunks / rippleGroups）を使う。どの How にも入らなかった差分も選べる
// - チケットは番号・題・種類と本文の文字。Jira の本文（HTML）はタグを外す。状態と取った時刻は渡さない（要求の文と関係しない）
// - 親チケット（2026-10-29）も同じ形。案件の目的の文を写させるだけで、要求は親から抜き出させない
// - 作者の説明・辺・層は渡さない（要求はチケットから、対応は差分の行から決める）
import type { ParentTicket, Spec, Ticket } from '../model.js';
import type { LlmInput } from '../label/types.js';
import type { SpecInput, SpecInputTicket } from './types.js';

/** チケットの本文の上限（字）。超えたら切って truncated を付ける。実際のチケットは長くても数千字 */
export const SPEC_BODY_LIMIT = 30_000;

export interface BuildSpecInputArgs {
  /** 1 回目の入力（buildLlmInput の結果） */
  base: Pick<LlmInput, 'hunks' | 'rippleGroups'>;
  /** 取れたチケット（error の無いもの） */
  ticket: Ticket;
  /** 親チケット（本文が無くても番号と題は渡す） */
  parent?: ParentTicket;
  /** 前回の解析で同じチケットから抜き出した要求。空なら渡さない */
  previous?: readonly Spec[];
}

export function buildSpecInput({ base, ticket, parent, previous }: BuildSpecInputArgs): SpecInput {
  // 古い Analysis の要求には差分の対応がない。How の対応を空の差分として引き継がない。
  const prior = previous?.filter((s) => Array.isArray(s.hunkIds)) ?? [];
  return {
    ticket: ticketInput(ticket),
    ...(parent === undefined ? {} : { parent: ticketInput(parent) }),
    hunks: base.hunks,
    rippleGroups: base.rippleGroups,
    ...(prior.length === 0 ? {} : { previous: { specs: prior.map((s) => ({ text: s.text, hunkIds: [...s.hunkIds] })) } }),
  };
}

function ticketInput(t: Pick<Ticket, 'key' | 'title' | 'kind' | 'body' | 'format'>): SpecInputTicket {
  const body = ticketPlainText(t);
  return {
    ...(t.key === undefined ? {} : { key: t.key }),
    ...(t.title === undefined ? {} : { title: t.title }),
    ...(t.kind === undefined ? {} : { kind: t.kind }),
    body: body.slice(0, SPEC_BODY_LIMIT),
    ...(body.length > SPEC_BODY_LIMIT ? { truncated: true as const } : {}),
  };
}

/** チケットの本文の文字。Jira の HTML（format: html）はタグを外す。Markdown と文字はそのまま */
export function ticketPlainText(t: Pick<Ticket, 'body' | 'format'>): string {
  if (t.body === undefined) return '';
  return t.format === 'html' ? htmlToText(t.body) : t.body;
}

const BLOCK = 'p|div|h[1-6]|tr|ul|ol|table|thead|tbody|blockquote|pre';

/** 見出し・段落・表の行・<br> は改行、リストの項目は「- 」、表のセルは空白。script / style / コメントの中身は落とす */
function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(new RegExp(`</?(?:${BLOCK}|li)\\b[^>]*>`, 'gi'), '\n')
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter((l) => l !== '')
    .join('\n');
}

const NAMED: Readonly<Record<string, string>> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
    }
    return NAMED[e.toLowerCase()] ?? all;
  });
}
