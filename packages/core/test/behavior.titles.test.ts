// 2 回目の LLM が書いた動きの題を重ねる（設計書 3.3 / 5.4）
import { describe, expect, it } from 'vitest';
import type { Behavior } from '@ondina/model';
import { applyBehaviorTitles } from '../src/behavior/titles.js';

const B = (id: string): Behavior => ({ id, title: `start-${id}`, titleProvenance: 'ast', start: id, messages: [] });

describe('applyBehaviorTitles', () => {
  it('LLM の並びにし、書かなかった動きはプログラムの順で後ろ。題は llm にする', () => {
    const r = applyBehaviorTitles([B('b1'), B('b2'), B('b3')], [{ id: 'b3', title: '在庫を引き当てる。' }, { id: 'b1', title: ' 注文を受け付ける ' }]);
    expect(r.behaviors.map((b) => [b.id, b.title, b.titleProvenance])).toEqual([
      ['b3', '在庫を引き当てる', 'llm'],
      ['b1', '注文を受け付ける', 'llm'],
      ['b2', 'start-b2', 'ast'],
    ]);
    expect(r.info).toEqual(['動きの題: 2 / 3 本']);
  });

  it('知らない id は捨て、同じ id は最初だけ。空の題は始まりの名前のまま', () => {
    const r = applyBehaviorTitles([B('b1')], [{ id: 'b9', title: 'x' }, { id: 'b1', title: ' ' }, { id: 'b1', title: '後の題' }]);
    expect(r.behaviors).toEqual([B('b1')]);
    expect(r.info).toEqual(['不明な動きの題を除外しました: b9', '動き b1 の題が 2 回来たので最初だけ使いました', '動きの題: 0 / 1 本']);
  });

  it('動きが 0 本なら知らせない', () => {
    expect(applyBehaviorTitles([], [])).toEqual({ behaviors: [], info: [] });
  });
});
