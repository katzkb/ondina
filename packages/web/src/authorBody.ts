// 説明の画面の「作者の説明」（設計書 3.1）。原文（pr.body）を Markdown として描き、裏付けのない文（claims の backed: false）にマーカーを打つ。
// 描き方は GitHub に合わせる: GFM（表・タスクリスト・取り消し線・自動リンク）、生の HTML は GitHub と同じ規則（rehype-sanitize の既定）で絞る。コメントは出さない。
// マーカーは描いた後の木（hast）に打つ。claim の範囲は原文の offset（markClaims）で、木の文字ノードが持つ原文の位置と突き合わせる:
//   - 範囲に丸ごと入るインライン要素（code・strong・a など）と文字は、続けて 1 つの <mark> で包む。段落・リスト・表などのブロックは包まず中に入る
//   - 範囲の境目にかかる文字ノードは、値の 1 文字ずつを原文の中で順に探して位置に戻し、文字の単位で割る（`code`・\*・&amp; は値と原文がずれる）
//   - 位置を持たない文字ノード（タスクリストの本文、コードブロックの中身）は、位置を持つ祖先の範囲で原文を探して補う
// 原文には見つかったのに画面に 1 文字も出せなかった文（コメントの中など）は unmatched に回す（マーカーが黙って消えないように。2026-10-10）。
// コードブロックは analyze が付けた色（pr.bodyCode。言語 + 中身で対応）で描く。マーカーの入ったブロックは色なし。mermaid は pre に data-mermaid を付け、画面が図にする。
import type { BodyCode, Claim, TokenLine } from '@ondina/model';
import type { Element, ElementContent, Nodes, Root, Text } from 'hast';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { markClaims } from './claims.js';

export interface AuthorBody {
  tree: Root;
  /** マーカーを打てた文（画面に出た順） */
  marked: Claim[];
  /** backed: false のうち、本文に見つからなかった文と画面に出せなかった文（claims の順） */
  unmatched: Claim[];
}

interface Range {
  start: number;
  end: number;
  claim: Claim;
}

/** 包まずに中へ入る要素（ブロック）。それ以外はインラインとして <mark> で包める */
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'dd', 'dt', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize);

export function authorBody(body: string, claims: readonly Claim[], code: readonly BodyCode[] = []): AuthorBody {
  const tree = processor.runSync(processor.parse(body)) as Root;

  const { segments, unmatched } = markClaims(body, claims);
  const ranges: Range[] = [];
  let at = 0;
  for (const s of segments) {
    if (s.claim) ranges.push({ start: at, end: at + s.text.length, claim: s.claim });
    at += s.text.length;
  }

  const spans = new WeakMap<Nodes, [number, number]>();
  fillSpans(tree, body, spans);
  const marked: Claim[] = [];
  if (ranges.length > 0) markChildren(tree, { body, ranges, spans, hit: (c) => marked.includes(c) || marked.push(c) });
  colorCode(tree, code);

  const order = new Map(claims.map((c, i) => [c, i]));
  const lost = ranges.map((r) => r.claim).filter((c) => !marked.includes(c));
  return { tree, marked, unmatched: [...unmatched, ...lost].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) };
}

/** 原文の位置 [start, end) を全ノードに。位置の無い文字ノードは、祖先の範囲の中で値をそのまま探して補う */
function fillSpans(node: Root | Element, body: string, spans: WeakMap<Nodes, [number, number]>) {
  const own = spanOf(node);
  if (own) spans.set(node, own);
  const range = spans.get(node);
  let cursor = range?.[0] ?? 0;
  for (const child of node.children) {
    const s = spanOf(child);
    if (s) {
      spans.set(child, s);
      cursor = s[1];
    } else if (child.type === 'text' && range && child.value.trim() !== '') {
      const i = body.indexOf(child.value, cursor);
      if (i >= 0 && i + child.value.length <= range[1]) {
        spans.set(child, [i, i + child.value.length]);
        cursor = i + child.value.length;
      }
    }
    if (child.type === 'element') {
      if (!s && range) spans.set(child, [cursor, range[1]]);
      fillSpans(child, body, spans);
    }
  }
}

const spanOf = (n: Nodes): [number, number] | undefined => {
  const s = n.position?.start.offset;
  const e = n.position?.end.offset;
  return s === undefined || e === undefined ? undefined : [s, e];
};

interface MarkContext {
  body: string;
  ranges: Range[];
  spans: WeakMap<Nodes, [number, number]>;
  hit: (claim: Claim) => void;
}

