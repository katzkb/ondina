import { useReducer } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RequirementCourseView } from '../src/components/RequirementCourseView.js';
import { initialState, reduce } from '../src/state/reducer.js';
import { emptyReview } from './fixture.js';
import { requirementAnalysis, requirementBookends } from './requirementFixture.js';
import type { Command } from '../src/commands/commands.js';
import { NO_REQUIREMENT } from '../src/requirement.js';
import type { Analysis, CommentDraft, ReviewState } from '@ondina/model';

// jsdom に Web Worker が無いので、地図の配置は elkjs を同じスレッドで走らせる
vi.mock('../src/map/elk.js', async () => {
  const ELK = (await import('elkjs/lib/elk.bundled.js')).default;
  const elk = new ELK();
  return { workerElk: () => elk };
});

function Harness({ analysis = requirementAnalysis(), chapter = 0, review = emptyReview() }: { analysis?: Analysis; chapter?: number | 'start' | 'end'; review?: ReviewState }) {
  const loaded = reduce(initialState(), { id: 'data.loaded', analysis, review, summary: { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' } }).state;
  const [state, dispatch] = useReducer((s: typeof loaded, c: Parameters<typeof reduce>[1]) => reduce(s, c).state, reduce(loaded, { id: 'req.go', chapter }).state);
  return <RequirementCourseView analysis={state.analysis!} review={state.review!} at={state.requirement} selectedHunk={state.selectedHunk} memo={state.memo} mode="uni" dispatch={dispatch} />;
}

describe('requirement course from goldens', () => {
  it('keeps Github file order, folds other chapters, and allows opening a file and its hunks', () => {
    const a = requirementAnalysis();
    a.githubDiff = [...a.githubDiff!].reverse();
    const { container } = render(<Harness analysis={a} />);
    expect([...container.querySelectorAll('[data-req-file]')].map((e) => e.getAttribute('data-req-file'))).toEqual(a.githubDiff.map((f) => f.path));
    const other = a.hunks.find((h) => !a.chapters![0]!.hunkIds.includes(h.id))!;
    fireEvent.click(screen.getByRole('button', { name: `ファイルを開閉 ${other.path}` }));
    const hunk = container.querySelector(`[data-req-hunk="${other.id}"]`)! as HTMLElement;
    expect(hunk.querySelector('.req-code')).toBeNull();
    fireEvent.click(within(hunk).getByRole('button', { name: /開く/ }));
    expect(hunk.querySelector('.req-code .cd')).not.toBeNull();
    expect(hunk.querySelector('.req-guide')).toBeNull();
  });
  it('renders quote and source, dotted AI guess, none, and no placeholder when intent absent', () => {
    const a = requirementAnalysis();
    const ids = a.intents!.map((i) => i.hunkId);
    const absent = a.hunks.find((h) => !h.group)!;
    a.intents = a.intents!.filter((i) => i.hunkId !== absent.id);
    a.chapters = [{ kind: 'extra', hunkIds: [...new Set([...ids, absent.id])] }];
    const { container } = render(<Harness analysis={a} />);
    const written = a.intents!.flatMap((i) => i.notes).find((n) => n.kind === 'written')!;
    expect(container.querySelector('.intent.written q')).toHaveTextContent(written.kind === 'written' ? written.quote : '');
    expect(screen.getAllByText('コミット aaaaaaa').length).toBeGreaterThan(0);
    expect(container.querySelector('.intent.guess')).toHaveTextContent('推定AI');
    expect(container.querySelector('.intent.none')).toHaveTextContent('書いていない');
    expect(container.querySelector(`[data-req-hunk="${absent.id}"] .intent`)).toBeNull();
  });
  it('shows representative full intent and members one-line guide with same actions', () => {
    const a = requirementAnalysis();
    const index = a.chapters!.findIndex((c) => c.kind === 'follow');
    const { container } = render(<Harness analysis={a} chapter={index} />);
    const member = a.hunks.find((h) => a.chapters![index]!.hunkIds.includes(h.id) && h.group && h.group.representative !== h.id)!;
    const guide = container.querySelector(`[data-req-hunk="${member.id}"] .req-guide`)! as HTMLElement;
    expect(guide).toHaveTextContent('同じ書き換え 22 件の 1 つです。パターン: getDiscount() → discount');
    expect(within(guide).getByRole('button', { name: '聞く' })).toBeInTheDocument();
    expect(within(guide).getByRole('button', { name: '意見を書く' })).toBeInTheDocument();
  });
  it('empty requirement has requirement text and no action buttons', () => {
    const a = requirementAnalysis();
    const index = a.chapters!.findIndex((c) => c.kind === 'spec' && c.hunkIds.length === 0);
    render(<Harness analysis={a} chapter={index} />);
    expect(screen.getByText('この要求に当たる差分が見つかりません')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^わかった/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: '読む差分' })).getByRole('heading', { level: 2 })).not.toHaveTextContent('要求の外');
  });
  it('ask starts without selected lines; selecting with diff + enables saving and undo leaves draft', () => {
    const { container } = render(<Harness />);
    const hunk = container.querySelector('[data-req-hunk].focus')! as HTMLElement;
    fireEvent.click(within(hunk).getByRole('button', { name: '聞く' }));
    fireEvent.change(within(hunk).getByRole('textbox', { name: '聞くこと' }), { target: { value: '意図を教えてください' } });
    expect(within(hunk).getByRole('button', { name: '保存' })).toBeDisabled();
    const mark = within(hunk).getAllByRole('button', { name: /行目にメモ/ })[0]!;
    fireEvent.mouseDown(mark, { button: 0 });
    fireEvent.mouseUp(window);
    expect(within(hunk).getByRole('button', { name: '保存' })).toBeEnabled();
    fireEvent.click(within(hunk).getByRole('button', { name: '保存' }));
    expect(within(hunk).getByText('意図を教えてください')).toBeInTheDocument();
    fireEvent.click(within(hunk).getByRole('button', { name: '「聞く」を外す' }));
    expect(within(hunk).getByRole('button', { name: /^わかった/ })).toBeInTheDocument();
    expect(within(hunk).getByText('意図を教えてください')).toBeInTheDocument();
  });
  it.each(['start', 'end'] as const)('has simple %s page and existing-screen link', (chapter) => {
    render(<Harness chapter={chapter} />);
    expect(within(screen.getByRole('region', { name: '読む差分' })).getByRole('heading', { level: 2 })).toHaveTextContent(chapter === 'start' ? 'はじめに' : 'Approve の前に');
    expect(screen.getByRole('button', { name: chapter === 'start' ? '説明を開く' : '締めを開く' })).toBeInTheDocument();
  });
});

