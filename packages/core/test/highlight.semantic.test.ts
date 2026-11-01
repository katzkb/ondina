// 意味トークンの展開・対応表・重ね合わせ（設計書 7.2）。決定的な処理なので unit test。
import { describe, expect, it } from 'vitest';
import {
  decodeSemanticTokens,
  NON_IDENTIFIER_ROLES,
  overlaySemanticTokens,
  semanticRole,
  type SemanticLegend,
  type SemanticToken,
} from '../src/highlight/semantic.js';
import type { TokenLine } from '../src/model.js';

// kotlin-lsp 263.4702.0 が initialize の応答で返す legend（2026-09-21 実測）
const LEGEND: SemanticLegend = {
  tokenTypes: [
    'namespace', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'type', 'parameter',
    'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword',
    'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator',
  ],
  tokenModifiers: [
    'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async',
    'modification', 'documentation', 'defaultLibrary',
  ],
};
const T = (type: string) => LEGEND.tokenTypes.indexOf(type);
const M = (...names: string[]) => names.reduce((acc, n) => acc | (1 << LEGEND.tokenModifiers.indexOf(n)), 0);

describe('decodeSemanticTokens', () => {
  it('同じ行の連続では char を足し、行が変わったら char をリセットする', () => {
    // 1 組 = [deltaLine, deltaChar, length, type, modifiers]
    const data = [
      0, 4, 5, T('class'), M('declaration'),
      0, 7, 3, T('parameter'), 0,
      2, 8, 4, T('variable'), M('readonly'),
    ];
    expect(decodeSemanticTokens(data, LEGEND)).toEqual([
      { line: 0, char: 4, length: 5, type: 'class', modifiers: ['declaration'] },
      { line: 0, char: 11, length: 3, type: 'parameter', modifiers: [] },
      { line: 2, char: 8, length: 4, type: 'variable', modifiers: ['readonly'] },
    ]);
  });

  it('空の data は空の配列', () => {
    expect(decodeSemanticTokens([], LEGEND)).toEqual([]);
  });

  it('5 の倍数でない余りは捨てる（壊れた応答で落ちない）', () => {
    expect(decodeSemanticTokens([0, 0, 3, T('variable'), 0, 0, 5], LEGEND)).toHaveLength(1);
  });

  it('legend に無い番号は番号そのものを type にする（未知の type は対応表が拾わない）', () => {
    const [tok] = decodeSemanticTokens([0, 0, 1, 99, 0], LEGEND);
    expect(tok?.type).toBe('99');
    expect(semanticRole(tok!.type, tok!.modifiers)).toBeUndefined();
  });

  it('修飾子はビットの立っている順に名前で返す', () => {
    const [tok] = decodeSemanticTokens([0, 0, 1, T('property'), M('readonly', 'static')], LEGEND);
    expect(tok?.modifiers).toEqual(['readonly', 'static']);
  });
});

