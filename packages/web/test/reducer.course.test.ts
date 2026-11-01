// コース（設計書 3.3）のコマンド。停留所ごとに 1 画面（2026-10-12）→ 総括。「問題なし」は見たの印で、承認ではない（原則 8）。
import { describe, expect, it } from 'vitest';
import { courses, courseOf, OUTSIDE } from '../src/course.js';
import { currentStop, diffModeOf, initialState, reduce, type AppState } from '../src/state/reducer.js';
import type { Command } from '../src/commands/commands.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

function loaded(): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const inC = () => loaded();
const steps = (s: AppState, id: number) => courseOf(courses(s.analysis!), id)!.steps;
const idOf = (s: AppState, tail: string) => s.analysis!.symbols.find((x) => x.fqName.endsWith(tail))!.id;

describe('コースに入る・出る', () => {
  it('読み込んだ直後は入口で、どのコースにも入っていない', () => {
    expect(inC().view).toBe('home');
    expect(inC().course).toBeNull();
    expect(currentStop(inC())).toBeNull();
  });

  // 2026-10-22: コースに入るとまず読む前の案内（見本を比べて案 1 にした）。i は最初の未確認の停留所（案内の「n か所目へ」の行き先）
  it('course.enter は読む前の案内。i は最初の未確認の停留所', () => {
    const s0 = inC();
    const s1 = run(s0, { id: 'course.enter', courseId: 3 });
    expect(s1.course).toEqual({ id: 3, i: 0, screen: 'brief' });
    const first = steps(s0, 3)[0]!.hunkId!;
    const s2 = run({ ...s0, review: { ...s0.review!, viewed: [first] } }, { id: 'course.enter', courseId: 3 });
    expect(s2.course).toEqual({ id: 3, i: 1, screen: 'brief' });
  });

  it('コース外は読む前の案内を出さず、すぐ停留所の画面', () => {
    expect(run(inC(), { id: 'course.enter', courseId: OUTSIDE }).course).toEqual({ id: OUTSIDE, i: 0, screen: 'stop' });
  });

  it('course.enter の at はその停留所から', () => {
    expect(run(inC(), { id: 'course.enter', courseId: 5, at: 2 }).course).toEqual({ id: 5, i: 2, screen: 'stop' });
  });

  it('知らないコースには入らない', () => {
    const s = inC();
    expect(run(s, { id: 'course.enter', courseId: 99 })).toBe(s);
  });

  it('入口で Enter は次のコース（未完了の最初）に入る', () => {
    const s = run(inC(), { id: 'enter' });
    expect(s.view).toBe('course');
    expect(s.course).toEqual({ id: 1, i: 0, screen: 'brief' });
  });

  it('入口でコースを選んでいれば、Enter はそのコースに入る', () => {
    const s = run(inC(), { id: 'home.select', courseId: 4 }, { id: 'enter' });
    expect(s.course).toEqual({ id: 4, i: 0, screen: 'brief' });
  });

  it('Esc は 地図の引き出し → 覗く → コースを出る の順に閉じる', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 }, { id: 'course.map' });
    expect(s0.courseMap).toBe('side');
    const s1 = run(s0, { id: 'escape' });
    expect(s1.courseMap).toBeNull();
    expect(s1.course).not.toBeNull();
    const s2 = run(s1, { id: 'map.peek', symbolId: idOf(s1, 'api.OrderResponse') }, { id: 'escape' });
    expect(s2.peek).toBeNull();
    expect(s2.course).not.toBeNull();
    const s3 = run(s2, { id: 'escape' });
    expect(s3.course).toBeNull();
    expect(s3.view).toBe('home');
  });

  it('course.leave は入口へ', () => {
    const s = run(inC(), { id: 'course.enter', courseId: 3, at: 0 }, { id: 'course.leave' });
    expect(s.view).toBe('home');
    expect(s.course).toBeNull();
  });

  it('別の画面へ移って戻っても、いたコースの場所に戻る', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    const away = run(s0, { id: 'view.diff' });
    expect(away.view).toBe('diff');
    expect(run(away, { id: 'view.course' })).toMatchObject({ view: 'course', course: s0.course });
    // 目的ごと・差分一覧の画面で Esc を押すと、いたコースへ戻る
    expect(run(away, { id: 'escape' })).toMatchObject({ view: 'course', course: s0.course });
  });

  it('全体図へ移るとコースを出る', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    expect(run(s0, { id: 'view.home' })).toMatchObject({ view: 'home', course: null });
  });

  it('コースに入っていなければ view.course は何もしない', () => {
    const s = inC();
    expect(run(s, { id: 'view.course' })).toBe(s);
  });
});

