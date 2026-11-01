// 説明の画面の「作者の説明」（設計書 3.1）: 原文を Markdown として描き（GitHub と同じ規則）、裏付けのない文（claims の backed: false）に描いた後の文字でマーカーを打つ。
// マーカーの位置は原文の offset で取る（claim は LLM が原文から写すので Markdown の記号を含む）。画面に 1 文字も出せなかった文は unmatched（2026-10-10）。
import type { BodyCode, Claim } from '@ondina/model';
import { render } from '@testing-library/react';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { describe, expect, it } from 'vitest';
import { authorBody } from '../src/authorBody.js';
import { fixtureAnalysis } from './fixture.js';

const claim = (text: string, backed = false, reason = ''): Claim => ({ text, backed, reason });

function draw(body: string, claims: readonly Claim[] = [], code: readonly BodyCode[] = []) {
  const out = authorBody(body, claims, code);
  const { container } = render(<div>{toJsxRuntime(out.tree, { Fragment, jsx, jsxs })}</div>);
  return { ...out, root: container.firstElementChild as HTMLElement };
}

const marks = (root: HTMLElement) => [...root.querySelectorAll('mark')].map((m) => m.textContent);

describe('authorBody（描き方）', () => {
  it('fixture の本文: 見出し・リスト・インラインコードが要素になり、## やバッククォートは文字として出ない', () => {
    const { root } = draw(fixtureAnalysis().pr.body!);
    expect([...root.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['概要', '変更点']);
    expect(root.querySelectorAll('ul > li')).toHaveLength(6);
    expect(root.querySelector('li code')?.textContent).toBe('Order.getDiscount()');
    expect(root.textContent).not.toContain('##');
    expect(root.textContent).not.toContain('`');
  });

  it('表・タスクリスト・取り消し線・引用・リンク（GFM）', () => {
    const { root } = draw('| a | b |\n|---|---|\n| 1 | **2** |\n\n- [x] 済み\n- [ ] まだ\n\n~~旧~~\n\n> 引用 [設計](https://example.com/d)\n');
    expect(root.querySelectorAll('table tbody tr')).toHaveLength(1);
    expect(root.querySelector('td strong')?.textContent).toBe('2');
    expect([...root.querySelectorAll('input[type=checkbox]')].map((i) => (i as HTMLInputElement).checked)).toEqual([true, false]);
    expect(root.querySelector('del')?.textContent).toBe('旧');
    expect(root.querySelector('blockquote a')?.getAttribute('href')).toBe('https://example.com/d');
  });

  it('HTML のコメント（PR テンプレートの書き方の案内）は出さない。<script> と javascript: のリンクは落とし、<details> は出す', () => {
    const { root } = draw('<!-- 変更の理由を書く -->\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n<details><summary>ログ</summary>\n\n本文\n\n</details>\n');
    expect(root.textContent).not.toContain('変更の理由を書く');
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('a')?.getAttribute('href') ?? null).toBeNull();
    expect(root.querySelector('details summary')?.textContent).toBe('ログ');
  });
});

