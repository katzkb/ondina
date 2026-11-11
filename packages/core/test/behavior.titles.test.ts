// 2 回目の LLM が書いた動きの題を重ねる（設計書 3.3 / 5.4）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Behavior, CallFlow, FlowCall } from '@ondina/model';
import { parseNarrationOutput } from '../src/narration/schema.js';
import type { NarrationOutput } from '../src/narration/types.js';
import { FIXTURE_ROOT } from './fixture.js';
import { MAX_STORY_STEPS, applyBehaviorTitles, applyFlowTitles, copyFlowTitles } from '../src/behavior/titles.js';

type Out = NarrationOutput['behaviors'][number];
const T = (id: string, title: string, more: Partial<Out> = {}): Out => ({ id, title, before: '', change: '', after: '', steps: [], ...more });
const B = (id: string): Behavior => ({ id, title: `start-${id}`, titleProvenance: 'ast', start: id, messages: [] });

describe('applyBehaviorTitles', () => {
  it('LLM の並びにし、書かなかった動きはプログラムの順で後ろ。題は llm にする', () => {
    const r = applyBehaviorTitles([B('b1'), B('b2'), B('b3')], [T('b3', '在庫を引き当てる。'), T('b1', ' 注文を受け付ける ')]);
    expect(r.behaviors.map((b) => [b.id, b.title, b.titleProvenance])).toEqual([
      ['b3', '在庫を引き当てる', 'llm'],
      ['b1', '注文を受け付ける', 'llm'],
      ['b2', 'start-b2', 'ast'],
    ]);
    expect(r.info).toEqual(['動きの題: 2 / 3 本']);
  });

  it('知らない id は捨て、同じ id は最初だけ。空の題は始まりの名前のまま', () => {
    const r = applyBehaviorTitles([B('b1')], [T('b9', 'x'), T('b1', ' '), T('b1', '後の題')]);
    expect(r.behaviors).toEqual([B('b1')]);
    expect(r.info).toEqual(['不明な動きの題を除外しました: b9', '動き b1 の題が 2 回来たので最初だけ使いました', '動きの題: 0 / 1 本']);
  });

  it('動きが 0 本なら知らせない', () => {
    expect(applyBehaviorTitles([], [])).toEqual({ behaviors: [], info: [] });
  });
});

const F = (id: string, start: string): CallFlow => ({ id, title: `start-${start}`, titleProvenance: 'ast', root: { key: `>${start}#1`, from: null, to: start, status: 'changed', courses: [], kids: [] } });

describe('applyFlowTitles', () => {
  it('流れにも同じ規則で題を付け、知らせは「流れ」で書く', () => {
    const r = applyFlowTitles([F('f1', 'a'), F('f2', 'b')], [T('f2', '注文を受け付ける。')]);
    expect(r.flows.map((f) => [f.id, f.title, f.titleProvenance])).toEqual([
      ['f2', '注文を受け付ける', 'llm'],
      ['f1', 'start-a', 'ast'],
    ]);
    expect(r.info).toEqual(['流れの題: 1 / 2 本']);
  });

  const side = { line: 1 };
  const kid = (status: FlowCall['status']): FlowCall => ({ key: `a>x#1`, from: 'a', to: 'x', status, ...(status === 'added' ? {} : { before: side }), ...(status === 'removed' ? {} : { after: side }), courses: [], kids: [] });
  const G = (id: string, root: Partial<FlowCall>): CallFlow => ({ ...F(id, 'a'), root: { ...F(id, 'a').root, before: {}, after: {}, ...root } });

  it('段の文は前後の空白を落として付ける。空の文は付けない', () => {
    const r = applyFlowTitles([G('f1', { kids: [kid('added')] })], [T('f1', '題', { before: ' 前の流れ。 ', change: '  ', after: '後の流れ。' })]);
    expect(r.flows[0]!.stages).toEqual({ before: '前の流れ。', after: '後の流れ。' });
    expect(r.info).toEqual(['流れの題: 1 / 1 本', '流れの段の文: ① 1・② 0・③ 1 / 1 本']);
  });

  it('その段に流れが無い文と、変わった呼び出しの無い流れの ② の文は捨てて知らせる', () => {
    const added = G('f1', { before: undefined, status: 'added', kids: [kid('added')] });
    const removed = G('f2', { after: undefined, status: 'removed', kids: [kid('removed')] });
    const same = G('f3', { status: 'same', kids: [kid('same')] });
    const r = applyFlowTitles([added, removed, same], [T('f1', '題', { before: '前。', change: '足した。' }), T('f2', '題', { after: '後。', change: '消した。' }), T('f3', '題', { change: '変えた。', after: '後。' })]);
    expect(r.flows.map((f) => f.stages)).toEqual([{ change: '足した。' }, { change: '消した。' }, { after: '後。' }]);
    expect(r.info).toEqual([
      '流れ f1 の ① 背景の文を除外しました（変わる前にこの流れがありません）',
      '流れ f2 の ③ マージ後の文を除外しました（マージ後にこの流れがありません）',
      '流れ f3 の ② この PR の文を除外しました（変わった呼び出しがありません）',
      '流れの題: 3 / 3 本',
      '流れの段の文: ① 0・② 2・③ 1 / 3 本',
    ]);
  });

  it('入口だけが変わった流れは ② の文を残す', () => {
    const r = applyFlowTitles([G('f1', { status: 'changed', kids: [kid('same')] })], [T('f1', '題', { change: '入口が引数を受け取る。' })]);
    expect(r.flows[0]!.stages).toEqual({ change: '入口が引数を受け取る。' });
  });
});

