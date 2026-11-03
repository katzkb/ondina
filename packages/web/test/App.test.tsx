// App: serve の API からデータを取り、入口から各画面を描く。操作は保存される（設計書 18.4）。
import type { LatestHead, ReviewState } from '@ondina/model';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError, type Api } from '../src/api.js';
import { App } from '../src/App.js';
import { alignRows } from '../src/diff/alignRows.js';
import { fileRows } from '../src/diff/fileRows.js';
import { askAnswer, fakeApi, ORDER_KT } from './fakeApi.js';
import { setOsDark } from './osAppearance.js';
import { emptyReview, fixtureAnalysis, fixtureWithNeighbors } from './fixture.js';
import { openPr, prDetail, prList } from './prFixture.js';

// jsdom に Web Worker が無いので、地図の配置は elkjs を同じスレッドで走らせる
vi.mock('../src/map/elk.js', async () => {
  const ELK = (await import('elkjs/lib/elk.bundled.js')).default;
  const elk = new ELK();
  return { workerElk: () => elk };
});

/** 読み込んで入口が出るのを待つ */
const ready = () => screen.findByLabelText('入口');

/** 上の帯のボタンを押す */
async function press(name: string | RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

/** 起動時は入口なので、読み込みを待ってから上の帯の「差分一覧」へ（ボタンにキー D が付く） */
async function renderDiffList(api: Api) {
  const r = render(<App api={api} />);
  await ready();
  await press(/^差分一覧/);
  return r;
}

/** 差分一覧の列の最初の差分（最初のファイルの最初の差分）の「問題なし」。全部のファイルが 1 本の列なので、ほかの差分の物も見えている（2026-10-20） */
const firstOk = async () => (await screen.findAllByRole('button', { name: '問題なし' }))[0]!;

/** 今一番上に貼り付いているファイルの見出しのパス（差分一覧） */
const stuckPath = (container: HTMLElement) => container.querySelector('.dstick .fh b')?.textContent;

/** 差分一覧の列で、その差分の行にある「+」。ほかのファイルの同じ行番号と分ける。スクロールした先の行が描かれるまで待つ */
const plusIn = (container: HTMLElement, hunkId: string, name: string) =>
  waitFor(() => {
    const from = Number((container.querySelector(`#hunk-${hunkId}`)!.closest('.vrow') as HTMLElement).dataset['index']);
    const rows = [...container.querySelectorAll<HTMLElement>('.dbody > .vrow')].filter((r) => Number(r.dataset['index']) > from);
    const end = rows.findIndex((r) => r.querySelector('.hh, .fh'));
    const plus = rows.slice(0, end < 0 ? undefined : end).flatMap((r) => [...r.querySelectorAll<HTMLElement>('.mplus')]).find((b) => b.getAttribute('aria-label') === name);
    expect(plus).toBeDefined();
    return plus!;
  });

/** 「+」のある行（なぞるときにマウスが入る所。左右は片側の列、統合は行） */
const rowOf = (plus: HTMLElement) => plus.closest('.mside, .mrow, .diff') as HTMLElement;

/** 行番号の「+」を押して離す（その 1 行を選ぶ） */
function clickPlus(plus: HTMLElement) {
  fireEvent.mouseDown(plus);
  fireEvent.mouseUp(window);
}

/** 「+」を押したまま to の「+」の行までなぞって離す（範囲を選ぶ） */
function dragPlus(from: HTMLElement, to: HTMLElement) {
  fireEvent.mouseDown(from);
  fireEvent.mouseEnter(rowOf(to));
  fireEvent.mouseUp(window);
}

/** 上の帯の「締め」へ */
async function renderClosing(api: Api) {
  const r = render(<App api={api} />);
  await ready();
  await press('締め');
  await screen.findByText('完了にしたコース');
  return r;
}

/** 入口の説明タブ（キー 2） */
async function renderExplain(api: Api) {
  const r = render(<App api={api} />);
  await ready();
  await act(async () => {
    fireEvent.keyDown(window, { key: '2' });
  });
  await screen.findByText('この PR の説明');
  return r;
}

describe('App（差分一覧の画面）', () => {
  it('ファイル列と diff 列の 2 列を描き（下書きの列は締めへ移した）、最初のファイルの hunk が hunk-<id> で出る', async () => {
    const { api } = fakeApi();
    const analysis = fixtureAnalysis();
    const { container } = await renderDiffList(api);
    await screen.findByText('ファイル');
    const files = [...new Set(analysis.hunks.map((h) => h.path))].sort();
    await waitFor(() => expect(container.querySelectorAll('.file')).toHaveLength(files.length));
    const first = analysis.hunks.find((h) => h.path === files[0])!;
    expect(container.querySelector(`#hunk-${first.id}`)).not.toBeNull();
    expect(screen.queryByText('下書き')).toBeNull();
    expect(container.querySelectorAll('.vd > .col')).toHaveLength(2);
  });

  it('ファイル列: IDEA のようなツリー。中身が 1 つのフォルダはつなげて 1 行、行はファイル名。コースの色の丸と「外」の丸、見出しに「問題なし n / N」', async () => {
    const { container } = await renderDiffList(fakeApi().api);
    await screen.findByText('問題なし 0 / 48');
    await waitFor(() => expect(container.querySelectorAll('.file').length).toBe(37));
    const dirs = [...container.querySelectorAll('.tr.dir .nm')].map((d) => d.textContent);
    expect(dirs.slice(0, 4)).toEqual(['src', 'main', 'kotlin/com/example', 'admin']);
    expect(dirs).toContain('test/kotlin/com/example/order');
    const first = container.querySelector('.file')!;
    expect(first.querySelector('.nm')!.textContent).toBe('OrderAdminView.kt');
    expect(first.getAttribute('title')).toBe('src/main/kotlin/com/example/admin/OrderAdminView.kt');
    expect(first.querySelector('.cb.cc3')!.textContent).toBe('3');
    const logger = [...container.querySelectorAll('.file')].find((f) => f.textContent!.includes('Logger.kt'))!;
    expect(logger.querySelector('.cb.cc0')!.textContent).toBe('外');
    expect(container.querySelector('.chip.d')).toBeNull();
  });

  it('ファイル列: フォルダを押すと閉じて中のファイルが消え、右にまとめた問題なしの印。「すべて閉じる」「すべて開く」', async () => {
    const { container } = await renderDiffList(fakeApi().api);
    await waitFor(() => expect(container.querySelectorAll('.file').length).toBe(37));
    const tests = [...container.querySelectorAll('.tr.dir')].find((d) => d.querySelector('.nm')!.textContent === 'test/kotlin/com/example/order')!;
    expect(tests.getAttribute('aria-expanded')).toBe('true');
    expect(tests.querySelector('.vm')).toBeNull();
    fireEvent.click(tests);
    await waitFor(() => expect(container.querySelectorAll('.file').length).toBe(34));
    const shut = [...container.querySelectorAll('.tr.dir')].find((d) => d.querySelector('.nm')!.textContent === 'test/kotlin/com/example/order')!;
    expect(shut.getAttribute('aria-expanded')).toBe('false');
    expect(shut.querySelector('.vm')!.getAttribute('aria-label')).toBe('未確認');
    fireEvent.click(screen.getByRole('button', { name: 'すべて閉じる' }));
    await waitFor(() => expect(container.querySelectorAll('.tr')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'すべて開く' }));
    await waitFor(() => expect(container.querySelectorAll('.file').length).toBe(37));
  });

  it('差分の頭: コースの色の丸と「問題なし」ボタン。押すと「問題なし ✓」になり、保存され、見出しの数が増える', async () => {
    const fake = fakeApi();
    const analysis = fixtureAnalysis();
    const { container } = await renderDiffList(fake.api);
    const btn = await firstOk();
    expect(container.querySelector('.hh .cb.cc3')).not.toBeNull();
    fireEvent.click(btn);
    await screen.findByRole('button', { name: '問題なし ✓' });
    await screen.findByText('問題なし 1 / 48');
    await waitFor(() => expect(fake.states.get(`local/${analysis.pr.headSha}`)?.viewed).toHaveLength(1));
  });

  it('packagePrefix があってもツリーはリポジトリのパスのまま（つなげた行で短くなる。ヘッダに「以下」は出さない）', async () => {
    const { api } = fakeApi(fixtureAnalysis(), { config: { packagePrefix: 'com.example', theme: { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' }, ide: { scheme: 'jetbrains', product: 'idea' } } });
    const { container } = await renderDiffList(api);
    await screen.findByText('37 ファイル');
    expect(screen.queryByText(/以下/)).toBeNull();
    await waitFor(() => expect([...container.querySelectorAll('.tr.dir .nm')].map((d) => d.textContent)).toContain('kotlin/com/example'));
  });

  it('ファイル列ヘッダに追従の件数は出ない（How 分解の画面の束の行に移した。2026-09-19）', async () => {
    await renderDiffList(fakeApi(fixtureAnalysis()).api);
    await screen.findByText('ファイル');
    expect(screen.queryByText(/追従 23/)).toBeNull();
  });

  it('v で選択中の hunk が閲覧済みになり、状態が保存される', async () => {
    const fake = fakeApi();
    const analysis = fixtureAnalysis();
    const { container } = await renderDiffList(fake.api);
    await waitFor(() => expect(container.querySelectorAll('.file').length).toBeGreaterThan(0));
    const files = [...new Set(analysis.hunks.map((h) => h.path))].sort();
    const first = analysis.hunks.find((h) => h.path === files[0])!;
    await act(async () => {
      fireEvent.keyDown(window, { key: 'v' });
    });
    await waitFor(() => expect(fake.states.get(`local/${analysis.pr.headSha}`)?.viewed).toEqual([first.id]));
    expect(container.querySelector('.file .vm.all')).not.toBeNull();
  });

  it('全部のファイルが 1 本の列に並び、ファイルをクリックするとそのファイルの見出しが一番上に来る。ツリーの明るい行もそのファイル（2026-10-20）', async () => {
    const { api } = fakeApi();
    const analysis = fixtureAnalysis();
    const { container } = await renderDiffList(api);
    await waitFor(() => expect(container.querySelectorAll('.file').length).toBe(37));
    const files = [...new Set(analysis.hunks.map((h) => h.path))].sort();
    // 1 つ目のファイルの下に 2 つ目のファイルの見出しと差分が続く
    await waitFor(() => expect(stuckPath(container)).toBe(files[0]));
    expect([...container.querySelectorAll('.dbody .fh b')].map((b) => b.textContent)).toContain(files[1]);
    const far = files.find((p) => p.endsWith('/OrderRepositoryImpl.kt'))!;
    fireEvent.click([...container.querySelectorAll('.file')].find((f) => f.getAttribute('title') === far)!);
    await waitFor(() => expect(stuckPath(container)).toBe(far));
    expect(container.querySelector(`#hunk-${analysis.hunks.find((h) => h.path === far)!.id}`)).not.toBeNull();
    expect(container.querySelector('.file.on')!.getAttribute('title')).toBe(far);
  });

  it('スクロールすると、ツリーの明るい行は一番上のファイルに付いてくる', async () => {
    const { container } = await renderDiffList(fakeApi().api);
    const files = [...new Set(fixtureAnalysis().hunks.map((h) => h.path))].sort();
    await waitFor(() => expect(container.querySelector('.file.on')!.getAttribute('title')).toBe(files[0]));
    const el = container.querySelector('.dscroll') as HTMLElement;
    const head = [...container.querySelectorAll<HTMLElement>('.dbody > .vrow')].find((r) => r.querySelector('.fh b')?.textContent === files[2])!;
    el.scrollTop = Number(head.style.transform.match(/translateY\((\d+)px\)/)![1]);
    fireEvent.scroll(el);
    await waitFor(() => expect(container.querySelector('.file.on')!.getAttribute('title')).toBe(files[2]));
    expect(stuckPath(container)).toBe(files[2]);
  });

  it('下書きは 採用 / 編集 / 破棄 でき、採用件数が送信ボタンに出る（local では AI に返す）', async () => {
    const fake = fakeApi();
    const analysis = fixtureAnalysis();
    const sha = analysis.pr.headSha;
    fake.states.set(`local/${sha}`, {
      viewed: [],
      comments: [
        { id: 'c1', path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 3, side: 'RIGHT', body: '一つ目', source: 'claude-code', state: 'draft' },
        { id: 'c2', path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 4, side: 'RIGHT', body: '二つ目', source: 'coderabbit', state: 'draft' },
      ],
    });
    await renderClosing(fake.api);
    await screen.findByText('一つ目');
    fireEvent.click(screen.getAllByRole('button', { name: '採用' })[0]!);
    await screen.findByText('AI に返す（下書き 1）');
    expect(screen.getByRole('button', { name: /AI に返す/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /AI に返す/ })).toHaveAttribute('title', expect.stringContaining('AI'));
    fireEvent.click(screen.getByRole('button', { name: '編集' }));
    const ta = await screen.findByLabelText('コメント本文');
    fireEvent.change(ta, { target: { value: '書き換えた' } });
    fireEvent.click(screen.getByRole('button', { name: 'この文で採用' }));
    await screen.findByText('AI に返す（下書き 2）');
    await waitFor(() => expect(fake.states.get(`local/${sha}`)!.comments.map((c) => [c.state, c.body])).toEqual([['adopted', '一つ目'], ['adopted', '書き換えた']]));
  });

  const drafts = (): ReviewState => ({
    viewed: [],
    comments: [
      { id: 'c1', path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 3, side: 'RIGHT', body: '一つ目', source: 'claude-code', state: 'adopted' },
      { id: 'c2', path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 4, side: 'RIGHT', body: '二つ目', source: 'coderabbit', state: 'draft' },
    ],
  });

  it('local の解析では「AI に返す」で採用分を返し、待っている AI がいればそう出す', async () => {
    const fake = fakeApi(fixtureAnalysis(), { send: (st) => ({ sent: st.comments.filter((c) => c.state === 'adopted').map((c) => c.id), waiting: true }) });
    const sha = fixtureAnalysis().pr.headSha;
    fake.states.set(`local/${sha}`, drafts());
    await renderClosing(fake.api);
    fireEvent.click(await screen.findByRole('button', { name: 'AI に返す（下書き 1）' }));
    await screen.findByText(/AI に返しました/);
    expect(screen.getByText(/待っている AI が受け取ります/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'GitHub で見る' })).toBeNull();
    expect(fake.states.get(`local/${sha}`)!.comments.map((c) => c.state)).toEqual(['sent', 'draft']);
  });

  it('待っている AI がいなければ、AI に頼む言い方を出す（届かないことが分かる）', async () => {
    const fake = fakeApi(fixtureAnalysis(), { send: (st) => ({ sent: st.comments.filter((c) => c.state === 'adopted').map((c) => c.id), waiting: false }) });
    fake.states.set(`local/${fixtureAnalysis().pr.headSha}`, drafts());
    await renderClosing(fake.api);
    fireEvent.click(await screen.findByRole('button', { name: 'AI に返す（下書き 1）' }));
    await screen.findByText(/いま待っている AI はいません/);
  });

  it('local の解析（GitHub の差分の範囲を持たない）では、範囲が無いという知らせを出さない（GitHub に送らない）', async () => {
    const noDiff = fixtureAnalysis();
    delete noDiff.githubDiff;
    const fake = fakeApi(noDiff);
    fake.states.set(`local/${noDiff.pr.headSha}`, { viewed: [], comments: [{ id: 'm1', path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 3, side: 'RIGHT', body: 'メモ', source: 'reviewer', state: 'adopted' }] });
    await renderClosing(fake.api);
    await screen.findByText('メモ');
    expect(screen.queryByText(/GitHub の差分の範囲がありません/)).toBeNull();
  });

  it('PR の解析では送信ボタンで採用分が送られ、送信済チップと、GitHub で公開する案内とリンクが出る', async () => {
    const fake = fakeApi(fixtureAnalysis(), { key: '42' });
    const sha = fixtureAnalysis().pr.headSha;
    fake.states.set(`42/${sha}`, drafts());
    await renderClosing(fake.api);
    const btn = await screen.findByRole('button', { name: 'GitHub にコメントを送る（下書き 1）' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await screen.findByText('送信済み');
    expect(screen.getByText(/まだ公開されていません/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /GitHub で見る/ })).toHaveAttribute('href', 'https://github.com/o/r/pull/42#pullrequestreview-9');
    expect(screen.getByRole('button', { name: '送るコメントはまだありません' })).toBeDisabled();
    // 送信済みには操作ボタンが無い（残るのは c2 の 採用 / 編集 / 破棄 だけ）
    expect(screen.getAllByRole('button', { name: '採用' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '戻す' })).toBeNull();
    await waitFor(() => expect(fake.states.get(`42/${sha}`)!.comments.map((c) => c.state)).toEqual(['sent', 'draft']));
  });

  it('送信に失敗するとボタンの下にその理由が出て、採用のまま残る', async () => {
    const fake = fakeApi(fixtureAnalysis(), {
      key: '42',
      send: () => {
        throw new Error('gh api に失敗しました: HTTP 422: Unprocessable Entity');
      },
    });
    const sha = fixtureAnalysis().pr.headSha;
    fake.states.set(`42/${sha}`, drafts());
    await renderClosing(fake.api);
    fireEvent.click(await screen.findByRole('button', { name: 'GitHub にコメントを送る（下書き 1）' }));
    await screen.findByText(/HTTP 422/);
    expect(screen.getByRole('button', { name: 'GitHub にコメントを送る（下書き 1）' })).toBeEnabled();
    expect(fake.states.get(`42/${sha}`)!.comments.map((c) => c.state)).toEqual(['adopted', 'draft']);
  });

  it('古い state ファイルの ui（PR ごとの統合表示）は読まず、設定（既定の左右）で描く', async () => {
    const fake = fakeApi();
    const analysis = fixtureAnalysis();
    fake.states.set(`local/${analysis.pr.headSha}`, { viewed: [], comments: [], ui: { flavor: 'latte', accent: 'teal', diffMode: { b: 'uni', c: 'uni', d: 'uni' } } } as unknown as ReviewState);
    const { container } = await renderDiffList(fake.api);
    await waitFor(() => expect(container.querySelector('.diff.sbs')).not.toBeNull());
  });

  it('s / u で左右と統合を切り替え、保存される', async () => {
    const fake = fakeApi();
    const { container } = await renderDiffList(fake.api);
    await waitFor(() => expect(container.querySelector('.diff.sbs')).not.toBeNull());
    await act(async () => {
      fireEvent.keyDown(window, { key: 'u' });
    });
    await waitFor(() => expect(container.querySelector('.diff.uni')).not.toBeNull());
    expect(fake.ui.diffMode).toEqual({ d: 'uni' });
  });

  it('左右 / 統合は ui.json の値で起動時から描く', async () => {
    const { container } = await renderDiffList(fakeApi(fixtureAnalysis(), { ui: { diffMode: { d: 'uni' } } }).api);
    await waitFor(() => expect(container.querySelector('.diff.uni')).not.toBeNull());
  });

  it('設定の worktree の置き場所は ui.json に保存される', async () => {
    const fake = fakeApi();
    render(<App api={fake.api} />);
    await ready();
    await press('設定');
    const input = await screen.findByLabelText('worktree の置き場所');
    fireEvent.change(input, { target: { value: '/tmp/wt' } });
    fireEvent.blur(input);
    await waitFor(() => expect(fake.ui.worktreeRoot).toBe('/tmp/wt'));
  });

  it('設定の LLM コマンドは ui.json に保存され、既存の worktree の置き場所を消さない', async () => {
    const fake = fakeApi();
    fake.ui.worktreeRoot = '/tmp/wt';
    render(<App api={fake.api} />);
    await ready();
    await press('設定');
    const input = await screen.findByLabelText('LLM コマンド（解析と案内人に聞く）');
    expect((input as HTMLInputElement).placeholder).toContain('claude -p');
    fireEvent.change(input, { target: { value: 'codex exec --skip-git-repo-check -s read-only -' } });
    fireEvent.blur(input);
    await waitFor(() => expect(fake.ui).toEqual({ worktreeRoot: '/tmp/wt', llmCommand: 'codex exec --skip-git-repo-check -s read-only -' }));
  });

  it('設定の欄で日本語の変換を確定する Enter では、欄を離れない。変換していない Enter で離れる', async () => {
    render(<App api={fakeApi().api} />);
    await ready();
    await press('設定');
    const input = await screen.findByLabelText('worktree の置き場所');
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.activeElement).not.toBe(input);
  });

  it('チケットの取り方: 既定は Jira で URL とメールの欄。コマンドに切り替えるとコマンドの欄。どれも ui.json に保存（5.1）', async () => {
    const fake = fakeApi();
    render(<App api={fake.api} />);
    await ready();
    await press('設定');
    const url = await screen.findByLabelText('Jira の URL');
    fireEvent.change(url, { target: { value: 'https://jira.example.com' } });
    fireEvent.blur(url);
    await waitFor(() => expect(fake.ui.ticket).toEqual({ jiraUrl: 'https://jira.example.com' }));
    const email = screen.getByLabelText('Jira のメール');
    fireEvent.change(email, { target: { value: 'you@example.com' } });
    fireEvent.blur(email);
    await waitFor(() => expect(fake.ui.ticket).toEqual({ jiraUrl: 'https://jira.example.com', email: 'you@example.com' }));
    expect(screen.queryByLabelText('チケットを取得するコマンド')).toBeNull();
    expect(screen.getByText(/ONDINA_TICKET_TOKEN/)).toBeInTheDocument();

    await press('コマンド');
    await waitFor(() => expect(fake.ui.ticket?.source).toBe('command'));
    expect(screen.queryByLabelText('Jira の URL')).toBeNull();
    const cmd = screen.getByLabelText('チケットを取得するコマンド');
    fireEvent.change(cmd, { target: { value: 'gh issue view "$ONDINA_TICKET" --json title,body,url' } });
    fireEvent.blur(cmd);
    await waitFor(() => expect(fake.ui.ticket).toEqual({ jiraUrl: 'https://jira.example.com', email: 'you@example.com', source: 'command', command: 'gh issue view "$ONDINA_TICKET" --json title,body,url' }));
  });
});

describe('App（入口の説明タブ。3.1）', () => {
  it('キー 2 で開き、左は 1 背景（要点）から。n で 2 この PR（例と流れの図）に替わる。右は仕様（チケット未指定）・作者の説明にマーカー', async () => {
    const a = fixtureAnalysis();
    const { container } = await renderExplain(fakeApi(a).api);
    expect(screen.getByRole('tab', { name: /背景/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('何のための PR？')).toBeInTheDocument();
    expect(container.querySelector('.ex-headline')?.textContent).toBe(a.summary.headline);
    expect(screen.getByText(/チケットがないので/)).toBeInTheDocument();
    expect(screen.getByText('PR 説明は使っていません')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'n' });
    });
    expect(screen.getByRole('tab', { name: /この PR/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('使うと何が変わる？')).toBeInTheDocument();
    expect(container.querySelectorAll('.flow-node')).toHaveLength(a.summary.flows![0]!.nodes.length);
    expect(screen.queryByText('図にないコース')).toBeNull();
    expect(screen.getByText(/チケット未指定/)).toBeInTheDocument();
    expect(screen.getByText('主張として表示')).toBeInTheDocument();
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect([...marks].map((m) => m.textContent)).toEqual(['Order が割引額を自分で持ち、計算をドメインに閉じる。', 'キャッシュ層を横断的に更新し、割引後の合計が古い値で返らないようにした']);
    // 作者の説明は Markdown として描く（見出し・リスト・インラインコード。2026-10-10）
    expect([...container.querySelectorAll('.author h2')].map((h) => h.textContent)).toEqual(['概要', '変更点']);
    expect(container.querySelectorAll('.author ul > li')).toHaveLength(6);
    expect(screen.getAllByText('差分なし')).toHaveLength(2); // 裏付け無しの文ごとに 1 つ
    expect(screen.getByText(/キャッシュに当たる変更ファイルが差分に無い/)).toBeInTheDocument();
    expect(screen.queryByText(/特定できなかった文/)).toBeNull();
  });

  it('チケットから抜き出した要求の丸を押すと、下のコースのカードが選ばれ、開始ボタンが「コース n に入る」になる。原文は押すと開く', async () => {
    const a = fixtureAnalysis();
    a.pr.ticket = { ref: 'SHOP-421.md', source: 'file', at: '2026-10-12T05:00:00.000Z', title: '注文に割引コードを適用できるようにする', body: '## 背景\n\n割引コードを配る。\n', format: 'markdown' };
    a.specs = [{ id: 's1', text: '割引コードを 1 つ適用できる', hows: [3, 5] }, { id: 's2', text: '期限切れのコードは 400 を返す', hows: [] }];
    a.llmSpecs = { command: 'fixture', status: 'ok' };
    const { container } = await renderExplain(fakeApi(a).api);
    expect([...container.querySelectorAll('.meter .m')].find((m) => m.textContent?.startsWith('仕様'))?.textContent).toBe('仕様 1/2');
    await act(async () => {
      fireEvent.click(container.querySelector('.spec-ai button.cb.cc5')!);
    });
    expect(container.querySelector('.ccard.sel .cb')?.textContent).toBe('5');
    expect(screen.getByRole('button', { name: /コース 5 に入る/ })).toBeInTheDocument();
    expect(container.querySelector('.spec-ai button.cb.cc5')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.tkt-body')).toBeNull();
    await press(/チケットの原文/);
    expect(container.querySelector('.tkt-body h2')?.textContent).toBe('背景');
  });

  it('この PR の説明は LLM の文なので、箱を点線にして見出しに「AI」のチップ（決定 3）。例の文は句点で改行', async () => {
    const a = fixtureAnalysis();
    a.summary.example = { text: '一。二。', at: [] };
    const { container } = await renderExplain(fakeApi(a).api);
    const box = screen.getByText('この PR の説明').closest('.box')!;
    expect(box.classList.contains('ai')).toBe(true);
    expect(within(box as HTMLElement).getByText('AI')).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'n' });
    });
    expect(container.querySelector('.ex-qa .ex-q')!.querySelectorAll('p')).toHaveLength(2);
  });

  it('古い形の説明（2026-10-29 まで）の解析は解析し直しを案内する。説明が空なら「説明はありません」', async () => {
    const a = fixtureAnalysis();
    a.summary = { problem: 'p。', approach: '一。二。', untouched: '三。', beforeAfter: [] };
    await renderExplain(fakeApi(a).api);
    expect(screen.getByText(/この解析は前の形の説明です/)).toBeInTheDocument();
    cleanup();
    await renderExplain(fakeApi(fixtureAnalysis({ text: false })).api);
    expect(screen.getByText(/説明はありません/)).toBeInTheDocument();
  });

  it('本文に見つからない文は「本文中に該当箇所を特定できなかった文」として別枠に出る', async () => {
    const a = fixtureAnalysis();
    a.claims.push({ text: '本文には無い文', backed: false, reason: '該当する変更が無い' });
    await renderExplain(fakeApi(a).api);
    await screen.findByText(/特定できなかった文/);
    expect(screen.getByText('本文には無い文')).toBeInTheDocument();
  });

  it('本文が保存されていない古い解析では claims を 1 文 1 行で出す', async () => {
    const a = fixtureAnalysis();
    delete a.pr.body;
    const { container } = await renderExplain(fakeApi(a).api);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(within(container.querySelector('.claims') as HTMLElement).getByText('注文に割引コードを適用できるようにする。')).toBeInTheDocument();
    expect(screen.getAllByText('差分なし')).toHaveLength(4);
    expect(screen.getByText(/キャッシュに当たる変更ファイルが差分に無い/)).toBeInTheDocument();
  });

  it('本文が空なら「PR 本文なし」', async () => {
    const a = fixtureAnalysis();
    a.pr.body = '';
    a.claims = [];
    await renderExplain(fakeApi(a).api);
    await screen.findByText('PR 本文なし');
  });

  it('LLM が動かなかった解析では、入口の題の下に理由と採り直し方がですます調で出て、ボタンで設定が開く', async () => {
    const a = fixtureAnalysis();
    a.llm = { command: 'claude -p', status: 'failed', reason: '終了コード 1' };
    a.hows = [];
    a.summary = {};
    delete a.llmText;
    render(<App api={fakeApi(a).api} />);
    await ready();
    expect(screen.getByRole('status').textContent).toContain('LLM で目的ごとに分けられませんでした。理由: 終了コード 1');
    expect(screen.getByText(/でやり直せます/)).toBeInTheDocument();
    // コースが無いので、開始ボタンはコース外から
    expect(screen.getByRole('button', { name: /コース外から始める/ })).toBeInTheDocument();
    // 説明タブでも同じ場所に出る
    await act(async () => {
      fireEvent.keyDown(window, { key: '2' });
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    await press('LLM コマンドを設定する');
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    expect(screen.getByLabelText('LLM コマンド（解析と案内人に聞く）')).toBeInTheDocument();
  });
});

// 地図が層なし・辺なしのとき、なぜかを入口で言う（構成の推定 10.6 / 言語サーバー 9.5）
describe('App（地図の知らせ。層と関連の線）', () => {
  const entry = async (a: ReturnType<typeof fixtureAnalysis>) => {
    render(<App api={fakeApi(a).api} />);
    await ready();
  };

  it('層を推定できなかった解析では、理由と採り直し方を出す', async () => {
    const a = fixtureAnalysis();
    a.config.layers = [];
    a.structure = { status: 'failed', command: 'claude -p', reason: '時間切れ（3 KB 受信）' };
    await entry(a);
    expect(screen.getByText(/層を推定できませんでした。理由: 時間切れ（3 KB 受信）/)).toBeInTheDocument();
    expect(screen.getByText(/層を推定できませんでした/).closest('[role="status"]')?.textContent).toContain('ondina analyze');
  });

  it('--no-llm で推定していなければ、そう言う', async () => {
    const a = fixtureAnalysis();
    a.config.layers = [];
    a.structure = { status: 'skipped', reason: '--no-llm' };
    await entry(a);
    expect(screen.getByText(/層を推定していません（--no-llm）/)).toBeInTheDocument();
  });

  it('推定の後に分類できないファイルが閾値以上増えたら、件数と推定し直し方を出す', async () => {
    const a = fixtureAnalysis();
    a.config.layers = [];
    a.structure = { status: 'ok', inferred: { headSha: 'c'.repeat(40), at: '2026-10-09T03:00:00.000Z' }, layers: ['Web'], unclassified: { count: 12, total: 200, warn: true, paths: [] } };
    await entry(a);
    const line = screen.getByText(/構成に分類できないファイルが 12 件増えました/);
    expect(line.textContent).toContain('2026-10-09 の推定以降');
    expect(line.closest('[role="status"]')?.textContent).toContain('ondina structure');
  });

  it('閾値に届かなければ何も出さない', async () => {
    const a = fixtureAnalysis();
    a.config.layers = [];
    a.structure = { status: 'ok', inferred: { headSha: 'c'.repeat(40), at: '2026-10-09T03:00:00.000Z' }, layers: ['Web'], unclassified: { count: 3, total: 200, warn: false, paths: [] } };
    await entry(a);
    expect(screen.queryByText(/分類できないファイル/)).toBeNull();
  });

  it('言語サーバーが使えなかった解析では、関連の線が無いことと理由を出す（期限切れの文もそのまま）', async () => {
    const a = fixtureAnalysis();
    a.lsp = { command: 'intellij-server', status: 'unavailable', reason: 'LSP が起動してすぐ終了しました: This build of kotlin-server has expired.' };
    await entry(a);
    expect(screen.getByText(/関連の線がありません。言語サーバーが使えませんでした: LSP が起動してすぐ終了しました: This build of kotlin-server has expired\./)).toBeInTheDocument();
    // 期限切れなら、入れ替え方（ondina update が kotlin-lsp も最新にする）を出す
    expect(screen.getByText(/kotlin-lsp の期限切れです。/).textContent).toBe('kotlin-lsp の期限切れです。ondina update で新しいバージョンに入れ替えてから ondina analyze でやり直せます');
  });

  it('言語サーバーを使わずに解析していれば（--no-lsp か古い解析）、関連の線が無いわけと打ち直し方を出す', async () => {
    const a = fixtureAnalysis();
    delete a.lsp;
    await entry(a);
    expect(screen.getByText(/言語サーバーを使わずに解析したので、関連の線がありません/)).toBeInTheDocument();
  });

  it('層も言語サーバーも揃った解析では知らせを出さない', async () => {
    await entry(fixtureAnalysis());
    expect(screen.queryByText(/関連の線がありません|層を推定/)).toBeNull();
  });

  it('地図の中の「LSP を動かした解析でだけ出る」という間違った案内は出さない', async () => {
    const a = fixtureAnalysis();
    a.symbols = [];
    a.edges = [];
    // 前の形の地図（まとまりの無い古い解析）の空の知らせ。新しい地図は hunk から箱を作るので空にならない
    delete a.mapGroups;
    await entry(a);
    expect(screen.queryByText(/LSP を動かした解析でだけ出る/)).toBeNull();
    expect(screen.getByText('地図に載せる変更がありません')).toBeInTheDocument();
  });
});

describe('App（2 回目の LLM が動かなかった知らせ。3.1）', () => {
  it('1 回目が ok で 2 回目が失敗した解析では、入口の題の下に「案内文を書けませんでした」と理由が出て、ボタンで設定が開く。コースは自動の文で回れる', async () => {
    const a = fixtureAnalysis({ text: false });
    a.llmText = { command: 'claude -p', status: 'failed', reason: '時間切れ（12 KB 受信）' };
    const { container } = render(<App api={fakeApi(a).api} />);
    await ready();
    expect(screen.getByRole('status').textContent).toContain('LLM で案内文を書けませんでした。理由: 時間切れ（12 KB 受信）');
    expect(screen.getByRole('status').textContent).not.toContain('目的ごとに分けられませんでした');
    expect(screen.getByText(/でやり直せます/)).toBeInTheDocument();
    await press('LLM コマンドを設定する');
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    expect(container.querySelectorAll('.ccard')).toHaveLength(8);
  });

  it('2 回目が ok か、欄が無い（古い解析）なら知らせない', async () => {
    render(<App api={fakeApi(fixtureAnalysis()).api} />);
    await ready();
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();
    render(<App api={fakeApi(fixtureAnalysis({ text: false })).api} />);
    await ready();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('App（入口と上の帯。3.0 / 3.1）', () => {
  it('左の列は無く、上の帯に 目的ごと / 差分一覧（キー D）/ 締め / 設定 がある。「GitHubで承認」は締めの中へ移した。完了メーターは上の帯のまま', async () => {
    const { container } = render(<App api={fakeApi(fixtureAnalysis(), { key: '42', prUrl: 'https://github.com/o/r/pull/42' }).api} />);
    await ready();
    expect(container.querySelector('.rail')).toBeNull();
    for (const name of ['目的ごと', '差分一覧 D', '締め', '設定']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /承認/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /承認/ })).toBeNull();
    // 入口でも全体図を出す（他の画面と行き先の並びを揃える。2026-10-28）
    expect(screen.getByRole('button', { name: '全体図' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('完了メーター').textContent).toContain('帰属 45/48');
  });

  it('入口: 題・件数・コースの並び（7 本 + コース外）。カードを押すと選ばれ、「入る」でコースに入る。全体図で戻る', async () => {
    const { container } = render(<App api={fakeApi().api} />);
    await ready();
    expect(screen.getByText('差分 48 · コース 7 · 外 3')).toBeInTheDocument();
    expect(container.querySelectorAll('.ccard')).toHaveLength(8);
    await act(async () => {
      fireEvent.click(container.querySelectorAll('.ccard .pick')[3]!);
    });
    expect(container.querySelector('.ccard.sel')).toBe(container.querySelectorAll('.ccard')[3]);
    expect(screen.getByRole('button', { name: /コース 4 に入る/ })).toBeInTheDocument();
    await press('入る');
    expect(screen.getByText('コース 4 · 読む前の案内')).toBeInTheDocument();
    await press('全体図Esc');
    await ready();
  });

  it('コースのカードはキーボードで選べる（原則 6）。カードの上の Enter は選ぶだけで、コースには入らない', async () => {
    const { container } = render(<App api={fakeApi().api} />);
    await ready();
    const pick = container.querySelectorAll<HTMLButtonElement>('.ccard .pick')[4]!;
    expect(pick.tagName).toBe('BUTTON');
    pick.focus();
    expect(document.activeElement).toBe(pick);
    await act(async () => {
      fireEvent.keyDown(pick, { key: 'Enter' });
      fireEvent.click(pick); // ブラウザはボタンの上の Enter / Space を click にする
    });
    expect(container.querySelector('.ccard.sel')).toBe(container.querySelectorAll('.ccard')[4]);
    expect(pick.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.stop')).toBeNull();
    await act(async () => {
      fireEvent.keyDown(pick, { key: ' ' });
      fireEvent.click(pick);
    });
    expect(container.querySelector('.ccard.sel')).toBeNull();
  });

  it('目的ごとの画面へ行き、コースから来ていれば「コース n に戻る」で戻れる', async () => {
    const { container } = render(<App api={fakeApi().api} />);
    await ready();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    await screen.findByText('コース 1 · 読む前の案内');
    await press('目的ごと');
    await screen.findByText('依存順 · クリックで絞り込み');
    await press('コース 1 に戻る');
    expect(screen.getByText('コース 1 · 読む前の案内')).toBeInTheDocument();
    expect(container.querySelector('.home')).toBeNull();
  });

  it('設定は歯車で開き、テーマを押すとすぐ変わり、Esc で閉じる', async () => {
    const fake = fakeApi();
    render(<App api={fake.api} />);
    await ready();
    await press('設定');
    await press('ダーク');
    expect(document.documentElement.dataset['flavor']).toBe('mocha');
    await waitFor(() => expect(fake.ui.theme).toEqual({ mode: 'dark', light: 'latte', dark: 'mocha', accent: 'mauve' }));
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog', { name: '設定' })).toBeNull();
  });

  it('解析が一つも無くても、設定のテーマ・アクセントはすぐ変わり ui.json に保存される', async () => {
    const fake = fakeApi(fixtureAnalysis(), { noAnalyses: true });
    render(<App api={fake.api} />);
    await screen.findByText('開いている PR はありません。');
    await press('設定');
    await press('ダーク');
    fireEvent.change(screen.getByLabelText('ダークのテーマ'), { target: { value: 'frappe' } });
    expect(document.documentElement.dataset['flavor']).toBe('frappe');
    expect(screen.getByRole('button', { name: 'ダーク' }).classList.contains('on')).toBe(true);
    await press('ライト');
    expect(document.documentElement.dataset['flavor']).toBe('latte');
    fireEvent.change(screen.getByLabelText('アクセント'), { target: { value: 'peach' } });
    expect(document.documentElement.dataset['accent']).toBe('peach');
    await waitFor(() => expect(fake.ui.theme).toEqual({ mode: 'light', light: 'latte', dark: 'frappe', accent: 'peach' }));
  });

  it('「システムに合わせる」なら OS の外観が変わると読み直さずに一緒に変わり、ライト・ダークに決めれば OS に付いていかない', async () => {
    const fake = fakeApi(fixtureAnalysis(), { noAnalyses: true, ui: { theme: { mode: 'system', light: 'latte', dark: 'macchiato', accent: 'mauve' } } });
    render(<App api={fake.api} />);
    await screen.findByText('開いている PR はありません。');
    await waitFor(() => expect(document.documentElement.dataset['flavor']).toBe('latte'));
    act(() => setOsDark(true));
    expect(document.documentElement.dataset['flavor']).toBe('macchiato');
    act(() => setOsDark(false));
    expect(document.documentElement.dataset['flavor']).toBe('latte');
    await press('設定');
    await press('ライト');
    act(() => setOsDark(true));
    expect(document.documentElement.dataset['flavor']).toBe('latte');
  });

  it('解析が無くても ondina.config.yaml の theme で描き、ui.json の theme があればそちらを使う', async () => {
    const config = { theme: { mode: 'dark' as const, light: 'latte', dark: 'frappe', accent: 'blue' }, ide: { scheme: 'jetbrains' as const, product: 'idea' } };
    render(<App api={fakeApi(fixtureAnalysis(), { noAnalyses: true, config }).api} />);
    await screen.findByText('開いている PR はありません。');
    await waitFor(() => expect(document.documentElement.dataset['flavor']).toBe('frappe'));
    expect(document.documentElement.dataset['accent']).toBe('blue');
    cleanup();
    render(<App api={fakeApi(fixtureAnalysis(), { config, ui: { theme: { mode: 'light', light: 'latte', dark: 'mocha', accent: 'teal' } } }).api} />);
    await ready();
    // テーマは描いた後の effect で付く。「入口」が出た直後はまだ前の値のことがある（CI で落ちた）
    await waitFor(() => expect(document.documentElement.dataset['flavor']).toBe('latte'));
    expect(document.documentElement.dataset['accent']).toBe('teal');
  });
});

describe('App（ショートカットキー。18.2）', () => {
  const key = async (k: string, mods: { metaKey?: boolean } = {}) => {
    await act(async () => {
      fireEvent.keyDown(window, { key: k, ...mods });
    });
  };
  /** ? の一覧の行（説明の文で探す）の中のキーの表示 */
  const helpKeys = (help: string) => [...screen.getByText(help).closest('.krow')!.querySelectorAll('kbd')].map((k) => k.textContent);

  it('ui.json で変えたキーで動き、元のキーでは動かない。上の帯のキーの表示も変わる', async () => {
    const { container } = render(<App api={fakeApi(fixtureAnalysis(), { ui: { keymap: { 'view.diff': ['x'] } } }).api} />);
    await ready();
    expect(screen.getByRole('button', { name: '差分一覧 X' })).toBeInTheDocument();
    await key('d');
    expect(container.querySelector('.vd')).toBeNull();
    await key('x');
    expect(container.querySelector('.vd')).not.toBeNull();
  });

  it('キーを外した操作は画面のキーの表示を消し、⌘K のボタンは名前になる', async () => {
    render(<App api={fakeApi(fixtureAnalysis(), { ui: { keymap: { 'view.diff': [], 'palette.open': [] } } }).api} />);
    await ready();
    expect(screen.getByRole('button', { name: '差分一覧' }).querySelector('kbd')).toBeNull();
    expect(screen.getByRole('button', { name: 'コマンドパレット' }).textContent).toBe('パレット');
    await key('k', { metaKey: true });
    expect(screen.queryByLabelText('探す')).toBeNull();
  });

  it('? の一覧は見るだけで、見出しごとに今のキーを出す（変えたキー・2 つ続け・⌘ 付き・キーなし）', async () => {
    render(<App api={fakeApi(fixtureAnalysis(), { ui: { keymap: { 'view.diff': ['x'], 'course.fold': [] } } }).api} />);
    await ready();
    await key('?');
    const dialog = screen.getByRole('dialog', { name: 'ショートカットキー' });
    expect([...dialog.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['どの画面でも', 'コース', '入口', '変えられないキー']);
    expect(helpKeys('差分一覧へ')).toEqual(['X']);
    expect(helpKeys('次の hunk（コースでは次の停留所。差分のない相手の引き出しでは次の相手）')).toEqual(['J', '↓']);
    expect(helpKeys('IDEA で開く')).toEqual(['G → I']);
    expect(helpKeys('コマンドパレット')).toEqual(['⌘K']);
    expect(helpKeys('右の水先案内をたたむ / 出す')).toEqual([]);
    expect(screen.getByText('右の水先案内をたたむ / 出す').closest('.krow')!.textContent).toContain('なし');
    expect(within(dialog).queryAllByRole('button').map((b) => b.textContent)).toEqual(['閉じる Esc', '設定で変える']);
  });

  it('コースの中のキーの表示も変えたキーになる', async () => {
    const { container } = render(<App api={fakeApi(fixtureAnalysis(), { ui: { keymap: { 'course.fold': ['z'], 'course.map': ['n'], 'course.prev': ['p'] } } }).api} />);
    await ready();
    // コース 3（停留所 4 つ）の 2 つ目の停留所へ
    fireEvent.click(container.querySelectorAll('.ccard .pick')[2]!);
    fireEvent.click(container.querySelector('.ccard.sel .go')!);
    // 読む前の案内（2026-10-22）から 1 か所目へ
    fireEvent.click(container.querySelector('.brief .bgo .btn')!);
    await key('ArrowRight');
    expect(screen.getByRole('button', { name: 'たたむ » Z' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '地図 N' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前へ P' })).toBeInTheDocument();
    await key('z');
    expect(container.querySelector('.stop.shut')).not.toBeNull();
    expect(screen.getByRole('button', { name: '案内を出す' }).getAttribute('title')).toBe('案内を出す（Z）');
  });

  /** ⚙ → ショートカットキーのタブ */
  async function openKeys(fake = fakeApi()) {
    const r = render(<App api={fake.api} />);
    await ready();
    await press('設定');
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'ショートカットキー' }));
    });
    return { ...r, fake };
  }
  /** 設定のタブの 1 行（操作の名前で探す） */
  const row = (label: string) => screen.getByRole('group', { name: label });
  const click = async (el: HTMLElement) => {
    await act(async () => {
      fireEvent.click(el);
    });
  };
  /** 記録している欄（押すとすぐ欄に移る）でキーを押す */
  const record = async (k: string, mods: { metaKey?: boolean } = {}) => {
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: k, ...mods });
    });
  };
  /** マウスで押す。押した時点でフォーカスが今の所から離れる（ブラウザの既定。Safari ではボタンにも移らない。mousedown を止めれば離れない） */
  const mouseClick = async (el: HTMLElement) => {
    await act(async () => {
      if (fireEvent.mouseDown(el)) (document.activeElement as HTMLElement).blur();
    });
    await act(async () => {
      fireEvent.mouseUp(el);
      fireEvent.click(el);
    });
  };
  /** Tab を押す。止められなければフォーカスが今の所から離れる（ブラウザの既定。jsdom は動かさないので離れたことにする） */
  const tab = async (mods: { shiftKey?: boolean } = {}) => {
    await act(async () => {
      if (fireEvent.keyDown(document.activeElement!, { key: 'Tab', ...mods })) (document.activeElement as HTMLElement).blur();
    });
  };

  it('設定のショートカットキーのタブで、欄を押して新しいキーを押すと変わる。すぐ効き、画面の表示も変わり、ui.json に入る', async () => {
    const { container, fake } = await openKeys();
    expect(screen.getByRole('tab', { name: 'ショートカットキー' }).getAttribute('aria-selected')).toBe('true');
    await click(within(row('差分一覧へ')).getByRole('button', { name: 'D' }));
    expect(within(row('差分一覧へ')).getByRole('button', { name: 'キーを押す…' })).toHaveFocus();
    await record('Shift');
    await record('x');
    await waitFor(() => expect(fake.ui.keymap).toEqual({ 'view.diff': ['x'] }));
    expect(within(row('差分一覧へ')).getByRole('button', { name: 'X' })).toBeInTheDocument();
    expect(within(row('差分一覧へ')).getByRole('button', { name: '既定に戻す' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '差分一覧 X' })).toBeInTheDocument();
    expect(screen.getByText('.ondina/ui.json に保存します。どの PR でも同じキーです。押した時点で効きます。')).toBeInTheDocument();
    await key('Escape');
    expect(screen.queryByRole('dialog', { name: '設定' })).toBeNull();
    await key('d');
    expect(container.querySelector('.vd')).toBeNull();
    await key('x');
    expect(container.querySelector('.vd')).not.toBeNull();
  });

  it('記録中のキーは画面の操作に届かず、同じキーが別の操作にあれば知らせる。入れ替える', async () => {
    const { fake } = await openKeys();
    await click(within(row('差分一覧へ')).getByRole('button', { name: 'D' }));
    await record('?');
    expect(screen.queryByRole('dialog', { name: 'ショートカットキー' })).toBeNull();
    expect(row('差分一覧へ').nextElementSibling!.textContent).toContain('? は「キーの一覧を開く / 閉じる」で使っています。');
    await click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.queryByText(/で使っています/)).toBeNull();
    expect(fake.ui.keymap).toBeUndefined();

    await click(within(row('差分一覧へ')).getByRole('button', { name: 'D' }));
    await record('j');
    expect(screen.getByText(/は「次の場所」で使っています。/)).toBeInTheDocument();
    await click(screen.getByRole('button', { name: '入れ替える' }));
    await waitFor(() => expect(fake.ui.keymap).toEqual({ 'view.diff': ['j'], 'hunk.next': ['d', 'ArrowDown'] }));
    expect(within(row('次の場所')).getAllByRole('button').map((b) => b.textContent)).toEqual(['D', '↓', '＋', '既定に戻す']);
  });

  it('こちらに移すと、別の操作からそのキーを外す。＋ で足した欄でも同じ', async () => {
    const { fake } = await openKeys();
    await click(within(row('差分一覧へ')).getByRole('button', { name: 'キーを足す' }));
    await record('m');
    expect(screen.getByText(/は「地図を出す \/ しまう」で使っています。/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '入れ替える' })).toBeNull();
    expect(screen.getByRole('button', { name: 'こちらに移す' })).toHaveFocus();
    await click(screen.getByRole('button', { name: 'こちらに移す' }));
    await waitFor(() => expect(fake.ui.keymap).toEqual({ 'view.diff': ['d', 'm'], 'course.map': [] }));
    expect(row('地図を出す / しまう').textContent).toContain('なし');
  });

  it('記録中は「外す」「やめる」。外す・既定に戻す・すべて既定に戻す', async () => {
    const { fake } = await openKeys(fakeApi(fixtureAnalysis(), { ui: { keymap: { 'view.diff': ['x'], 'course.fold': ['z'] } } }));
    expect(screen.getAllByTitle('既定から変えています')).toHaveLength(2);
    await click(within(row('次の場所')).getByRole('button', { name: '↓' }));
    expect(within(row('次の場所')).getAllByRole('button').map((b) => b.textContent)).toEqual(['J', 'キーを押す…', '＋', '外す', 'やめる']);
    await mouseClick(within(row('次の場所')).getByRole('button', { name: '外す' }));
    await waitFor(() => expect(fake.ui.keymap).toEqual({ 'view.diff': ['x'], 'course.fold': ['z'], 'hunk.next': ['j'] }));
    await click(within(row('差分一覧へ')).getByRole('button', { name: '既定に戻す' }));
    await waitFor(() => expect(fake.ui.keymap).toEqual({ 'course.fold': ['z'], 'hunk.next': ['j'] }));
    await click(screen.getByRole('button', { name: 'すべて既定に戻す' }));
    await waitFor(() => expect(fake.ui.keymap).toBeUndefined());
    expect(screen.queryByRole('button', { name: 'すべて既定に戻す' })).toBeNull();
    expect(screen.queryByTitle('既定から変えています')).toBeNull();
  });

  it('記録中の欄の外を押すと記録をやめる。そのあとのキーでキーは変わらず、後ろの画面にも届かない', async () => {
    const { container, fake } = await openKeys();
    await click(within(row('差分一覧へ')).getByRole('button', { name: 'D' }));
    await mouseClick(screen.getByRole('heading', { name: '設定' }));
    expect(screen.queryByRole('button', { name: 'キーを押す…' })).toBeNull();
    expect(within(row('差分一覧へ')).getByRole('button', { name: 'D' })).toBeInTheDocument();
    await record('d');
    expect(container.querySelector('.vd')).toBeNull();
    expect(fake.ui.keymap).toBeUndefined();
  });

  it('記録中の Tab / Shift+Tab はキーにせず、フォーカスが次へ移って記録をやめる。キーは変わらない', async () => {
    const { fake } = await openKeys();
    for (const mods of [{}, { shiftKey: true }]) {
      await click(within(row('差分一覧へ')).getByRole('button', { name: 'D' }));
      await tab(mods);
      expect(screen.queryByRole('button', { name: 'キーを押す…' })).toBeNull();
      expect(within(row('差分一覧へ')).getAllByRole('button').map((b) => b.textContent)).toEqual(['D', '＋']);
    }
    expect(fake.ui.keymap).toBeUndefined();
  });

  it('重なりの知らせが出ると最初のボタンにフォーカスが移る。知らせの中のキーは画面の操作に届かず、Esc は知らせだけ閉じる', async () => {
    const { fake } = await openKeys();
    await click(within(row('差分一覧へ')).getByRole('button', { name: 'D' }));
    await record('j');
    expect(screen.getByRole('button', { name: '入れ替える' })).toHaveFocus();
    // Enter がうしろの入口に届くと、次のコースに入ってしまう
    await record('Enter');
    expect(screen.getByLabelText('入口')).toBeInTheDocument();
    await record('Escape');
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    expect(screen.queryByText(/で使っています/)).toBeNull();
    expect(fake.ui.keymap).toBeUndefined();
  });

  it('Enter / Esc は変えられない。押すと知らせる。記録中の Esc は記録をやめるだけ', async () => {
    const { fake } = await openKeys();
    expect(within(row('決める・次へ')).queryAllByRole('button')).toHaveLength(0);
    expect(within(row('閉じる')).queryAllByRole('button')).toHaveLength(0);
    await click(within(row('差分一覧へ')).getByRole('button', { name: 'D' }));
    await record('Escape');
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    expect(within(row('差分一覧へ')).getByRole('button', { name: 'D' })).toBeInTheDocument();
    await click(within(row('差分一覧へ')).getByRole('button', { name: 'D' }));
    await record('Enter');
    expect(row('差分一覧へ').nextElementSibling!.textContent).toContain('Enter は「決める・次へ」で使っています。変えられないキーなので、ほかのキーを選んでください。');
    expect(screen.queryByRole('button', { name: 'こちらに移す' })).toBeNull();
    expect(screen.getByRole('button', { name: 'わかりました' })).toHaveFocus();
    await click(screen.getByRole('button', { name: 'わかりました' }));
    expect(screen.queryByText(/変えられないキーなので/)).toBeNull();
    expect(fake.ui.keymap).toBeUndefined();
  });

  it('IDEA で開く は 2 つ続けて押して決める。⌘ 付きも記録できる', async () => {
    const { fake } = await openKeys();
    await click(within(row('IDEA で開く')).getByRole('button', { name: 'G → I' }));
    await record('g');
    expect(within(row('IDEA で開く')).getByRole('button', { name: 'G → …' })).toHaveFocus();
    await record('o');
    await waitFor(() => expect(fake.ui.keymap).toEqual({ 'jump.ide': ['g o'] }));
    await click(within(row('コマンドパレット')).getByRole('button', { name: '⌘K' }));
    await record('Meta', { metaKey: true });
    await record('p', { metaKey: true });
    await waitFor(() => expect(fake.ui.keymap).toEqual({ 'jump.ide': ['g o'], 'palette.open': ['Mod+p'] }));
    expect(screen.getByRole('button', { name: 'コマンドパレット' }).textContent).toBe('⌘P');
  });

  it('? の一覧の「設定で変える」で、設定のショートカットキーのタブが開く', async () => {
    render(<App api={fakeApi().api} />);
    await ready();
    await key('?');
    await press('設定で変える');
    expect(screen.queryByRole('dialog', { name: 'ショートカットキー' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'ショートカットキー' }).getAttribute('aria-selected')).toBe('true');
    expect(row('差分一覧へ')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: '全般' }));
    });
    expect(screen.getByLabelText('LLM コマンド（解析と案内人に聞く）')).toBeInTheDocument();
  });

  /** 重なった画面（ダイアログの名前）と開き方 */
  const overlays: Array<[string, () => Promise<void>]> = [
    ['設定', () => press('設定')],
    ['ショートカットキー', () => key('?')],
    ['コマンドパレット', () => key('k', { metaKey: true })],
  ];

  it('設定・? の一覧・パレットを開いている間は、D と Enter が後ろの入口に効かない', async () => {
    const { container } = render(<App api={fakeApi().api} />);
    await ready();
    for (const [name, open] of overlays) {
      await open();
      await key('d');
      await key('Enter');
      expect(screen.getByRole('dialog', { name })).toBeInTheDocument();
      expect(container.querySelector('.view.home')).not.toBeNull();
      await key('Escape');
    }
  });

  it('設定・? の一覧・パレットを開いている間は、V が後ろの差分に見た印を付けない。閉じれば付く', async () => {
    const { container } = await renderDiffList(fakeApi().api);
    await waitFor(() => expect(container.querySelectorAll('.file').length).toBeGreaterThan(0));
    for (const [name, open] of overlays) {
      await open();
      await key('v');
      expect(screen.getByRole('dialog', { name })).toBeInTheDocument();
      await key('Escape');
    }
    expect(screen.queryAllByRole('button', { name: '問題なし ✓' })).toHaveLength(0);
    await key('v');
    expect(screen.queryAllByRole('button', { name: '問題なし ✓' })).toHaveLength(1);
  });

  it('重なった画面の上でも Esc・?・⌘K は効く（閉じる・ほかの重なった画面に替える）', async () => {
    render(<App api={fakeApi().api} />);
    await ready();
    await press('設定');
    await key('?');
    expect(screen.queryByRole('dialog', { name: '設定' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'ショートカットキー' })).toBeInTheDocument();
    await key('k', { metaKey: true });
    expect(screen.getByRole('dialog', { name: 'コマンドパレット' })).toBeInTheDocument();
    await key('Escape');
    await key('?');
    await key('?');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('App（How 分解の画面。3.2）', () => {
  async function renderHow(api = fakeApi().api) {
    const r = render(<App api={api} />);
    await ready();
    await press('目的ごと');
    await screen.findByText('依存順 · クリックで絞り込み');
    return r;
  }

  it('How カード 7 枚、未帰属 3 のヘッダ、赤背景の行 3 つ、束の行', async () => {
    const { container } = await renderHow();
    expect(container.querySelectorAll('.how')).toHaveLength(7);
    expect(screen.getByText('未帰属 3')).toBeInTheDocument();
    expect(container.querySelectorAll('.row.bad')).toHaveLength(3);
    expect(screen.getByText('48 hunk')).toBeInTheDocument();
    const grp = container.querySelector('.row.grp-row')!;
    expect(grp.textContent).toContain('22 ファイル');
    expect(grp.textContent).toContain('追従 23 件');
    expect(grp.textContent).toContain('getDiscount() → discount · 一様（AST 判定） · 差異あり 1 · わずかな差異 0');
    expect(grp.textContent).toContain('見た 0/23');
    // 束の 23 件は行にならない
    expect(container.querySelectorAll('.row')).toHaveLength(26);
  });

  it('How 3 のカードで絞り込むと属さない行が沈み、もう一度で戻る。ヘッダは How 3 · 26 / 48 hunk', async () => {
    const { container } = await renderHow();
    const card = container.querySelectorAll('.how')[2]!;
    fireEvent.click(card);
    await waitFor(() => expect(container.querySelectorAll('.row.dim')).toHaveLength(22));
    expect(card.classList.contains('on')).toBe(true);
    expect(screen.getByText('How 3 · 26 / 48 hunk')).toBeInTheDocument();
    fireEvent.click(card);
    await waitFor(() => expect(container.querySelectorAll('.row.dim')).toHaveLength(0));
  });

  it('束の行をクリックすると展開して 23 行が並び、代表が選ばれてプレビューに注記。メンバーの「見た」はそのメンバーだけに付く', async () => {
    const fake = fakeApi();
    const analysis = fixtureAnalysis();
    const { container } = await renderHow(fake.api);
    fireEvent.click(container.querySelector('.row.grp-row')!);
    await waitFor(() => expect(container.querySelectorAll('.row.mem')).toHaveLength(23));
    const members = container.querySelectorAll('.row.mem');
    expect(members[0]!.textContent).toContain('サンプル');
    expect(members[1]!.textContent).toContain('差異あり');
    expect(screen.getByText(/同じ書き換え 22 件のサンプル/)).toBeInTheDocument();
    const rep = analysis.hunks.find((h) => h.symbol === 'discountField()')!;
    expect(container.querySelector(`.dpane #hunk-${rep.id}, .preview #hunk-${rep.id}`)).not.toBeNull();
    // 3 番目（最初のメンバー）の「見た」
    fireEvent.click(members[2]!.querySelector('.eye')!);
    const member = analysis.hunks.find((h) => h.path.includes('analytics/OrderMetrics.kt'))!;
    await waitFor(() => expect(fake.states.get(`local/${analysis.pr.headSha}`)?.viewed).toEqual([member.id]));
    expect(screen.getByText('見た 1/23')).toBeInTheDocument();
    // もう一度クリックで畳む
    fireEvent.click(container.querySelector('.row.grp-row')!);
    await waitFor(() => expect(container.querySelectorAll('.row.mem')).toHaveLength(0));
  });

  it('未帰属の行を選ぶとプレビューに「どの How にも属さない」の説明が出る', async () => {
    const { container } = await renderHow();
    fireEvent.click(container.querySelector('.row.bad')!);
    await screen.findByText(/どの How にも入らない差分です/);
  });

  it('hunk を選ぶと属する How のカードが光る', async () => {
    const { container } = await renderHow();
    fireEvent.click(container.querySelector('.row')!);
    await waitFor(() => expect(container.querySelector('.how.lit')).not.toBeNull());
    expect(container.querySelector('.how.lit')!.textContent).toContain('orders テーブルに discount 列を足す');
  });

  it('プレビューは選んだ差分のファイルを出す（同じファイルの差分の見出しも）。差分から離れた行は帯で、F（すべて表示）で全部。同じファイルの別の差分に選び替えてもファイルはそのまま', async () => {
    const analysis = fixtureAnalysis();
    const [save, find] = analysis.hunks.filter((h) => h.path.endsWith('/order/infra/OrderRepositoryImpl.kt'));
    const { container } = await renderHow(fakeApi(analysis).api);
    fireEvent.click(container.querySelector(`.row[data-hunk="${find!.id}"]`)!);
    await waitFor(() => expect(container.querySelector(`.preview #hunk-${find!.id}`)?.classList.contains('on')).toBe(true));
    expect(container.querySelector(`.preview #hunk-${save!.id}`)).not.toBeNull();
    expect(container.querySelector('.preview')!.textContent).not.toContain('package com.example.order.infra');
    expect(container.querySelector('.preview .fold')).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'f' });
    });
    await waitFor(() => expect(container.querySelector('.preview')!.textContent).toContain('package com.example.order.infra'));
    expect(screen.getByRole('button', { name: '変更の近くだけ F' })).toBeInTheDocument();
    fireEvent.click(container.querySelector(`.row[data-hunk="${save!.id}"]`)!);
    await waitFor(() => expect(container.querySelector(`.preview #hunk-${save!.id}`)?.classList.contains('on')).toBe(true));
    expect(container.querySelector(`.preview #hunk-${find!.id}`)).not.toBeNull();
    expect(container.querySelector('.preview .prev-hd')!.textContent).toContain('save()');
  });

  it('全文の無い古い解析では、そのファイルの差分を全部出し「ファイル全体は解析に無い」と書く', async () => {
    const analysis = fixtureAnalysis();
    delete analysis.files;
    const [save, find] = analysis.hunks.filter((h) => h.path.endsWith('/order/infra/OrderRepositoryImpl.kt'));
    const { container } = await renderHow(fakeApi(analysis).api);
    fireEvent.click(container.querySelector(`.row[data-hunk="${find!.id}"]`)!);
    await screen.findByText('ファイル全体は解析にありません（analyze を実行し直すと表示されます）');
    expect(container.querySelector(`.preview #hunk-${save!.id}`)).not.toBeNull();
    expect(container.querySelector('.preview')!.textContent).not.toContain('package com.example.order.infra');
  });

  it('プレビューの既定は左右（2026-10-11）。u / s はプレビューの表示に効き、diffMode.b に保存される', async () => {
    const fake = fakeApi();
    const { container } = await renderHow(fake.api);
    fireEvent.click(container.querySelector('.row')!);
    await waitFor(() => expect(container.querySelector('.preview .diff.sbs')).not.toBeNull());
    expect(container.querySelector('.preview .diff.uni')).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'u' });
    });
    await waitFor(() => expect(container.querySelector('.preview .diff.uni')).not.toBeNull());
    expect(fake.ui.diffMode).toEqual({ b: 'uni' });
    await act(async () => {
      fireEvent.keyDown(window, { key: 's' });
    });
    await waitFor(() => expect(container.querySelector('.preview .diff.uni')).toBeNull());
    expect(fake.ui.diffMode).toEqual({ b: 'sbs' });
  });
});