describe('authorBody（マーカー）', () => {
  it('fixture: 裏付け無しの 2 文にマーカー。コードを含む文は 1 つの mark が code ごと包む', () => {
    const a = fixtureAnalysis();
    const { root, marked, unmatched } = draw(a.pr.body!, a.claims);
    expect(marks(root)).toEqual(['Order が割引額を自分で持ち、計算をドメインに閉じる。', 'キャッシュ層を横断的に更新し、割引後の合計が古い値で返らないようにした']);
    expect(root.querySelector('mark > code')?.textContent).toBe('Order');
    expect(marked.map((c) => c.text)).toEqual(['`Order` が割引額を自分で持ち、計算をドメインに閉じる。', 'キャッシュ層を横断的に更新し、割引後の合計が古い値で返らないようにした']);
    expect(unmatched).toEqual([]);
  });

  it('文の途中から途中までの claim は、その部分だけ包む。前後の文字は元のまま', () => {
    const { root } = draw('前の文。**真ん中**の文。後の文。', [claim('**真ん中**の文。')]);
    expect(marks(root)).toEqual(['真ん中の文。']);
    expect(root.querySelector('mark > strong')?.textContent).toBe('真ん中');
    expect(root.textContent).toBe('前の文。真ん中の文。後の文。');
  });

  it('文の途中で切れる claim は、文字の単位で割る', () => {
    const { root } = draw('キャッシュ層を横断的に更新した', [claim('横断的に')]);
    expect(marks(root)).toEqual(['横断的に']);
    expect(root.textContent).toBe('キャッシュ層を横断的に更新した');
  });

  it('タスクリストの本文とコードブロックの中の claim にも付く', () => {
    const { root, unmatched } = draw('- [x] ステージングで試した\n\n```kotlin\nval cache = 1\n```\n', [claim('ステージングで試した'), claim('val cache = 1')]);
    expect(marks(root)).toEqual(['ステージングで試した', 'val cache = 1']);
    expect(unmatched).toEqual([]);
  });

  it('\\* や &amp; を含む claim は、描いた後の * や & に付く', () => {
    const { root } = draw('前 a \\* b &amp; c 後', [claim('a \\* b &amp; c')]);
    expect(marks(root)).toEqual(['a * b & c']);
  });

  it('段落をまたぐ claim は段落ごとに mark が分かれ、段落そのものは包まない', () => {
    const { root, marked } = draw('一つ目。\n\n二つ目。', [claim('一つ目。\n\n二つ目。')]);
    expect(marks(root)).toEqual(['一つ目。', '二つ目。']);
    expect(root.querySelector('mark p')).toBeNull();
    expect(marked).toHaveLength(1);
  });

  it('コメントの中の claim は画面に出ないので unmatched に回す', () => {
    const c = claim('理由を書く');
    const { root, marked, unmatched } = draw('<!-- 理由を書く -->\n\n本文', [c]);
    expect(marks(root)).toEqual([]);
    expect(marked).toEqual([]);
    expect(unmatched).toEqual([c]);
  });

  it('本文に無い文・重なって後に回った文は unmatched（claims の順）。backed: true の文は探さない', () => {
    const none = claim('無い文');
    const ab = claim('ab');
    const bc = claim('bc');
    const { root, unmatched } = draw('abc と d', [claim('d', true), none, ab, bc]);
    expect(marks(root)).toEqual(['ab']);
    expect(unmatched).toEqual([none, bc]);
  });
});

describe('authorBody（コードブロック）', () => {
  const kotlin: BodyCode = { lang: 'kotlin', code: 'val x = 1\nfun f()', tokens: [[['val', 'mauve', 0], [' x = ', null, 0], ['1', 'peach', 0]], [['fun', 'mauve', 0], [' f()', null, 0]]] };

  it('言語と中身が bodyCode と同じブロックは、差分と同じ役割の色（c-<役割>）で描く', () => {
    const { root } = draw('```kotlin\nval x = 1\nfun f()\n```\n', [], [kotlin]);
    const code = root.querySelector('pre > code')!;
    expect([...code.querySelectorAll('.c-mauve')].map((s) => s.textContent)).toEqual(['val', 'fun']);
    expect(code.querySelector('.c-peach')?.textContent).toBe('1');
    expect(code.textContent).toBe('val x = 1\nfun f()\n');
  });

  it('bodyCode に無いブロック（古い解析・知らない言語）は色なし', () => {
    const { root } = draw('```kotlin\nval y = 2\n```\n', [], [kotlin]);
    expect(root.querySelector('pre > code')?.textContent).toBe('val y = 2\n');
    expect(root.querySelector('pre span')).toBeNull();
  });

  it('マーカーの入ったブロックはマーカーを優先して色なし', () => {
    const { root } = draw('```kotlin\nval x = 1\nfun f()\n```\n', [claim('fun f()')], [kotlin]);
    expect(marks(root)).toEqual(['fun f()']);
    expect(root.querySelector('pre .c-mauve')).toBeNull();
  });

  it('mermaid のブロックは pre に data-mermaid（図の原文）を付ける。マーカーが入れば付けない', () => {
    const src = '```mermaid\ngraph TD\n  A-->B\n```\n';
    expect(draw(src).root.querySelector('pre')?.getAttribute('data-mermaid')).toBe('graph TD\n  A-->B');
    expect(draw(src, [claim('A-->B')]).root.querySelector('pre')?.hasAttribute('data-mermaid')).toBe(false);
  });
});
