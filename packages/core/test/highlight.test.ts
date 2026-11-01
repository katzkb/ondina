// Shiki 字句ハイライト。設計書 7 章。トークンには色ではなく役割名（Catppuccin パレットの色名）を持たせる。
import { describe, expect, it } from 'vitest';
import { createTokenizer, type Tokenizer } from '../src/highlight/tokenizer.js';
import { attachTokens, hunkTokenLines } from '../src/highlight/attach.js';
import { extractHunks, type ChangedFile } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import type { TokenLine } from '../src/model.js';

let tokenizer: Tokenizer;
const tok = () => (tokenizer ??= createTokenizer());

/** 役割ごとに、その役割を持つトークンの文字列を集める */
function byRole(lines: Array<Array<[string, string | null, number]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of lines) for (const [text, role] of line) (out[role ?? 'null'] ??= []).push(text);
  return out;
}

describe('tokenize（7.1 の字句レベルで決まる対応）', () => {
  const code = 'class Order(val id: OrderId) {\n    fun total(): Money = subtotal - 1000 + "s" // note\n}\n';

  it('1 行が 1 要素の TokenLine[] で、各行のトークンを結合すると元の行になる', async () => {
    const lines = (await tok().tokenize(code, 'kotlin'))!;
    expect(lines.map((l) => l.map(([t]) => t).join(''))).toEqual(code.split('\n'));
  });

  it('キーワード=mauve、型宣言=yellow italic、関数名=blue italic、演算子=teal、数値=peach、文字列=green、コメント=overlay2 italic', async () => {
    const lines = (await tok().tokenize(code, 'kotlin'))!;
    const roles = byRole(lines);
    expect(roles['mauve']).toEqual(['class', 'val', 'fun']);
    expect(roles['yellow']).toEqual(['Order', 'OrderId', 'Money']);
    expect(roles['blue']).toEqual(['total']);
    expect(roles['teal']).toEqual(['=', '-', '+']);
    expect(roles['peach']).toEqual(['1000']);
    expect(roles['green']).toEqual(['"s"']);
    expect(roles['overlay2']).toEqual(['// note']);
    const style = Object.fromEntries(lines.flat().map(([t, , s]) => [t, s]));
    expect(style['Order']).toBe(1);
    expect(style['total']).toBe(1);
    expect(style['// note']).toBe(1);
    expect(style['class']).toBe(0);
  });

  it('テーマ既定の前景色（text）のトークンは role null（継承色）', async () => {
    const lines = (await tok().tokenize(code, 'kotlin'))!;
    const roles = byRole(lines);
    expect(roles['text']).toBeUndefined();
    expect(roles['null']).toContain(' id: ');
  });

  it('複数行ブロックコメントは後続行も overlay2 のまま（ファイル全体を 1 回で処理する理由）', async () => {
    const lines = (await tok().tokenize('/* a\n   b */ val x = 1\n', 'kotlin'))!;
    expect(lines[1]?.[0]).toEqual(['   b */', 'overlay2', 1]);
  });

  it('SQL も同じ役割名で出る', async () => {
    const lines = (await tok().tokenize('ALTER TABLE orders ADD COLUMN discount BIGINT NOT NULL DEFAULT 0;\n', 'sql'))!;
    const roles = byRole(lines);
    expect(roles['mauve']).toContain('ALTER');
    expect(roles['peach']).toEqual(['0']);
  });

  // 毎回新しい Tokenizer で 60 前後の文法を読む（vue → markdown → …）ので既定の 5 秒では足りない
  describe('埋め込み言語（Vue の <style lang="scss"> など）', { timeout: 30_000 }, () => {
    const vue = '<template lang="pug">\ndiv.price {{ label }}\n</template>\n<style lang="scss">\n$c: red;\n.price { color: $c; }\n</style>\n';

    it('Shiki が後から読む約束にしている埋め込み言語も、親の言語と一緒に読んで色を付ける', async () => {
      const t = createTokenizer();
      try {
        const lines = (await t.tokenize(vue, 'vue'))!;
        expect(lines.map((l) => l.map(([s]) => s).join(''))).toEqual(vue.split('\n'));
        const colored = (i: number) => lines[i]!.filter(([, role]) => role !== null).length;
        expect(colored(1)).toBeGreaterThan(0); // pug
        expect(colored(4)).toBeGreaterThan(0); // scss
        expect(colored(5)).toBeGreaterThan(0); // scss
      } finally {
        t.dispose();
      }
    });

    it('先に同じ埋め込み言語のファイルを処理したかどうかで結果が変わらない', async () => {
      const a = createTokenizer();
      const b = createTokenizer();
      try {
        await b.tokenize('$c: red;\n', 'scss');
        await b.tokenize('div\n', 'pug');
        expect(await a.tokenize(vue, 'vue')).toEqual(await b.tokenize(vue, 'vue'));
      } finally {
        a.dispose();
        b.dispose();
      }
    });

    it('埋め込み言語がさらに後から読む言語も辿る（markdown → pug → stylus。markdown の一覧に stylus は無い）', async () => {
      const md = '```pug\ndiv\n  :stylus\n    .a\n      color red\n```\n';
      const a = createTokenizer();
      const b = createTokenizer();
      try {
        await b.tokenize('.a\n  color red\n', 'stylus');
        const lines = (await a.tokenize(md, 'markdown'))!;
        expect(lines[3]!.filter(([, role]) => role !== null).length).toBeGreaterThan(0);
        expect(lines).toEqual(await b.tokenize(md, 'markdown'));
      } finally {
        a.dispose();
        b.dispose();
      }
    });

    it('Markdown のフェンスの中も色が付く（Shiki の markdown 文法が知っている言語のフェンス。kotlin は入っていない）', async () => {
      const t = createTokenizer();
      try {
        const lines = (await t.tokenize('# a\n\n```ts\nconst x = 1\n```\n', 'markdown'))!;
        expect(lines[3]!.some(([s, role]) => s === 'const' && role === 'mauve')).toBe(true);
      } finally {
        t.dispose();
      }
    });
  });

  it('Shiki が知らない言語は undefined（tokens を付けない）', async () => {
    expect(await tok().tokenize('hello\n', 'no-such-lang')).toBeUndefined();
    expect(await tok().tokenize('hello\n', 'text')).toBeUndefined();
  });

  it('dispose() で Shiki を解放でき、その後に呼べば作り直す', async () => {
    const t = createTokenizer();
    t.dispose(); // 何も作っていなければ no-op
    const first = await t.tokenize(code, 'kotlin');
    t.dispose();
    expect(await t.tokenize(code, 'kotlin')).toEqual(first);
    t.dispose();
  });

  it('tokenize の途中で dispose されても結果は同じ（解放済みインスタンスを使わない）', async () => {
    const expected = await tok().tokenize(code, 'kotlin');
    const t = createTokenizer();
    const a = t.tokenize(code, 'kotlin'); // highlighter を作り始める
    t.dispose(); // 作り終わる前に解放
    const b = t.tokenize(code, 'kotlin'); // 新しい highlighter を作る
    expect(await a).toEqual(expected);
    expect(await b).toEqual(expected);
    t.dispose();
  });

  it('同じ入力から同じ結果になる', async () => {
    expect(await tok().tokenize(code, 'kotlin')).toEqual(await tok().tokenize(code, 'kotlin'));
  });
});

