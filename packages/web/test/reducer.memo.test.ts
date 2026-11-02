// メモ（設計書 3.3）のコマンド: 行を選ぶ（「+」を押したままなぞると範囲）→ 書いて保存 → 直す・消す。保存した時点で採用済み。GitHub の差分に出ない行には書けない（12 章）
import type { CommentDraft } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
const POLICY = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';
const TEST = 'src/test/kotlin/com/example/order/domain/OrderTest.kt';

function loaded(comments: CommentDraft[] = []): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: { ...emptyReview(), comments } }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
// コース 3 の 1 か所目（domain.Order）の停留所の画面
const atOrder = () => run(loaded(), { id: 'course.enter', courseId: 3, at: 0 });
const pick = (line: number, order: number, path = ORDER, side: 'LEFT' | 'RIGHT' = 'RIGHT'): Command => ({ id: 'memo.pick', path, side, line, order });
const drag = (line: number, order: number, path = ORDER, side: 'LEFT' | 'RIGHT' = 'RIGHT'): Command => ({ id: 'memo.drag', path, side, line, order });
const DROP: Command = { id: 'memo.drop' };

describe('行を選ぶ', () => {
  it('memo.pick（「+」を押す）で 1 行を選び、なぞり始める。離す（memo.drop）まで書く枠は出さない', () => {
    const s = run(atOrder(), pick(8, 9));
    expect(s.memo.pick).toEqual({ path: ORDER, anchor: { side: 'RIGHT', line: 8, order: 9 }, head: { side: 'RIGHT', line: 8, order: 9 } });
    expect(s.memo.drag).toBe(true);
    expect(run(s, DROP).memo.drag).toBe(false);
    expect(run(s, DROP).memo.pick).toEqual(s.memo.pick);
  });

  it('memo.drag（押したままなぞる）で範囲を伸ばす。上へなぞっても、戻っても、今の行までになる', () => {
    const s = run(atOrder(), pick(8, 9), drag(9, 10), drag(11, 12));
    expect(s.memo.pick?.anchor).toEqual({ side: 'RIGHT', line: 8, order: 9 });
    expect(s.memo.pick?.head).toEqual({ side: 'RIGHT', line: 11, order: 12 });
    expect(run(s, drag(6, 7)).memo.pick?.head).toEqual({ side: 'RIGHT', line: 6, order: 7 });
    expect(run(s, drag(8, 9)).memo.pick?.head).toEqual({ side: 'RIGHT', line: 8, order: 9 });
  });

  it('memo.drag は、離した後・選んでいないとき・別のファイルの行では何もしない', () => {
    expect(run(atOrder(), drag(11, 12)).memo.pick).toBeNull();
    const dropped = run(atOrder(), pick(8, 9), DROP);
    expect(run(dropped, drag(11, 12)).memo.pick).toEqual(dropped.memo.pick);
    const s = run(atOrder(), pick(8, 9));
    expect(run(s, drag(10, 3, POLICY)).memo.pick).toEqual(s.memo.pick);
  });

  it('書く枠を開いたまま別の行の「+」を押すと、離すまで元の枠の場所に同じ高さの空きを残す（hold。枠が消えて行がずれると、押した行と違う行まで選ばれる）', () => {
    const open = run(atOrder(), pick(8, 9), DROP);
    const s = run(open, { ...pick(13, 15), hold: 120 } as Command);
    expect(s.memo.hold).toEqual({ pick: open.memo.pick, editing: null, height: 120 });
    expect(s.memo.pick?.head).toEqual({ side: 'RIGHT', line: 13, order: 15 });
    expect(run(s, DROP).memo.hold).toBeUndefined();
    expect(run(s, { id: 'memo.cancel' }).memo.hold).toBeUndefined();
  });

  it('hold は、開いている枠が無いとき（なぞっている途中・何も開いていない）や高さが無いときは残さない', () => {
    expect(run(atOrder(), { ...pick(8, 9), hold: 120 } as Command).memo.hold).toBeUndefined();
    expect(run(atOrder(), pick(8, 9), { ...pick(13, 15), hold: 120 } as Command).memo.hold).toBeUndefined();
    expect(run(atOrder(), pick(8, 9), DROP, pick(13, 15)).memo.hold).toBeUndefined();
  });

  it('やめる（Esc）となぞりも終わる', () => {
    const s = run(atOrder(), pick(8, 9), drag(11, 12), { id: 'memo.cancel' });
    expect(s.memo.pick).toBeNull();
    expect(s.memo.drag).toBe(false);
  });

  it('書きかけの文（memo.draft）は、範囲を伸ばしても行を選び直しても残る。やめる・保存で消える', () => {
    const s = run(atOrder(), pick(8, 9), { id: 'memo.draft', body: '書きかけ' }, drag(11, 12), DROP);
    expect(s.memo.draft).toBe('書きかけ');
    expect(run(s, pick(13, 15)).memo.draft).toBe('書きかけ');
    expect(run(s, { id: 'memo.cancel' }).memo.draft).toBe('');
    expect(run(s, { id: 'memo.save', body: '書きかけ' }).memo.draft).toBe('');
  });

  it('Esc は選んでいる行を外すだけで、コースは出ない。もう一度で出る', () => {
    const s = run(atOrder(), pick(8, 9), { id: 'escape' });
    expect(s.memo.pick).toBeNull();
    expect(s.view).toBe('course');
    expect(run(s, { id: 'escape' }).view).toBe('home');
  });

  it('停留所を移ると選んでいる行は外れる', () => {
    expect(run(atOrder(), pick(8, 9), { id: 'course.jump', i: 1 }).memo.pick).toBeNull();
  });
});