describe('App（コマンドパレット。18.2）', () => {
  async function openPalette(api = fakeApi().api) {
    const r = render(<App api={api} />);
    await ready();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    await screen.findByLabelText('探す');
    return r;
  }

  it('⌘K で開き、打った文字で絞り込み、Enter で How 分解の画面へ飛ぶ', async () => {
    const { container } = await openPalette();
    const input = screen.getByLabelText('探す');
    fireEvent.change(input, { target: { value: 'テーブル' } });
    await waitFor(() => expect(container.querySelector('.palette li.on')).not.toBeNull());
    expect(container.querySelector('.palette li.on')!.textContent).toContain('orders テーブルに discount 列を足す');
    // 当たった文字に下線が引かれる
    expect(container.querySelector('.palette li.on u.hit')).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await screen.findByText('依存順 · クリックで絞り込み');
    expect(container.querySelector('.palette')).toBeNull();
  });

  it('クリックで選ぶと差分一覧の画面でそのファイルが開く', async () => {
    const { container } = await openPalette();
    fireEvent.change(screen.getByLabelText('探す'), { target: { value: 'V421' } });
    await waitFor(() => expect(container.querySelectorAll('.palette li').length).toBeGreaterThan(0));
    await act(async () => {
      fireEvent.click(container.querySelector('.palette li')!);
    });
    await waitFor(() => expect(container.querySelector('.vd')).not.toBeNull());
    expect(container.querySelector('.palette')).toBeNull();
    expect(container.querySelector('.file.on')?.textContent ?? '').toContain('V421__discount.sql');
  });

  it('該当が無ければ「該当なし」、Esc で閉じる', async () => {
    const { container } = await openPalette();
    const input = screen.getByLabelText('探す');
    fireEvent.change(input, { target: { value: 'zzzqqq' } });
    await screen.findByText('該当なし');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    await waitFor(() => expect(container.querySelector('.palette')).toBeNull());
  });

  it('日本語の変換を確定する Enter と変換をやめる Esc では、選ばず閉じない。変換していない Enter で選ぶ', async () => {
    const { container } = await openPalette();
    const input = screen.getByLabelText('探す');
    fireEvent.change(input, { target: { value: 'テーブル' } });
    await waitFor(() => expect(container.querySelector('.palette li.on')).not.toBeNull());
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
      fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    });
    expect(container.querySelector('.palette')).not.toBeNull();
    expect(input).toHaveValue('テーブル');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    await screen.findByText('依存順 · クリックで絞り込み');
    expect(container.querySelector('.palette')).toBeNull();
  });

  it('キーマップ表示中に ⌘K を押すと重ならず、Esc は escape 経由で閉じる', async () => {
    const { container } = render(<App api={fakeApi().api} />);
    await ready();
    await act(async () => {
      fireEvent.keyDown(window, { key: '?' });
    });
    await screen.findByRole('dialog', { name: 'ショートカットキー' });
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', metaKey: true });
    });
    expect(screen.queryByRole('dialog', { name: 'ショートカットキー' })).toBeNull();
    expect(container.querySelectorAll('.overlay')).toHaveLength(1);
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('探す'), { key: 'Escape' });
    });
    await waitFor(() => expect(container.querySelector('.palette')).toBeNull());
  });

  it('上部バーの ⌘K ボタンでも開く', async () => {
    render(<App api={fakeApi().api} />);
    await ready();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'コマンドパレット' }));
    });
    expect(screen.getByLabelText('探す')).toBeInTheDocument();
  });
});

