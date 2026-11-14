// 要求コースの地図の状態: ← / → は章の移動のまま、再生帯の前・次（map.prev / map.next）だけが地図を進める
import { describe, expect, it } from 'vitest';
import type { CallFlow, FlowCall } from '@ondina/model';
import type { Command } from '../src/commands/commands.js';
import { flowSteps } from '../src/map/flowmap/steps.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview } from './fixture.js';
import { requirementAnalysis } from './requirementFixture.js';

function loaded(): AppState {
  const analysis = requirementAnalysis();
  analysis.pr.number = 42;
  return reduce(initialState(), { id: 'data.loaded', analysis, review: emptyReview(), summary: { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' } }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((s, c) => reduce(s, c).state, s);
const chapter = (n: number) => run(loaded(), { id: 'req.go', chapter: n });

describe('requirement course map', () => {
  it('地図がある章でも → は章を進め、地図は動かない', () => {
    const s = run(chapter(1), { id: 'course.forward' });
    expect(s.requirement.chapter).toBe(2);
    expect(s.requirement.map).toEqual({ flow: null, step: 0, play: false });
    expect(run(chapter(1), { id: 'course.prev' }).requirement.chapter).toBe(0);
  });

  it('map.next / map.prev は地図を濃い線のステップだけで進める', () => {
    const s0 = chapter(1);
    const a = run(s0, { id: 'map.next' });
    const b = run(a, { id: 'map.next' });
    expect(s0.requirement.chapter).toBe(1);
    expect(a.requirement.chapter).toBe(1);
    expect(a.requirement.map.step).toBeGreaterThan(0);
    expect(b.requirement.map.step).toBeGreaterThan(a.requirement.map.step);
    expect(run(b, { id: 'map.prev' }).requirement.map.step).toBe(a.requirement.map.step);
    // 濃い線は 2 本（呼ぶ + 戻りで 4 ステップ）。流れ全体（8 本 = 16 ステップ）では止まらない。最初の 1 つは step 0 の表示なので数えない
    const seen = new Set<number>();
    let s = s0;
    for (let k = 0; k < 20; k++) {
      s = run(s, { id: 'map.next' });
      seen.add(s.requirement.map.step);
    }
    expect(seen.size).toBe(3);
  });

  it('再生は濃い線で止まり、最後で止まる。手で動かすと再生は止まる', () => {
    let s = run(chapter(1), { id: 'map.play' });
    expect(s.requirement.map.play).toBe(true);
    for (let k = 0; k < 10; k++) s = run(s, { id: 'map.tick' });
    expect(s.requirement.map.play).toBe(false);
    s = run(chapter(1), { id: 'map.play' }, { id: 'map.next' });
    expect(s.requirement.map.play).toBe(false);
  });

  it('章を移ると地図は最初のステップ・停止に戻る', () => {
    const s = run(chapter(1), { id: 'map.next' }, { id: 'map.play' }, { id: 'req.nextChapter' });
    expect(s.requirement.map).toEqual({ flow: null, step: 0, play: false });
  });

  it('地図を出さない章では map.* は何もしない。段は替わらない', () => {
    const s = chapter(4);
    for (const id of ['map.next', 'map.prev', 'map.play', 'map.tick', 'map.stage'] as const) expect(reduce(s, { id })).toEqual({ state: s, effects: [] });
    const t = chapter(1);
    expect(reduce(t, { id: 'map.stage', stage: 1 })).toEqual({ state: t, effects: [] });
    expect(reduce(t, { id: 'home.stage' }).state).toBe(t);
  });

  it('はじめにの地図は全部の呼び出しで止まる', () => {
    const start = run(loaded(), { id: 'req.go', chapter: 'start' });
    const seen = new Set<number>();
    let s = start;
    for (let k = 0; k < 30; k++) {
      s = run(s, { id: 'map.next' });
      seen.add(s.requirement.map.step);
    }
    expect(seen.size).toBe(15);
  });

  it('req.pin は地図を留める。章を移っても変わらず、保存しない', () => {
    const r = reduce(chapter(1), { id: 'req.pin' });
    expect(r.state.requirement.pin).toBe(true);
    expect(r.effects).toEqual([]);
    expect(run(r.state, { id: 'req.nextChapter' }).requirement.pin).toBe(true);
    expect(run(r.state, { id: 'req.pin' }).requirement.pin).toBe(false);
  });

  it('入口の地図でも map.next は course.forward と同じ動き', () => {
    const home = run(loaded(), { id: 'home.tab', tab: 'map' });
    const viaKey = reduce(home, { id: 'course.forward' }).state;
    const viaButton = reduce(home, { id: 'map.next' }).state;
    expect(home.view).toBe('home');
    expect(viaButton.home.step).toBeGreaterThan(0);
    expect(viaButton.home).toEqual(viaKey.home);
  });

  it('入口の地図タブは、画面と同じ ② のステップ数で再生・次が最後まで進む（① のステップ数で止まらない）', () => {
    // ① に無い（足された）呼び出しを含む流れ: ① は 4 ステップ、② は 6 ステップ
    const call = (key: string, status: FlowCall['status'], kids: FlowCall[] = []): FlowCall => ({
      key,
      from: key === '>root#1' ? null : '>root#1',
      to: key,
      status,
      ...(status === 'added' ? {} : { before: {} }),
      ...(status === 'removed' ? {} : { after: {} }),
      courses: [],
      kids,
    });
    const flow: CallFlow = { id: 'f1', title: 't', titleProvenance: 'ast', root: call('>root#1', 'same', [call('a', 'same'), call('b', 'added')]) };
    const base = loaded();
    const analysis = { ...base.analysis!, flows: [flow] };
    const s0 = run({ ...base, analysis } as AppState, { id: 'home.tab', tab: 'map' });
    const last = flowSteps(flow, 2).at(-1)!.i;
    expect(flowSteps(flow, 1).at(-1)!.i).toBeLessThan(last);
    expect(s0.home.mapStage).toBe(1);

    let s = run(s0, { id: 'map.play' });
    for (let k = 0; k < 20; k++) s = run(s, { id: 'map.tick' });
    expect(s.home.step).toBe(last);
    expect(s.home.play).toBe(false);

    s = s0;
    for (let k = 0; k < 20; k++) s = run(s, { id: 'map.next' });
    expect(s.home.step).toBe(last);
  });
});