it('local analysis without Github metadata still shows code and permits reviewer-picked memo lines', () => {
  const a = requirementAnalysis();
  delete a.githubDiff;
  a.pr.number = 0;
  const { container } = render(<Harness analysis={a} />);
  const current = container.querySelector('.gh-hunk.focus')! as HTMLElement;
  expect(current).not.toBeNull();
  fireEvent.click(within(current).getByRole('button', { name: '意見を書く' }));
  fireEvent.change(within(current).getByRole('textbox', { name: '意見' }), { target: { value: '意見です' } });
  fireEvent.mouseDown(within(current).getAllByRole('button', { name: /行目にメモ/ })[0]!, { button: 0 });
  fireEvent.mouseUp(window);
  expect(within(current).getByRole('button', { name: '保存' })).toBeEnabled();
  fireEvent.click(within(current).getByRole('button', { name: '保存' }));
  expect(within(current).getByText('意見です')).toBeInTheDocument();
});


it('scrolls the #1 header on chapter entry, repeat entry, and the next hunk after understanding', () => {
  const oldScroll = HTMLElement.prototype.scrollIntoView;
  const calls: Array<{ id: string | null; badge: string | null; options: ScrollIntoViewOptions | boolean | undefined }> = [];
  HTMLElement.prototype.scrollIntoView = function(options) {
    calls.push({ id: this.closest('[data-req-hunk]')?.getAttribute('data-req-hunk') ?? null, badge: this.querySelector('.req-number')?.textContent ?? null, options });
  };
  try {
    const a = requirementAnalysis();
    delete a.flows; // 地図の無い章: 入ったら最初の差分の見出しへ送る
    const { container } = render(<Harness analysis={a} />);
    expect(calls.at(-1)).toEqual({ id: a.chapters![0]!.hunkIds[0], badge: '1', options: { block: 'start' } });
    fireEvent.click(within(screen.getByRole('navigation', { name: '章' })).getByRole('button', { name: /^要求 1/ }));
    expect(calls).toHaveLength(2);
    const current = container.querySelector('.gh-hunk.focus')! as HTMLElement;
    fireEvent.click(within(current).getByRole('button', { name: /^わかった/ }));
    expect(calls.at(-1)).toEqual({ id: a.chapters![0]!.hunkIds[1], badge: '2', options: { block: 'start' } });
  } finally {
    if (oldScroll) HTMLElement.prototype.scrollIntoView = oldScroll;
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
});

it('shows chapter completion without navigating, with a next chapter button', () => {
  const a = requirementAnalysis();
  a.chapters = [{ kind: 'spec', specId: 's1', hunkIds: [a.chapters![0]!.hunkIds[0]!] }, ...a.chapters!.slice(1)];
  const { container } = render(<Harness analysis={a} />);
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(within(container.querySelector('.gh-hunk.focus')! as HTMLElement).getByRole('button', { name: /^わかった/ }));
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('この章の差分をすべて見ました。');
  expect(container.querySelector('.gh-hunk.focus')).toHaveAttribute('data-req-hunk', a.chapters[0]!.hunkIds[0]);
  fireEvent.click(within(status).getByRole('button', { name: /^次の章/ }));
  expect(container.querySelector('.gh-hunk.focus')).toHaveAttribute('data-req-hunk', a.chapters[1]!.hunkIds[0]);
});

it('Files changed shows filename before its directory and preserves the full path title', () => {
  const a = requirementAnalysis();
  render(<Harness analysis={a} />);
  const path = a.githubDiff!.find((f) => f.path.endsWith('/OrderController.kt'))!.path;
  const button = within(screen.getByRole('complementary', { name: 'Files changed' })).getByTitle(path);
  expect(button.textContent).toMatch(/^OrderController\.kt/);
  expect(button.querySelector('.req-file-name')).toHaveTextContent('OrderController.kt');
  expect(button.querySelector('.req-file-dir')).toHaveTextContent('src/main/kotlin/com/example/order/api/');
});


it('narrows to cards in chapter order, keeping transition names and toggle state', () => {
  const a = requirementAnalysis();
  a.chapters![0]!.hunkIds.reverse();
  const ids = a.chapters![0]!.hunkIds;
  const { container } = render(<Harness analysis={a} />);
  const names = new Map(ids.map((id) => [id, (container.querySelector(`[data-req-hunk="${id}"]`) as HTMLElement).style.viewTransitionName]));
  for (const id of ids) expect(names.get(id)).toBe(`req-h${a.hunks.findIndex((h) => h.id === id)}`);
  expect(new Set(names.values()).size).toBe(ids.length);
  const toggle = screen.getByRole('button', { name: /^この要求の差分だけにする/ });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(toggle);
  expect(screen.getByText(`この要求の差分 ${ids.length} か所だけを、読む順に並べています`)).toBeInTheDocument();
  expect(container.querySelector('[data-req-file]')).toBeNull();
  expect(container.querySelector('.gh-hunk')).toBeNull();
  const cards = [...container.querySelectorAll<HTMLElement>('.req-card')];
  expect(cards.map((c) => c.dataset.reqHunk)).toEqual(ids);
  for (const [i, card] of cards.entries()) {
    expect(card.style.viewTransitionName).toBe(names.get(ids[i]!));
    expect(card.querySelector('.req-number')).toHaveTextContent(String(i + 1));
    expect(card.querySelector('.req-code .cd')).not.toBeNull();
    expect(card.querySelector('.req-guide')).not.toBeNull();
  }
  expect(cards[0]).toHaveClass('focus');
  fireEvent.click(cards[1]!.querySelector('.req-hunk-head')!);
  expect(cards[1]).toHaveClass('focus');
  expect(cards[0]).not.toHaveClass('focus');
  const back = screen.getByRole('button', { name: /^全部のファイルに戻す/ });
  expect(back).toHaveAttribute('aria-pressed', 'true');
  expect(back).toHaveClass('on');
  fireEvent.click(back);
  expect(container.querySelector('.req-card')).toBeNull();
  expect(container.querySelectorAll('[data-req-file]')).toHaveLength(a.githubDiff!.length);
});

it('does not scroll on narrowing, but scrolls the focused card after moving', () => {
  const oldScroll = HTMLElement.prototype.scrollIntoView;
  const calls: HTMLElement[] = [];
  HTMLElement.prototype.scrollIntoView = function() { calls.push(this); };
  try {
    const a = requirementAnalysis();
    delete a.flows; // 地図の無い章
    render(<Harness analysis={a} />);
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^この要求の差分だけにする/ }));
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^次の場所/ }));
    expect(calls).toHaveLength(2);
    expect(calls.at(-1)?.parentElement).toHaveClass('req-card', 'focus');
  } finally {
    if (oldScroll) HTMLElement.prototype.scrollIntoView = oldScroll;
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
});


