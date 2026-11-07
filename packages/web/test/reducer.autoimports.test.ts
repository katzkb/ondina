// import だけの差分を自動で問題なしにする設定（autoCheckImports。設計書 3.8 / 3.3。2026-11-07）。
// 読み込み時と設定を on にしたときに問題なしを足し、コースの進む・戻る・入るでは止まらない。停留所を押せば開く。
import type { Analysis, UiSettings } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { courseOf, courses, stopInfo } from '../src/course.js';
import { initialState, reduce, type AppState, type Effect } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const base = fixtureAnalysis();
const importIds = base.hunks.filter((h) => h.importsOnly === true).map((h) => h.id);

function load(ui: UiSettings, opts: { key?: string; analysis?: Analysis; viewed?: string[] } = {}): { state: AppState; effects: Effect[] } {
  const analysis = opts.analysis ?? fixtureAnalysis();
  const summary = { key: opts.key ?? 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  const start = reduce(initialState(), { id: 'ui.loaded', ui }).state;
  return reduce(start, { id: 'data.loaded', summary, analysis, review: { ...emptyReview(), viewed: opts.viewed ?? [] } });
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((acc, c) => reduce(acc, c).state, s);
const types = (effects: Effect[]) => effects.map((e) => e.type);
const sorted = (a: readonly string[]) => [...a].sort();

describe('fixture の前提', () => {
  it('importsOnly の差分は 5 つ（コース 2・5・6 に 1・1・2、コース外に 1）', () => {
    expect(importIds).toHaveLength(5);
    const c6 = courseOf(courses(base), 6)!;
    expect(c6.steps.map((s) => s.hunkId && importIds.includes(s.hunkId))).toEqual([false, false, false, false, true, false, true]);
  });
});

describe('読み込み時（data.loaded）', () => {
  it('設定が on なら import だけの差分を問題なしにして保存する', () => {
    const r = load({ autoCheckImports: true });
    expect(sorted(r.state.review!.viewed)).toEqual(sorted(importIds));
    expect(types(r.effects)).toContain('saveState');
  });

  it('既に問題なしのものは足さない。足すものが無ければ保存しない', () => {
    const r = load({ autoCheckImports: true }, { viewed: importIds });
    expect(r.state.review!.viewed).toEqual(importIds);
    expect(types(r.effects)).not.toContain('saveState');
    const half = load({ autoCheckImports: true }, { viewed: [importIds[0]!] });
    expect(sorted(half.state.review!.viewed)).toEqual(sorted(importIds));
    expect(half.state.review!.viewed.filter((id) => id === importIds[0])).toHaveLength(1);
  });

  it('設定が off（無い）なら何も足さない', () => {
    for (const ui of [{}, { autoCheckImports: false }]) {
      const r = load(ui);
      expect(r.state.review!.viewed).toEqual([]);
      expect(types(r.effects)).not.toContain('saveState');
    }
  });

  it('ファイルの差分が import だけになったファイルは GitHub の Viewed に付けにいく。local では送らない', () => {
    const a = fixtureAnalysis();
    const only = a.hunks.find((h) => h.importsOnly === true && h.path.endsWith('ApplyDiscountRequest.kt'))!;
    a.hunks = a.hunks.filter((h) => h.path !== only.path || h.id === only.id);
    const r = load({ autoCheckImports: true }, { key: '42', analysis: a });
    expect(r.effects).toContainEqual({ type: 'githubSet', key: '42', headSha: a.pr.headSha, mark: [only.path], unmark: [], retried: false });
    expect(types(load({ autoCheckImports: true }, { key: 'local', analysis: a }).effects)).not.toContain('githubSet');
  });
});

describe('設定を変えたとき', () => {
  const off = load({}).state;

  it('on にすると読み込み済みの解析の import だけの差分が問題なしになる（設定と状態を保存）', () => {
    const r = reduce(off, { id: 'ui.autoCheckImports', value: true });
    expect(r.state.ui.autoCheckImports).toBe(true);
    expect(sorted(r.state.review!.viewed)).toEqual(sorted(importIds));
    expect(types(r.effects)).toEqual(expect.arrayContaining(['saveUi', 'saveState']));
  });

  it('on にしたときに GitHub の Viewed へも付けにいく（手で問題なしにしたときと同じ道）', () => {
    const a = fixtureAnalysis();
    const only = a.hunks.find((h) => h.importsOnly === true && h.path.endsWith('ApplyDiscountRequest.kt'))!;
    a.hunks = a.hunks.filter((h) => h.path !== only.path || h.id === only.id);
    const s = load({}, { key: '42', analysis: a }).state;
    const r = reduce(s, { id: 'ui.autoCheckImports', value: true });
    expect(r.effects).toContainEqual({ type: 'githubSet', key: '42', headSha: a.pr.headSha, mark: [only.path], unmark: [], retried: false });
  });

  it('既に全部問題なしなら、設定だけ保存する', () => {
    const s = load({}, { viewed: importIds }).state;
    expect(types(reduce(s, { id: 'ui.autoCheckImports', value: true }).effects)).toEqual(['saveUi']);
  });

  it('off に戻しても、足した問題なしは外さない', () => {
    const on = run(off, { id: 'ui.autoCheckImports', value: true });
    const r = reduce(on, { id: 'ui.autoCheckImports', value: false });
    expect(r.state.ui.autoCheckImports).toBe(false);
    expect(sorted(r.state.review!.viewed)).toEqual(sorted(importIds));
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
  });

  it('解析を開く前に設定が届いたときは何もせず、解析を開いたときに足す', () => {
    const start = initialState();
    const r = reduce(start, { id: 'ui.loaded', ui: { autoCheckImports: true } });
    expect(r.effects).toEqual([]);
    expect(r.state.ui.autoCheckImports).toBe(true);
  });

  it('解析を開いた後に設定が届いたとき（ui.loaded）も足して保存する', () => {
    const r = reduce(off, { id: 'ui.loaded', ui: { autoCheckImports: true } });
    expect(sorted(r.state.review!.viewed)).toEqual(sorted(importIds));
    expect(types(r.effects)).toContain('saveState');
  });
});

describe('コース 6 の停留所（0 から 6。4 と 6 が import だけ）', () => {
  const on = load({ autoCheckImports: true }).state;
  const offState = load({}).state;
  const at = (s: AppState, i: number) => run(s, { id: 'course.enter', courseId: 6, at: i });
  const pos = (s: AppState) => (s.course === null ? null : `${s.course.screen}:${s.course.i}`);

  it('設定が on: 次へで import だけの停留所を飛ばし、最後が飛ばされるなら総括へ', () => {
    expect(pos(run(at(on, 3), { id: 'course.ok' }))).toBe('stop:5');
    expect(pos(run(at(on, 5), { id: 'course.ok' }))).toBe('summary:5');
    expect(pos(run(at(on, 3), { id: 'course.forward' }))).toBe('stop:5');
  });

  it('設定が on: 前へも飛ばす。総括からは最後に止まる停留所へ戻る', () => {
    expect(pos(run(at(on, 5), { id: 'course.prev' }))).toBe('stop:3');
    expect(pos(run(at(on, 5), { id: 'course.ok' }, { id: 'course.prev' }))).toBe('stop:5');
    // 総括の URL（#/…/summary）は最後の停留所（6 = import だけ）の位置を持つ
    const summary = run(on, { id: 'route.go', page: { kind: 'course', course: 6, at: { kind: 'summary' } } });
    expect(pos(summary)).toBe('summary:6');
    expect(pos(run(summary, { id: 'course.prev' }))).toBe('stop:5');
  });

  it('設定が on: j / k（次・前の差分）も飛ばす。最後の先は何もしない', () => {
    expect(pos(run(at(on, 3), { id: 'hunk.next' }))).toBe('stop:5');
    expect(pos(run(at(on, 5), { id: 'hunk.prev' }))).toBe('stop:3');
    expect(pos(run(at(on, 5), { id: 'hunk.next' }))).toBe('stop:5');
  });

  it('設定が on: 先頭の前は、読む前の案内へ', () => {
    expect(pos(run(at(on, 0), { id: 'course.prev' }))).toBe('brief:0');
    const back = (n: number) => run(at(on, 5), ...Array.from({ length: n }, (): Command => ({ id: 'hunk.prev' })));
    expect(pos(back(4))).toBe('stop:0');
    expect(pos(back(5))).toBe('brief:0');
  });

  it('設定が on: 停留所を押せば（course.jump）import だけの停留所も開く', () => {
    expect(pos(run(at(on, 3), { id: 'course.jump', i: 4 }))).toBe('stop:4');
    expect(pos(run(at(on, 3), { id: 'course.jump', i: 6 }))).toBe('stop:6');
  });

  it('設定が on: 停留所の一覧には残り、問題なし（✓）で出る', () => {
    const c6 = courseOf(courses(on.analysis!), 6)!;
    expect(c6.steps).toHaveLength(7);
    expect(stopInfo(on.analysis!, c6, 4, on.review!).seen).toBe(true);
    expect(stopInfo(on.analysis!, c6, 6, on.review!).seen).toBe(true);
  });

  it('設定が on: 入る位置は最初の未確認の停留所。全部確認済みなら最初に止まる停留所', () => {
    const c6 = courseOf(courses(base), 6)!;
    const ids = c6.steps.map((s) => s.hunkId!);
    const enter = (s: AppState) => run(s, { id: 'course.enter', courseId: 6 }, { id: 'course.ok' });
    expect(pos(enter(on))).toBe('stop:0');
    const seen = (viewed: string[]) => load({ autoCheckImports: true }, { viewed }).state;
    // 0〜3 を見終えた → 4 は import だけなので 5 から
    expect(pos(enter(seen(ids.slice(0, 4))))).toBe('stop:5');
    // 手で外した import だけの停留所にも入るときは止まらない
    const unchecked = reduce(seen(ids.slice(0, 4)), { id: 'hunk.markViewed', hunkId: ids[4]! }).state;
    expect(unchecked.review!.viewed).not.toContain(ids[4]);
    expect(pos(enter(unchecked))).toBe('stop:5');
    // 全部見終えた
    expect(pos(enter(seen(ids)))).toBe('stop:0');
  });

  it('設定が off: 今までどおり全部の停留所に止まる', () => {
    expect(pos(run(at(offState, 3), { id: 'course.ok' }))).toBe('stop:4');
    expect(pos(run(at(offState, 5), { id: 'course.ok' }))).toBe('stop:6');
    expect(pos(run(at(offState, 6), { id: 'course.ok' }))).toBe('summary:6');
    expect(pos(run(at(offState, 5), { id: 'course.prev' }))).toBe('stop:4');
    expect(pos(run(at(offState, 3), { id: 'hunk.next' }))).toBe('stop:4');
  });

  it('設定が off: 入る位置は import だけの停留所でも最初の未確認', () => {
    const c6 = courseOf(courses(base), 6)!;
    const ids = c6.steps.map((s) => s.hunkId!);
    const s = load({}, { viewed: ids.slice(0, 4) }).state;
    expect(pos(run(s, { id: 'course.enter', courseId: 6 }, { id: 'course.ok' }))).toBe('stop:4');
  });
});
