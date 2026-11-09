// 要求の抜き出し（設計書 10.8。2026-10-12）の入出力の型。チケットから「この PR で成り立つべきこと」を抜き出させ、
// 要求ごとに対応する差分の ID を、1 回目（label/）の全入力から選ばせる。対応の有無と数はプログラムが決める（原則 3）。
// どちらも Analysis.json には入れない（入力はゴールデン、出力は .ondina/<key>/llm/<鍵>.spec.json に生のまま残す）。
import type { LlmInputGroup, LlmInputHunk } from '../label/types.js';

/** チケット。本文は文字（Jira の HTML はタグを外す。ticketPlainText） */
export interface SpecInputTicket {
  key?: string;
  title?: string;
  kind?: string;
  body: string;
  /** 本文が長すぎて SPEC_BODY_LIMIT 字で切ったとき */
  truncated?: true;
}

/** 前回の解析（同じ PR の直近の headSha）で同じチケットから抜き出した要求。文と対応を揃えるのに使う（原則 7） */
export interface SpecPrevious {
  specs: Array<{ text: string; hunkIds: string[] }>;
}

export interface SpecInput {
  ticket: SpecInputTicket;
  /** 親チケット（2026-10-29。Jira の親かエピック。5.1）。案件の目的の文を写させる。無ければ欄ごと無い */
  parent?: SpecInputTicket;
  /** 1 回目の入力と同じ形。全 hunk（追従の束の hunk は rippleGroups[] の代表と逸脱にだけ入る） */
  hunks: LlmInputHunk[];
  rippleGroups: LlmInputGroup[];
  previous?: SpecPrevious;
}

export interface SpecOutput {
  specs: Array<{ text: string; hunkIds: string[] }>;
  /** チケットの原文から写した「なぜこの変更をするか」の文（2026-10-29。説明タブの背景に出す） */
  why: string[];
  /** 親チケットの原文から写した「この案件の目的」の文（2026-10-29。説明タブの背景の「どんな案件の一部？」に出す） */
  parentWhy: string[];
}