describe('読む前の案内（2026-10-22）', () => {
  const brief = (id = 5) => run(inC(), { id: 'course.enter', courseId: id });

  it('Enter（course.forward）と course.ok は最初の未確認の停留所へ。問題なしは付けない', () => {
    const s = run(brief(), { id: 'enter' });
    expect(s.course).toEqual({ id: 5, i: 0, screen: 'stop' });
    expect(s.review!.viewed).toEqual([]);
    const s0 = inC();
    const seen = { ...s0, review: { ...s0.review!, viewed: [steps(s0, 5)[0]!.hunkId!, steps(s0, 5)[1]!.hunkId!] } };
    expect(run(seen, { id: 'course.enter', courseId: 5 }, { id: 'course.ok' }).course).toEqual({ id: 5, i: 2, screen: 'stop' });
  });

  it('最初の停留所の 前へ（←）と hunk.prev は読む前の案内へ。読む前の案内の 前へ は何もしない', () => {
    const s = run(brief(), { id: 'enter' }, { id: 'course.prev' });
    expect(s.course).toEqual({ id: 5, i: 0, screen: 'brief' });
    expect(run(s, { id: 'course.prev' }).course).toEqual({ id: 5, i: 0, screen: 'brief' });
    expect(run(brief(), { id: 'enter' }, { id: 'hunk.prev' }).course).toEqual({ id: 5, i: 0, screen: 'brief' });
    expect(run(brief(), { id: 'hunk.next' }).course).toEqual({ id: 5, i: 0, screen: 'stop' });
  });

  it('course.brief はどの画面からも読む前の案内へ（いた停留所は残す）。コース外では何もしない', () => {
    expect(run(inC(), { id: 'course.enter', courseId: 5, at: 3 }, { id: 'course.brief' }).course).toEqual({ id: 5, i: 3, screen: 'brief' });
    const out = run(inC(), { id: 'course.enter', courseId: OUTSIDE });
    expect(run(out, { id: 'course.brief' })).toBe(out);
  });

  it('もう一度（course.again）は読む前の案内から', () => {
    const last = steps(inC(), 5).length - 1;
    expect(run(inC(), { id: 'course.enter', courseId: 5, at: last }, { id: 'course.ok' }, { id: 'course.again' }).course).toEqual({ id: 5, i: 0, screen: 'brief' });
  });

  it('course.check は確かめることを選ぶ・もう一度で外す。停留所を移ると外れる', () => {
    const s = run(brief(), { id: 'course.check', n: 2 });
    expect(s.course).toEqual({ id: 5, i: 0, screen: 'brief', check: 2 });
    expect(run(s, { id: 'course.check', n: 2 }).course).toEqual({ id: 5, i: 0, screen: 'brief' });
    expect(run(s, { id: 'course.check', n: 3 }).course?.check).toBe(3);
    const stop = run(inC(), { id: 'course.enter', courseId: 5, at: 0 }, { id: 'course.check', n: 1 });
    expect(stop.course?.check).toBe(1);
    expect(run(stop, { id: 'course.ok' }).course).toEqual({ id: 5, i: 1, screen: 'stop' });
  });

  it('地図・ファイル全体・右の列をたたむは読む前の案内では効かない', () => {
    const s = brief();
    expect(run(s, { id: 'course.map' })).toBe(s);
    expect(run(s, { id: 'file.full' })).toBe(s);
    expect(run(s, { id: 'course.fold' })).toBe(s);
  });

  it('読む前の案内から覗くと、読む前の案内のまま覗く。line があればその行を光らせる。Esc で覗くのをやめる', () => {
    const apply = idOf(inC(), 'OrderController.apply');
    const s = run(brief(), { id: 'map.peek', symbolId: apply, line: 18 });
    expect(s.course).toEqual({ id: 5, i: 0, screen: 'brief' });
    expect(s.peek).toEqual({ kind: 'symbol', symbolId: apply });
    expect(s.focusLine).toMatchObject({ path: 'src/main/kotlin/com/example/order/api/OrderController.kt', side: 'RIGHT', line: 18 });
    expect(run(s, { id: 'escape' })).toMatchObject({ peek: null, course: { id: 5, i: 0, screen: 'brief' } });
    expect(run(brief(), { id: 'map.peek', symbolId: apply, line: 18, endLine: 19 }).focusLine).toMatchObject({ line: 18, endLine: 19 });
  });
});

