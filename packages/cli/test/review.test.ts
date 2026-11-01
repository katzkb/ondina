// PR 一覧から AI にレビューを頼む（設計書 3.11 / 5.5）: 設定のコマンドを PR ごとに起動し、stdout の JSON を AI の下書きに入れる。
// コマンドは本物の sh の 1 行（stdin・環境変数・stdout・終了コード・時間切れ・止める を実物で通す）。解析は偽の子プロセスの列で進める。
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CommentDraft, ReviewJob } from '@ondina/model';
import { createAnalyzeRunner, type AnalyzeChild } from '../src/reanalyze.js';
import { createReviewRunner } from '../src/review.js';
import { pidAlive, readState, writeState, writeUi } from '../src/store.js';
import { buildFixtureRepo, FIXTURE_ROOT } from './fixture-repo.js';

const SHA = (c: string) => c.repeat(40);
const BASE = SHA('b');
const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
const POLICY = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';

let repo: string;
let cleanup: () => void;
let out: string;
beforeAll(() => {
  ({ dir: repo, cleanup } = buildFixtureRepo());
  out = path.join(repo, 'out');
  mkdirSync(out);
});
afterAll(() => cleanup());

/** PR の解析ファイル（analyze が書くもの）。GitHub の差分の塊は fixture の本物（Order.kt は head 側 3〜14 行目。DiscountPolicy.kt は差分なし） */
function writePr(key: string, headSha: string, pr: Record<string, unknown> = {}): void {
  const githubDiff: unknown = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'expected/github-diff.json'), 'utf8'));
  const analysis = { pr: { number: Number(key), title: '割引を足す', base: 'main', head: 'feature/discount', baseSha: BASE, headSha, ...pr }, githubDiff, hunks: [] };
  mkdirSync(path.join(repo, '.ondina', key), { recursive: true });
  writeFileSync(path.join(repo, '.ondina', key, `${headSha}.json`), JSON.stringify(analysis));
}

/** stdout に出す JSON（シングルクォートで囲める文字だけ） */
const print = (doc: unknown) => `printf '%s' '${JSON.stringify(doc)}'`;
const comment = (line: number, body: string, file = ORDER) => ({ path: file, line, side: 'RIGHT', body });

function fakeChild() {
  const ev = new EventEmitter();
  const child = { stdout: new PassThrough(), stderr: new PassThrough(), once: (e: string, f: (...a: never[]) => void) => (ev.once(e, f), child) } as unknown as AnalyzeChild & { stdout: PassThrough; stderr: PassThrough };
  const close = async (code: number, stdout = '', stderr = '') => {
    child.stdout.end(stdout);
    child.stderr.end(stderr);
    await new Promise((r) => setImmediate(r));
    ev.emit('close', code);
  };
  return { child, close };
}

/** 解析の列（偽の子プロセス）と、その上の AI レビュー。command は設定の「AI レビューのコマンド」 */
function setup(command: string | undefined, timeoutMs = 20_000) {
  writeUi(repo, command === undefined ? {} : { reviewCommand: command });
  const spawned: Array<{ args: string[] } & ReturnType<typeof fakeChild>> = [];
  const analyze = createAnalyzeRunner(repo, {
    spawn: (_r, args) => {
      const f = fakeChild();
      spawned.push({ args, ...f });
      return f.child;
    },
    now: () => 1000,
  });
  const review = createReviewRunner(repo, analyze, { now: () => 2000, timeoutMs });
  const job = (key: string) => review.jobs().find((j) => j.key === key);
  const settled = (key: string) => vi.waitFor(() => {
    const j = job(key);
    expect(j?.status === 'waiting' || j?.status === 'running').toBe(false);
    return j!;
  }, { timeout: 8000, interval: 20 });
  return { analyze, review, spawned, job, settled };
}

const drafts = (key: string, headSha: string) => readState(repo, key, headSha).comments.map((c) => [c.source, c.path, c.line, c.side, c.body, c.state]);

