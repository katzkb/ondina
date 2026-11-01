import type { CommentDraft, FileText, ReviewState } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { carryReview, changedHunks, mapLines, type CarrySource } from '../src/review/carry.js';

const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);
const BASE = 'c'.repeat(40);

const hunk = (id: string, lines: string[], hows: number[] = [1], at: { path?: string; lnOld?: number; lnNew?: number } = {}) => ({ id, lines, hows, path: at.path ?? 'X.kt', lnOld: at.lnOld ?? 1, lnNew: at.lnNew ?? 1 });
const file = (path: string, lines: string[]): FileText => ({ path, tokens: lines.map((l) => [[l, null, 0]]) });
const src = (o: Partial<CarrySource> & { headSha: string; baseSha?: string }): CarrySource => ({
  pr: { headSha: o.headSha, baseSha: o.baseSha ?? BASE },
  hunks: o.hunks ?? [],
  hows: o.hows ?? [{ id: 1 }],
  ...(o.files === undefined ? {} : { files: o.files }),
});
const state = (o: Partial<ReviewState>): ReviewState => ({ viewed: [], comments: [], ...o });
const memo = (id: string, line: number, o: Partial<CommentDraft> = {}): CommentDraft => ({ id, path: 'A.kt', line, side: 'RIGHT', body: id, source: 'reviewer', state: 'adopted', ...o });

describe('mapLines', () => {
  it('変わっていない行は新しい行番号に、変わった行は undefined', () => {
    const map = mapLines(['a', 'b', 'c', 'd'], ['x', 'a', 'B', 'c', 'd']);
    expect(map(1)).toBe(2);
    expect(map(2)).toBeUndefined();
    expect(map(3)).toBe(4);
    expect(map(4)).toBe(5);
  });

  it('消した行の後ろは詰まる', () => {
    const map = mapLines(['a', 'b', 'c'], ['a', 'c']);
    expect(map(2)).toBeUndefined();
    expect(map(3)).toBe(2);
  });

  it('範囲外の行は undefined', () => {
    expect(mapLines(['a'], ['a'])(2)).toBeUndefined();
  });
});

describe('changedHunks', () => {
  it('lines が違う hunk と新しい hunk の id。消えた hunk は数えない', () => {
    const prev = src({ headSha: OLD, hunks: [hunk('h1', ['+a']), hunk('h2', ['+b']), hunk('h3', ['+c'])] });
    const next = src({ headSha: NEW, hunks: [hunk('h1', ['+a']), hunk('h2', ['+B']), hunk('h4', ['+d'])] });
    expect(changedHunks(prev, next)).toEqual(['h2', 'h4']);
  });
});

describe('carryReview: 問題なし', () => {
  const prev = src({ headSha: OLD, hunks: [hunk('h1', ['+a']), hunk('h2', ['+b']), hunk('h3', ['+c'])] });
  const next = src({ headSha: NEW, hunks: [hunk('h1', ['+a']), hunk('h2', ['+B']), hunk('h4', ['+d'])] });

  it('lines が同じ hunk だけ残し、変わった hunk を reset に記録する。消えた hunk は黙って落とす', () => {
    const r = carryReview(prev, state({ viewed: ['h1', 'h2', 'h3'] }), next);
    expect(r.viewed).toEqual(['h1']);
    expect(r.carried).toEqual({ from: OLD, reset: ['h2'], coursesReset: [], left: [] });
  });

  it('前の版の state を書き換えない', () => {
    const before = state({ viewed: ['h1', 'h2'] });
    carryReview(prev, before, next);
    expect(before.viewed).toEqual(['h1', 'h2']);
  });
});

