// すべての操作はコマンド（設計書 18.2）。reduce は純粋で、副作用は effects として返す。
import type { ReviewState, ThemeSettings, UiSettings } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { canSend, diffModeOf, initialState, reduce, themeOf, type AppState } from '../src/state/reducer.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
/** テーマの既定（3.5）: OS に合わせ、ライトは Latte、ダークは Mocha */
const DEFAULT_THEME: ThemeSettings = { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' };
const lastPath = () => [...new Set(fixtureAnalysis().hunks.map((h) => h.path))].sort().at(-1)!;

function loaded(): AppState {
  const analysis = fixtureAnalysis();
  const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
  return reduce(initialState(), { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
}

describe('reduce', () => {
  it('data.loaded で最初のファイルと hunk が選ばれ、入口の地図タブに着く（3.1）', () => {
    const s = loaded();
    expect(s.view).toBe('home');
    expect(s.home).toEqual({ tab: 'map', sel: null, ticket: false, stage: 1, path: [], step: 0, play: false });
    expect(s.selectedFile).toBe('src/main/kotlin/com/example/admin/OrderAdminView.kt');
    expect(s.selectedHunk).toBe(s.analysis!.hunks.find((h) => h.path === s.selectedFile)!.id);
  });

  it('hunk.markViewed は選択中の hunk をトグルし、saveState を返す', () => {
    const s0 = loaded();
    const r1 = reduce(s0, { id: 'hunk.markViewed' });
    expect(r1.state.review!.viewed).toEqual([s0.selectedHunk]);
    expect(r1.effects).toEqual([{ type: 'saveState' }]);
    const r2 = reduce(r1.state, { id: 'hunk.markViewed' });
    expect(r2.state.review!.viewed).toEqual([]);
  });

  it('hunk.markViewed に hunkId を渡すとその hunk をトグルする', () => {
    const s0 = loaded();
    const other = s0.analysis!.hunks[5]!.id;
    expect(reduce(s0, { id: 'hunk.markViewed', hunkId: other }).state.review!.viewed).toEqual([other]);
  });

  it('hunk.next はファイルをまたいで次の hunk に進み、一周して戻る', () => {
    const s0 = loaded();
    let s = s0;
    const total = s0.analysis!.hunks.length;
    const seen: string[] = [];
    for (let i = 0; i < total; i++) {
      seen.push(s.selectedHunk!);
      const r = reduce(s, { id: 'hunk.next' });
      expect(r.effects).toEqual([]);
      s = r.state;
    }
    expect(new Set(seen).size).toBe(total);
    expect(s.selectedHunk).toBe(s0.selectedHunk);
    expect(s.selectedFile).toBe(s0.selectedFile);
  });

  it('hunk.prev は先頭から末尾へ回る', () => {
    const s0 = loaded();
    const s = reduce(s0, { id: 'hunk.prev' }).state;
    expect(s.selectedHunk).not.toBe(s0.selectedHunk);
    expect(s.selectedFile).toBe(lastPath());
  });

  it('file.next / file.prev はファイルを循環し、先頭 hunk を選ぶ', () => {
    const s0 = loaded();
    const s1 = reduce(s0, { id: 'file.next' }).state;
    expect(s1.selectedFile).toBe('src/main/kotlin/com/example/analytics/OrderMetrics.kt');
    expect(s1.selectedHunk).toBe(s1.analysis!.hunks.find((h) => h.path === s1.selectedFile)!.id);
    expect(reduce(s1, { id: 'file.prev' }).state.selectedFile).toBe(s0.selectedFile);
    expect(reduce(s0, { id: 'file.prev' }).state.selectedFile).toBe(lastPath());
  });

  it('file.select はファイルと先頭 hunk を選ぶ', () => {
    const s = reduce(loaded(), { id: 'file.select', path: 'src/main/kotlin/com/example/order/domain/Order.kt' }).state;
    expect(s.selectedFile).toBe('src/main/kotlin/com/example/order/domain/Order.kt');
    expect(s.analysis!.hunks.find((h) => h.id === s.selectedHunk)!.path).toBe(s.selectedFile);
  });

  it('diff.mode.unified / sbs は差分一覧の画面では設定（ui.json）の diffMode.d を変えて保存する', () => {
    const r = reduce(reduce(loaded(), { id: 'view.diff' }).state, { id: 'diff.mode.unified' });
    expect(diffModeOf(r.state).d).toBe('uni');
    expect(r.state.ui.diffMode).toEqual({ d: 'uni' });
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
    expect(diffModeOf(reduce(r.state, { id: 'diff.mode.sbs' }).state).d).toBe('sbs');
  });

  it('左右 / 統合は解析を切り替えても変わらない（PR ごとに持たない）', () => {
    const s = reduce(reduce(loaded(), { id: 'view.diff' }).state, { id: 'diff.mode.unified' }).state;
    const analysis = fixtureAnalysis();
    const summary = { key: '42', headSha: 'f'.repeat(40), pr: analysis.pr, mtime: 2, repoName: 'order-service' };
    const other = reduce(s, { id: 'data.loaded', summary, analysis, review: emptyReview() }).state;
    expect(diffModeOf(other)).toEqual({ b: 'sbs', c: 'sbs', d: 'uni' });
  });

  it('jump.ide は選択中 hunk の path と lnNew で openUrl を返す', () => {
    const s = loaded();
    const h = s.analysis!.hunks.find((x) => x.id === s.selectedHunk)!;
    expect(reduce(s, { id: 'jump.ide' }).effects).toEqual([
      { type: 'openUrl', url: `jetbrains://idea/navigate/reference?project=order-service&path=${encodeURIComponent(h.path + ':' + h.lnNew)}` },
    ]);
  });

  it('config.loaded で表示設定が入り、jump.ide は ide.project と ide.product を使う（11 章）', () => {
    const s0 = loaded();
    const config = { packagePrefix: 'com.example', theme: { mode: 'light' as const, light: 'latte', dark: 'mocha', accent: 'teal' }, ide: { scheme: 'jetbrains' as const, product: 'idea-ce', project: 'order-service-2' } };
    const r = reduce(s0, { id: 'config.loaded', config });
    expect(r.effects).toEqual([]);
    expect(r.state.config).toEqual(config);
    const h = r.state.analysis!.hunks.find((x) => x.id === r.state.selectedHunk)!;
    expect(reduce(r.state, { id: 'jump.ide' }).effects).toEqual([
      { type: 'openUrl', url: `jetbrains://idea-ce/navigate/reference?project=order-service-2&path=${encodeURIComponent(h.path + ':' + h.lnNew)}` },
    ]);
  });

  it('ide.project が無ければ jump.ide の project は repoName', () => {
    const s0 = loaded();
    const r = reduce(s0, { id: 'config.loaded', config: { theme: DEFAULT_THEME, ide: { scheme: 'jetbrains', product: 'idea' } } });
    expect(reduce(r.state, { id: 'jump.ide' }).effects[0]).toMatchObject({ url: expect.stringContaining('project=order-service&') });
  });

  it('コメント: adopt / edit / save / reset / discard の遷移', () => {
    const s0 = loaded();
    const c = { id: 'c1', path: 'p', line: 1, side: 'RIGHT' as const, body: 'first', source: 'claude-code', state: 'draft' as const };
    const s = { ...s0, review: { ...s0.review!, comments: [c] } };
    const adopted = reduce(s, { id: 'comment.adopt', commentId: 'c1' });
    expect(adopted.state.review!.comments[0]!.state).toBe('adopted');
    expect(adopted.effects).toEqual([{ type: 'saveState' }]);
    const editing = reduce(s, { id: 'comment.edit', commentId: 'c1' }).state;
    expect(editing.review!.comments[0]!.state).toBe('edit');
    const saved = reduce(editing, { id: 'comment.save', commentId: 'c1', body: 'second' }).state;
    expect(saved.review!.comments[0]).toMatchObject({ state: 'adopted', body: 'second' });
    expect(reduce(saved, { id: 'comment.reset', commentId: 'c1' }).state.review!.comments[0]!.state).toBe('draft');
    expect(reduce(s, { id: 'comment.discard', commentId: 'c1' }).state.review!.comments[0]!.state).toBe('discarded');
  });

  it('comment.send は採用があれば sending にして sendComments effect を返す', () => {
    const s0 = loaded();
    const pr = { ...s0, current: { ...s0.current!, key: '42' } };
    const c = { id: 'c1', path: ORDER, line: 3, side: 'RIGHT' as const, body: 'first', source: 'claude-code', state: 'adopted' as const };
    const s = { ...pr, review: { ...pr.review!, comments: [c] } };
    expect(s.send).toEqual({ status: 'idle' });
    const r = reduce(s, { id: 'comment.send' });
    expect(r.state.send).toEqual({ status: 'sending' });
    expect(r.effects).toEqual([{ type: 'sendComments' }]);
    // 送信中の二度押しは無視
    expect(reduce(r.state, { id: 'comment.send' }).effects).toEqual([]);
  });

  it('comment.send は採用が無いときは何もしない。local（PR が無い）も採用があれば送る（AI に返す。12 章）', () => {
    const s0 = loaded();
    const c = { id: 'c1', path: ORDER, line: 3, side: 'RIGHT' as const, body: 'first', source: 'claude-code', state: 'adopted' as const };
    const local = { ...s0, review: { ...s0.review!, comments: [c] } };
    expect(reduce(local, { id: 'comment.send' }).effects).toEqual([{ type: 'sendComments' }]);
    const noneAdopted = { ...s0, current: { ...s0.current!, key: '42' }, review: { ...s0.review!, comments: [{ ...c, state: 'draft' as const }] } };
    expect(reduce(noneAdopted, { id: 'comment.send' })).toEqual({ state: noneAdopted, effects: [] });
  });

  it('comment.send は、採用が GitHub の差分に出ない行だけなら何もしない（GitHub はこの行にコメントを付けられない）。差分の範囲が無い解析なら送る', () => {
    const s0 = loaded();
    const off = { id: 'c1', path: 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt', line: 10, side: 'RIGHT' as const, body: 'x', source: 'reviewer', state: 'adopted' as const };
    const pr = { ...s0, current: { ...s0.current!, key: '42' }, review: { ...s0.review!, comments: [off] } };
    expect(canSend(pr)).toBe(false);
    expect(reduce(pr, { id: 'comment.send' })).toEqual({ state: pr, effects: [] });
    const old = { ...pr, analysis: { ...pr.analysis! } };
    delete old.analysis.githubDiff;
    expect(canSend(old)).toBe(true);
  });

  it('comment.sent に url が無ければ（local）AI に返した。待っている AI がいたかを持つ', () => {
    const s0 = loaded();
    const c = { id: 'c1', path: 'p', line: 1, side: 'RIGHT' as const, body: 'first', source: 'reviewer', state: 'adopted' as const };
    const sending = reduce({ ...s0, review: { ...s0.review!, comments: [c] } }, { id: 'comment.send' }).state;
    const ok = reduce(sending, { id: 'comment.sent', key: 'local', headSha: sending.current!.headSha, ids: ['c1'], waiting: false });
    expect(ok.state.review!.comments.map((x) => x.state)).toEqual(['sent']);
    expect(ok.state.send).toEqual({ status: 'returned', waiting: false });
    expect(ok.effects).toEqual([{ type: 'saveState' }]);
  });

  it('comment.sent は該当を sent にして url を持ち保存する。comment.sendFailed はエラー文を持つ', () => {
    const s0 = loaded();
    const c = (id: string, state: 'adopted' | 'draft') => ({ id, path: 'p', line: 1, side: 'RIGHT' as const, body: id, source: 'claude-code', state });
    const s = { ...s0, current: { ...s0.current!, key: '42' }, review: { ...s0.review!, comments: [c('c1', 'adopted'), c('c2', 'draft')] } };
    const sending = reduce(s, { id: 'comment.send' }).state;
    const ok = reduce(sending, { id: 'comment.sent', key: '42', headSha: sending.current!.headSha, ids: ['c1'], url: 'https://github.com/o/r/pull/42#r1' });
    expect(ok.state.review!.comments.map((x) => x.state)).toEqual(['sent', 'draft']);
    expect(ok.state.send).toEqual({ status: 'sent', url: 'https://github.com/o/r/pull/42#r1' });
    expect(ok.effects).toEqual([{ type: 'saveState' }]);
    const ng = reduce(sending, { id: 'comment.sendFailed', key: '42', headSha: sending.current!.headSha, message: 'HTTP 422' });
    expect(ng.state.review!.comments.map((x) => x.state)).toEqual(['adopted', 'draft']);
    expect(ng.state.send).toEqual({ status: 'error', message: 'HTTP 422' });
    expect(ng.effects).toEqual([]);
  });

  it('送信中に別の解析へ切り替えたら、遅れて来た結果は無視する（レビュー指摘 2026-09-17）', () => {
    const s0 = loaded();
    const c = { id: 'c1', path: 'p', line: 1, side: 'RIGHT' as const, body: 'first', source: 'claude-code', state: 'adopted' as const };
    const s = { ...s0, current: { ...s0.current!, key: '42' }, review: { ...s0.review!, comments: [c] } };
    const sending = reduce(s, { id: 'comment.send' }).state;
    // 別の解析（local）を読み込む。その state にも同じ id の採用がある
    const analysis = fixtureAnalysis();
    const other = reduce(sending, { id: 'data.loaded', summary: s0.current!, analysis, review: { ...emptyReview(), comments: [c] } }).state;
    expect(other.send).toEqual({ status: 'idle' });
    const late = reduce(other, { id: 'comment.sent', key: '42', headSha: analysis.pr.headSha, ids: ['c1'], url: 'https://github.com/o/r/pull/42#r1' });
    expect(late).toEqual({ state: other, effects: [] });
    const lateErr = reduce(other, { id: 'comment.sendFailed', key: '42', headSha: analysis.pr.headSha, message: 'x' });
    expect(lateErr).toEqual({ state: other, effects: [] });
  });

  it('comments.arrived は、知らない AI の下書きだけを後ろに足す（保存はしない。serve のファイルに既にある）', () => {
    const s0 = loaded();
    const c = (id: string, source: string, state: 'adopted' | 'draft' = 'draft') => ({ id, path: 'p', line: 1, side: 'RIGHT' as const, body: id, source, state });
    const s = { ...s0, review: { ...s0.review!, comments: [c('a1', 'codex', 'adopted'), c('m1', 'reviewer', 'adopted')] } };
    const r = reduce(s, { id: 'comments.arrived', key: s.current!.key, headSha: s.current!.headSha, comments: [c('a1', 'codex'), c('a2', 'opencode'), c('m2', 'reviewer')] });
    expect(r.state.review!.comments.map((x) => [x.id, x.state])).toEqual([
      ['a1', 'adopted'],
      ['m1', 'adopted'],
      ['a2', 'draft'],
    ]);
    expect(r.effects).toEqual([]);
  });

  it('comments.arrived は、新しい下書きが無ければ state をそのまま返し、別の解析の分は捨てる', () => {
    const s = loaded();
    const c = { id: 'a1', path: 'p', line: 1, side: 'RIGHT' as const, body: 'x', source: 'codex', state: 'draft' as const };
    expect(reduce(s, { id: 'comments.arrived', key: s.current!.key, headSha: s.current!.headSha, comments: [] })).toEqual({ state: s, effects: [] });
    expect(reduce(s, { id: 'comments.arrived', key: 'other', headSha: s.current!.headSha, comments: [c] })).toEqual({ state: s, effects: [] });
  });

  it('テーマの選び方・ライト / ダークのフレーバー・アクセントは解析が無くても設定（ui.json）に入り保存する', () => {
    const steps = [
      [{ id: 'theme.mode', mode: 'dark' }, { mode: 'dark', light: 'latte', dark: 'mocha', accent: 'mauve' }],
      [{ id: 'theme.dark', flavor: 'frappe' }, { mode: 'dark', light: 'latte', dark: 'frappe', accent: 'mauve' }],
      [{ id: 'theme.light', flavor: 'latte' }, { mode: 'dark', light: 'latte', dark: 'frappe', accent: 'mauve' }],
      [{ id: 'theme.accent', accent: 'teal' }, { mode: 'dark', light: 'latte', dark: 'frappe', accent: 'teal' }],
      [{ id: 'theme.mode', mode: 'system' }, { mode: 'system', light: 'latte', dark: 'frappe', accent: 'teal' }],
    ] as const;
    let s = initialState();
    for (const [command, theme] of steps) {
      const r = reduce(s, command);
      expect(r.state.ui.theme).toEqual(theme);
      expect(r.effects).toEqual([{ type: 'saveUi' }]);
      s = r.state;
    }
  });

  it('今のテーマは 設定（ui.json） > ondina.config.yaml の theme > 既定（OS に合わせる）', () => {
    expect(themeOf(initialState())).toEqual(DEFAULT_THEME);
    const yaml = { mode: 'dark' as const, light: 'latte', dark: 'macchiato', accent: 'blue' };
    const withYaml = reduce(initialState(), { id: 'config.loaded', config: { theme: yaml, ide: { scheme: 'jetbrains', product: 'idea' } } }).state;
    expect(themeOf(withYaml)).toEqual(yaml);
    // 1 項目だけ変えても、ほかは今の値（yaml）のまま残る
    const picked = reduce(withYaml, { id: 'theme.accent', accent: 'teal' }).state;
    expect(themeOf(picked)).toEqual({ ...yaml, accent: 'teal' });
  });

  it('analysis.select は loadAnalysis を返す', () => {
    expect(reduce(loaded(), { id: 'analysis.select', key: '12', headSha: 'x' }).effects).toEqual([{ type: 'loadAnalysis', key: '12', headSha: 'x' }]);
  });

  it('help.keymap はトグル、escape は閉じる', () => {
    const s = reduce(loaded(), { id: 'help.keymap' }).state;
    expect(s.showKeymap).toBe(true);
    expect(reduce(s, { id: 'escape' }).state.showKeymap).toBe(false);
  });

  it('ui.llmCommand は saveUi を返し、worktreeRoot と独立に持つ。空なら消す', () => {
    const r = reduce({ ...loaded(), ui: { worktreeRoot: '/tmp/wt' } }, { id: 'ui.llmCommand', value: 'codex exec -' });
    expect(r.state.ui).toEqual({ worktreeRoot: '/tmp/wt', llmCommand: 'codex exec -' });
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
    expect(reduce(r.state, { id: 'ui.llmCommand', value: '' }).state.ui).toEqual({ worktreeRoot: '/tmp/wt' });
    expect(reduce(r.state, { id: 'ui.worktreeRoot', value: '' }).state.ui).toEqual({ llmCommand: 'codex exec -' });
  });

  it('ui.ticket はチケットの取り方の 1 項目を入れ替えて saveUi。空なら項目を消し、全部消えたら ticket ごと消す（5.1）', () => {
    const r = reduce({ ...loaded(), ui: { llmCommand: 'x' } }, { id: 'ui.ticket', field: 'jiraUrl', value: 'https://x.atlassian.net' });
    expect(r.state.ui).toEqual({ llmCommand: 'x', ticket: { jiraUrl: 'https://x.atlassian.net' } });
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
    const r2 = reduce(r.state, { id: 'ui.ticket', field: 'source', value: 'command' });
    expect(r2.state.ui.ticket).toEqual({ jiraUrl: 'https://x.atlassian.net', source: 'command' });
    const r3 = reduce(reduce(r2.state, { id: 'ui.ticket', field: 'source', value: '' }).state, { id: 'ui.ticket', field: 'jiraUrl', value: '' });
    expect(r3.state.ui).toEqual({ llmCommand: 'x' });
  });

  it('ui.loaded は設定（ui.json）を丸ごと受ける', () => {
    const ui = { llmCommand: 'claude -p', theme: { mode: 'light' as const, light: 'latte', dark: 'frappe', accent: 'peach' }, diffMode: { b: 'uni' as const } };
    const s = reduce(initialState(), { id: 'ui.loaded', ui }).state;
    expect(s.ui).toEqual(ui);
    expect(themeOf(s)).toEqual(ui.theme);
    expect(diffModeOf(s)).toEqual({ b: 'uni', c: 'sbs', d: 'sbs' });
  });

  it('ui.loaded は古い形のテーマ（1 つのフレーバー）をその明暗に固定して読み、次の保存で新しい形を書く', () => {
    const old = { llmCommand: 'claude -p', theme: { flavor: 'frappe', accent: 'peach' } } as unknown as UiSettings;
    const s = reduce(initialState(), { id: 'ui.loaded', ui: old }).state;
    expect(themeOf(s)).toEqual({ mode: 'dark', light: 'latte', dark: 'frappe', accent: 'peach' });
    const saved = reduce(s, { id: 'ui.worktreeRoot', value: '/tmp/wt' }).state.ui;
    expect(saved).toEqual({ llmCommand: 'claude -p', worktreeRoot: '/tmp/wt', theme: { mode: 'dark', light: 'latte', dark: 'frappe', accent: 'peach' } });
  });

  it('ui.loaded はテーマが壊れていれば読まず、yaml・既定のテーマで描く', () => {
    const s = reduce(initialState(), { id: 'ui.loaded', ui: { llmCommand: 'x', theme: 'latte' } as unknown as UiSettings }).state;
    expect(s.ui).toEqual({ llmCommand: 'x' });
    expect(themeOf(s)).toEqual(DEFAULT_THEME);
  });

  it('ui.worktreeRoot は saveUi を返す', () => {
    const r = reduce(loaded(), { id: 'ui.worktreeRoot', value: '/tmp/wt' });
    expect(r.state.ui.worktreeRoot).toBe('/tmp/wt');
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
  });

  it('data.loaded は PR ごとの記録の古い ui（テーマ・左右 / 統合）を読まない', () => {
    const analysis = fixtureAnalysis();
    const summary = { key: 'local', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' };
    const old = { viewed: [], comments: [], ui: { flavor: 'latte', accent: 'teal', diffMode: { b: 'uni', c: 'uni', d: 'uni' } } } as unknown as ReviewState;
    const s = reduce(initialState(), { id: 'data.loaded', summary, analysis, review: old }).state;
    expect(s.review).toEqual({ viewed: [], comments: [] });
    expect(themeOf(s)).toEqual(DEFAULT_THEME);
    expect(diffModeOf(s)).toEqual({ b: 'sbs', c: 'sbs', d: 'sbs' });
  });

  it('データ未読込のときの操作は何もしない', () => {
    const r = reduce(initialState(), { id: 'hunk.next' });
    expect(r.state).toEqual(initialState());
    expect(r.effects).toEqual([]);
  });
});

describe('How 分解の画面（3.2）のコマンド', () => {
  const symbol = (s: AppState, id: string | null) => s.analysis!.hunks.find((h) => h.id === id)?.symbol;
  const rep = (s: AppState) => s.analysis!.hunks.find((h) => h.symbol === 'discountField()')!;
  const inB = () => reduce(loaded(), { id: 'view.hows' }).state;

  it('how.select は絞り込みをトグルし、別の How で置き換わり、how.clear で消える', () => {
    const s1 = reduce(inB(), { id: 'how.select', howId: 3 }).state;
    expect(s1.selectedHow).toBe(3);
    expect(reduce(s1, { id: 'how.select', howId: 3 }).state.selectedHow).toBeNull();
    expect(reduce(s1, { id: 'how.select', howId: 5 }).state.selectedHow).toBe(5);
    expect(reduce(s1, { id: 'how.clear' }).state.selectedHow).toBeNull();
  });

  it('escape はキーマップ表示があればそれを閉じ、無ければ絞り込みを消す', () => {
    const s1 = reduce(reduce(inB(), { id: 'how.select', howId: 3 }).state, { id: 'help.keymap' }).state;
    const s2 = reduce(s1, { id: 'escape' }).state;
    expect(s2.showKeymap).toBe(false);
    expect(s2.selectedHow).toBe(3);
    expect(reduce(s2, { id: 'escape' }).state.selectedHow).toBeNull();
  });

  it('group.toggle は hunk の束を代表 id で開閉する。束に属さない hunk では何もしない', () => {
    const s0 = inB();
    const member = s0.analysis!.hunks.find((h) => h.symbol === 'total()' && h.path.includes('cart'))!;
    const s1 = reduce(s0, { id: 'group.toggle', hunkId: member.id }).state;
    expect(s1.openGroups).toEqual([rep(s0).id]);
    expect(reduce(s1, { id: 'group.toggle', hunkId: member.id }).state.openGroups).toEqual([]);
    const sql = s0.analysis!.hunks.find((h) => h.symbol === 'V421__discount.sql')!;
    expect(reduce(s1, { id: 'group.toggle', hunkId: sql.id }).state.openGroups).toEqual([rep(s0).id]);
  });

  it('group.toggle は hunkId が無ければ選択中の hunk の束を開く', () => {
    const s0 = reduce(inB(), { id: 'hunk.select', hunkId: rep(inB()).id }).state;
    expect(reduce(s0, { id: 'group.toggle' }).state.openGroups).toEqual([rep(s0).id]);
  });

  it('How 分解の画面では j / k が How 順で動き、畳んだ束は代表だけを通る', () => {
    const s0 = inB();
    const sql = s0.analysis!.hunks.find((h) => h.symbol === 'V421__discount.sql')!;
    const s1 = reduce(s0, { id: 'hunk.select', hunkId: sql.id }).state;
    const s2 = reduce(s1, { id: 'hunk.next' }).state;
    expect(symbol(s2, s2.selectedHunk)).toBe('DiscountCommand.kt');
    expect(s2.selectedFile).toContain('DiscountCommand.kt');
    const order = s0.analysis!.hunks.find((h) => h.symbol === 'Order')!;
    const s3 = reduce(reduce(s1, { id: 'hunk.select', hunkId: order.id }).state, { id: 'hunk.next' }).state;
    expect(symbol(s3, s3.selectedHunk)).toBe('discountField()');
    const s4 = reduce(s3, { id: 'hunk.next' }).state;
    expect(symbol(s4, s4.selectedHunk)).toBe('`applies the policy rate to subtotal`()');
    expect(symbol(s4, reduce(s4, { id: 'hunk.prev' }).state.selectedHunk)).toBe('discountField()');
  });

  it('束を展開していれば j は代表の次に逸脱へ進む', () => {
    const s0 = inB();
    const s1 = reduce(reduce(s0, { id: 'hunk.select', hunkId: rep(s0).id }).state, { id: 'group.toggle' }).state;
    const s2 = reduce(s1, { id: 'hunk.next' }).state;
    expect(symbol(s2, s2.selectedHunk)).toBe('apply()');
    expect(s2.selectedFile).toContain('promo/PromoService.kt');
  });

  it('絞り込み中の j は属さない hunk を飛ばす（How 1 は 1 件なので動かない）', () => {
    const s0 = reduce(inB(), { id: 'how.select', howId: 1 }).state;
    const sql = s0.analysis!.hunks.find((h) => h.symbol === 'V421__discount.sql')!;
    const s1 = reduce(s0, { id: 'hunk.select', hunkId: sql.id }).state;
    expect(reduce(s1, { id: 'hunk.next' }).state.selectedHunk).toBe(sql.id);
  });

  it('選択中の hunk が絞り込みの外にいるときの j は、絞り込みの先頭へ', () => {
    const s0 = reduce(inB(), { id: 'how.select', howId: 3 }).state;
    const sql = s0.analysis!.hunks.find((h) => h.symbol === 'V421__discount.sql')!;
    const s1 = reduce(s0, { id: 'hunk.select', hunkId: sql.id }).state;
    expect(symbol(s1, reduce(s1, { id: 'hunk.next' }).state.selectedHunk)).toBe('Order');
  });

  it('差分一覧の画面では j / k は今までどおり path 順', () => {
    const s0 = reduce(loaded(), { id: 'view.diff' }).state;
    const s1 = reduce(s0, { id: 'hunk.next' }).state;
    expect(s1.selectedFile).toBe('src/main/kotlin/com/example/analytics/OrderMetrics.kt');
  });

  it('diff.mode.unified / sbs は今いる画面の設定に効く（How 分解は b、差分一覧は d）', () => {
    const b = reduce(inB(), { id: 'diff.mode.sbs' }).state;
    expect(diffModeOf(b)).toEqual({ b: 'sbs', c: 'sbs', d: 'sbs' });
    const d = reduce(reduce(b, { id: 'view.diff' }).state, { id: 'diff.mode.unified' }).state;
    expect(diffModeOf(d)).toEqual({ b: 'sbs', c: 'sbs', d: 'uni' });
    const a = reduce(reduce(d, { id: 'view.home' }).state, { id: 'diff.mode.sbs' });
    expect(diffModeOf(a.state)).toEqual({ b: 'sbs', c: 'sbs', d: 'uni' });
    expect(a.effects).toEqual([]);
  });
});

describe('コマンドパレット（18.2）', () => {
  it('palette.open はトグル、palette.close は閉じる', () => {
    const s0 = loaded();
    expect(s0.showPalette).toBe(false);
    const s1 = reduce(s0, { id: 'palette.open' }).state;
    expect(s1.showPalette).toBe(true);
    expect(reduce(s1, { id: 'palette.open' }).state.showPalette).toBe(false);
    expect(reduce(s1, { id: 'palette.close' }).state.showPalette).toBe(false);
  });

  it('escape は上に重なっているものを先に閉じ、無くなってから How の絞り込みを消し、最後に入口へ', () => {
    let s = reduce(loaded(), { id: 'view.hows' }).state;
    s = reduce(s, { id: 'how.select', howId: 1 }).state;
    s = reduce(s, { id: 'help.keymap' }).state;
    s = reduce(s, { id: 'escape' }).state;
    expect(s.showKeymap).toBe(false);
    expect(s.selectedHow).toBe(1);
    s = reduce(s, { id: 'palette.open' }).state;
    s = reduce(s, { id: 'escape' }).state;
    expect(s.showPalette).toBe(false);
    expect(s.selectedHow).toBe(1);
    s = reduce(s, { id: 'escape' }).state;
    expect(s.selectedHow).toBeNull();
    expect(s.view).toBe('hows');
    s = reduce(s, { id: 'escape' }).state;
    expect(s.view).toBe('home');
  });

  it('キーマップ表示とパレットは同時に開かない（同じ overlay が重なるため）', () => {
    let s = reduce(loaded(), { id: 'help.keymap' }).state;
    s = reduce(s, { id: 'palette.open' }).state;
    expect(s.showKeymap).toBe(false);
    expect(s.showPalette).toBe(true);
    s = reduce(s, { id: 'help.keymap' }).state;
    expect(s.showPalette).toBe(false);
    expect(s.showKeymap).toBe(true);
  });

  it('解析が読めていなければ palette.open は効かない（届いた瞬間に不意に開くのを避ける）', () => {
    expect(reduce(initialState(), { id: 'palette.open' }).state.showPalette).toBe(false);
  });

  it('How を選ぶと How 分解の画面へ移って絞り込み、パレットを閉じる', () => {
    const s0 = reduce(loaded(), { id: 'palette.open' }).state;
    const s = reduce(s0, { id: 'palette.pick', target: { kind: 'how', howId: 3 } }).state;
    expect(s.view).toBe('hows');
    expect(s.selectedHow).toBe(3);
    expect(s.showPalette).toBe(false);
  });

  it('ファイルを選ぶと差分一覧の画面へ移り、そのファイルの先頭 hunk を選ぶ', () => {
    const s0 = reduce(loaded(), { id: 'palette.open' }).state;
    const path = lastPath();
    const s = reduce(s0, { id: 'palette.pick', target: { kind: 'file', path } }).state;
    expect(s.view).toBe('diff');
    expect(s.selectedFile).toBe(path);
    expect(s.selectedHunk).toBe(s.analysis!.hunks.find((h) => h.path === path)!.id);
    expect(s.showPalette).toBe(false);
  });

  it('シンボルを選ぶとその hunk を選ぶ。hunk を映さない画面にいたら差分一覧へ移る', () => {
    const s0 = reduce(loaded(), { id: 'palette.open' }).state;
    expect(s0.view).toBe('home');
    const hunk = s0.analysis!.hunks.find((h) => h.kind !== 'ripple')!;
    const s = reduce(s0, { id: 'palette.pick', target: { kind: 'hunk', hunkId: hunk.id } }).state;
    expect(s.view).toBe('diff');
    expect(s.selectedHunk).toBe(hunk.id);
    expect(s.selectedFile).toBe(hunk.path);
    expect(s.showPalette).toBe(false);
  });

  it('How 分解の画面にいるなら画面を変えない', () => {
    let s = reduce(loaded(), { id: 'view.hows' }).state;
    const hunk = s.analysis!.hunks.find((h) => h.kind !== 'ripple')!;
    s = reduce(s, { id: 'palette.pick', target: { kind: 'hunk', hunkId: hunk.id } }).state;
    expect(s.view).toBe('hows');
  });

  it('畳んだ束の中の hunk を選んだら束を開く（畳んだままでは描かれないため）', () => {
    let s = reduce(loaded(), { id: 'view.hows' }).state;
    const member = s.analysis!.hunks.find((h) => h.group && h.id !== h.group.representative)!;
    expect(s.openGroups).toEqual([]);
    s = reduce(s, { id: 'palette.pick', target: { kind: 'hunk', hunkId: member.id } }).state;
    expect(s.openGroups).toEqual([member.group!.representative]);
    // すでに開いていれば増やさない
    s = reduce(s, { id: 'palette.pick', target: { kind: 'hunk', hunkId: member.id } }).state;
    expect(s.openGroups).toEqual([member.group!.representative]);
  });

  it('シンボルを選んだら How の絞り込みは解除する（絞り込みの外だと見えないため）', () => {
    let s = reduce(loaded(), { id: 'view.hows' }).state;
    s = reduce(s, { id: 'how.select', howId: 1 }).state;
    s = reduce(s, { id: 'palette.pick', target: { kind: 'hunk', hunkId: s.analysis!.hunks[0]!.id } }).state;
    expect(s.selectedHow).toBeNull();
  });

  it('知らない hunk id なら何も変えずにパレットだけ閉じる', () => {
    const s0 = reduce(loaded(), { id: 'palette.open' }).state;
    const s = reduce(s0, { id: 'palette.pick', target: { kind: 'hunk', hunkId: 'nope' } }).state;
    expect(s.selectedHunk).toBe(s0.selectedHunk);
    expect(s.showPalette).toBe(false);
  });
});

describe('地図の倍率', () => {
  it('初めの倍率は 100%（保存しないので、開くたびにここに戻る）', () => {
    expect(initialState().mapZoom).toBe(1);
    expect(loaded().mapZoom).toBe(1);
  });

  it('map.zoom で倍率が変わり、保存はしない', () => {
    const r = reduce(loaded(), { id: 'map.zoom', zoom: 0.7 });
    expect(r.state.mapZoom).toBe(0.7);
    expect(r.effects).toEqual([]);
  });
});

describe('Enter（画面ごとに意味が違う）', () => {
  it('How 分解の画面では選択中の hunk の束を開閉し、差分一覧では何もしない', () => {
    const s0 = reduce(loaded(), { id: 'view.hows' }).state;
    const rep = s0.analysis!.hunks.find((h) => h.group)!.group!.representative;
    const s1 = reduce(reduce(s0, { id: 'hunk.select', hunkId: rep }).state, { id: 'enter' }).state;
    expect(s1.openGroups).toEqual([rep]);
    const d = reduce(loaded(), { id: 'view.diff' }).state;
    expect(reduce(d, { id: 'enter' }).state).toBe(d);
  });
});

describe('入口（3.1）', () => {
  it('home.tab は入口にいるときだけタブを変える', () => {
    const s0 = loaded();
    expect(reduce(s0, { id: 'home.tab', tab: 'text' }).state.home.tab).toBe('text');
    const d = reduce(s0, { id: 'view.diff' }).state;
    expect(reduce(d, { id: 'home.tab', tab: 'text' }).state).toBe(d);
  });

  it('home.select はコースを選び、同じコースでもう一度押すと解除。Esc でも解除', () => {
    const s1 = reduce(loaded(), { id: 'home.select', courseId: 3 }).state;
    expect(s1.home.sel).toBe(3);
    expect(reduce(s1, { id: 'home.select', courseId: 3 }).state.home.sel).toBeNull();
    expect(reduce(s1, { id: 'home.select', courseId: 5 }).state.home.sel).toBe(5);
    expect(reduce(s1, { id: 'escape' }).state.home.sel).toBeNull();
  });

  it('知らないコースは選ばない。コース外（0）は選べる', () => {
    const s0 = loaded();
    expect(reduce(s0, { id: 'home.select', courseId: 99 }).state).toBe(s0);
    expect(reduce(s0, { id: 'home.select', courseId: 0 }).state.home.sel).toBe(0);
  });

  it('入口のタブと選んだコースは、別の画面へ移って戻っても残る。別の解析を読むと戻る', () => {
    const s1 = reduce(reduce(loaded(), { id: 'home.tab', tab: 'text' }).state, { id: 'home.select', courseId: 2 }).state;
    const back = reduce(reduce(s1, { id: 'view.diff' }).state, { id: 'view.home' }).state;
    expect(back.home).toEqual({ tab: 'text', sel: 2, ticket: false, stage: 1, path: [], step: 0, play: false });
  });

  // 2026-10-29: 説明タブの左は 1 背景 / 2 この PR。n は切り替え、段のボタンはその段へ。地図タブなら説明タブにする
  it('home.stage は説明タブの段を切り替える（stage があればその段）。地図タブなら説明タブにする。入口の外では効かない。別の解析を読むと背景に戻る', () => {
    const s0 = loaded();
    expect(s0.home.stage).toBe(1);
    const s1 = reduce(s0, { id: 'home.stage' }).state;
    expect(s1.home).toMatchObject({ tab: 'text', stage: 2 });
    expect(reduce(s1, { id: 'home.stage' }).state.home.stage).toBe(1);
    expect(reduce(s1, { id: 'home.stage', stage: 2 }).state.home.stage).toBe(2);
    const diff = reduce(s0, { id: 'view.diff' }).state;
    expect(reduce(diff, { id: 'home.stage' }).state).toBe(diff);
    const a = fixtureAnalysis();
    const again = reduce(s1, { id: 'data.loaded', summary: { key: 'local', headSha: a.pr.headSha, pr: a.pr, mtime: 2, repoName: 'order-service' }, analysis: a, review: emptyReview() }).state;
    expect(again.home.stage).toBe(1);
  });

  it('home.ticket は説明タブのチケットの原文を開く / 畳む。別の解析を読むと畳む', () => {
    const s0 = loaded();
    expect(s0.home.ticket).toBe(false);
    const s1 = reduce(s0, { id: 'home.ticket' }).state;
    expect(s1.home.ticket).toBe(true);
    expect(reduce(s1, { id: 'home.ticket' }).state.home.ticket).toBe(false);
    const a = fixtureAnalysis();
    const again = reduce(s1, { id: 'data.loaded', summary: { key: 'local', headSha: a.pr.headSha, pr: a.pr, mtime: 2, repoName: 'order-service' }, analysis: a, review: emptyReview() }).state;
    expect(again.home.ticket).toBe(false);
  });
});

describe('設定のモーダル', () => {
  it('settings.open はトグル（開くと全般のタブ）で、キーマップ表示とパレットを閉じる', () => {
    const s0 = reduce(reduce(loaded(), { id: 'help.keymap' }).state, { id: 'palette.open' }).state;
    const s1 = reduce(s0, { id: 'settings.open' }).state;
    expect(s1).toMatchObject({ settings: 'general', showPalette: false, showKeymap: false });
    expect(reduce(s1, { id: 'settings.open' }).state.settings).toBeNull();
    expect(reduce(s1, { id: 'settings.close' }).state.settings).toBeNull();
  });

  it('タブを指定して開く（キーの一覧の「設定で変える」）と、開いていても閉じずにそのタブ', () => {
    const s1 = reduce(reduce(loaded(), { id: 'help.keymap' }).state, { id: 'settings.open', tab: 'keys' }).state;
    expect(s1).toMatchObject({ settings: 'keys', showKeymap: false });
    expect(reduce(s1, { id: 'settings.open', tab: 'keys' }).state.settings).toBe('keys');
    expect(reduce(reduce(loaded(), { id: 'settings.open' }).state, { id: 'settings.open', tab: 'keys' }).state.settings).toBe('keys');
  });

  it('settings.tab でタブを替える。閉じていれば何もしない', () => {
    const s1 = reduce(loaded(), { id: 'settings.open' }).state;
    const s2 = reduce(s1, { id: 'settings.tab', tab: 'keys' }).state;
    expect(s2.settings).toBe('keys');
    expect(reduce(s2, { id: 'settings.tab', tab: 'general' }).state.settings).toBe('general');
    expect(reduce(loaded(), { id: 'settings.tab', tab: 'keys' }).state.settings).toBeNull();
  });

  it('設定を開いているとパレット・キーマップは設定を閉じてから開く', () => {
    const s1 = reduce(loaded(), { id: 'settings.open', tab: 'keys' }).state;
    expect(reduce(s1, { id: 'palette.open' }).state).toMatchObject({ settings: null, showPalette: true });
    expect(reduce(s1, { id: 'help.keymap' }).state).toMatchObject({ settings: null, showKeymap: true });
  });

  it('Esc は設定を閉じるだけ（画面は動かない）', () => {
    const s1 = reduce(reduce(loaded(), { id: 'home.select', courseId: 3 }).state, { id: 'settings.open' }).state;
    const s2 = reduce(s1, { id: 'escape' }).state;
    expect(s2.settings).toBeNull();
    expect(s2.home.sel).toBe(3);
  });

  it('解析が無くても開ける（LLM コマンドを直すため）', () => {
    expect(reduce(initialState(), { id: 'settings.open' }).state.settings).toBe('general');
  });
});

describe('ショートカットキーの設定', () => {
  it('ui.keymap は変えた操作だけを ui.json に入れて保存する。解析が無くても変えられる', () => {
    const r1 = reduce(initialState(), { id: 'ui.keymap', changes: [{ action: 'view.diff', keys: ['x'] }] });
    expect(r1.state.ui.keymap).toEqual({ 'view.diff': ['x'] });
    expect(r1.effects).toEqual([{ type: 'saveUi' }]);
    const r2 = reduce(r1.state, { id: 'ui.keymap', changes: [{ action: 'view.diff', keys: ['j'] }, { action: 'hunk.next', keys: ['x', 'ArrowDown'] }] });
    expect(r2.state.ui.keymap).toEqual({ 'view.diff': ['j'], 'hunk.next': ['x', 'ArrowDown'] });
  });

  it('既定に戻した操作は消え、全部戻ったら keymap ごと消える（ほかの設定は残す）', () => {
    const s0 = { ...initialState(), ui: { llmCommand: 'codex exec -', keymap: { 'view.diff': ['x'] } } };
    const r = reduce(s0, { id: 'ui.keymap', changes: [{ action: 'view.diff', keys: ['d'] }] });
    expect(r.state.ui).toEqual({ llmCommand: 'codex exec -' });
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
  });

  it('ui.keymap.reset はすべて既定に戻して保存する', () => {
    const s0 = { ...initialState(), ui: { llmCommand: 'codex exec -', keymap: { 'view.diff': ['x'], 'course.fold': [] } } };
    const r = reduce(s0, { id: 'ui.keymap.reset' });
    expect(r.state.ui).toEqual({ llmCommand: 'codex exec -' });
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
  });
});

describe('列の幅（ui.json の panes。2026-10-20）', () => {
  it('ui.pane は列の幅を px の整数で ui.json に入れて保存する。ほかの列と設定は残す。解析が無くても変えられる', () => {
    const s0 = { ...initialState(), ui: { llmCommand: 'codex exec -', panes: { diffTree: 400 } } };
    const r = reduce(s0, { id: 'ui.pane', pane: 'stopTree', px: 312.6 });
    expect(r.state.ui).toEqual({ llmCommand: 'codex exec -', panes: { diffTree: 400, stopTree: 313 } });
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
  });

  it('px が null の ui.pane はその列を既定の幅に戻し（panes から消す）、全部戻ったら panes ごと消す', () => {
    const s0 = { ...initialState(), ui: { llmCommand: 'codex exec -', panes: { stopTree: 300, stopGuide: 420 } } };
    const r = reduce(s0, { id: 'ui.pane', pane: 'stopGuide', px: null });
    expect(r.state.ui).toEqual({ llmCommand: 'codex exec -', panes: { stopTree: 300 } });
    expect(r.effects).toEqual([{ type: 'saveUi' }]);
    expect(reduce(r.state, { id: 'ui.pane', pane: 'stopTree', px: null }).state.ui).toEqual({ llmCommand: 'codex exec -' });
  });
});
