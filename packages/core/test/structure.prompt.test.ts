// 構成の推定のプロンプト（設計書 10.6）。CLI 固有のフラグに頼らず、指示・出力の形・入力をすべて本文に入れる。
import { describe, expect, it } from 'vitest';
import { renderStructurePrompt } from '../src/structure/prompt.js';
import { STRUCTURE_OUTPUT_SCHEMA } from '../src/structure/schema.js';

const input = { files: 1, dirs: [{ dir: 'src', files: [{ name: 'A.kt', decls: ['class A'] }] }] };

describe('renderStructurePrompt', () => {
  it('指示・出力の形・入力 JSON を本文に入れ、入力は「入力:」の後ろに置く', () => {
    const p = renderStructurePrompt(input);
    expect(p).toContain(JSON.stringify(STRUCTURE_OUTPUT_SCHEMA, null, 2));
    expect(JSON.parse(p.slice(p.lastIndexOf('入力:\n') + '入力:\n'.length))).toEqual(input);
  });

  it('層の数と並びの向き、名前の決まりを持ち込まないことを指示する', () => {
    const p = renderStructurePrompt(input);
    expect(p).toContain('3〜8 個');
    expect(p).toContain('呼ぶ側を上');
    expect(p).toContain('このリポジトリの');
  });

  it('previous があれば前回の層の名前と並びを保つよう指示し、無ければ出さない', () => {
    expect(renderStructurePrompt({ ...input, previous: { layers: ['API'] } })).toContain('previous.layers');
    expect(renderStructurePrompt(input)).not.toContain('previous.layers');
  });

  it('テストのコードの置き場を tests に書かせる（テストの見分け。5.2 の 7）', () => {
    const p = renderStructurePrompt(input);
    expect(p).toContain('tests（テストの置き場）');
    expect(STRUCTURE_OUTPUT_SCHEMA.required).toContain('tests');
  });

  it('"." は直下のファイルだけを指すと伝える', () => {
    expect(renderStructurePrompt(input)).toContain('"." はリポジトリ直下のファイルだけ');
  });

  it('同じ入力には同じ本文（原則 7）', () => {
    expect(renderStructurePrompt(input)).toBe(renderStructurePrompt(structuredClone(input)));
  });
});
