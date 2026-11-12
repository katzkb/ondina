// 流れの地図（筋書きあり）を描く。今のステップの呼び出し全部に番号の札、見出しは AI の札付き（llm）か札なし（ast）
import { render, waitFor } from '@testing-library/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowMap } from '../src/components/FlowMap.js';
import { fixtureAnalysis } from './fixture.js';

const a = fixtureAnalysis();
const flow = a.flows![0]!;
const name = (id: string) => a.symbols.find((s) => s.id === id)!.fqName.split('.').slice(-2).join('.');

describe('FlowMap（筋書きあり）', () => {
  // 玉の動きは切る（動いている間は今の札を出さない）
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: true })));
  afterEach(() => vi.unstubAllGlobals());
  const calls = [...(function* walk(c: typeof flow.root): Generator<typeof flow.root> {
    yield c;
    for (const k of c.kids) yield* walk(k);
  })(flow.root)];
  const key = (n: string, k = 0) => calls.filter((c) => name(c.to) === n)[k]!.key;
  const props = (titleProvenance: 'llm' | 'ast', step: number) => ({
    analysis: a,
    flows: [
      {
        ...flow,
        story: [
          { title: '入口から注文を取り出す', titleProvenance, calls: [key('OrderController.apply'), key('ApplyDiscountUseCase.execute'), key('OrderRepositoryImpl.find')] },
          { title: '注文に割引を当てる', titleProvenance, calls: [key('domain.Order'), key('DiscountPolicy.rateFor')] },
        ],
      },
    ],
    stage: 2 as const,
    flowId: null,
    step,
    play: false,
    speed: 1,
    zoom: 1,
    course: null,
    dispatch: () => {},
    elk: () => new ELK(),
  });

  it('今のステップの呼び出しは全部に番号の札が付く。見出しは AI の札と点線で出る', async () => {
    const { container } = render(<FlowMap {...props('llm', 1)} />);
    await waitFor(() => expect(container.querySelector('.fm-svg')).not.toBeNull());
    expect([...container.querySelectorAll('.fm-lb.cur .n')].map((n) => n.textContent)).toEqual(['1', '2', '3']);
    expect(container.querySelectorAll('.fm-ar.cur')).toHaveLength(3);
    const title = container.querySelector('.fmap > .fm-mapw .fm-title')!;
    expect(title.classList.contains('ai')).toBe(true);
    expect(title.querySelector('.chip.ai')).not.toBeNull();
    expect(container.querySelector('.fm-legend')!.textContent).toContain('いくつかの呼び出しをまとめて通ります');
    expect(container.querySelector('.fm-legend')!.textContent).not.toContain('点線が戻り');
  });

  it('ast の見出しは札なし。どのステップにも入らない呼び出しの線は薄く見える', async () => {
    const { container } = render(<FlowMap {...props('ast', 2)} />);
    await waitFor(() => expect(container.querySelector('.fm-svg')).not.toBeNull());
    const title = container.querySelector('.fm-mapw .fm-title')!;
    expect(title.classList.contains('auto')).toBe(true);
    expect(title.querySelector('.chip')).toBeNull();
    // 札は今のステップの 2 つと、前のステップの 3 つの番号だけ（入らなかった save・OrderResponse には付かない）
    expect(container.querySelectorAll('.fm-lb')).toHaveLength(5);
    // 線は全部で 8 本（ステップに入る 5 本 + 入らない 3 本から、根の入口を含む）
    expect(container.querySelectorAll('.fm-ar.past').length).toBeGreaterThanOrEqual(3 + 3);
  });
});