it.each([
  { viewed: true, label: 'ask', state: 'draft', status: 'ask', text: '聞く' },
  { viewed: true, label: 'ask', state: 'discarded', status: 'ok', text: 'わかった' },
  { viewed: true, label: 'imo', state: 'draft', status: 'ok', text: 'わかった' },
  { viewed: false, label: 'ask', state: 'draft', status: null, text: null },
] as const)('card status follows Guide: %j', ({ viewed, label, state, status, text }) => {
  const a = requirementAnalysis();
  const id = a.chapters![0]!.hunkIds[0]!;
  const h = a.hunks.find((h) => h.id === id)!;
  const review: ReviewState = { ...emptyReview(), viewed: viewed ? [id] : [], comments: [{ id: 'question', source: 'reviewer', label, state, path: h.path, side: 'RIGHT', line: h.lnNew, body: '質問です' }] };
  const { container } = render(<Harness analysis={a} review={review} />);
  fireEvent.click(screen.getByRole('button', { name: /^この要求の差分だけにする/ }));
  const card = container.querySelector('.req-card.focus')!;
  const badge = card.querySelector('.req-hunk-head .req-more');
  if (status) {
    expect(card).toHaveClass(`st-${status}`);
    expect(badge).toHaveTextContent(text!);
    expect(card.querySelector('.req-guide-title b')).toHaveTextContent(text!);
  } else {
    expect(card).not.toHaveClass('st-ok', 'st-ask');
    expect(badge).toBeNull();
  }
});

