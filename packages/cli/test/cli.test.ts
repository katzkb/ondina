// コマンドの入口: 引数解釈と終了コード。実行は run(argv, io) をプロセス内で呼ぶ。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAnalyzeArgs, parseServeArgs, run, usage } from '../src/main.js';
import { isWaiting, listAnalyses, returnComments, writeState } from '../src/store.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

let repo: string;
let cleanup: () => void;
beforeAll(() => ({ dir: repo, cleanup } = buildFixtureRepo()));
afterAll(() => cleanup());

function io(cwd: string, stdin = '') {
  const out: string[] = [];
  const err: string[] = [];
  return { cwd, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), stdin: () => stdin, out, err };
}

describe('ondina analyze', () => {
  it('--base --head でローカルの 2 ref を解析し、書いた JSON のパスを標準出力に出す', async () => {
    const o = io(repo);
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount'], o)).toBe(0);
    const written = o.out.join('').trim();
    expect(written).toMatch(/\.ondina\/local\/[0-9a-f]{40}\.json$/);
    expect(existsSync(written)).toBe(true);
  });

  it('yaml が無ければ警告を標準エラーに出して exit 0', async () => {
    const yaml = path.join(repo, 'ondina.config.yaml');
    renameSync(yaml, `${yaml}.bak`);
    try {
      const o = io(repo);
      expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount'], o)).toBe(0);
      expect(o.err).toContain('ondina analyze: ondina.config.yaml がないので既定の設定で解析します\n');
      expect(o.err.join('')).toMatch(/\nondina analyze: 追従グループ \d+、差異あり \d+、わずかな差異 \d+\n/);
    } finally {
      renameSync(`${yaml}.bak`, yaml);
    }
  });

  it('追従検出の要約と未対応の正規化ルール、LLM ラベリングと案内文の要約を標準エラーに出す（8 章 / 10 章）', async () => {
    const o = io(repo);
    // 言語サーバーの行は出さない（--no-lsp）。LSP の要約は analyze.test.ts で見る
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount', '--no-llm', '--no-lsp'], o)).toBe(0);
    expect(o.err.join('')).toBe(
      'ondina analyze: base と head のコードを用意しています\nondina analyze: 差分を切り出しています\n' +
        'ondina analyze: 追従グループ 1、差異あり 1、わずかな差異 0\nondina analyze: normalize.kotlin の namedArgOrder は未対応です\nondina analyze: LLM で目的ごとに分けませんでした: --no-llm\n',
    );
    const o2 = io(repo);
    writeFileSync(path.join(repo, 'body.md'), '割引を足した。\n');
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount', '--body', 'body.md'], o2)).toBe(0);
    expect(o2.err.join('')).toMatch(/ondina analyze: AI が変更を目的ごとに分けています\nondina analyze: AI が案内文を書いています\n/);
    expect(o2.err.join('')).toMatch(/ondina analyze: LLM: node .*fake-llm\.mjs/);
    expect(o2.err.join('')).toMatch(/ondina analyze: How 1、未帰属 0、絡み 0\nondina analyze: LLM（案内文）: node .*fake-llm\.mjs\nondina analyze: 案内文: 変わること 1 \/ 1、この場所 (\d+) \/ \1、確かめること 1（場所 1）\nondina analyze: 入口の説明: 要点 あり、例 なし、図 1 本（箱 1）\nondina analyze: 前からあるもの 1 から候補にない名前を除外しました: x\.Nope\nondina analyze: 背景: 前からあるもの 1 行（候補 \d+）、言葉 1 個\nondina analyze: 動きの題: 0 \/ 1 本\n$/);
  });

  it('--no-llm / --relabel / --body <file> を受ける。--body は PR 番号と同時に指定できない', () => {
    expect(parseAnalyzeArgs(['--base', 'a', '--head', 'b'])).toEqual({ mode: 'local', base: 'a', head: 'b', llm: 'auto', lsp: true });
    expect(parseAnalyzeArgs(['--base', 'a', '--head', 'b', '--no-llm'])).toEqual({ mode: 'local', base: 'a', head: 'b', llm: 'off', lsp: true });
    expect(parseAnalyzeArgs(['12', '--relabel'])).toEqual({ mode: 'pr', number: 12, llm: 'relabel', lsp: true });
    expect(parseAnalyzeArgs(['--base', 'a', '--head', 'b', '--body', 'x.md'])).toEqual({ mode: 'local', base: 'a', head: 'b', llm: 'auto', lsp: true, bodyFile: 'x.md' });
    expect(parseAnalyzeArgs(['12', '--body', 'x.md'])).toEqual({ error: expect.stringMatching(/--body/) });
    expect(parseAnalyzeArgs(['--base', 'a', '--head', 'b', '--no-llm', '--relabel'])).toEqual({ error: expect.stringMatching(/--no-llm/) });
    expect(parseAnalyzeArgs(['--body'])).toEqual({ error: expect.stringMatching(/--body/) });
  });

  it('--ticket <値> は PR 番号でも --base / --head でも受ける（設計書 5.1）', () => {
    expect(parseAnalyzeArgs(['12', '--ticket', 'SHOP-421'])).toEqual({ mode: 'pr', number: 12, llm: 'auto', lsp: true, ticket: 'SHOP-421' });
    expect(parseAnalyzeArgs(['--base', 'a', '--head', 'b', '--ticket', 'https://x.atlassian.net/browse/SHOP-421'])).toEqual({ mode: 'local', base: 'a', head: 'b', llm: 'auto', lsp: true, ticket: 'https://x.atlassian.net/browse/SHOP-421' });
    expect(parseAnalyzeArgs(['12', '--ticket'])).toEqual({ error: '--ticket には値を指定してください' });
  });

  it('--ticket のチケットを Analysis.pr.ticket に入れ、取れたことを標準エラーに 1 行出す', async () => {
    writeFileSync(path.join(repo, 'SHOP-421.md'), '## 背景\n\n割引コードを配る。\n');
    const o = io(repo);
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount', '--no-llm', '--no-lsp', '--ticket', 'SHOP-421.md'], o)).toBe(0);
    const analysis = JSON.parse(readFileSync(o.out.join('').trim(), 'utf8')) as { pr: { ticket?: { source: string; body: string } } };
    expect(analysis.pr.ticket).toMatchObject({ source: 'file', ref: 'SHOP-421.md', body: '## 背景\n\n割引コードを配る。\n', format: 'markdown' });
    expect(o.err.join('')).toContain('ondina analyze: チケット: SHOP-421.md（ファイル）\n');
  });

  it('チケットを取れなくても解析は終える。理由を Analysis と標準エラーに', async () => {
    const o = io(repo);
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount', '--no-llm', '--no-lsp', '--ticket', 'SHOP-421'], o)).toBe(0);
    const analysis = JSON.parse(readFileSync(o.out.join('').trim(), 'utf8')) as { pr: { ticket?: { error?: string } } };
    expect(analysis.pr.ticket?.error).toBe('Jira の URL が設定にありません。設定画面の「チケット」で設定するか、URL で指定してください');
    expect(o.err.join('')).toContain('ondina analyze: チケット SHOP-421 を取得できませんでした: Jira の URL が設定にありません。設定画面の「チケット」で設定するか、URL で指定してください\n');
  });

  it('取り方は UI の設定（.ondina/ui.json の ticket）に従う', async () => {
    const ui = path.join(repo, '.ondina', 'ui.json');
    const saved = existsSync(ui) ? readFileSync(ui, 'utf8') : undefined;
    mkdirSync(path.dirname(ui), { recursive: true });
    writeFileSync(ui, JSON.stringify({ ticket: { source: 'command', command: 'printf \'{"title":"題","body":"%s の本文"}\' "$ONDINA_TICKET"' } }));
    try {
      const o = io(repo);
      expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount', '--no-llm', '--no-lsp', '--ticket', 'GH-7'], o)).toBe(0);
      const analysis = JSON.parse(readFileSync(o.out.join('').trim(), 'utf8')) as { pr: { ticket?: { source: string; body: string } } };
      expect(analysis.pr.ticket).toMatchObject({ source: 'command', title: '題', body: 'GH-7 の本文' });
      expect(o.err.join('')).toContain('ondina analyze: チケット: GH-7 題（コマンド）\n');
    } finally {
      if (saved === undefined) rmSync(ui);
      else writeFileSync(ui, saved);
    }
  });

  it('--ticket が無ければ題・ブランチ名・本文から探し、UI の設定の取り方で取る（設計書 5.1 / 10.7）', async () => {
    const ui = path.join(repo, '.ondina', 'ui.json');
    const saved = existsSync(ui) ? readFileSync(ui, 'utf8') : undefined;
    mkdirSync(path.dirname(ui), { recursive: true });
    writeFileSync(ui, JSON.stringify({ ticket: { source: 'command', command: 'printf \'{"title":"題 %s"}\' "$ONDINA_TICKET"' } }));
    writeFileSync(path.join(repo, 'body-ticket.md'), '[GH-7] 割引を足した。\n');
    try {
      const o = io(repo);
      expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount', '--no-lsp', '--body', 'body-ticket.md'], o)).toBe(0);
      const analysis = JSON.parse(readFileSync(o.out.join('').trim(), 'utf8')) as { pr: { ticket?: { source: string; title: string }; ticketSearch?: { chosen?: string } } };
      expect(analysis.pr.ticketSearch?.chosen).toBe('GH-7');
      expect(analysis.pr.ticket).toMatchObject({ source: 'command', title: '題 GH-7' });
      expect(o.err.join('')).toContain('ondina analyze: チケット: GH-7 題 GH-7（コマンド。候補 1 件から LLM が選んだ推定）\n');
    } finally {
      if (saved === undefined) rmSync(ui);
      else writeFileSync(ui, saved);
    }
  });

  it('--ticket を付けなければ Analysis.pr.ticket は無い', async () => {
    const o = io(repo);
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount', '--no-llm', '--no-lsp'], o)).toBe(0);
    const analysis = JSON.parse(readFileSync(o.out.join('').trim(), 'utf8')) as { pr: Record<string, unknown> };
    expect('ticket' in analysis.pr).toBe(false);
  });

  it('LSP は既定で起こす。--no-lsp で止める。--lsp は前からの書き方として受ける（設計書 5.5）', () => {
    expect(parseAnalyzeArgs(['15'])).toEqual({ mode: 'pr', number: 15, llm: 'auto', lsp: true });
    expect(parseAnalyzeArgs(['15', '--no-lsp'])).toEqual({ mode: 'pr', number: 15, llm: 'auto', lsp: false });
    expect(parseAnalyzeArgs(['15', '--lsp'])).toEqual({ mode: 'pr', number: 15, llm: 'auto', lsp: true });
    expect(parseAnalyzeArgs(['--base', 'a', '--head', 'b', '--no-lsp'])).toEqual({ mode: 'local', base: 'a', head: 'b', llm: 'auto', lsp: false });
    expect(parseAnalyzeArgs(['15', '--lsp', '--no-lsp'])).toEqual({ error: expect.stringMatching(/--lsp と --no-lsp/) });
  });

  it('--body のファイルが無ければ exit 1', async () => {
    const o = io(repo);
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount', '--body', path.join(repo, 'nope.md')], o)).toBe(1);
    expect(o.err.join('')).toMatch(/nope\.md/);
  });

  it('--head だけでは足りないと言って exit 1', async () => {
    const o = io(repo);
    expect(await run(['analyze', '--head', 'main'], o)).toBe(1);
    expect(o.err.join('')).toMatch(/--base/);
  });

  it('--head を付けなければ作業ツリー（コミットしていない変更を含む）を解析する。--title は local のときだけ', () => {
    expect(parseAnalyzeArgs(['--base', 'main'])).toEqual({ mode: 'local', base: 'main', llm: 'auto', lsp: true });
    expect(parseAnalyzeArgs(['--base', 'main', '--title', '割引を足す', '--body', 'b.md'])).toEqual({ mode: 'local', base: 'main', llm: 'auto', lsp: true, title: '割引を足す', bodyFile: 'b.md' });
    expect(parseAnalyzeArgs(['--base', 'a', '--head', 'b', '--title', 'x'])).toEqual({ mode: 'local', base: 'a', head: 'b', llm: 'auto', lsp: true, title: 'x' });
    expect(parseAnalyzeArgs(['12', '--title', 'x'])).toEqual({ error: expect.stringMatching(/--title/) });
    expect(parseAnalyzeArgs(['--base', 'a', '--title'])).toEqual({ error: '--title には値を指定してください' });
  });

  it('PR 番号でない引数は exit 1', async () => {
    const o = io(repo);
    expect(await run(['analyze', 'abc'], o)).toBe(1);
    expect(o.err.join('')).toMatch(/PR 番号/);
  });

  it('引数なしは使い方を出して exit 1', async () => {
    const o = io(repo);
    expect(await run(['analyze'], o)).toBe(1);
    expect(o.err.join('')).toMatch(/使い方/);
  });

  it('git リポジトリでないディレクトリでは exit 1', async () => {
    const o = io('/');
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount'], o)).toBe(1);
    expect(o.err.join('')).toMatch(/git/);
  });
});