describe('App（コース。3.3）', () => {
  const a = fixtureAnalysis();
  const idOf = (tail: string) => a.symbols.find((x) => x.fqName.endsWith(tail))!.id;
  const key = async (k: string) => {
    await act(async () => {
      fireEvent.keyDown(window, { key: k });
    });
  };

  /** まとまり（mapGroups）の無い古い解析。入口は前の形の地図（CourseMap） */
  const old = (x = fixtureAnalysis()) => {
    delete x.mapGroups;
    return x;
  };
  async function renderCourses(analysis = a) {
    const fake = fakeApi(analysis);
    const r = render(<App api={fake.api} />);
    await ready();
    return { ...r, fake };
  }

  /** 入口のコースの並びでコース n のカードを押して選び、「入る」を押す */
  const enter = (container: HTMLElement, n: number) => {
    fireEvent.click(container.querySelectorAll('.ccard .pick')[n - 1]!);
    fireEvent.click(container.querySelector('.ccard.sel .go')!);
    // 読む前の案内（2026-10-22）から 1 か所目へ
    fireEvent.click(container.querySelector('.brief .bgo .btn')!);
  };

  // 2026-10-22: コースに入るとまず読む前の案内（見本を比べて案 1 にした）。紹介（変わること）はそこに出し、停留所の右の列には出さない
  it('入口にコースの並び（7 本 + コース外）。Enter で最初のコースの読む前の案内、もう一度 Enter で最初の停留所', async () => {
    const { container } = await renderCourses();
    expect(container.querySelectorAll('.ccard')).toHaveLength(8);
    expect(container.querySelectorAll('.ccard')[7]!.textContent).toContain('コースに入っていない場所');
    await key('Enter');
    expect(screen.getByText('コース 1 · 読む前の案内')).toBeInTheDocument();
    expect(container.querySelector('.cbar b')!.textContent).toBe(a.hows[0]!.title);
    expect(container.querySelector('.brief .ba.ai')!.textContent).toContain(a.tours.find((t) => t.howId === 1)!.change!.after!);
    expect(container.querySelector('.cbar .bpill')!.classList.contains('cur')).toBe(true);
    await key('Enter');
    expect(container.querySelector('.brief')).toBeNull();
    expect(container.querySelector('.rcol .gintro')).toBeNull();
    expect(container.querySelector('.code .chd .chip')!.textContent).toBe('1 / 1');
  });

  it('読む前の案内: PR の流れ・変わること・読む順（渡す型）・確かめること・知っておくこと。確かめることを押すと読む順の場所が光る', async () => {
    const { container } = await renderCourses();
    fireEvent.click(container.querySelectorAll('.ccard .pick')[4]!);
    fireEvent.click(container.querySelector('.ccard.sel .go')!);
    const brief = container.querySelector('.brief') as HTMLElement;
    expect(brief.querySelector('.bflow')!.textContent).toContain('（このコース）');
    expect([...brief.querySelectorAll('.bflow .n .cb')].map((x) => x.textContent)).toEqual(['6', '5', '3', '4']);
    expect([...brief.querySelectorAll('.rnode b')].map((x) => x.textContent!.split('.').pop())).toEqual(['execute', 'find', 'Order', 'save', 'kt', '`throws when order is missing`', '`saves the order after applying`']);
    expect([...brief.querySelectorAll('.redge .ty')].map((x) => x.textContent).slice(0, 3)).toEqual(['OrderId', 'DiscountCommand', 'Order']);
    expect(brief.querySelectorAll('.bcheck')).toHaveLength(4);
    expect(brief.querySelector('.bcheck:nth-child(2) .w')!.textContent).toBe('execute 16 行テスト 19 行');
    expect(within(brief).getByText('コース 6 の OrderController.apply が、18 行で execute、19 行で save を呼びます。')).toBeInTheDocument();
    expect(within(brief).getByText('読む 7 か所のうち 3 か所は、ほかのコースの差分です。')).toBeInTheDocument();
    // 2 つ目（execute 16 行・テスト 19 行）を押すと、読む順の execute と 1 つ目のテストが光る
    fireEvent.click(brief.querySelectorAll('.bcheck')[1]!);
    expect([...brief.querySelectorAll('.rnode')].map((x) => x.classList.contains('hl'))).toEqual([true, false, false, false, false, true, false]);
    expect(within(container.querySelector('.cbar') as HTMLElement).getByText(/確かめること/).textContent).toContain('0 / 4');
  });

  it('停留所の右の列に確かめること。ここに根拠のある文は明るく、押すとその文の行だけ濃く光る。コードの根拠の行の行番号に文の番号', async () => {
    const { container } = await renderCourses();
    enter(container, 5);
    const col = container.querySelector('.rcol') as HTMLElement;
    expect(col.querySelectorAll('.sck.here')).toHaveLength(4);
    expect(col.querySelector('.schecks h3')!.textContent).toContain('ここに 4 つ');
    // execute の 15〜18 行に 1〜4 の番号
    expect([...container.querySelectorAll('.fv-body .ln.ck')].map((x) => x.textContent!.replace(/\+/, ''))).toEqual(['115', '216', '317', '418']);
    expect(container.querySelectorAll('.fv-body .ln.ck.on')).toHaveLength(4);
    fireEvent.click(col.querySelectorAll('.sck.here')[1]!);
    expect([...container.querySelectorAll('.fv-body .ln.ck.on')].map((x) => x.textContent!.replace(/\+/, ''))).toEqual(['216']);
    // 次の停留所（find）では、ここに根拠のない文は薄い 1 行
    await key('Enter');
    expect(container.querySelectorAll('.rcol .sck.away')).toHaveLength(4);
    expect(container.querySelector('.rcol .fact')!.textContent).toContain('この差分はコース 4 のものです');
    expect(container.querySelector('.rcol .snext')!.textContent).toBe('次はOrderexecute の 17 行から');
  });

  it('停留所ごとに 1 画面。問題なし · 次へ で次の停留所（紹介は最初の停留所だけ）。ファイル全体に差分を埋め込み、前後 3 行以外を畳む', async () => {
    const { container, fake } = await renderCourses();
    enter(container, 3);
    // 2026-10-11: 停留所は差分だけ（差分の無い DiscountPolicy.rateFor は停留所にしない）。左はファイルのツリー（1 ファイル 1 行。2026-10-19）。このコースのファイルは薄くしない（2026-10-20）
    expect(container.querySelectorAll('.cbar .crumbs button')).toHaveLength(4);
    expect([...container.querySelectorAll('.stop .lt .tree .file:not(.oth) .nm')].map((x) => x.textContent)).toEqual(['OrderAdminView.kt', 'Order.kt', 'OrderTest.kt']);
    expect(container.querySelector('.intro')).toBeNull();
    await key('m');
    const drawer = screen.getByRole('complementary', { name: '地図' });
    // 差分の無い DiscountPolicy.rateFor は箱でなく Order の右隣の「差分なし 1 か所」（2026-10-11）
    await waitFor(() => expect(drawer.querySelectorAll('g.nd')).toHaveLength(10), { timeout: 3000 });
    expect(drawer.querySelector(`g.nd[data-id="${idOf('domain.Order')}"] g.side`)!.textContent).toContain('差分なし 1 か所');
    expect(drawer.querySelector(`g.nd[data-id="${idOf('domain.Order')}"]`)!.classList.contains('cur')).toBe(true);
    await key('Escape');

    const order = a.hunks.find((h) => h.id === idOf('domain.Order'))!;
    expect(container.querySelector('.filebar .path')!.textContent).toBe(order.path);
    expect(container.querySelector(`#hunk-${order.id}`)).not.toBeNull();
    // 左右（既定）では消した行と足した行が同じ段に並ぶ。見ている hunk の段がすべて見ている場所の印を持つ
    expect([...container.querySelectorAll('.fv-body .mrow')].filter((r) => r.querySelector('.cd.f')).length).toBe(alignRows(order.lines, order.lnOld, order.lnNew).length);

    fireEvent.click(screen.getByRole('button', { name: /問題なし · 次へ/ }));
    await waitFor(() => expect(fake.states.get(`local/${a.pr.headSha}`)?.viewed).toEqual([order.id]));
    expect(container.querySelector('.rcol .dh .where')!.textContent).toBe('2 / 4');
    expect(container.querySelector('.rcol .gmsg h2')!.textContent).toBe('OrderAdminView.discountField');
    expect(container.querySelector('.rcol .intro')).toBeNull();
  });

  it('停留所の画面の右は今の停留所のコードで、メモの「+」も出す。地図は M まで出さない。行程表で移ると右も替わる', async () => {
    const { container } = await renderCourses();
    enter(container, 3);
    const order = a.hunks.find((h) => h.id === idOf('domain.Order'))!;
    const right = container.querySelector('.stop .code')!;
    expect(right.querySelector('.chd .sym')!.textContent).toBe('domain.Order');
    expect(right.querySelector('.filebar .path')!.textContent).toBe(order.path);
    expect(right.querySelector(`#hunk-${order.id}`)).not.toBeNull();
    expect(container.querySelector('.cmap')).toBeNull();
    expect(right.querySelector('.mplus')).not.toBeNull();
    const view = a.hunks.find((h) => h.id === idOf('OrderAdminView.discountField'))!;
    fireEvent.click(container.querySelector(`.stop .lt .tree .file[title="${view.path}"]`)!);
    expect(container.querySelector('.stop .code .chd .sym')!.textContent).toBe('OrderAdminView.discountField');
    expect(container.querySelector('.stop .lt .tree .file.on')!.getAttribute('title')).toBe(view.path);
    expect(container.querySelector('.stop .code .filebar .path')!.textContent).toBe(view.path);
  });

  it('左のファイルのツリーは 1 ファイル 1 行。同じファイルの 2 か所は 1 行で、行の印はそのファイルの場所のうち問題なしの数（2026-10-19）', async () => {
    const { container } = await renderCourses();
    enter(container, 2);
    const rows = () => [...container.querySelectorAll('.stop .lt .tree .file:not(.oth)')];
    expect(rows().map((x) => x.querySelector('.nm')!.textContent)).toEqual(['DiscountCommand.kt']);
    expect(rows()[0]!.classList.contains('on')).toBe(true);
    expect(rows()[0]!.querySelector('.vm')!.getAttribute('aria-label')).toBe('未確認');
    fireEvent.click(screen.getByRole('button', { name: /問題なし · 次へ/ }));
    expect(container.querySelector('.rcol .dh .where')!.textContent).toBe('2 / 2');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.querySelector('.vm')!.getAttribute('aria-label')).toBe('問題なし 1 / 2');
  });

  it('同じファイルに読む場所が 2 か所あれば、右のファイル表示に番号の丸と「このファイルの n / m か所目」。次へで同じファイルの次の場所へ（左は 1 行のまま）', async () => {
    const { container } = await renderCourses();
    enter(container, 4);
    const right = () => container.querySelector('.stop .code')!;
    expect([...right().querySelectorAll('.pdot')].map((d) => d.textContent)).toEqual(['1', '2']);
    expect(right().querySelector('.filebar')!.textContent).toContain('このファイルの 1 / 2 か所目');
    fireEvent.click(screen.getByRole('button', { name: /問題なし · 次へ/ }));
    expect(right().querySelector('.chd .sym')!.textContent).toBe('OrderRepositoryImpl.find');
    expect([...right().querySelectorAll('.pdot')].map((d) => d.textContent)).toEqual(['✓', '2']);
    expect(right().querySelector('.filebar')!.textContent).toContain('このファイルの 2 / 2 か所目');
    expect(container.querySelectorAll('.stop .lt .tree .file:not(.oth)')).toHaveLength(2);
    fireEvent.click(within(right() as HTMLElement).getByRole('button', { name: '1 か所目: OrderRepositoryImpl.save' }));
    expect(right().querySelector('.chd .sym')!.textContent).toBe('OrderRepositoryImpl.save');
  });

  // 2026-10-20: 動く見本を比べて「ア: ほかのコースは薄く」にした
  it('左のツリーは差分の全ファイル。ほかのコースのファイルの行は薄く、押すと今の停留所のままそのファイルを覗く。戻る（Esc）で読んでいた停留所に戻る', async () => {
    const { container } = await renderCourses();
    enter(container, 3);
    const lt = screen.getByRole('complementary', { name: 'ファイル' });
    expect(lt.querySelector('.hd')!.textContent).toContain('37 ファイル');
    expect(lt.querySelector('.legend')!.textContent).toContain('このコースのファイル 3');
    expect(lt.querySelectorAll('.tree .file')).toHaveLength(37);
    const promo = a.hunks.find((h) => h.path.endsWith('/PromoService.kt'))!;
    const row = () => lt.querySelector(`.tree .file[title="${promo.path}"]`)!;
    expect(row().classList.contains('oth')).toBe(true);
    expect(lt.querySelector(`.tree .file[title="${a.hunks.find((h) => h.id === idOf('domain.Order'))!.path}"]`)!.classList.contains('oth')).toBe(false);
    fireEvent.click(row());
    const bar = container.querySelector('.code .peekbar')!;
    expect(bar.textContent).toContain('覗いている');
    expect(bar.textContent).toContain('PromoService.kt');
    expect(bar.textContent).toContain('読んでいた停留所: domain.Order');
    expect(container.querySelector('.code .filebar .path')!.textContent).toBe(promo.path);
    expect(container.querySelector(`#hunk-${promo.id}`)).not.toBeNull();
    // 覗いているファイルの行は薄くせず青みに。右の列は今の停留所のまま
    expect(row().classList.contains('peek')).toBe(true);
    expect(within(screen.getByRole('complementary', { name: '水先案内' })).getByText('domain.Order（コース 3 の 1 か所目）')).toBeInTheDocument();
    await key('Escape');
    expect(container.querySelector('.code .peekbar')).toBeNull();
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('domain.Order');
    expect(container.querySelector('.view.course')).not.toBeNull();
  });

  it('左のファイルの行を押すと、そのファイルでまだ問題なしにしていない最初の場所へ', async () => {
    const { container } = await renderCourses();
    enter(container, 3);
    const test = a.hunks.find((h) => h.path.endsWith('/OrderTest.kt'))!;
    const file = () => container.querySelector(`.stop .lt .tree .file[title="${test.path}"]`)!;
    fireEvent.click(file());
    expect(container.querySelector('.rcol .dh .where')!.textContent).toBe('3 / 4');
    fireEvent.click(screen.getByRole('button', { name: /問題なし · 次へ/ }));
    fireEvent.click(container.querySelectorAll('.cbar .crumbs button')[0]!);
    fireEvent.click(file());
    expect(container.querySelector('.rcol .dh .where')!.textContent).toBe('4 / 4');
  });

  it('「たたむ」か B で右の列を細い帯にたたむ。文はコードの上、ボタンはコードの下へ移り、たたんだまま次の停留所へ。もう一度 B で戻る', async () => {
    const { container } = await renderCourses();
    enter(container, 3);
    expect(container.querySelector('.stop.shut')).toBeNull();
    expect(container.querySelector('.code .strip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /たたむ/ }));
    expect(container.querySelector('.stop.shut')).not.toBeNull();
    // 右の列は隠れて押せない（帯の丸と開くボタンだけ）
    expect(container.querySelector('.rcol')!.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('.code .strip .sn .narr')!.textContent).toContain(a.tours.find((t) => t.howId === 3)!.steps[0]!.role!);
    // コースの紹介は読む前の案内にあるので、帯にも出さない（コース外だけ最初の停留所に出す）
    expect(container.querySelector('.code .strip .intro')).toBeNull();
    expect(container.querySelector('.code .bottom')!.textContent).toContain('問題なし · 次へ');
    expect(container.querySelectorAll('.stop .rail [data-step]')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /問題なし · 次へ/ }));
    expect(container.querySelector('.stop.shut')).not.toBeNull();
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('OrderAdminView.discountField');
    expect(container.querySelector('.code .bottom')!.textContent).toContain('前へ');
    // 帯の丸で移れる
    fireEvent.click(container.querySelectorAll('.stop .rail [data-step]')[3]!);
    expect(container.querySelector('.code .bottom')!.textContent).toContain('問題なし · 総括へ');
    await key('b');
    expect(container.querySelector('.stop.shut')).toBeNull();
    expect(container.querySelector('.code .strip')).toBeNull();
    expect(container.querySelector('.code .bottom')).toBeNull();
    expect(container.querySelector('.rcol')!.hasAttribute('inert')).toBe(false);
  });

  it('地図は M で右から引き出し、Shift+M か「大きく」で真ん中いっぱいに。もう一度で引き出しに戻り、Esc で閉じる', async () => {
    const { container } = await renderCourses();
    enter(container, 3);
    fireEvent.click(within(container.querySelector('.code .chd') as HTMLElement).getByRole('button', { name: /地図/ }));
    expect(screen.getByRole('complementary', { name: '地図' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /大きく/ }));
    expect(screen.queryByRole('complementary', { name: '地図' })).toBeNull();
    const big = screen.getByRole('dialog', { name: '地図' });
    await waitFor(() => expect(big.querySelector(`g.nd[data-id="${idOf('domain.Order')}"]`)).not.toBeNull(), { timeout: 3000 });
    await key('M');
    expect(screen.queryByRole('dialog', { name: '地図' })).toBeNull();
    expect(screen.getByRole('complementary', { name: '地図' })).toBeInTheDocument();
    await key('Escape');
    expect(screen.queryByRole('complementary', { name: '地図' })).toBeNull();
    await key('M');
    expect(screen.getByRole('dialog', { name: '地図' })).toBeInTheDocument();
    // 左のツリーの「すべて閉じる」と分ける
    fireEvent.click(screen.getByRole('button', { name: /^閉じる/ }));
    expect(screen.queryByRole('dialog', { name: '地図' })).toBeNull();
    expect(container.querySelector('.rcol')).not.toBeNull();
  });

  it('地図の引き出しの「大きく」で真ん中いっぱいに、「元の大きさ」で戻る', async () => {
    const { container } = await renderCourses();
    enter(container, 3);
    await key('m');
    fireEvent.click(screen.getByRole('button', { name: /大きく/ }));
    expect(screen.getByRole('dialog', { name: '地図' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /元の大きさ/ }));
    expect(screen.getByRole('complementary', { name: '地図' })).toBeInTheDocument();
    expect(container.querySelector('.code .filebar')).not.toBeNull();
  });

  it('LLM の文は点線の枠（.narr.ai）と「AI」のチップ。停留所のこの場所の文も同じ（決定 3）', async () => {
    const { container } = await renderCourses();
    enter(container, 3);
    const say = container.querySelector('.rcol .sn .narr')!;
    expect(say.querySelector('.who')!.textContent).toBe('この場所AI');
    expect(say.textContent).not.toContain('自動');
    expect(say.classList.contains('ai')).toBe(true);
    expect(say.textContent).toContain(a.tours.find((t) => t.howId === 3)!.steps[0]!.role!);
  });

  it('なぜここか（案内の 1 行）と何を変えたかが同じ出どころなら 1 つの枠（なぜここかが先）、違えば枠を 2 つ（原則 2）', async () => {
    // 古い解析（2026-10-22 より前）の なぜここか（guide）と 何を変えたか（say）
    const old = fixtureAnalysis();
    const tour = old.tours.find((t) => t.howId === 3)!;
    Object.assign(tour.steps[1]!, { guide: '束のサンプル。', say: '読み方を変えた。' });
    const { container } = await renderCourses(old);
    enter(container, 3);
    await key('ArrowRight');
    const one = [...container.querySelectorAll('.rcol .sn .narr')];
    expect(one).toHaveLength(1);
    expect(one[0]!.querySelector('p.why')!.textContent).toBe(tour.steps[1]!.guide);
    expect(one[0]!.textContent).toContain(tour.steps[1]!.say!);
    cleanup();
    const b = structuredClone(old);
    const step = b.tours.find((t) => t.howId === 3)!.steps[1]!;
    delete step.say;
    delete step.role;
    const r = await renderCourses(b);
    enter(r.container, 3);
    await key('ArrowRight');
    const two = [...r.container.querySelectorAll('.rcol .sn .narr')];
    expect(two.map((n) => n.classList.contains('ai'))).toEqual([true, false]);
    expect(two[0]!.textContent).toContain(tour.steps[1]!.guide!);
  });

  it('LLM の文が無い解析・書き漏らした場所は、今の「自動」の文（実線の枠と「自動」のチップ。決定 2）', async () => {
    const b = fixtureAnalysis();
    delete b.tours.find((t) => t.howId === 3)!.steps[0]!.role;
    const { container } = await renderCourses(b);
    enter(container, 3);
    const say = container.querySelector('.rcol .sn .narr')!;
    expect(say.classList.contains('ai')).toBe(false);
    expect(say.querySelector('.chip')!.textContent).toBe('自動');
    expect(say.textContent).toMatch(/変更 \+\d+ −\d+/);
  });

  it('見ている hunk の変わった行の前後 3 行を残して他を帯に畳み（ファイルの先頭の帯は ↑ だけ）、F でファイル全体を出す', async () => {
    const { container } = await renderCourses();
    enter(container, 4);
    const first = a.hunks.find((h) => h.id === a.tours.find((t) => t.howId === 4)!.steps[0]!.hunkId)!;
    expect(container.querySelector('.filebar .path')!.textContent).toBe(first.path);
    const rows = fileRows(a.files!.find((x) => x.path === first.path)!.tokens, a.hunks.filter((h) => h.path === first.path), first.id, null);
    const changed = rows.findIndex((r) => r.focus && r.kind !== 'ctx');
    expect(container.querySelector('.fold .fl')!.textContent).toBe(`⋯ ${changed - 3} 行`);
    expect(within(container.querySelector('.fold') as HTMLElement).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([`上へ ${Math.min(20, changed - 3)} 行表示`]);
    await key('f');
    expect(container.querySelector('.fold')).toBeNull();
    // ファイル全体: 最初の段はファイルの 1 行目
    expect(container.querySelector('.fv-body .mrow .cd')!.textContent).toBe(a.files!.find((x) => x.path === first.path)!.tokens[0]!.map(([t]) => t).join(''));
    await key('f');
    expect(container.querySelector('.fold')).not.toBeNull();
  });

  it('停留所のコードは既定で左右（左が変更前、右が変更後）。帯の「統合」か u で統合、「左右」か s で左右に戻り、diffMode.c に保存される', async () => {
    const { container, fake } = await renderCourses();
    enter(container, 3);
    expect(container.querySelector('.fv-body.sbs')).not.toBeNull();
    expect(within(container.querySelector('.filebar') as HTMLElement).getByRole('button', { name: '左右' }).classList.contains('on')).toBe(true);
    const row = (text: string) => [...container.querySelectorAll('.fv-body .mrow')].find((r) => r.textContent!.includes(text))!;
    const cells = (r: Element) => [...r.querySelectorAll('.cd')].map((c) => `${['r', 'a', 'x'].find((k) => c.classList.contains(k)) ?? '-'}:${c.textContent}`);
    // 旧 6 行目を消して新 6 行目を足した所は同じ段の左と右。足しただけの行の左は斜線。変わらない行は両側に同じ行
    expect(cells(row('val promo'))).toEqual(['r:    val promo: Promo? = null,', 'a:    var discount: Money = Money.ZERO,']);
    expect(cells(row('val rate'))).toEqual(['x:', 'a:        val rate = DiscountPolicy.rateFor(cmd.code)']);
    expect(cells(row('class Order('))).toEqual(['-:class Order(', '-:class Order(']);
    await key('u');
    expect(container.querySelector('.fv-body.uni')).not.toBeNull();
    await waitFor(() => expect(fake.ui.diffMode?.c).toBe('uni'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '左右' }));
    });
    expect(container.querySelector('.fv-body.sbs')).not.toBeNull();
    await waitFor(() => expect(fake.ui.diffMode?.c).toBe('sbs'));
  });

  // 2026-10-11: 差分の無い相手は停留所でなく「差分なしの関係」の 1 行。名前（3 か所以下）を押すと右から引き出す
  it('差分なしの関係: 停留所のコードの上に 1 行。名前を押すと引き出しでその相手を出し、見た印は付かない', async () => {
    const { container, fake } = await renderCourses();
    enter(container, 5);
    const row = () => container.querySelector('.relrow')!;
    expect(container.querySelector('.stop .code .relrow')).not.toBeNull();
    expect(row().textContent).toContain('差分なしの関係');
    // execute が足した行で呼ぶ差分の無い相手は save だけ。find は変わらない行から呼ぶので出ない（2026-10-12）
    expect(row().textContent).toContain('呼び出し先 1');
    expect([...row().querySelectorAll('.name')].map((b) => b.textContent)).toEqual(['OrderRepository.save']);
    fireEvent.click(within(row() as HTMLElement).getByRole('button', { name: 'OrderRepository.save' }));
    const d = screen.getByRole('complementary', { name: '差分のない相手' });
    expect(d.querySelector('.rlist [aria-current="true"]')!.textContent).toBe('OrderRepository.save');
    expect(d.querySelector('.fv-body .cd.ctr')!.textContent).toBe('    fun save(order: Order)');
    await key('Escape');
    expect(screen.queryByRole('complementary', { name: '差分のない相手' })).toBeNull();
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('ApplyDiscountUseCase.execute');
    expect(fake.states.get(`local/${a.pr.headSha}`)?.viewed ?? []).toEqual([]);
    // 相手のいない停留所には出さない
    fireEvent.click(container.querySelectorAll('.cbar .crumbs button')[3]!);
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('OrderRepositoryImpl.save');
    expect(container.querySelector('.relrow')).toBeNull();
  });

  it('M で地図の引き出し。関連の箱を押すとコードがその箱に替わり、戻るで読んでいた停留所に戻る', async () => {
    const { container } = await renderCourses();
    enter(container, 3);
    await key('m');
    const drawer = screen.getByRole('complementary', { name: '地図' });
    const dto = idOf('api.OrderResponse');
    await waitFor(() => expect(drawer.querySelector(`g.nd[data-id="${dto}"]`)).not.toBeNull(), { timeout: 3000 });
    expect(drawer.querySelector(`g.nd[data-id="${dto}"]`)!.classList.contains('rel')).toBe(true);
    fireEvent.click(drawer.querySelector(`g.nd[data-id="${dto}"] rect`)!);
    expect(screen.queryByRole('complementary', { name: '地図' })).toBeNull();
    expect(container.querySelector('.peekbar')!.textContent).toContain('api.OrderResponse');
    expect(container.querySelector('.peekbar')!.textContent).toContain('読んでいた停留所: domain.Order');
    expect(container.querySelector(`#hunk-${dto}`)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(container.querySelector('.peekbar')).toBeNull();
    expect(container.querySelector(`#hunk-${idOf('domain.Order')}`)).not.toBeNull();
  });

  // 2026-10-11: 差分の無い相手は「差分なし n か所」の箱。押すと右から引き出し、名前の一覧とコードを出す（見本 3 版）
  /** 差分の箱 host のうち、layer の帯に置いた「差分なし n か所」の箱 */
  const relBox = (root: Element, host: string, layer: string) => root.querySelector<SVGGElement>(`g.nd[data-id="rel:${host}:${layer}"]`);
  const relDrawer = () => screen.queryByRole('complementary', { name: '差分のない相手' });
  const centerLine = () => relDrawer()?.querySelector('.fv-body .cd.ctr')?.textContent;

  it('古い解析の入口の地図: 「差分なし 1 か所」（execute の呼び出し先）を押すと引き出しに名前とコード。Esc で閉じる', async () => {
    const { container } = await renderCourses(old());
    expect(screen.getByText(/古い ondina で作った解析なので、前の形の地図を出しています/)).toBeInTheDocument();
    const map = container.querySelector('.home .cmap')!;
    const exec = idOf('ApplyDiscountUseCase.execute');
    await waitFor(() => expect(relBox(map, exec, 'Domain')).not.toBeNull(), { timeout: 3000 });
    expect(relBox(map, exec, 'Domain')!.textContent).toContain('差分なし 1 か所');
    expect(relBox(map, exec, 'Domain')!.textContent).toContain('呼び出し先 1');
    fireEvent.click(relBox(map, exec, 'Domain')!.querySelector('rect')!);
    const d = relDrawer()!;
    expect(d.textContent).toContain('ApplyDiscountUseCase.execute の呼び出し先');
    expect([...d.querySelectorAll('.rlist button')].map((b) => b.textContent)).toEqual(['OrderRepository.save']);
    expect(d.querySelector('.rlist [aria-current="true"]')!.textContent).toBe('OrderRepository.save');
    expect(centerLine()).toBe('    fun save(order: Order)');
    await key('Escape');
    expect(relDrawer()).toBeNull();
    expect(container.querySelector('.home')).not.toBeNull();
  });

  it('引き出しの ↓ で次の相手（相手の多い再現: execute の呼び出し先 4）', async () => {
    const { container } = await renderCourses(old(fixtureWithNeighbors()));
    const map = container.querySelector('.home .cmap')!;
    const exec = idOf('ApplyDiscountUseCase.execute');
    await waitFor(() => expect(relBox(map, exec, 'Domain')).not.toBeNull(), { timeout: 3000 });
    fireEvent.click(relBox(map, exec, 'Domain')!.querySelector('rect')!);
    expect([...relDrawer()!.querySelectorAll('.rlist button')].map((b) => b.textContent)).toEqual(['Clock.now', 'Money.plus', 'OrderId.of', 'OrderRepository.save']);
    expect(relDrawer()!.querySelector('.rlist [aria-current="true"]')!.textContent).toBe('Clock.now');
    await key('ArrowDown');
    expect(relDrawer()!.querySelector('.rlist [aria-current="true"]')!.textContent).toBe('Money.plus');
  });

  describe('入口の地図（まとまり。2026-11-04）', () => {
    const gmap = async (analysis = a) => {
      const r = await renderCourses(analysis);
      const map = r.container.querySelector<HTMLElement>('.home .gmap')!;
      await waitFor(() => expect(map.querySelector('.gn')).not.toBeNull(), { timeout: 3000 });
      return { ...r, map, at: (id: string) => map.querySelector<HTMLElement>(`.gn[data-id="${id}"]`) };
    };
    const crumbs = (map: Element) => [...map.querySelectorAll('.crumbs > *:not(.csep)')].map((x) => x.textContent);

    it('全景はコースのまとまり 7 つとコース外。押すと中に入り、パンくずが伸びる。Esc で全景へ戻る', async () => {
      const { map, at } = await gmap();
      expect([...map.querySelectorAll('.gn.group')].map((x) => x.getAttribute('data-id'))).toEqual(a.mapGroups!.root);
      expect(crumbs(map)).toEqual(['全景']);
      await act(async () => {
        fireEvent.click(at('course:3')!);
      });
      await waitFor(() => expect(map.querySelector('.gn.box')).not.toBeNull(), { timeout: 3000 });
      expect(crumbs(map)).toEqual(['全景', 'コース 3']);
      expect(map.querySelectorAll('.gn.portal').length).toBeGreaterThan(0);
      await key('Escape');
      await waitFor(() => expect(map.querySelector('.gn.group')).not.toBeNull(), { timeout: 3000 });
      expect(crumbs(map)).toEqual(['全景']);
    });

    it('箱を押すとその箱のコースを選び、そのコースが通らない箱は沈む。札を押すとそのまとまりへ移る', async () => {
      const { container, map, at } = await gmap();
      await act(async () => {
        fireEvent.click(at('course:3')!);
      });
      await waitFor(() => expect(map.querySelector('.gn.box')).not.toBeNull(), { timeout: 3000 });
      const order = a.mapGroups!.boxes.find((b) => b.path?.endsWith('/Order.kt'))!.id;
      await act(async () => {
        fireEvent.click(at(order)!);
      });
      expect(container.querySelector('.ccard.sel')).toBe(container.querySelectorAll('.ccard')[2]);
      expect(at(order)!.className).toContain('lit');
      const portal = map.querySelector<HTMLElement>('.gn.portal.dim')!;
      const to = portal.getAttribute('data-id')!;
      await act(async () => {
        fireEvent.click(portal);
      });
      await waitFor(() => expect(crumbs(map)).toEqual(['全景', `コース ${to.slice('course:'.length)}`]), { timeout: 3000 });
    });

    it('「差分なし n」を押すと、そのファイルのシンボルの相手を引き出しに出す', async () => {
      const { map, at } = await gmap(fixtureWithNeighbors());
      await act(async () => {
        fireEvent.click(at('course:5')!);
      });
      await waitFor(() => expect(map.querySelector('.grel')).not.toBeNull(), { timeout: 3000 });
      fireEvent.click(map.querySelector('.grel')!);
      const d = relDrawer()!;
      expect(d.textContent).toContain('ApplyDiscountUseCase の呼び出し先');
      expect([...d.querySelectorAll('.rlist button')].map((b) => b.textContent)).toEqual(['Clock.now', 'Money.plus', 'OrderId.of', 'OrderRepository.save']);
      await key('Escape');
      expect(relDrawer()).toBeNull();
      expect(crumbs(map)).toEqual(['全景', 'コース 5']);
    });
  });

  describe('入口の地図をつまんで拡大・縮小する', () => {
    async function homeMap() {
      const { container } = await renderCourses();
      const map = container.querySelector<HTMLElement>('.home .gmap')!;
      await waitFor(() => expect(map.querySelector('.gstage')).not.toBeNull(), { timeout: 3000 });
      const stage = map.querySelector<HTMLElement>('.gstage')!;
      return { map, width: () => parseFloat(stage.style.width) };
    }
    /** トラックパッドのピンチ（Chrome は Ctrl 付きの wheel で来る） */
    const wheel = async (el: Element, deltaY: number, ctrlKey = true) => {
      const e = new WheelEvent('wheel', { deltaY, ctrlKey, clientX: 40, clientY: 40, bubbles: true, cancelable: true });
      await act(async () => {
        el.dispatchEvent(e);
      });
      return e;
    };

    it('広げると地図だけが大きくなり、画面全体の拡大は止める', async () => {
      const { map, width } = await homeMap();
      const before = width();
      const e = await wheel(map.querySelector('.gstage')!, -10);
      expect(e.defaultPrevented).toBe(true);
      expect(width()).toBeGreaterThan(before);
    });

    it('つまむと小さくなる。見出しの上でつまんでも地図が変わる', async () => {
      const { map, width } = await homeMap();
      const before = width();
      await wheel(map.querySelector('.hd')!, 10);
      expect(width()).toBeLessThan(before);
    });

    it('Ctrl なしの 2 本指のスクロールは倍率を変えず、止めない', async () => {
      const { map, width } = await homeMap();
      const before = width();
      const e = await wheel(map.querySelector('.gstage')!, -10, false);
      expect(e.defaultPrevented).toBe(false);
      expect(width()).toBe(before);
    });

    it('広げ続けても 200% で止まる', async () => {
      const { map, width } = await homeMap();
      const at100 = width();
      for (let i = 0; i < 10; i++) await wheel(map, -100);
      const top = width();
      await wheel(map, -100);
      expect(width()).toBe(top);
      expect(Math.abs(top - at100 * 2)).toBeLessThanOrEqual(1);
    });

    it('狭め続けても 25% で止まる', async () => {
      const { map, width } = await homeMap();
      const at100 = width();
      for (let i = 0; i < 10; i++) await wheel(map, 100);
      const bottom = width();
      await wheel(map, 100);
      expect(width()).toBe(bottom);
      expect(Math.abs(bottom - at100 / 4)).toBeLessThanOrEqual(1);
    });

    it('Safari のピンチ（gesturestart / gesturechange）でも変わり、画面全体の拡大は止める', async () => {
      const { map, width } = await homeMap();
      const before = width();
      const gesture = async (type: string, scale: number) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.assign(e, { scale, clientX: 40, clientY: 40 });
        await act(async () => {
          map.dispatchEvent(e);
        });
        return e;
      };
      expect((await gesture('gesturestart', 1)).defaultPrevented).toBe(true);
      const e = await gesture('gesturechange', 1.5);
      expect(e.defaultPrevented).toBe(true);
      expect(Math.abs(width() - before * 1.5)).toBeLessThanOrEqual(1);
    });
  });

  it('古い解析の地図で、同じ層の相手は差分の箱の右隣: domain.Order の右を押すと DiscountPolicy.rateFor', async () => {
    const { container } = await renderCourses(old());
    const map = container.querySelector('.home .cmap')!;
    const order = () => [...map.querySelectorAll<SVGGElement>('g.nd.ch')].find((g) => g.querySelector('text.nm')?.textContent === 'domain.Order');
    await waitFor(() => expect(order()?.querySelector('g.side')).toBeTruthy(), { timeout: 3000 });
    expect(order()!.querySelector('g.side')!.textContent).toContain('差分なし 1 か所');
    fireEvent.click(order()!.querySelector('g.side rect')!);
    expect(relDrawer()!.querySelector('.rlist [aria-current="true"]')!.textContent).toBe('DiscountPolicy.rateFor');
    expect(centerLine()).toBe('    fun rateFor(code: String): Rate =');
  });

  it('コース: R で今の停留所の相手を出し、Shift+R で大きく。地図の引き出しの「差分なし」の箱を押すと関係の引き出しに入れ替わる', async () => {
    const { container } = await renderCourses();
    enter(container, 5);
    await key('r');
    expect(relDrawer()!.textContent).toContain('ApplyDiscountUseCase.execute の呼び出し先');
    await key('R');
    expect(relDrawer()).toBeNull();
    expect(screen.getByRole('dialog', { name: '差分のない相手' })).toBeInTheDocument();
    await key('R');
    expect(relDrawer()).not.toBeNull();
    await key('r');
    expect(relDrawer()).toBeNull();
    await key('m');
    const map = screen.getByRole('complementary', { name: '地図' });
    const exec = idOf('ApplyDiscountUseCase.execute');
    await waitFor(() => expect(relBox(map, exec, 'Domain')).not.toBeNull(), { timeout: 3000 });
    fireEvent.click(relBox(map, exec, 'Domain')!.querySelector('rect')!);
    expect(screen.queryByRole('complementary', { name: '地図' })).toBeNull();
    expect(relDrawer()).not.toBeNull();
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('ApplyDiscountUseCase.execute');
  });

  it('総括: 問題なしの数と、束があれば 代表 / 逸脱 / 残り。残りのチェックは見たになる。完了で次のコース', async () => {
    const { container, fake } = await renderCourses();
    enter(container, 3);
    fireEvent.click(container.querySelectorAll('.cbar .crumbs button')[3]!);
    fireEvent.click(screen.getByRole('button', { name: /問題なし · 総括へ/ }));
    expect(screen.getByText('総括')).toBeInTheDocument();
    expect(screen.getByText('1 / 4')).toBeInTheDocument();
    expect(screen.getByText('同じ書き換え 22')).toBeInTheDocument();
    expect(screen.getByText('残り 21')).toBeInTheDocument();
    const boxes = container.querySelectorAll<HTMLInputElement>('.members input');
    expect(boxes).toHaveLength(21);
    fireEvent.click(boxes[0]!);
    await waitFor(() => expect(fake.states.get(`local/${a.pr.headSha}`)?.viewed).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /完了 · 次はコース 1/ }));
    await waitFor(() => expect(fake.states.get(`local/${a.pr.headSha}`)?.course?.completed).toEqual([3]));
    expect(container.querySelector('.cbar b')!.textContent).toBe(a.hows[0]!.title);
  });

  it('o で今の停留所が呼んでいる相手が並び、選ぶとその停留所の実物へ飛ぶ', async () => {
    const { container } = await renderCourses();
    enter(container, 5);
    fireEvent.click(container.querySelector(`.cbar .crumbs button[data-step="${idOf('ApplyDiscountUseCase.execute')}"]`)!);
    await key('o');
    const dialog = screen.getByRole('dialog', { name: 'コマンドパレット' });
    expect(dialog.querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByPlaceholderText('ApplyDiscountUseCase.execute が呼んでいる相手')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('OrderRepositoryImpl.save'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('.cbar b')!.textContent).toBe(a.hows[4]!.title);
    expect(container.querySelector('.chd .sym')!.textContent).toBe('OrderRepositoryImpl.save');
  });

  it('呼んでいる相手の一覧が空のときは理由を書く: 測れていない / 測っていない / 呼んでいない', async () => {
    const { container } = await renderCourses();
    const idFq = (fq: string) => a.symbols.find((x) => x.fqName === fq)!.id;
    const openAt = async (n: number, symbolId: string) => {
      await key('Escape');
      await key('Escape');
      enter(container, n);
      fireEvent.click(container.querySelector(`.cbar .crumbs button[data-step="${symbolId}"]`)!);
      await key('o');
    };
    await openAt(2, idFq('com.example.order.domain.DiscountCommand'));
    expect(screen.getByText('? 呼び出し関係を取得できていません（LSP が応答しませんでした）')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '探す' }), { key: 'Escape' });
    await openAt(5, idFq('src/main/kotlin/com/example/order/application/ApplyDiscountUseCase.kt'));
    expect(screen.getByText('? 呼び出し関係を取得していません')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: '探す' }), { key: 'Escape' });
    await openAt(5, idFq('com.example.order.infra.OrderRepositoryImpl.find'));
    expect(screen.getByText('呼んでいる相手なし')).toBeInTheDocument();
  });

  it('全文の無い古い解析では、その hunk だけを出し、全文が無いことを書く', async () => {
    const old = fixtureAnalysis();
    delete old.files;
    const fake = fakeApi(old);
    const { container } = render(<App api={fake.api} />);
    await ready();
    enter(container, 3);
    expect(container.querySelector('.filebar')!.textContent).toContain('ファイル全体は解析にありません');
    expect(container.querySelector(`#hunk-${idOf('domain.Order')}`)).not.toBeNull();
  });
});