describe('保存する', () => {
  it('memo.save で採用済みのメモを足し、state を保存する。選んでいる行は外れる', () => {
    const r = reduce(run(atOrder(), pick(8, 9), drag(11, 12), DROP), { id: 'memo.save', body: '上書きになる？' });
    expect(r.state.review!.comments).toEqual([{ id: 'm1', path: ORDER, startLine: 8, startSide: 'RIGHT', line: 11, side: 'RIGHT', body: '上書きになる？', source: 'reviewer', state: 'adopted' }]);
    expect(r.effects).toEqual([{ type: 'saveState' }]);
    expect(r.state.memo.pick).toBeNull();
  });

  it('GitHub の差分に出ない行（差分の無いファイル、塊の外の行、片方の端が外の範囲）では何もしない（GitHub はこの行にコメントを付けられない）', () => {
    const policy = run(atOrder(), { id: 'course.jump', i: 1 }, pick(10, 5, POLICY), DROP);
    expect(reduce(policy, { id: 'memo.save', body: '黙って 0？' })).toEqual({ state: policy, effects: [] });
    const outside = run(atOrder(), pick(1, 2), DROP);
    expect(reduce(outside, { id: 'memo.save', body: '塊の外' })).toEqual({ state: outside, effects: [] });
    const across = run(atOrder(), pick(2, 3), drag(8, 9), DROP);
    expect(reduce(across, { id: 'memo.save', body: '片方が外' })).toEqual({ state: across, effects: [] });
  });

  it('GitHub の差分の範囲が無い解析（local と古い解析）では、どの行にも書ける', () => {
    const s0 = atOrder();
    const old = { ...s0, analysis: { ...s0.analysis! } };
    delete old.analysis.githubDiff;
    const s = run(old, pick(1, 2), DROP, { id: 'memo.save', body: '塊の外' });
    expect(s.review!.comments).toEqual([{ id: 'm1', path: ORDER, line: 1, side: 'RIGHT', body: '塊の外', source: 'reviewer', state: 'adopted' }]);
  });

  it('空の本文や、行を選んでいないときは何もしない', () => {
    const s = run(atOrder(), pick(8, 9));
    expect(reduce(s, { id: 'memo.save', body: '   ' })).toEqual({ state: s, effects: [] });
    const t = atOrder();
    expect(reduce(t, { id: 'memo.save', body: 'x' })).toEqual({ state: t, effects: [] });
  });
});

