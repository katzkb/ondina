// 案内人に聞く（設計書 3.10）のコマンド: 開く（場所を留める）→ 送る（副作用 ask）→ 答え / 失敗 / 止める、行の場所を押す、Esc の順。
// 停留所の画面では引き出しを使わず、右の列が質問の欄（2026-10-20）
import type { AskEntry } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { courseOf, courses } from '../src/course.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const ORDER_ID = '98dcd7c9d8d6e0ed59854b2fff454f5bf805bae7';
const ORDER_KT = 'src/main/kotlin/com/example/order/domain/Order.kt';
const POLICY_KT = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';
const TEST_KT = 'src/test/kotlin/com/example/order/domain/OrderTest.kt';

function loaded(): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const atOrder = () => run(loaded(), { id: 'course.enter', courseId: 3, at: 0 });
/** コース 3 の総括（停留所は 4 か所） */
const atSummary = () => run(loaded(), { id: 'course.enter', courseId: 3, at: 3 }, { id: 'course.ok' });
const entry = (key: string, question = 'q'): AskEntry => ({ id: `e-${question}`, key, place: { kind: 'pr' }, question, answer: { lead: 'L', items: [] }, command: 'c', ms: 1, at: '' });

describe('開く・閉じる', () => {
  it('解析を読むと会話の記録を取りに行き（loadAsk）、引き出しは閉じている', () => {
    const analysis = fixtureAnalysis();
    const summary = { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
    const r = reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() });
    expect(r.effects).toContainEqual({ type: 'loadAsk', key: '42', headSha: analysis.pr.headSha });
    expect(r.state.ask.open).toBe(false);
  });

  it('ask.toggle で今の画面の場所で開き、もう一度で閉じる', () => {
    const s = run(atSummary(), { id: 'ask.toggle' });
    expect(s.ask).toMatchObject({ open: true, place: { kind: 'course', courseId: 3 }, key: 'course:3' });
    expect(run(s, { id: 'ask.toggle' }).ask.open).toBe(false);
  });

  it('開いている間は場所を留める（画面が移っても会話は替わらない）。開き直すと今の場所', () => {
    const s = run(loaded(), { id: 'ask.toggle' }, { id: 'view.diff' });
    expect(s.ask.key).toBe('pr');
    expect(run(s, { id: 'ask.close' }, { id: 'ask.toggle' }).ask.key).toBe(`hunk:${s.selectedHunk}`);
  });

  it('Esc は設定の次に引き出しを閉じる（コースは出ない）', () => {
    const s = run(atSummary(), { id: 'ask.toggle' }, { id: 'escape' });
    expect(s.ask.open).toBe(false);
    expect(s.view).toBe('course');
  });

  it('記録を受け取る（今の解析の分だけ）', () => {
    const s = loaded();
    const r = run(s, { id: 'ask.loaded', key: '42', headSha: s.analysis!.pr.headSha, entries: [entry('pr')] });
    expect(r.ask.log).toHaveLength(1);
    expect(run(s, { id: 'ask.loaded', key: '9', headSha: s.analysis!.pr.headSha, entries: [entry('pr')] }).ask.log).toHaveLength(0);
  });
});

