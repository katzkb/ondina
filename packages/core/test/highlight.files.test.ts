// head 側の全文（3.3 の実物の画面）。どのファイルを入れるかと、トークン化の形。
import { describe, expect, it } from 'vitest';
import { headFileSources, headFileTokens } from '../src/highlight/files.js';
import { createTokenizer, type Tokenizer } from '../src/highlight/tokenizer.js';
import type { ChangedFile } from '../src/hunks/extract.js';

let tokenizer: Tokenizer;
const tok = () => (tokenizer ??= createTokenizer());

const text = (lines: Array<Array<[string, string | null, number]>>) => lines.map((l) => l.map(([t]) => t).join(''));

describe('headFileSources', () => {
  const files: ChangedFile[] = [
    { path: 'b/Order.kt', before: 'x\n', after: 'y\n' },
    { path: 'a/Gone.kt', before: 'x\n', after: null },
    { path: 'a/New.kt', before: null, after: 'n\n' },
  ];

  it('差分のあるファイル（削除を除く）と Symbol.path のファイルを path 順に 1 回ずつ。差分の無いファイルは head から読む', () => {
    const read: string[] = [];
    const out = headFileSources(files, [{ path: 'c/Policy.kt' }, { path: 'b/Order.kt' }, { path: 'c/Policy.kt' }], (rel) => {
      read.push(rel);
      return `// ${rel}\n`;
    });
    expect(out).toEqual([
      { path: 'a/New.kt', text: 'n\n' },
      { path: 'b/Order.kt', text: 'y\n' },
      { path: 'c/Policy.kt', text: '// c/Policy.kt\n' },
    ]);
    expect(read).toEqual(['c/Policy.kt']);
  });

  it('head に無いファイル（読めない）は入れない', () => {
    expect(headFileSources([], [{ path: 'x/Missing.kt' }], () => undefined)).toEqual([]);
  });
});

describe('headFileTokens', () => {
  it('行ごとのトークンを連結すると本文の行になる。末尾の改行で空の行を足さない', async () => {
    const src = 'class A {\n    fun f() = 1\n}\n';
    const [file] = await headFileTokens([{ path: 'A.kt', text: src }], { tokenizer: tok() });
    expect(file!.path).toBe('A.kt');
    expect(text(file!.tokens)).toEqual(['class A {', '    fun f() = 1', '}']);
    expect(file!.tokens[0]!.some(([t, role]) => t === 'class' && role === 'mauve')).toBe(true);
  });

  it('Shiki が知らない言語は色なし 1 トークンの行で入れる（ファイルを見せないより良い）', async () => {
    const [file] = await headFileTokens([{ path: 'notes.unknownext', text: 'a\nb' }], { tokenizer: tok() });
    expect(file!.tokens).toEqual([[['a', null, 0]], [['b', null, 0]]]);
  });
});