// 構成の推定し直し（設計書 10.6）。推定は初回の analyze で走るので、これは増えた後にやり直すためのコマンド
describe('ondina structure', () => {
  const saved = () => path.join(repo, '.ondina/structure.json');

  it('HEAD のリポジトリ全体から構成を推定して .ondina/structure.json を上書きし、層の一覧を出す', async () => {
    mkdirSync(path.dirname(saved()), { recursive: true });
    writeFileSync(saved(), '{"version":1,"old":true}');
    const o = io(repo);
    expect(await run(['structure'], o)).toBe(0);
    const file = JSON.parse(readFileSync(saved(), 'utf8')) as { headSha: string; layers: Array<{ name: string }> };
    expect(file.headSha).toBe(git(repo, 'rev-parse', 'HEAD'));
    expect(file.layers.map((l) => l.name)).toEqual(['Main', 'Test']);
    expect(o.out.join('')).toContain('層 2（Main / Test）、テストの置き場 1 か所');
    expect(o.out.join('')).toContain('ondina analyze');
  });

  it('保存があれば、その層の名前を前回として渡す（名前と並びを保たせる。原則 7）', async () => {
    const dump = path.join(repo, '.ondina-structure-input.json');
    process.env['FAKE_LLM_INPUT'] = dump;
    try {
      expect(await run(['structure'], io(repo))).toBe(0);
    } finally {
      delete process.env['FAKE_LLM_INPUT'];
    }
    expect((JSON.parse(readFileSync(dump, 'utf8')) as { previous?: unknown }).previous).toEqual({ layers: ['Main', 'Test'] });
  });

  it('<ref> を渡せばその commit から推定する', async () => {
    const o = io(repo);
    expect(await run(['structure', 'main'], o)).toBe(0);
    expect((JSON.parse(readFileSync(saved(), 'utf8')) as { headSha: string }).headSha).toBe(git(repo, 'rev-parse', 'main'));
  });

  it('推定できなければ理由を出して exit 1。保存は前のまま', async () => {
    const before = readFileSync(saved(), 'utf8');
    const o = io(repo);
    process.env['FAKE_LLM_STRUCTURE_MODE'] = 'fail';
    try {
      expect(await run(['structure'], o)).toBe(1);
    } finally {
      delete process.env['FAKE_LLM_STRUCTURE_MODE'];
    }
    expect(o.err.join('')).toContain('boom: the cartographer is on strike');
    expect(readFileSync(saved(), 'utf8')).toBe(before);
  });
});