describe('停留所の画面の左右 / 統合', () => {
  it('停留所の画面では diff.mode.unified / sbs が設定（ui.json）の diffMode.c を変えて保存する（既定は左右）', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    expect(diffModeOf(s0).c).toBe('sbs');
    const r = reduce(s0, { id: 'diff.mode.unified' });
    expect(diffModeOf(r.state)).toEqual({ b: 'sbs', c: 'uni', d: 'sbs' });
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
    expect(diffModeOf(run(r.state, { id: 'diff.mode.sbs' })).c).toBe('sbs');
  });

  it('総括（コードが無い）では何もしない', () => {
    const s0 = inC();
    const sum = run(s0, { id: 'course.enter', courseId: 3, at: steps(s0, 3).length - 1 }, { id: 'course.ok' });
    expect(sum.course?.screen).toBe('summary');
    expect(reduce(sum, { id: 'diff.mode.unified' })).toEqual({ state: sum, effects: [] });
  });
});

describe('停留所 → 次の停留所', () => {
  it('Enter は「問題なし · 次へ」（今の停留所に問題なしを付けて次の停留所へ）', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    const r = reduce(s0, { id: 'enter' });
    expect(r.state.course).toEqual({ id: 3, i: 1, screen: 'stop' });
    expect(r.state.review!.viewed).toEqual([steps(s0, 3)[0]!.hunkId]);
    expect(r.effects).toEqual([{ type: 'saveState' }]);
  });

  it('→ は Enter と同じ、← は前の停留所（先頭では読む前の案内へ。問題なしは外さない）', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    const s1 = run(s0, { id: 'course.forward' });
    expect(s1.course).toEqual({ id: 3, i: 1, screen: 'stop' });
    const back = run(s1, { id: 'course.prev' });
    expect(back.course).toEqual({ id: 3, i: 0, screen: 'stop' });
    expect(back.review!.viewed).toEqual([steps(s0, 3)[0]!.hunkId]);
    expect(run(back, { id: 'course.prev' }).course).toEqual({ id: 3, i: 0, screen: 'brief' });
  });

  it('目的ごと・差分一覧・締めの画面では → / ← / m / Shift+M / b は何もしない（いたコースの場所は残り、問題なしも付かず、地図とたたみも変わらない）', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 1 });
    for (const view of [{ id: 'view.hows' }, { id: 'view.diff' }, { id: 'view.closing' }] as const) {
      const away = run(s0, view);
      for (const c of [{ id: 'course.forward' }, { id: 'course.prev' }, { id: 'course.map' }, { id: 'course.mapBig' }, { id: 'course.fold' }] as const) expect(reduce(away, c), `${view.id} ${c.id}`).toEqual({ state: away, effects: [] });
    }
  });

  // 2026-10-11: 停留所は差分だけなので、「問題なし」はいつもその hunk の viewed（差分の無いコードに印は付けない）
  it('どの停留所にも差分がある（「問題なし」は viewed に付く）', () => {
    const s0 = inC();
    for (const c of courses(s0.analysis!)) for (const st of c.steps) expect(st.hunkId ?? s0.analysis!.symbols.find((x) => x.id === st.symbolId)?.hunkId, `${c.id}:${st.symbolId}`).toBeDefined();
  });

  it('「問題なし」はトグルしない（もう一度押しても外れない）', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 }, { id: 'course.ok' }, { id: 'course.jump', i: 0 });
    expect(run(s0, { id: 'course.ok' }).review!.viewed).toEqual([steps(s0, 3)[0]!.hunkId]);
  });

  it('最後の停留所の「問題なし」で総括へ', () => {
    const s0 = inC();
    const last = steps(s0, 2).length - 1;
    expect(run(s0, { id: 'course.enter', courseId: 2, at: last }, { id: 'course.ok' }).course).toEqual({ id: 2, i: last, screen: 'summary' });
  });

  it('course.jump はその停留所の画面へ（総括からも）', () => {
    const g = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    expect(run(g, { id: 'course.jump', i: 2 }).course).toEqual({ id: 3, i: 2, screen: 'stop' });
    const last = steps(g, 3).length - 1;
    const sum = run(g, { id: 'course.jump', i: last }, { id: 'course.ok' });
    expect(sum.course?.screen).toBe('summary');
    expect(run(sum, { id: 'course.jump', i: 1 }).course).toEqual({ id: 3, i: 1, screen: 'stop' });
    expect(run(g, { id: 'course.jump', i: 99 }).course).toEqual(g.course);
  });

  it('j / k は停留所を移るだけ（問題なしを付けない）', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    const s1 = run(s0, { id: 'hunk.next' });
    expect(s1.course).toEqual({ id: 3, i: 1, screen: 'stop' });
    expect(s1.review!.viewed).toEqual([]);
    expect(run(s1, { id: 'hunk.prev' }).course?.i).toBe(0);
  });

  it('F はファイル全体と前後だけを切り替え、停留所を移ると前後だけに戻る', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 }, { id: 'file.full' });
    expect(s0.fullFile).toBe(true);
    expect(run(s0, { id: 'file.full' }).fullFile).toBe(false);
    expect(run(s0, { id: 'course.ok' }).fullFile).toBe(false);
  });

  it('M は停留所の画面で地図の引き出しを開き、もう一度で閉じる。総括では何もしない', () => {
    const g = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    expect(run(g, { id: 'course.map' }).courseMap).toBe('side');
    expect(run(g, { id: 'course.map' }, { id: 'course.map' }).courseMap).toBeNull();
    const last = steps(g, 3).length - 1;
    const sum = run(g, { id: 'course.jump', i: last }, { id: 'course.ok' });
    expect(sum.course?.screen).toBe('summary');
    expect(run(sum, { id: 'course.map' }).courseMap).toBeNull();
  });

  it('Shift+M は閉じていれば大きく開き、開いていれば引き出しと大きくを入れ替える（大きさは覚えない）', () => {
    const g = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    expect(run(g, { id: 'course.mapBig' }).courseMap).toBe('big');
    expect(run(g, { id: 'course.map' }, { id: 'course.mapBig' }).courseMap).toBe('big');
    expect(run(g, { id: 'course.mapBig' }, { id: 'course.mapBig' }).courseMap).toBe('side');
    // 大きいときの M は閉じる。次に M で開くと引き出しから
    expect(run(g, { id: 'course.mapBig' }, { id: 'course.map' }).courseMap).toBeNull();
    expect(run(g, { id: 'course.mapBig' }, { id: 'course.map' }, { id: 'course.map' }).courseMap).toBe('side');
  });

  it('大きく開いた地図も Esc で閉じる。停留所を移ると閉じる', () => {
    const big = run(inC(), { id: 'course.enter', courseId: 3, at: 0 }, { id: 'course.mapBig' });
    const s1 = run(big, { id: 'escape' });
    expect(s1.courseMap).toBeNull();
    expect(s1.course).not.toBeNull();
    expect(run(big, { id: 'course.jump', i: 1 }).courseMap).toBeNull();
    expect(run(big, { id: 'course.ok' }).courseMap).toBeNull();
  });

  it('v は今の停留所の hunk に効く', () => {
    const s0 = inC();
    const s1 = run(s0, { id: 'course.enter', courseId: 3, at: 0 });
    expect(run(s1, { id: 'hunk.markViewed' }).review!.viewed).toEqual([steps(s0, 3)[0]!.hunkId]);
  });
});