describe('今の head の解析があれば、すぐ走る', () => {
  it('stdin に指示文、環境変数に番号と base / head の sha。stdout の JSON（headSha なし）を AI の下書きに入れて done', async () => {
    const head = SHA('1');
    writePr('7', head);
    const command = `env | grep -E '^ONDINA_(PR|BASE_SHA|HEAD_SHA)=' | sort > ${out}/env7.txt; cat > ${out}/prompt7.txt; ${print({ source: 'fake', comments: [comment(3, '[ask] 一つ目')] })}`;
    const { review, spawned, settled } = setup(command);
    expect(review.start('7', head)).toEqual({ status: 'running', key: '7', headSha: head, startedAt: 2000 });
    expect(await settled('7')).toEqual({ status: 'done', key: '7', headSha: head, drafts: 1, skipped: 0 });
    expect(drafts('7', head)).toEqual([['fake', ORDER, 3, 'RIGHT', '[ask] 一つ目', 'draft']]);
    expect(readFileSync(`${out}/env7.txt`, 'utf8')).toBe(`ONDINA_BASE_SHA=${BASE}\nONDINA_HEAD_SHA=${head}\nONDINA_PR=7\n`);
    const prompt = readFileSync(`${out}/prompt7.txt`, 'utf8');
    expect(prompt).toContain('#7');
    expect(prompt).toContain(`git diff ${BASE} ${head}`);
    expect(spawned).toEqual([]);
  });

  it('GitHub の差分に出ない行は 1 件ずつ除いて残りを入れ、除いた数を残す。コードフェンス付きの JSON も読む', async () => {
    const head = SHA('2');
    writePr('8', head);
    const doc = { source: 'fake', headSha: head, comments: [comment(3, '塊の中'), comment(20, '塊の外'), comment(10, '差分のないファイル', POLICY), comment(14, '塊の端')] };
    const { review, settled } = setup(`cat >/dev/null; printf '%s\\n' 'レビューしました。' '\`\`\`json' '${JSON.stringify(doc)}' '\`\`\`'`);
    review.start('8', head);
    expect(await settled('8')).toEqual({ status: 'done', key: '8', headSha: head, drafts: 2, skipped: 2 });
    expect(drafts('8', head).map((d) => d[4])).toEqual(['塊の中', '塊の端']);
  });

  it('stdout が空で終了コード 0 なら done（エージェントが自分で入れたかもしれない）。下書きの数は state の AI の下書き（未決・編集中・採用済み）で、聞くたびに数え直す', async () => {
    const head = SHA('3');
    writePr('9', head);
    const c = (id: string, source: string, state: CommentDraft['state']): CommentDraft => ({ id, path: ORDER, line: 3, side: 'RIGHT', body: id, source, state });
    writeState(repo, '9', head, { viewed: [], comments: [c('m', 'reviewer', 'adopted'), c('a', 'codex', 'draft'), c('b', 'codex', 'edit'), c('d', 'codex', 'discarded'), c('e', 'codex', 'adopted'), c('s', 'codex', 'sent')] });
    const { review, settled, job } = setup('cat >/dev/null');
    review.start('9', head);
    expect(await settled('9')).toEqual({ status: 'done', key: '9', headSha: head, drafts: 3, skipped: 0 });
    const state = readState(repo, '9', head);
    writeState(repo, '9', head, { ...state, comments: state.comments.map((x) => (x.id === 'a' ? { ...x, state: 'discarded' } : x)) });
    expect(job('9')).toMatchObject({ status: 'done', drafts: 2 });
  });
});

describe('失敗', () => {
  const cases: Array<[string, string, (head: string) => string, RegExp]> = [
    ['JSON でない出力（理由に出力の先頭を出す。コピー&ペーストできない環境では出力を貼れない）', '20', () => `cat >/dev/null; printf '%s\\n' 'レビューを終えました。' '指摘は 2 件です。'`, /^stdout に JSON オブジェクトがありません（出力の先頭: レビューを終えました。 指摘は 2 件です。）$/],
    ['形の違う JSON', '21', (head) => `cat >/dev/null; ${print({ source: 'fake', headSha: head, comments: [{ path: ORDER, line: '3' }] })}`, /コメント JSON の形式ではありません/],
    ['別の head の JSON', '22', () => `cat >/dev/null; ${print({ source: 'fake', headSha: SHA('9'), comments: [] })}`, new RegExp(`${SHA('9')}`)],
    ['終了コード 0 以外は stderr の最後の行', '23', () => `cat >/dev/null; echo first >&2; echo 'last line' >&2; exit 3`, /^last line$/],
    ['stderr が空なら終了コード', '24', () => 'cat >/dev/null; exit 4', /^終了コード 4 で終了しました$/],
  ];
  for (const [name, key, command, reason] of cases) {
    it(`${name}は failed と理由。下書きは入れない`, async () => {
      const head = SHA('4');
      writePr(key, head);
      const { review, settled } = setup(command(head));
      review.start(key, head);
      const j = await settled(key);
      expect(j).toMatchObject({ status: 'failed', key, headSha: head });
      expect((j as Extract<ReviewJob, { status: 'failed' }>).reason).toMatch(reason);
      expect(drafts(key, head)).toEqual([]);
    });
  }

  it('時間切れは止めて failed（n 分で終わりませんでした）', async () => {
    const head = SHA('5');
    writePr('25', head);
    const { review, settled } = setup('sleep 5', 200);
    review.start('25', head);
    expect(await settled('25')).toEqual({ status: 'failed', key: '25', headSha: head, reason: '0 分で終わりませんでした' });
  });
});