describe('ondina（引数なし / --help）', () => {
  it('使い方を標準出力に出して exit 0', async () => {
    const o = io(repo);
    expect(await run([], o)).toBe(0);
    expect(o.out.join('')).toMatch(/analyze/);
    expect(await run(['--help'], io(repo))).toBe(0);
  });

  it('知らないコマンドは exit 1', async () => {
    expect(await run(['frobnicate'], io(repo))).toBe(1);
  });
});

describe('ondina analyze と worktree の置き場所（設計書 3.8）', () => {
  it('言語サーバー用の worktree を、--worktree-root があればそこに、無ければ .ondina/ui.json の worktreeRoot に作る', async () => {
    const viaFlag = path.join(repo, 'wt-flag');
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount', '--worktree-root', viaFlag], io(repo))).toBe(0);
    expect(existsSync(path.join(viaFlag, 'lsp', 'head'))).toBe(true);
    const viaUi = path.join(repo, 'wt-ui');
    mkdirSync(path.join(repo, '.ondina'), { recursive: true });
    writeFileSync(path.join(repo, '.ondina', 'ui.json'), JSON.stringify({ worktreeRoot: viaUi }));
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount'], io(repo))).toBe(0);
    expect(existsSync(path.join(viaUi, 'lsp', 'head'))).toBe(true);
  });
});