describe('左の案内をたたむ（B。2026-10-12）', () => {
  it('最初は開いている。B（course.fold）でたたみ、もう一度で出す。保存しない', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    expect(s0.courseFolded).toBe(false);
    const r = reduce(s0, { id: 'course.fold' });
    expect(r.state.courseFolded).toBe(true);
    expect(r.effects).toEqual([]);
    expect(run(r.state, { id: 'course.fold' }).courseFolded).toBe(false);
  });

  it('たたんだまま、次の停留所・ほかの停留所・次のコースへ進み、コースを出て入り直しても保つ', () => {
    const f = run(inC(), { id: 'course.enter', courseId: 1, at: 0 }, { id: 'course.fold' });
    expect(run(f, { id: 'course.ok' }).courseFolded).toBe(true);
    expect(run(f, { id: 'course.jump', i: 0 }).courseFolded).toBe(true);
    const left = run(f, { id: 'course.leave' });
    expect(left.courseFolded).toBe(true);
    expect(run(left, { id: 'course.enter', courseId: 3, at: 0 }).courseFolded).toBe(true);
    const last = steps(f, 1).length - 1;
    expect(run(f, { id: 'course.jump', i: last }, { id: 'course.ok' }, { id: 'course.complete' })).toMatchObject({ course: { id: 2 }, courseFolded: true });
  });

  it('総括とコースの外では何もしない', () => {
    const g = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    const sum = run(g, { id: 'course.jump', i: steps(g, 3).length - 1 }, { id: 'course.ok' });
    expect(reduce(sum, { id: 'course.fold' })).toEqual({ state: sum, effects: [] });
    const home = inC();
    expect(reduce(home, { id: 'course.fold' })).toEqual({ state: home, effects: [] });
  });
});

