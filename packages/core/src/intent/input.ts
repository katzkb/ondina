// 差分ごとの意図への入力。差分の行は 1 回目の入力をそのまま使う。
import type { CommitNote, HunkIntent, ParentTicket, Ticket } from '../model.js';
import type { LlmInput } from '../label/types.js';
import { ticketPlainText } from '../spec/input.js';
import type { IntentInput } from './types.js';

export interface BuildIntentInputArgs {
  base: Pick<LlmInput, 'hunks' | 'rippleGroups'>;
  prBody: string;
  ticket?: Ticket;
  parent?: ParentTicket;
  commits: readonly CommitNote[];
  previous?: readonly HunkIntent[];
}

export function buildIntentInput(a: BuildIntentInputArgs): IntentInput {
  return {
    hunks: a.base.hunks,
    rippleGroups: a.base.rippleGroups,
    prBody: a.prBody,
    ...(a.ticket === undefined || a.ticket.error !== undefined ? {} : { ticket: { body: ticketPlainText(a.ticket) } }),
    ...(a.parent === undefined ? {} : { parent: { body: ticketPlainText(a.parent) } }),
    commits: [...a.commits],
    ...(a.previous === undefined || a.previous.length === 0 ? {} : { previous: { intents: [...a.previous] } }),
  };
}