describe('ondina comments add', () => {
  it('--from <file> の JSON を下書きとして state に足す', async () => {
    const o = io(repo);
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount'], o)).toBe(0);
    const analysisPath = o.out.join('').trim();
    const headSha = path.basename(analysisPath, '.json');
    const file = path.join(repo, 'comments.json');
    writeFileSync(file, JSON.stringify({ source: 'claude-code', headSha, comments: [{ path: 'a.kt', line: 1, side: 'RIGHT', body: 'x' }] }));
    const o2 = io(repo);
    expect(await run(['comments', 'add', '--from', file], o2)).toBe(0);
    expect(o2.out.join('')).toMatch(/1 件/);
    const state = JSON.parse(readFileSync(path.join(repo, '.ondina', 'local', 'state', `${headSha}.json`), 'utf8')) as { comments: unknown[] };
    expect(state.comments).toHaveLength(1);
  });

  it('--from - は標準入力から読む', async () => {
    const o = io(repo);
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount'], o)).toBe(0);
    const headSha = path.basename(o.out.join('').trim(), '.json');
    const o2 = io(repo, JSON.stringify({ source: 'coderabbit', headSha, comments: [{ path: 'b.kt', line: 2, side: 'LEFT', body: 'y' }] }));
    expect(await run(['comments', 'add', '--from', '-'], o2)).toBe(0);
  });

  it('--from が無い、または知らない headSha は exit 1', async () => {
    const o = io(repo);
    expect(await run(['comments', 'add'], o)).toBe(1);
    expect(o.err.join('')).toMatch(/--from/);
    const o2 = io(repo, JSON.stringify({ source: 's', headSha: 'f'.repeat(40), comments: [] }));
    expect(await run(['comments', 'add', '--from', '-'], o2)).toBe(1);
    expect(o2.err.join('')).toMatch(/headSha/);
  });
});