describe('App（締め。3.9）', () => {
  const a = fixtureAnalysis();
  const PR_URL = 'https://github.com/o/r/pull/42';
  const key = async (k: string) => {
    await act(async () => {
      fireEvent.keyDown(window, { key: k });
    });
  };

  it('上の帯の「締め」で開く: 3 つの数、水先案内、コース外の 3 か所、見ていない差分（12 件 + ほか 36）', async () => {
    const { container } = await renderClosing(fakeApi().api);
    expect([...container.querySelectorAll('.closing .stat b')].map((b) => b.textContent)).toEqual(['0 / 7', '0 / 48', '—']);
    expect(screen.getByText('見ていない差分 48。')).toBeInTheDocument();
    // PR の無い解析（local）は承認の代わりに AI に返す
    expect(screen.getByText('AI にはいつでも返せます。')).toBeInTheDocument();
    const outside = container.querySelector('.box.outside')!;
    expect([...outside.querySelectorAll('.row3 .nm b')].map((n) => n.textContent)).toEqual(['Logger.kt', 'Logger.format', 'FeatureFlags.DISCOUNT_V2']);
    const unseen = container.querySelector('.box.unseen')!;
    expect(unseen.querySelectorAll('.row3 button')).toHaveLength(12);
    expect(unseen.textContent).toContain('ほか 36');
    expect(screen.getByRole('button', { name: '締め' })).toHaveClass('on');
  });

  it('コース外の「見る」でその場所の停留所へ。「順に見る」でコース外の最初の停留所へ', async () => {
    const { container } = await renderClosing(fakeApi().api);
    fireEvent.click(container.querySelectorAll('.box.outside .row3 button')[1]!);
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('Logger.format');
    await press('締め');
    fireEvent.click(screen.getByRole('button', { name: '3 か所を順に見る' }));
    expect(screen.getByText('コース外 · 出発')).toBeInTheDocument();
  });

  it('見ていない差分の「開く」で差分一覧のその hunk へ。D でも差分一覧へ行ける', async () => {
    const { container } = await renderClosing(fakeApi().api);
    const second = a.hunks.find((h) => h.path.endsWith('analytics/OrderMetrics.kt'))!;
    fireEvent.click(container.querySelectorAll('.box.unseen .row3 button')[1]!);
    await waitFor(() => expect(container.querySelector(`#hunk-${second.id}.on`)).not.toBeNull());
    await press('締め');
    await key('d');
    expect(container.querySelector('.vd')).not.toBeNull();
  });

  it('下書きの「開く」で差分一覧のその行の hunk へ', async () => {
    const fake = fakeApi();
    const h = a.hunks.find((x) => x.path.endsWith('order/domain/Order.kt'))!;
    fake.states.set(`local/${a.pr.headSha}`, {
      viewed: [],
      comments: [{ id: 'c1', path: h.path, line: h.lnNew, side: 'RIGHT', body: '一つ目', source: 'claude-code', state: 'draft' }],
    });
    const { container } = await renderClosing(fake.api);
    await screen.findByText('一つ目');
    fireEvent.click(container.querySelector('.cm .loc button')!);
    await waitFor(() => expect(container.querySelector(`#hunk-${h.id}.on`)).not.toBeNull());
  });

  it('PR の解析の水先案内は「承認はいつでも押せます」', async () => {
    await renderClosing(fakeApi(a, { key: '42', prUrl: 'https://github.com/o/r/pull/42' }).api);
    expect(screen.getByText('承認はいつでも押せます。')).toBeInTheDocument();
    expect(screen.getByText('いつでも押せます。PR ページを開きます')).toBeInTheDocument();
  });

  it('「GitHub で承認」と Enter は PR ページを新しいタブで開く（ゲートしない）', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await renderClosing(fakeApi(fixtureAnalysis(), { key: '42', prUrl: PR_URL }).api);
    fireEvent.click(screen.getByRole('button', { name: /GitHub で承認/ }));
    expect(open).toHaveBeenCalledWith(PR_URL, '_blank', 'noopener,noreferrer');
    await key('Enter');
    expect(open).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });

  it('PR の URL が無い解析（local）では「GitHub で承認」は押せず、理由を出す', async () => {
    await renderClosing(fakeApi().api);
    const btn = screen.getByRole('button', { name: /GitHub で承認/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringContaining('PR'));
    // 「いつでも押せます」とは書かない（押せないので）
    expect(screen.queryByText(/いつでも押せます/)).toBeNull();
    expect(screen.getByText('PR がないので、承認する PR ページはありません')).toBeInTheDocument();
  });

  it('最後のコースの総括は「完了 · 締めへ」で締めへ。全部終えた入口の大きいボタンは「締めへ」', async () => {
    const fake = fakeApi();
    fake.states.set(`local/${a.pr.headSha}`, { viewed: [], comments: [], course: { done: [], completed: [1, 2, 3, 4, 5, 6] } });
    const { container } = render(<App api={fake.api} />);
    await ready();
    fireEvent.click(container.querySelectorAll('.ccard .pick')[6]!);
    fireEvent.click(container.querySelector('.ccard.sel .go')!);
    // 読む前の案内（2026-10-22）から 1 か所目へ
    fireEvent.click(container.querySelector('.brief .bgo .btn')!);
    for (let i = 0; i < 3; i++) await key('Enter');
    fireEvent.click(screen.getByRole('button', { name: /完了 · 締めへ/ }));
    await screen.findByText('完了にしたコース');
    expect([...container.querySelectorAll('.closing .stat b')].map((b) => b.textContent)[0]).toBe('7 / 7');
    await press('全体図');
    // 入口ではコース 7 を選んだままなので、Esc で外すと「締めへ」
    await key('Escape');
    expect(screen.getByRole('button', { name: /^締めへ/ })).toBeInTheDocument();
  });
});