describe('直す・消す', () => {
  const m1: CommentDraft = { id: 'm1', path: ORDER, line: 13, side: 'RIGHT', body: '前', source: 'reviewer', state: 'adopted' };

  it('直す枠を開いたまま「+」を押すと、離すまでそのメモの場所に直す枠と同じ高さの空きを残す', () => {
    const s = run(loaded([m1]), { id: 'course.enter', courseId: 3, at: 0 }, { id: 'memo.edit', commentId: 'm1' }, { ...pick(8, 9), hold: 90 } as Command);
    expect(s.memo.hold).toEqual({ pick: null, editing: 'm1', height: 90 });
    expect(s.memo.editing).toBeNull();
    expect(run(s, DROP).memo.hold).toBeUndefined();
  });

  it('memo.edit で直す枠を開き（選んでいる行は外す。直す文は draft に今の本文から）、memo.update で本文を替えて閉じる', () => {
    const s = run(loaded([m1]), { id: 'course.enter', courseId: 3, at: 0 }, pick(8, 9), { id: 'memo.edit', commentId: 'm1' });
    expect(s.memo).toEqual({ pick: null, editing: 'm1', draft: '前', focus: null, drag: false });
    const r = reduce(s, { id: 'memo.update', commentId: 'm1', body: ' 後 ' });
    expect(r.state.review!.comments).toEqual([{ ...m1, body: '後' }]);
    expect(r.state.memo.editing).toBeNull();
    expect(r.effects).toEqual([{ type: 'saveState' }]);
  });

  it('書きかけのまま「直す」を開くと、書きかけは捨てる（書く枠は一度に 1 つ。別の行を選んでも、書きかけも直していた文も戻ってこない）', () => {
    const s = run(loaded([m1]), { id: 'course.enter', courseId: 3, at: 0 }, pick(8, 9), { id: 'memo.draft', body: '書きかけ' }, { id: 'memo.edit', commentId: 'm1' });
    expect(s.memo.draft).toBe('前');
    expect(run(s, { id: 'memo.draft', body: '前を直す' }, pick(10, 11)).memo.draft).toBe('');
  });

  it('memo.delete で取り除く', () => {
    const r = reduce(loaded([m1]), { id: 'memo.delete', commentId: 'm1' });
    expect(r.state.review!.comments).toEqual([]);
    expect(r.effects).toEqual([{ type: 'saveState' }]);
  });

  it('送信済のメモは直せない・消せない', () => {
    const sent = { ...m1, state: 'sent' as const };
    const s = loaded([sent]);
    expect(reduce(s, { id: 'memo.edit', commentId: 'm1' }).state.memo.editing).toBeNull();
    expect(reduce(s, { id: 'memo.delete', commentId: 'm1' }).state.review!.comments).toEqual([sent]);
  });

  it('Esc は直す枠を閉じるだけ', () => {
    const s = run(loaded([m1]), { id: 'course.enter', courseId: 3, at: 0 }, { id: 'memo.edit', commentId: 'm1' }, { id: 'escape' });
    expect(s.memo.editing).toBeNull();
    expect(s.view).toBe('course');
  });
});

describe('AI の下書きの採用（送れるかは書かない。画面と cli がその場で GitHub の差分から決める）', () => {
  const ai = (line: number): CommentDraft => ({ id: `c${line}`, path: 'src/main/kotlin/com/example/order/api/OrderController.kt', line, side: 'RIGHT', body: 'x', source: 'claude-code', state: 'draft' });

  it('塊に入る行も塊の間の行も、採用すると state だけが変わる', () => {
    const s = run(loaded([ai(11), ai(12)]), { id: 'comment.adopt', commentId: 'c11' }, { id: 'comment.adopt', commentId: 'c12' });
    expect(s.review!.comments).toEqual([
      { ...ai(11), state: 'adopted' },
      { ...ai(12), state: 'adopted' },
    ]);
  });

  it('編集して採用（comment.save）でも同じ', () => {
    const s = run(loaded([ai(12)]), { id: 'comment.save', commentId: 'c12', body: 'y' });
    expect(s.review!.comments).toEqual([{ ...ai(12), state: 'adopted', body: 'y' }]);
  });
});

describe('AI の下書きを直している途中の文（2026-10-13。行の下の箱と締めの箱が同じ文を見る）', () => {
  const ai = (id: string, body = 'x'): CommentDraft => ({ id, path: ORDER, line: 10, side: 'RIGHT', body, source: 'codex', state: 'draft' });

  it('comment.edit で今の本文が入り、comment.text で書き換わる。他の下書きの文は残る', () => {
    const s = run(loaded([ai('c1', 'first'), ai('c2', 'second')]), { id: 'comment.edit', commentId: 'c1' }, { id: 'comment.edit', commentId: 'c2' }, { id: 'comment.text', commentId: 'c1', body: 'first!' });
    expect(s.draftText).toEqual({ c1: 'first!', c2: 'second' });
  });

  it('画面を移っても残り、採用（この文で採用）・戻す・破棄で消える', () => {
    const editing = run(loaded([ai('c1'), ai('c2'), ai('c3')]), ...['c1', 'c2', 'c3'].map((commentId): Command => ({ id: 'comment.edit', commentId })), { id: 'comment.text', commentId: 'c1', body: 'y' });
    const moved = run(editing, { id: 'view.closing' }, { id: 'course.enter', courseId: 3, at: 0 });
    expect(moved.draftText.c1).toBe('y');
    const s = run(moved, { id: 'comment.save', commentId: 'c1', body: 'y' }, { id: 'comment.reset', commentId: 'c2' }, { id: 'comment.discard', commentId: 'c3' });
    expect(s.draftText).toEqual({});
  });

  it('自分のメモと送信済みの下書きには入れない', () => {
    const memo: CommentDraft = { ...ai('m1'), source: 'reviewer', state: 'adopted' };
    const sent: CommentDraft = { ...ai('c9'), state: 'sent' };
    const s = run(loaded([memo, sent]), { id: 'comment.text', commentId: 'm1', body: 'a' }, { id: 'comment.edit', commentId: 'c9' }, { id: 'comment.text', commentId: 'c9', body: 'b' });
    expect(s.draftText).toEqual({});
  });
});

