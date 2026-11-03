// .ondina/ の読み書き（設計書 5.5）。serve と `comments add` が共用する。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AskEntry, CommentDraft } from '@ondina/model';
import { analyzeLocal } from '../src/analyze.js';
import { addComments, appendAsk, isAskRequest, isReviewState, isUiSettings, isWaiting, keepOutsideDrafts, keyDir, markWaiting, OffDiffError, readAsk, listAnalyses, prUrlFromRemote, readAnalysis, readState, readUi, returnComments, sendComments, takeReturned, writeState, writeUi } from '../src/store.js';
import { buildFixtureRepo, FIXTURE_ROOT, git } from './fixture-repo.js';

let repo: string;
let cleanup: () => void;
let headSha: string;
beforeAll(async () => {
  ({ dir: repo, cleanup } = buildFixtureRepo());
  headSha = (await analyzeLocal(repo, 'main', 'feature/discount')).analysis.pr.headSha;
});
afterAll(() => cleanup());

describe('listAnalyses', () => {
  it('.ondina/<key>/<sha>.json を列挙し、PR メタと repoName を返す', () => {
    const list = listAnalyses(repo);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: 'local', headSha, repoName: path.basename(repo) });
    expect(list[0]!.pr.head).toBe('feature/discount');
    expect(list[0]!.mtime).toBeGreaterThan(0);
    expect(list[0]!.prUrl).toBeUndefined();
  });

  it('新しい順に並び、sha の形をしていないファイルや state/ は無視する', () => {
    const dir = path.join(repo, '.ondina', '7');
    mkdirSync(path.join(dir, 'state'), { recursive: true });
    const other = 'c'.repeat(40);
    const analysis = { ...readAnalysis(repo, 'local', headSha)!, pr: { number: 7, title: 'x', base: 'main', head: 'b', headSha: other, baseSha: 'd'.repeat(40) } };
    writeFileSync(path.join(dir, `${other}.json`), JSON.stringify(analysis));
    writeFileSync(path.join(dir, 'notes.json'), '{}');
    writeFileSync(path.join(dir, 'state', `${other}.json`), '{}');
    const old = new Date(Date.now() - 60_000);
    utimesSync(path.join(dir, `${other}.json`), old, old);
    const list = listAnalyses(repo);
    expect(list.map((a) => a.key)).toEqual(['local', '7']);
  });

  it('origin が GitHub なら PR の URL を付ける（local には付けない）', () => {
    git(repo, 'remote', 'add', 'origin', 'git@github.com:example/order-service.git');
    const list = listAnalyses(repo);
    expect(list.find((a) => a.key === '7')!.prUrl).toBe('https://github.com/example/order-service/pull/7');
    expect(list.find((a) => a.key === 'local')!.prUrl).toBeUndefined();
  });
});

describe('prUrlFromRemote', () => {
  it.each([
    ['git@github.com:o/r.git', 'https://github.com/o/r/pull/3'],
    ['https://github.com/o/r.git', 'https://github.com/o/r/pull/3'],
    ['https://github.com/o/r', 'https://github.com/o/r/pull/3'],
    ['ssh://git@github.com/o/r.git', 'https://github.com/o/r/pull/3'],
  ])('%s → %s', (remote, url) => {
    expect(prUrlFromRemote(remote, 3)).toBe(url);
  });

  it('GitHub でなければ undefined', () => {
    expect(prUrlFromRemote('git@gitlab.com:o/r.git', 3)).toBeUndefined();
  });
});