function bookendView(chapter: 'start' | 'end', analysis = requirementBookends(), review = emptyReview()) {
  const commands: Command[] = [];
  const result = render(<RequirementCourseView analysis={analysis} review={review} at={{ ...NO_REQUIREMENT, chapter }} selectedHunk={null} memo={initialState().memo} mode="uni" dispatch={(c) => commands.push(c)} />);
  const center = within(screen.getByRole('region', { name: '読む差分' }));
  const box = (name: string) => center.getByRole('heading', { name: (_name, el) => el.textContent === name, level: 3 }).closest('.box')! as HTMLElement;
  return { ...result, commands, center, box };
}

describe('requirement start page', () => {
  it('orders project, ticket reason, example and computed correspondence, marking AI text', () => {
    const { center, box } = bookendView('start');
    expect(center.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'はじめに', 'どんな案件の一部？', 'このチケットの理由AI', 'この PR で変わることAI', '処理の流れと要求自動', '要求と差分の対応自動',
    ]);
    expect(box('このチケットの理由AI')).toHaveClass('ai');
    expect(box('このチケットの理由AI')).toHaveTextContent('割引の持ち方を変える。');
    expect(box('このチケットの理由AI')).toHaveTextContent('チケット SHOP-421 の原文');
    expect(box('このチケットの理由AI')).toHaveTextContent('割引を注文ごとに記録するため。');
    expect(box('この PR で変わることAI')).toHaveClass('ai');
    expect(box('この PR で変わることAI')).toHaveTextContent('割引を適用すると');
    expect(box('要求と差分の対応自動')).not.toHaveClass('ai');
    expect(center.getByText('チケットの要求 3 件のうち、差分があるもの 2 件、差分が見つからないもの 1 件です。')).toBeInTheDocument();
  });
  it('renders every chapter in order with counts or missing chip and dispatches row and next commands', () => {
    const a = requirementBookends();
    const { commands, center, box } = bookendView('start', a);
    const rows = within(box('要求と差分の対応自動')).getAllByRole('button');
    expect(rows).toHaveLength(5);
    ['要求 1', '要求 2', '要求 3', 'つられた所', '要求の外'].forEach((label, i) => expect(rows[i]).toHaveTextContent(label));
    expect(rows[0]).toHaveTextContent('差分 2 か所');
    expect(rows[1]).toHaveTextContent('差分 1 か所');
    expect(rows[2]!.querySelector('.chip')).toHaveTextContent('差分が見つからない');
    expect(rows[3]).toHaveTextContent('差分 2 か所');
    expect(rows[4]!.querySelector('.chip')).toHaveTextContent('差分が見つからない');
    expect(within(rows[0]!).getByTitle(a.specs[0]!.text)).toHaveTextContent(a.specs[0]!.text);
    fireEvent.click(rows[2]!);
    fireEvent.click(center.getByRole('button', { name: /次へ · 要求 1/ }));
    fireEvent.click(center.getByRole('button', { name: '説明を開く' }));
    expect(commands).toEqual([{ id: 'req.go', chapter: 2 }, { id: 'req.nextChapter' }, { id: 'route.go', page: { kind: 'explain' } }]);
  });
  it('omits absent project, example and AI marks, and omits the zero missing count', () => {
    const a = requirementBookends();
    delete a.background!.project;
    delete a.summary.example;
    delete a.summary.headline;
    a.chapters = a.chapters!.filter((c) => c.kind !== 'spec' || c.hunkIds.length > 0);
    const { center, box } = bookendView('start', a);
    expect(center.queryByRole('heading', { name: 'どんな案件の一部？' })).toBeNull();
    expect(center.queryByRole('heading', { name: /この PR で変わること/ })).toBeNull();
    expect(box('このチケットの理由')).not.toHaveClass('ai');
    expect(within(box('このチケットの理由')).queryByText('AI')).toBeNull();
    expect(center.getByText('チケットの要求 2 件のうち、差分があるもの 2 件です。')).toBeInTheDocument();
  });
  it.each(['missing', 'error', 'no why'] as const)('retains the ticket reason fallback: %s', (kind) => {
    const a = requirementBookends();
    a.background!.why = [];
    if (kind === 'missing') delete a.pr.ticket;
    if (kind === 'error') a.pr.ticket!.error = '取得できませんでした';
    const { box } = bookendView('start', a);
    expect(box('このチケットの理由AI')).toHaveTextContent(kind === 'no why'
      ? 'チケットに、なぜこの変更をするかの文が見つかりませんでした。'
      : 'チケットがないので、なぜこの変更をするかは出していません。analyze に --ticket を付けると、チケットの背景をここに出します。');
  });
});

