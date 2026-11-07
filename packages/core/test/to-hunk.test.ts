// SemanticHunk（Stage 1 の事実）を Hunk（設計書 4章）に写す。kind / hows は後段が埋めるので初期値。
import { describe, expect, it } from 'vitest';
import { toHunk } from '../src/hunks/to-hunk.js';
import type { SemanticHunk } from '../src/hunks/extract.js';

const semantic: SemanticHunk = {
  id: 'abc',
  path: 'src/main/kotlin/com/example/order/domain/Order.kt',
  lang: 'kotlin',
  symbol: 'applyDiscount()',
  symbolFqName: 'com.example.order.domain.Order.applyDiscount',
  symbolKind: 'function',
  lnOld: 10,
  lnNew: 12,
  lines: [' fun applyDiscount() {', '-  a', '+  b', ' }'],
};

describe('toHunk', () => {
  it('Stage 1 の事実をそのまま持ち越す', () => {
    const hunk = toHunk(semantic);
    expect(hunk).toMatchObject({
      id: 'abc',
      path: semantic.path,
      lang: 'kotlin',
      symbol: 'applyDiscount()',
      symbolFqName: semantic.symbolFqName,
      symbolKind: 'function',
      lnOld: 10,
      lnNew: 12,
      lines: semantic.lines,
    });
  });

  it('未帰属（kind none / hows 空 / n 1）で初期化し、出所は ast にする', () => {
    const hunk = toHunk(semantic);
    expect(hunk.kind).toBe('none');
    expect(hunk.kindProvenance).toBe('ast');
    expect(hunk.hows).toEqual([]);
    expect(hunk.n).toBe(1);
    expect(hunk.group).toBeUndefined();
    expect(hunk.tokens).toBeUndefined();
  });

  it('importsOnly は立っているときだけ持ち越す', () => {
    expect(toHunk({ ...semantic, importsOnly: true }).importsOnly).toBe(true);
    expect('importsOnly' in toHunk(semantic)).toBe(false);
  });
});