// 筋書き（2026-11-12）。木: c1 a(根) ─ c2 x ─ c3 y / c4 z（c1 は same、c2〜c4 は状態を変えて試す）
describe('applyFlowTitles（筋書き）', () => {
  const call = (key: string, from: string | null, to: string, status: FlowCall['status'], kids: FlowCall[] = []): FlowCall => ({ key, from, to, status, courses: [], kids });
  const tree = (st: { x?: FlowCall['status']; y?: FlowCall['status']; z?: FlowCall['status'] } = {}): CallFlow => {
    const y = call('a>x#1/x>y#1', 'x', 'y', st.y ?? 'added');
    const x = call('>a#1/a>x#1', 'a', 'x', st.x ?? 'added', [y]);
    const z = call('>a#1/a>z#1', 'a', 'z', st.z ?? 'added');
    return { ...F('f1', 'a'), root: { ...call('>a#1', null, 'a', 'same', [x, z]), before: {}, after: {} } };
  };
  const step = (title: string, calls: string[]) => ({ title, calls });
  const run = (steps: Out['steps'], flow: CallFlow = tree()) => applyFlowTitles([flow], [T('f1', '題', { steps })]);

  it('検査を通ると story を付ける。見出しは llm、通る呼び出しは FlowCall.key で、深さ優先の順に並べ直す', () => {
    const r = run([step('入口を受け取る。', ['c2', 'c1']), step('先を呼ぶ', ['c3', 'c4'])]);
    expect(r.flows[0]!.story).toEqual([
      { title: '入口を受け取る', titleProvenance: 'llm', calls: ['>a#1', '>a#1/a>x#1'] },
      { title: '先を呼ぶ', titleProvenance: 'llm', calls: ['a>x#1/x>y#1', '>a#1/a>z#1'] },
    ]);
    expect(r.info).toContain('流れ f1 の筋書き: ステップ 2（AI 2・まとめに入らなかった呼び出し 0 個）');
  });

  it('規則 1: 知らない id は捨てる', () => {
    const r = run([step('全部', ['c1', 'c2', 'c3', 'c4', 'c99'])]);
    expect(r.flows[0]!.story![0]!.calls).toHaveLength(4);
    expect(r.info).toContain('流れ f1 の筋書きの 1 個目のステップから不明な呼び出しを除外しました: c99');
  });

  it('規則 2: 8 個目のステップは捨て、中の呼び出しは入らなかった扱いで最後にまとまる', () => {
    expect(MAX_STORY_STEPS).toBe(7);
    const many = [step('1', ['c1']), step('2', ['c2']), step('3', ['c3']), step('4', []), step('5', []), step('6', []), step('7', []), step('8', ['c4'])];
    const r = run(many);
    expect(r.flows[0]!.story!.map((s) => s.title)).toEqual(['1', '2', '3', 'まとめに入らなかった呼び出し 1 個']);
    expect(r.flows[0]!.story![3]).toEqual({ title: 'まとめに入らなかった呼び出し 1 個', titleProvenance: 'ast', calls: ['>a#1/a>z#1'] });
    expect(r.info).toContain('流れ f1 の筋書きの 8 個目のステップを除外しました（7 個まで）');
  });

  it('規則 3: 見出しが空（空白だけ）のステップは捨てる', () => {
    const r = run([step('  ', ['c1']), step('本体', ['c1', 'c2', 'c3', 'c4'])]);
    expect(r.flows[0]!.story!.map((s) => s.title)).toEqual(['本体']);
    expect(r.info).toContain('流れ f1 の筋書きの 1 個目のステップを除外しました（見出しが空です）');
  });

  it('規則 4: 同じ呼び出しの 2 回目は捨てる（前のステップ・同じステップ）', () => {
    const r = run([step('a', ['c1', 'c1', 'c2']), step('b', ['c2', 'c3', 'c4'])]);
    expect(r.flows[0]!.story!.map((s) => s.calls.length)).toEqual([2, 2]);
    expect(r.info.filter((l) => l.includes('重なった呼び出しを除外しました'))).toEqual([
      '流れ f1 の筋書きの 1 個目のステップから重なった呼び出しを除外しました: c1',
      '流れ f1 の筋書きの 2 個目のステップから重なった呼び出しを除外しました: c2',
    ]);
  });

  it('規則 5: 呼ぶ側が前のステップにも同じステップにも無い呼び出しはステップから外す。外したものは別のステップに入れられる', () => {
    const r = run([step('先に子', ['c3']), step('親と子', ['c1', 'c2', 'c3', 'c4'])]);
    expect(r.flows[0]!.story!.map((s) => s.calls)).toEqual([['>a#1', '>a#1/a>x#1', 'a>x#1/x>y#1', '>a#1/a>z#1']]);
    expect(r.info).toContain('流れ f1 の筋書きの 1 個目のステップを除外しました（通る呼び出しがありません）');
    expect(r.info).toContain('流れ f1 の筋書きの 1 個目のステップから呼ぶ側より先の呼び出しを除外しました: c3');
  });

  it('規則 6: 呼び出しが 0 個になったステップは捨てる', () => {
    const r = run([step('空', []), step('知らない', ['c9']), step('本体', ['c1', 'c2', 'c3', 'c4'])]);
    expect(r.flows[0]!.story!.map((s) => s.title)).toEqual(['本体']);
  });

  it('規則 7: LLM のステップが 1 つも残らなければ story を付けない', () => {
    const r = run([step('', ['c1']), step('空', ['c9'])]);
    expect(r.flows[0]!.story).toBeUndefined();
    expect(r.info).toContain('流れ f1 の筋書きを除外しました（使えるステップがありません）');
  });

  it('規則 8: same 以外でどのステップにも入らなかった呼び出しを最後に 1 ステップ足す（same は足さない）', () => {
    const r = run([step('根だけ', ['c1'])], tree({ x: 'same', y: 'changed', z: 'removed' }));
    expect(r.flows[0]!.story![1]).toEqual({ title: 'まとめに入らなかった呼び出し 2 個', titleProvenance: 'ast', calls: ['a>x#1/x>y#1', '>a#1/a>z#1'] });
    expect(r.info).toContain('流れ f1 の筋書き: ステップ 2（AI 1・まとめに入らなかった呼び出し 2 個）');
  });

  it('規則 8 の例外: 入らなかった呼び出しが same だけなら足さない', () => {
    const r = run([step('根と先', ['c1', 'c2', 'c3'])], tree({ z: 'same' }));
    expect(r.flows[0]!.story).toHaveLength(1);
  });

  it('steps が無い（古い記録）流れは story を付けず、今までどおり', () => {
    const r = applyFlowTitles([tree()], [T('f1', '題')]);
    expect(r.flows[0]!.story).toBeUndefined();
    expect(r.info).toEqual(['流れの題: 1 / 1 本']);
  });
});