describe('App（メモ。3.3 / 3.9）', () => {
  const a = fixtureAnalysis();
  const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
  const POLICY = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';

  /** コース 3 の i か所目の停留所の画面（入ってから Enter = 問題なし · 次へ を i 回） */
  async function renderStop(i: number, fake = fakeApi()) {
    const r = render(<App api={fake.api} />);
    await ready();
    fireEvent.click(r.container.querySelectorAll('.ccard .pick')[2]!);
    fireEvent.click(r.container.querySelector('.ccard.sel .go')!);
    // 読む前の案内（2026-10-22）から 1 か所目へ
    fireEvent.click(r.container.querySelector('.brief .bgo .btn')!);
    for (let k = 0; k < i; k++) {
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });
    }
    return { ...r, fake };
  }
  const saved = (fake: ReturnType<typeof fakeApi>) => fake.states.get(`local/${a.pr.headSha}`)?.comments ?? [];

  it('行番号の「+」を押したまま 11 行目までなぞると範囲に色が付き、離すと最後の行のすぐ下に書く枠が開く。⌘⏎ で保存すると、その場所にメモが残る', async () => {
    const { container, fake } = await renderStop(0);
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('domain.Order');
    const from = screen.getByRole('button', { name: '8 行目にメモ' });
    fireEvent.mouseDown(from);
    fireEvent.mouseEnter(rowOf(screen.getByRole('button', { name: '11 行目にメモ' })));
    // なぞっている間は書く枠を出さない（出すと下の行がずれる）
    expect(container.querySelectorAll('.fv-body .cd.msel')).toHaveLength(4);
    expect(container.querySelector('.fv-body .mbox.edit')).toBeNull();
    fireEvent.mouseUp(window);
    expect(container.querySelectorAll('.fv-body .cd.msel')).toHaveLength(4);
    const box = container.querySelector('.fv-body .mbox.edit')!;
    expect(box.textContent).toContain('Order.kt 8〜11 行目');
    // 書く枠は 11 行目の行のすぐ後ろ
    expect([...box.closest('.mrow-memo')!.previousElementSibling!.querySelectorAll('.cd')].map((c) => c.textContent).join('|')).toContain('}');
    const ta = within(box as HTMLElement).getByLabelText('メモ');
    fireEvent.change(ta, { target: { value: '上書きになる？' } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    });
    await waitFor(() => expect(saved(fake)).toEqual([{ id: 'm1', path: ORDER, startLine: 8, startSide: 'RIGHT', line: 11, side: 'RIGHT', body: '上書きになる？', source: 'reviewer', state: 'adopted' }]));
    expect(container.querySelector('.fv-body .mbox.edit')).toBeNull();
    expect(container.querySelector('.fv-body .mbox')!.textContent).toContain('上書きになる？');
    expect(container.querySelectorAll('.fv-body .cd.msel')).toHaveLength(0);
  });

  it('書きかけのまま範囲をなぞり直しても、書いた文は消えない', async () => {
    const { container, fake } = await renderStop(0);
    clickPlus(screen.getByRole('button', { name: '8 行目にメモ' }));
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '書きかけ' } });
    dragPlus(screen.getByRole('button', { name: '8 行目にメモ' }), screen.getByRole('button', { name: '11 行目にメモ' }));
    const box = container.querySelector('.fv-body .mbox.edit') as HTMLElement;
    expect(box.textContent).toContain('Order.kt 8〜11 行目');
    expect(within(box).getByLabelText('メモ')).toHaveValue('書きかけ');
    fireEvent.click(within(box).getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(saved(fake)).toMatchObject([{ startLine: 8, line: 11, body: '書きかけ' }]));
  });

  it('保存したメモは「直す」で書き換え、「消す」で取り除ける', async () => {
    const fake = fakeApi();
    fake.states.set(`local/${a.pr.headSha}`, { viewed: [], comments: [{ id: 'm1', path: ORDER, line: 13, side: 'RIGHT', body: '前', source: 'reviewer', state: 'adopted' }] });
    const { container } = await renderStop(0, fake);
    await screen.findByText('前');
    fireEvent.click(screen.getByRole('button', { name: '編集' }));
    const ta = within(container.querySelector('.fv-body .mbox.edit') as HTMLElement).getByLabelText('メモ');
    expect(ta).toHaveValue('前');
    fireEvent.change(ta, { target: { value: '後' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(saved(fake).map((c) => c.body)).toEqual(['後']));
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    await waitFor(() => expect(saved(fake)).toEqual([]));
  });

  it('書く枠の Esc は枠を閉じるだけで、コースは出ない', async () => {
    const { container } = await renderStop(0);
    clickPlus(screen.getByRole('button', { name: '13 行目にメモ' }));
    const ta = within(container.querySelector('.fv-body .mbox.edit') as HTMLElement).getByLabelText('メモ');
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(container.querySelector('.fv-body .mbox.edit')).toBeNull();
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('domain.Order');
  });

  it('日本語の変換中の Esc と ⌘⏎ では、書く枠を閉じず保存もしない。書きかけも残る', async () => {
    const { container, fake } = await renderStop(0);
    clickPlus(screen.getByRole('button', { name: '13 行目にメモ' }));
    const ta = within(container.querySelector('.fv-body .mbox.edit') as HTMLElement).getByLabelText('メモ');
    fireEvent.change(ta, { target: { value: '割引の' } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Escape', isComposing: true });
      fireEvent.keyDown(ta, { key: 'Enter', metaKey: true, isComposing: true });
    });
    expect(container.querySelector('.fv-body .mbox.edit textarea')).toHaveValue('割引の');
    expect(saved(fake)).toEqual([]);
  });

  it('左右表示: 消した行の「+」は左の行番号、他は右。メモはその行の側の列の下。統合に切り替えても選んだ行と書きかけは残る', async () => {
    const fake = fakeApi();
    fake.states.set(`local/${a.pr.headSha}`, { viewed: [], comments: [{ id: 'm1', path: ORDER, line: 13, side: 'RIGHT', body: '引いた後？', source: 'reviewer', state: 'adopted' }] });
    const { container } = await renderStop(0, fake);
    expect((await screen.findByText('引いた後？')).closest('.mhalf.r')).not.toBeNull();
    // 変わらない行の左の写しには「+」を出さない
    expect(screen.getAllByRole('button', { name: '4 行目にメモ' })).toHaveLength(1);
    clickPlus(screen.getByRole('button', { name: 'base 8 行目にメモ' }));
    const left = container.querySelector('.fv-body .mrow-memo .mhalf.l') as HTMLElement;
    fireEvent.change(within(left).getByLabelText('メモ'), { target: { value: 'getDiscount を呼ぶ所は？' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '統合' }));
    });
    expect(container.querySelector('.fv-body.uni')).not.toBeNull();
    expect(within(container.querySelector('.fv-body .mbox.edit') as HTMLElement).getByLabelText('メモ')).toHaveValue('getDiscount を呼ぶ所は？');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '左右' }));
    });
    const ta = within(container.querySelector('.fv-body .mrow-memo .mhalf.l') as HTMLElement).getByLabelText('メモ');
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    });
    await waitFor(() => expect(saved(fake)).toEqual([expect.objectContaining({ id: 'm1' }), expect.objectContaining({ id: 'm2', path: ORDER, line: 8, side: 'LEFT', body: 'getDiscount を呼ぶ所は？' })]));
    expect(container.querySelector('.fv-body .mhalf.l')!.textContent).toContain('getDiscount を呼ぶ所は？');
  });

  // 2026-10-11: 差分の無い場所は停留所でなく引き出しで見る。2026-10-22: そこの行は GitHub の差分に出ないので、メモは書けず聞くだけ
  it('差分の無い相手の引き出し（DiscountPolicy.rateFor）の行は「?」。押すと聞く枠で、メモの欄は無い', async () => {
    const { container, fake } = await renderStop(0);
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('domain.Order');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'r' });
    });
    const d = screen.getByRole('complementary', { name: '差分のない相手' });
    expect(d.querySelector('.rlist [aria-current="true"]')!.textContent).toBe('DiscountPolicy.rateFor');
    expect(within(d).queryByRole('button', { name: '10 行目にメモ' })).toBeNull();
    clickPlus(within(d).getByRole('button', { name: '10 行目について聞く' }));
    const box = d.querySelector('.fv-body .mbox.edit') as HTMLElement;
    expect(box.querySelector('.mh')!.textContent).toBe('聞くDiscountPolicy.kt 10 行目');
    expect(within(box).queryByLabelText('メモ')).toBeNull();
    expect(box.querySelector('.mnote')!.textContent).toBe('この行は GitHub の差分に出ないので、メモは書けません。案内人に聞くことはできます');
    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: /やめる/ }));
    });
    expect(d.querySelector('.fv-body .mbox.edit')).toBeNull();
    expect(saved(fake)).toEqual([]);
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('domain.Order');
  });

  const mixed = (): ReviewState => ({
    viewed: [],
    comments: [
      { id: 'm1', path: ORDER, startLine: 8, startSide: 'RIGHT', line: 11, side: 'RIGHT', body: '上書きになる？', source: 'reviewer', state: 'adopted' },
      { id: 'm2', path: POLICY, line: 10, side: 'RIGHT', body: '黙って 0？', source: 'reviewer', state: 'adopted' },
      { id: 'c1', path: ORDER, line: 3, side: 'RIGHT', body: 'AI の一つ目', source: 'claude-code', state: 'adopted' },
      { id: 'c2', path: ORDER, line: 4, side: 'RIGHT', body: 'AI の二つ目', source: 'claude-code', state: 'draft' },
    ],
  });

  it('締め: 右の列は「自分のメモ」と「AI の下書き」の 2 箱。送るボタンは 1 つで、3 つ目の数は「送るコメント」', async () => {
    const fake = fakeApi(fixtureAnalysis(), { key: '42' });
    fake.states.set(`42/${a.pr.headSha}`, mixed());
    const { container } = await renderClosing(fake.api);
    const memos = container.querySelector('.box.memos')!;
    expect(memos.querySelector('h3')!.textContent).toContain('自分のメモ');
    expect([...memos.querySelectorAll('.cm p')].map((p) => p.textContent)).toEqual(['上書きになる？', '黙って 0？']);
    expect(container.querySelector('.box.drafts h3')!.textContent).toContain('AI の下書き');
    expect([...container.querySelectorAll('.box.drafts .cm p')].map((p) => p.textContent)).toEqual(['AI の一つ目', 'AI の二つ目']);
    expect([...container.querySelectorAll('.closing .stat span')].map((x) => x.textContent)[2]).toBe('送るコメント');
    const btn = screen.getByRole('button', { name: 'GitHub にコメントを送る（メモ 1 · 下書き 1）' });
    fireEvent.click(btn);
    await waitFor(() => expect(fake.states.get(`42/${a.pr.headSha}`)!.comments.map((c) => c.state)).toEqual(['sent', 'adopted', 'sent', 'draft']));
    expect(memos.querySelectorAll('.cm')[0]!.querySelector('.chip.h')!.textContent).toBe('送信済み');
    expect(within(memos.querySelectorAll('.cm')[0] as HTMLElement).queryByRole('button', { name: '削除' })).toBeNull();
  });

  // 2026-10-22: GitHub の差分に出ない行のメモ・下書き（この日より前に書いた物と、新しい版で差分から外れた物）は消さずに残し、送らない
  it('締め: GitHub の差分に出ない行のメモ・採用した下書きには「GitHub に送れません」。送る数に入れず、ボタンの下にその数', async () => {
    const fake = fakeApi(fixtureAnalysis(), { key: '42' });
    const offDraft = { id: 'c3', path: POLICY, line: 12, side: 'RIGHT' as const, body: 'AI の塊の外', source: 'claude-code', state: 'adopted' as const };
    fake.states.set(`42/${a.pr.headSha}`, { ...mixed(), comments: [...mixed().comments, offDraft] });
    const { container } = await renderClosing(fake.api);
    const chips = (box: string) => [...container.querySelectorAll(`.box.${box} .cm`)].map((cm) => cm.querySelector('.chip.off')?.textContent ?? '');
    expect(chips('memos')).toEqual(['', 'GitHub に送れません']);
    expect(chips('drafts')).toEqual(['', '', 'GitHub に送れません']);
    expect(container.querySelector('.box.memos .chip.off')).toHaveAttribute('title', 'GitHub の差分に出ない行です。GitHub はこの行にコメントを付けられないので、送りません');
    expect([...container.querySelectorAll('.closing .stat b')].map((b) => b.textContent)[2]).toBe('2');
    expect(screen.getByRole('button', { name: 'GitHub にコメントを送る（メモ 1 · 下書き 1）' })).toBeEnabled();
    expect(screen.getByText('GitHub の差分に出ない行のメモ・下書き 2 件は送りません。GitHub はこの行にコメントを付けられません')).toBeInTheDocument();
  });

  it('締め: 採用が GitHub の差分に出ない行だけなら、送るボタンは押せない', async () => {
    const fake = fakeApi(fixtureAnalysis(), { key: '42' });
    fake.states.set(`42/${a.pr.headSha}`, { viewed: [], comments: [mixed().comments[1]!] });
    await renderClosing(fake.api);
    expect(screen.getByRole('button', { name: '送るコメントはまだありません' })).toBeDisabled();
    expect(screen.getByText('GitHub の差分に出ない行のメモ・下書き 1 件は送りません。GitHub はこの行にコメントを付けられません')).toBeInTheDocument();
  });

  it('タブに戻ると state を読み直し、外から足した AI の下書きが締めに並ぶ（ondina comments add。12 章）', async () => {
    const fake = fakeApi();
    const { container } = await renderClosing(fake.api);
    expect(container.querySelectorAll('.box.drafts .cm')).toHaveLength(0);
    // 画面を開いたまま、エージェントが下書きを入れた
    fake.states.set(`local/${a.pr.headSha}`, { ...emptyReview(), comments: [{ id: 'x1', path: ORDER, line: 3, side: 'RIGHT', body: '[must] 外から', source: 'codex', state: 'draft' }] });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect([...container.querySelectorAll('.box.drafts .cm p')].map((p) => p.textContent)).toEqual(['[must] 外から']));
  });

  it('タブに戻ると解析の一覧も読み直し、開いている間にターミナルで解析したものが左上の一覧に出る', async () => {
    const fake = fakeApi();
    render(<App api={fake.api} />);
    await ready();
    expect(screen.queryByLabelText('解析を切り替える')).toBeNull();
    // 画面を開いたまま、ターミナルの ondina analyze が新しい解析を書いた
    const NEW = 'e'.repeat(40);
    fake.addVersion({ ...a, pr: { ...a.pr, headSha: NEW } });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect([...screen.getByLabelText('解析を切り替える').querySelectorAll('option')].map((o) => o.value)).toEqual([`local/${NEW}`, `local/${a.pr.headSha}`]));
    // 開いている解析はそのまま
    expect(screen.getByLabelText('解析を切り替える')).toHaveValue(`local/${a.pr.headSha}`);
  });

  it('締めのメモは「直す」でその場で書き換え、「消す」で取り除ける', async () => {
    const fake = fakeApi();
    fake.states.set(`local/${a.pr.headSha}`, mixed());
    const { container } = await renderClosing(fake.api);
    const memos = container.querySelector('.box.memos') as HTMLElement;
    fireEvent.click(within(memos).getAllByRole('button', { name: '編集' })[0]!);
    const ta = within(memos).getByLabelText('メモ');
    fireEvent.change(ta, { target: { value: '書き換えた' } });
    fireEvent.click(within(memos).getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(fake.states.get(`local/${a.pr.headSha}`)!.comments[0]!.body).toBe('書き換えた'));
    fireEvent.click(within(memos).getAllByRole('button', { name: '削除' })[1]!);
    await waitFor(() => expect(fake.states.get(`local/${a.pr.headSha}`)!.comments.map((c) => c.id)).toEqual(['m1', 'c1', 'c2']));
  });

  it('締めのメモの「開く」: 差分一覧に出る行は差分一覧のその hunk（メモも見える）、差分の無い場所は差分の無い相手の引き出し', async () => {
    const fake = fakeApi();
    fake.states.set(`local/${a.pr.headSha}`, mixed());
    const { container } = await renderClosing(fake.api);
    fireEvent.click(within(container.querySelectorAll('.box.memos .cm')[1] as HTMLElement).getByRole('button', { name: '開く' }));
    const d = screen.getByRole('complementary', { name: '差分のない相手' });
    expect(d.querySelector('.rlist [aria-current="true"]')!.textContent).toBe('DiscountPolicy.rateFor');
    expect(d.querySelector('.fv-body .mbox')!.textContent).toContain('黙って 0？');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await press('締め');
    fireEvent.click(within(container.querySelectorAll('.box.memos .cm')[0] as HTMLElement).getByRole('button', { name: '開く' }));
    const order = a.hunks.find((h) => h.path === ORDER)!;
    await waitFor(() => expect(container.querySelector(`#hunk-${order.id}.on`)).not.toBeNull());
    expect([...container.querySelectorAll('.dmemo .mhalf.r')].some((x) => x.textContent!.includes('上書きになる？'))).toBe(true);
  });

  it('「開く」で差分の無い相手の引き出しを開いたときも、そのメモの行までスクロールする（ファイル全体を出している）', async () => {
    const fake = fakeApi();
    // DiscountPolicy.kt の 2 行目は rateFor の宣言（9 行目）から離れている
    fake.states.set(`local/${a.pr.headSha}`, { viewed: [], comments: [{ id: 'm1', path: POLICY, line: 2, side: 'RIGHT', body: '遠い行', source: 'reviewer', state: 'adopted' }] });
    const { container } = await renderClosing(fake.api);
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      fireEvent.click(within(container.querySelector('.box.memos .cm') as HTMLElement).getByRole('button', { name: '開く' }));
      expect(screen.getByRole('complementary', { name: '差分のない相手' }).querySelector('.rlist [aria-current="true"]')!.textContent).toBe('DiscountPolicy.rateFor');
      // コードの枠はメモの行へ（一覧の枠は選んだ名前へ。別の枠なので両方効く）
      expect(scrolled.some((e) => e.getAttribute('data-memo') === 'm1')).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('差分一覧でも書ける: 左右表示で消した行の「+」→ 書いて ⌘⏎ → 左の列の下に残る。統合に切り替えても同じ行の下にある', async () => {
    const fake = fakeApi();
    const { container } = await renderDiffList(fake.api);
    fireEvent.click(screen.getByRole('button', { name: /^Order\.kt/ }));
    clickPlus(await plusIn(container, a.hunks.find((h) => h.path === ORDER)!.id, 'base 8 行目にメモ'));
    const ta = within(container.querySelector('.dmemo .mhalf.l') as HTMLElement).getByLabelText('メモ');
    fireEvent.change(ta, { target: { value: 'getDiscount を呼ぶ所は残っていない？' } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    });
    await waitFor(() => expect(saved(fake)).toEqual([expect.objectContaining({ id: 'm1', path: ORDER, line: 8, side: 'LEFT' })]));
    expect(container.querySelector('.dmemo .mhalf.l')!.textContent).toContain('getDiscount を呼ぶ所は残っていない？');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '統合' }));
    });
    expect(container.querySelector('.dmemo.uni')!.textContent).toContain('getDiscount を呼ぶ所は残っていない？');
  });

  it('コースの印: 上の丸の右肩と左のファイルの行に「メモ n」。総括に数・行の「メモ n」・「このコースのメモ」（「開く」でその停留所へ）', async () => {
    const fake = fakeApi();
    fake.states.set(`local/${a.pr.headSha}`, mixed());
    const r = render(<App api={fake.api} />);
    await ready();
    fireEvent.click(r.container.querySelectorAll('.ccard .pick')[2]!);
    fireEvent.click(r.container.querySelector('.ccard.sel .go')!);
    // 読む前の案内（2026-10-22）から 1 か所目へ
    fireEvent.click(r.container.querySelector('.brief .bgo .btn')!);
    // コース 3: 1 か所目（domain.Order）に m1。差分の無い DiscountPolicy.kt の m2 はどの停留所にも数えない（2026-10-11）。AI の下書きはメモの数に入れない（別の印。下の AI の下書きの describe）
    expect([...r.container.querySelectorAll('.cbar .crumbs button')].map((b) => b.querySelector('.mn')?.textContent ?? '')).toEqual(['1', '', '', '']);
    // 左はファイルの行（OrderAdminView.kt / Order.kt / OrderTest.kt）。そのファイルの読む場所のメモの合計
    expect([...r.container.querySelectorAll('.stop .lt .tree .file:not(.oth)')].map((b) => b.querySelector('.chip.mc')?.textContent ?? '')).toEqual(['', 'メモ 1', '']);
    // 問題なし · 次へ（Enter）で 4 か所目まで
    for (let k = 0; k < 3; k++) {
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Enter' });
      });
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /問題なし · 総括へ/ }));
    });
    expect(screen.getByText('総括')).toBeInTheDocument();
    const tile = [...r.container.querySelectorAll('.stat div')].find((d) => d.textContent?.includes('メモ'))!;
    expect(tile.querySelector('b')!.textContent).toBe('1');
    expect([...r.container.querySelectorAll('.sum .row3.wm')].map((x) => x.querySelector('.chip.mc')?.textContent ?? '')).toEqual(['メモ 1', '', '', '']);
    const list = r.container.querySelector('.box.cmemos') as HTMLElement;
    expect([...list.querySelectorAll('.cm p')].map((x) => x.textContent)).toEqual(['上書きになる？']);
    fireEvent.click(within(list.querySelectorAll('.cm')[0] as HTMLElement).getByRole('button', { name: '開く' }));
    expect(r.container.querySelector('.code .chd .sym')!.textContent).toBe('domain.Order');
  });

  it('GitHub の差分の範囲が無い古い解析（PR）では、締めに注記を出す', async () => {
    const old = fixtureAnalysis();
    delete old.githubDiff;
    const fake = fakeApi(old, { key: '42' });
    fake.states.set(`42/${a.pr.headSha}`, mixed());
    await renderClosing(fake.api);
    expect(screen.getByText('この解析には GitHub の差分の範囲がありません。analyze を実行し直すと、GitHub の差分に出ない行を見分けられます')).toBeInTheDocument();
  });

  // AI の下書きを行の下に出す（2026-10-13。見本を比べて「開いた箱」と「メモと分けて数える」にした）
  describe('AI の下書き', () => {
    const TEST = 'src/test/kotlin/com/example/order/domain/OrderTest.kt';
    const CTRL = 'src/main/kotlin/com/example/order/api/OrderController.kt';
    const withState = (comments: ReviewState['comments']) => {
      const fake = fakeApi();
      fake.states.set(`local/${a.pr.headSha}`, { viewed: [], comments });
      return fake;
    };
    const aiBox = (container: HTMLElement, body: string) => [...container.querySelectorAll('.mbox.ai')].find((b) => b.textContent!.includes(body)) as HTMLElement;

    it('コースの停留所: その行の下に点線の箱（見出しに出所と行）。採用で緑になり締めの数に入る、戻すで元に、破棄で 1 行にたたむ', async () => {
      const { container, fake } = await renderStop(0, withState(mixed().comments));
      expect(container.querySelectorAll('.fv-body .mbox.ai')).toHaveLength(2);
      const box = aiBox(container, 'AI の二つ目');
      expect(box.querySelector('.mh')!.textContent).toContain('AI の下書き');
      expect(box.querySelector('.mh')!.textContent).toContain('claude-code');
      expect(box.querySelector('.mh')!.textContent).toContain('Order.kt 4 行目');
      // 箱は 4 行目（head 側）の行のすぐ後ろ、右の列の下
      const row = box.closest('.mrow-memo')!.previousElementSibling!;
      expect([...row.querySelectorAll('.ln')].map((x) => x.textContent).join('|')).toContain('4');
      expect(box.closest('.mhalf.r')).not.toBeNull();
      expect(aiBox(container, 'AI の一つ目').classList.contains('ad')).toBe(true);
      fireEvent.click(within(box).getByRole('button', { name: '採用' }));
      await waitFor(() => expect(saved(fake).find((c) => c.id === 'c2')!.state).toBe('adopted'));
      expect(aiBox(container, 'AI の二つ目').classList.contains('ad')).toBe(true);
      fireEvent.click(within(aiBox(container, 'AI の二つ目')).getByRole('button', { name: '戻す' }));
      fireEvent.click(within(aiBox(container, 'AI の二つ目')).getByRole('button', { name: '破棄' }));
      await waitFor(() => expect(saved(fake).find((c) => c.id === 'c2')!.state).toBe('discarded'));
      expect(aiBox(container, 'AI の二つ目')).toBeUndefined();
      const gone = container.querySelector('.fv-body .aigone') as HTMLElement;
      expect(gone.textContent).toContain('破棄した AI の下書き');
      fireEvent.click(within(gone).getByRole('button', { name: '戻す' }));
      await waitFor(() => expect(saved(fake).find((c) => c.id === 'c2')!.state).toBe('draft'));
    });

    it('編集の途中の文は、停留所の箱と締めの箱で同じ（画面を移っても消えない）。締めで「この文で採用」', async () => {
      const { container, fake } = await renderStop(0, withState(mixed().comments));
      fireEvent.click(within(aiBox(container, 'AI の二つ目')).getByRole('button', { name: '編集' }));
      fireEvent.change(within(container.querySelector('.fv-body .mbox.ai textarea')!.parentElement as HTMLElement).getByLabelText('コメント本文'), { target: { value: '直した二つ目' } });
      await press('締め');
      const ta = within(container.querySelector('.box.drafts') as HTMLElement).getByLabelText('コメント本文') as HTMLTextAreaElement;
      expect(ta.value).toBe('直した二つ目');
      fireEvent.click(within(container.querySelector('.box.drafts') as HTMLElement).getByRole('button', { name: 'この文で採用' }));
      await waitFor(() => expect(saved(fake).find((c) => c.id === 'c2')).toMatchObject({ state: 'adopted', body: '直した二つ目' }));
    });

    it('差分一覧: 左右でも統合でも、その行の下に箱。差分一覧に出ない行の下書きはヘッダに「差分の外の下書き n」', async () => {
      const fake = withState([...mixed().comments, { id: 'c3', path: CTRL, line: 2, side: 'RIGHT', body: 'AI の三つ目', source: 'codex', state: 'draft' }]);
      const { container } = await renderDiffList(fake.api);
      fireEvent.click(screen.getByRole('button', { name: /^Order\.kt/ }));
      await waitFor(() => expect([...container.querySelectorAll('.dmemo.sbs .mhalf.r .mbox.ai p')].map((p) => p.textContent)).toEqual(['AI の一つ目', 'AI の二つ目']));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '統合' }));
      });
      expect([...container.querySelectorAll('.dmemo.uni .mbox.ai p')].map((p) => p.textContent)).toEqual(['AI の一つ目', 'AI の二つ目']);
      expect(screen.queryByRole('button', { name: /差分の外の下書き/ })).toBeNull();
      // 差分一覧に出ない行の下書きは、そのファイルの見出しに出る
      fireEvent.click(screen.getByRole('button', { name: /^OrderController\.kt/ }));
      expect(await screen.findByRole('button', { name: '差分の外の下書き 1' })).toBeInTheDocument();
    });

    it('畳んだ行の中の下書きは、畳みの帯に「下書き n」', async () => {
      // OrderTest.kt の 2 行目は、どの停留所の前後 3 行にも入らない
      const { container } = await renderStop(2, withState([{ id: 'c1', path: TEST, line: 2, side: 'RIGHT', body: '遠い下書き', source: 'codex', state: 'draft' }]));
      expect(container.querySelector('.fv-body .fold')!.textContent).toContain('下書き 1');
    });

    it('締めの「開く」: 差分の無いファイルの下書きは、差分の無い相手の引き出しでその行まで', async () => {
      const fake = withState([{ id: 'c1', path: POLICY, line: 2, side: 'RIGHT', body: '遠い下書き', source: 'codex', state: 'draft' }]);
      const { container } = await renderClosing(fake.api);
      const scrolled: Element[] = [];
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this);
      };
      try {
        fireEvent.click(within(container.querySelector('.box.drafts .cm') as HTMLElement).getByRole('button', { name: '開く' }));
        const d = screen.getByRole('complementary', { name: '差分のない相手' });
        expect(d.querySelector('.fv-body .mbox.ai')!.textContent).toContain('遠い下書き');
        expect(scrolled.some((e) => e.getAttribute('data-memo') === 'c1')).toBe(true);
      } finally {
        Element.prototype.scrollIntoView = original;
      }
    });

    it('コースの印: まだ決めていない下書きを、上の丸の左肩・左のファイルの行の「AI n」・総括の数と行の「AI n」に。総括に「このコースの AI の下書き」。採用すると数が消える', async () => {
      const { container, fake } = await renderStop(0, withState(mixed().comments));
      // c1 は採用済みで数えない。c2 だけ
      const an = () => [...container.querySelectorAll('.cbar .crumbs button')].map((b) => b.querySelector('.an')?.textContent ?? '');
      const itin = () => [...container.querySelectorAll('.stop .lt .tree .file:not(.oth)')].map((b) => b.querySelector('.chip.ai')?.textContent ?? '');
      expect(an()).toEqual(['1', '', '', '']);
      expect(itin()).toEqual(['', 'AI 1', '']);
      expect(container.querySelector('.cbar .crumbs button')!.getAttribute('title')).toContain('AI の下書き 1');
      for (let k = 0; k < 3; k++) {
        await act(async () => {
          fireEvent.keyDown(window, { key: 'Enter' });
        });
      }
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /問題なし · 総括へ/ }));
      });
      const tile = [...container.querySelectorAll('.stat div')].find((d) => d.textContent?.includes('AI の下書き'))!;
      expect(tile.querySelector('b')!.textContent).toBe('1');
      expect([...container.querySelectorAll('.sum .row3.wm')].map((x) => x.querySelector('.chip.ai')?.textContent ?? '')).toEqual(['AI 1', '', '', '']);
      const list = container.querySelector('.box.cdrafts') as HTMLElement;
      expect(list.querySelector('h3')!.textContent).toContain('このコースの AI の下書き');
      expect(list.querySelector('h3 .chip')!.textContent).toBe('1 / 2');
      expect([...list.querySelectorAll('.cm p')].map((x) => x.textContent)).toEqual(['AI の一つ目', 'AI の二つ目']);
      expect(list.querySelectorAll('.cm')[0]!.querySelector('.chip.ok')!.textContent).toBe('採用');
      fireEvent.click(within(list.querySelectorAll('.cm')[1] as HTMLElement).getByRole('button', { name: '開く' }));
      expect(container.querySelector('.code .chd .sym')!.textContent).toBe('domain.Order');
      fireEvent.click(within(aiBox(container, 'AI の二つ目')).getByRole('button', { name: '採用' }));
      await waitFor(() => expect(saved(fake).find((c) => c.id === 'c2')!.state).toBe('adopted'));
      expect(an()).toEqual(['', '', '', '']);
      expect(itin()).toEqual(['', '', '']);
    });

    it('コースに下書きが無ければ、総括の数は「—」で、一覧の箱は出さない', async () => {
      const { container } = await renderStop(0);
      for (let k = 0; k < 3; k++) {
        await act(async () => {
          fireEvent.keyDown(window, { key: 'Enter' });
        });
      }
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /問題なし · 総括へ/ }));
      });
      const tile = [...container.querySelectorAll('.stat div')].find((d) => d.textContent?.includes('AI の下書き'))!;
      expect(tile.querySelector('b')!.textContent).toBe('—');
      expect(container.querySelector('.box.cdrafts')).toBeNull();
    });
  });
});