describe('総括', () => {
  const atSummary = (id: number) => {
    const s0 = inC();
    return run(s0, { id: 'course.enter', courseId: id, at: steps(s0, id).length - 1 }, { id: 'course.ok' });
  };

  it('完了にすると保存し、次の未完了のコースの読む前の案内へ', () => {
    const r = reduce(atSummary(1), { id: 'enter' });
    expect(r.state.review!.course?.completed).toEqual([1]);
    expect(r.state.course).toEqual({ id: 2, i: 0, screen: 'brief' });
    expect(r.effects).toEqual([{ type: 'saveState' }]);
  });

  it('全部完了なら締めへ（コースは出る）', () => {
    const s0 = atSummary(7);
    const s = run({ ...s0, review: { ...s0.review!, course: { done: [], completed: [1, 2, 3, 4, 5, 6] } } }, { id: 'course.complete' });
    expect(s.review!.course?.completed).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.course).toBeNull();
    expect(s.view).toBe('closing');
  });

  it('コース外は「見終えた」で完了の数に入れない', () => {
    const s = run(atSummary(OUTSIDE), { id: 'course.complete' });
    expect(s.review!.course?.completed ?? []).toEqual([]);
    expect(s.course?.id).toBe(1);
  });

  it('もう一度は読む前の案内から', () => {
    expect(run(atSummary(3), { id: 'course.again' }).course).toEqual({ id: 3, i: 0, screen: 'brief' });
  });

  it('← は最後の停留所へ', () => {
    const s = atSummary(3);
    expect(run(s, { id: 'course.prev' }).course).toEqual({ id: 3, i: 3, screen: 'stop' });
  });
});

