// hunk の統合形式の行から行番号を出す（束の検出・呼び出し辺・2 回目の LLM の入力と検証が使う）
import { describe, expect, it } from 'vitest';
import { headLines } from '../src/hunks/changed-lines.js';

describe('headLines', () => {
  it('文脈と追加の行は head の行番号（lnNew から 1 ずつ）、削除の行は null', () => {
    expect(headLines({ lnNew: 15, lines: ['-a', '+b', ' c', '+d', '-e', ' f'] })).toEqual([null, 15, 16, 17, null, 18]);
  });
});
