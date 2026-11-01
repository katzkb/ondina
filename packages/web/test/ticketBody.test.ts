// 説明の画面の「仕様」に出すチケットの本文（設計書 3.1。2026-10-12）。書式ごとに描き、作者の説明と同じ規則で絞る
import type { Element, Nodes } from 'hast';
import { describe, expect, it } from 'vitest';
import { ticketBody } from '../src/ticketBody.js';

const URL_ = 'https://jira.example.com/jira/browse/SHOP-421';

function all(n: Nodes, tag: string): Element[] {
  const out: Element[] = [];
  const walk = (x: Nodes) => {
    if (x.type === 'element' && x.tagName === tag) out.push(x);
    if ('children' in x) x.children.forEach(walk);
  };
  walk(n);
  return out;
}
const text = (n: Nodes): string => (n.type === 'text' ? n.value : 'children' in n ? n.children.map(text).join('') : '');

describe('ticketBody', () => {
  it('html（Jira が直した本文）は HTML として読み、危ない要素と属性は落とす', () => {
    const t = ticketBody({ body: '<h4>背景</h4><p onclick="x()">春の<tt>SPRING10</tt></p><script>alert(1)</script>', format: 'html', url: URL_ });
    expect(all(t, 'h4').map(text)).toEqual(['背景']);
    expect(all(t, 'tt').map(text)).toEqual(['SPRING10']);
    expect(all(t, 'script')).toEqual([]);
    expect(all(t, 'p')[0]!.properties['onClick']).toBeUndefined();
  });

  it('相対のリンクと画像は、チケットのページを基準に絶対にする', () => {
    const t = ticketBody({ body: '<p><a href="/jira/browse/SHOP-400">SHOP-400</a><img src="/jira/secure/attachment/1/a.png" alt="a.png"></p>', format: 'html', url: URL_ });
    expect(all(t, 'a')[0]!.properties['href']).toBe('https://jira.example.com/jira/browse/SHOP-400');
    expect(all(t, 'img')[0]!.properties['src']).toBe('https://jira.example.com/jira/secure/attachment/1/a.png');
  });

  it('url が無ければ相対のまま', () => {
    const t = ticketBody({ body: '[次](./next.md)', format: 'markdown' });
    expect(all(t, 'a')[0]!.properties['href']).toBe('./next.md');
  });

  it('markdown（コマンドとファイル）は作者の説明と同じ規則で描く', () => {
    const t = ticketBody({ body: '## 背景\n\n- 割引コードを配る\n- [x] 済み\n\n<script>alert(1)</script>', format: 'markdown' });
    expect(all(t, 'h2').map(text)).toEqual(['背景']);
    expect(all(t, 'li')).toHaveLength(2);
    expect(all(t, 'script')).toEqual([]);
  });

  it('text は改行を保った 1 つの塊', () => {
    const t = ticketBody({ body: 'h4. 背景\n春の割引', format: 'text' });
    const div = all(t, 'div');
    expect(div).toHaveLength(1);
    expect(div[0]!.properties['className']).toEqual(['tkt-text']);
    expect(text(div[0]!)).toBe('h4. 背景\n春の割引');
  });

  it('本文が無ければ空', () => {
    expect(ticketBody({}).children).toEqual([]);
  });
});
