// 説明の画面の「仕様」に出すチケットの本文（設計書 3.1。2026-10-12）。Analysis.pr.ticket の format で描き分ける:
//   - html: Jira が直した HTML。HTML として読む
//   - markdown: コマンドとファイル。作者の説明と同じ規則（GFM、生の HTML は GitHub と同じ規則で絞る）
//   - text: Jira が HTML を返さなかったときの元の本文。改行を保って文字のまま
// どれも作者の説明と同じ rehype-sanitize の既定で絞る。相対のリンクと画像はチケットのページ（url）を基準に絶対にする（Jira の HTML は /browse/… のように書く）。
import type { Ticket } from '@ondina/model';
import type { Nodes, Root } from 'hast';
import rehypeParse from 'rehype-parse';
import rehypeSanitize from 'rehype-sanitize';
import { unified } from 'unified';
import { authorBody } from './authorBody.js';

const html = unified().use(rehypeParse, { fragment: true }).use(rehypeSanitize);

export function ticketBody(t: Pick<Ticket, 'body' | 'format' | 'url'>): Root {
  const body = t.body ?? '';
  if (body === '') return { type: 'root', children: [] };
  if (t.format === 'text') return { type: 'root', children: [{ type: 'element', tagName: 'div', properties: { className: ['tkt-text'] }, children: [{ type: 'text', value: body }] }] };
  const tree = t.format === 'html' ? (html.runSync(html.parse(body)) as Root) : authorBody(body, []).tree;
  if (t.url !== undefined) absolutize(tree, t.url);
  return tree;
}

function absolutize(n: Nodes, base: string): void {
  if (n.type === 'element') {
    for (const attr of ['href', 'src'] as const) {
      const v = n.properties[attr];
      if (typeof v !== 'string') continue;
      try {
        n.properties[attr] = new URL(v, base).href;
      } catch {
        // URL にならない値はそのまま
      }
    }
  }
  if ('children' in n) for (const c of n.children) absolutize(c, base);
}
