// 題・ブランチ名・本文から見つけたチケットの場所（Analysis.pr.ticketSearch。設計書 3.1 / 5.1。2026-10-12）の名前と、行の引用。
// 長い行は拾った文字列の前後だけを残す（仕様の箱の幅に収める）
import type { TicketPlace } from '@ondina/model';

export const QUOTE_BEFORE = 30;
export const QUOTE_AFTER = 50;

export function placeName(p: TicketPlace): string {
  return p.in === 'title' ? '題' : p.in === 'branch' ? 'ブランチ名' : `本文 ${p.line ?? '?'} 行目`;
}

export function quoteOf(p: TicketPlace): { before: string; hit: string; after: string } {
  const before = p.text.slice(0, p.start);
  const after = p.text.slice(p.end);
  return {
    before: before.length > QUOTE_BEFORE ? `…${before.slice(-QUOTE_BEFORE)}` : before,
    hit: p.text.slice(p.start, p.end),
    after: after.length > QUOTE_AFTER ? `${after.slice(0, QUOTE_AFTER)}…` : after,
  };
}
