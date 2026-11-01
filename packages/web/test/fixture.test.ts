// 画面のテスト用 fixture は expected/hows.json（LLM の記録の検証結果）と pr-body.md を重ねる。
import { describe, expect, it } from 'vitest';
import { fixtureAnalysis } from './fixture.js';

describe('fixtureAnalysis', () => {
  it('hows 7 件、hunk の所属は hows.json、未帰属 3、summary と claims が入り、pr.body は pr-body.md', () => {
    const a = fixtureAnalysis();
    expect(a.hows.map((h) => h.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(a.hunks.filter((h) => h.hows.length === 0).map((h) => h.symbolFqName)).toEqual([
      'src/main/kotlin/com/example/common/Logger.kt',
      'com.example.common.Logger.format',
      'com.example.config.FeatureFlags.DISCOUNT_V2',
    ]);
    expect(a.hunks.filter((h) => h.kind === 'core' && h.kindProvenance === 'llm')).toHaveLength(14);
    expect(a.summary.headline).not.toBe('');
    expect(a.summary.flows![0]!.nodes).toHaveLength(5);
    expect(a.claims.filter((c) => !c.backed)).toHaveLength(2);
    expect(a.pr.body).toContain('## 概要');
    expect(a.llm).toEqual({ command: 'fixture', status: 'ok' });
  });

  it('2 回目の LLM（文を書く）の結果: tours の全部のコースに変わることと確かめること、全部の停留所にこの場所があり、入口の説明は要点と流れの図。text: false なら文も説明も無い', () => {
    const a = fixtureAnalysis();
    expect(a.llmText).toEqual({ command: 'fixture', status: 'ok' });
    expect(a.tours.every((t) => t.change !== undefined && (t.checks?.length ?? 0) > 0 && t.steps.every((s) => s.role !== undefined))).toBe(true);
    expect(a.summary.headline).toBeDefined();
    expect(a.summary.flows?.length).toBe(1);
    const bare = fixtureAnalysis({ text: false });
    expect(bare.llmText).toBeUndefined();
    expect(bare.tours.some((t) => t.change !== undefined || t.checks !== undefined || t.steps.some((s) => s.role !== undefined))).toBe(false);
    expect(bare.summary).toEqual({});
  });
});
