// 案内人に聞く（設計書 10.5）の答えの検証。全部プログラムで決める（原則 3）。
// - 行の場所は材料に出した行（h12 / b6 の番号）だけ採る。無ければ場所を外し、項目に unverified の印を付ける（画面に「場所を確かめられない」と出す。近似の破綻を黙って隠さない）
// - バッククォートは剥がす（画面は Markdown を描かない。2026-10-08 に測った答えは識別子をバッククォートで囲んでいた）
// - 文の中に漏れた材料の番号（h10 / b6）は「10 行目」「base 側 6 行目」に直す（2026-10-08 に実物で「作者に聞くなら h10 を指す」が出た。読む人は番号の読み方を知らない）
// - ネットのページは http / https の URL だけ採る（画面がリンクにする）。読めなければページを外して出典なし（known）にする（中身が本当にそう書いてあるかは確かめられない。画面で開いて読む）
import type { AskAnswer, AskCite, AskWeb } from '../model.js';
import type { AskInput, AskInputLines, AskOutput } from './types.js';

const LINE = /^([hb])(\d+) /;

/** 材料に出した行の場所の集合（path\0side\0line） */
function materialLines(input: AskInput): Set<string> {
  const p = input.place;
  const blocks: AskInputLines[] = p.kind === 'pr' ? p.hunks : p.kind === 'course' ? p.stops : [...(p.file ? [{ path: p.path, lines: p.file }] : []), ...p.hunks, ...p.related, ...(p.selected ? [p.selected] : [])];
  const out = new Set<string>();
  for (const b of blocks) {
    for (const l of b.lines) {
      const m = LINE.exec(l);
      if (m) out.add(`${b.path}\0${m[1] === 'h' ? 'head' : 'base'}\0${m[2]}`);
    }
  }
  return out;
}

/** 材料の番号。後ろの空白は、次が日本語なら一緒に詰める（「h10 の」→「10 行目の」） */
const TAG = /(?<![A-Za-z0-9_])([hb])(\d+)(?![A-Za-z0-9_])(?: (?=[^\x00-\x7F]))?/g;
const plain = (s: string): string => s.replace(/`/g, '').replace(TAG, (_, side: string, n: string) => (side === 'b' ? `base 側 ${n} 行目` : `${n} 行目`));

function web(w: NonNullable<AskOutput['items'][number]['web']>): AskWeb | null {
  let u: URL;
  try {
    u = new URL(w.url);
  } catch {
    return null;
  }
  return u.protocol === 'http:' || u.protocol === 'https:' ? { url: w.url, title: w.title.replace(/`/g, '').trim() } : null;
}

export function verifyAskAnswer(output: AskOutput, input: AskInput): AskAnswer {
  const known = materialLines(input);
  const has = (path: string, side: string, line: number) => known.has(`${path}\0${side}\0${line}`);
  const cite = (c: NonNullable<AskOutput['items'][number]['cite']>): AskCite | null => {
    if ((c.side !== 'head' && c.side !== 'base') || c.line === null || !has(c.path, c.side, c.line)) return null;
    const end = c.endLine ?? null;
    if (end === null || end <= c.line) return { path: c.path, side: c.side, line: c.line };
    return has(c.path, c.side, end) ? { path: c.path, side: c.side, line: c.line, endLine: end } : null;
  };
  const items = output.items.map((it): AskAnswer['items'][number] => {
    const text = plain(it.text);
    const c = it.cite === undefined ? undefined : cite(it.cite);
    const w = it.web === undefined ? undefined : web(it.web);
    // 出典なしは、行の場所を書かず、読めるページも無い事実だけ（ページが読めなかった事実もここに入る）
    const known = it.cite === undefined && !w && (it.known === true || w === null);
    return { text, ...(c ? { cite: c } : c === null ? { unverified: true as const } : {}), ...(w ? { web: w } : {}), ...(known ? { known: true as const } : {}) };
  });
  const tail = plain(output.tail ?? '').trim();
  return { lead: plain(output.lead), items, ...(tail === '' ? {} : { tail }) };
}
