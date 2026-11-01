// 「聞く Q」（設計書 3.10）。どの画面でも見出しの行に置く（2026-10-07。見本を比べて「どの画面でも聞ける」にした）。
// 待っている間と、閉じている間に答えが来たときは右肩に点。状態は App が context で配る（各画面に props を通さない）。
import { createContext, useContext } from 'react';
import type { Command } from '../commands/commands.js';
import { Key } from './Key.js';

export interface AskStatus {
  open: boolean;
  pending: boolean;
  unread: boolean;
  dispatch: (c: Command) => void;
}

export const AskContext = createContext<AskStatus | null>(null);

export function AskButton({ className = 'btn sm' }: { className?: string }) {
  const s = useContext(AskContext);
  if (!s) return null;
  const dot = s.unread ? 'dot new' : s.pending ? 'dot busy' : null;
  return (
    <button
      type="button"
      className={`${className} askbtn${s.open ? ' on' : ''}`}
      title={s.unread ? '案内人の答えが来ています' : s.pending ? '案内人の答えを待っています' : '案内人に聞く'}
      onClick={() => s.dispatch({ id: 'ask.toggle' })}
    >
      聞く <Key action="ask.toggle" />
      {dot && <span className={dot} aria-hidden="true" />}
    </button>
  );
}