describe('ondina comments wait（AI に返したコメントを待つ。12 章）', () => {
  const adopt = (headSha: string, body: string) =>
    writeState(repo, 'local', headSha, { viewed: [], comments: [{ id: body, path: 'a.kt', line: 3, side: 'RIGHT', body, source: 'reviewer', state: 'adopted' }] });

  it('届くまで待ち、届いたら JSON で表示して exit 0。待つ間は待ち印を置き、終わったら外す', async () => {
    const o = io(repo);
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount'], o)).toBe(0);
    const headSha = path.basename(o.out.join('').trim(), '.json');
    const w = { ...io(repo), pollMs: 10 };
    let done = false;
    const waiting = run(['comments', 'wait'], w).then((code) => {
      done = true;
      return code;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(false);
    expect(isWaiting(repo)).toBe(true);
    adopt(headSha, '名前を揃えて');
    expect(returnComments(repo, headSha).waiting).toBe(true);
    expect(await waiting).toBe(0);
    expect(JSON.parse(w.out.join(''))).toEqual({ comments: [{ headSha, path: 'a.kt', line: 3, side: 'RIGHT', body: '名前を揃えて', source: 'reviewer' }] });
    expect(w.err.join('')).toMatch(/1 件/);
    expect(isWaiting(repo)).toBe(false);
  });

  it('待つ前に届いていたものはすぐ表示する。二度は出さない', async () => {
    const headSha = listAnalyses(repo).find((a) => a.key === 'local')!.headSha;
    adopt(headSha, '先に返した');
    returnComments(repo, headSha);
    const w = { ...io(repo), pollMs: 10 };
    expect(await run(['comments', 'wait'], w)).toBe(0);
    expect((JSON.parse(w.out.join('')) as { comments: Array<{ body: string }> }).comments.map((c) => c.body)).toEqual(['先に返した']);
  });

  it('知らないサブコマンドは exit 1 で add と wait を案内する', async () => {
    const o = io(repo);
    expect(await run(['comments', 'nope'], o)).toBe(1);
    expect(o.err.join('')).toMatch(/add と wait/);
  });
});

describe('ondina list（AI エージェントが版を知る。設計書 12 章）', () => {
  it('解析済みを新しい順に 1 行ずつ、key・headSha・baseSha・題をタブで区切って出す', async () => {
    const o = io(repo);
    expect(await run(['analyze', '--base', 'main', '--head', 'feature/discount'], o)).toBe(0);
    const headSha = path.basename(o.out.join('').trim(), '.json');
    const analysis = JSON.parse(readFileSync(o.out.join('').trim(), 'utf8')) as { pr: { baseSha: string; title: string } };
    const o2 = io(repo);
    expect(await run(['list'], o2)).toBe(0);
    expect(o2.out.join('').split('\n')[0]).toBe(`local\t${headSha}\t${analysis.pr.baseSha}\t${analysis.pr.title}`);
  });

  it('解析が無ければ標準エラーに案内を出して exit 0（標準出力は空）', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-list-'));
    try {
      git(dir, 'init', '-q');
      const o = io(dir);
      expect(await run(['list'], o)).toBe(0);
      expect(o.out.join('')).toBe('');
      expect(o.err.join('')).toMatch(/ondina analyze/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('引数は取らない', async () => {
    const o = io(repo);
    expect(await run(['list', '12'], o)).toBe(1);
  });
});

describe('ondina serve の引数', () => {
  it('--port と初期選択の PR 番号を受ける', () => {
    expect(parseServeArgs([])).toEqual({ port: 4177 });
    expect(parseServeArgs(['--port', '5000', '12'])).toEqual({ port: 5000, initialKey: '12' });
    expect(parseServeArgs(['--port', 'abc'])).toEqual({ error: expect.stringMatching(/--port/) });
    expect(parseServeArgs(['--nope'])).toEqual({ error: expect.stringMatching(/--nope/) });
  });

  it('--background を受ける', () => {
    expect(parseServeArgs(['--background', '12'])).toEqual({ port: 4177, initialKey: '12', background: true });
  });
});

describe('ondina serve --background（設計書 12 章）', () => {
  const bg = (over: object) => ({
    probe: async () => ({ kind: 'free' as const }),
    spawn: () => ({ pid: 4321, exitCode: () => undefined }),
    readLog: () => 'ondina serve: http://127.0.0.1:4177/pr/12\n',
    sleep: async () => {},
    ...over,
  });

  it('起動したら URL を標準出力に、pid と止め方を標準エラーに出して exit 0', async () => {
    const o = { ...io(repo), background: bg({}) };
    expect(await run(['serve', '--background', '12'], o)).toBe(0);
    expect(o.out.join('')).toBe('ondina serve: http://127.0.0.1:4177/pr/12\n');
    expect(o.err.join('')).toMatch(/pid 4321.*ondina serve stop 4177/);
  });

  it('このリポジトリの serve が動いていれば、そう出して同じ形の URL を出す', async () => {
    const o = { ...io(repo), background: bg({ probe: async () => ({ kind: 'ondina', repo, pid: 999 }) }) };
    expect(await run(['serve', '--background', '12'], o)).toBe(0);
    expect(o.out.join('')).toBe('ondina serve: http://127.0.0.1:4177/pr/12\n');
    expect(o.err.join('')).toMatch(/動いています.*pid 999/);
  });

  it('ポートを別のリポジトリの serve が使っていれば、そう出して空いているポートで起動する', async () => {
    const o = {
      ...io(repo),
      background: bg({ probe: async () => ({ kind: 'ondina', repo: '/somewhere/else', pid: 999 }), readLog: () => 'ondina serve: http://127.0.0.1:50123/pr/12\n' }),
    };
    expect(await run(['serve', '--background', '12'], o)).toBe(0);
    expect(o.out.join('')).toBe('ondina serve: http://127.0.0.1:50123/pr/12\n');
    expect(o.err.join('')).toContain('4177 番は別のリポジトリの serve（/somewhere/else）が使っています。空いているポートで起動しました');
  });

  it('local を開くとき、ポートを同じリポジトリの別の worktree の serve が使っていれば、使えない理由を出して空いているポートで起動する', async () => {
    const wt = `${repo}-bg-wt`;
    git(repo, 'worktree', 'add', '--detach', wt, 'main');
    try {
      const o = {
        ...io(wt),
        background: bg({ probe: async () => ({ kind: 'ondina', repo, pid: 999 }), readLog: () => 'ondina serve: http://127.0.0.1:50123/local\n' }),
      };
      expect(await run(['serve', '--background', 'local'], o)).toBe(0);
      expect(o.out.join('')).toBe('ondina serve: http://127.0.0.1:50123/local\n');
      expect(o.err.join('')).toContain(`4177 番は同じリポジトリの別の worktree（${repo}）の serve が使っています。PR のない変更はその画面に表示できないので、空いているポートで起動しました`);
    } finally {
      rmSync(wt, { recursive: true, force: true });
      git(repo, 'worktree', 'prune');
    }
  });

  it('起こすところで例外が出ても、理由を出して exit 1', async () => {
    const o = { ...io(repo), background: bg({ spawn: () => { throw new Error('EPERM: operation not permitted'); } }) };
    expect(await run(['serve', '--background'], o)).toBe(1);
    expect(o.err.join('')).toMatch(/バックグラウンドで起動できませんでした: .*EPERM: operation not permitted/);
  });

  it('起動できなければ理由を出して exit 1', async () => {
    const o = { ...io(repo), background: bg({ spawn: () => ({ pid: 4321, exitCode: () => 1 }), readLog: () => 'boom\n' }) };
    expect(await run(['serve', '--background'], o)).toBe(1);
    expect(o.out.join('')).toBe('');
    expect(o.err.join('')).toMatch(/起動できませんでした.*boom/s);
  });
});

describe('ondina serve list / stop / restart（設計書 12 章）', () => {
  // 動いている serve の偽物。kill で SIGTERM を受けたものは、待ち受けをやめる
  function world(serves: Array<{ pid: number; port: number; folder: string; version?: string; startedAt?: string }>, opts: { stuck?: number[] } = {}) {
    const alive = new Map(serves.map((s) => [s.port, s]));
    const killed: number[] = [];
    let now = 0;
    const servers = {
      listeners: async () => [...alive.values()].map((s) => ({ pid: s.pid, port: s.port })),
      probe: async (port: number) => {
        const s = alive.get(port);
        return s === undefined ? undefined : { repo: s.folder, pid: s.pid, ...(s.version === undefined ? {} : { version: s.version }), ...(s.startedAt === undefined ? {} : { startedAt: s.startedAt }) };
      },
      kill: (pid: number) => {
        killed.push(pid);
        if (opts.stuck?.includes(pid)) return;
        for (const [port, s] of alive) if (s.pid === pid) alive.delete(port);
      },
      sleep: async (ms: number) => void (now += ms),
      now: () => now,
    };
    const spawned: Array<{ repo: string; args: string[] }> = [];
    const background = {
      probe: async (port: number) => {
        const s = alive.get(port);
        return s === undefined ? { kind: 'free' as const } : { kind: 'ondina' as const, repo: s.folder, pid: s.pid };
      },
      spawn: (r: string, args: string[]) => {
        spawned.push({ repo: r, args });
        return { pid: 5000 + spawned.length, exitCode: () => undefined };
      },
      readLog: () => `ondina serve: http://127.0.0.1:${spawned.at(-1)?.args[2]}/\n`,
      sleep: async () => {},
    };
    return { servers, background, killed, spawned };
  }

  const installed = () => git(repo, 'rev-parse', '--short=7', 'HEAD');

  it('list: 動いている serve をポート順に標準出力に出し、更新前のものがあれば起動し直すコマンドを標準エラーに出す', async () => {
    const w = world([
      { pid: 56341, port: 4231, folder: '/somewhere/old' },
      { pid: 700, port: 4177, folder: repo, version: installed(), startedAt: new Date(2026, 9, 23, 9, 5).toISOString() },
    ]);
    const o = { ...io('/'), selfRoot: repo, servers: w.servers };
    expect(await run(['serve', 'list'], o)).toBe(0);
    const lines = o.out.join('').trimEnd().split('\n');
    expect(lines[0]).toMatch(/^ポート +pid +起動 +バージョン +フォルダ$/);
    expect(lines[1]).toMatch(new RegExp(`^4177 +700 +10/23 09:05 +${installed()} +${repo}$`));
    expect(lines[2]).toMatch(/^4231 +56341 +— +—（更新前） +\/somewhere\/old$/);
    expect(lines).toHaveLength(3);
    expect(o.err.join('')).toContain('ondina serve restart 4231');
    expect(o.err.join('')).not.toContain('4177');
  });

  it('list: 全部今のバージョンなら案内を出さない。動いていなければそう出す（標準出力は空）', async () => {
    const current = { ...io('/'), selfRoot: repo, servers: world([{ pid: 700, port: 4177, folder: repo, version: installed() }]).servers };
    expect(await run(['serve', 'list'], current)).toBe(0);
    expect(current.err).toEqual([]);
    const none = { ...io('/'), selfRoot: repo, servers: world([]).servers };
    expect(await run(['serve', 'list'], none)).toBe(0);
    expect(none.out.join('')).toBe('');
    expect(none.err.join('')).toContain('動いている serve はありません');
  });

  it('list は引数を指定できない', async () => {
    const o = { ...io('/'), servers: world([]).servers };
    expect(await run(['serve', 'list', '4177'], o)).toBe(1);
  });

  it('stop <ポート>...: そのポートの serve だけを止めて exit 0', async () => {
    const w = world([
      { pid: 700, port: 4177, folder: repo },
      { pid: 701, port: 4178, folder: repo },
      { pid: 702, port: 4179, folder: '/x' },
    ]);
    const o = { ...io('/'), servers: w.servers };
    expect(await run(['serve', 'stop', '4177', '4179'], o)).toBe(0);
    expect(w.killed).toEqual([700, 702]);
    expect(o.out.join('')).toContain('4177 番の serve を止めました');
    expect(o.out.join('')).toContain('4179 番の serve を止めました');
  });

  it('stop --all: 全部止める', async () => {
    const w = world([
      { pid: 700, port: 4177, folder: repo },
      { pid: 702, port: 4179, folder: '/x' },
    ]);
    const o = { ...io('/'), servers: w.servers };
    expect(await run(['serve', 'stop', '--all'], o)).toBe(0);
    expect(w.killed.sort()).toEqual([700, 702]);
  });

  it('stop: ポートも --all も無ければ、一覧を添えて exit 1（何も止めない）', async () => {
    const w = world([{ pid: 700, port: 4177, folder: repo }]);
    const o = { ...io('/'), servers: w.servers };
    expect(await run(['serve', 'stop'], o)).toBe(1);
    expect(o.err.join('')).toMatch(/--all/);
    expect(o.err.join('')).toMatch(/^4177 +700 /m);
    expect(w.killed).toEqual([]);
  });

  it('stop: serve の動いていないポートが混ざっていれば、どれも止めずに exit 1', async () => {
    const w = world([{ pid: 700, port: 4177, folder: repo }]);
    const o = { ...io('/'), servers: w.servers };
    expect(await run(['serve', 'stop', '4177', '9999'], o)).toBe(1);
    expect(o.err.join('')).toContain('9999 番で動いている serve はありません');
    expect(w.killed).toEqual([]);
  });

  it('stop: ポート番号でない・--all と同時は exit 1', async () => {
    for (const args of [['serve', 'stop', 'abc'], ['serve', 'stop', '--all', '4177'], ['serve', 'stop', '--nope']]) {
      const w = world([{ pid: 700, port: 4177, folder: repo }]);
      const o = { ...io('/'), servers: w.servers };
      expect(await run(args, o)).toBe(1);
      expect(w.killed).toEqual([]);
    }
  });

  it('stop: 10 秒たっても止まらなければ kill -9 を案内して exit 1', async () => {
    const w = world([{ pid: 700, port: 4177, folder: repo }], { stuck: [700] });
    const o = { ...io('/'), servers: w.servers };
    expect(await run(['serve', 'stop', '4177'], o)).toBe(1);
    expect(o.err.join('')).toContain('kill -9 700');
  });

  it('restart <ポート>: 止めてから、同じフォルダ・同じポートでバックグラウンドで起動し直し、URL を標準出力に出す', async () => {
    const w = world([
      { pid: 700, port: 4177, folder: repo },
      { pid: 701, port: 4178, folder: '/x' },
    ]);
    const o = { ...io('/'), servers: w.servers, background: w.background };
    expect(await run(['serve', 'restart', '4177'], o)).toBe(0);
    expect(w.killed).toEqual([700]);
    expect(w.spawned).toEqual([{ repo, args: ['serve', '--port', '4177'] }]);
    expect(o.out.join('')).toContain('ondina serve: http://127.0.0.1:4177/\n');
  });

  it('restart --all: 全部を 1 つずつ起動し直す', async () => {
    const other = mkdtempSync(path.join(os.tmpdir(), 'ondina-restart-'));
    try {
      const w = world([
        { pid: 700, port: 4177, folder: repo },
        { pid: 701, port: 4178, folder: other },
      ]);
      const o = { ...io('/'), servers: w.servers, background: w.background };
      expect(await run(['serve', 'restart', '--all'], o)).toBe(0);
      expect(w.spawned).toEqual([
        { repo, args: ['serve', '--port', '4177'] },
        { repo: other, args: ['serve', '--port', '4178'] },
      ]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('restart: フォルダがもう無ければ、止めずに exit 1', async () => {
    const w = world([{ pid: 700, port: 4177, folder: path.join(repo, 'gone') }]);
    const o = { ...io('/'), servers: w.servers, background: w.background };
    expect(await run(['serve', 'restart', '4177'], o)).toBe(1);
    expect(w.killed).toEqual([]);
    expect(w.spawned).toEqual([]);
    expect(o.err.join('')).toContain('ondina serve stop 4177');
  });
});

describe('ondina --version（設計書 5.5 clone して入れる）', () => {
  it('自分の clone のコミットと日付を出して exit 0', async () => {
    const o = { ...io(repo), selfRoot: repo };
    expect(await run(['--version'], o)).toBe(0);
    expect(o.out.join('')).toBe(`ondina ${git(repo, 'rev-parse', '--short=7', 'HEAD')} (${git(repo, 'log', '-1', '--format=%cs')})\n`);
  });

  it('-v でも同じ', async () => {
    const o = { ...io(repo), selfRoot: repo };
    expect(await run(['-v'], o)).toBe(0);
    expect(o.out.join('')).toMatch(/^ondina [0-9a-f]{7} \(\d{4}-\d{2}-\d{2}\)\n$/);
  });

  it('clone の最上位でなければ版不明と出す', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-self-'));
    try {
      const o = { ...io(repo), selfRoot: dir };
      expect(await run(['--version'], o)).toBe(0);
      expect(o.out.join('')).toBe('ondina (バージョン不明)\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ondina update（設計書 5.5 clone して入れる）', () => {
  function selfWithScript() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-self-'));
    mkdirSync(path.join(dir, 'scripts'));
    writeFileSync(path.join(dir, 'scripts/install.sh'), '#!/bin/sh\n');
    return dir;
  }

  it('自分の clone の scripts/install.sh に版を渡して走らせ、その終了コードを返す', async () => {
    const dir = selfWithScript();
    try {
      const calls: [string, string[]][] = [];
      const o = { ...io(repo), selfRoot: dir, runScript: (file: string, args: string[]) => (calls.push([file, args]), 3) };
      expect(await run(['update', '1857abd'], o)).toBe(3);
      expect(calls).toEqual([[path.join(dir, 'scripts/install.sh'), ['1857abd']]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('版を書かなければ引数なしで走らせる（main の最新）', async () => {
    const dir = selfWithScript();
    try {
      const calls: [string, string[]][] = [];
      const o = { ...io(repo), selfRoot: dir, runScript: (file: string, args: string[]) => (calls.push([file, args]), 0) };
      expect(await run(['update'], o)).toBe(0);
      expect(calls).toEqual([[path.join(dir, 'scripts/install.sh'), []]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('引数が 2 つ以上なら走らせずに exit 1', async () => {
    const dir = selfWithScript();
    try {
      const calls: [string, string[]][] = [];
      const o = { ...io(repo), selfRoot: dir, runScript: (file: string, args: string[]) => (calls.push([file, args]), 0) };
      expect(await run(['update', 'a', 'b'], o)).toBe(1);
      expect(calls).toEqual([]);
      expect(o.err.join('')).toContain('引数が多すぎます');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('スクリプトが無ければ案内を出して exit 1', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-self-'));
    try {
      const o = { ...io(repo), selfRoot: dir, runScript: () => 0 };
      expect(await run(['update'], o)).toBe(1);
      expect(o.err.join('')).toContain('clone からインストールした ondina ではないので、update できません');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('使い方に update と --version が載っている', () => {
    expect(usage).toContain('ondina update [<バージョン>]');
    expect(usage).toContain('kotlin-lsp も最新にする（scripts/install-kotlin-lsp.sh）');
    expect(usage).toContain('ondina --version');
  });
});

// Jira のトークンを Mac のキーチェーンに入れる（2026-10-12）。キーチェーンと入力は差し替える
describe('ondina token', () => {
  const fake = (over: Record<string, unknown> = {}) => {
    const writes: string[][] = [];
    const prompts: string[] = [];
    let stored: string | undefined;
    const keychain = {
      platform: 'darwin' as NodeJS.Platform,
      env: {},
      account: 'me',
      readSecret: async (prompt: string) => (prompts.push(prompt), 'tok-123'),
      write: async (service: string, account: string, secret: string) => (writes.push([service, account, secret]), (stored = secret), undefined),
      read: async () => (stored === undefined ? { none: true as const } : { token: stored }),
      ...over,
    };
    return { keychain, writes, prompts };
  };
  it('隠して読んだトークンをキーチェーンの ondina-jira に入れ、読み戻して確かめる', async () => {
    const f = fake();
    const o = { ...io(repo), keychain: f.keychain };
    expect(await run(['token'], o)).toBe(0);
    expect(f.prompts).toEqual(['Jira のトークンを貼り付けて Enter を押してください（画面には表示されません。キーチェーンの ondina-jira に保存します）: ']);
    expect(f.writes).toEqual([['ondina-jira', 'me', 'tok-123']]);
    expect(o.out.join('')).toBe('Jira のトークン（7 文字）をキーチェーンの ondina-jira に保存しました。次の analyze から使います\n');
    expect(o.err).toEqual([]);
  });
  it('環境変数 ONDINA_TICKET_TOKEN もあれば、そちらが先に使われると知らせる', async () => {
    const o = { ...io(repo), keychain: fake({ env: { ONDINA_TICKET_TOKEN: 'old' } }).keychain };
    expect(await run(['token'], o)).toBe(0);
    expect(o.err.join('')).toBe('ondina token: 環境変数 ONDINA_TICKET_TOKEN もあり、そちらが先に使われます。~/.zshrc などの export を消してください\n');
  });
  it('Mac でなければ入れずに、環境変数を案内する', async () => {
    const f = fake({ platform: 'linux' });
    const o = { ...io(repo), keychain: f.keychain };
    expect(await run(['token'], o)).toBe(1);
    expect(o.err.join('')).toBe('ondina token: キーチェーンに保存できるのは Mac だけです。環境変数 ONDINA_TICKET_TOKEN にトークンを設定してください\n');
    expect(f.prompts).toEqual([]);
  });
  it('Ctrl+C・空ならキーチェーンを変えない', async () => {
    const cancel = fake({ readSecret: async () => undefined });
    const o1 = { ...io(repo), keychain: cancel.keychain };
    expect(await run(['token'], o1)).toBe(1);
    expect(o1.err.join('')).toBe('ondina token: 中止しました。キーチェーンは変更していません\n');
    const empty = fake({ readSecret: async () => '' });
    const o2 = { ...io(repo), keychain: empty.keychain };
    expect(await run(['token'], o2)).toBe(1);
    expect(o2.err.join('')).toBe('ondina token: トークンが空です。キーチェーンは変更していません\n');
    expect([...cancel.writes, ...empty.writes]).toEqual([]);
  });
  it('入れられなければ理由', async () => {
    const o = { ...io(repo), keychain: fake({ write: async () => '空白・引用符・\\ は使えません' }).keychain };
    expect(await run(['token'], o)).toBe(1);
    expect(o.err.join('')).toBe('ondina token: キーチェーンに保存できませんでした: 空白・引用符・\\ は使えません\n');
  });
  it('読み戻したものが違えば失敗にする', async () => {
    const o = { ...io(repo), keychain: fake({ read: async () => ({ token: 'other' }) }).keychain };
    expect(await run(['token'], o)).toBe(1);
    expect(o.err.join('')).toBe('ondina token: 保存したトークンを読み出せませんでした（別の値が保存されています）\n');
  });
  it('引数は取らない', async () => {
    const o = { ...io(repo), keychain: fake().keychain };
    expect(await run(['token', 'x'], o)).toBe(1);
    expect(o.err.join('')).toMatch(/^ondina token: 引数は指定できません\n/);
  });
});