describe('attachTokens（hunk の lines を before / after のトークン行に対応付ける）', () => {
  const before = 'package a\n\nclass A {\n    /* c\n    d */ val x = 1\n    fun f() = 1\n}\n';
  const after = 'package a\n\nclass A {\n    /* c\n    d */ val x = 2\n    fun f() = 1\n    fun g() = "s"\n}\n';
  const file: ChangedFile = { path: 'A.kt', before, after };

  async function hunksOf(f: ChangedFile) {
    return attachTokens((await extractHunks(f)).map(toHunk), [f], { tokenizer: tok() });
  }

  it('tokens は lines と同じ長さで、各行のトークンを結合すると接頭辞抜きの行になる', async () => {
    const hunks = await hunksOf(file);
    expect(hunks.map((h) => h.symbol)).toEqual(['x', 'g()']);
    for (const h of hunks) {
      expect(h.tokens?.length).toBe(h.lines.length);
      expect(h.tokens?.map((l) => l.map(([t]) => t).join(''))).toEqual(h.lines.map((l) => l.slice(1)));
    }
  });

  it("'-' 行は before 側、'+' 行は after 側、' ' 行はブロックコメントの途中でも正しい色になる", async () => {
    const hunks = await hunksOf(file);
    const at = (prefix: string, needle: string) => {
      for (const h of hunks) {
        const idx = h.lines.findIndex((l) => l.startsWith(prefix) && l.includes(needle));
        if (idx >= 0) return h.tokens![idx]!;
      }
      throw new Error(`no line ${prefix}${needle}`);
    };
    expect(at('-', 'val x = 1').find(([t]) => t === '1')?.[1]).toBe('peach');
    expect(at('+', 'val x = 2').find(([t]) => t === '2')?.[1]).toBe('peach');
    expect(at('+', 'fun g()').find(([t]) => t === '"s"')?.[1]).toBe('green');
    expect(at(' ', '/* c')[1]).toEqual(['/* c', 'overlay2', 1]);
    expect(at('-', 'd */')[0]).toEqual(['    d */', 'overlay2', 1]);
  });

  it('追加ファイル（before null）と削除ファイル（after null）でも付く', async () => {
    const [added] = await hunksOf({ path: 'B.kt', before: null, after: 'val b = 1\n' });
    const [removed] = await hunksOf({ path: 'C.kt', before: 'val c = 1\n', after: null });
    expect(added?.tokens?.map((l) => l.map(([t]) => t).join(''))).toEqual(added?.lines.map((l) => l.slice(1)));
    expect(removed?.tokens?.map((l) => l.map(([t]) => t).join(''))).toEqual(removed?.lines.map((l) => l.slice(1)));
  });

  it('Shiki が知らない言語のファイルは tokens を付けない', async () => {
    const [h] = await hunksOf({ path: 'notes.unknownext', before: 'a\n', after: 'b\n' });
    expect(h?.tokens).toBeUndefined();
  });

  it('files に無い path の hunk はそのまま', async () => {
    const hunks = (await extractHunks(file)).map(toHunk);
    const out = await attachTokens(hunks, [], { tokenizer: tok() });
    expect(out).toEqual(hunks);
    expect(out[0]?.tokens).toBeUndefined();
  });
});

describe('hunkTokenLines（行の対応付け。フォールバックした行の index を返す）', () => {
  const hunk = { lnOld: 2, lnNew: 2, lines: [' a', '-b', '+c'] };
  const before: TokenLine[] = [[['x', null, 0]], [['a', null, 0]], [['b', 'mauve', 0]]];
  const after: TokenLine[] = [[['x', null, 0]], [['a', null, 0]], [['c', 'blue', 0]]];

  it('全行が一致すれば fallbacks は空', () => {
    expect(hunkTokenLines(hunk, before, after)).toEqual({
      tokens: [[['a', null, 0]], [['b', 'mauve', 0]], [['c', 'blue', 0]]],
      fallbacks: [],
    });
  });

  it('トークン列の結合が行と一致しない行は継承色 1 トークンに落とし、index を fallbacks に入れる', () => {
    // before の 2 行目（' a' が拾う行）が 'x' にずれている
    const shifted: TokenLine[] = [[['a', null, 0]], [['x', null, 0]], [['b', 'mauve', 0]]];
    expect(hunkTokenLines(hunk, shifted, after)).toEqual({
      tokens: [[['a', null, 0]], [['b', 'mauve', 0]], [['c', 'blue', 0]]],
      fallbacks: [0],
    });
  });
});
