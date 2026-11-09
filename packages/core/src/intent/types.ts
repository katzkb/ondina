// 差分ごとの意図（設計書 10.9）の入出力。引用の裏付けはプログラムで検証する。
import type { CommitNote, HunkIntent } from '../model.js';
import type { LlmInput } from '../label/types.js';

/** 引用元の本文。チケットの HTML は文字にしてから渡す */
export interface IntentSources {
  prBody: string;
  ticket?: { body: string };
  parent?: { body: string };
  commits: CommitNote[];
}

export interface IntentInput extends IntentSources, Pick<LlmInput, 'hunks' | 'rippleGroups'> {
  /** 同じ変更の前回の意図。変わっていない差分の文を揃える（原則 7） */
  previous?: { intents: HunkIntent[] };
}

/** 未検証の出力。未知の from も読み、検証で推定に変える */
export interface IntentOutput {
  intents: Array<{
    hunkId: string;
    notes: Array<{ kind: 'written' | 'guess' | 'none'; text: string; from?: string; quote?: string; commit?: string }>;
    ask?: string;
  }>;
}
