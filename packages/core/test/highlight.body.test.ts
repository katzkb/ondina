// 作者の説明（3.1）のコードブロックの色。画面は「言語 + 中身」で描いたブロックと対応させる。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyCodeTokens } from '../src/highlight/body.js';
import { createTokenizer, type Tokenizer } from '../src/highlight/tokenizer.js';

let tokenizer: Tokenizer;
const tok = () => (tokenizer ??= createTokenizer());

const lines = (tokens: Array<Array<[string, string | null, number]>>) => tokens.map((l) => l.map(([t]) => t).join(''));

describe('bodyCodeTokens', () => {
  it('フェンスの言語と中身（末尾の改行なし）と、行ごとの色を返す。連結すると中身の行になる', async () => {
    const body = '## 例\n\n```kotlin\nval x = 1\nfun f() = "a"\n```\n';
    const out = await bodyCodeTokens(body, { tokenizer: tok() });
    expect(out).toHaveLength(1);
    expect(out[0]!.lang).toBe('kotlin');
    expect(out[0]!.code).toBe('val x = 1\nfun f() = "a"');
    expect(lines(out[0]!.tokens)).toEqual(['val x = 1', 'fun f() = "a"']);
    expect(out[0]!.tokens.flat().some(([, role]) => role !== null)).toBe(true);
  });

  it('リストや引用の中のフェンスも拾う。情報文字列の 2 語目以降は言語に入れない', async () => {
    const body = '- 手順\n\n  ```sql title=x\n  select 1\n  ```\n\n> ```json\n> {"a": 1}\n> ```\n';
    const out = await bodyCodeTokens(body, { tokenizer: tok() });
    expect(out.map((c) => [c.lang, c.code])).toEqual([
      ['sql', 'select 1'],
      ['json', '{"a": 1}'],
    ]);
  });

  it('言語の無いフェンス・Shiki が知らない言語・字下げのコードは入れない', async () => {
    const body = '```\nplain\n```\n\n```nosuchlang\nx\n```\n\n    indented\n';
    expect(await bodyCodeTokens(body, { tokenizer: tok() })).toEqual([]);
  });

  it('言語名の大文字小文字は書いたまま返し、色は小文字の言語で付ける', async () => {
    const out = await bodyCodeTokens('```Kotlin\nval x = 1\n```\n', { tokenizer: tok() });
    expect(out.map((c) => c.lang)).toEqual(['Kotlin']);
    expect(out[0]!.tokens.flat().some(([, role]) => role !== null)).toBe(true);
  });

  it('同じ言語・同じ中身のブロックは 1 つにまとめる。mermaid も色を付ける（図にできないときに原文を出すため）', async () => {
    const body = '```mermaid\ngraph TD; A-->B\n```\n\n```mermaid\ngraph TD; A-->B\n```\n';
    const out = await bodyCodeTokens(body, { tokenizer: tok() });
    expect(out.map((c) => c.lang)).toEqual(['mermaid']);
  });

  it('空の本文と fixture の本文（コードブロック無し）は空', async () => {
    expect(await bodyCodeTokens('', { tokenizer: tok() })).toEqual([]);
    const body = readFileSync(new URL('../../../fixtures/order-service/pr-body.md', import.meta.url), 'utf8');
    expect(await bodyCodeTokens(body, { tokenizer: tok() })).toEqual([]);
  });
});
