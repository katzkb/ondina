// 要求コースの画面の地図: 章の小さい地図・出さない章の理由・はじめにのチップ・濃い箱を押すと差分へ
import { useReducer } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { RequirementCourseView } from '../src/components/RequirementCourseView.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { REQ_MAP_MAX_H } from '../src/requirementMap.js';
import { emptyReview } from './fixture.js';
import { requirementAnalysis } from './requirementFixture.js';

const elk = new ELK();
let last: AppState;

function Harness({ chapter }: { chapter: number | 'start' | 'end' }) {
  const analysis = requirementAnalysis();
  const loaded = reduce(initialState(), { id: 'data.loaded', analysis, review: emptyReview(), summary: { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' } }).state;
  const [state, dispatch] = useReducer((s: AppState, c: Command) => reduce(s, c).state, reduce(loaded, { id: 'req.go', chapter }).state);
  last = state;
  return <RequirementCourseView analysis={state.analysis!} review={state.review!} at={state.requirement} selectedHunk={state.selectedHunk} memo={state.memo} mode="uni" elk={() => elk} dispatch={dispatch} />;
}

const boxes = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.fm-box')];

describe('requirement course map', () => {
  it('章に小さい地図: 段ボタンも下のコード欄も横の欄も無く、再生帯と地図の外が出る', async () => {
    const { container } = render(<Harness chapter={1} />);
    await waitFor(() => expect(boxes(container).length).toBeGreaterThan(0));
    expect(container.querySelector('.fmap.compact')).not.toBeNull();
    expect(container.querySelector('.fm-stages')).toBeNull();
    expect(container.querySelector('.fm-bottom')).toBeNull();
    expect(screen.getByRole('group', { name: '再生' })).toBeInTheDocument();
    expect(screen.getByText(/^地図の外: /)).toHaveTextContent('applies the policy rate to subtotal');
    // 濃い箱だけ押せる
    expect(boxes(container).filter((b) => b.classList.contains('click')).map((b) => b.dataset.id)).toEqual(['com.example.order.domain.Order']);
  });

  it('小さい形では今のステップの箱へ scrollIntoView しない。窓は縮めた地図の高さ', async () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = function (this: Element) {
      spy(this.className);
    };
    const { container } = render(<Harness chapter={0} />);
    await waitFor(() => expect(boxes(container).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /次 ▶/ }));
    fireEvent.click(screen.getByRole('button', { name: /次 ▶/ }));
    expect(spy.mock.calls.filter(([c]) => String(c).includes('fm-box'))).toEqual([]);
    const stage = container.querySelector<HTMLElement>('.fm-stage')!;
    const zoom = container.querySelector<HTMLElement>('.fm-zoom')!;
    expect(parseFloat(stage.style.height)).toBeLessThanOrEqual(REQ_MAP_MAX_H);
    expect(zoom.style.transform).toMatch(/^scale\(/);
  });

  it('地図のある章に入ったときは差分の見出しへ送らず、地図を先に見せる。濃い箱を押すとその差分へ送る', async () => {
    const old = Element.prototype.scrollIntoView;
    const heads: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      if (this.classList.contains('req-hunk-head')) heads.push(this.closest('[data-req-hunk]')?.getAttribute('data-req-hunk') ?? '');
    };
    try {
      const { container } = render(<Harness chapter={1} />);
      await waitFor(() => expect(boxes(container).length).toBeGreaterThan(0));
      expect(heads).toEqual([]);
      fireEvent.click(boxes(container).find((b) => b.classList.contains('click'))!);
      expect(heads).toEqual([last.selectedHunk]);
    } finally {
      Element.prototype.scrollIntoView = old;
    }
  });

  it('濃い箱を押すと、その章の差分へ移る（req.focus）', async () => {
    const { container } = render(<Harness chapter={1} />);
    await waitFor(() => expect(boxes(container).length).toBeGreaterThan(0));
    const box = boxes(container).find((b) => b.classList.contains('click'))!;
    fireEvent.click(box);
    expect(last.view).toBe('req');
    expect(last.requirement.chapter).toBe(1);
    expect(last.analysis!.chapters![1]!.hunkIds).toContain(last.selectedHunk);
    expect(last.requirement.focusN).toBeGreaterThan(1);
  });

  it('再生帯の次は章ではなく地図を進める', async () => {
    const { container } = render(<Harness chapter={1} />);
    await waitFor(() => expect(boxes(container).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /次 ▶/ }));
    expect(last.requirement.chapter).toBe(1);
    expect(last.requirement.map.step).toBeGreaterThan(0);
  });

  it('地図を出さない章は理由を 1 行出す', () => {
    const none = render(<Harness chapter={4} />);
    expect(none.container.querySelector('.fmap')).toBeNull();
    expect(screen.getByText('地図は出していません。差分が見つからない要求です。')).toBeInTheDocument();
    none.unmount();
    render(<Harness chapter={6} />);
    expect(screen.getByText('地図は出していません。この章の差分は、処理の流れの上にありません。')).toBeInTheDocument();
  });

  it('はじめにの地図は全部を ② の色で、箱に要求のチップが付き、押すとその章へ', async () => {
    const { container } = render(<Harness chapter="start" />);
    await waitFor(() => expect(container.querySelectorAll('.fm-chip').length).toBeGreaterThan(0));
    expect(container.querySelector('.fm-box.dimc')).toBeNull();
    const chips = [...container.querySelectorAll<HTMLElement>('.fm-chip')].map((c) => c.textContent);
    expect(chips).toContain('要求 1');
    expect(chips).toContain('要求 4');
    fireEvent.click([...container.querySelectorAll<HTMLElement>('.fm-chip')].find((c) => c.textContent === '要求 4')!);
    expect(last.requirement.chapter).toBe(3);
  });

  it('はじめにの箱を押すと、その箱の最初の要求の章へ', async () => {
    const { container } = render(<Harness chapter="start" />);
    await waitFor(() => expect(boxes(container).length).toBeGreaterThan(0));
    fireEvent.click(boxes(container).find((b) => b.dataset.id === 'com.example.order.infra.OrderRepositoryImpl')!);
    expect(last.requirement.chapter).toBe(3);
  });

  it('地図を上に留めるボタンで留める。終わりの章には地図が無い', async () => {
    const { container } = render(<Harness chapter={1} />);
    await waitFor(() => expect(boxes(container).length).toBeGreaterThan(0));
    expect(container.querySelector('.req-map.pin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '地図を上に留める' }));
    expect(container.querySelector('.req-map.pin')).not.toBeNull();
    expect(last.requirement.pin).toBe(true);
  });

  it('最後の章には地図が無い', () => {
    const { container } = render(<Harness chapter="end" />);
    expect(container.querySelector('.fmap')).toBeNull();
  });
});