describe('App（案内人に聞く。3.10）', () => {
  const a = fixtureAnalysis();
  const drawer = () => screen.getByRole('complementary', { name: '案内人に聞く' });
  /** 停留所の画面の右の列（水先案内と質問。2026-10-20） */
  const col = () => screen.getByRole('complementary', { name: '水先案内' });
  const key = async (k: string, extra: Record<string, unknown> = {}) => {
    await act(async () => {
      fireEvent.keyDown(window, { key: k, ...extra });
    });
  };

  async function renderHome(fake = fakeApi()) {
    const r = render(<App api={fake.api} />);
    await ready();
    return { ...r, fake };
  }

  /** コース 3 の 1 か所目（domain.Order）の停留所の画面 */
  async function renderOrder(fake = fakeApi()) {
    const r = await renderHome(fake);
    fireEvent.click(r.container.querySelectorAll('.ccard .pick')[2]!);
    fireEvent.click(r.container.querySelector('.ccard.sel .go')!);
    // 読む前の案内（2026-10-22）から 1 か所目へ
    fireEvent.click(r.container.querySelector('.brief .bgo .btn')!);
    return r;
  }

  it('入口の「聞く」で引き出しを開く: 何について = PR 全体、決まった形の候補（自動）。Q でも開き閉じ、Esc で閉じる', async () => {
    const { container } = await renderHome();
    await press(/^聞く/);
    // 引き出しは画面に重ねず、画面をその分だけ左に寄せる（右端のボタンと差分の右の列を隠さない。見本の形）
    expect(container.querySelector('.app')!.classList.contains('asking')).toBe(true);
    const d = drawer();
    expect(within(d).getByText('PR 全体')).toBeInTheDocument();
    expect(within(d).getByText('自動')).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'コースに入っていない 3 か所は何？' })).toBeInTheDocument();
    await key('q');
    expect(screen.queryByRole('complementary', { name: '案内人に聞く' })).toBeNull();
    await key('q');
    expect(drawer()).toBeInTheDocument();
    await key('Escape');
    expect(screen.queryByRole('complementary', { name: '案内人に聞く' })).toBeNull();
    // 入口は出ない（Esc は引き出しだけ閉じる）
    expect(screen.getByLabelText('入口')).toBeInTheDocument();
  });

  it('引き出しの入力欄で日本語の変換中の Esc と ⌘⏎ では、引き出しを閉じず送りもしない。変換していない Esc で閉じる', async () => {
    const { fake } = await renderHome();
    await key('q');
    const ta = within(drawer()).getByLabelText('質問');
    fireEvent.change(ta, { target: { value: '割引は' } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Escape', isComposing: true });
      fireEvent.keyDown(ta, { key: 'Enter', metaKey: true, isComposing: true });
    });
    expect(drawer()).toBeInTheDocument();
    expect(fake.asked).toEqual([]);
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(screen.queryByRole('complementary', { name: '案内人に聞く' })).toBeNull();
  });

  it('候補を押すと送り、答えを AI の吹き出しで出す: 1 文 1 行、行の場所の青い下線、場所を確かめられない印', async () => {
    const { fake } = await renderHome();
    await press(/^聞く/);
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: '振る舞いが変わる所は？' }));
    });
    expect(fake.asked.map((x) => [x.key, x.place, x.question])).toEqual([['pr', { kind: 'pr' }, '振る舞いが変わる所は？']]);
    const answer = await within(drawer()).findByText('答え: 振る舞いが変わる所は？。');
    const bubble = answer.closest('.aa')!;
    expect(bubble.querySelector('.chip')!.textContent).toBe('AI');
    expect(within(bubble as HTMLElement).getByText('2 文目。')).toBeInTheDocument();
    expect(within(bubble as HTMLElement).getByRole('button', { name: 'Order.kt 13' })).toBeInTheDocument();
    expect(within(bubble as HTMLElement).getByText('場所を確かめられません')).toBeInTheDocument();
    // 会話が始まったら候補は出さない
    expect(within(drawer()).queryByText('よく聞くこと')).toBeNull();
  });

  it('行の場所を押すと、その行が見える所（入口からは差分一覧のその hunk）へ移り、その行を光らせる。引き出しは開いたまま', async () => {
    const { container } = await renderHome();
    await press(/^聞く/);
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: '振る舞いが変わる所は？' }));
    });
    await act(async () => {
      fireEvent.click(await within(drawer()).findByRole('button', { name: 'Order.kt 13' }));
    });
    await waitFor(() => expect(stuckPath(container)).toContain('Order.kt'));
    await waitFor(() => expect(container.querySelector('.dpane .lflash')).not.toBeNull());
    expect(within(drawer()).getByText('PR 全体')).toBeInTheDocument();
  });

  // 2026-10-20: 動く見本を比べて案 2（水先案内も会話の最初の発言）にした
  it('停留所の画面: 右の列が水先案内と質問の欄（引き出しは出ない。コードの見出しに「聞く」は無い）。何について = その停留所。入力欄に書いて ⌘⏎ で送る', async () => {
    const { fake, container } = await renderOrder();
    expect(screen.queryByRole('complementary', { name: '案内人に聞く' })).toBeNull();
    expect(container.querySelector('.app')!.classList.contains('asking')).toBe(false);
    expect(within(container.querySelector('.code .chd') as HTMLElement).queryByRole('button', { name: /^聞く/ })).toBeNull();
    // 最初の発言が水先案内（名前・この場所・確かめること）。その下に会話。「問題なし · 次へ」は入力欄のすぐ上
    const thread = col().querySelector('.thread')!;
    expect(thread.firstElementChild!.classList.contains('gmsg')).toBe(true);
    expect(within(thread as HTMLElement).getByRole('heading', { name: 'domain.Order' })).toBeInTheDocument();
    expect(thread.querySelector('.gmsg .sn .narr')!.textContent).toContain(a.tours.find((t) => t.howId === 3)!.steps[0]!.role!);
    expect(within(col()).getByRole('button', { name: /問題なし · 次へ/ }).closest('.acts')!.nextElementSibling!.classList.contains('askin')).toBe(true);
    expect(within(col()).getByText('domain.Order（コース 3 の 1 か所目）')).toBeInTheDocument();
    expect(within(col()).getByRole('button', { name: '変更前はどう動いていた？' })).toBeInTheDocument();
    const ta = within(col()).getByLabelText('質問');
    fireEvent.change(ta, { target: { value: 'promo はどこへ行った？' } });
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    });
    expect(fake.asked.at(-1)).toMatchObject({ key: `symbol:${a.hunks.find((h) => h.symbolFqName === 'com.example.order.domain.Order')!.id}`, question: 'promo はどこへ行った？' });
    expect(await within(col()).findByText('答え: promo はどこへ行った？。')).toBeInTheDocument();
    // 行の場所（Order.kt 13）は今の停留所で見えるので、移らずにその行を光らせる
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: 'Order.kt 13' }));
    });
    expect(container.querySelector('.code .chd .sym')!.textContent).toBe('domain.Order');
    expect(container.querySelector('.fv-body .lflash')).not.toBeNull();
  });

  it('停留所の画面: 次の停留所へ移ると、何についてと会話が新しい停留所になる。Q で入力欄へ（たたんでいれば開く）、Esc で入力欄を離れる', async () => {
    const { container } = await renderOrder();
    await key('Enter');
    expect(within(col()).getByText('OrderAdminView.discountField（コース 3 の 2 か所目）')).toBeInTheDocument();
    await key('b');
    expect(container.querySelector('.stop.shut')).not.toBeNull();
    await key('q');
    expect(container.querySelector('.stop.shut')).toBeNull();
    const ta = within(col()).getByLabelText('質問');
    expect(document.activeElement).toBe(ta);
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Escape' });
    });
    expect(document.activeElement).not.toBe(ta);
    expect(container.querySelector('.view.course')).not.toBeNull();
  });

  it('停留所の画面の入力欄で日本語の変換をやめる Esc では、入力欄を離れない', async () => {
    await renderOrder();
    await key('q');
    const ta = within(col()).getByLabelText('質問');
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Escape', isComposing: true });
    });
    expect(document.activeElement).toBe(ta);
  });

  it('停留所の画面: 別の停留所の問いの答えが、見ていない間に届いたら、入力欄の上にその場所を出す。その停留所に戻ると消える', async () => {
    let release: (() => void) | null = null;
    const fake = fakeApi(undefined, {
      ask: (req) =>
        new Promise((resolve) => {
          release = () => resolve(askAnswer(req));
        }),
    });
    await renderOrder(fake);
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: '変更前はどう動いていた？' }));
    });
    await key('ArrowRight');
    await act(async () => {
      release!();
    });
    expect(within(col()).getByText('別の場所の問いの答えが届いています（domain.Order（コース 3 の 1 か所目））')).toBeInTheDocument();
    await key('ArrowLeft');
    expect(within(col()).queryByText(/別の場所の問いの答えが届いています/)).toBeNull();
    expect(within(col()).getByText('答え: 変更前はどう動いていた？。')).toBeInTheDocument();
  });

  it('停留所の画面: 会話が溢れたら右下に「一番上へ」「一番下へ」。押すと会話の一番上・一番下へ。端にいる側は押せない', async () => {
    await renderOrder();
    const thread = col().querySelector('.thread') as HTMLElement;
    expect(within(col()).queryByRole('button', { name: '一番上へ' })).toBeNull();
    // jsdom はレイアウトしないので、溢れている高さを与える
    Object.defineProperty(thread, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(thread, 'clientHeight', { configurable: true, value: 300 });
    act(() => {
      fireEvent.scroll(thread);
    });
    expect(within(col()).getByRole('button', { name: '一番上へ' })).toBeDisabled();
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: '一番下へ' }));
    });
    expect(thread.scrollTop).toBe(1000);
    expect(within(col()).getByRole('button', { name: '一番下へ' })).toBeDisabled();
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: '一番上へ' }));
    });
    expect(thread.scrollTop).toBe(0);
    expect(within(col()).getByRole('button', { name: '一番上へ' })).toBeDisabled();
  });

  it('総括の画面では今のまま、右の列の「聞く」で引き出しを開く（何について = コース）', async () => {
    const { container } = await renderOrder();
    fireEvent.click(container.querySelectorAll('.cbar .crumbs button')[3]!);
    await key('Enter');
    expect(screen.getByText('総括')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '水先案内' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: '案内人に聞く' })).toBeNull();
    await press(/^聞く/);
    expect(within(drawer()).getByText('コース 3 · Order に discount と applyDiscount を持たせる')).toBeInTheDocument();
  });

  it('待っている間は経過秒と「止める」。止めると問いを入力欄に戻し、閉じている間に答えが来たら「聞く」に印', async () => {
    let release: (() => void) | null = null;
    const fake = fakeApi(undefined, {
      ask: (req, signal) =>
        new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          release = () => resolve(askAnswer(req));
        }),
    });
    await renderHome(fake);
    await press(/^聞く/);
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: '振る舞いが変わる所は？' }));
    });
    expect(within(drawer()).getByText(/答えを待っています/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: '止める' }));
    });
    expect(fake.asked[0]!.signal.aborted).toBe(true);
    expect((within(drawer()).getByLabelText('質問') as HTMLTextAreaElement).value).toBe('振る舞いが変わる所は？');

    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: /^送る/ }));
    });
    await key('q');
    await act(async () => {
      release!();
    });
    expect(screen.getByRole('button', { name: /^聞く/ }).querySelector('.dot')).not.toBeNull();
    await press(/^聞く/);
    expect(within(drawer()).getByText('答え: 振る舞いが変わる所は？。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^聞く/ }).querySelector('.dot')).toBeNull();
  });

  it('失敗したら理由と「もう一度」「LLM コマンドを直す」（設定を開く）', async () => {
    let n = 0;
    const fake = fakeApi(undefined, {
      ask: (req) => {
        n++;
        if (n === 1) throw new Error('終了コード 2: boom');
        return askAnswer(req);
      },
    });
    await renderHome(fake);
    await press(/^聞く/);
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: '振る舞いが変わる所は？' }));
    });
    expect(await within(drawer()).findByText('理由: 終了コード 2: boom')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: 'もう一度' }));
    });
    expect(await within(drawer()).findByText('答え: 振る舞いが変わる所は？。')).toBeInTheDocument();
    expect(fake.asked).toHaveLength(2);
  });

  it('失敗の「LLM コマンドを直す」で設定のモーダルを開く', async () => {
    const fake = fakeApi(undefined, {
      ask: () => {
        throw new Error('終了コード 127: command not found');
      },
    });
    await renderHome(fake);
    await press(/^聞く/);
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: '振る舞いが変わる所は？' }));
    });
    await act(async () => {
      fireEvent.click(await within(drawer()).findByRole('button', { name: 'LLM コマンドを設定する' }));
    });
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
  });

  it('行で聞く: GitHub の差分に出ない 1 行目の「?」を押すと聞く枠。「聞く」で何について = その行。答えに「メモにする」は出ない', async () => {
    const { container } = await renderOrder();
    // Order.kt の GitHub の差分の塊は head 側 3〜14 行目。1 行目はファイル全体（F）で出る
    await key('f');
    expect(screen.getByRole('button', { name: '1 行目について聞く' })).toHaveTextContent('?');
    clickPlus(screen.getByRole('button', { name: '1 行目について聞く' }));
    const box = container.querySelector('.fv-body .mbox.edit') as HTMLElement;
    expect(within(box).queryByLabelText('メモ')).toBeNull();
    await act(async () => {
      fireEvent.click(within(box).getByRole('button', { name: '聞く' }));
    });
    expect(within(col()).getByText('Order.kt 1 行目（domain.Order）')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(col()).getAllByRole('button').find((b) => b.classList.contains('s'))!);
    });
    await within(col()).findByText(/^答え: /);
    expect(within(col()).queryByRole('button', { name: 'メモにする' })).toBeNull();
  });

  it('行で聞く: 「+」で 8〜11 行目を選ぶと書く枠に「聞く」。何について = その行。答えの「メモにする」で、その行の書く枠に質問の文だけが入る', async () => {
    const { container, fake } = await renderOrder();
    dragPlus(screen.getByRole('button', { name: '8 行目にメモ' }), screen.getByRole('button', { name: '11 行目にメモ' }));
    await act(async () => {
      fireEvent.click(within(container.querySelector('.fv-body .mbox.edit') as HTMLElement).getByRole('button', { name: '聞く' }));
    });
    expect(within(col()).getByText('Order.kt 8〜11 行目（domain.Order）')).toBeInTheDocument();
    expect(within(col()).getByLabelText('質問')).toHaveAttribute('placeholder', 'この行について聞く…');
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: '変更前はどう動いていた？' }));
    });
    const ORDER_ID = a.hunks.find((h) => h.symbolFqName === 'com.example.order.domain.Order')!.id;
    expect(fake.asked.at(-1)).toMatchObject({ key: `symbol:${ORDER_ID}#h8-h11`, place: { kind: 'symbol', lines: { start: { side: 'head', line: 8 }, end: { side: 'head', line: 11 } } } });
    await within(col()).findByText('答え: 変更前はどう動いていた？。');
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: 'メモにする' }));
    });
    const box = container.querySelector('.fv-body .mbox.edit') as HTMLElement;
    expect(box.textContent).toContain('Order.kt 8〜11 行目');
    expect(within(box).getByLabelText('メモ')).toHaveValue('変更前はどう動いていた？');
    expect(within(col()).getByText('8〜11 行目の書く枠に入れました')).toBeInTheDocument();
  });

  it('「× 場所全体にする」で行を外す。Q でも、選んでいる行について開く', async () => {
    const { container } = await renderOrder();
    clickPlus(screen.getByRole('button', { name: '13 行目にメモ' }));
    await key('q');
    expect(within(col()).getByText('Order.kt 13 行目（domain.Order）')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: '× 場所全体にする' }));
    });
    expect(within(col()).getByText('domain.Order（コース 3 の 1 か所目）')).toBeInTheDocument();
    expect(within(col()).queryByRole('button', { name: '× 場所全体にする' })).toBeNull();
    // 選んでいる行と書く枠はそのまま
    expect(container.querySelector('.fv-body .mbox.edit')).not.toBeNull();
  });

  it('場所全体について聞いた答えの「メモにする」: 行を選ぶ案内が出て、「+」で選んだ行の書く枠に質問の文が入る。「やめる」で案内を消す', async () => {
    const { container } = await renderOrder();
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: '変更前はどう動いていた？' }));
    });
    await within(col()).findByText('答え: 変更前はどう動いていた？。');
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: 'メモにする' }));
    });
    expect(within(col()).getByText('メモを付ける行を、行番号の「+」で選んでください。')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: 'やめる' }));
    });
    expect(within(col()).queryByText('メモを付ける行を、行番号の「+」で選んでください。')).toBeNull();
    await act(async () => {
      fireEvent.click(within(col()).getByRole('button', { name: 'メモにする' }));
    });
    clickPlus(screen.getByRole('button', { name: '13 行目にメモ' }));
    expect(within(container.querySelector('.fv-body .mbox.edit') as HTMLElement).getByLabelText('メモ')).toHaveValue('変更前はどう動いていた？');
    expect(within(col()).getByText('13 行目の書く枠に入れました')).toBeInTheDocument();
    expect(within(col()).queryByText('メモを付ける行を、行番号の「+」で選んでください。')).toBeNull();
  });

  it('PR 全体の答えには「メモにする」を出さない（メモは行に付く物）', async () => {
    await renderHome();
    await press(/^聞く/);
    await act(async () => {
      fireEvent.click(within(drawer()).getByRole('button', { name: '振る舞いが変わる所は？' }));
    });
    await within(drawer()).findByText('答え: 振る舞いが変わる所は？。');
    expect(within(drawer()).queryByRole('button', { name: 'メモにする' })).toBeNull();
  });

  it('ネットで調べた事実に [1] を付け、答えの下に「調べたページ」を別のタブで開くリンクで出す。出典の無い事実は「出典なし」', async () => {
    const ELVIS = 'https://kotlinlang.org/docs/null-safety.html#elvis-operator';
    const saved = askAnswer({ key: 'pr', place: { kind: 'pr' }, question: '?: って何？' });
    saved.answer = {
      lead: '?: はエルビス演算子。',
      items: [
        { text: '16 行目は null なら投げる', cite: { path: ORDER_KT, side: 'head', line: 13 } },
        { text: '左が null なら右を返す', web: { url: ELVIS, title: 'Null safety | Kotlin Documentation' } },
        { text: 'throw も式', web: { url: ELVIS, title: 'Null safety' } },
        { text: '名前は髪型から', known: true },
      ],
    };
    await renderHome(fakeApi(undefined, { askLog: [saved] }));
    await press(/^聞く/);
    const bubble = (await within(drawer()).findByText('?: はエルビス演算子。')).closest('.aa') as HTMLElement;
    const marks = within(bubble).getAllByRole('link', { name: '[1]' });
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveAttribute('href', ELVIS);
    const refs = within(bubble).getByRole('list', { name: '調べたページ' });
    expect(within(refs).getByText('Null safety | Kotlin Documentation')).toBeInTheDocument();
    const page = within(refs).getByRole('link', { name: /kotlinlang\.org/ });
    expect(page).toHaveAttribute('href', ELVIS);
    expect(page).toHaveAttribute('target', '_blank');
    expect(page).toHaveAttribute('rel', 'noreferrer');
    expect(within(bubble).getAllByText('出典なし')).toHaveLength(1);
    // 出典なしには、読めない URL を書いてページを外した事実も入る
    expect(within(bubble).getByText('出典なし')).toHaveAttribute('title', expect.stringContaining('読めない URL'));
    // 行の場所は今のまま
    expect(within(bubble).getByRole('button', { name: 'Order.kt 13' })).toBeInTheDocument();
  });

  it('会話が空のときの文: コードの外のことも聞ける', async () => {
    await renderHome();
    await press(/^聞く/);
    expect(within(drawer()).getByText(/コードの外のことも聞けます。/)).toBeInTheDocument();
  });

  it('保存した会話は読み直しても残る（同じ場所を開くと出る）', async () => {
    const saved = askAnswer({ key: 'pr', place: { kind: 'pr' }, question: '前に聞いたこと' });
    await renderHome(fakeApi(undefined, { askLog: [saved] }));
    await press(/^聞く/);
    expect(await within(drawer()).findByText('前に聞いたこと')).toBeInTheDocument();
  });
});