describe('送る・答え・失敗・止める', () => {
  const open = () => run(loaded(), { id: 'ask.toggle' });

  it('ask.send で待つ問いを置き、副作用 ask を出す。書きかけは空に', () => {
    const s = run(open(), { id: 'ask.draft', text: '合計は？' });
    const r = reduce(s, { id: 'ask.send', question: ' 合計は？ ', now: 1000 });
    expect(r.state.ask.pending).toEqual({ key: 'pr', place: { kind: 'pr' }, question: '合計は？', startedAt: 1000 });
    expect(r.state.ask.draft).toBe('');
    expect(r.effects).toEqual([{ type: 'ask', key: 'pr', place: { kind: 'pr' }, question: '合計は？' }]);
  });

  it('空の問い・待っている間・開いていないときは送らない', () => {
    expect(reduce(open(), { id: 'ask.send', question: '  ', now: 1 }).effects).toEqual([]);
    const waiting = run(open(), { id: 'ask.send', question: 'a', now: 1 });
    expect(reduce(waiting, { id: 'ask.send', question: 'b', now: 2 }).effects).toEqual([]);
    expect(reduce(loaded(), { id: 'ask.send', question: 'a', now: 1 }).effects).toEqual([]);
  });

  it('答えが来たら記録に足し、待つ問いを外す。閉じている間に来たら、その場所に答えが来た印', () => {
    const waiting = run(open(), { id: 'ask.send', question: 'a', now: 1 });
    const s = run(waiting, { id: 'ask.done', entry: entry('pr', 'a') });
    expect(s.ask).toMatchObject({ pending: null, unread: [] });
    expect(s.ask.log.map((e) => e.question)).toEqual(['a']);
    const closed = run(waiting, { id: 'ask.close' }, { id: 'ask.done', entry: entry('pr', 'a') });
    expect(closed.ask.unread).toEqual(['pr']);
    expect(run(closed, { id: 'ask.toggle' }).ask.unread).toEqual([]);
  });

  it('開いた引き出しが別の場所なら、来た答えの場所の印は残る', () => {
    const waiting = run(open(), { id: 'ask.send', question: 'a', now: 1 }, { id: 'ask.close' }, { id: 'view.diff' }, { id: 'ask.toggle' });
    expect(run(waiting, { id: 'ask.done', entry: entry('pr', 'a') }).ask.unread).toEqual(['pr']);
  });

  it('失敗したら理由を残し、ask.retry で同じ問いを送り直す', () => {
    const waiting = run(open(), { id: 'ask.send', question: 'a', now: 1 });
    const failed = run(waiting, { id: 'ask.failed', key: 'pr', question: 'a', reason: '終了コード 2: boom' });
    expect(failed.ask).toMatchObject({ pending: null, failed: { key: 'pr', question: 'a', reason: '終了コード 2: boom' } });
    const r = reduce(failed, { id: 'ask.retry', now: 5 });
    expect(r.effects).toEqual([{ type: 'ask', key: 'pr', place: { kind: 'pr' }, question: 'a' }]);
    expect(r.state.ask.failed).toBeNull();
  });

  it('ask.stop で待つ問いを外し、副作用 askStop を出す。問いは書きかけに戻す', () => {
    const waiting = run(open(), { id: 'ask.send', question: 'a', now: 1 });
    const r = reduce(waiting, { id: 'ask.stop' });
    expect(r.state.ask.pending).toBeNull();
    expect(r.state.ask.draft).toBe('a');
    expect(r.effects).toEqual([{ type: 'askStop' }]);
  });

  it('別の解析を読むと、待っている問いを止める', () => {
    const waiting = run(open(), { id: 'ask.send', question: 'a', now: 1 });
    const analysis = fixtureAnalysis();
    const summary = { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
    const r = reduce(waiting, { id: 'data.loaded', summary, analysis, review: emptyReview() });
    expect(r.effects).toContainEqual({ type: 'askStop' });
    expect(r.state.ask.pending).toBeNull();
  });
});

describe('行の場所を押す（ask.cite）', () => {
  it('停留所の画面で今の停留所に見える行なら、移らずにその行へ（focusLine）', () => {
    const s = run(atOrder(), { id: 'ask.cite', cite: { path: ORDER_KT, side: 'head', line: 13 } });
    expect(s.course).toEqual({ id: 3, i: 0, screen: 'stop' });
    expect(s.peek).toBeNull();
    expect(s.focusLine).toMatchObject({ path: ORDER_KT, side: 'RIGHT', line: 13 });
    expect(s.ask).toMatchObject({ open: false, key: `symbol:${ORDER_ID}` });
  });

  it('同じファイルで前後 3 行の外ならファイル全体にする', () => {
    // コース 3 の 3 か所目（OrderTest のテスト）は 10〜21 行目だけ見える。2 行目は畳まれている
    const s = run(loaded(), { id: 'course.enter', courseId: 3, at: 2 }, { id: 'ask.cite', cite: { path: TEST_KT, side: 'head', line: 2 } });
    expect(s.course).toEqual({ id: 3, i: 2, screen: 'stop' });
    expect(s.fullFile).toBe(true);
  });

  // 2026-10-20: 停留所を移ると右の列の会話が替わり、読んでいた答えが消える。移らずにそのファイルを覗く
  it('停留所の画面で今の停留所に見えない行は、停留所を移らずにそのファイルを覗き、その行を光らせる。右の列の会話はそのまま', () => {
    const s = run(atOrder(), { id: 'ask.cite', cite: { path: TEST_KT, side: 'head', line: 18 } });
    expect(s.course).toEqual({ id: 3, i: 0, screen: 'stop' });
    expect(s.peek).toEqual({ kind: 'file', path: TEST_KT, line: { side: 'RIGHT', line: 18 } });
    expect(s.focusLine).toMatchObject({ path: TEST_KT, side: 'RIGHT', line: 18 });
    expect(s.ask).toMatchObject({ open: false, key: `symbol:${ORDER_ID}` });
  });

  it('差分の無いファイルの行も、全文があれば停留所の画面で覗く', () => {
    const s = run(atOrder(), { id: 'ask.cite', cite: { path: POLICY_KT, side: 'head', line: 9 } });
    expect(s.course).toEqual({ id: 3, i: 0, screen: 'stop' });
    expect(s.peek).toEqual({ kind: 'file', path: POLICY_KT, line: { side: 'RIGHT', line: 9 } });
    expect(s.rel).toBeNull();
  });

  it('覗いている間に今の停留所に見える行を押すと、覗くのをやめてその行へ', () => {
    const s = run(atOrder(), { id: 'ask.cite', cite: { path: TEST_KT, side: 'head', line: 18 } }, { id: 'ask.cite', cite: { path: ORDER_KT, side: 'head', line: 13 } });
    expect(s.peek).toBeNull();
    expect(s.focusLine).toMatchObject({ path: ORDER_KT, line: 13 });
  });

  // 2026-10-11: 差分の無いファイルはどの停留所にも無い。差分の無い相手の引き出しでそのファイルを開く
  it('停留所の画面の外では、どの停留所にも見えない差分の無いファイルの行は、差分の無い相手の引き出しで開く', () => {
    const s = run(loaded(), { id: 'ask.toggle' }, { id: 'ask.cite', cite: { path: POLICY_KT, side: 'head', line: 9 } });
    expect(s.rel).toMatchObject({ dir: 'out', sel: s.analysis!.symbols.find((x) => x.fqName.endsWith('DiscountPolicy.rateFor'))!.id });
    expect(s.focusLine).toMatchObject({ path: POLICY_KT, side: 'RIGHT', line: 9 });
  });

  it('全文の無い古い解析で停留所の画面から出るときは、引き出しで同じ会話を出し続ける', () => {
    const analysis = { ...fixtureAnalysis() };
    delete analysis.files;
    const summary = { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
    const s0 = run(reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state, { id: 'course.enter', courseId: 3, at: 1 });
    const s = run(s0, { id: 'ask.cite', cite: { path: ORDER_KT, side: 'base', line: 6 } });
    expect(s.view).toBe('diff');
    expect(s.ask).toMatchObject({ open: true, key: s0.ask.key });
  });

  it('入口からは締めの「開く」と同じ道: 差分一覧の hunk（base 側は LEFT）', () => {
    const s = run(loaded(), { id: 'ask.toggle' }, { id: 'ask.cite', cite: { path: ORDER_KT, side: 'base', line: 6 } });
    expect(s.view).toBe('diff');
    expect(s.selectedFile).toBe(ORDER_KT);
    expect(s.focusLine).toMatchObject({ side: 'LEFT', line: 6 });
  });

  it('押すたびに印の番号が進む（同じ行をもう一度押しても光る）。画面が移ると外れる', () => {
    const a = run(atOrder(), { id: 'ask.cite', cite: { path: ORDER_KT, side: 'head', line: 13 } });
    const b = run(a, { id: 'ask.cite', cite: { path: ORDER_KT, side: 'head', line: 13 } });
    expect(b.focusLine!.n).toBe(a.focusLine!.n + 1);
    expect(run(b, { id: 'course.forward' }).focusLine).toBeNull();
  });
});

describe('行で聞く・メモにする（3.10 の決めごと 2）', () => {
  const Q = 'applyDiscount を 2 回呼ぶとどうなる？';
  const LINES = { path: ORDER_KT, start: { side: 'head' as const, line: 8 }, end: { side: 'head' as const, line: 11 } };
  // コース 3 の 1 か所目（domain.Order）で 8〜11 行目を選ぶ。並びはファイル全体の行の何番目か（8 行目 = 9、11 行目 = 12）
  const picked = () => run(atOrder(), { id: 'memo.pick', path: ORDER_KT, side: 'RIGHT', line: 8, order: 9 }, { id: 'memo.drag', path: ORDER_KT, side: 'RIGHT', line: 11, order: 12 }, { id: 'memo.drop' });
  const PICK = { path: ORDER_KT, anchor: { side: 'RIGHT', line: 8, order: 9 }, head: { side: 'RIGHT', line: 11, order: 12 } };
  const lineEntry = (place: AskEntry['place'], key: string, question = Q): AskEntry => ({ ...entry(key, question), id: `e-${key}`, place });
  const withLog = (s: AppState, ...es: AskEntry[]) => run(s, { id: 'ask.loaded', key: '42', headSha: s.analysis!.pr.headSha, entries: es });
  const asked = () => {
    const s = run(picked(), { id: 'ask.lines' });
    return withLog(s, lineEntry(s.ask.place!, s.ask.key!));
  };

  it('書く枠の「聞く」（ask.lines）で、選んでいる行について聞く。停留所の画面では引き出しを開かず、右の列の入力欄へ', () => {
    const s0 = picked();
    const s = run(s0, { id: 'ask.lines' });
    expect(s.ask).toMatchObject({ open: false, place: { kind: 'symbol', symbolId: ORDER_ID, courseId: 3, lines: LINES }, key: `symbol:${ORDER_ID}#h8-h11`, focusN: s0.ask.focusN + 1 });
    expect(s.memo.pick).toEqual(PICK);
  });

  it('Q（ask.toggle）も、選んでいる行があればその行について開く', () => {
    expect(run(picked(), { id: 'ask.toggle' }).ask.key).toBe(`symbol:${ORDER_ID}#h8-h11`);
  });

  it('「聞く」を押すと、何についてを選んでいる行に替える。行が無ければ何もしない', () => {
    const s = run(atOrder(), { id: 'ask.toggle' }, { id: 'memo.pick', path: ORDER_KT, side: 'RIGHT', line: 13, order: 15 }, { id: 'ask.lines' });
    expect(s.ask).toMatchObject({ open: false, key: `symbol:${ORDER_ID}#h13-h13` });
    const none = run(atOrder(), { id: 'ask.toggle' });
    expect(run(none, { id: 'ask.lines' })).toEqual(none);
  });

  it('「× 場所全体にする」（ask.whole）で行を外し、場所の会話に戻る', () => {
    const s = run(picked(), { id: 'ask.lines' }, { id: 'ask.whole' });
    expect(s.ask).toMatchObject({ place: { kind: 'symbol', symbolId: ORDER_ID, courseId: 3 }, key: `symbol:${ORDER_ID}` });
    expect(s.ask.place).not.toHaveProperty('lines');
  });

  it('メモにする: 選んでいる行が聞いた行なら、その書く枠に質問の文を入れるだけ（移らない）', () => {
    const s = run(asked(), { id: 'ask.memo', entryId: `e-symbol:${ORDER_ID}#h8-h11` });
    expect(s.memo).toMatchObject({ pick: PICK, draft: Q });
    expect(s.course).toEqual({ id: 3, i: 0, screen: 'stop' });
    expect(s.ask.memoed).toEqual({ entryId: `e-symbol:${ORDER_ID}#h8-h11`, label: '8〜11 行目' });
  });

  it('入れた知らせは書く枠を閉じると消える（保存・やめる・停留所を移る）。もう一度「メモにする」を押せる', () => {
    const s = run(asked(), { id: 'ask.memo', entryId: `e-symbol:${ORDER_ID}#h8-h11` });
    expect(run(s, { id: 'memo.save', body: Q }).ask.memoed).toBeNull();
    expect(run(s, { id: 'memo.cancel' }).ask.memoed).toBeNull();
    expect(run(s, { id: 'course.jump', i: 1 }).ask.memoed).toBeNull();
    expect(run(s, { id: 'memo.draft', body: 'x' }).ask.memoed).not.toBeNull();
  });

  it('メモにする: 書きかけは消さず後ろに足す。2 回押しても重ならない', () => {
    const s = run(asked(), { id: 'memo.draft', body: '確認したい。' }, { id: 'ask.memo', entryId: `e-symbol:${ORDER_ID}#h8-h11` }, { id: 'ask.memo', entryId: `e-symbol:${ORDER_ID}#h8-h11` });
    expect(s.memo.draft).toBe(`確認したい。\n${Q}`);
  });

  it('メモにする: 別の停留所へ移った後なら、聞いた行が見える停留所へ戻って選び直す（その行へスクロール）', () => {
    const s = run(asked(), { id: 'course.jump', i: 1 }, { id: 'ask.memo', entryId: `e-symbol:${ORDER_ID}#h8-h11` });
    expect(s.course).toEqual({ id: 3, i: 0, screen: 'stop' });
    expect(s.memo).toMatchObject({ pick: PICK, draft: Q, editing: null });
    expect(s.focusLine).toMatchObject({ path: ORDER_KT, side: 'RIGHT', line: 11 });
  });

  it('メモにする: 差分一覧で聞いた行なら、差分一覧のその行を選び直す（並びは差分の行の何番目か）', () => {
    const s0 = run(loaded(), { id: 'view.diff' }, { id: 'file.select', path: ORDER_KT }, { id: 'memo.pick', path: ORDER_KT, side: 'RIGHT', line: 8, order: 7 }, { id: 'memo.drag', path: ORDER_KT, side: 'RIGHT', line: 11, order: 10 }, { id: 'memo.drop' }, { id: 'ask.lines' });
    expect(s0.ask.place).toEqual({ kind: 'hunk', hunkId: ORDER_ID, lines: LINES });
    const s = run(withLog(s0, lineEntry(s0.ask.place!, s0.ask.key!)), { id: 'view.home' }, { id: 'ask.memo', entryId: `e-${s0.ask.key!}` });
    expect(s.view).toBe('diff');
    expect(s.memo).toMatchObject({ pick: { path: ORDER_KT, anchor: { side: 'RIGHT', line: 8, order: 7 }, head: { side: 'RIGHT', line: 11, order: 10 } }, draft: Q });
  });

  it('行の無い問い（コードの場所）のメモにする: 行を選ぶよう案内し、次に選んだ行の書く枠に質問の文を入れる', () => {
    const s0 = withLog(run(atOrder(), { id: 'ask.toggle' }), lineEntry({ kind: 'symbol', symbolId: ORDER_ID, courseId: 3 }, `symbol:${ORDER_ID}`));
    const s = run(s0, { id: 'ask.memo', entryId: `e-symbol:${ORDER_ID}` });
    expect(s.ask.memoFor).toEqual({ entryId: `e-symbol:${ORDER_ID}`, question: Q });
    expect(s.memo.pick).toBeNull();
    const t = run(s, { id: 'memo.pick', path: ORDER_KT, side: 'RIGHT', line: 13, order: 15 });
    expect(t.memo.draft).toBe(Q);
    expect(t.ask.memoFor).toBeNull();
    expect(t.ask.memoed).toEqual({ entryId: `e-symbol:${ORDER_ID}`, label: '13 行目' });
    // なぞって伸ばすと知らせの行も伸びる
    expect(run(t, { id: 'memo.drag', path: ORDER_KT, side: 'RIGHT', line: 14, order: 16 }).ask.memoed!.label).toBe('13〜14 行目');
  });

  it('行を選ぶ案内は「やめる」・閉じる・次の送るで消える（閉じたまま行を選んで文が入る、を起こさない）', () => {
    const s0 = withLog(run(atOrder(), { id: 'ask.toggle' }), lineEntry({ kind: 'symbol', symbolId: ORDER_ID, courseId: 3 }, `symbol:${ORDER_ID}`));
    const s = run(s0, { id: 'ask.memo', entryId: `e-symbol:${ORDER_ID}` });
    expect(run(s, { id: 'ask.memoCancel' }).ask.memoFor).toBeNull();
    const closed = run(s, { id: 'ask.close' });
    expect(closed.ask.memoFor).toBeNull();
    expect(run(closed, { id: 'memo.pick', path: ORDER_KT, side: 'RIGHT', line: 13, order: 15 }).memo.draft).toBe('');
    expect(run(s, { id: 'ask.send', question: '次', now: 1 }).ask.memoFor).toBeNull();
  });

  it('PR 全体・コースの答えには「メモにする」が効かない', () => {
    const s0 = withLog(run(loaded(), { id: 'ask.toggle' }), entry('pr'));
    expect(run(s0, { id: 'ask.memo', entryId: 'e-q' })).toEqual(s0);
  });

  it('行を選ぶ案内の間に GitHub の差分に出ない行を選んでも、質問の文は入れず、案内は残す（メモを書けない行）', () => {
    const s0 = withLog(run(atOrder(), { id: 'ask.toggle' }), lineEntry({ kind: 'symbol', symbolId: ORDER_ID, courseId: 3 }, `symbol:${ORDER_ID}`));
    const s = run(s0, { id: 'ask.memo', entryId: `e-symbol:${ORDER_ID}` });
    // Order.kt の GitHub の差分の塊は head 側 3〜14 行目。1 行目は外
    const t = run(s, { id: 'memo.pick', path: ORDER_KT, side: 'RIGHT', line: 1, order: 2 });
    expect(t.memo.pick).toMatchObject({ path: ORDER_KT, anchor: { side: 'RIGHT', line: 1 } });
    expect(t.memo.draft).toBe('');
    expect(t.ask.memoFor).toEqual({ entryId: `e-symbol:${ORDER_ID}`, question: Q });
    expect(run(t, { id: 'memo.pick', path: ORDER_KT, side: 'RIGHT', line: 13, order: 15 }).memo.draft).toBe(Q);
  });

  it('GitHub の差分に出ない行について聞いた問いには「メモにする」が効かない（行を選ぶ案内も出さない）', () => {
    const place = { kind: 'symbol' as const, symbolId: ORDER_ID, courseId: 3, lines: { path: ORDER_KT, start: { side: 'head' as const, line: 1 }, end: { side: 'head' as const, line: 2 } } };
    const s0 = withLog(run(atOrder(), { id: 'ask.toggle' }), lineEntry(place, 'k'));
    expect(run(s0, { id: 'ask.memo', entryId: 'e-k' })).toEqual(s0);
  });

  it('聞いた行を出せない（全文の無い古い解析で、差分の外の行）ときは、行を選ぶ案内に落ちる', () => {
    // 全文の無い古い解析には GitHub の差分の範囲も無い
    const analysis = { ...fixtureAnalysis() };
    delete analysis.files;
    delete analysis.githubDiff;
    const summary = { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
    const s0 = run(reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state, { id: 'ask.toggle' });
    const place = { kind: 'symbol' as const, symbolId: ORDER_ID, courseId: 3, lines: { path: ORDER_KT, start: { side: 'head' as const, line: 1 }, end: { side: 'head' as const, line: 2 } } };
    const s = run(withLog(s0, lineEntry(place, 'k')), { id: 'ask.memo', entryId: 'e-k' });
    expect(s.memo.pick).toBeNull();
    expect(s.ask.memoFor).toEqual({ entryId: 'e-k', question: Q });
  });
});

describe('停留所の画面の右の列（3.10。2026-10-20）', () => {
  const STOP0 = `symbol:${ORDER_ID}`;
  const keyAt = (s: AppState, i: number) => `symbol:${courseOf(courses(s.analysis!), 3)!.steps[i]!.symbolId}`;
  const PROMO_KT = 'src/main/kotlin/com/example/promo/PromoService.kt';
  const RATE_FOR = () => loaded().analysis!.symbols.find((x) => x.fqName.endsWith('DiscountPolicy.rateFor'))!.id;

  it('何については今の停留所。停留所を移る（course.jump / course.ok / course.prev）と替わり、覗く（map.peek / course.peekFile）では替わらない', () => {
    const s0 = atOrder();
    expect(s0.ask).toMatchObject({ open: false, place: { kind: 'symbol', symbolId: ORDER_ID, courseId: 3 }, key: STOP0 });
    expect(run(s0, { id: 'course.jump', i: 1 }).ask.key).toBe(keyAt(s0, 1));
    expect(run(s0, { id: 'course.ok' }).ask.key).toBe(keyAt(s0, 1));
    expect(run(s0, { id: 'course.jump', i: 2 }, { id: 'course.prev' }).ask.key).toBe(keyAt(s0, 1));
    expect(run(s0, { id: 'map.peek', symbolId: RATE_FOR() }).ask.key).toBe(STOP0);
    expect(run(s0, { id: 'course.peekFile', path: PROMO_KT }).ask.key).toBe(STOP0);
  });

  it('停留所の画面に入ると引き出しは閉じる。総括に出ても閉じたまま（勝手に開かない）', () => {
    const s = run(loaded(), { id: 'ask.toggle' }, { id: 'course.enter', courseId: 3, at: 3 });
    expect(s.ask).toMatchObject({ open: false, key: keyAt(s, 3) });
    const summary = run(s, { id: 'course.ok' });
    expect(summary.course?.screen).toBe('summary');
    expect(summary.ask.open).toBe(false);
  });

  it('引き出しが閉じていても送れる。たたんでいる間は送らない', () => {
    const r = reduce(atOrder(), { id: 'ask.send', question: 'promo は？', now: 1 });
    expect(r.effects).toEqual([{ type: 'ask', key: STOP0, place: { kind: 'symbol', symbolId: ORDER_ID, courseId: 3 }, question: 'promo は？' }]);
    expect(reduce(run(atOrder(), { id: 'course.fold' }), { id: 'ask.send', question: 'promo は？', now: 1 }).effects).toEqual([]);
  });

  it('Q（ask.toggle）は右の入力欄へ: たたんでいれば開き、入力欄に移る印（focusN）が進む。引き出しは開かない', () => {
    const s0 = run(atOrder(), { id: 'course.fold' });
    const s1 = run(s0, { id: 'ask.toggle' });
    expect(s1.courseFolded).toBe(false);
    expect(s1.ask).toMatchObject({ open: false, key: STOP0, focusN: s0.ask.focusN + 1 });
    expect(run(s1, { id: 'ask.toggle' }).ask.focusN).toBe(s0.ask.focusN + 2);
  });

  it('答えが来た印: 今の停留所の答えには付かない。別の停留所の答えには付き、その停留所に戻ると外れる', () => {
    const waiting = run(atOrder(), { id: 'ask.send', question: 'a', now: 1 });
    expect(run(waiting, { id: 'ask.done', entry: entry(STOP0, 'a') }).ask.unread).toEqual([]);
    const away = run(waiting, { id: 'course.jump', i: 1 }, { id: 'ask.done', entry: entry(STOP0, 'a') });
    expect(away.ask.unread).toEqual([STOP0]);
    expect(run(away, { id: 'course.jump', i: 0 }).ask.unread).toEqual([]);
  });

  it('右の列をたたんでいる間に来た答え・失敗には印が付き、開くと外れる', () => {
    const waiting = run(atOrder(), { id: 'ask.send', question: 'a', now: 1 }, { id: 'course.fold' });
    const done = run(waiting, { id: 'ask.done', entry: entry(STOP0, 'a') });
    expect(done.ask.unread).toEqual([STOP0]);
    expect(run(done, { id: 'course.fold' }).ask.unread).toEqual([]);
    expect(run(waiting, { id: 'ask.failed', key: STOP0, question: 'a', reason: 'x' }).ask.unread).toEqual([STOP0]);
  });

  it('一番上へ・一番下へ（ask.top / ask.bottom）で、会話を送る印（scroll）が進む', () => {
    const s0 = atOrder();
    const s1 = run(s0, { id: 'ask.top' });
    expect(s1.ask.scroll).toEqual({ to: 'top', n: s0.ask.scroll.n + 1 });
    expect(run(s1, { id: 'ask.bottom' }).ask.scroll).toEqual({ to: 'bottom', n: s0.ask.scroll.n + 2 });
  });
});