describe('止める', () => {
  it('レビュー中はコマンドをプロセスグループごと止めて stopped。後から終わっても下書きは入れない', async () => {
    const head = SHA('6');
    writePr('30', head);
    const { review, job } = setup(`echo $$ > ${out}/pid30.txt; sleep 3; ${print({ source: 'fake', headSha: head, comments: [comment(3, '遅い')] })}`);
    review.start('30', head);
    await vi.waitFor(() => expect(existsSync(`${out}/pid30.txt`)).toBe(true));
    const pid = Number(readFileSync(`${out}/pid30.txt`, 'utf8'));
    expect(review.stop('30')).toEqual({ status: 'stopped', key: '30', headSha: head });
    await vi.waitFor(() => expect(pidAlive(pid)).toBe(false));
    expect(job('30')).toEqual({ status: 'stopped', key: '30', headSha: head });
    expect(drafts('30', head)).toEqual([]);
  });

  it('解析待ちも stopped にする。解析はそのまま続き、終わってもレビューは始めない。動いていなければ止める物はない', async () => {
    const head = SHA('7');
    const { analyze, review, spawned, job } = setup(`cat > ${out}/prompt31.txt`);
    analyze.start('31');
    expect(review.start('31', head)).toEqual({ status: 'waiting', key: '31', headSha: head });
    expect(review.stop('31')).toEqual({ status: 'stopped', key: '31', headSha: head });
    expect(analyze.jobs()).toMatchObject([{ status: 'running', key: '31' }]);
    writePr('31', head);
    await spawned[0]!.close(0, path.join(repo, '.ondina', '31', `${head}.json`) + '\n');
    await new Promise((r) => setTimeout(r, 200));
    expect(job('31')).toEqual({ status: 'stopped', key: '31', headSha: head });
    expect(existsSync(`${out}/prompt31.txt`)).toBe(false);
    expect(review.stop('31')).toBeUndefined();
    expect(review.stop('99')).toBeUndefined();
  });
});

describe('解析を待つ', () => {
  it('今の head の解析が無ければ、PR 番号で解析を列に入れて待つ。解析が終わったら、解析した head をレビューする', async () => {
    const asked = SHA('a');
    const analyzed = SHA('c');
    const { review, spawned, settled } = setup(`cat >/dev/null; ${print({ source: 'fake', comments: [comment(4, '解析の後')] })}`);
    expect(review.start('40', asked)).toEqual({ status: 'waiting', key: '40', headSha: asked });
    expect(spawned.map((s) => s.args)).toEqual([['analyze', '40']]);
    writePr('40', analyzed);
    await spawned[0]!.close(0, path.join(repo, '.ondina', '40', `${analyzed}.json`) + '\n');
    expect(await settled('40')).toEqual({ status: 'done', key: '40', headSha: analyzed, drafts: 1, skipped: 0 });
    expect(drafts('40', analyzed).map((d) => d[4])).toEqual(['解析の後']);
  });

  it('前の head の解析があれば、その引数で解析し直す（--ticket で指定したチケットを引き継ぐ）', () => {
    writePr('41', SHA('d'), { ticket: { source: 'jira', ref: 'SHOP-421', key: 'SHOP-421', at: 'x' } });
    const { review, spawned } = setup('cat >/dev/null');
    review.start('41', SHA('e'));
    expect(spawned.map((s) => s.args)).toEqual([['analyze', '41', '--ticket', 'SHOP-421']]);
  });

  it('その PR の解析が順番待ちか解析中なら、今の head の解析があっても終わるまで待つ。解析に失敗したら failed', async () => {
    const head = SHA('f');
    writePr('42', head);
    const { analyze, review, spawned, settled } = setup('cat >/dev/null');
    analyze.start('42', head);
    expect(review.start('42', head)).toEqual({ status: 'waiting', key: '42', headSha: head });
    await spawned[0]!.close(1, '', 'ondina analyze: 言語サーバーが起動しませんでした\n');
    expect(await settled('42')).toEqual({ status: 'failed', key: '42', headSha: head, reason: '解析できませんでした: 言語サーバーが起動しませんでした' });
  });
});

describe('同時に走る・頼めないとき', () => {
  it('ほかの PR のレビューと同時に走る。同じ PR は解析待ちかレビュー中の間 busy', async () => {
    const head = SHA('0');
    writePr('50', head);
    writePr('51', head);
    const { review, settled } = setup(`sleep 0.5; ${print({ source: 'fake', comments: [] })}`);
    review.start('50', head);
    review.start('51', head);
    expect(review.jobs().map((j) => [j.key, j.status])).toEqual([
      ['50', 'running'],
      ['51', 'running'],
    ]);
    expect(review.start('50', head)).toEqual({ error: 'busy' });
    expect(await settled('50')).toMatchObject({ status: 'done', drafts: 0 });
    expect(await settled('51')).toMatchObject({ status: 'done', drafts: 0 });
  });

  it('コマンドが空なら nocommand。PR 番号でない key は missing', () => {
    writePr('52', SHA('0'));
    expect(setup(undefined).review.start('52', SHA('0'))).toEqual({ error: 'nocommand' });
    expect(setup('   ').review.start('52', SHA('0'))).toEqual({ error: 'nocommand' });
    expect(setup('cat').review.start('local', SHA('0'))).toEqual({ error: 'missing' });
  });
});
