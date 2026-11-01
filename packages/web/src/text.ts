// 文の見せ方（設計書 3.1。承認したデモ）: 長い段落を句点で切って 1 文 1 行にする。括弧の中の句点では切らない。
const OPEN = new Set(['（', '(', '「', '『']);
const CLOSE = new Set(['）', ')', '」', '』']);

export function sentences(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    cur += ch;
    if (OPEN.has(ch)) depth++;
    else if (CLOSE.has(ch)) depth = Math.max(0, depth - 1);
    else if (ch === '。' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}
