// 差分一覧をファイルをまたいで 1 本でスクロールする（設計書 3.4。2026-10-20）。
// ツリーの明るい行は一番上のファイル（diffFile）。選んだ差分は見えている間は動かさず、見えなくなったら見えている一番上の差分へ付いてくる。
// リストを動かすのは diffJump（n が進んだときだけ）。行き先を画面に出し終える前の知らせ（n が古い）では選びを動かさない。
import type { AskEntry } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { groupFiles } from '../src/files.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
const ORDER_ID = '98dcd7c9d8d6e0ed59854b2fff454f5bf805bae7';
const TESTS = 'src/test/kotlin/com/example/order';

function loaded(): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const inDiff = () => run(loaded(), { id: 'view.diff' });
/** ツリーの順のファイル（差分一覧の列の順） */
const files = (s: AppState) => groupFiles(s.analysis!.hunks, []);
/** DiffList の知らせ: 一番上のファイル・見えている差分（上から）・出し終えた jump の番号 */
const seen = (file: string, hunks: string[], n: number): Command => ({ id: 'diff.viewport', file, hunks, n });

describe('diff.viewport（スクロールの知らせ）', () => {
  it('選んだ差分が見えていれば選びは動かさず、ツリーの明るい行（diffFile）だけ一番上のファイルにする', () => {
    const s = inDiff();
    const [a, b] = files(s);
    const r = reduce(s, seen(b!.path, [s.selectedHunk!, b!.hunks[0]!.id], s.diffJump.n));
    expect(r.state.selectedHunk).toBe(s.selectedHunk);
    expect(r.state.selectedFile).toBe(a!.path);
    expect(r.state.diffFile).toBe(b!.path);
    expect(r.effects).toEqual([]);
  });

  it('選んだ差分が見えなくなったら、見えている一番上の差分を選ぶ（ファイルも）。スクロールの合図は出さない', () => {
    const s = inDiff();
    const b = files(s)[1]!;
    const t = run(s, seen(b.path, [b.hunks[0]!.id], s.diffJump.n));
    expect(t.selectedHunk).toBe(b.hunks[0]!.id);
    expect(t.selectedFile).toBe(b.path);
    expect(t.diffJump).toBe(s.diffJump);
  });

  it('行き先を出し終える前の知らせ（n が古い）では選びを動かさない', () => {
    const s = run(inDiff(), { id: 'hunk.next' });
    const c = files(s)[2]!;
    const t = run(s, seen(c.path, [c.hunks[0]!.id], s.diffJump.n - 1));
    expect(t.selectedHunk).toBe(s.selectedHunk);
    expect(t.diffFile).toBe(c.path);
  });

  it('何も変わらない知らせは同じ state を返す（画面を描き直さない）', () => {
    const s = inDiff();
    const a = files(s)[0]!;
    const t = run(s, seen(a.path, [s.selectedHunk!], s.diffJump.n));
    expect(reduce(t, seen(a.path, [s.selectedHunk!], s.diffJump.n)).state).toBe(t);
  });

  it('差分一覧の外では何もしない', () => {
    const s = loaded();
    expect(reduce(s, seen(files(s)[3]!.path, [files(s)[3]!.hunks[0]!.id], s.diffJump.n)).state).toBe(s);
  });

  it('スクロールでファイルをまたいでも、書く枠・選んだ行・すべて表示・光らせた行・閉じたフォルダはそのまま', () => {
    const s0 = run(inDiff(), { id: 'memo.pick', path: files(inDiff())[0]!.path, side: 'RIGHT', line: 3, order: 0 }, { id: 'memo.drop' }, { id: 'file.full' }, { id: 'tree.toggle', tree: 'diff', key: TESTS });
    const test = files(s0).find((f) => f.path.startsWith(`${TESTS}/`))!;
    const s1: AppState = { ...s0, focusLine: { path: s0.selectedFile!, side: 'RIGHT', line: 3, n: 1 }, memo: { ...s0.memo, focus: 'm1' } };
    const t = run(s1, seen(test.path, [test.hunks[0]!.id], s1.diffJump.n));
    expect(t.selectedFile).toBe(test.path);
    expect(t.memo).toBe(s1.memo);
    expect(t.focusLine).toBe(s1.focusLine);
    expect(t.fullFile).toBe(true);
    expect(t.treeShut.diff).toEqual([TESTS]);
  });
});