describe('締めの「開く」（comment.open）', () => {
  const memo = (path: string, line: number, side: 'LEFT' | 'RIGHT' = 'RIGHT'): CommentDraft => ({ id: 'm1', path, line, side, body: 'x', source: 'reviewer', state: 'adopted' });
  const open = (c: CommentDraft, courseId?: number) => run(loaded([c]), { id: 'view.closing' }, { id: 'comment.open', commentId: 'm1', ...(courseId === undefined ? {} : { courseId }) });

  it('差分一覧の hunk に入る行は差分一覧へ。メモの行までスクロールする印（focus）を付ける', () => {
    const s = open(memo(ORDER, 8, 'LEFT'));
    expect(s.view).toBe('diff');
    expect(s.selectedFile).toBe(ORDER);
    expect(s.memo.focus).toBe('m1');
  });

  // 2026-10-11: 差分の無いファイルはどの停留所にも無い。差分の無い相手の引き出しでそのファイルを開く（画面はそのまま）
  it('差分の無いファイルのメモは、差分の無い相手の引き出しでその相手を開く', () => {
    const s = open(memo(POLICY, 10));
    expect(s.view).toBe('closing');
    expect(s.rel).toMatchObject({ dir: 'out', sel: s.analysis!.symbols.find((x) => x.fqName.endsWith('DiscountPolicy.rateFor'))!.id });
    expect(s.memo.focus).toBe('m1');
  });

  it('差分のあるファイルでも hunk の外の行（差分一覧に出ない行）は、その行が見えるコースの停留所へ', () => {
    // Order.kt の 1 行目は hunk（3 行目から）の外。コース 3 の 1 か所目で見える
    const s = open(memo(ORDER, 1));
    expect(s.view).toBe('course');
    expect(s.course).toEqual({ id: 3, i: 0, screen: 'stop' });
  });

  it('どの停留所の前後にも入らなければ、同じファイルを通る停留所をファイル全体で', () => {
    // OrderTest.kt の 2 行目はコース 3 のテストの停留所（3 か所目は 10〜21 行目）の前後の外
    const s = open(memo(TEST, 2));
    expect(s.course).toEqual({ id: 3, i: 2, screen: 'stop' });
    expect(s.fullFile).toBe(true);
  });

  it('コースの停留所へ開いたときも、メモの行までスクロールする印（focus）を付ける', () => {
    expect(open(memo(TEST, 2)).memo.focus).toBe('m1');
    // 差分の無い相手の引き出しで開いたときも
    expect(open(memo(POLICY, 10)).memo.focus).toBe('m1');
  });

  it('focus は 1 回きり: 開いた後に画面・選んだ hunk・停留所が変わると外れる（差分一覧に戻るたびに古いメモへ跳ばない）', () => {
    const s = open(memo(ORDER, 8, 'LEFT'));
    expect(run(s, { id: 'view.closing' }, { id: 'view.diff' }).memo.focus).toBeNull();
    expect(run(s, { id: 'hunk.next' }).memo.focus).toBeNull();
    expect(run(open(memo(TEST, 2)), { id: 'course.forward' }).memo.focus).toBeNull();
    // 選んだ行を変えるだけ・書くだけでは外さない（開いた画面のまま）
    expect(run(s, { id: 'memo.draft', body: 'x' }).memo.focus).toBe('m1');
  });

  it('courseId があれば（総括の一覧の「開く」）、そのコースの停留所へ', () => {
    // Order.kt の 13 行目は差分一覧にも出るが、コース 5 の総括から開くとコース 5 の 3 か所目（domain.Order。execute → find → Order）
    const s = open(memo(ORDER, 13), 5);
    expect(s.view).toBe('course');
    expect(s.course).toEqual({ id: 5, i: 2, screen: 'stop' });
  });
});

describe('差分一覧で書く', () => {
  const inDiff = () => run(loaded(), { id: 'view.diff' }, { id: 'file.select', path: ORDER });

  it('選んでいる行は、左右・統合の切り替えでも、別のファイルへ跳んでも外れない（行の並びが同じ。全部のファイルが 1 本の列にある。2026-10-20）', () => {
    const s = run(inDiff(), pick(8, 7), { id: 'memo.draft', body: '書きかけ' });
    expect(run(s, { id: 'diff.mode.unified' }).memo.pick).toEqual(s.memo.pick);
    expect(run(s, { id: 'diff.mode.unified' }).memo.draft).toBe('書きかけ');
    expect(run(s, { id: 'file.select', path: POLICY.replace('DiscountPolicy', 'DiscountCommand') }).memo).toMatchObject({ pick: s.memo.pick, draft: '書きかけ' });
    // 画面を移ると外れる
    expect(run(s, { id: 'view.hows' }).memo.pick).toBeNull();
  });
});
