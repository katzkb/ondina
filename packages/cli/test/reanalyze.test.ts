// 画面から解析する（設計書 5.5。PR 一覧 3.11）: 順番待ちの列、子プロセスの進み・完了・失敗、引数の組み立て、新しい head の聞き方。
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Analysis } from '@ondina/model';
import { analyzeLocal } from '../src/analyze.js';
import { createAnalyzeRunner, latestHead, reanalyzeArgs, type AnalyzeChild, type ReanalyzeDeps } from '../src/reanalyze.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

const SHA = (c: string) => c.repeat(40);

function fakeChild() {
  const ev = new EventEmitter();
  const child: AnalyzeChild & { stdout: PassThrough; stderr: PassThrough } = {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    once: (event: string, f: (...a: never[]) => void) => {
      ev.once(event, f);
      return child;
    },
  } as never;
  const close = async (code: number | null) => {
    child.stdout.end();
    child.stderr.end();
    await new Promise((r) => setImmediate(r));
    ev.emit('close', code);
  };
  return { child, close, fail: (e: Error) => ev.emit('error', e) };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('reanalyzeArgs', () => {
  const pr = (o: Partial<Analysis['pr']> = {}): Analysis['pr'] => ({ number: 7, title: 't', base: 'main', head: 'feature/x', baseSha: SHA('b'), headSha: SHA('a'), body: '本文', ...o });

  it('PR は番号で解析し直す', () => {
    expect(reanalyzeArgs('7', pr(), '/r/body.md')).toEqual(['analyze', '7']);
  });

  it('--ticket で指定したチケットは同じ値を渡す。題と本文から探したもの・ファイルは渡さない', () => {
    expect(reanalyzeArgs('7', pr({ ticket: { source: 'jira', ref: 'SHOP-421', key: 'SHOP-421', at: 'x' } }), '/r/body.md')).toEqual(['analyze', '7', '--ticket', 'SHOP-421']);
    expect(reanalyzeArgs('7', pr({ ticket: { source: 'jira', ref: 'SHOP-421', at: 'x' }, ticketSearch: { candidates: [] } }), '/r/body.md')).toEqual(['analyze', '7']);
    expect(reanalyzeArgs('7', pr({ ticket: { source: 'file', ref: 'ticket.md', at: 'x' } }), '/r/body.md')).toEqual(['analyze', '7']);
  });

  it('local は同じ 2 つの ref と題、保存した本文のファイル', () => {
    expect(reanalyzeArgs('local', pr({ number: 0 }), '/r/body.md')).toEqual(['analyze', '--base', 'main', '--head', 'feature/x', '--title', 't', '--body', '/r/body.md']);
  });

  it('作業ツリーの解析は --head を付けない（今の作業ツリーを解析し直す）', () => {
    expect(reanalyzeArgs('local', pr({ number: 0, workingTree: true }), '/r/body.md')).toEqual(['analyze', '--base', 'main', '--title', 't', '--body', '/r/body.md']);
  });
});

describe('createAnalyzeRunner', () => {
  let repo: string;
  let cleanup: () => void;
  let headSha: string;
  beforeAll(async () => {
    ({ dir: repo, cleanup } = buildFixtureRepo());
    headSha = (await analyzeLocal(repo, 'main', 'feature/discount')).analysis.pr.headSha;
  });
  afterAll(() => cleanup());

  /** 起動するたびに新しい偽の子を作る。spawned[i] が i 本目の引数と子 */
  function runner(now = () => 1000) {
    const spawned: Array<{ args: string[] } & ReturnType<typeof fakeChild>> = [];
    const r = createAnalyzeRunner(repo, {
      spawn: (_repo, args) => {
        const f = fakeChild();
        spawned.push({ args, ...f });
        return f.child;
      },
      now,
    } satisfies Partial<ReanalyzeDeps>);
    return { r, spawned };
  }

  it('始めると running。進みは子の標準エラーの最後の 1 行（ondina analyze: を外す）。終わると新しい headSha', async () => {
    const { r, spawned } = runner();
    expect(r.jobs()).toEqual([]);
    expect(r.start('local', headSha)).toEqual({ status: 'running', key: 'local', from: headSha, startedAt: 1000 });
    const body = path.join(repo, '.ondina', 'local', 'reanalyze-body.md');
    expect(spawned.map((s) => s.args)).toEqual([['analyze', '--base', 'main', '--head', 'feature/discount', '--title', 'main..feature/discount', '--body', body]]);
    expect(readFileSync(body, 'utf8')).toBe(JSON.parse(readFileSync(path.join(repo, '.ondina', 'local', `${headSha}.json`), 'utf8')).pr.body);
    const f = spawned[0]!;
    f.child.stderr.write('ondina analyze: 差分を切り出しています\nondina analyze: 言語サーバーの準備を待っています（30 秒）: Indexing（42%）\n');
    await tick();
    expect(r.jobs()).toEqual([{ status: 'running', key: 'local', from: headSha, startedAt: 1000, line: '言語サーバーの準備を待っています（30 秒）: Indexing（42%）' }]);
    f.child.stdout.write(`${path.join(repo, '.ondina', 'local', `${SHA('c')}.json`)}\n`);
    await f.close(0);
    expect(r.jobs()).toEqual([{ status: 'done', key: 'local', from: headSha, headSha: SHA('c') }]);
  });

  it('版を渡さなければ PR 番号で解析する（一覧から初めて解析する）。local と番号でない key は missing', () => {
    const { r, spawned } = runner();
    expect(r.start('42')).toEqual({ status: 'running', key: '42', startedAt: 1000 });
    expect(spawned.map((s) => s.args)).toEqual([['analyze', '42']]);
    expect(r.start('local')).toEqual({ error: 'missing' });
    expect(r.start('../x')).toEqual({ error: 'missing' });
    expect(spawned).toHaveLength(1);
  });

  it('走っている間に頼まれた解析は順番待ちの列の後ろへ。同じ key が順番待ちか解析中なら busy', () => {
    let t = 1000;
    const { r, spawned } = runner(() => t++);
    r.start('41');
    expect(r.start('42')).toEqual({ status: 'queued', key: '42', queuedAt: 1001 });
    expect(r.start('local', headSha)).toEqual({ status: 'queued', key: 'local', from: headSha, queuedAt: 1002 });
    expect(r.start('41')).toEqual({ error: 'busy' });
    expect(r.start('42')).toEqual({ error: 'busy' });
    expect(spawned).toHaveLength(1);
    expect(r.jobs().map((j) => [j.key, j.status])).toEqual([
      ['42', 'queued'],
      ['local', 'queued'],
      ['41', 'running'],
    ]);
  });

  it('終わったら（成功でも失敗でも）列の先頭を起動する。jobs は順番待ち → 解析中 → 終わったもの', async () => {
    const { r, spawned } = runner();
    r.start('41');
    r.start('42');
    r.start('43');
    spawned[0]!.child.stdout.write(`/r/.ondina/41/${SHA('1')}.json\n`);
    await spawned[0]!.close(0);
    expect(spawned.map((s) => s.args)).toEqual([['analyze', '41'], ['analyze', '42']]);
    expect(r.jobs().map((j) => [j.key, j.status])).toEqual([
      ['43', 'queued'],
      ['42', 'running'],
      ['41', 'done'],
    ]);
    spawned[1]!.child.stderr.write('ondina analyze: gh pr view 42 に失敗しました: HTTP 401\n');
    await spawned[1]!.close(1);
    expect(spawned.map((s) => s.args[1])).toEqual(['41', '42', '43']);
    expect(r.jobs()).toContainEqual({ status: 'failed', key: '42', reason: 'gh pr view 42 に失敗しました: HTTP 401' });
    expect(r.jobs().map((j) => [j.key, j.status])).toEqual([
      ['43', 'running'],
      ['41', 'done'],
      ['42', 'failed'],
    ]);
  });

  it('解析が無い版からは始めない', () => {
    const { r } = runner();
    expect(r.start('local', SHA('0'))).toEqual({ error: 'missing' });
    expect(r.jobs()).toEqual([]);
  });

  it('失敗したら標準エラーの最後の 1 行を理由に。行が無ければ終了コード', async () => {
    const { r, spawned } = runner();
    r.start('local', headSha);
    spawned[0]!.child.stderr.write('ondina analyze: base と head のコードを用意しています\nondina analyze: gh pr view 7 に失敗しました: HTTP 401\n');
    await spawned[0]!.close(1);
    expect(r.jobs()).toEqual([{ status: 'failed', key: 'local', from: headSha, reason: 'gh pr view 7 に失敗しました: HTTP 401' }]);

    r.start('42');
    await spawned[1]!.close(2);
    expect(r.jobs()).toContainEqual({ status: 'failed', key: '42', reason: '終了コード 2 で終了しました' });
  });

  it('子を起こせなければ失敗にして次へ。後から来た close では 2 回進めない', async () => {
    const { r, spawned } = runner();
    r.start('41');
    r.start('42');
    r.start('43');
    spawned[0]!.fail(new Error('spawn node ENOENT'));
    await spawned[0]!.close(null);
    expect(r.jobs()).toContainEqual({ status: 'failed', key: '41', reason: '解析を起動できませんでした: spawn node ENOENT' });
    expect(spawned.map((s) => s.args[1])).toEqual(['41', '42']);
  });

  it('終わった後はまた始められる', async () => {
    const { r, spawned } = runner();
    r.start('local', headSha);
    await spawned[0]!.close(1);
    expect(r.start('local', headSha)).toMatchObject({ status: 'running' });
    expect(spawned).toHaveLength(2);
  });
});

describe('latestHead', () => {
  const analysis = (o: Partial<Analysis['pr']>): Analysis => ({ pr: { number: 7, title: 't', base: 'main', head: 'feature/x', baseSha: SHA('b'), headSha: SHA('a'), body: '', ...o }, hunks: [], hows: [] }) as unknown as Analysis;

  it('PR は gh の head と、今の版より後ろのコミット数', async () => {
    const prHead: ReanalyzeDeps['prHead'] = async () => ({ headSha: SHA('d'), commits: [SHA('1'), SHA('a'), SHA('c'), SHA('d')] });
    expect(await latestHead('/nowhere', '7', analysis({}), { prHead })).toEqual({ headSha: SHA('d'), newCommits: 2, analyzed: false });
  });

  it('今の版がコミットに無い（履歴の書き換え）なら数を出さない', async () => {
    const prHead: ReanalyzeDeps['prHead'] = async () => ({ headSha: SHA('d'), commits: [SHA('d')] });
    expect(await latestHead('/nowhere', '7', analysis({}), { prHead })).toEqual({ headSha: SHA('d'), analyzed: false });
  });

  describe('local', () => {
    let repo: string;
    let cleanup: () => void;
    let first: Analysis;
    beforeAll(async () => {
      ({ dir: repo, cleanup } = buildFixtureRepo());
      first = (await analyzeLocal(repo, 'main', 'feature/discount')).analysis;
    });
    afterAll(() => cleanup());

    it('head の ref を git で読む。同じなら解析済み・変わった差分 0', async () => {
      expect(await latestHead(repo, 'local', first)).toEqual({ headSha: first.pr.headSha, newCommits: 0, analyzed: true, changed: 0 });
    });

    it('コミットが積まれたら新しい head と数。解析し直すと解析済みと変わった差分の数', async () => {
      const id = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false'];
      git(repo, 'checkout', '-q', 'feature/discount');
      const order = path.join(repo, 'src/main/kotlin/com/example/order/domain/Order.kt');
      writeFileSync(order, readFileSync(order, 'utf8').replace('discount = subtotal * rate', 'discount = (subtotal * rate).roundDown()'));
      git(repo, ...id, 'commit', '-q', '-am', 'Round the discount down');
      git(repo, ...id, 'commit', '-q', '--allow-empty', '-m', 'Empty');
      git(repo, 'checkout', '-q', 'main');
      const head = git(repo, 'rev-parse', 'feature/discount');
      expect(await latestHead(repo, 'local', first)).toEqual({ headSha: head, newCommits: 2, analyzed: false });
      await analyzeLocal(repo, 'main', 'feature/discount');
      expect(await latestHead(repo, 'local', first)).toEqual({ headSha: head, newCommits: 2, analyzed: true, changed: 1 });
    });
  });

  describe('作業ツリー（pr.workingTree）', () => {
    let repo: string;
    let cleanup: () => void;
    let first: Analysis;
    const order = () => path.join(repo, 'src/main/kotlin/com/example/order/domain/Order.kt');
    beforeAll(async () => {
      ({ dir: repo, cleanup } = buildFixtureRepo());
      git(repo, 'checkout', '-q', 'feature/discount');
      writeFileSync(order(), readFileSync(order(), 'utf8') + '\n// 作業中\n');
      first = (await analyzeLocal(repo, 'main', undefined)).analysis;
    });
    afterAll(() => cleanup());

    it('作業ツリーが同じなら同じ tree。コミットの数は数えない', async () => {
      expect(await latestHead(repo, 'local', first)).toEqual({ headSha: first.pr.headSha, analyzed: true, changed: 0 });
    });

    it('作業ツリーが変わったら新しい tree。解析し直すと解析済み', async () => {
      writeFileSync(order(), readFileSync(order(), 'utf8').replace('discount = subtotal * rate', 'discount = (subtotal * rate).roundDown()'));
      const next = await latestHead(repo, 'local', first);
      expect(next.headSha).not.toBe(first.pr.headSha);
      expect(next).toEqual({ headSha: next.headSha, analyzed: false });
      await analyzeLocal(repo, 'main', undefined);
      expect(await latestHead(repo, 'local', first)).toEqual({ headSha: next.headSha, analyzed: true, changed: 1 });
    });
  });
});