describe('関連の箱を覗く（3.3。2026-09-26 の形をコースに移した）', () => {
  const peeking = () => {
    const s = run(inC(), { id: 'course.enter', courseId: 3, at: 1 }, { id: 'course.map' });
    return run(s, { id: 'map.peek', symbolId: idOf(s, 'api.OrderResponse') });
  };

  it('map.peek は停留所の画面のコードをその箱のコードに替え、地図の引き出しは閉じる。停留所・見たは変えない', () => {
    const s = peeking();
    expect(s.peek).toEqual({ kind: 'symbol', symbolId: idOf(s, 'api.OrderResponse') });
    expect(s.courseMap).toBeNull();
    expect(s.course).toEqual({ id: 3, i: 1, screen: 'stop' });
    expect(s.review!.viewed).toEqual([]);
  });

  it('コースに入っていない・知らないシンボルなら覗かない', () => {
    const s = inC();
    expect(run(s, { id: 'map.peek', symbolId: idOf(s, 'api.OrderResponse') }).peek).toBeNull();
    expect(run(s, { id: 'course.enter', courseId: 3, at: 0 }, { id: 'map.peek', symbolId: 'nope' }).peek).toBeNull();
  });

  it('覗いている間の 問題なし / 前へ / j / k / 呼んでいる相手 は、読んでいた停留所に戻るだけ', () => {
    const s0 = peeking();
    for (const c of [{ id: 'course.ok' }, { id: 'course.forward' }, { id: 'course.prev' }, { id: 'hunk.next' }, { id: 'hunk.prev' }, { id: 'jump.callee' }] as const) {
      const r = reduce(s0, c);
      expect(r.state.peek, c.id).toBeNull();
      expect(r.state.course, c.id).toEqual(s0.course);
      expect(r.state.review!.viewed, c.id).toEqual([]);
      expect(r.state.showPalette, c.id).toBe(false);
    }
  });

  it('覗いている間の v と「IDEAで開く」は覗いた箱の hunk に効く', () => {
    const s0 = peeking();
    const hunk = s0.analysis!.hunks.find((h) => h.id === idOf(s0, 'api.OrderResponse'))!;
    expect(run(s0, { id: 'hunk.markViewed' }).review!.viewed).toEqual([hunk.id]);
    expect(reduce(s0, { id: 'jump.ide' }).effects).toEqual([
      { type: 'openUrl', url: `jetbrains://idea/navigate/reference?project=order-service&path=${encodeURIComponent(hunk.path + ':' + hunk.lnNew)}` },
    ]);
  });

  it('停留所を移る・別の画面へ移ると、覗くのをやめる', () => {
    expect(run(peeking(), { id: 'course.jump', i: 0 }).peek).toBeNull();
    expect(run(peeking(), { id: 'view.hows' }).peek).toBeNull();
  });

  // 2026-10-20: 左のツリーは差分の全ファイル。ほかのコースのファイルを押すと、今の停留所のままそのファイルを覗く
  it('course.peekFile は停留所の画面のコードをそのファイルに替える。停留所はそのまま、Esc と停留所を移るで戻る', () => {
    const PROMO = 'src/main/kotlin/com/example/promo/PromoService.kt';
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 1 }, { id: 'course.map' });
    const s1 = run(s0, { id: 'course.peekFile', path: PROMO });
    expect(s1.peek).toEqual({ kind: 'file', path: PROMO });
    expect(s1.courseMap).toBeNull();
    expect(s1.course).toEqual({ id: 3, i: 1, screen: 'stop' });
    expect(s1.review!.viewed).toEqual([]);
    const back = run(s1, { id: 'escape' });
    expect(back.peek).toBeNull();
    expect(back.course).toEqual(s1.course);
    expect(run(s1, { id: 'course.jump', i: 0 }).peek).toBeNull();
  });

  it('覗いているファイルを左でもう一度押しても、覗いている行と光っている行はそのまま', () => {
    const PROMO = 'src/main/kotlin/com/example/promo/PromoService.kt';
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 1 });
    const withLine = { ...s0, peek: { kind: 'file' as const, path: PROMO, line: { side: 'RIGHT' as const, line: 5 } }, focusLine: { path: PROMO, side: 'RIGHT' as const, line: 5, n: 1 } };
    const again = run(withLine, { id: 'course.peekFile', path: PROMO });
    expect(again.peek).toEqual(withLine.peek);
    expect(again.focusLine).toEqual(withLine.focusLine);
  });

  it('差分に無いファイル・停留所の画面の外では course.peekFile は何もしない', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    expect(run(s0, { id: 'course.peekFile', path: 'nope.kt' }).peek).toBeNull();
    expect(run(inC(), { id: 'course.peekFile', path: 'src/main/kotlin/com/example/promo/PromoService.kt' }).peek).toBeNull();
  });

  it('地図の束の箱は How 分解の画面で束を開く（コースの How で絞り込む）', () => {
    const s0 = run(inC(), { id: 'course.enter', courseId: 3, at: 0 });
    const rep = s0.analysis!.hunks.find((h) => h.group)!.group!.representative;
    const s1 = run(s0, { id: 'group.reveal', hunkId: rep });
    expect(s1.view).toBe('hows');
    expect(s1.openGroups).toEqual([rep]);
    expect(s1.selectedHunk).toBe(rep);
    expect(s1.selectedHow).toBe(3);
  });
});