describe('差分一覧のスクロールの合図（diffJump）', () => {
  it('差分一覧に入ると、選んだ差分へ（見えていなければ見える所まで）', () => {
    const s0 = loaded();
    const s = run(s0, { id: 'view.diff' });
    expect(s.diffJump).toEqual({ hunkId: s0.selectedHunk, to: 'hunk', n: s0.diffJump.n + 1 });
  });

  it('ツリーでファイルを押すと、そのファイルの見出しを一番上へ。同じファイルをもう一度押しても戻す。ツリーの明るい行もそのファイル', () => {
    const s = inDiff();
    const b = files(s)[1]!;
    const t = run(s, { id: 'file.select', path: b.path });
    expect(t.diffJump).toEqual({ hunkId: b.hunks[0]!.id, to: 'file', n: s.diffJump.n + 1 });
    expect(t.diffFile).toBe(b.path);
    expect(run(t, { id: 'file.select', path: b.path }).diffJump.n).toBe(t.diffJump.n + 1);
  });

  it('j でファイルをまたぐと、その差分へ。前のファイルで開いた書く枠は閉じない', () => {
    const s0 = run(inDiff(), { id: 'memo.pick', path: files(inDiff())[0]!.path, side: 'RIGHT', line: 3, order: 0 }, { id: 'memo.drop' }, { id: 'memo.draft', body: '書きかけ' });
    const s = run(s0, { id: 'hunk.next' });
    expect(s.selectedFile).toBe(files(s)[1]!.path);
    expect(s.diffJump).toEqual({ hunkId: s.selectedHunk, to: 'hunk', n: s0.diffJump.n + 1 });
    expect(s.memo).toMatchObject({ pick: s0.memo.pick, draft: '書きかけ' });
  });

  it('すべて表示（F）はファイルが替わっても戻らない。F と左右 / 統合を替えると、選んだ差分へ揃え直す', () => {
    const s = run(inDiff(), { id: 'file.full' });
    expect(s.diffJump.n).toBe(inDiff().diffJump.n + 1);
    expect(run(s, { id: 'file.select', path: files(s)[2]!.path }).fullFile).toBe(true);
    expect(run(s, { id: 'hunk.next' }, { id: 'hunk.next' }).fullFile).toBe(true);
    expect(run(s, { id: 'diff.mode.unified' }).diffJump).toEqual({ hunkId: s.selectedHunk, to: 'hunk', n: s.diffJump.n + 1 });
  });

  it('問題なしを付けても、帯を開いても動かさない', () => {
    const s = inDiff();
    expect(run(s, { id: 'hunk.markViewed' }).diffJump).toBe(s.diffJump);
    expect(run(s, { id: 'fold.open', path: s.selectedFile!, keys: ['x:1'] }).diffJump).toBe(s.diffJump);
  });

  it('ほかの画面へ行くとツリーの明るい行は外れ（diffFile は null）、戻ると今の選びへ揃え直す', () => {
    const s0 = inDiff();
    const b = files(s0)[1]!;
    const s = run(s0, seen(b.path, [b.hunks[0]!.id], s0.diffJump.n));
    const away = run(s, { id: 'view.hows' });
    expect(away.diffFile).toBeNull();
    const back = run(away, { id: 'view.diff' });
    expect(back.diffJump).toEqual({ hunkId: b.hunks[0]!.id, to: 'hunk', n: away.diffJump.n + 1 });
  });

  it('] / [ はツリーで明るいファイル（diffFile）の次 / 前へ', () => {
    const s0 = inDiff();
    const fs = files(s0);
    const s = run(s0, seen(fs[5]!.path, [s0.selectedHunk!, fs[5]!.hunks[0]!.id], s0.diffJump.n));
    expect(s.selectedFile).toBe(fs[0]!.path);
    expect(run(s, { id: 'file.next' }).selectedFile).toBe(fs[6]!.path);
    expect(run(s, { id: 'file.prev' }).selectedFile).toBe(fs[4]!.path);
  });
});

describe('差分一覧の「メモにする」（3.10）', () => {
  const Q = 'applyDiscount を 2 回呼ぶとどうなる？';
  const LINES = { path: ORDER, start: { side: 'head' as const, line: 8 }, end: { side: 'head' as const, line: 11 } };
  const entry: AskEntry = { id: 'e1', key: `hunk:${ORDER_ID}#h8-h11`, place: { kind: 'hunk', hunkId: ORDER_ID, lines: LINES }, question: Q, answer: { lead: 'L', items: [] }, command: 'c', ms: 1, at: '' };

  it('選んでいない別のファイルの行も、移らずにその場で選ぶ（書きかけは消さない。全部のファイルが列にある）', () => {
    const s0 = run(inDiff(), { id: 'ask.loaded', key: '42', headSha: inDiff().analysis!.pr.headSha, entries: [entry] }, { id: 'memo.draft', body: '確認したい。' });
    expect(s0.selectedFile).not.toBe(ORDER);
    const s = run(s0, { id: 'ask.memo', entryId: 'e1' });
    expect(s.view).toBe('diff');
    expect(s.selectedHunk).toBe(s0.selectedHunk);
    expect(s.memo).toMatchObject({ pick: { path: ORDER, anchor: { side: 'RIGHT', line: 8, order: 7 }, head: { side: 'RIGHT', line: 11, order: 10 } }, draft: `確認したい。\n${Q}` });
    expect(s.focusLine).toMatchObject({ path: ORDER, side: 'RIGHT', line: 11 });
  });
});
