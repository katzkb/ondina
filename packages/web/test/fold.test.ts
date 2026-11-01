// 変わった行から離れた変わらない行を畳む（GitHub と同じ。2026-10-13。見本を比べて 20 行ずつにした）
import { describe, expect, it } from 'vitest';
import { FOLD_AROUND, FOLD_STEP, foldButtons, foldKeys, foldLines, type FoldAt, type FoldPart } from '../src/diff/fold.js';

/** 行の列を文字で書く: c = 変わらない行、a = 変わった行（錨）、| = 区切り（見出し）、m = 常に出す行（メモ） */
type Row = { ch: string; n: number };
const rowsOf = (s: string): Row[] => [...s].map((ch, n) => ({ ch, n }));
const at = (r: Row): FoldAt => (r.ch === '|' ? 'break' : r.ch === 'm' ? 'keep' : { key: `k${r.n}`, anchor: r.ch === 'a' });
/** 結果を文字で: 出す行はその文字、帯は [n] */
const show = (parts: FoldPart<Row>[]) => parts.map((p) => (p.kind === 'row' ? p.row.ch : `[${p.keys.length}]`)).join('');
const run = (s: string, open: readonly string[] = [], all = false) => foldLines(rowsOf(s), at, new Set(open), all);

describe('foldLines', () => {
  it('変わった行の前後 3 行だけ残し、離れた変わらない行を帯にまとめる', () => {
    expect(FOLD_AROUND).toBe(3);
    expect(show(run('ccccccccaccccccccc'))).toBe('[5]cccaccc[6]');
  });

  it('帯は隠れた行の key を上から順に持つ', () => {
    const parts = run('cccccccac');
    expect(parts[0]).toMatchObject({ kind: 'fold', keys: ['k0', 'k1', 'k2', 'k3'] });
  });

  it('1 行だけの並びは畳まない（帯と同じ高さなので）', () => {
    expect(show(run('cccca'))).toBe('cccca');
    expect(show(run('ccccca'))).toBe('[2]ccca');
  });

  it('変わった行の間が近ければ帯を挟まない', () => {
    expect(show(run('acccccca'))).toBe('acccccca');
    expect(show(run('accccccca'))).toBe('accccccca');
    expect(show(run('acccccccca'))).toBe('accc[2]ccca');
  });

  it('区切り（見出し）は常に出し、帯は区切りをまたがない。前後 3 行も区切りを越えない', () => {
    expect(show(run('ccccc|ccccca'))).toBe('[5]|[2]ccca');
    expect(show(run('acccccc|cccccc'))).toBe('accc[3]|[6]');
  });

  it('常に出す行（メモ）は錨と同じく前後 3 行を残す', () => {
    expect(show(run('acccccccccmcccccc'))).toBe('accc[3]cccmccc[3]');
  });

  it('開いた key の行は出す。残りは帯のまま', () => {
    expect(show(run('cccccccca', ['k0', 'k1']))).toBe('cc[3]ccca');
  });

  it('全部表示なら畳まない', () => {
    expect(show(run('cccccccca', [], true))).toBe('cccccccca');
  });

  it('錨が 1 つも無い列は畳まない（見る場所が無い）', () => {
    expect(show(run('cccccccc'))).toBe('cccccccc');
    expect(show(run('|cccccccc|cccccc'))).toBe('|cccccccc|cccccc');
  });

  it('帯は隠れた行そのものも持つ（帯の中のメモの数を数える）', () => {
    const parts = run('ccccca');
    expect(parts[0]).toMatchObject({ kind: 'fold', rows: [{ ch: 'c', n: 0 }, { ch: 'c', n: 1 }] });
  });

  it('列の先頭の帯は top、末尾の帯は bottom', () => {
    const parts = run('ccccccacccccc').filter((p) => p.kind === 'fold');
    expect(parts.map((p) => [p.top, p.bottom])).toEqual([
      [true, false],
      [false, true],
    ]);
    const mid = run('|ccccc|a').find((p) => p.kind === 'fold');
    expect(mid).toMatchObject({ top: false, bottom: false });
  });
});

describe('foldButtons / foldKeys（帯のボタンと、押すと開く行）', () => {
  const fold = (n: number, top = false, bottom = false) => ({ kind: 'fold' as const, keys: Array.from({ length: n }, (_, i) => `k${i}`), rows: [], top, bottom });

  it('20 行より多い真ん中の帯は ↓ と ↑。↓ は上側から 20 行、↑ は下側から 20 行', () => {
    expect(FOLD_STEP).toBe(20);
    const f = fold(45);
    expect(foldButtons(f)).toEqual(['down', 'up']);
    expect(foldKeys(f, 'down')).toEqual(f.keys.slice(0, 20));
    expect(foldKeys(f, 'up')).toEqual(f.keys.slice(25));
  });

  it('20 行以下の真ん中の帯は ↕ 1 つで全部', () => {
    const f = fold(20);
    expect(foldButtons(f)).toEqual(['all']);
    expect(foldKeys(f, 'all')).toEqual(f.keys);
  });

  it('先頭の帯は ↑ だけ、末尾の帯は ↓ だけ（行数に依らない）', () => {
    expect(foldButtons(fold(45, true))).toEqual(['up']);
    expect(foldButtons(fold(5, true))).toEqual(['up']);
    expect(foldButtons(fold(45, false, true))).toEqual(['down']);
    expect(foldKeys(fold(5, true), 'up')).toEqual(['k0', 'k1', 'k2', 'k3', 'k4']);
  });
});
