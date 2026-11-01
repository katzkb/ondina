// 名前から定義へ（設計書 3.6。2026-10-29。見本を比べて「右に出す」にした）。差分一覧の画面で名前を ⌘+クリックする。
// 差分の列の行なら列をそこへ動かして光らせ、⌘[ で押した行へ戻る。差分の列に無ければ右の引き出しに出し、引き出しの中でも続けて移る。
// ⇧R で引き出しを大きく、Esc で読んでいた差分に戻る。ライブラリなら知らせるだけ
import { describe, expect, it } from 'vitest';
import type { Analysis } from '@ondina/model';
import type { Command } from '../src/commands/commands.js';
import { courses, stepPath } from '../src/course.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const D = 'src/main/kotlin/com/example/order/';
const CONTROLLER = `${D}api/OrderController.kt`;

function loaded(analysis: Analysis = fixtureAnalysis()): AppState {
  const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const inDiff = () => run(loaded(), { id: 'view.diff' });

/** OrderController（head）の名前を差分の列で押す */
const click = (line: number, col: number, name: string): Command => ({ id: 'def.go', side: 'head', path: CONTROLLER, line, col, name, back: { path: CONTROLLER, side: 'RIGHT', line } });
const EXECUTE = click(18, 28, 'execute');
const SAVE = click(19, 19, 'save');
const POST = click(16, 5, 'PostMapping');
/** 引き出しの中（OrderRepository.kt）の名前を押す */
const inRepo = (line: number, col: number, name: string): Command => ({ id: 'def.go', side: 'head', path: `${D}domain/OrderRepository.kt`, line, col, name });

describe('差分の列の中の定義', () => {
  it('列をその行へ動かして光らせ、押した行を戻り先に積む（引き出しは開かない）', () => {
    const s = run(inDiff(), EXECUTE);
    expect(s.def).toBeNull();
    expect(s.focusLine).toMatchObject({ path: `${D}application/ApplyDiscountUseCase.kt`, side: 'RIGHT', line: 15 });
    expect(s.defBack).toEqual([{ path: CONTROLLER, side: 'RIGHT', line: 18 }]);
  });

  it('⌘[ で押した行へ戻って光らせる。戻り先が無ければ何もしない', () => {
    const s1 = run(inDiff(), EXECUTE);
    const s2 = run(s1, { id: 'def.back' });
    expect(s2.focusLine).toMatchObject({ path: CONTROLLER, side: 'RIGHT', line: 18 });
    expect(s2.focusLine!.n).toBeGreaterThan(s1.focusLine!.n);
    expect(s2.defBack).toEqual([]);
    expect(run(s2, { id: 'def.back' })).toEqual(s2);
  });

  it('差分の列をスクロールしても光らせた行は残る（移った先から外さない）', () => {
    const s = run(inDiff(), EXECUTE);
    expect(run(s, { id: 'diff.viewport', file: `${D}application/ApplyDiscountUseCase.kt`, hunks: [], n: s.diffJump.n }).focusLine).toEqual(s.focusLine);
  });
});

describe('差分の列に無い定義（右の引き出し）', () => {
  it('引き出しに出す。見出しの名前は押した名前、戻り先は押した行', () => {
    const s = run(inDiff(), SAVE);
    expect(s.def).toEqual({ stack: [{ target: { side: 'head', path: `${D}domain/OrderRepository.kt`, line: 5, col: 8 }, name: 'save' }], big: false, from: { path: CONTROLLER, side: 'RIGHT', line: 19 } });
    expect(s.defBack).toEqual([]);
  });

  it('引き出しの中で押せば積む。⌘[ で前の定義、最後の 1 つで閉じる', () => {
    const s1 = run(inDiff(), SAVE, inRepo(4, 17, 'OrderId'));
    expect(s1.def!.stack.map((x) => x.name)).toEqual(['save', 'OrderId']);
    expect(s1.def!.stack[1]!.target).toEqual({ side: 'head', path: `${D}domain/OrderId.kt`, line: 3, col: 11 });
    const s2 = run(s1, { id: 'def.back' });
    expect(s2.def!.stack.map((x) => x.name)).toEqual(['save']);
    expect(run(s2, { id: 'def.back' }).def).toBeNull();
  });

  it('引き出しの中の名前の定義が差分の列にあれば、引き出しを閉じて列を動かし、引き出しを開いた行を戻り先に積む', () => {
    const s = run(inDiff(), SAVE, inRepo(5, 20, 'Order'));
    expect(s.def).toBeNull();
    expect(s.focusLine).toMatchObject({ path: `${D}domain/Order.kt`, side: 'RIGHT', line: 3 });
    expect(s.defBack).toEqual([{ path: CONTROLLER, side: 'RIGHT', line: 19 }]);
  });

  it('⇧R（rel.big）で大きく / 元の大きさ。Esc で閉じる', () => {
    const s1 = run(inDiff(), SAVE, { id: 'rel.big' });
    expect(s1.def!.big).toBe(true);
    expect(run(s1, { id: 'rel.big' }).def!.big).toBe(false);
    const s2 = run(s1, { id: 'escape' });
    expect(s2.def).toBeNull();
    expect(s2.view).toBe('diff');
  });

  it('閉じるボタン（def.close）で閉じる', () => {
    expect(run(inDiff(), SAVE, { id: 'def.close' }).def).toBeNull();
  });
});

describe('ライブラリ・答えの無い名前・ほかの画面', () => {
  it('ライブラリなら右下に知らせるだけ（jar の名前つき）', () => {
    const s = run(inDiff(), POST);
    expect(s.def).toBeNull();
    expect(s.defBack).toEqual([]);
    expect(s.github.toast).toMatchObject({ message: 'PostMapping の定義はライブラリの中です', reason: 'spring-web-6.2.0.jar（ライブラリのコードは出しません）', tone: 'info' });
  });

  it('答えの無い名前（宣言そのもの）は何もしない', () => {
    const s0 = inDiff();
    expect(run(s0, click(17, 8, 'apply'))).toEqual(s0);
  });

  it('コードを出していない画面（入口）では何もしない', () => {
    const s0 = loaded();
    expect(run(s0, SAVE)).toEqual(s0);
  });

  it('画面を替えると、引き出しも戻り先も消える', () => {
    const s = run(inDiff(), EXECUTE, SAVE, { id: 'view.hows' });
    expect(s.def).toBeNull();
    expect(s.defBack).toEqual([]);
  });
});

// コースの画面と目的ごとの画面（2026-10-29。差分一覧と同じく、どちらの画面でも定義へ移れるようにした）。コード欄は 1 ファイルなので、
// 行き先が今コード欄に出ているファイルの行ならそこへ移って光らせ、ほかは定義の引き出し。停留所・選んだ差分・コースの進みは動かさない
const REPO_IMPL = `${D}infra/OrderRepositoryImpl.kt`;
/** OrderController の 18 行目の useCase（定義は同じファイルの 13 行目。差分の外） */
const USE_CASE = click(18, 20, 'useCase');

/** そのファイルが停留所になっているコースと、その停留所の画面 */
function stopOn(path: string): AppState {
  const s = loaded();
  for (const c of courses(s.analysis!)) {
    const i = c.steps.findIndex((st) => stepPath(s.analysis!, st) === path);
    if (i >= 0) return run(s, { id: 'course.enter', courseId: c.id, at: i });
  }
  throw new Error(`no stop on ${path}`);
}

/** 目的ごとの画面で、そのファイルの hunk（n 番目）を選んだところ */
function howOn(path: string, n = 0): AppState {
  const s = run(loaded(), { id: 'view.hows' });
  return run(s, { id: 'hunk.select', hunkId: s.analysis!.hunks.filter((h) => h.path === path)[n]!.id });
}

describe('コースの画面の名前から定義へ', () => {
  it('今の停留所のファイルの行なら、その行へ移って光らせ、押した行を戻り先に積む（停留所は動かさない）', () => {
    const s0 = stopOn(CONTROLLER);
    const s = run(s0, USE_CASE);
    expect(s.course).toEqual(s0.course);
    expect(s.def).toBeNull();
    expect(s.focusLine).toMatchObject({ path: CONTROLLER, side: 'RIGHT', line: 13 });
    expect(s.defBack).toEqual([{ path: CONTROLLER, side: 'RIGHT', line: 18 }]);
    const back = run(s, { id: 'def.back' });
    expect(back.focusLine).toMatchObject({ path: CONTROLLER, side: 'RIGHT', line: 18 });
    expect(back.defBack).toEqual([]);
  });

  it('ほかのファイルなら、差分の列にある行（ほかの停留所の差分）でも定義の引き出しに出す', () => {
    const s0 = stopOn(CONTROLLER);
    const s = run(s0, EXECUTE);
    expect(s.course).toEqual(s0.course);
    expect(s.def?.stack.map((x) => x.target)).toEqual([expect.objectContaining({ side: 'head', path: `${D}application/ApplyDiscountUseCase.kt`, line: 15 })]);
    expect(s.def?.from).toEqual({ path: CONTROLLER, side: 'RIGHT', line: 18 });
    expect(run(s0, SAVE).def?.stack[0]?.target).toEqual({ side: 'head', path: `${D}domain/OrderRepository.kt`, line: 5, col: 8 });
  });

  it('引き出しの中の名前の定義が今の停留所のファイルにあれば、引き出しを閉じてその行へ移り、引き出しを開いた行を戻り先に積む', () => {
    // fixture には停留所のファイルを指す名前を持つ引き出しのファイルが無い（参照は上の層から下の層へ）ので、
    // 引き出しの中で押したのと同じ形（戻り先なし）のコマンドを直接渡す。行き先は OrderController の 13 行目
    const s0 = run(stopOn(CONTROLLER), SAVE);
    const s = run(s0, { id: 'def.go', side: 'head', path: CONTROLLER, line: 18, col: 20, name: 'useCase' });
    expect(s.def).toBeNull();
    expect(s.focusLine).toMatchObject({ path: CONTROLLER, side: 'RIGHT', line: 13 });
    expect(s.defBack).toEqual([{ path: CONTROLLER, side: 'RIGHT', line: 19 }]);
  });

  it('ライブラリなら右下に知らせるだけ', () => {
    const s = run(stopOn(CONTROLLER), POST);
    expect(s.def).toBeNull();
    expect(s.github.toast).toMatchObject({ message: 'PostMapping の定義はライブラリの中です', tone: 'info' });
  });

  it('停留所を移ると、引き出しも戻り先も消える', () => {
    const s = run(stopOn(CONTROLLER), USE_CASE, SAVE);
    expect(s.def).not.toBeNull();
    expect(s.defBack).toHaveLength(1);
    const moved = run(s, { id: 'course.jump', i: s.course!.i + 1 });
    expect(moved.def).toBeNull();
    expect(moved.defBack).toEqual([]);
  });

  it('覗いているファイルがコード欄なら、そのファイルの行へ移る。覗くのをやめると戻り先は消える', () => {
    const s0 = run(stopOn(CONTROLLER), { id: 'course.peekFile', path: REPO_IMPL });
    const s = run(s0, { id: 'def.go', side: 'head', path: REPO_IMPL, line: 15, col: 8, name: 'jdbc', back: { path: REPO_IMPL, side: 'RIGHT', line: 15 } });
    expect(s.peek).toEqual(s0.peek);
    expect(s.focusLine).toMatchObject({ path: REPO_IMPL, side: 'RIGHT', line: 12 });
    expect(run(s, { id: 'map.unpeek' }).defBack).toEqual([]);
  });

  it('定義の引き出しと地図・差分のない相手の引き出しは同時に開かない', () => {
    const s0 = stopOn(CONTROLLER);
    const opened = run(s0, { id: 'course.map' }, SAVE);
    expect(opened.courseMap).toBeNull();
    expect(opened.def).not.toBeNull();
    expect(run(opened, { id: 'course.map' }).def).toBeNull();
    expect(run(opened, { id: 'rel.toggle' }).def).toBeNull();
  });

  it('読む前の案内の画面（コードを出していない）では何もしない', () => {
    const s0 = run(loaded(), { id: 'course.enter', courseId: courses(loaded().analysis!).find((c) => c.steps.some((st) => stepPath(loaded().analysis!, st) === CONTROLLER))!.id });
    expect(s0.course?.screen).toBe('brief');
    expect(run(s0, USE_CASE)).toEqual(s0);
  });
});

describe('目的ごとの画面の名前から定義へ', () => {
  it('プレビューのファイルの行なら、その行へ移って光らせる（選んだ差分は動かさない）。⌘[ で戻る', () => {
    const s0 = howOn(CONTROLLER);
    const s = run(s0, USE_CASE);
    expect(s.selectedHunk).toBe(s0.selectedHunk);
    expect(s.def).toBeNull();
    expect(s.focusLine).toMatchObject({ path: CONTROLLER, side: 'RIGHT', line: 13 });
    expect(run(s, { id: 'def.back' }).focusLine).toMatchObject({ path: CONTROLLER, line: 18 });
  });

  it('ほかのファイルなら定義の引き出しに出す', () => {
    expect(run(howOn(CONTROLLER), EXECUTE).def?.stack[0]?.target).toMatchObject({ path: `${D}application/ApplyDiscountUseCase.kt`, line: 15 });
  });

  it('同じファイルのほかの差分を選んでも戻り先は残る。ほかのファイルの差分を選ぶと引き出しも戻り先も消える', () => {
    const jdbc: Command = { id: 'def.go', side: 'head', path: REPO_IMPL, line: 15, col: 8, name: 'jdbc', back: { path: REPO_IMPL, side: 'RIGHT', line: 15 } };
    const s = run(howOn(REPO_IMPL), jdbc);
    expect(s.focusLine).toMatchObject({ path: REPO_IMPL, line: 12 });
    const other = s.analysis!.hunks.filter((h) => h.path === REPO_IMPL)[1]!.id;
    const same = run(s, { id: 'hunk.select', hunkId: other });
    expect(same.defBack).toEqual([{ path: REPO_IMPL, side: 'RIGHT', line: 15 }]);
    const elsewhere = run(s, { id: 'def.go', side: 'head', path: REPO_IMPL, line: 13, col: 4, name: 'OrderRepository' }, { id: 'hunk.select', hunkId: s.analysis!.hunks.find((h) => h.path === CONTROLLER)!.id });
    expect(elsewhere.def).toBeNull();
    expect(elsewhere.defBack).toEqual([]);
  });
});