function markChildren(parent: Root | Element, ctx: MarkContext) {
  const out: ElementContent[] = [];
  let group: { claim: Claim; nodes: ElementContent[] } | undefined;
  const flush = () => {
    if (group) out.push({ type: 'element', tagName: 'mark', properties: {}, children: group.nodes });
    group = undefined;
  };
  const add = (node: ElementContent, claim: Claim | undefined) => {
    if (!claim) {
      flush();
      out.push(node);
      return;
    }
    if (group?.claim !== claim) {
      flush();
      group = { claim, nodes: [] };
    }
    group.nodes.push(node);
    ctx.hit(claim);
  };

  for (const child of parent.children as ElementContent[]) {
    const span = ctx.spans.get(child);
    if (child.type === 'text') {
      for (const piece of splitText(child, span, ctx)) add(piece.node, piece.claim);
      continue;
    }
    if (child.type === 'element') {
      const covering = span && ctx.ranges.find((r) => r.start <= span[0] && span[1] <= r.end);
      if (covering && !BLOCK.has(child.tagName) && child.position !== undefined) {
        add(child, covering.claim);
        continue;
      }
      if (span === undefined || ctx.ranges.some((r) => r.start < span[1] && span[0] < r.end)) markChildren(child, ctx);
    }
    add(child, undefined);
  }
  flush();
  parent.children = out as Root['children'];
}

/** 文字ノードを claim の範囲で割る。値と原文の対応が取れなければ、丸ごと範囲に入るときだけ包む */
function splitText(node: Text, span: [number, number] | undefined, ctx: MarkContext): Array<{ node: Text; claim?: Claim }> {
  if (!span || !ctx.ranges.some((r) => r.start < span[1] && span[0] < r.end)) return [{ node }];
  const map = charOffsets(node.value, ctx.body, span);
  if (!map) {
    const covering = ctx.ranges.find((r) => r.start <= span[0] && span[1] <= r.end);
    return [covering ? { node, claim: covering.claim } : { node }];
  }
  const claimAt = (i: number) => ctx.ranges.find((r) => r.start <= map[i]! && map[i]! < r.end)?.claim;
  const pieces: Array<{ node: Text; claim?: Claim }> = [];
  let from = 0;
  let current = claimAt(0);
  for (let i = 1; i <= node.value.length; i++) {
    const c = i < node.value.length ? claimAt(i) : undefined;
    if (i < node.value.length && c === current) continue;
    const text: Text = { type: 'text', value: node.value.slice(from, i) };
    pieces.push(current ? { node: text, claim: current } : { node: text });
    from = i;
    current = c;
  }
  return pieces;
}

/** 値の i 文字目が原文のどこか。値の文字を原文の範囲の中で順に探す（記号・実体参照・字下げを飛ばす）。見つからなければ undefined */
function charOffsets(value: string, body: string, [start, end]: [number, number]): number[] | undefined {
  const src = body.slice(start, end);
  if (src === value) return Array.from(value, (_, i) => start + i);
  const map: number[] = [];
  let j = 0;
  for (let i = 0; i < value.length; i++) {
    while (j < src.length && src[j] !== value[i]) j++;
    if (j >= src.length) return undefined;
    map.push(start + j++);
  }
  return map;
}

/** pre > code に analyze の色を付ける。mermaid は pre に図の原文を持たせる。マーカーの入ったブロックは触らない */
function colorCode(node: Root | Element, code: readonly BodyCode[]) {
  for (const child of node.children) {
    if (child.type !== 'element') continue;
    if (child.tagName !== 'pre') {
      colorCode(child, code);
      continue;
    }
    const inner = child.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
    if (!inner || contains(inner, 'mark')) continue;
    const lang = langOf(inner);
    if (lang === undefined) continue;
    const text = textOf(inner).replace(/\n$/, '');
    if (lang.toLowerCase() === 'mermaid') child.properties = { ...child.properties, dataMermaid: text };
    const found = code.find((c) => c.lang === lang && c.code === text);
    if (found) inner.children = [...tokenNodes(found.tokens), { type: 'text', value: '\n' }];
  }
}

/** 1 行ごとに役割の色の span。行の間は改行の文字（TokenSpans と同じ c-<役割>） */
function tokenNodes(lines: readonly TokenLine[]): ElementContent[] {
  return lines.flatMap((line, i) => [
    ...(i === 0 ? [] : [{ type: 'text', value: '\n' } satisfies Text]),
    ...line.map(([text, role]): ElementContent => (role ? { type: 'element', tagName: 'span', properties: { className: [`c-${role}`] }, children: [{ type: 'text', value: text }] } : { type: 'text', value: text })),
  ]);
}

function langOf(code: Element): string | undefined {
  const cls = code.properties['className'];
  const list = Array.isArray(cls) ? cls : [];
  const hit = list.find((c): c is string => typeof c === 'string' && c.startsWith('language-'));
  return hit?.slice('language-'.length);
}

const textOf = (n: ElementContent): string => (n.type === 'text' ? n.value : n.type === 'element' ? n.children.map(textOf).join('') : '');

const contains = (n: Element, tag: string): boolean => n.children.some((c) => c.type === 'element' && (c.tagName === tag || contains(c, tag)));