describe('carryReview: コースの完了', () => {
  const prev = src({ headSha: OLD, hows: [{ id: 1 }, { id: 2 }, { id: 3 }], hunks: [hunk('h1', ['+a'], [1]), hunk('h2', ['+b'], [2]), hunk('h3', ['+c'], [3])] });

  it('差分が全部問題なしのままのコースは完了のまま。変わったコースは未完了に戻し、無くなったコースは黙って落とす', () => {
    const next = src({ headSha: NEW, hows: [{ id: 1 }, { id: 2 }], hunks: [hunk('h1', ['+a'], [1]), hunk('h2', ['+B'], [2])] });
    const r = carryReview(prev, state({ viewed: ['h1', 'h2', 'h3'], course: { done: ['1:x'], completed: [1, 2, 3] } }), next);
    expect(r.course).toEqual({ done: [], completed: [1] });
    expect(r.carried?.coursesReset).toEqual([2]);
  });

  it('新しい差分が増えたコースも未完了に戻す', () => {
    const next = src({ headSha: NEW, hows: [{ id: 1 }], hunks: [hunk('h1', ['+a'], [1]), hunk('h9', ['+z'], [1])] });
    const r = carryReview(prev, state({ viewed: ['h1'], course: { done: [], completed: [1] } }), next);
    expect(r.course?.completed).toEqual([]);
    expect(r.carried?.coursesReset).toEqual([1]);
  });

  it('course が無い古い state には course を作らない', () => {
    const r = carryReview(prev, state({ viewed: ['h1'] }), src({ headSha: NEW, hunks: [hunk('h1', ['+a'])] }));
    expect(r.course).toBeUndefined();
  });
});