describe('呼んでいる相手へ飛ぶ（3.6）', () => {
  const atExecute = () => {
    const s = inC();
    const k = steps(s, 5).findIndex((st) => st.symbolId === idOf(s, 'ApplyDiscountUseCase.execute'));
    return run(s, { id: 'course.enter', courseId: 5, at: k });
  };
  const pickCallee = (s: AppState, tail: string) => run(s, { id: 'jump.callee' }, { id: 'palette.pick', target: { kind: 'callee', symbolId: idOf(s, tail) } });

  it('jump.callee は今の停留所のシンボルを起点にパレットを開く。コースに入っていなければ何もしない', () => {
    const s0 = atExecute();
    const s1 = run(s0, { id: 'jump.callee' });
    expect(s1.showPalette).toBe(true);
    expect(s1.paletteFrom).toBe(idOf(s0, 'ApplyDiscountUseCase.execute'));
    const none = inC();
    expect(run(none, { id: 'jump.callee' })).toBe(none);
  });

  it('相手が今のコースの停留所なら、その停留所へ', () => {
    const s = pickCallee(atExecute(), 'OrderRepositoryImpl.save');
    expect(s.showPalette).toBe(false);
    expect(s.course?.id).toBe(5);
    expect(s.course?.screen).toBe('stop');
    expect(currentStop(s)?.symbolId).toBe(idOf(s, 'OrderRepositoryImpl.save'));
  });

  it('別のコースの停留所なら、そのコースの停留所へ', () => {
    const s = pickCallee(atExecute(), 'OrderAdminView.discountField');
    expect(s.course?.id).toBe(3);
    expect(currentStop(s)?.symbolId).toBe(idOf(s, 'OrderAdminView.discountField'));
  });

  // 2026-10-11: 差分の無い相手は停留所にならない。呼んでいる停留所の箱の引き出しでその相手を出す
  it('差分の無い相手なら、今の停留所はそのままで、引き出しにその相手を出す', () => {
    const s0 = atExecute();
    const s = pickCallee(s0, 'OrderRepository.save');
    expect(s.showPalette).toBe(false);
    expect(s.course).toEqual(s0.course);
    expect(s.rel).toMatchObject({ host: idOf(s0, 'ApplyDiscountUseCase.execute'), dir: 'out', sel: idOf(s0, 'OrderRepository.save') });
  });

  it('どの停留所にも無く差分があれば、How 分解の画面でその hunk を選ぶ', () => {
    const s0 = atExecute();
    const s = pickCallee(s0, 'Logger.format');
    expect(s.view).toBe('hows');
    expect(s.selectedHunk).toBe(s0.analysis!.symbols.find((x) => x.fqName.endsWith('Logger.format'))!.hunkId);
  });

  it('飛び先が無ければパレットを閉じるだけ', () => {
    const s0 = atExecute();
    const s = pickCallee(s0, 'Logger.log');
    expect(s.showPalette).toBe(false);
    expect(s.course).toEqual(s0.course);
  });
});

describe('保存した進み具合', () => {
  it('古い state（course 欄なし）でも読める。欄があればそのまま使う', () => {
    const a = fixtureAnalysis();
    const summary = { key: 'local', headSha: a.pr.headSha, pr: a.pr, mtime: 1, repoName: 'x' };
    const s = reduce(initialState(), { id: 'data.loaded', summary, analysis: a, review: { ...emptyReview(), course: { done: ['3:x'], completed: [1] } } }).state;
    expect(s.review!.course).toEqual({ done: ['3:x'], completed: [1] });
    expect(s.course).toBeNull();
  });
});