describe('readAnalysis / state / ui', () => {
  it('readAnalysis は無ければ undefined、key と sha の形が不正なら読まない', () => {
    expect(readAnalysis(repo, 'local', 'e'.repeat(40))).toBeUndefined();
    expect(readAnalysis(repo, '../local', headSha)).toBeUndefined();
    expect(readAnalysis(repo, 'local', '../../x')).toBeUndefined();
    expect(readAnalysis(repo, 'local', headSha)!.hunks.length).toBe(48);
  });

  it('state は無ければ初期値、writeState で .ondina/<key>/state/<sha>.json に書く', () => {
    expect(readState(repo, 'local', headSha)).toEqual({ viewed: [], comments: [] });
    const state = { viewed: ['h1'], comments: [] };
    writeState(repo, 'local', headSha, state);
    const file = path.join(repo, '.ondina', 'local', 'state', `${headSha}.json`);
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(state);
    expect(readState(repo, 'local', headSha)).toEqual(state);
  });

  it('ui.json は無ければ {}、writeUi で .ondina/ui.json に書く', () => {
    expect(readUi(repo)).toEqual({});
    writeUi(repo, { worktreeRoot: '/tmp/wt' });
    expect(JSON.parse(readFileSync(path.join(repo, '.ondina', 'ui.json'), 'utf8'))).toEqual({ worktreeRoot: '/tmp/wt' });
    expect(readUi(repo)).toEqual({ worktreeRoot: '/tmp/wt' });
  });

  it('解析が一つも無い（.ondina が無い）リポジトリでも writeUi は書ける', () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'ondina-empty-'));
    try {
      writeUi(empty, { theme: { mode: 'light', light: 'latte', dark: 'mocha', accent: 'peach' } });
      expect(readUi(empty)).toEqual({ theme: { mode: 'light', light: 'latte', dark: 'mocha', accent: 'peach' } });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('addComments', () => {
  const input = () => ({
    source: 'claude-code',
    headSha,
    comments: [
      { path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 3, side: 'RIGHT' as const, body: '一つ目' },
      { path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 4, side: 'RIGHT' as const, body: '二つ目' },
    ],
  });

  it('headSha から解析を探し、draft として state に追記する', () => {
    const r = addComments(repo, input());
    expect(r).toEqual({ key: 'local', headSha, added: 2 });
    const state = readState(repo, 'local', headSha);
    expect(state.viewed).toEqual(['h1']); // 既存の閲覧状態は保つ
    expect(state.comments.map((c) => [c.source, c.line, c.body, c.state])).toEqual([
      ['claude-code', 3, '一つ目', 'draft'],
      ['claude-code', 4, '二つ目', 'draft'],
    ]);
    expect(state.comments[0]!.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('同じ入力を二度足しても増えない（id は内容から決める）', () => {
    expect(addComments(repo, input()).added).toBe(0);
    expect(readState(repo, 'local', headSha).comments).toHaveLength(2);
  });

  it('知らない headSha はエラー', () => {
    expect(() => addComments(repo, { ...input(), headSha: 'f'.repeat(40) })).toThrow(/headSha/);
  });

  describe('GitHub の差分の塊がある解析（PR）', () => {
    // PR 43 の解析。塊は fixture の本物（Order.kt は head 側 3〜14 行目、base 側 3〜11 行目。DiscountPolicy.kt は差分なし）
    const prSha = 'b'.repeat(40);
    const order = 'src/main/kotlin/com/example/order/domain/Order.kt';
    const policy = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';
    const statePath = () => path.join(repo, '.ondina', '43', 'state', `${prSha}.json`);
    beforeAll(() => {
      const githubDiff: unknown = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'expected/github-diff.json'), 'utf8'));
      const analysis = { ...readAnalysis(repo, 'local', headSha)!, pr: { number: 43, title: 'x', base: 'main', head: 'b', headSha: prSha, baseSha: 'd'.repeat(40) }, githubDiff };
      mkdirSync(path.join(repo, '.ondina', '43'), { recursive: true });
      writeFileSync(path.join(repo, '.ondina', '43', `${prSha}.json`), JSON.stringify(analysis));
    });

    it('差分に出ない行が 1 件でもあれば、1 件も足さずに断り、どの行かを並べる（AI が付け直して渡し直す）', () => {
      const comments = [
        { path: order, line: 3, side: 'RIGHT' as const, body: '塊の中' },
        { path: order, line: 20, side: 'RIGHT' as const, body: '塊の外' },
        { path: policy, line: 10, side: 'RIGHT' as const, body: '差分のないファイル' },
        { path: order, line: 12, side: 'LEFT' as const, body: 'base 側の塊の外' },
      ];
      let err: unknown;
      try {
        addComments(repo, { source: 'claude-code', headSha: prSha, comments });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(OffDiffError);
      const [head, ...lines] = (err as Error).message.split('\n');
      expect(head).toMatch(/^GitHub の差分に出ない行へのコメントが 3 件あります。.*1 件も追加していません/);
      expect(lines).toEqual([`  ${order} 20 行目`, `  ${policy} 10 行目`, `  ${order} 12 行目（base 側）`]);
      expect(existsSync(statePath())).toBe(false);
    });

    it('差分に出る行（塊の端の文脈行、base 側の行も）だけなら今どおり足す', () => {
      const comments = [
        { path: order, line: 14, side: 'RIGHT' as const, body: '塊の端' },
        { path: order, line: 11, side: 'LEFT' as const, body: 'base 側' },
      ];
      expect(addComments(repo, { source: 'claude-code', headSha: prSha, comments })).toEqual({ key: '43', headSha: prSha, added: 2 });
      expect(readState(repo, '43', prSha).comments.map((c) => [c.line, c.side, c.state])).toEqual([
        [14, 'RIGHT', 'draft'],
        [11, 'LEFT', 'draft'],
      ]);
    });
  });
});

describe('keepOutsideDrafts（画面の保存で、画面が知らない AI の下書きを消さない。12 章）', () => {
  const draft = (id: string, source: string, state: CommentDraft['state'] = 'draft'): CommentDraft => ({ id, path: 'a.kt', line: 1, side: 'RIGHT', body: id, source, state });

  it('画面が送った state に無い AI の下書きは、ファイルにあれば後ろに残す', () => {
    const saved = { viewed: [], comments: [draft('a1', 'codex'), draft('a2', 'opencode')] };
    const incoming = { viewed: ['h1'], comments: [draft('a1', 'codex', 'adopted')] };
    expect(keepOutsideDrafts(saved, incoming)).toEqual({ viewed: ['h1'], comments: [draft('a1', 'codex', 'adopted'), draft('a2', 'opencode')] });
  });

  it('自分のメモは戻さない（画面で消したメモは state から消える）', () => {
    const saved = { viewed: [], comments: [draft('m1', 'reviewer', 'adopted')] };
    const incoming = { viewed: [], comments: [] };
    expect(keepOutsideDrafts(saved, incoming)).toEqual(incoming);
  });

  it('同じ id は画面が送った方を使う', () => {
    const saved = { viewed: [], comments: [draft('a1', 'codex')] };
    const incoming = { viewed: [], comments: [draft('a1', 'codex', 'discarded')] };
    expect(keepOutsideDrafts(saved, incoming).comments).toEqual([draft('a1', 'codex', 'discarded')]);
  });
});

describe('isReviewState', () => {
  it('viewed / comments があれば true（画面の設定は持たない。2026-10-11 に ui.json へ移した）', () => {
    expect(isReviewState({ viewed: [], comments: [] })).toBe(true);
    expect(isReviewState({ viewed: ['h1'], comments: [], course: { done: [], completed: [1] } })).toBe(true);
  });

  it('更新前から開いたままの画面が送る ui 付きの形も受ける（UI は読まない）', () => {
    expect(isReviewState({ viewed: [], comments: [], ui: { flavor: 'mocha', accent: 'mauve', diffMode: { b: 'uni', d: 'sbs' } } })).toBe(true);
  });

  it.each([
    ['viewed が文字列', { viewed: 'x', comments: [] }],
    ['comments が無い', { viewed: [] }],
  ])('%s は false', (_name, value) => {
    expect(isReviewState(value)).toBe(false);
  });
});

describe('isUiSettings', () => {
  it('画面の設定（worktree の置き場所・LLM コマンド・AI レビューのコマンド・テーマ・左右 / 統合）を受ける', () => {
    expect(isUiSettings({})).toBe(true);
    expect(isUiSettings({ worktreeRoot: '/tmp/wt', llmCommand: 'codex exec -', reviewCommand: 'codex exec -s read-only -', theme: { mode: 'system', light: 'latte', dark: 'frappe', accent: 'peach' }, diffMode: { b: 'uni', c: 'sbs', d: 'uni' } })).toBe(true);
    expect(isUiSettings({ diffMode: { d: 'uni' } })).toBe(true);
    // 入口の地図の道順の再生の速さ（2026-11-04）。正の数だけ
    expect(isUiSettings({ mapSpeed: 1.5 })).toBe(true);
    expect(isUiSettings({ mapSpeed: 0 })).toBe(false);
    expect(isUiSettings({ mapSpeed: '2' })).toBe(false);
  });

  it('チケットの取り方（5.1）を受ける', () => {
    expect(isUiSettings({ ticket: { source: 'jira', jiraUrl: 'https://x.atlassian.net', email: 'you@example.com' } })).toBe(true);
    expect(isUiSettings({ ticket: { source: 'command', command: 'gh issue view "$ONDINA_TICKET" --json title,body,url' } })).toBe(true);
    expect(isUiSettings({ ticket: {} })).toBe(true);
  });

  it('ショートカットキーの変更（操作の名前 → キーの配列。空の配列はキーなし）を受ける', () => {
    expect(isUiSettings({ keymap: { 'view.diff': ['x'], 'jump.ide': ['g o'], 'palette.open': ['Mod+p'], 'course.fold': [] } })).toBe(true);
    expect(isUiSettings({ keymap: {} })).toBe(true);
  });

  it('列の幅（列の名前 → px）を受ける', () => {
    expect(isUiSettings({ panes: { stopTree: 280, stopGuide: 420.5, diffTree: 360 } })).toBe(true);
    expect(isUiSettings({ panes: {} })).toBe(true);
  });

  it.each([
    ['keymap の値が文字列', { keymap: { 'view.diff': 'x' } }],
    ['keymap のキーに数', { keymap: { 'view.diff': [1] } }],
    ['keymap が配列', { keymap: [['view.diff', ['x']]] }],
    ['panes の値が文字列', { panes: { stopTree: '280px' } }],
    ['panes の値が null', { panes: { stopTree: null } }],
    ['panes が数', { panes: 280 }],
    ['llmCommand が数', { llmCommand: 1 }],
    ['reviewCommand が数', { reviewCommand: 1 }],
    ['theme の accent が無い', { theme: { mode: 'light', light: 'latte', dark: 'mocha' } }],
    ['theme.mode が知らない値', { theme: { mode: 'auto', light: 'latte', dark: 'mocha', accent: 'mauve' } }],
    ['theme が古い形（1 つのフレーバー）', { theme: { flavor: 'latte', accent: 'peach' } }],
    ['theme が文字列', { theme: 'latte' }],
    ['diffMode.d が知らない値', { diffMode: { d: 'split' } }],
    ['diffMode が文字列', { diffMode: 'uni' }],
    ['ticket.source が知らない値', { ticket: { source: 'linear' } }],
    ['ticket.jiraUrl が数', { ticket: { jiraUrl: 1 } }],
    ['ticket が文字列', { ticket: 'jira' }],
  ])('%s は false', (_name, value) => {
    expect(isUiSettings(value)).toBe(false);
  });
});

describe('sendComments', () => {
  // PR 42 の解析を用意し、採用 2 件・下書き 1 件・破棄 1 件の state を置く
  const prSha = 'e'.repeat(40);
  const draft = (id: string, state: 'draft' | 'adopted' | 'discarded' | 'sent', line: number) => ({
    id,
    path: 'src/main/kotlin/com/example/order/domain/Order.kt',
    line,
    side: 'RIGHT' as const,
    body: `コメント ${id}`,
    source: 'claude-code',
    state,
  });
  const seed = () =>
    writeState(repo, '42', prSha, { ...readState(repo, '42', prSha), comments: [draft('a1', 'adopted', 3), draft('d1', 'draft', 4), draft('a2', 'adopted', 5), draft('x1', 'discarded', 6)] });
  type Call = { args: string[]; cwd: string; input?: string | undefined };
  // gh pr view（宛先を取る）には PR の URL を、gh api graphql（GitHub で公開していないレビュー）には pending（自分が書いたか）を、レビューの POST には out を返す
  const recorder = (out = '{"html_url":"https://github.com/o/r/pull/42#pullrequestreview-9"}', pending: boolean[] = []) => {
    const calls: Call[] = [];
    const run = (args: string[], cwd: string, input?: string) => {
      calls.push({ args, cwd, input });
      if (args[0] === 'pr') return '{"url":"https://ghe.example.co.jp/team-a/order-service/pull/42"}';
      return args[1] === 'graphql' ? JSON.stringify({ data: { repository: { pullRequest: { reviews: { nodes: pending.map((viewerDidAuthor) => ({ viewerDidAuthor })) } } } } }) : out;
    };
    return { calls, run };
  };
  const posted = (calls: Call[]) => JSON.parse(calls.find((c) => c.args.includes('POST'))!.input!) as Record<string, unknown>;

  beforeAll(() => {
    // GitHub の差分の塊は fixture の本物（Order.kt は head 側 3〜14 行目、base 側 3〜11 行目。DiscountPolicy.kt は差分なし）
    const githubDiff: unknown = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'expected/github-diff.json'), 'utf8'));
    const analysis = { ...readAnalysis(repo, 'local', headSha)!, pr: { number: 42, title: 'x', base: 'main', head: 'b', headSha: prSha, baseSha: 'd'.repeat(40) }, githubDiff };
    mkdirSync(path.join(repo, '.ondina', '42'), { recursive: true });
    writeFileSync(path.join(repo, '.ondina', '42', `${prSha}.json`), JSON.stringify(analysis));
  });

  it('採用分だけを 1 回の gh api POST にまとめて公開しないレビュー（event なし）にし、sent にして PR の差分の画面の url を返す', () => {
    seed();
    const { calls, run } = recorder();
    const r = sendComments(repo, '42', prSha, run);
    expect(r).toEqual({ sent: ['a1', 'a2'], url: 'https://github.com/o/r/pull/42/files' });
    // gh api はホストをリポジトリから決めない（gh のログイン先に送る）ので、先に gh pr view で PR のホストを取って渡す
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.cwd)).toEqual([repo, repo, repo]);
    expect(calls[0]!.args).toEqual(['pr', 'view', '42', '--json', 'url']);
    expect(calls[1]!.args.slice(0, 4)).toEqual(['api', 'graphql', '--hostname', 'ghe.example.co.jp']);
    expect(calls[2]!.args).toEqual(['api', 'repos/team-a/order-service/pulls/42/reviews', '--hostname', 'ghe.example.co.jp', '--method', 'POST', '--input', '-']);
    expect(posted(calls)).toEqual({
      commit_id: prSha,
      comments: [
        { path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 3, side: 'RIGHT', body: 'コメント a1' },
        { path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 5, side: 'RIGHT', body: 'コメント a2' },
      ],
    });
    expect(readState(repo, '42', prSha).comments.map((c) => [c.id, c.state])).toEqual([
      ['a1', 'sent'],
      ['d1', 'draft'],
      ['a2', 'sent'],
      ['x1', 'discarded'],
    ]);
  });

  // レビュアー自身のメモ（3.3）
  const memo = (id: string, over: Partial<CommentDraft>): CommentDraft => ({
    id,
    path: 'src/main/kotlin/com/example/order/domain/Order.kt',
    line: 11,
    side: 'RIGHT',
    body: `メモ ${id}`,
    source: 'reviewer',
    state: 'adopted',
    ...over,
  });
  const policy = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';

  it('範囲のメモは start_line / start_side を付けて行コメントにする', () => {
    writeState(repo, '42', prSha, { ...readState(repo, '42', prSha), comments: [memo('m1', { startLine: 8, startSide: 'RIGHT' }), memo('m2', { line: 11, startLine: 6, startSide: 'LEFT' })] });
    const { calls, run } = recorder();
    sendComments(repo, '42', prSha, run);
    expect(posted(calls)).toEqual({
      commit_id: prSha,
      comments: [
        { path: 'src/main/kotlin/com/example/order/domain/Order.kt', start_line: 8, start_side: 'RIGHT', line: 11, side: 'RIGHT', body: 'メモ m1' },
        { path: 'src/main/kotlin/com/example/order/domain/Order.kt', start_line: 6, start_side: 'LEFT', line: 11, side: 'RIGHT', body: 'メモ m2' },
      ],
    });
  });

  it('GitHub の差分に出ない行のメモ・下書きは送らず、採用のまま残す（レビュー全体の本文も付けない）', () => {
    writeState(repo, '42', prSha, {
      ...readState(repo, '42', prSha),
      comments: [
        memo('b1', { path: policy, line: 10, body: '差分のないファイル' }),
        memo('l1', { line: 13 }),
        memo('b2', { line: 12, side: 'LEFT', body: 'base 側の塊の外' }),
        { ...draft('d1', 'adopted', 20), body: 'AI の塊の外' },
      ],
    });
    const { calls, run } = recorder();
    const r = sendComments(repo, '42', prSha, run);
    expect(r.sent).toEqual(['l1']);
    expect(posted(calls)).toEqual({ commit_id: prSha, comments: [{ path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 13, side: 'RIGHT', body: 'メモ l1' }] });
    expect(readState(repo, '42', prSha).comments.map((c) => [c.id, c.state])).toEqual([
      ['b1', 'adopted'],
      ['l1', 'sent'],
      ['b2', 'adopted'],
      ['d1', 'adopted'],
    ]);
  });

  it('範囲は始まりと終わりがどちらも差分に出るときだけ送る（片方が塊の外なら送らない）', () => {
    writeState(repo, '42', prSha, {
      ...readState(repo, '42', prSha),
      comments: [memo('x1', { startLine: 6, startSide: 'LEFT', line: 11, side: 'RIGHT', body: '消した行から' }), memo('x2', { startLine: 2, startSide: 'RIGHT', line: 10, body: '塊の外から' })],
    });
    const { calls, run } = recorder();
    expect(sendComments(repo, '42', prSha, run).sent).toEqual(['x1']);
    expect(posted(calls)['comments']).toEqual([{ path: 'src/main/kotlin/com/example/order/domain/Order.kt', start_line: 6, start_side: 'LEFT', line: 11, side: 'RIGHT', body: '消した行から' }]);
  });

  it('採用が差分に出ない行だけなら、gh を呼ばずにエラーで、state は変えない', () => {
    writeState(repo, '42', prSha, { ...readState(repo, '42', prSha), comments: [memo('b1', { path: policy, line: 10 })] });
    const { calls, run } = recorder();
    expect(() => sendComments(repo, '42', prSha, run)).toThrow(/GitHub に送れるコメントがありません/);
    expect(calls).toHaveLength(0);
    expect(readState(repo, '42', prSha).comments.map((c) => c.state)).toEqual(['adopted']);
  });

  it('採用が無ければエラーで gh を呼ばない（送信済みは数えない）', () => {
    writeState(repo, '42', prSha, { ...readState(repo, '42', prSha), comments: [memo('s1', { state: 'sent' })] });
    const { calls, run } = recorder();
    expect(() => sendComments(repo, '42', prSha, run)).toThrow(/採用/);
    expect(calls).toHaveLength(0);
  });

  it('local の解析は送れない', () => {
    writeState(repo, 'local', headSha, { ...readState(repo, 'local', headSha), comments: [draft('a1', 'adopted', 3)] });
    const { calls, run } = recorder();
    expect(() => sendComments(repo, 'local', headSha, run)).toThrow(/PR/);
    expect(calls).toHaveLength(0);
  });

  it('GitHub で公開していない自分のレビューがあれば送らず（GitHub は 1 つの PR に 1 つまで）、state は変えない', () => {
    seed();
    const { calls, run } = recorder(undefined, [false, true]);
    expect(() => sendComments(repo, '42', prSha, run)).toThrow(/公開していない/);
    expect(calls.some((c) => c.args.includes('POST'))).toBe(false);
    expect(readState(repo, '42', prSha).comments.map((c) => c.state)).toEqual(['adopted', 'draft', 'adopted', 'discarded']);
  });

  it('ほかの人の公開していないレビュー（viewerDidAuthor が false）は数えずに送る', () => {
    seed();
    const { calls, run } = recorder(undefined, [false]);
    sendComments(repo, '42', prSha, run);
    expect(calls.some((c) => c.args.includes('POST'))).toBe(true);
  });

  it('gh が失敗したらそのまま投げ、state は変えない', () => {
    seed();
    const { run } = recorder();
    expect(() =>
      sendComments(repo, '42', prSha, (args, cwd, input) => {
        if (args.includes('POST')) throw new Error('gh api に失敗しました: HTTP 422: Unprocessable Entity');
        return run(args, cwd, input);
      }),
    ).toThrow(/HTTP 422/);
    expect(readState(repo, '42', prSha).comments.map((c) => c.state)).toEqual(['adopted', 'draft', 'adopted', 'discarded']);
  });

  it('gh の出力に html_url が無ければエラー、state は変えない', () => {
    seed();
    const { run } = recorder('not json');
    expect(() => sendComments(repo, '42', prSha, run)).toThrow(/html_url/);
    expect(readState(repo, '42', prSha).comments.map((c) => c.state)).toEqual(['adopted', 'draft', 'adopted', 'discarded']);
  });

  it('知らない解析はエラー', () => {
    const { run } = recorder();
    expect(() => sendComments(repo, '42', 'f'.repeat(40), run)).toThrow(/解析/);
  });
});

