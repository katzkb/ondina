// 2 回目の LLM が書いた動きの題を重ねる（設計書 3.3 / 5.4）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Behavior, CallFlow, FlowCall } from '@ondina/model';
import { parseNarrationOutput } from '../src/narration/schema.js';
import type { NarrationOutput } from '../src/narration/types.js';
import { FIXTURE_ROOT } from './fixture.js';
import { applyBehaviorTitles, applyFlowTitles, copyFlowTitles } from '../src/behavior/titles.js';

type Out = NarrationOutput['behaviors'][number];
const T = (id: string, title: string, more: Partial<Out> = {}): Out => ({ id, title, before: '', change: '', after: '', ...more });
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
    expect(r.info).toEqual(['流れの題: 1 / 1 本', '流れの段の文: ① 1・② 1・③ 1 / 1 本']);
  });
});