describe('semanticRole（JetBrains 版 Catppuccin の属性割当から起こした対応表）', () => {
  it('クラスの宣言は yellow + italic、参照は italic なし', () => {
    expect(semanticRole('class', ['declaration'])).toEqual({ role: 'yellow', fontStyle: 1 });
    expect(semanticRole('class', [])).toEqual({ role: 'yellow', fontStyle: 0 });
  });

  it('enum / struct / interface もクラスと同じ扱い', () => {
    for (const type of ['enum', 'struct', 'interface']) {
      expect(semanticRole(type, ['declaration']), type).toEqual({ role: 'yellow', fontStyle: 1 });
      expect(semanticRole(type, []), type).toEqual({ role: 'yellow', fontStyle: 0 });
    }
  });

  it('type / typeParameter は宣言でも italic なし', () => {
    expect(semanticRole('type', [])).toEqual({ role: 'yellow', fontStyle: 0 });
    expect(semanticRole('typeParameter', [])).toEqual({ role: 'yellow', fontStyle: 0 });
    // <T> の宣言側も KOTLIN_TYPE_PARAMETER（italic なし）。object の宣言は type [declaration] で返る
    expect(semanticRole('typeParameter', ['declaration'])).toEqual({ role: 'yellow', fontStyle: 0 });
    expect(semanticRole('type', ['declaration'])).toEqual({ role: 'yellow', fontStyle: 0 });
  });

  it('関数は宣言も呼び出しも blue + italic', () => {
    expect(semanticRole('method', ['declaration'])).toEqual({ role: 'blue', fontStyle: 1 });
    expect(semanticRole('method', [])).toEqual({ role: 'blue', fontStyle: 1 });
    expect(semanticRole('function', ['static', 'defaultLibrary'])).toEqual({ role: 'blue', fontStyle: 1 });
  });

  it('引数は maroon + italic', () => {
    expect(semanticRole('parameter', ['declaration', 'readonly'])).toEqual({ role: 'maroon', fontStyle: 1 });
  });

  it('プロパティは text。static なら teal（kotlin-lsp は const val にも static を付けないので実機では出ない）', () => {
    expect(semanticRole('property', ['readonly'])).toEqual({ role: 'text', fontStyle: 0 });
    expect(semanticRole('property', ['declaration', 'readonly'])).toEqual({ role: 'text', fontStyle: 0 });
    expect(semanticRole('property', ['static'])).toEqual({ role: 'teal', fontStyle: 0 });
  });

  it('ローカル変数は text、enum の値は peach、アノテーションは yellow + italic', () => {
    expect(semanticRole('variable', ['declaration', 'readonly'])).toEqual({ role: 'text', fontStyle: 0 });
    expect(semanticRole('enumMember', [])).toEqual({ role: 'peach', fontStyle: 0 });
    expect(semanticRole('decorator', [])).toEqual({ role: 'yellow', fontStyle: 1 });
  });

  it('パッケージ名は継承色（role が null）', () => {
    expect(semanticRole('namespace', [])).toEqual({ role: null, fontStyle: 0 });
  });

  it('字句で決まる種別は undefined を返す（重ね合わせに使わない）', () => {
    for (const type of ['operator', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp']) {
      expect(semanticRole(type, []), type).toBeUndefined();
    }
  });

  it('表に無い種別も undefined', () => {
    for (const type of ['event', 'macro']) expect(semanticRole(type, []), type).toBeUndefined();
  });
});

describe('overlaySemanticTokens', () => {
  const tok = (line: number, char: number, length: number, type: string, ...mods: string[]): SemanticToken => ({
    line, char, length, type, modifiers: mods,
  });
  /** 見比べやすい形（role:fontStyle:text） */
  const shape = (lines: TokenLine[]) => lines.map((l) => l.map(([t, r, f]) => `${r}:${f}:${t}`));

  it('字句が色を付けていないトークンをちょうど覆うと、対応表の役割と italic が入る', () => {
    const lines: TokenLine[] = [[['cmd', null, 0]]];
    expect(shape(overlaySemanticTokens(lines, [tok(0, 0, 3, 'parameter')]))).toEqual([['maroon:1:cmd']]);
  });

  it('字句トークンの一部だけを覆うと、そこで分割される', () => {
    const lines: TokenLine[] = [[[' rate = x', null, 0]]];
    expect(shape(overlaySemanticTokens(lines, [tok(0, 1, 4, 'variable')]))).toEqual([
      ['null:0: ', 'text:0:rate', 'null:0: = x'],
    ]);
  });

  it('複数の字句トークンにまたがる意味トークンは、境界ごとに役割が入る', () => {
    const lines: TokenLine[] = [[['Money', 'yellow', 1], ['.', null, 0], ['ZERO', null, 0]]];
    // 字句が塗った Money は残り、句点と ZERO には property が入る
    expect(shape(overlaySemanticTokens(lines, [tok(0, 0, 5, 'class'), tok(0, 6, 4, 'property', 'readonly')]))).toEqual([
      ['yellow:1:Money', 'null:0:.', 'text:0:ZERO'],
    ]);
  });

  it('行の長さをはみ出す意味トークンでも落ちない', () => {
    const lines: TokenLine[] = [[['ab', null, 0]]];
    expect(shape(overlaySemanticTokens(lines, [tok(0, 0, 99, 'variable')]))).toEqual([['text:0:ab']]);
  });

  it('意味トークンが無い行はそのまま返す', () => {
    const lines: TokenLine[] = [[['val', 'mauve', 0], [' x', null, 0]], [['}', null, 0]]];
    expect(shape(overlaySemanticTokens(lines, [tok(0, 4, 1, 'variable')]))[1]).toEqual(['null:0:}']);
  });

  it('重ねたあともトークンを結合すると元の行になる', () => {
    const lines: TokenLine[] = [[['    ', null, 0], ['val', 'mauve', 0], [' rate = ', null, 0], ['f', 'blue', 1], ['(a)', null, 0]]];
    const out = overlaySemanticTokens(lines, [tok(0, 8, 4, 'variable'), tok(0, 15, 1, 'parameter')]);
    expect(out[0]!.map(([t]) => t).join('')).toBe(lines[0]!.map(([t]) => t).join(''));
  });

  describe('例外（字句が非識別子と読んだのに LSP が識別子だと言った場所）', () => {
    it('字句がキーワード色なら LSP を勝たせる（Kotlin のソフトキーワード value）', () => {
      const lines: TokenLine[] = [[['value', 'mauve', 0]]];
      expect(shape(overlaySemanticTokens(lines, [tok(0, 0, 5, 'property', 'readonly')]))).toEqual([['text:0:value']]);
    });

    it('字句が文字列色なら LSP を勝たせる（文字列テンプレートの中）', () => {
      const lines: TokenLine[] = [[['Instant', 'green', 0]]];
      expect(shape(overlaySemanticTokens(lines, [tok(0, 0, 7, 'class')]))).toEqual([['yellow:0:Instant']]);
    });

    it('字句が識別子の色なら字句を残す（アノテーションが method で返る件）', () => {
      const lines: TokenLine[] = [[['Test', 'yellow', 1]]];
      expect(shape(overlaySemanticTokens(lines, [tok(0, 0, 4, 'method')]))).toEqual([['yellow:1:Test']]);
    });

    it('字句が関数色で LSP も method なら、字句がそのまま残る（同じ向きなので変わらない）', () => {
      const lines: TokenLine[] = [[['rateFor', 'blue', 1]]];
      expect(shape(overlaySemanticTokens(lines, [tok(0, 0, 7, 'method')]))).toEqual([['blue:1:rateFor']]);
    });

    it('非識別子の役割は設計書 7.1 の字句カテゴリ 6 つ', () => {
      expect([...NON_IDENTIFIER_ROLES].sort()).toEqual(['green', 'mauve', 'overlay2', 'peach', 'red', 'teal']);
    });
  });
});
