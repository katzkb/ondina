// 差分の無い相手の引き出し（設計書 3.3。2026-10-11。見本 3 版を比べて決めた）。
// 地図の「差分なし n か所」の箱か R で、右から引き出す。↑↓ で次の相手、Esc で読んでいた差分に戻る。Shift+R で真ん中いっぱい。見た印は付かない
import { describe, expect, it } from 'vitest';
import { courses } from '../src/course.js';
import { mapNodeOf } from '../src/map/graph.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import type { Command } from '../src/commands/commands.js';
import { emptyReview, fixtureAnalysis, fixtureWithNeighbors } from './fixture.js';
import type { Analysis } from '@ondina/model';

function loaded(analysis: Analysis = fixtureAnalysis()): AppState {
  const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const idOf = (s: AppState, tail: string) => s.analysis!.symbols.find((x) => x.fqName.endsWith(tail))!.id;
const nameOf = (s: AppState, id: string | null) => s.analysis!.symbols.find((x) => x.id === id)?.fqName.split('.').slice(-2).join('.');
/** コース 5（execute から始まる）の最初の停留所の画面 */
const inCode = (a?: Analysis) => run(loaded(a), { id: 'course.enter', courseId: 5, at: 0 });

describe('引き出しを開く・閉じる', () => {
  it('初めは閉じている。rel.open で開き、既定は呼び出し元（無ければ呼び出し先）の最初の相手。保存はしない', () => {
    const s0 = loaded();
    expect(s0.rel).toBeNull();
    const exec = idOf(s0, 'ApplyDiscountUseCase.execute');
    const r = reduce(s0, { id: 'rel.open', host: exec });
    expect(r.state.rel).toEqual({ host: exec, dir: 'out', layer: null, sel: idOf(s0, 'OrderRepository.save'), size: 'side' });
    expect(r.effects).toEqual([]);
  });

  it('層と相手を指定して開ける。層で絞った一覧の最初、相手を指定すればその相手', () => {
    const s0 = loaded(fixtureWithNeighbors());
    const order = idOf(s0, 'domain.Order');
    expect(run(s0, { id: 'rel.open', host: order, layer: 'Application' }).rel).toMatchObject({ dir: 'in', layer: 'Application' });
    expect(nameOf(s0, run(s0, { id: 'rel.open', host: order, layer: 'Application' }).rel!.sel)).toBe('BillingUseCase.execute');
    const exec = idOf(s0, 'ApplyDiscountUseCase.execute');
    const s1 = run(s0, { id: 'rel.open', host: exec, dir: 'out', sel: idOf(s0, 'OrderRepository.save') });
    expect(nameOf(s0, s1.rel!.sel)).toBe('OrderRepository.save');
  });

  it('相手の無い箱では開かない', () => {
    const s0 = loaded();
    const s1 = run(s0, { id: 'rel.open', host: idOf(s0, 'api.OrderDetailResponse') });
    expect(s1.rel).toBeNull();
  });

  it('rel.close と Esc で閉じる。Esc は引き出しを先に閉じ、コースは出ない', () => {
    const s0 = inCode();
    const exec = mapNodeOf(s0.analysis!)(idOf(s0, 'ApplyDiscountUseCase.execute'));
    const open = run(s0, { id: 'rel.open', host: exec });
    expect(run(open, { id: 'rel.close' }).rel).toBeNull();
    const esc = run(open, { id: 'escape' });
    expect([esc.rel, esc.view, esc.course?.i]).toEqual([null, 'course', 0]);
    const home = run(loaded(), { id: 'rel.open', host: exec }, { id: 'escape' });
    expect([home.rel, home.view]).toEqual([null, 'home']);
  });

  it('地図の引き出しとは同時に開かない（どちらかを開くともう片方は閉じる）', () => {
    const s0 = inCode();
    const exec = idOf(s0, 'ApplyDiscountUseCase.execute');
    const withMap = run(s0, { id: 'course.map' });
    const rel = run(withMap, { id: 'rel.open', host: exec });
    expect([rel.courseMap, rel.rel?.host]).toEqual([null, exec]);
    expect(run(rel, { id: 'course.map' })).toMatchObject({ courseMap: 'side', rel: null });
    expect(run(rel, { id: 'course.mapBig' })).toMatchObject({ courseMap: 'big', rel: null });
  });

  it('停留所を移る・画面を替える・別の解析を開くと閉じる', () => {
    const s0 = inCode();
    const open = run(s0, { id: 'rel.toggle' });
    expect(open.rel).not.toBeNull();
    expect(run(open, { id: 'course.jump', i: 1 }).rel).toBeNull();
    expect(run(open, { id: 'view.diff' }).rel).toBeNull();
    expect(run(open, { id: 'data.loaded', summary: open.current!, analysis: fixtureAnalysis(), review: emptyReview() }).rel).toBeNull();
  });
});

describe('R / Shift+R', () => {
  it('R はコースの今の停留所の箱で開き、もう一度で閉じる', () => {
    const s0 = inCode();
    const exec = idOf(s0, 'ApplyDiscountUseCase.execute');
    const s1 = run(s0, { id: 'rel.toggle' });
    expect(s1.rel).toMatchObject({ host: exec, size: 'side' });
    expect(run(s1, { id: 'rel.toggle' }).rel).toBeNull();
  });

  it('R は停留所の画面で効く。入口・読む前の案内・相手の無い停留所では何もしない', () => {
    const brief = run(loaded(), { id: 'course.enter', courseId: 5 });
    expect(run(brief, { id: 'rel.toggle' }).rel).toBeNull();
    const first = run(brief, { id: 'enter' });
    expect(first.course?.screen).toBe('stop');
    expect(run(first, { id: 'rel.toggle' }).rel).not.toBeNull();
    const home = loaded();
    expect(run(home, { id: 'rel.toggle' })).toBe(run(home));
    // コース 7 の最初（api.OrderDetailResponse）には差分の無い相手がいない
    const c7 = run(loaded(), { id: 'course.enter', courseId: 7, at: 0 });
    expect(run(c7, { id: 'rel.toggle' }).rel).toBeNull();
  });

  // テストの停留所は地図に箱が無いが、テストも差分なので、テストが呼ぶ差分の無い相手を出す（レビューで確かめた）
  it('R はテストの停留所でも効き、テストが呼ぶ差分の無い相手を出す（テストの関数の id で引く）', () => {
    const s0 = loaded();
    const c5 = courses(s0.analysis!).find((c) => c.id === 5)!;
    // saves the order after applying は足した行で OrderRepository.save を呼ぶ（throws when order is missing の find は変わらない行なので相手にならない。2026-10-12）
    const k = c5.steps.findIndex((st) => nameOf(s0, st.symbolId)?.includes('saves the order after applying'));
    const s1 = run(s0, { id: 'course.enter', courseId: 5, at: k }, { id: 'rel.toggle' });
    expect(s1.rel).toMatchObject({ host: c5.steps[k]!.symbolId, dir: 'out', sel: idOf(s0, 'OrderRepository.save') });
  });

  it('Shift+R は大きく / 元の大きさ。閉じているときは今の停留所の箱でいきなり大きく開く', () => {
    const s0 = inCode();
    const big = run(s0, { id: 'rel.big' });
    expect(big.rel).toMatchObject({ size: 'big' });
    expect(run(big, { id: 'rel.big' }).rel).toMatchObject({ size: 'side' });
    expect(run(s0, { id: 'rel.toggle' }, { id: 'rel.big' }).rel).toMatchObject({ size: 'big' });
    // 大きいまま相手や層を替えても大きいまま
    const exec = idOf(s0, 'ApplyDiscountUseCase.execute');
    expect(run(big, { id: 'rel.open', host: exec, dir: 'out' }).rel).toMatchObject({ size: 'big' });
  });
});

describe('相手を選ぶ', () => {
  it('↑↓（hunk.next / hunk.prev）は開いている間は次 / 前の相手。端で止まる。停留所は移らない', () => {
    // execute の相手は Clock.now / Money.plus / OrderId.of / OrderRepository.save（fixture の execute 単独では save の 1 つだけ）
    const s0 = inCode(fixtureWithNeighbors());
    const s1 = run(s0, { id: 'rel.toggle' });
    expect(nameOf(s0, s1.rel!.sel)).toBe('Clock.now');
    const s2 = run(s1, { id: 'hunk.next' });
    expect(nameOf(s0, s2.rel!.sel)).toBe('Money.plus');
    expect(s2.course).toEqual(s1.course);
    const last = run(s2, { id: 'hunk.next' }, { id: 'hunk.next' });
    expect(nameOf(s0, last.rel!.sel)).toBe('OrderRepository.save');
    expect(nameOf(s0, run(last, { id: 'hunk.next' }).rel!.sel)).toBe('OrderRepository.save');
    expect(nameOf(s0, run(s2, { id: 'hunk.prev' }, { id: 'hunk.prev' }).rel!.sel)).toBe('Clock.now');
  });

  it('層で絞っているときは、その層の中だけを動く。並びは層の順（地図の帯の順）、同じ層は名前順', () => {
    const s0 = loaded(fixtureWithNeighbors());
    const exec = idOf(s0, 'ApplyDiscountUseCase.execute');
    const all = run(s0, { id: 'rel.open', host: exec, dir: 'out' });
    const seen = [nameOf(s0, all.rel!.sel)];
    let s = all;
    for (let i = 0; i < 3; i++) {
      s = run(s, { id: 'hunk.next' });
      seen.push(nameOf(s0, s.rel!.sel));
    }
    expect(seen).toEqual(['Clock.now', 'Money.plus', 'OrderId.of', 'OrderRepository.save']);
  });

  it('rel.select で相手を選ぶ。一覧に無い相手は選ばない', () => {
    const s0 = inCode();
    const s1 = run(s0, { id: 'rel.toggle' }, { id: 'rel.select', symbolId: idOf(s0, 'OrderRepository.save') });
    expect(nameOf(s0, s1.rel!.sel)).toBe('OrderRepository.save');
    expect(run(s1, { id: 'rel.select', symbolId: 'nope' }).rel!.sel).toBe(s1.rel!.sel);
  });

  it('見た印は付かない（viewed も course.done も増えない）', () => {
    const s0 = inCode();
    const r = [reduce(s0, { id: 'rel.toggle' })];
    r.push(reduce(r[0]!.state, { id: 'hunk.next' }));
    for (const x of r) expect(x.effects).toEqual([]);
    expect(r[1]!.state.review).toEqual(s0.review);
  });
});