describe('App（解析し直す。3.0 の帯の下の 1 行）', () => {
  const NEW = 'f'.repeat(40);
  const strip = (name: string) => screen.findByRole(name === '解析できませんでした' ? 'alert' : 'status', name === '解析できませんでした' ? {} : { name }, { timeout: 3000 });

  it('新しいコミットを知らせ、解析し直し、できたら切り替えて、引き継いだ知らせを × で閉じる', async () => {
    const analysis = fixtureAnalysis();
    const OLD = analysis.pr.headSha;
    let latest: LatestHead = { headSha: NEW, newCommits: 2, analyzed: false };
    const fake = fakeApi(analysis, { key: '42', latest: () => latest });
    render(<App api={fake.api} />);
    await ready();
    await press(/^差分一覧/);
    expect(await strip('新しいコミット')).toHaveTextContent(`新しいコミットが 2 件あります（${OLD.slice(0, 7)} → fffffff）`);

    await press('解析し直す');
    expect(fake.started).toEqual([{ key: '42', from: OLD }]);
    act(() => fake.setJobs([{ status: 'running', key: '42', from: OLD, startedAt: Date.now(), line: '差分を切り出しています' }]));
    expect(await within(await strip('解析し直しています')).findByText('差分を切り出しています', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: '解析し直しています' })).toHaveTextContent('前のバージョンはこのまま使えます');

    // serve の解析が終わり、引き継いだ state を書いた新しいバージョンができる
    fake.addVersion({ ...analysis, pr: { ...analysis.pr, headSha: NEW } }, { viewed: [], comments: [], carried: { from: OLD, reset: ['a', 'b', 'c'], coursesReset: [3], left: ['m2'] } });
    latest = { headSha: NEW, newCommits: 2, analyzed: true, changed: 3 };
    act(() => fake.setJobs([{ status: 'done', key: '42', from: OLD, headSha: NEW }]));
    await waitFor(() => expect(screen.getByRole('status', { name: '新しいバージョン' })).toHaveTextContent('新しいバージョン fffffff の解析ができました。変わった差分は 3 か所です'), { timeout: 3000 });

    await press('切り替える');
    expect(await strip('切り替えました')).toHaveTextContent(
      '新しいバージョン fffffff に切り替えました。変わった差分 3 か所を未確認に戻しました（コース 3 も未完了に戻しました）。前のバージョンに残したメモが 1 件あります（左上で前のバージョンを選ぶと表示できます）。',
    );
    // 同じ PR の別のバージョンなので、差分一覧のまま
    expect(screen.getByRole('button', { name: /^差分一覧/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('解析を切り替える')).toHaveValue(`42/${NEW}`);

    await press('閉じる');
    expect(screen.queryByRole('status', { name: '切り替えました' })).toBeNull();
    await waitFor(() => expect(fake.states.get(`42/${NEW}`)?.carried?.dismissed).toBe(true));
  });

  it('解析し直しに失敗したら理由と「前のバージョンのまま使えます」、「もう一度」でまた頼む', async () => {
    const analysis = fixtureAnalysis();
    const OLD = analysis.pr.headSha;
    const fake = fakeApi(analysis, { key: '42', latest: () => ({ headSha: NEW, newCommits: 1, analyzed: false }) });
    render(<App api={fake.api} />);
    await ready();
    await strip('新しいコミット');
    await press('解析し直す');
    act(() => fake.setJobs([{ status: 'failed', key: '42', from: OLD, reason: 'gh pr view 42 に失敗しました: HTTP 401' }]));
    const alert = await strip('解析できませんでした');
    expect(alert).toHaveTextContent('解析できませんでした: gh pr view 42 に失敗しました: HTTP 401');
    expect(alert).toHaveTextContent('前のバージョンのまま使えます');
    await press('もう一度');
    expect(fake.started).toHaveLength(2);
  });

  it('別の PR を解析している間も［解析し直す］を押せて、押すと順番待ち（前に何件あるか）を出す', async () => {
    const fake = fakeApi(undefined, { key: '42', latest: () => ({ headSha: NEW, newCommits: 1, analyzed: false }) });
    fake.setJobs([{ status: 'running', key: '7', startedAt: Date.now() }]);
    render(<App api={fake.api} />);
    await ready();
    await strip('新しいコミット');
    await press('解析し直す');
    expect(await strip('順番待ち')).toHaveTextContent('PR #42 の解析は順番待ちです（前に 1 件）');
    expect(fake.started).toEqual([{ key: '42', from: fixtureAnalysis().pr.headSha }]);
  });

  it('今のバージョンが最新なら何も出さない', async () => {
    render(<App api={fakeApi(undefined, { key: '42' }).api} />);
    await ready();
    await act(async () => undefined);
    expect(screen.queryByRole('status', { name: '新しいコミット' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('App（GitHub の Viewed。12.1）', () => {
  const sha = fixtureAnalysis().pr.headSha;
  const ADMIN = 'src/main/kotlin/com/example/admin/OrderAdminView.kt';
  const METRICS = 'src/main/kotlin/com/example/analytics/OrderMetrics.kt';
  /** 差分一覧の行の印（まる・チェック）の名前 */
  const markOf = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll('.file')].find((f) => f.querySelector('.nm')!.textContent === name)!.querySelector('[role="img"]')!.getAttribute('aria-label');

  it('差分一覧の行の印: 問題なしはまる、GitHub の Viewed はチェック、両方はまるにチェック。ondina の問題なしは変えない', async () => {
    const analysis = fixtureAnalysis();
    const metrics = analysis.hunks.find((h) => h.path === METRICS)!.id;
    const fake = fakeApi(analysis, { key: '42', github: { viewed: [ADMIN, METRICS] } });
    fake.states.set(`42/${sha}`, { ...emptyReview(), viewed: [metrics] });
    const { container } = await renderDiffList(fake.api);
    await waitFor(() => expect(markOf(container, 'OrderAdminView.kt')).toBe('未確認 · GitHub で Viewed'));
    expect(markOf(container, 'OrderMetrics.kt')).toBe('問題なし 1 / 1 · GitHub で Viewed');
    expect(markOf(container, 'OrderAuditLog.kt')).toBe('未確認');
    expect(screen.getByText('問題なし 1 / 48')).toBeInTheDocument();
  });

  it('ファイルの最後の 1 か所を問題なしにすると GitHub に付け、行にチェックが出る。外すと GitHub も外す', async () => {
    const fake = fakeApi(fixtureAnalysis(), { key: '42' });
    const { container } = await renderDiffList(fake.api);
    fireEvent.click(await firstOk());
    await waitFor(() => expect(fake.github.sets).toEqual([{ mark: [ADMIN], unmark: [] }]));
    await waitFor(() => expect(markOf(container, 'OrderAdminView.kt')).toBe('問題なし 1 / 1 · GitHub で Viewed'));
    fireEvent.click(screen.getByRole('button', { name: '問題なし ✓' }));
    await waitFor(() => expect(fake.github.sets).toEqual([{ mark: [ADMIN], unmark: [] }, { mark: [], unmark: [ADMIN] }]));
    await waitFor(() => expect(markOf(container, 'OrderAdminView.kt')).toBe('未確認'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('local の解析では GitHub を読まず、付けにもいかない', async () => {
    const fake = fakeApi();
    const { container } = await renderDiffList(fake.api);
    fireEvent.click(await firstOk());
    await waitFor(() => expect(markOf(container, 'OrderAdminView.kt')).toBe('問題なし 1 / 1'));
    expect(fake.github.reads).toBe(0);
    expect(fake.github.sets).toEqual([]);
  });

  it('付けられなければ右下に通知（理由と再試行）。再試行が通ると、通ったことを通知する', async () => {
    let fail = true;
    const fake = fakeApi(fixtureAnalysis(), {
      key: '42',
      github: {
        set: () => {
          if (fail) throw new Error('gh api graphql に失敗しました: HTTP 401: Bad credentials');
        },
      },
    });
    const { container } = await renderDiffList(fake.api);
    fireEvent.click(await firstOk());
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('OrderAdminView.kt を GitHub で Viewed にできませんでした');
    expect(toast).toHaveTextContent('HTTP 401: Bad credentials');
    expect(markOf(container, 'OrderAdminView.kt')).toBe('問題なし 1 / 1');
    fail = false;
    fireEvent.click(within(toast).getByRole('button', { name: '再試行' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('OrderAdminView.kt を GitHub で Viewed にしました'));
    expect(fake.github.sets).toHaveLength(2);
    expect(markOf(container, 'OrderAdminView.kt')).toBe('問題なし 1 / 1 · GitHub で Viewed');
  });

  it('PR に解析より新しいコミットがあれば、その理由を出し、再試行は出さない', async () => {
    const fake = fakeApi(fixtureAnalysis(), {
      key: '42',
      github: {
        set: () => {
          throw new ConflictError('PR に解析より新しいコミットがあるため、GitHub の Viewed は変更しませんでした。analyze を実行し直してください');
        },
      },
    });
    await renderDiffList(fake.api);
    fireEvent.click(await firstOk());
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('新しいコミットがあるため');
    expect(within(toast).queryByRole('button', { name: '再試行' })).toBeNull();
  });

  it('開いたときに GitHub を読めなければ通知する', async () => {
    const fake = fakeApi(fixtureAnalysis(), {
      key: '42',
      github: {
        read: () => {
          throw new Error('gh api graphql に失敗しました: HTTP 502');
        },
      },
    });
    render(<App api={fake.api} />);
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('GitHub の Viewed を読み込めませんでした');
    expect(toast).toHaveTextContent('HTTP 502');
  });
});

describe('App（列の幅。3.3 / 3.4）', () => {
  /** 入口でコース 3（停留所 4 つ）を選んで入る */
  const enterCourse3 = (container: HTMLElement) => {
    fireEvent.click(container.querySelectorAll('.ccard .pick')[2]!);
    fireEvent.click(container.querySelector('.ccard.sel .go')!);
    // 読む前の案内（2026-10-22）から 1 か所目へ
    fireEvent.click(container.querySelector('.brief .bgo .btn')!);
  };
  const handles = () => screen.getAllByRole('separator', { name: /の幅を変更$/ });

  it('停留所の画面の左右の境目は、読み上げでどちらの列の境目か分かる名前を持つ', async () => {
    const { container } = render(<App api={fakeApi(fixtureAnalysis()).api} />);
    await ready();
    enterCourse3(container);
    expect(handles()).toHaveLength(2);
    expect(screen.getByRole('separator', { name: 'ファイルの列の幅を変更' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '水先案内の列の幅を変更' })).toBeInTheDocument();
  });

  it('保存した列の幅は停留所の画面と差分一覧の列の幅になり、窓の幅に合わせた上限を付けて描く。保存していない列は既定の幅のまま', async () => {
    const { container } = render(<App api={fakeApi(fixtureAnalysis(), { ui: { panes: { stopTree: 320, diffTree: 410 } } }).api} />);
    await ready();
    enterCourse3(container);
    const stop = container.querySelector<HTMLElement>('.stop')!;
    expect(stop.style.getPropertyValue('--lt-w')).toMatch(/^clamp\(\d+px, 320px, \d+vw\)$/);
    expect(stop.style.getPropertyValue('--say-w')).toBe('');
    await press(/^差分一覧/);
    expect(container.querySelector<HTMLElement>('.vd')!.style.getPropertyValue('--tree-w')).toMatch(/^clamp\(\d+px, 410px, \d+vw\)$/);
  });

  it('差分一覧のファイル列の境目をダブルクリックすると、その列だけ既定の幅に戻り ui.json からも消える', async () => {
    const fake = fakeApi(fixtureAnalysis(), { ui: { panes: { stopTree: 320, diffTree: 410 } } });
    const { container } = await renderDiffList(fake.api);
    expect(handles()).toHaveLength(1);
    fireEvent.doubleClick(screen.getByRole('separator', { name: 'ファイルの列の幅を変更' }));
    expect(container.querySelector<HTMLElement>('.vd')!.style.getPropertyValue('--tree-w')).toBe('');
    await waitFor(() => expect(fake.ui).toEqual({ panes: { stopTree: 320 } }));
  });

  it('停留所の画面は左右の列に境目を出す。右の列をたたんでいる間は右の境目を出さない', async () => {
    const fake = fakeApi(fixtureAnalysis(), { ui: { panes: { stopTree: 320, stopGuide: 420 } } });
    const { container } = render(<App api={fake.api} />);
    await ready();
    enterCourse3(container);
    expect(handles()).toHaveLength(2);
    fireEvent.doubleClick(handles()[1]!);
    await waitFor(() => expect(fake.ui).toEqual({ panes: { stopTree: 320 } }));
    fireEvent.click(screen.getByRole('button', { name: /たたむ/ }));
    expect(handles()).toHaveLength(1);
    fireEvent.doubleClick(handles()[0]!);
    await waitFor(() => expect(fake.ui).toEqual({}));
    expect(container.querySelector<HTMLElement>('.stop')!.style.getPropertyValue('--lt-w')).toBe('');
  });
});

describe('App（PR 一覧。3.11）', () => {
  const analysis = fixtureAnalysis();
  const A = 'a'.repeat(40);
  const t = (h: number) => `2026-10-22T0${h}:00:00Z`;
  const list = () =>
    prList([
      openPr({ number: 42, author: 'yamada', headSha: analysis.pr.headSha, title: '割引を足す', labels: [{ name: 'bug', color: 'd73a4a' }], reviewers: [{ login: 'sato', state: 'changes' }, { login: 'katzkb', state: 'requested' }], updatedAt: t(5) }),
      openPr({ number: 8, author: 'yamada', title: '在庫を引き当てる', updatedAt: t(4) }),
      openPr({ number: 9, author: 'sato', title: '配送先を正規化する', draft: true, reviewers: [{ login: 'ito', state: 'approved' }], updatedAt: t(3) }),
    ]);
  /** 作者の行のセル（誰も見ていない / コメントあり / 承認あり） */
  const cellsOf = (author: string) => within(screen.getByRole('rowheader', { name: new RegExp(author) }).closest('[role="row"]') as HTMLElement).getAllByRole('cell');
  const names = (el: HTMLElement) => within(el).queryAllByRole('article').map((a) => a.getAttribute('aria-label'));
  const card = (n: number) => screen.getByRole('article', { name: new RegExp(`^#${n} `) });
  const opened = () => screen.findByRole('columnheader', { name: /誰も見ていない/ });
  async function openList(fake: ReturnType<typeof fakeApi>) {
    render(<App api={fake.api} />);
    await ready();
    await press(/^PR 一覧/);
    await opened();
  }

  it('上の帯の「PR 一覧」で開き、作者ごとの行とレビューの列にカードを並べる。P キーでも開いて取り直す', async () => {
    const fake = fakeApi(analysis, { key: '42', prs: list });
    await openList(fake);
    const [none, commented] = cellsOf('yamada');
    expect(names(none!)).toEqual(['#8 在庫を引き当てる']);
    expect(names(commented!)).toEqual(['#42 割引を足す']);
    expect(names(cellsOf('sato')[2]!)).toEqual(['#9 配送先を正規化する']);
    expect(card(42)).toHaveTextContent('修正の依頼');
    expect(card(42)).toHaveTextContent('あなたに依頼');
    expect(within(card(42)).getByText('bug')).toBeInTheDocument();
    expect(card(42)).toHaveTextContent('sato修正の依頼');
    expect(card(42)).toHaveTextContent('katzkb未レビュー');
    // 開いている解析は PR の今の head なので解析済み
    expect(within(card(42)).getByRole('button', { name: '開く' })).toBeInTheDocument();
    expect(within(card(8)).getByRole('button', { name: '解析する' })).toBeInTheDocument();

    await press(/^全体図/);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'p' });
    });
    await opened();
    expect(fake.prsCalls).toBe(2);
  });

  it('「あなたに依頼」と「Draft も出す」で絞り込む', async () => {
    await openList(fakeApi(analysis, { key: '42', prs: list }));
    fireEvent.click(screen.getByLabelText('Draft も出す'));
    expect(screen.queryByRole('article', { name: /^#9 / })).toBeNull();
    await press('あなたに依頼');
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['#42 割引を足す']);
  });

  it('「解析する」で serve に頼み、順番待ち・解析中と上の帯の表示。終わったら解析済みになり、「開く」でその全体図', async () => {
    const fake = fakeApi(analysis, { key: '42', prs: list });
    await openList(fake);
    await act(async () => {
      fireEvent.click(within(card(8)).getByRole('button', { name: '解析する' }));
    });
    await act(async () => {
      fireEvent.click(within(card(9)).getByRole('button', { name: '解析する' }));
    });
    expect(fake.started).toEqual([{ key: '8' }, { key: '9' }]);
    await waitFor(() => expect(card(9)).toHaveTextContent('順番待ち前に 1 件'));
    expect(card(8)).toHaveTextContent('解析中');
    expect(screen.getByRole('button', { name: '動いている処理' })).toHaveTextContent('解析中 #8 · 順番待ち 1');

    fake.addVersion({ ...analysis, pr: { ...analysis.pr, number: 8, headSha: A } }, undefined, '8');
    act(() => fake.setJobs([{ status: 'running', key: '9', startedAt: Date.now(), line: '差分を切り出しています' }, { status: 'done', key: '8', headSha: A }]));
    await waitFor(() => expect(card(8)).toHaveTextContent('解析済み'), { timeout: 3000 });
    expect(card(9)).toHaveTextContent('差分を切り出しています');
    expect(screen.getByRole('button', { name: '動いている処理' })).toHaveTextContent('解析中 #9');

    await act(async () => {
      fireEvent.click(within(card(8)).getByRole('button', { name: '開く' }));
    });
    await ready();
    expect(screen.getByLabelText('解析を切り替える')).toHaveValue(`8/${A}`);
  });

  it('取れなければ理由と「もう一度」', async () => {
    let fail = true;
    const prs = () => {
      if (fail) throw new Error('gh api に失敗しました: HTTP 401');
      return list();
    };
    render(<App api={fakeApi(analysis, { key: '42', prs }).api} />);
    await ready();
    await press(/^PR 一覧/);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('GitHub から PR の一覧を取得できませんでした。');
    expect(alert).toHaveTextContent('gh api に失敗しました: HTTP 401');
    fail = false;
    await press('もう一度');
    await opened();
  });

  it('解析が 1 つも無ければ最初から PR 一覧。何も開いていない間は上の帯に解析の選択を出さない', async () => {
    const fake = fakeApi(analysis, { noAnalyses: true, prs: list });
    render(<App api={fake.api} />);
    await opened();
    expect(within(card(42)).getByRole('button', { name: '解析する' })).toBeInTheDocument();
    fake.addVersion({ ...analysis, pr: { ...analysis.pr, number: 8, headSha: A } }, undefined, '8');
    fake.addVersion(analysis, undefined, '42');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(within(card(8)).getByRole('button', { name: '開く' })).toBeInTheDocument());
    expect(within(card(42)).getByRole('button', { name: '開く' })).toBeInTheDocument();
    expect(screen.queryByLabelText('解析を切り替える')).toBeNull();
  });

  describe('AI にレビューを頼む', () => {
    const HEAD = analysis.pr.headSha;
    const withCommand = (o: Parameters<typeof fakeApi>[1] = {}) => fakeApi(analysis, { key: '42', prs: list, ui: { reviewCommand: 'codex exec -s read-only -' }, ...o });
    async function click(el: HTMLElement) {
      await act(async () => {
        fireEvent.click(el);
      });
    }

    it('AI レビューのコマンドが空ならカードに AI の行を出さず、引き出しに設定への入口。設定の欄に入れるとカードに「AI にレビューを頼む」', async () => {
      const fake = fakeApi(analysis, { key: '42', prs: list });
      await openList(fake);
      expect(within(card(8)).queryByRole('button', { name: 'AI にレビューを頼む' })).toBeNull();
      expect(card(8)).not.toHaveTextContent('未依頼');
      await click(within(card(8)).getByText('在庫を引き当てる'));
      const drawer = screen.getByRole('complementary', { name: 'PR の詳細' });
      expect(drawer).toHaveTextContent('設定で AI レビューのコマンドを入れると、ここから頼めます。');
      await click(within(drawer).getByRole('button', { name: '設定を開く' }));
      expect(screen.getByLabelText('LLM コマンド（解析と案内人に聞く）')).toBeInTheDocument();
      const input = screen.getByLabelText('AI レビューのコマンド');
      fireEvent.change(input, { target: { value: 'codex exec -s read-only -' } });
      await act(async () => {
        fireEvent.blur(input);
      });
      expect(fake.ui.reviewCommand).toBe('codex exec -s read-only -');
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(within(card(8)).getByRole('button', { name: 'AI にレビューを頼む' })).toBeInTheDocument();
      expect(within(screen.getByRole('complementary', { name: 'PR の詳細' })).getByRole('button', { name: 'AI にレビューを頼む' })).toBeInTheDocument();
    });

    it('頼むと PR の今の head で serve に頼み、レビュー中（経過と「止める」）と上の帯の「AI レビュー中」。止めると「止めました」', async () => {
      const fake = withCommand();
      await openList(fake);
      expect(card(8)).toHaveTextContent('未依頼');
      await click(within(card(8)).getByRole('button', { name: 'AI にレビューを頼む' }));
      expect(fake.reviewsStarted).toEqual([{ key: '8', headSha: 'a'.repeat(40) }]);
      await waitFor(() => expect(card(8)).toHaveTextContent('レビュー中0:00'));
      expect(screen.getByRole('button', { name: '動いている処理' })).toHaveTextContent('AI レビュー中 1');
      await click(within(card(8)).getByRole('button', { name: '止める' }));
      expect(fake.reviewsStopped).toEqual(['8']);
      await waitFor(() => expect(card(8)).toHaveTextContent('止めました'));
      expect(within(card(8)).getByRole('button', { name: 'もう一度' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '動いている処理' })).toBeNull();
    });

    it('頼めなければ理由と「もう一度」', async () => {
      const fake = withCommand();
      await openList(fake);
      fake.api.startReview = async () => {
        throw new Error('AI レビューのコマンドが設定されていません');
      };
      await click(within(card(8)).getByRole('button', { name: 'AI にレビューを頼む' }));
      await waitFor(() => expect(card(8)).toHaveTextContent('レビューできませんでした'));
      expect(card(8)).toHaveTextContent('AI レビューのコマンドが設定されていません');
    });

    it('解析待ち・失敗の理由・下書き n 件と入れなかった数。「見る」でレビューした解析の締めに着き、AI の下書きが並ぶ', async () => {
      const fake = withCommand();
      fake.setReviews([
        { status: 'waiting', key: '8', headSha: 'a'.repeat(40) },
        { status: 'failed', key: '9', headSha: 'a'.repeat(40), reason: '終了コード 1 で終了しました' },
        { status: 'done', key: '42', headSha: HEAD, drafts: 1, skipped: 1 },
      ]);
      fake.states.set(`42/${HEAD}`, { ...emptyReview(), comments: [{ id: 'ai1', path: ORDER_KT, line: 13, side: 'RIGHT', body: '[ask] 割引の丸め方は？', source: 'codex', state: 'draft' }] });
      await openList(fake);
      await waitFor(() => expect(card(8)).toHaveTextContent('解析が終わったら始めます'));
      expect(within(card(8)).getByRole('button', { name: '止める' })).toBeInTheDocument();
      expect(card(9)).toHaveTextContent('レビューできませんでした');
      expect(card(9)).toHaveTextContent('終了コード 1 で終了しました');
      expect(card(42)).toHaveTextContent('下書き 1 件');
      expect(card(42)).toHaveTextContent('1 件は GitHub の差分に出ない行なので入れませんでした');
      await click(within(card(42)).getByRole('button', { name: '見る' }));
      await screen.findByText('完了にしたコース');
      expect(screen.getByText('[ask] 割引の丸め方は？')).toBeInTheDocument();
    });

    it('レビューした後に PR の head が変わったら「レビュー後に更新あり」と「頼み直す」（今の head で頼む）', async () => {
      const fake = withCommand();
      fake.setReviews([{ status: 'done', key: '8', headSha: 'c'.repeat(40), drafts: 2, skipped: 0 }]);
      await openList(fake);
      await waitFor(() => expect(card(8)).toHaveTextContent('下書き 2 件レビュー後に更新あり'));
      await click(within(card(8)).getByRole('button', { name: '頼み直す' }));
      expect(fake.reviewsStarted).toEqual([{ key: '8', headSha: 'a'.repeat(40) }]);
    });
  });

  describe('カードを押すと右から PR の詳細', () => {
    const detail42 = prDetail({
      number: 42,
      body: '## 何をするか\n\n割引を**足す**。',
      timeline: [
        { kind: 'commits', author: 'yamada', at: t(1), count: 2 },
        { kind: 'comment', author: 'github-actions[bot]', at: t(2), body: 'ありがとうございます' },
        { kind: 'review', author: 'sato', at: t(3), state: 'changes', body: '直してください', comments: [{ path: 'src/Order.kt', line: 12, body: 'ここは null になりえます' }], moreComments: 3 },
        { kind: 'review', author: 'ito', at: t(4), state: 'approved', body: '', comments: [], moreComments: 0 },
      ],
      files: [
        { path: 'src/Order.kt', additions: 3, deletions: 1 },
        { path: 'src/Discount.kt', additions: 20, deletions: 0 },
      ],
      filesTotal: 102,
      checks: [
        { name: 'build', result: 'pass', seconds: 185 },
        { name: 'ci/jenkins', result: 'fail', description: 'ビルドが壊れています' },
        { name: 'lint', result: 'pending' },
      ],
      checksTotal: 3,
    });
    const details = (n: number) => (n === 42 ? detail42 : prDetail({ number: n, body: '' }));
    const drawer = () => screen.getByRole('complementary', { name: 'PR の詳細' });
    const tab = (name: RegExp) => within(drawer()).getByRole('tab', { name });
    async function click(el: HTMLElement) {
      await act(async () => {
        fireEvent.click(el);
      });
    }

    it('説明・レビューとコメント・変更したファイル・チェックを GitHub の中身で描く。別のカードで切り替わり、Esc で閉じる', async () => {
      await openList(fakeApi(analysis, { key: '42', prs: list, prDetail: details }));
      await click(within(card(42)).getByText('割引を足す'));
      await waitFor(() => expect(within(drawer()).getByRole('heading', { name: '何をするか' })).toBeInTheDocument());
      expect(card(42)).toHaveAttribute('aria-expanded', 'true');
      expect(drawer()).toHaveTextContent('#42');
      expect(drawer()).toHaveTextContent('修正の依頼');
      expect(drawer()).toHaveTextContent('あなたに依頼');
      expect(drawer()).toHaveTextContent('割引を足す');
      expect(drawer()).toHaveTextContent('feature/discount → main');
      // 解析の行はカードと同じ（今の head を解析済み）
      expect(within(drawer()).getByRole('button', { name: '開く' })).toBeInTheDocument();
      expect(tab(/^説明/)).toHaveAttribute('aria-selected', 'true');

      await click(tab(/^レビューとコメント 3$/));
      const talk = within(drawer()).getByRole('tabpanel');
      expect(talk).toHaveTextContent('コミットを 2 件追加');
      expect(talk).toHaveTextContent('github-actions[bot]コメント');
      expect(talk).toHaveTextContent('sato修正の依頼');
      expect(talk).toHaveTextContent('直してください');
      expect(talk).toHaveTextContent('src/Order.kt:12');
      expect(talk).toHaveTextContent('ここは null になりえます');
      expect(talk).toHaveTextContent('ほか 3 件');
      expect(talk).toHaveTextContent('ito承認');

      await click(tab(/^変更したファイル 102$/));
      const rows = within(within(drawer()).getByRole('tabpanel')).getAllByRole('row');
      expect(rows.map((r) => r.textContent)).toEqual(['src/Order.kt+3−1', 'src/Discount.kt+20−0']);
      expect(within(drawer()).getByRole('tabpanel')).toHaveTextContent('ほか 100 件');

      await click(tab(/^チェック 3$/));
      const checks = within(drawer()).getByRole('tabpanel');
      expect(checks).toHaveTextContent('build3 分 5 秒成功');
      expect(checks).toHaveTextContent('ci/jenkinsビルドが壊れています失敗');
      expect(checks).toHaveTextContent('lint実行中');

      await click(within(card(8)).getByText('在庫を引き当てる'));
      await waitFor(() => expect(drawer()).toHaveTextContent('説明は書かれていません。'));
      expect(drawer()).toHaveTextContent('#8');
      expect(tab(/^説明/)).toHaveAttribute('aria-selected', 'true');
      expect(card(42)).toHaveAttribute('aria-expanded', 'false');
      expect(card(8)).toHaveAttribute('aria-expanded', 'true');

      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' });
      });
      expect(screen.queryByRole('complementary', { name: 'PR の詳細' })).toBeNull();
      expect(screen.getByRole('columnheader', { name: /誰も見ていない/ })).toBeInTheDocument();
    });

    it('カードにフォーカスして Enter でも開き、同じカードをもう一度押すと閉じる。カードの「解析する」は引き出しを開かない', async () => {
      const fake = fakeApi(analysis, { key: '42', prs: list, prDetail: details });
      await openList(fake);
      await act(async () => {
        fireEvent.keyDown(card(9), { key: 'Enter' });
      });
      await waitFor(() => expect(drawer()).toHaveTextContent('#9'));
      await click(card(9));
      expect(screen.queryByRole('complementary', { name: 'PR の詳細' })).toBeNull();
      await click(within(card(8)).getByRole('button', { name: '解析する' }));
      expect(fake.started).toEqual([{ key: '8' }]);
      expect(screen.queryByRole('complementary', { name: 'PR の詳細' })).toBeNull();
    });

    it('「GitHub で開く」はその PR のページを新しいタブで', async () => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      await openList(fakeApi(analysis, { key: '42', prs: list, prDetail: details }));
      await click(card(42));
      await click(within(drawer()).getByRole('button', { name: /GitHub で開く/ }));
      expect(open).toHaveBeenCalledWith('https://github.com/o/order-service/pull/7', '_blank', 'noopener,noreferrer');
      open.mockRestore();
    });

    it('取れなければ理由と「もう一度」。レビューもコメントも無ければそう出す', async () => {
      let fail = true;
      const prDetailFn = (n: number) => {
        if (fail) throw new Error('gh api に失敗しました: HTTP 502');
        return prDetail({ number: n });
      };
      await openList(fakeApi(analysis, { key: '42', prs: list, prDetail: prDetailFn }));
      await click(card(8));
      const alert = await within(drawer()).findByRole('alert');
      expect(alert).toHaveTextContent('GitHub から PR の詳細を取得できませんでした。');
      expect(alert).toHaveTextContent('gh api に失敗しました: HTTP 502');
      fail = false;
      await click(within(alert).getByRole('button', { name: 'もう一度' }));
      await waitFor(() => expect(drawer()).toHaveTextContent('割引を足します。'));
      await click(tab(/^レビューとコメント/));
      expect(within(drawer()).getByRole('tabpanel')).toHaveTextContent('まだレビューもコメントもありません。');
      await click(tab(/^チェック/));
      expect(within(drawer()).getByRole('tabpanel')).toHaveTextContent('チェックはありません。');
    });
  });
});

describe('⌘F（差分の列の中の検索。2026-10-27）', () => {
  it('差分一覧では検索欄を開き、ブラウザの検索は開かない。入口ではブラウザのページ内検索に任せる', async () => {
    const { container } = render(<App api={fakeApi().api} />);
    await ready();
    expect(fireEvent.keyDown(window, { key: 'f', metaKey: true })).toBe(true);
    expect(container.querySelector('.dfind')).toBeNull();
    await press(/^差分一覧/);
    let shown = true;
    await act(async () => {
      shown = fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    });
    expect(shown).toBe(false);
    const box = screen.getByRole('searchbox', { name: '差分の中を検索' });
    expect(box).toHaveFocus();
    await act(async () => {
      fireEvent.change(box, { target: { value: 'discount' } });
    });
    await waitFor(() => expect(container.querySelector('mark.fhit.cur')).not.toBeNull());
    expect(container.querySelector('.dfind .fcount')!.textContent).toMatch(/^1 \/ \d+$/);
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Escape' });
    });
    expect(container.querySelector('.dfind')).toBeNull();
    cleanup();
  });
});
