// 要求の抜き出し（設計書 10.8）の出力の検証（Stage 3。設計書 5.4 の 7）。全部プログラムで決める（原則 3）。
// 捨てたものは info に 1 行ずつ（黙って直さない）。最後の行は件数（対応の有無はプログラムが数える）。
// 規則:
//   1. 文は前後の空白と末尾の句点を落とす（画面はリスト）。空の文は捨てる。同じ文は最初だけ
//   2. MAX_SPECS 個まで。超えた分は捨てる
//   3. hunkIds は入力で選べる差分の ID だけ。重複を除き hunk の入力順にする。不明な ID は知らせて除外する
//      hows は選んだ hunk.hows から導く（昇順）。束への割当も 1 回目の検証で代表の hunk.hows に入っている
//   4. id は残った並び順に s1, s2 …。How の specIds は specs から逆に引く
//   5. なぜの文（2026-10-29）は前後の空白を落とし、チケットの本文に含まれる物だけ残す（空白と Markdown の強調・コードの記号は無視して比べる）。
//      空の文・同じ文（比べ方は本文と同じ）は捨てる。MAX_WHY 個まで。言い換えた文を「原文」として画面に出さないため
//   6. 親チケットの文（2026-10-29）も 5 と同じ規則で、親チケットの本文に含まれる物だけ残す（親が無ければ全部捨てる）
import type { How, Hunk, Spec } from '../model.js';
import { MAX_WHY } from './schema.js';
import type { SpecOutput } from './types.js';

/** 要求の個数の上限。プロンプトにも書いてある */
export const MAX_SPECS = 10;

export interface SpecResult {
  specs: Spec[];
  /** チケットの原文にある「なぜ」の文 */
  why: string[];
  /** 親チケットの原文にある「この案件の目的」の文 */
  parentWhy: string[];
  /** specIds を埋めた How */
  hows: How[];
  info: string[];
}

export function applySpecs(hows: readonly How[], hunks: readonly Hunk[], output: SpecOutput, ticketBody: string, parentBody = ''): SpecResult {
  const info: string[] = [];
  const known = new Set(hunks.filter((h) => h.group === undefined || h.group.representative === h.id || h.group.deviations.includes(h.id)).map((h) => h.id));
  const knownHows = new Set(hows.map((h) => h.id));
  const seen = new Set<string>();
  const kept: SpecOutput['specs'] = [];
  for (const s of output.specs) {
    const text = s.text.trim().replace(/。+$/, '').trim();
    if (text === '') {
      info.push('空の要求を除外しました');
      continue;
    }
    if (seen.has(text)) {
      info.push(`同じ要求が 2 回来たので最初だけ使いました: ${text}`);
      continue;
    }
    seen.add(text);
    kept.push({ text, hunkIds: s.hunkIds });
  }
  if (kept.length > MAX_SPECS) {
    info.push(`要求が ${MAX_SPECS} 個を超えたので、${MAX_SPECS + 1} 個目から除外しました（${kept.length - MAX_SPECS} 個）`);
    kept.length = MAX_SPECS;
  }

  const specs = kept.map((s, i): Spec => {
    const unknown = [...new Set(s.hunkIds.filter((id) => !known.has(id)))];
    if (unknown.length > 0) info.push(`要求 ${i + 1} の対応に不明な差分の ID（${unknown.join('、')}）があったので除外しました`);
    const chosen = new Set(s.hunkIds.filter((id) => known.has(id)));
    const selected = hunks.filter((h) => chosen.has(h.id));
    const howIds = selected.flatMap((h) => h.hows);
    return { id: `s${i + 1}`, text: s.text, hunkIds: selected.map((h) => h.id), hows: [...new Set(howIds.filter((id) => knownHows.has(id)))].sort((a, b) => a - b) };
  });
  info.push(`要求: ${specs.length} 件（対応する差分があるもの ${specs.filter((s) => s.hunkIds.length > 0).length} 件）`);
  const why = verifyQuotes(output.why, ticketBody, info, { missing: 'チケットの本文にない「なぜ」の文', many: '「なぜ」の文' });
  const parentWhy = verifyQuotes(output.parentWhy, parentBody, info, { missing: '親チケットの本文にない文', many: '親チケットの文' });
  return { specs, why, parentWhy, hows: hows.map((h) => ({ ...h, specIds: specs.filter((s) => s.hows.includes(h.id)).map((s) => s.id) })), info };
}

/** 比べるときは空白と、Markdown の強調・コードの記号を落とす */
const bare = (t: string): string => t.replace(/[\s`*_]+/g, '');

/** 引用が原文にあるか。空白と Markdown の強調・コードの記号を除いて比べる */
export function quoteInSource(quote: string, source: string): boolean {
  return bare(source).includes(bare(quote));
}

/** 規則 5 / 6。words は知らせの文の主語 */
function verifyQuotes(why: readonly string[], source: string, info: string[], words: { missing: string; many: string }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of why) {
    const text = w.trim();
    if (text === '' || seen.has(bare(text))) continue;
    seen.add(bare(text));
    if (!quoteInSource(text, source)) {
      info.push(`${words.missing}を除外しました: ${text}`);
      continue;
    }
    out.push(text);
  }
  if (out.length > MAX_WHY) info.push(`${words.many}が ${MAX_WHY} 個を超えたので、${MAX_WHY + 1} 個目から除外しました`);
  return out.slice(0, MAX_WHY);
}