describe('AI に返す（returnComments / takeReturned / 待ち印。12 章）', () => {
  const c = (id: string, state: CommentDraft['state'], over: Partial<CommentDraft> = {}): CommentDraft => ({
    id,
    path: 'src/main/kotlin/com/example/order/domain/Order.kt',
    line: 11,
    side: 'RIGHT',
    body: `本文 ${id}`,
    source: 'reviewer',
    state,
    ...over,
  });
  const inbox = () => path.join(repo, '.ondina', 'local', 'returned');
  const alive = (pid: number) => pid === process.pid;

  it('採用したメモと下書きを受け箱に書き、送信済みにする。範囲は startLine / startSide も渡す', () => {
    writeState(repo, 'local', headSha, {
      viewed: [],
      comments: [c('m1', 'adopted', { startLine: 8, startSide: 'RIGHT' }), c('d1', 'adopted', { source: 'codex', line: 3 }), c('d2', 'draft', { source: 'codex' }), c('s1', 'sent')],
    });
    const r = returnComments(repo, headSha, { now: () => Date.parse('2026-10-15T05:00:00Z'), alive });
    expect(r).toEqual({ sent: ['m1', 'd1'], waiting: false });
    expect(readState(repo, 'local', headSha).comments.map((x) => [x.id, x.state])).toEqual([
      ['m1', 'sent'],
      ['d1', 'sent'],
      ['d2', 'draft'],
      ['s1', 'sent'],
    ]);
    expect(takeReturned(repo)).toEqual([
      { headSha, path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 11, side: 'RIGHT', startLine: 8, startSide: 'RIGHT', body: '本文 m1', source: 'reviewer' },
      { headSha, path: 'src/main/kotlin/com/example/order/domain/Order.kt', line: 3, side: 'RIGHT', body: '本文 d1', source: 'codex' },
    ]);
  });

  it('一度読んだものは二度渡さない（読んだ物は returned/done へ移す）。返した順に並ぶ', () => {
    expect(takeReturned(repo)).toEqual([]);
    expect(readdirSync(path.join(inbox(), 'done'))).toHaveLength(1);
    writeState(repo, 'local', headSha, { viewed: [], comments: [c('a', 'adopted')] });
    returnComments(repo, headSha, { now: () => 2000, alive });
    writeState(repo, 'local', headSha, { viewed: [], comments: [c('b', 'adopted')] });
    returnComments(repo, headSha, { now: () => 1000 + 10_000, alive });
    expect(takeReturned(repo).map((x) => x.body)).toEqual(['本文 a', '本文 b']);
  });

  it('ほかの comments wait が先に取ったファイルは飛ばす（同じものを二度渡さず、落ちない）', () => {
    writeState(repo, 'local', headSha, { viewed: [], comments: [c('x', 'adopted')] });
    returnComments(repo, headSha, { now: () => 50_000, alive });
    // 読む前にほかのプロセスが done/ へ移した
    const name = readdirSync(inbox()).find((n) => n.endsWith('.json'))!;
    renameSync(path.join(inbox(), name), path.join(inbox(), 'done', name));
    expect(takeReturned(repo, () => [name])).toEqual([]);
  });

  it('採用が無ければエラーで受け箱に書かない', () => {
    writeState(repo, 'local', headSha, { viewed: [], comments: [c('d', 'draft')] });
    expect(() => returnComments(repo, headSha, { alive })).toThrow(/採用/);
    expect(takeReturned(repo)).toEqual([]);
  });

  it('PR の解析は AI に返さない（GitHub に送る）', () => {
    expect(() => returnComments(repo, 'f'.repeat(40), { alive })).toThrow(/解析/);
  });

  it('待ち印: 置いた pid が生きていれば待っている。外せば待っていない。死んだ pid の印は数えない', () => {
    expect(isWaiting(repo, alive)).toBe(false);
    const off = markWaiting(repo, process.pid);
    expect(isWaiting(repo, alive)).toBe(true);
    writeState(repo, 'local', headSha, { viewed: [], comments: [c('w', 'adopted')] });
    expect(returnComments(repo, headSha, { alive }).waiting).toBe(true);
    off();
    expect(isWaiting(repo, alive)).toBe(false);
    markWaiting(repo, 4_000_000);
    expect(isWaiting(repo, alive)).toBe(false);
    takeReturned(repo);
  });
});

