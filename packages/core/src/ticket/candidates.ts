// --ticket が無いとき、PR の題・ブランチ名・本文からチケットの候補を拾う（設計書 5.1。2026-10-12）。
// 拾うのは番号の形（SHOP-421）と URL だけ（事実）。どれがこの PR のチケットかは LLM が選ぶ（原則 3。ticket/prompt.ts）。
// 同じ番号は 1 つの候補にまとめ、その番号の URL があれば URL で取りに行く（Jira の場所の設定が要らない）。
import type { TicketCandidate, TicketPlace } from '@ondina/model';

/** プロンプトに入れる候補の上限。超えた分は数だけ返す */
export const TICKET_CANDIDATE_LIMIT = 20;

const KEY = /(?<![A-Za-z0-9_-])[A-Z][A-Z0-9_]*-\d+(?![A-Za-z0-9_])/g;
/** ブランチ名は小文字で書くことが多い（feature/shop-421-discount） */
const KEY_ANY_CASE = new RegExp(KEY.source, 'gi');
/** 括弧と全角の句読点は URL に含めない（「（URL）。」「[x](URL)」の形） */
const URL = /https?:\/\/[^\s<>"'`()（）「」『』【】、。，．]+/g;
const TRAILING = /[.,;:!?'"\]]+$/;
/** Markdown の画像（![代替](URL)）。画面の部品で、チケットではない */
const IMAGE_BEFORE = /!\[[^\]]*\]\(\s*$/;
/** PR テンプレートの書き方の例は HTML コメントに置かれ、画面に出ない */
const COMMENT = /<!--[\s\S]*?-->/g;

export interface TicketSource {
  /** PR の題。ローカルモード（main..feature/x）は人が書いたものでないので渡さない */
  title?: string;
  branch: string;
  body: string;
}

export function findTicketCandidates(src: TicketSource): { candidates: TicketCandidate[]; more: number } {
  const byName = new Map<string, TicketCandidate>();
  const add = (hit: Hit, place: TicketPlace) => {
    const name = hit.key ?? hit.url!;
    const c = byName.get(name);
    if (c === undefined) {
      byName.set(name, { ref: hit.url ?? hit.key!, label: name, places: [place] });
      return;
    }
    if (hit.url !== undefined && c.ref === hit.key) c.ref = hit.url;
    if (!c.places.some((p) => p.in === place.in && p.line === place.line)) c.places.push(place);
  };
  if (src.title !== undefined) for (const h of scan(src.title, KEY)) add(h, { in: 'title', text: src.title, start: h.start, end: h.end });
  for (const h of scan(src.branch, KEY_ANY_CASE)) add(h, { in: 'branch', text: src.branch, start: h.start, end: h.end });
  const lines = src.body.split('\n');
  const visible = src.body.replace(COMMENT, (m) => m.replace(/[^\n]/g, ' ')).split('\n');
  visible.forEach((v, i) => {
    for (const h of scan(v, KEY)) add(h, { in: 'body', line: i + 1, text: lines[i]!, start: h.start, end: h.end });
  });
  const all = [...byName.values()];
  return { candidates: all.slice(0, TICKET_CANDIDATE_LIMIT), more: Math.max(0, all.length - TICKET_CANDIDATE_LIMIT) };
}

interface Hit {
  start: number;
  end: number;
  /** 番号（大文字）。URL の中の番号も */
  key?: string;
  url?: string;
}

/** 1 行の中の URL と番号。URL の中の番号は URL のほうに数える。出てきた順 */
function scan(line: string, key: RegExp): Hit[] {
  const hits: Hit[] = [];
  const taken: Array<[number, number]> = [];
  for (const m of line.matchAll(URL)) {
    const url = m[0].replace(TRAILING, '');
    const start = m.index;
    taken.push([start, start + m[0].length]);
    if (IMAGE_BEFORE.test(line.slice(0, start))) continue;
    const inUrl = new RegExp(KEY.source).exec(url)?.[0];
    hits.push({ start, end: start + url.length, url, ...(inUrl === undefined ? {} : { key: inUrl }) });
  }
  for (const m of line.matchAll(key)) {
    const start = m.index;
    if (taken.some(([a, b]) => start >= a && start < b)) continue;
    hits.push({ start, end: start + m[0].length, key: m[0].toUpperCase() });
  }
  return hits.sort((a, b) => a.start - b.start);
}