describe('carryReview: メモと下書き', () => {
  const before = ['class A {', '  fun a() = 1', '  fun b() = 2', '}'];
  const after = ['import x', 'class A {', '  fun a() = 1', '  fun b() = 3', '}'];
  const prev = src({ headSha: OLD, files: [file('A.kt', before)] });
  // serve は Analysis をそのまま渡すので、GitHub の差分の塊（githubDiff）も付いてくる。引き継ぎはそれを見ない（送れるかは画面と cli がその場で決める）
  const next = { ...src({ headSha: NEW, files: [file('A.kt', after)] }), githubDiff: [{ path: 'A.kt', hunks: [{ oldStart: 3, oldLines: 1, newStart: 1, newLines: 4 }] }] };

  it('変わっていない行のメモは行番号をずらして移す。ほかの欄はそのまま（GitHub の差分に入るかで何も足さない）', () => {
    const r = carryReview(prev, state({ comments: [memo('m1', 2), memo('m2', 4, { body: '別の文' })] }), next);
    expect(r.comments).toEqual([memo('m1', 3), memo('m2', 5, { body: '別の文' })]);
    expect(r.carried?.left).toEqual([]);
  });

  it('変わった行のメモは移さず left に残す', () => {
    const r = carryReview(prev, state({ comments: [memo('m1', 3)] }), next);
    expect(r.comments).toEqual([]);
    expect(r.carried?.left).toEqual(['m1']);
  });

  it('範囲は全部の行が変わっていなければ移す。変わった行を含めば残す', () => {
    const moved = carryReview(prev, state({ comments: [memo('m1', 2, { startLine: 1, startSide: 'RIGHT' })] }), next);
    expect(moved.comments).toEqual([memo('m1', 3, { startLine: 2, startSide: 'RIGHT' })]);
    const kept = carryReview(prev, state({ comments: [memo('m2', 4, { startLine: 2, startSide: 'RIGHT' })] }), next);
    expect(kept.carried?.left).toEqual(['m2']);
  });

  it('送った・捨てたものは移さず、left にも入れない', () => {
    const r = carryReview(prev, state({ comments: [memo('m1', 2, { state: 'sent' }), memo('d1', 2, { source: 'claude-code', state: 'discarded' })] }), next);
    expect(r.comments).toEqual([]);
    expect(r.carried?.left).toEqual([]);
  });

  it('AI の下書きも同じく移す', () => {
    const r = carryReview(prev, state({ comments: [memo('d1', 2, { source: 'claude-code', state: 'draft' })] }), next);
    expect(r.comments).toEqual([memo('d1', 3, { source: 'claude-code', state: 'draft' })]);
  });

  it('base 側の行は baseSha が同じならそのまま、違えば残す', () => {
    const left = memo('m1', 3, { side: 'LEFT' });
    expect(carryReview(prev, state({ comments: [left] }), next).comments).toEqual([left]);
    const moved = src({ headSha: NEW, baseSha: 'd'.repeat(40), files: [file('A.kt', after)] });
    expect(carryReview(prev, state({ comments: [left] }), moved).carried?.left).toEqual(['m1']);
  });

  it('どちらかの版に全文が無いファイルのメモは残す', () => {
    const r = carryReview(prev, state({ comments: [memo('m1', 2)] }), src({ headSha: NEW }));
    expect(r.carried?.left).toEqual(['m1']);
  });

  describe('base と head にまたがる範囲', () => {
    // base: class A { / fun a() = 0 / }。head は fun a() を書き換えて b と c を足した
    const lines = [' class A {', '-  fun a() = 0', '+  fun a() = 1', '+  fun b() = 2', '+  fun c() = 3', ' }'];
    const head = ['class A {', '  fun a() = 1', '  fun b() = 2', '  fun c() = 3', '}'];
    const old = src({ headSha: OLD, hunks: [hunk('h1', lines, [1], { path: 'A.kt' })], files: [file('A.kt', head)] });
    const across = memo('m1', 4, { startLine: 2, startSide: 'LEFT' });

    it('差分が変わっていなければ移す（足した側だけずれる）', () => {
      const next = src({ headSha: NEW, hunks: [hunk('h1', lines, [1], { path: 'A.kt', lnNew: 2 })], files: [file('A.kt', ['import x', ...head])] });
      expect(carryReview(old, state({ comments: [across] }), next).comments).toEqual([memo('m1', 5, { startLine: 2, startSide: 'LEFT' })]);
    });

    it('両端の行が同じでも、間の行が変わっていれば残す', () => {
      const changed = ['class A {', '  fun a() = 1', '  fun b() = 9', '  fun c() = 3', '}'];
      const next = src({ headSha: NEW, hunks: [hunk('h1', [...lines.slice(0, 3), '+  fun b() = 9', ...lines.slice(4)], [1], { path: 'A.kt' })], files: [file('A.kt', changed)] });
      expect(carryReview(old, state({ comments: [across] }), next).carried?.left).toEqual(['m1']);
    });

    it('逆の向き（変わらない行から下の消した行）も、差分が変わっていなければ移す（head 側の始まりだけずれる）', () => {
      // base: class A { / fun k() / fun old() / }。head は x・y・z を足して old を消した。範囲は head 5（fun k）→ base 3（fun old）
      // base 側は 4 行しかないので、始まりと終わりの側を取り違えると差分の中に見つからない
      const downLines = [' class A {', '+  fun x() = 1', '+  fun y() = 2', '+  fun z() = 3', '   fun k() = 0', '-  fun old() = 0', ' }'];
      const downHead = ['class A {', '  fun x() = 1', '  fun y() = 2', '  fun z() = 3', '  fun k() = 0', '}'];
      const before = src({ headSha: OLD, hunks: [hunk('h1', downLines, [1], { path: 'A.kt' })], files: [file('A.kt', downHead)] });
      const next = src({ headSha: NEW, hunks: [hunk('h1', downLines, [1], { path: 'A.kt', lnNew: 2 })], files: [file('A.kt', ['import x', ...downHead])] });
      const down = memo('m2', 3, { side: 'LEFT', startLine: 5, startSide: 'RIGHT' });
      expect(carryReview(before, state({ comments: [down] }), next).comments).toEqual([memo('m2', 3, { side: 'LEFT', startLine: 6, startSide: 'RIGHT' })]);
    });
  });
});