describe('copyFlowTitles', () => {
  it('入口が同じ動きに LLM の題を写し、流れの並びにする。流れの無い動きは後ろ', () => {
    const flows = [{ ...F('f2', 'b'), title: '後の題', titleProvenance: 'llm' as const }, F('f1', 'a')];
    const r = copyFlowTitles([B('a'), B('z'), B('b')], flows);
    expect(r.map((b) => [b.id, b.title, b.titleProvenance])).toEqual([
      ['b', '後の題', 'llm'],
      ['a', 'start-a', 'ast'],
      ['z', 'start-z', 'ast'],
    ]);
  });
});

// fixture の記録（llm/text-output.json）の流れの題と段の文を、流れのゴールデン（expected/flows.json）に重ねる
describe('applyFlowTitles（fixture の記録）', () => {
  const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8')) as T;
  const parsed = parseNarrationOutput(read<{ stdout: string }>('llm/text-output.json').stdout);
  if ('error' in parsed) throw new Error(parsed.error);
  const r = applyFlowTitles(read<CallFlow[]>('expected/flows.json'), parsed.output.behaviors);

  it('1 本の流れに題と 3 段の文が全部付く', () => {
    expect(r.flows).toHaveLength(1);
    expect(r.flows[0]!.titleProvenance).toBe('llm');
    expect(Object.keys(r.flows[0]!.stages ?? {})).toEqual(['before', 'change', 'after']);
    expect(r.flows[0]!.story?.length).toBeGreaterThan(0);
    expect(r.info).toEqual(['流れ f1 の筋書き: ステップ 5（AI 5・まとめに入らなかった呼び出し 0 個）', '流れの題: 1 / 1 本', '流れの段の文: ① 1・② 1・③ 1 / 1 本']);
  });
});