describe('案内人に聞くの会話（設計書 3.10）', () => {
  const sha = 'c'.repeat(40);
  const entry = (id: string): AskEntry => ({ id, key: 'pr', place: { kind: 'pr' }, question: `q-${id}`, answer: { lead: 'L', items: [] }, command: 'c', ms: 1, at: '2026-10-08T00:00:00.000Z' });
  let tmp: string;
  beforeAll(() => (tmp = mkdtempSync(path.join(os.tmpdir(), 'ondina-ask-'))));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('無ければ空。足すと .ondina/<key>/ask/<sha>.json に古い順で残る', () => {
    expect(readAsk(tmp, 'local', sha)).toEqual({ entries: [] });
    appendAsk(tmp, 'local', sha, entry('a'));
    appendAsk(tmp, 'local', sha, entry('b'));
    expect(readAsk(tmp, 'local', sha).entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(existsSync(path.join(tmp, '.ondina', 'local', 'ask', `${sha}.json`))).toBe(true);
  });

  it('key / sha の形が違えば読まない・書かない', () => {
    expect(readAsk(tmp, '../x', sha)).toEqual({ entries: [] });
    expect(() => appendAsk(tmp, 'local', 'nope', entry('c'))).toThrow();
  });

  it('isAskRequest: 場所の形・鍵・質問（空でない）を見る', () => {
    expect(isAskRequest({ key: 'pr', question: 'q', place: { kind: 'pr' } })).toBe(true);
    expect(isAskRequest({ key: 'symbol:x', question: 'q', place: { kind: 'symbol', symbolId: 'x', courseId: 3 } })).toBe(true);
    expect(isAskRequest({ key: 'course:0', question: 'q', place: { kind: 'course', courseId: 0 } })).toBe(true);
    expect(isAskRequest({ key: 'hunk:h', question: 'q', place: { kind: 'hunk', hunkId: 'h' } })).toBe(true);
    expect(isAskRequest({ key: 'file:p', question: 'q', place: { kind: 'file', path: 'p' } })).toBe(true);
    expect(isAskRequest({ key: 'pr', question: '  ', place: { kind: 'pr' } })).toBe(false);
    expect(isAskRequest({ key: 'pr', question: 'q', place: { kind: 'symbol' } })).toBe(false);
    expect(isAskRequest({ key: 'pr', question: 'q', place: { kind: 'course', courseId: 'x' } })).toBe(false);
    expect(isAskRequest({ question: 'q', place: { kind: 'pr' } })).toBe(false);
  });

  it('isAskRequest: 選んだ行（lines）は symbol / hunk / file に任意。形が壊れていれば弾く', () => {
    const lines = { path: 'a/Order.kt', start: { side: 'head', line: 8 }, end: { side: 'head', line: 11 } };
    expect(isAskRequest({ key: 'symbol:x#h8-h11', question: 'q', place: { kind: 'symbol', symbolId: 'x', courseId: 3, lines } })).toBe(true);
    expect(isAskRequest({ key: 'hunk:h#b6-h6', question: 'q', place: { kind: 'hunk', hunkId: 'h', lines: { ...lines, start: { side: 'base', line: 6 }, end: { side: 'head', line: 6 } } } })).toBe(true);
    expect(isAskRequest({ key: 'file:p#h1-h1', question: 'q', place: { kind: 'file', path: 'p', lines } })).toBe(true);
    expect(isAskRequest({ key: 'k', question: 'q', place: { kind: 'symbol', symbolId: 'x', lines: { ...lines, start: { side: 'LEFT', line: 8 } } } })).toBe(false);
    expect(isAskRequest({ key: 'k', question: 'q', place: { kind: 'symbol', symbolId: 'x', lines: { ...lines, end: { side: 'head', line: 0 } } } })).toBe(false);
    expect(isAskRequest({ key: 'k', question: 'q', place: { kind: 'hunk', hunkId: 'h', lines: { ...lines, path: 3 } } })).toBe(false);
    expect(isAskRequest({ key: 'k', question: 'q', place: { kind: 'file', path: 'p', lines: 'h8' } })).toBe(false);
  });
});

describe('worktree から（PR 番号の解析は元のフォルダの .ondina に置き、local はその worktree に置く）', () => {
  let main: string;
  let wt: string;
  let done: () => void;
  const PR_SHA = 'a'.repeat(40);
  beforeAll(() => {
    const built = buildFixtureRepo();
    main = built.dir;
    wt = `${main}-wt`;
    git(main, 'worktree', 'add', '--detach', wt, 'main');
    done = () => {
      built.cleanup();
      rmSync(wt, { recursive: true, force: true });
    };
    const local = readAnalysis(repo, 'local', headSha)!;
    // worktree の ondina analyze 7 が書いた解析と、元のフォルダ・worktree それぞれの local の解析
    mkdirSync(keyDir(wt, '7'), { recursive: true });
    writeFileSync(path.join(keyDir(wt, '7'), `${PR_SHA}.json`), JSON.stringify({ ...local, pr: { ...local.pr, number: 7, headSha: PR_SHA } }));
    for (const dir of [main, wt]) {
      mkdirSync(path.join(dir, '.ondina', 'local'), { recursive: true });
      writeFileSync(path.join(dir, '.ondina', 'local', `${headSha}.json`), JSON.stringify({ ...local, pr: { ...local.pr, title: path.basename(dir) } }));
    }
  });
  afterAll(() => done());

  it('worktree で書いた PR 番号の解析は元のフォルダの .ondina/<key>/ に入る', () => {
    expect(existsSync(path.join(main, '.ondina', '7', `${PR_SHA}.json`))).toBe(true);
    expect(existsSync(path.join(wt, '.ondina', '7'))).toBe(false);
    expect(readAnalysis(main, '7', PR_SHA)!.pr.number).toBe(7);
  });

  it('閲覧状態も同じ場所。worktree で付けた印を元のフォルダの serve が読む', () => {
    writeState(wt, '7', PR_SHA, { viewed: ['h1'], comments: [] });
    expect(readState(main, '7', PR_SHA).viewed).toEqual(['h1']);
  });

  it('一覧: 元のフォルダの PR 番号の解析と、その worktree の local を出す（ほかのフォルダの local は出さない）', () => {
    expect(listAnalyses(wt).map((x) => [x.key, x.pr.title])).toEqual(expect.arrayContaining([['7', expect.any(String)], ['local', path.basename(wt)]]));
    expect(listAnalyses(wt)).toHaveLength(2);
    expect(listAnalyses(main).map((x) => [x.key, x.pr.title])).toEqual(expect.arrayContaining([['7', expect.any(String)], ['local', path.basename(main)]]));
    expect(listAnalyses(main)).toHaveLength(2);
  });

  it('元のフォルダが無い形（bare のリポジトリの worktree）は、まとめずにその worktree に置く', () => {
    const bare = `${main}-bare.git`;
    const bareWt = `${main}-bare-wt`;
    git(main, 'clone', '-q', '--bare', main, bare);
    try {
      git(bare, 'worktree', 'add', '--detach', bareWt, 'main');
      expect(realpathSync(path.dirname(path.dirname(keyDir(bareWt, '7'))))).toBe(realpathSync(bareWt));
    } finally {
      for (const d of [bare, bareWt]) rmSync(d, { recursive: true, force: true });
    }
  });

  it('local の閲覧状態はその worktree に置く', () => {
    writeState(wt, 'local', headSha, { viewed: ['x'], comments: [] });
    expect(readState(main, 'local', headSha).viewed).toEqual([]);
    expect(readState(wt, 'local', headSha).viewed).toEqual(['x']);
  });
});
