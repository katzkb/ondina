// 作者の説明（設計書 3.1）のコードブロックの色。画面は本文を Markdown として描き、コードブロックを差分と同じ役割の色で出す。
// web は Shiki を持たない（原則 5）ので、analyze のときにフェンスを拾ってトークン化し Analysis.pr.bodyCode に持たせる。
// 画面との対応は「言語 + 中身」。フェンスの解釈は画面と同じ micromark（mdast-util-from-markdown）に任せる。
// 言語の無いフェンス・字下げのコード・Shiki が知らない言語は入れない（画面は色なしで出す）。
import type { Code, Parents, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { BodyCode } from '../model.js';
import { createTokenizer, type Tokenizer } from './tokenizer.js';

export async function bodyCodeTokens(body: string, opts: { tokenizer?: Tokenizer } = {}): Promise<BodyCode[]> {
  const fences = codeFences(body);
  if (fences.length === 0) return [];
  const { tokenizer } = opts;
  if (tokenizer === undefined) {
    const own = createTokenizer();
    try {
      return await bodyCodeTokens(body, { tokenizer: own });
    } finally {
      own.dispose();
    }
  }
  const out: BodyCode[] = [];
  const seen = new Set<string>();
  for (const { lang, value } of fences) {
    const key = `${lang}\n${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tokens = await tokenizer.tokenize(value, lang.toLowerCase());
    if (tokens !== undefined) out.push({ lang, code: value, tokens });
  }
  return out;
}

/** 言語の付いたフェンスを出現順に。字下げのコード（lang が無い）は落とす */
function codeFences(body: string): Array<Code & { lang: string }> {
  const out: Array<Code & { lang: string }> = [];
  const walk = (node: Parents | RootContent) => {
    if (node.type === 'code' && node.lang) out.push(node as Code & { lang: string });
    if ('children' in node) for (const child of node.children) walk(child);
  };
  walk(fromMarkdown(body));
  return out;
}
