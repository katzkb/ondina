// 要求コース PR 8: チケットのある PR の上の帯・全体図・説明タブ・最後のページ（画面）。
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { fakeApi } from './fakeApi.js';
import { requirementAnalysis } from './requirementFixture.js';

// jsdom に Web Worker が無いので、地図の配置は elkjs を同じスレッドで走らせる
vi.mock('../src/map/elk.js', async () => {
  const ELK = (await import('elkjs/lib/elk.bundled.js')).default;
  const elk = new ELK();
  return { workerElk: () => elk };
});

const ready = () => screen.findByLabelText('入口');
beforeEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

function analysis() {
  const a = requirementAnalysis();
  a.pr.ticket = { ref: 'SHOP-421', key: 'SHOP-421', source: 'jira', at: '2026-11-09T00:00:00Z', title: '割引', body: '本文', format: 'markdown' };
  a.llmSpecs = { command: 'fixture', status: 'ok' };
  return a;
}

describe('上の帯', () => {
  it('「要求 0/5」を出し、「コース」「仕様」のチップと「目的ごと」は出さない', async () => {
    render(<App api={fakeApi(analysis()).api} />);
    await ready();
    const meter = screen.getByLabelText('完了メーター');
    expect(meter.textContent).toContain('要求 0/5');
    expect(meter.textContent).not.toContain('コース');
    expect(meter.textContent).not.toContain('仕様');
    expect(screen.queryByRole('button', { name: '目的ごと' })).toBeNull();
  });
  it('要求 n/m を押すと要求コース、見るほど n が増える', async () => {
    const a = analysis();
    const fake = fakeApi(a);
    render(<App api={fake.api} />);
    await ready();
    await act(async () => { fireEvent.click(within(screen.getByLabelText('完了メーター')).getByRole('button', { name: /^要求/ })); });
    expect(await screen.findByLabelText('要求コース')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/start');
  });
  it('締めは要求コースの最後のページ。締めにあった部品が並ぶ', async () => {
    render(<App api={fakeApi(analysis(), { prUrl: 'https://github.com/o/r/pull/42' }).api} />);
    await ready();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '締め' })); });
    const main = within(screen.getByRole('main'));
    expect(await main.findByRole('heading', { level: 2, name: 'Approve の前に' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/end');
    for (const name of ['自分のメモそのまま送る', 'AI の下書き採用したものだけ送る']) expect(main.getByRole('heading', { level: 3, name: new RegExp(name.slice(0, 5)) })).toBeInTheDocument();
    expect(main.getByRole('button', { name: /GitHub で承認/ })).toBeInTheDocument();
    expect(main.getByRole('button', { name: /返すコメントはまだありません|送るコメントはまだありません/ })).toBeInTheDocument();
  });
  it('/hows と /closing を直接開いても要求コース', async () => {
    window.history.replaceState(null, '', '/local/aaaaaaa/hows');
    render(<App api={fakeApi(analysis()).api} />);
    expect(await screen.findByLabelText('要求コース')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/start');
    cleanup();
    window.history.replaceState(null, '', '/local/aaaaaaa/closing');
    render(<App api={fakeApi(analysis()).api} />);
    expect(await screen.findByLabelText('要求コース')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/end');
  });
});

describe('全体図', () => {
  it('見出しは「差分 n · 要求 m」、色の帯は無し、始めるボタンは「はじめから読む」', async () => {
    const a = analysis();
    const { container } = render(<App api={fakeApi(a).api} />);
    await ready();
    expect(screen.getByText(`差分 ${a.hunks.length} · 要求 6`)).toBeInTheDocument();
    expect(container.querySelector('.share')).toBeNull();
    expect(screen.queryByRole('button', { name: /コース 1 から始める/ })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /はじめから読む/ })); });
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/start');
  });
  it('下は章のカード。差分が見つからない要求はそう書き、押すとその章へ', async () => {
    const a = analysis();
    render(<App api={fakeApi(a).api} />);
    await ready();
    const cards = within(screen.getByRole('list', { name: '章の並び' })).getAllByRole('listitem');
    expect(cards).toHaveLength(a.chapters!.length);
    expect(cards[0]).toHaveTextContent('要求 1');
    expect(cards[0]).toHaveTextContent(a.specs[0]!.text);
    expect(cards[0]).toHaveTextContent('0 / 10');
    expect(cards[4]).toHaveTextContent('差分が見つからない');
    expect(cards[6]).toHaveTextContent('つられた所');
    expect(cards[7]).toHaveTextContent('要求の外');
    await act(async () => { fireEvent.click(within(cards[1]!).getByRole('button')); });
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/1');
  });
  it('地図タブの箱には、要求コースの「はじめに」と同じ要求のチップが付く', async () => {
    const { container } = render(<App api={fakeApi(analysis()).api} />);
    await ready();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: /^地図/ })); });
    await waitFor(() => expect(container.querySelectorAll('.fm-chip').length).toBeGreaterThan(0));
    const chips = [...container.querySelectorAll<HTMLElement>('.fm-chip')].map((c) => c.textContent);
    expect(chips).toContain('要求 1');
    fireEvent.click([...container.querySelectorAll<HTMLElement>('.fm-chip')].find((c) => c.textContent === '要求 4')!);
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/3');
  });
});

describe('説明タブのチケットの要求', () => {
  it('右は「差分 n」のチップ（無ければ赤い「差分が見つからない」）。押すとその章へ', async () => {
    const a = analysis();
    const { container } = render(<App api={fakeApi(a).api} />);
    await ready();
    const rows = [...container.querySelectorAll('.spec-ai .spec')];
    expect(rows).toHaveLength(6);
    expect(container.querySelector('.spec-ai .cpick')).toBeNull();
    expect(within(rows[0] as HTMLElement).getByRole('button', { name: '差分 10' })).toBeInTheDocument();
    const missing = within(rows[4] as HTMLElement).getByRole('button', { name: '差分が見つからない' });
    expect(missing.className).toContain('d');
    await act(async () => { fireEvent.click(within(rows[1] as HTMLElement).getByRole('button', { name: '差分 2' })); });
    expect(window.location.pathname).toBe('/local/aaaaaaa/req/1');
  });
});