describe('requirement end page', () => {
  it('counts complete files and active reviewer comments, lists remaining files in file order, and jumps to the first unviewed line', () => {
    const a = requirementBookends();
    const logger = a.hunks.filter((h) => h.path.endsWith('/Logger.kt')).sort((x, y) => x.lnNew - y.lnNew);
    const invoice = a.hunks.filter((h) => h.path.endsWith('/InvoiceBuilder.kt')).sort((x, y) => x.lnNew - y.lnNew);
    const feature = a.hunks.find((h) => h.path.endsWith('/FeatureFlags.kt'))!;
    const ask: CommentDraft = { id: 'ask', source: 'reviewer', state: 'draft', label: 'ask', path: logger[1]!.path, line: logger[1]!.lnOld, side: 'LEFT', body: 'ログの用途を教えてください' };
    const imo: CommentDraft = { ...ask, id: 'imo', label: 'imo', state: 'sent', path: invoice[1]!.path, line: invoice[1]!.lnNew, side: 'RIGHT', body: '集計の意見です' };
    const outside: CommentDraft = { ...ask, id: 'outside', path: 'removed.kt', line: 999, body: '差分の外の質問です' };
    const memo = { ...ask, id: 'memo', body: '従来のメモ' };
    delete memo.label;
    const comments: CommentDraft[] = [ask, imo, outside,
      { ...ask, id: 'discarded-ask', state: 'discarded', body: '除外した質問' },
      { ...imo, id: 'discarded-imo', state: 'discarded', body: '除外した意見' },
      { ...ask, id: 'ai', source: 'claude-code', body: 'AI の質問' },
      memo,
    ];
    const { container, box, commands, center } = bookendView('end', a, { viewed: [logger[0]!.id, feature.id], comments });
    expect([...container.querySelectorAll('.req-tiles > *')].map((e) => e.textContent)).toEqual(['1 / 3GitHub の Viewed', '2聞くこと', '1意見', '2まだのファイル']);
    expect(center.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['要求と差分のずれ自動', '聞くこと', '意見', 'まだ「わかった」も「聞く」も付けていないファイル']);
    const remaining = within(box('まだ「わかった」も「聞く」も付けていないファイル')).getAllByRole('button');
    expect(remaining.map((r) => r.textContent)).toEqual([logger[0]!.path, invoice[0]!.path]);
    fireEvent.click(remaining[0]!);
    fireEvent.click(remaining[1]!);
    const askBox = within(box('聞くこと'));
    const askRow = askBox.getByRole('button', { name: /ログの用途/ });
    expect(askRow).toHaveTextContent(`${ask.path}:${ask.line}`);
    fireEvent.click(askRow);
    expect(askBox.getByText(outside.body).closest('button')).toBeNull();
    fireEvent.click(within(box('意見')).getByRole('button', { name: /集計の意見/ }));
    for (const body of ['除外した質問', '除外した意見', 'AI の質問', '従来のメモ']) expect(center.queryByText(body)).toBeNull();
    const mismatch = within(box('要求と差分のずれ自動')).getAllByRole('button');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]).toHaveTextContent(`要求 3 · ${a.specs[2]!.text}`);
    fireEvent.click(mismatch[0]!);
    fireEvent.click(center.getByRole('button', { name: '締めを開く' }));
    expect(commands).toEqual([
      { id: 'req.goHunk', hunkId: logger[1]!.id }, { id: 'req.goHunk', hunkId: invoice[0]!.id },
      { id: 'req.goHunk', hunkId: logger[1]!.id }, { id: 'req.goHunk', hunkId: invoice[1]!.id },
      { id: 'req.go', chapter: 2 }, { id: 'view.closing' },
    ]);
  });
  it('shows empty messages and keeps closing available when everything is viewed and no requirements are missing', () => {
    const a = requirementBookends();
    a.chapters = a.chapters!.filter((c) => c.kind !== 'spec' || c.hunkIds.length > 0);
    const { container, box, center, commands } = bookendView('end', a, { viewed: a.hunks.map((h) => h.id), comments: [] });
    expect([...container.querySelectorAll('.req-tiles > *')].map((e) => e.textContent)).toEqual(['3 / 3GitHub の Viewed', '0聞くこと', '0意見', '0まだのファイル']);
    expect(box('まだ「わかった」も「聞く」も付けていないファイル')).toHaveTextContent('ありません。');
    expect(box('聞くこと')).toHaveTextContent('まだありません。');
    expect(box('意見')).toHaveTextContent('まだありません。');
    expect(box('要求と差分のずれ自動')).toHaveTextContent('差分が見つからない要求はありません。');
    fireEvent.click(center.getByRole('button', { name: '締めを開く' }));
    expect(commands).toEqual([{ id: 'view.closing' }]);
  });
});
