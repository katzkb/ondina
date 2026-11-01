// analyze: ref 解決 → 変更ファイル（git から読む）→ core の hunk → Analysis.json。設計書 5.5。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseConfig, splitConfig } from '@ondina/core';
import { analyzeLocal } from '../src/analyze.js';
import { startServer } from '../src/serve.js';
import { buildFixtureRepo, FIXTURE_ROOT, git } from './fixture-repo.js';

let repo: string;
let cleanup: () => void;
beforeAll(() => ({ dir: repo, cleanup } = buildFixtureRepo()));
afterAll(() => cleanup());

const goldenIds = () => (JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'expected/hunks.json'), 'utf8')) as Array<{ id: string }>).map((h) => h.id);

describe('analyzeLocal', () => {
  it('hunks はゴールデンと同じ id 列で、LLM を飛ばせば hows は空、M2 以降の配列は空', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' });
    expect(analysis.hunks.map((h) => h.id)).toEqual(goldenIds());
    expect(analysis.hunks.every((h) => h.hows.length === 0 && h.n === 1)).toBe(true);
    expect(analysis.hows).toEqual([]);
    expect(analysis.llm).toEqual({ command: expect.stringContaining('fake-llm.mjs'), status: 'skipped', reason: '--no-llm' });
    expect(analysis.edges).toEqual([]);
    expect(analysis.tours).toEqual([]);
    expect(analysis.specs).toEqual([]);
    expect(analysis.claims).toEqual([]);
  });

  it('symbols は hunk と 1 対 1 で、層は設定の layers の glob から付く（5.2 の 4）', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' });
    expect(analysis.symbols.map((s) => s.id)).toEqual(analysis.hunks.map((h) => h.id));
    expect(analysis.symbols.every((s) => s.changed && s.hunkId === s.id)).toBe(true);
    const layered = analysis.symbols.filter((s) => s.layer !== undefined);
    expect(layered).toHaveLength(22);
    expect(layered.every((s) => s.layerProvenance === 'config')).toBe(true);
    // テストは domain/ や infra/ の下にあっても Tests（上から順に最初に当たった層）
    expect(analysis.symbols.filter((s) => s.path.startsWith('src/test/')).every((s) => s.layer === 'Tests')).toBe(true);
    // 追従グループのファイルはどの glob にも当たらないので層なし。推定は M2
    expect(analysis.symbols.find((s) => s.path.includes('/admin/'))?.layer).toBeUndefined();
  });

  it('追従検出（8 章）: kind の内訳と Order の group がゴールデン expected/ripples.json と一致し、info に要約が入る', async () => {
    const { analysis, info } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' });
    const golden = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'expected/ripples.json'), 'utf8')) as {
      hunks: Array<{ id: string; kind: string; kindProvenance: string }>;
      groups: unknown[];
    };
    expect(analysis.hunks.map((h) => ({ id: h.id, kind: h.kind, kindProvenance: h.kindProvenance }))).toEqual(golden.hunks.map(({ id, kind, kindProvenance }) => ({ id, kind, kindProvenance })));
    const order = analysis.hunks.find((h) => h.symbolFqName === 'com.example.order.domain.Order')!;
    expect(order.kind).toBe('core');
    const ripple = analysis.hunks.find((h) => h.kind === 'ripple')!;
    expect(ripple.group).toEqual(golden.groups[0]);
    expect(ripple.tokens?.length).toBe(ripple.lines.length);
    expect(info.slice(0, 2)).toEqual(['追従グループ 1、差異あり 1、わずかな差異 0', 'normalize.kotlin の namedArgOrder は未対応です']);
  });

  it('kotlin / sql の hunk に字句トークンが付き、tokens は lines と同じ長さ（7章）', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount');
    const highlighted = analysis.hunks.filter((h) => h.lang === 'kotlin' || h.lang === 'sql');
    expect(highlighted.length).toBeGreaterThan(0);
    for (const h of highlighted) {
      expect(h.tokens?.length, h.path).toBe(h.lines.length);
      expect(h.tokens?.map((l) => l.map(([t]) => t).join(''))).toEqual(h.lines.map((l) => l.slice(1)));
    }
    const kotlinRoles = new Set(highlighted.filter((h) => h.lang === 'kotlin').flatMap((h) => h.tokens!.flat().map(([, r]) => r)));
    expect(kotlinRoles).toContain('mauve');
    expect(kotlinRoles).toContain('blue');
  });

  it('pr には ref 名と sha が入り、number は 0', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount');
    expect(analysis.pr).toEqual({
      number: 0,
      title: 'main..feature/discount',
      base: 'main',
      head: 'feature/discount',
      baseSha: git(repo, 'merge-base', 'main', 'feature/discount'),
      headSha: git(repo, 'rev-parse', 'feature/discount'),
      body: '',
      // --ticket が無いので探した（ブランチ名と空の本文には候補が無い。5.1）
      ticketSearch: { candidates: [] },
    });
  });

  it('body（--body の原文）は pr.body に残る。説明の画面が原文にマーカーを打つため（3.1）', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { body: '## 概要\n\nキャッシュ層も直した' });
    expect(analysis.pr.body).toBe('## 概要\n\nキャッシュ層も直した');
  });

  it('本文のコードブロックの色は pr.bodyCode に入る。コードブロックが無ければ欄ごと無い（3.1）', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { body: '## 例\n\n```kotlin\nval x = 1\n```\n', llm: 'off' });
    expect(analysis.pr.bodyCode?.map((c) => [c.lang, c.code])).toEqual([['kotlin', 'val x = 1']]);
    expect(analysis.pr.bodyCode?.[0]?.tokens.flat().some(([, role]) => role !== null)).toBe(true);
    const plain = await analyzeLocal(repo, 'main', 'feature/discount', { body: '本文だけ', llm: 'off' });
    expect(plain.analysis.pr).not.toHaveProperty('bodyCode');
  });

  it('local の解析は githubDiff を持たない（GitHub に送らず AI に返すので、メモの送り分けが要らない。12 章）', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' });
    expect(analysis).not.toHaveProperty('githubDiff');
    expect(analysis.pr).not.toHaveProperty('workingTree');
  });

  it('title を渡せばそれが題、無ければ <base>..<head>', async () => {
    expect((await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', title: '割引を足す' })).analysis.pr.title).toBe('割引を足す');
    expect((await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' })).analysis.pr.title).toBe('main..feature/discount');
  });

  it('.ondina/local/<headSha>.json に書き、base / head の worktree は作らない（中身は git から読む）', async () => {
    const before = git(repo, 'worktree', 'list', '--porcelain');
    const { analysis, cachePath } = await analyzeLocal(repo, 'main', 'feature/discount');
    expect(cachePath).toBe(path.join(repo, '.ondina', 'local', `${analysis.pr.headSha}.json`));
    expect(JSON.parse(readFileSync(cachePath, 'utf8'))).toEqual(analysis);
    expect(existsSync(path.join(repo, '.ondina', 'local', 'worktrees'))).toBe(false);
    expect(git(repo, 'worktree', 'list', '--porcelain')).toBe(before);
  });

  it('worktreeRoot を指定しても、LSP を使わなければ何も作らない（置き場所は言語サーバー用の worktree だけのもの）', async () => {
    const root = path.join(repo, 'elsewhere');
    await analyzeLocal(repo, 'main', 'feature/discount', { worktreeRoot: root });
    expect(existsSync(root)).toBe(false);
  });

  it('ondina.config.yaml の解析に効く部分を config に入れ、警告は無い（11 章）', async () => {
    const { analysis, warnings } = await analyzeLocal(repo, 'main', 'feature/discount');
    const expected = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
    expect(analysis.config).toEqual(expected);
    // 並び順は層の割当に効く（上から順に最初に当たった層。5.2 の 4）ので、そのまま保つ
    expect(analysis.config.layers.map((l) => l.name)).toEqual(['Tests', 'API', 'Application', 'Domain', 'Infrastructure']);
    expect('packagePrefix' in analysis.config).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('yaml が無ければ既定値で解析し、警告を 1 行返す', async () => {
    const yaml = path.join(repo, 'ondina.config.yaml');
    renameSync(yaml, `${yaml}.bak`);
    try {
      const { analysis, warnings } = await analyzeLocal(repo, 'main', 'feature/discount');
      expect(analysis.config).toEqual({ sourceRoots: [], layers: [], allowedDependencies: {}, normalize: {}, lsp: {} });
      expect(warnings).toEqual(['ondina.config.yaml がないので既定の設定で解析します']);
    } finally {
      renameSync(`${yaml}.bak`, yaml);
    }
  });

  it('yaml の形が違えば失敗し、メッセージにファイル名とキー名が入る', async () => {
    const yaml = path.join(repo, 'ondina.config.yaml');
    const original = readFileSync(yaml, 'utf8');
    writeFileSync(yaml, 'sourceRoots: src\n');
    try {
      await expect(analyzeLocal(repo, 'main', 'feature/discount')).rejects.toThrow('ondina.config.yaml: sourceRoots は文字列の配列にしてください');
    } finally {
      writeFileSync(yaml, original);
    }
  });
});

// LLM ラベリング（設計書 10 章 / 5.3 / 5.4）。コマンドは test/setup.ts の偽物（fake-llm.mjs）。本物は起動しない
describe('analyzeLocal の LLM ラベリング', () => {
  let repo2: string;
  let cleanup2: () => void;
  let log: string;
  beforeAll(() => {
    ({ dir: repo2, cleanup: cleanup2 } = buildFixtureRepo());
    log = path.join(repo2, 'fake-llm.log');
    process.env['FAKE_LLM_LOG'] = log;
  });
  afterAll(() => {
    delete process.env['FAKE_LLM_LOG'];
    cleanup2();
  });
  // 1 回目（目的ごとに分ける）の起動回数。2 回目（文を書く）は下の describe で数える
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l === 'label').length : 0);

  it('偽コマンドの出力で hows が埋まり、How に入った none は core（llm）、束の全員に同じ How が付く。生出力は llm/<sha>.json に残る', async () => {
    const { analysis, info, cachePath } = await analyzeLocal(repo2, 'main', 'feature/discount', { body: 'これは本文。\n二行目。' });
    expect(analysis.llm).toEqual({ command: expect.stringContaining('fake-llm.mjs'), status: 'ok' });
    expect(analysis.hows).toEqual([{ id: 1, title: '全部を 1 つに', why: 'テスト用', specIds: [] }]);
    expect(analysis.hunks.every((h) => h.hows.length === 1)).toBe(true);
    expect(analysis.hunks.filter((h) => h.kind === 'none')).toEqual([]);
    const save = analysis.hunks.find((h) => h.symbolFqName === 'com.example.order.infra.OrderRepositoryImpl.save')!;
    expect([save.kind, save.kindProvenance]).toEqual(['core', 'llm']);
    const order = analysis.hunks.find((h) => h.symbolFqName === 'com.example.order.domain.Order')!;
    expect([order.kind, order.kindProvenance]).toEqual(['core', 'ast']);
    expect(analysis.hunks.filter((h) => h.kind === 'ripple').every((h) => h.hows[0] === 1)).toBe(true);
    expect(analysis.claims).toEqual([{ text: 'これは本文。', backed: true, reason: '' }]);
    expect(info.slice(2, 5)).toEqual([expect.stringMatching(/^LLM: node .*fake-llm\.mjs$/), '本文にない主張を除外しました: 本文に無い文', 'How 1、未帰属 0、絡み 0']);
    const rec = JSON.parse(readFileSync(path.join(path.dirname(cachePath), 'llm', path.basename(cachePath)), 'utf8')) as { stdout: string };
    expect(rec.stdout).toContain('全部を 1 つに');
    expect(calls()).toBe(1);
  });

  it('同じ headSha なら保存した出力を使ってコマンドを起動しない。relabel で起動し直す', async () => {
    const before = calls();
    const { analysis, info } = await analyzeLocal(repo2, 'main', 'feature/discount', { body: 'これは本文。' });
    expect(calls()).toBe(before);
    expect(analysis.hows).toHaveLength(1);
    expect(info).toEqual(expect.arrayContaining([expect.stringMatching(/^LLM: node .*fake-llm\.mjs（\.ondina\/local\/llm\/[0-9a-f]{40}\.json を再利用）$/)]));
    await analyzeLocal(repo2, 'main', 'feature/discount', { llm: 'relabel' });
    expect(calls()).toBe(before + 1);
  });

  it('llm: off は起動せず、hows は空で kind も変えない', async () => {
    const before = calls();
    const { analysis, info } = await analyzeLocal(repo2, 'main', 'feature/discount', { llm: 'off' });
    expect(calls()).toBe(before);
    expect(analysis.hows).toEqual([]);
    expect(analysis.hunks.filter((h) => h.kind === 'none')).toHaveLength(17);
    expect(analysis.llm?.status).toBe('skipped');
    expect(analysis.llmText).toBeUndefined();
    expect(info.at(-1)).toBe('LLM で目的ごとに分けませんでした: --no-llm');
  });

  it('コマンドが失敗したら failed（理由に終了コードと stderr）、hows は空、失敗は保存しない（前の保存が残る）', async () => {
    const { cachePath } = await analyzeLocal(repo2, 'main', 'feature/discount');
    const llmFile = path.join(path.dirname(cachePath), 'llm', path.basename(cachePath));
    const saved = readFileSync(llmFile, 'utf8');
    process.env['FAKE_LLM_MODE'] = 'fail';
    try {
      const { analysis, info } = await analyzeLocal(repo2, 'main', 'feature/discount', { llm: 'relabel' });
      expect(analysis.llm).toEqual({ command: expect.stringContaining('fake-llm.mjs'), status: 'failed', reason: '終了コード 2: boom: the model is on strike' });
      expect(analysis.hows).toEqual([]);
      expect(analysis.hunks.filter((h) => h.kind === 'none')).toHaveLength(17);
      // 1 回目が ok でなければ 2 回目（文を書く）は走らせない
      expect(analysis.llmText).toBeUndefined();
      expect(info.at(-1)).toBe('LLM で目的ごとに分けませんでした: 終了コード 2: boom: the model is on strike');
    } finally {
      delete process.env['FAKE_LLM_MODE'];
    }
    expect(readFileSync(llmFile, 'utf8')).toBe(saved);
    // 前の保存が残っているので、次の auto はそれを使って hows が戻る
    const before = calls();
    const { analysis } = await analyzeLocal(repo2, 'main', 'feature/discount');
    expect(calls()).toBe(before);
    expect(analysis.hows).toHaveLength(1);
  });

  it('保存が無い状態で失敗したら、次の auto は起動し直す', async () => {
    const { cachePath } = await analyzeLocal(repo2, 'main', 'feature/discount');
    renameSync(path.join(path.dirname(cachePath), 'llm', path.basename(cachePath)), path.join(repo2, 'llm.bak'));
    process.env['FAKE_LLM_MODE'] = 'fail';
    try {
      expect((await analyzeLocal(repo2, 'main', 'feature/discount')).analysis.llm?.status).toBe('failed');
    } finally {
      delete process.env['FAKE_LLM_MODE'];
    }
    const before = calls();
    expect((await analyzeLocal(repo2, 'main', 'feature/discount')).analysis.llm?.status).toBe('ok');
    expect(calls()).toBe(before + 1);
  });

  it('stdout から JSON が取り出せなければ failed', async () => {
    process.env['FAKE_LLM_MODE'] = 'garbage';
    try {
      const { analysis } = await analyzeLocal(repo2, 'main', 'feature/discount', { llm: 'relabel' });
      expect(analysis.llm).toEqual({ command: expect.stringContaining('fake-llm.mjs'), status: 'failed', reason: 'stdout に JSON オブジェクトがありません' });
    } finally {
      delete process.env['FAKE_LLM_MODE'];
    }
  });

  it('llmCommand（UI の設定）が環境変数より優先され、Analysis.llm.command に残る', async () => {
    const { analysis } = await analyzeLocal(repo2, 'main', 'feature/discount', { llm: 'relabel', llmCommand: 'cat >/dev/null; echo \'{"hows":[]}\'' });
    expect(analysis.llm).toEqual({ command: 'cat >/dev/null; echo \'{"hows":[]}\'', status: 'ok' });
    expect(analysis.hows).toEqual([]);
  });

  it('同じ鍵の直近の解析があれば previous として渡す（偽コマンドは previous の How を使い回す）', async () => {
    // 直近 = 別の headSha の解析。ここでは head を main にした解析（差分なし）を先に作り、その hows を previous に見せる
    mkdirSync(path.join(repo2, '.ondina', 'local'), { recursive: true });
    const prevSha = git(repo2, 'rev-parse', 'feature/discount~0');
    const prev = JSON.parse(readFileSync(path.join(repo2, '.ondina', 'local', `${prevSha}.json`), 'utf8')) as { hows: unknown[]; hunks: Array<{ id: string }> };
    const fakeSha = 'f'.repeat(40);
    writeFileSync(path.join(repo2, '.ondina', 'local', `${fakeSha}.json`), JSON.stringify({ ...prev, pr: { ...(prev as { pr: object }).pr, headSha: fakeSha }, hows: [{ id: 7, title: '前回の How', why: '', specIds: [] }], hunks: prev.hunks.map((h) => ({ ...h, hows: [7] })) }));
    const { analysis } = await analyzeLocal(repo2, 'main', 'feature/discount', { llm: 'relabel' });
    expect(analysis.hows).toEqual([{ id: 7, title: '前回の How', why: 'テスト用', specIds: [] }]);
  });
});

// 2 回目の LLM（文を書く。設計書 5.3）。1 回目の後、読む順番（tours）を組んでから呼ぶ。生出力は llm/<sha>.text.json
describe('analyzeLocal の 2 回目の LLM（文を書く）', () => {
  let repo3: string;
  let cleanup3: () => void;
  let log: string;
  beforeAll(() => {
    ({ dir: repo3, cleanup: cleanup3 } = buildFixtureRepo());
    log = path.join(repo3, 'fake-llm.log');
    process.env['FAKE_LLM_LOG'] = log;
  });
  afterAll(() => {
    delete process.env['FAKE_LLM_LOG'];
    cleanup3();
  });
  const count = (kind: 'label' | 'text') => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l === kind).length : 0);
  const counts = () => [count('label'), count('text')];
  const textFile = (cachePath: string) => path.join(path.dirname(cachePath), 'llm', path.basename(cachePath).replace(/\.json$/, '.text.json'));

  it('1 回目の後に呼び、コースの変わること・確かめること・停留所のこの場所を tours に、入口の説明を summary に入れる。生出力は llm/<sha>.text.json に残る', async () => {
    const { analysis, info, cachePath } = await analyzeLocal(repo3, 'main', 'feature/discount');
    expect(counts()).toEqual([1, 1]);
    expect(analysis.llmText).toEqual({ command: expect.stringContaining('fake-llm.mjs'), status: 'ok' });
    expect(analysis.tours.map((t) => t.change)).toEqual([{ before: '前 1。', after: '後 1。' }]);
    expect(analysis.tours[0]!.checks).toEqual([{ text: '確かめること 1', at: [{ symbolId: expect.any(String), lines: [expect.any(Number)], say: '見る。' }] }]);
    const steps = analysis.tours[0]!.steps;
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((s) => s.role?.startsWith('この場所 ') === true)).toBe(true);
    expect(analysis.summary).toEqual({ headline: '要点。', flows: [{ nodes: [{ title: '箱', howIds: [1], before: 'b。', after: 'c。', untouched: ['u'] }] }] });
    // 背景（2026-10-29）: 前からあるものは候補（ここは LSP を使わないので、この PR で消える Order.promo と getDiscount）から選んだ物だけ。言葉は差分の行の識別子
    expect(analysis.background).toEqual({
      existing: [{ names: [{ fqName: 'com.example.order.domain.Order.promo', path: 'src/main/kotlin/com/example/order/domain/Order.kt', kind: 'property' }], text: '前からあるもの。', removed: true }],
      terms: [{ word: '言葉', code: expect.stringMatching(/^[A-Za-z_]\w*$/), meaning: '意味。' }],
    });
    const n = steps.length;
    expect(info.slice(-5)).toEqual([
      expect.stringMatching(/^LLM（案内文）: node .*fake-llm\.mjs$/),
      `案内文: 変わること 1 / 1、この場所 ${n} / ${n}、確かめること 1（場所 1）`,
      '入口の説明: 要点 あり、例 なし、図 1 本（箱 1）',
      '前からあるもの 1 から候補にない名前を除外しました: x.Nope',
      '背景: 前からあるもの 1 行（候補 2）、言葉 1 個',
    ]);
    expect(existsSync(textFile(cachePath))).toBe(true);
  });

  it('同じ入力なら保存を使って起動しない。relabel は両方起動し直す', async () => {
    const [label, text] = counts();
    const { analysis, info } = await analyzeLocal(repo3, 'main', 'feature/discount');
    expect(counts()).toEqual([label, text]);
    expect(analysis.tours[0]!.change).toEqual({ before: '前 1。', after: '後 1。' });
    expect(info).toEqual(expect.arrayContaining([expect.stringMatching(/^LLM（案内文）: node .*fake-llm\.mjs（\.ondina\/local\/llm\/[0-9a-f]{40}\.text\.json を再利用）$/)]));
    await analyzeLocal(repo3, 'main', 'feature/discount', { llm: 'relabel' });
    expect(counts()).toEqual([label! + 1, text! + 1]);
  });

  it('1 回目の保存はあるが 2 回目の保存が無ければ、2 回目だけ起動する', async () => {
    const { cachePath } = await analyzeLocal(repo3, 'main', 'feature/discount');
    renameSync(textFile(cachePath), path.join(repo3, 'text.bak'));
    const [label, text] = counts();
    const { analysis } = await analyzeLocal(repo3, 'main', 'feature/discount');
    expect(counts()).toEqual([label, text! + 1]);
    expect(analysis.llmText?.status).toBe('ok');
  });

  it('2 回目の入力（プロンプト）が保存したときと違えば、保存を使わずに起動する（1 回目の結果が変わったときなど）', async () => {
    const { cachePath } = await analyzeLocal(repo3, 'main', 'feature/discount');
    const file = textFile(cachePath);
    writeFileSync(file, JSON.stringify({ ...(JSON.parse(readFileSync(file, 'utf8')) as object), promptSha1: '0'.repeat(40) }));
    const [label, text] = counts();
    await analyzeLocal(repo3, 'main', 'feature/discount');
    expect(counts()).toEqual([label, text! + 1]);
  });

  it('2 回目だけ失敗したら llmText は failed（理由つき）。hows は残り、tours に文は無く、summary は空。失敗は保存しない', async () => {
    const { cachePath } = await analyzeLocal(repo3, 'main', 'feature/discount');
    const saved = readFileSync(textFile(cachePath), 'utf8');
    process.env['FAKE_LLM_TEXT_MODE'] = 'fail';
    try {
      const { analysis, info } = await analyzeLocal(repo3, 'main', 'feature/discount', { llm: 'relabel' });
      expect(analysis.llm?.status).toBe('ok');
      expect(analysis.hows).toHaveLength(1);
      expect(analysis.llmText).toEqual({ command: expect.stringContaining('fake-llm.mjs'), status: 'failed', reason: '終了コード 2: boom: the model is on strike' });
      expect(analysis.tours[0]).not.toHaveProperty('change');
      expect(analysis.tours[0]).not.toHaveProperty('checks');
      expect(analysis.tours[0]!.steps.some((s) => s.role !== undefined)).toBe(false);
      expect(analysis.summary).toEqual({});
      expect(info.at(-1)).toBe('案内文を書けませんでした: 終了コード 2: boom: the model is on strike');
    } finally {
      delete process.env['FAKE_LLM_TEXT_MODE'];
    }
    expect(readFileSync(textFile(cachePath), 'utf8')).toBe(saved);
  });
});

// LSP（設計書 9.1 / 9.5）。本物の kotlin-lsp は起動しない（test/setup.ts が ONDINA_LSP_COMMAND を偽 LSP に向ける）
describe('analyzeLocal と LSP', () => {
  it('--lsp を付けなければ Analysis.lsp の欄ごと無い（未計測と 0 件を混ぜない）', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' });
    expect('lsp' in analysis).toBe(false);
  });

  it('--lsp を付けると Analysis.lsp に記録が残る', async () => {
    const { analysis, info } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true });
    expect(analysis.lsp).toEqual({ command: expect.stringContaining('fake-lsp.mjs'), status: 'ok', waitedMs: expect.any(Number) });
    expect(info.some((s) => s.startsWith('LSP: '))).toBe(true);
  });

  it('言語サーバーの準備を待っている間、progress に経過と終わっていない作業の 1 行を渡す', async () => {
    const lines: string[] = [];
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', {
      llm: 'off',
      lsp: true,
      lspEnv: { FAKE_LSP_MODE: 'slow', FAKE_LSP_DELAY_MS: '200' },
      lspWaitReportMs: 500,
      progress: (l) => lines.push(l),
    });
    expect(analysis.lsp?.status).toBe('ok');
    // 段の始まりの行（画面から解析し直すときの進みにもなる）の後に、待っている間の行が続く。
    // 間にはプロジェクト構造の行が入る（保存してあれば「Gradle の取り込みを省きます」。設計書 9.1）
    expect(lines.slice(0, 2)).toEqual(['base と head のコードを用意しています', '差分を切り出しています']);
    const at = lines.indexOf('言語サーバーを起動しています');
    expect(at).toBeGreaterThanOrEqual(2);
    const waiting = lines.slice(at + 1);
    expect(waiting.length).toBeGreaterThanOrEqual(2);
    expect(waiting.every((l) => l.startsWith('言語サーバーの準備を待っています（'))).toBe(true);
    expect(waiting.some((l) => /Indexing（\d+%）/.test(l))).toBe(true);
  });

  it('--lsp を付けると辺が埋まり、辺ラベルと provenance が付く（9 章）', async () => {
    const { analysis, info } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true });
    expect(analysis.edges.length).toBeGreaterThan(0);
    expect(analysis.edges.every((e) => e.provenance === 'lsp')).toBe(true);
    // 偽 LSP は hover で "fun rateFor(code: String): Rate" を返す
    expect(analysis.edges.some((e) => e.types?.out === 'Rate')).toBe(true);
    // 並びは決定的（from → to → kind の昇順）
    const keys = analysis.edges.map((e) => `${e.from}\u0000${e.to}\u0000${e.kind}`);
    expect(keys).toEqual([...keys].sort());
    expect(info.some((s) => s.startsWith('関連の線 '))).toBe(true);
  });

  it('--lsp を付けると経路上の未変更シンボルと testCount と edgesMeasured が付く', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true });
    const baseline = analysis.symbols.filter((s) => !s.changed);
    expect(baseline.length).toBeGreaterThan(0);
    expect(baseline.every((s) => s.hunkId === undefined && s.edgesMeasured === true)).toBe(true);
    // 偽 LSP は src/main の宣言に対してテストファイルからの参照を 1 件返す
    const counted = analysis.symbols.filter((s) => s.testCount !== undefined && s.testCount > 0);
    expect(counted.length).toBeGreaterThan(0);
    expect(analysis.symbols.some((s) => s.edgesMeasured === true)).toBe(true);
  });

  it('--lsp を付けると名前から定義への答えが入り、差分の列に無い行き先のファイルは全文も入る（3.6）', async () => {
    const { analysis, info } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true });
    // 偽 LSP: 3 行目の名前はライブラリ、4 行目は head なら DiscountPolicy.kt の rateFor（差分の無いファイル）、base なら Order.kt の 1 行目
    const policy = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';
    const order = 'src/main/kotlin/com/example/order/domain/Order.kt';
    const defs = analysis.defs!;
    expect(defs.targets).toContainEqual({ lib: 'kotlin-stdlib-2.2.0.jar' });
    expect(defs.targets).toContainEqual({ side: 'head', path: policy, line: 9, col: 8 });
    expect(defs.targets).toContainEqual({ side: 'base', path: order, line: 1, col: 8 });
    // head は変わったファイルも全体の名前（コースと目的ごとの画面は変わっていない行も出す）、行き先のファイルも全体。
    // base は差分の行だけ（行き先になった Order.kt は全体）
    const policyNames = defs.files.find((f) => f.side === 'head' && f.path === policy);
    expect(policyNames).toBeDefined();
    expect(policyNames).not.toHaveProperty('part');
    const head = defs.files.filter((f) => f.side === 'head');
    expect(head.length).toBeGreaterThan(1);
    expect(head.every((f) => f.part === undefined)).toBe(true);
    expect(defs.files.filter((f) => f.side === 'base' && f.path !== order).every((f) => f.part === true)).toBe(true);
    // 名前は行き先の添字を持つ
    expect(defs.files.flatMap((f) => f.names).every(([, , , t]) => defs.targets[t] !== undefined)).toBe(true);
    // 引き出しに出すファイルの全文: head は files、base（PR で変わったファイル）は baseFiles
    expect(analysis.files?.some((f) => f.path === policy)).toBe(true);
    expect(analysis.baseFiles?.map((f) => f.path)).toEqual([order]);
    expect(analysis.baseFiles?.[0]?.tokens[0]?.map(([t]) => t).join('')).toBe('package com.example.order.domain');
    expect(info.some((s) => s.startsWith('定義へ移れる名前 '))).toBe(true);
  });

  it('呼び出し元の差分の無いファイル（コースの停留所・覗く箱に出る）も、全体の名前を聞く（3.6）', async () => {
    // 偽 LSP: FAKE_LSP_CALLER で、変更シンボルが domain/OrderRepository.kt から呼ばれている（どの名前の行き先でもない）
    const repository = 'src/main/kotlin/com/example/order/domain/OrderRepository.kt';
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true, lspEnv: { FAKE_LSP_CALLER: '1' } });
    expect(analysis.symbols.some((s) => !s.changed && s.path === repository)).toBe(true);
    const asked = analysis.defs!.files.find((f) => f.side === 'head' && f.path === repository);
    expect(asked).toBeDefined();
    expect(asked).not.toHaveProperty('part');
    expect(asked!.names.length).toBeGreaterThan(0);
  });

  it('定義がフォルダ（パッケージの名前）を指せば、その名前は答え無し。言語サーバーの結果は止めない', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true, lspEnv: { FAKE_LSP_DEF_DIR: '1' } });
    expect(analysis.lsp?.status).toBe('ok');
    expect(analysis.edges.length).toBeGreaterThan(0);
    expect(analysis.defs?.targets).toEqual([{ lib: 'kotlin-stdlib-2.2.0.jar' }]);
  });

  it('--lsp を付けなければ defs も baseFiles も無い（名前から移れない）', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' });
    expect('defs' in analysis).toBe(false);
    expect('baseFiles' in analysis).toBe(false);
  });

  it('--lsp を付けなければ辺もシンボルの追加欄も無い（未計測と 0 件を混ぜない）', async () => {
    const { analysis } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' });
    expect(analysis.edges).toEqual([]);
    expect(analysis.symbols.every((s) => s.changed)).toBe(true);
    expect(analysis.symbols.every((s) => !('edgesMeasured' in s) && !('testCount' in s))).toBe(true);
  });

  it('--lsp を付けると意味トークンが字句トークンに重なる（7.2）', async () => {
    // 偽 LSP は Order.kt の 1 行目 4 文字目から 5 文字を class [declaration] として返す
    const lex = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' });
    const sem = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true });
    const pick = (a: typeof lex.analysis) => a.hunks.find((h) => h.path.endsWith('domain/Order.kt') && h.symbolKind !== 'file');
    const before = pick(lex.analysis)!;
    const after = pick(sem.analysis)!;
    // 文字列そのものは動かない（重ねても行の中身は変わらない）
    expect(after.tokens?.map((l) => l.map(([t]) => t).join(''))).toEqual(before.tokens?.map((l) => l.map(([t]) => t).join('')));
    // 少なくとも 1 か所は役割が変わる
    expect(JSON.stringify(after.tokens)).not.toEqual(JSON.stringify(before.tokens));
    expect(sem.info.some((s) => s.includes('意味の色分け head '))).toBe(true);
  });

  it('LSP が使えなくても解析は止まらず、理由が残る（9.5）', async () => {
    const { analysis, info } = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true, lspEnv: { FAKE_LSP_MODE: 'failed' } });
    expect(analysis.lsp?.status).toBe('unavailable');
    expect(analysis.lsp?.reason).toContain('Unable to import a Gradle project');
    expect('waitedMs' in (analysis.lsp ?? {})).toBe(false);
    expect(analysis.hunks.map((h) => h.id)).toEqual(goldenIds());
    // 意味トークンが取れなくても字句トークンは付く
    expect(analysis.hunks.every((h) => h.lang !== 'kotlin' || h.tokens !== undefined)).toBe(true);
    expect(info.some((s) => s.startsWith('LSP を使いませんでした: '))).toBe(true);
  });

  it('yaml に lsp.kotlin が無くても、環境変数 ONDINA_LSP_COMMAND と既定の起こし方で起こす（9.1）', async () => {
    const { analysis } = await withYaml((y) => y.replace(/\nlsp:[\s\S]*?\n(?=theme:)/, '\n'), () => analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true }));
    expect(analysis.lsp).toEqual({ command: expect.stringMatching(/fake-lsp\.mjs --stdio --system-path .*lsp\/workspace$/), status: 'ok', waitedMs: expect.any(Number) });
    expect(analysis.edges.length).toBeGreaterThan(0);
  });

  it('serve が動いていれば、serve が起動したまま持つ言語サーバーを使う（2 本目は起動しない。9.1）', async () => {
    const dist = mkdtempSync(path.join(os.tmpdir(), 'ondina-dist-'));
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
    const spawns = path.join(repo, '.analyze-spawns');
    const server = await startServer({ repo, port: 0, distDir: dist, log: () => undefined });
    try {
      const lspEnv = { FAKE_LSP_SPAWNS: spawns };
      const first = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true, lspEnv });
      const lines: string[] = [];
      const second = await analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true, lspEnv, progress: (l) => lines.push(l) });
      expect([first.analysis.lsp?.status, second.analysis.lsp?.status]).toEqual(['ok', 'ok']);
      expect(second.analysis.edges).toEqual(first.analysis.edges);
      expect(readFileSync(spawns, 'utf8').split('\n').filter((l) => l !== '')).toHaveLength(1);
      expect(lines).toContain('起動済みの言語サーバーを使います');
      expect(second.info.some((s) => s.includes('（起動済み。準備完了まで '))).toBe(true);
    } finally {
      await server.close();
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('環境変数 ONDINA_LSP_COMMAND が無くても、kotlin-lsp の置き場の current にあれば起こす（AI エージェントの非対話シェルは ~/.zshrc を読まない）', async () => {
    const env = process.env['ONDINA_LSP_COMMAND'];
    const dir = process.env['ONDINA_LSP_DIR'];
    const lspDir = mkdtempSync(path.join(os.tmpdir(), 'ondina-kotlin-lsp-'));
    const server = path.join(lspDir, 'current/bin/intellij-server');
    mkdirSync(path.dirname(server), { recursive: true });
    writeFileSync(server, `#!/bin/sh\nexec node ${JSON.stringify(env)} "$@"\n`, { mode: 0o755 });
    delete process.env['ONDINA_LSP_COMMAND'];
    process.env['ONDINA_LSP_DIR'] = lspDir;
    try {
      const { analysis } = await withYaml((y) => y.replace(/\nlsp:[\s\S]*?\n(?=theme:)/, '\n'), () => analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true }));
      expect(analysis.lsp).toEqual({ command: expect.stringMatching(/current\/bin\/intellij-server --stdio /), status: 'ok', waitedMs: expect.any(Number) });
      expect(analysis.edges.length).toBeGreaterThan(0);
    } finally {
      process.env['ONDINA_LSP_COMMAND'] = env;
      process.env['ONDINA_LSP_DIR'] = dir;
      rmSync(lspDir, { recursive: true, force: true });
    }
  });

  it('コマンドがどこにも無ければ起こさず、unavailable と直し方・探した場所を残す', async () => {
    const env = process.env['ONDINA_LSP_COMMAND'];
    delete process.env['ONDINA_LSP_COMMAND'];
    try {
      const { analysis } = await withYaml((y) => y.replace(/\nlsp:[\s\S]*?\n(?=theme:)/, '\n'), () => analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off', lsp: true }));
      const server = path.join(process.env['ONDINA_LSP_DIR'] ?? '', 'current/bin/intellij-server');
      expect(analysis.lsp).toEqual({ command: '', status: 'unavailable', reason: `kotlin-lsp が見つかりません。ondina update で入れるか、環境変数 ONDINA_LSP_COMMAND に kotlin-lsp の bin/intellij-server を指定してください（探した場所: ${server}）` });
    } finally {
      process.env['ONDINA_LSP_COMMAND'] = env;
    }
  });
});

// 構成の推定（設計書 10.6）。yaml に layers が無いリポジトリで、初めての analyze のときだけリポジトリ全体を推定して保存する
describe('構成の推定', () => {
  const saved = () => path.join(repo, '.ondina/structure.json');
  const noLayers = (y: string) => y.replace(/\nlayers:[\s\S]*?\n(?=normalize:)/, '\n');
  /** layers も sourceRoots も無い = 設定にテストの置き場が無い（実際のリポジトリの設定と同じ） */
  const noTestPlaces = (y: string) => noLayers(y).replace(/\nsourceRoots:.*\n/, '\n');
  /** 2026-10-12 より前の保存（テストの置き場が無い） */
  const writeOldSave = (known: string[]) => {
    mkdirSync(path.dirname(saved()), { recursive: true });
    writeFileSync(saved(), JSON.stringify({ version: 1, headSha: 'x'.repeat(40), at: '2026-10-09T00:00:00.000Z', command: 'c', layers: [{ name: 'Main', why: '' }], dirs: [{ dir: 'src/main', layer: 'Main' }], files: [], outside: [], known }));
  };
  /** FAKE_LLM_LOG に偽 LLM の呼び出しを書かせて、呼ばれた種類を返す */
  async function logged<T>(run: () => Promise<T>, env: Record<string, string> = {}): Promise<{ out: T; calls: string[] }> {
    const log = path.join(repo, '.ondina-llm.log');
    writeFileSync(log, '');
    const keep = { ...process.env };
    Object.assign(process.env, { FAKE_LLM_LOG: log, ...env });
    try {
      const out = await run();
      return { out, calls: readFileSync(log, 'utf8').split('\n').filter((l) => l !== '') };
    } finally {
      for (const k of ['FAKE_LLM_LOG', ...Object.keys(env)]) if (keep[k] === undefined) delete process.env[k];
      else process.env[k] = keep[k];
    }
  }
  beforeEach(() => rmSync(saved(), { force: true }));

  it('yaml に layers が無ければ、初回の analyze で全体を推定して .ondina/structure.json に保存し、層を llm で付ける', async () => {
    const { out, calls } = await logged(() => withYaml(noLayers, () => analyzeLocal(repo, 'main', 'feature/discount')));
    const { analysis, info } = out;
    expect(calls[0]).toBe('structure');
    const file = JSON.parse(readFileSync(saved(), 'utf8')) as Record<string, unknown>;
    expect(file).toMatchObject({ version: 1, headSha: analysis.pr.headSha, layers: [{ name: 'Main', why: 'Main の層' }, { name: 'Test', why: 'Test の層' }], dirs: [{ dir: 'src/main', layer: 'Main' }, { dir: 'src/test', layer: 'Test' }], tests: ['src/test'] });
    expect(file['known']).toEqual(git(repo, 'ls-tree', '-r', '--name-only', 'feature/discount').split('\n').sort());
    expect(analysis.structure).toEqual({ status: 'ok', command: expect.stringContaining('fake-llm.mjs'), inferred: { headSha: analysis.pr.headSha, at: expect.any(String) }, layers: ['Main', 'Test'], unclassified: { count: 0, total: (file['known'] as string[]).length, warn: false, paths: [] } });
    const main = analysis.symbols.filter((s) => s.path.startsWith('src/main/'));
    expect(main.length).toBeGreaterThan(0);
    expect(main.every((s) => s.layer === 'Main' && s.layerProvenance === 'llm')).toBe(true);
    expect(info).toContain('構成を推定しました: 層 2（Main / Test）');
  });

  it('設定にテストの置き場が無ければ、推定したテストの置き場でテストを見分ける（llm。5.2 の 7）', async () => {
    const { analysis } = await withYaml(noTestPlaces, () => analyzeLocal(repo, 'main', 'feature/discount', { lsp: true }));
    const tests = analysis.hunks.filter((h) => h.path.startsWith('src/test/'));
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.every((h) => h.kind === 'test' && h.kindProvenance === 'llm')).toBe(true);
    expect(analysis.structure?.tests).toEqual(['src/test']);
    // 言語サーバーの testCount も同じ見分けで数える（偽 LSP は src/main の宣言にテストファイルからの参照を返す）
    expect(analysis.symbols.some((s) => (s.testCount ?? 0) > 0)).toBe(true);
  });

  it('設定の sourceRoots にテストの置き場があれば、推定のテストの置き場は使わない（structure.tests は無い）', async () => {
    const { analysis } = await withYaml(noLayers, () => analyzeLocal(repo, 'main', 'feature/discount'));
    const tests = analysis.hunks.filter((h) => h.kind === 'test');
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.every((h) => h.kindProvenance === 'config')).toBe(true);
    expect(analysis.structure?.status).toBe('ok');
    expect(analysis.structure && 'tests' in analysis.structure).toBe(false);
  });

  it('テストの置き場の無い古い保存は、LLM を使えるなら前回の層の名前を渡して推定し直す', async () => {
    writeOldSave(git(repo, 'ls-tree', '-r', '--name-only', 'feature/discount').split('\n').sort());
    const input = path.join(repo, '.ondina-structure-input.json');
    const { out, calls } = await logged(() => withYaml(noTestPlaces, () => analyzeLocal(repo, 'main', 'feature/discount')), { FAKE_LLM_INPUT: input });
    expect(calls[0]).toBe('structure');
    expect((JSON.parse(readFileSync(input, 'utf8')) as { previous?: unknown }).previous).toEqual({ layers: ['Main'] });
    expect((JSON.parse(readFileSync(saved(), 'utf8')) as { tests?: string[] }).tests).toEqual(['src/test']);
    expect(out.info).toContain('構成の推定にテストの置き場がないので推定し直しました: 層 2（Main / Test）');
    expect(out.analysis.structure?.tests).toEqual(['src/test']);
    expect(out.analysis.hunks.filter((h) => h.path.startsWith('src/test/')).every((h) => h.kind === 'test')).toBe(true);
  });

  it('テストの置き場の無い古い保存は、推定し直せなければ・--no-llm なら、そのまま使ってテストを見分けない', async () => {
    const known = git(repo, 'ls-tree', '-r', '--name-only', 'feature/discount').split('\n').sort();
    writeOldSave(known);
    const failed = await logged(() => withYaml(noTestPlaces, () => analyzeLocal(repo, 'main', 'feature/discount')), { FAKE_LLM_STRUCTURE_MODE: 'fail' });
    expect(failed.out.analysis.structure?.status).toBe('ok');
    expect(failed.out.info.some((l) => l.startsWith('構成を推定し直せませんでした: ') && l.endsWith('。テストの置き場のない前の推定を使います'))).toBe(true);
    expect(failed.out.analysis.hunks.some((h) => h.kind === 'test')).toBe(false);
    const off = await logged(() => withYaml(noTestPlaces, () => analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' })));
    expect(off.calls).toEqual([]);
    expect(off.out.analysis.structure?.status).toBe('ok');
    expect(off.out.info).toContain('構成の推定にテストの置き場がありません。LLM を使って analyze するか ondina structure で推定し直すと、テストを見分けます');
    expect(off.out.analysis.hunks.some((h) => h.kind === 'test')).toBe(false);
  });

  it('設定に layers があって Tests も sourceRoots の test も無ければ、テストを見分けていないと stderr に出す（構成の推定は走らない）', async () => {
    const noTests = (y: string) => y.replace(/\n  - name: Tests[^\n]*\n[^\n]*/, '').replace(/\n  Tests: [^\n]*/, '').replace(/\nsourceRoots:.*\n/, '\n');
    const { out, calls } = await logged(() => withYaml(noTests, () => analyzeLocal(repo, 'main', 'feature/discount')));
    expect(calls).not.toContain('structure');
    expect(out.analysis.hunks.some((h) => h.kind === 'test')).toBe(false);
    expect(out.info).toContain('テストを見分けていません: ondina.config.yaml の layers に Tests がなく、sourceRoots にも test を含むディレクトリがありません（layers を書くと構成の推定は走りません）');
  });

  it('2 回目からは保存した構成を使い、推定を呼ばない', async () => {
    await logged(() => withYaml(noLayers, () => analyzeLocal(repo, 'main', 'feature/discount')));
    const { out, calls } = await logged(() => withYaml(noLayers, () => analyzeLocal(repo, 'main', 'feature/discount')));
    expect(calls).not.toContain('structure');
    expect(out.analysis.structure?.status).toBe('ok');
    expect(out.info.some((l) => l.startsWith('構成: .ondina/structure.json を使いました'))).toBe(true);
  });

  it('yaml に layers があれば推定しない（structure の欄も保存も無い）', async () => {
    const { out, calls } = await logged(() => analyzeLocal(repo, 'main', 'feature/discount'));
    expect(calls).not.toContain('structure');
    expect('structure' in out.analysis).toBe(false);
    expect(existsSync(saved())).toBe(false);
  });

  it('--no-llm で保存が無ければ推定せず skipped', async () => {
    const { analysis } = await withYaml(noLayers, () => analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' }));
    expect(analysis.structure).toEqual({ status: 'skipped', reason: '--no-llm' });
    expect(analysis.symbols.every((s) => s.layer === undefined)).toBe(true);
    expect(existsSync(saved())).toBe(false);
  });

  it('推定に失敗したら保存せず failed と理由を残し、次の analyze でやり直す', async () => {
    const failed = await logged(() => withYaml(noLayers, () => analyzeLocal(repo, 'main', 'feature/discount')), { FAKE_LLM_STRUCTURE_MODE: 'fail' });
    expect(failed.out.analysis.structure).toEqual({ status: 'failed', command: expect.stringContaining('fake-llm.mjs'), reason: expect.stringContaining('boom: the cartographer is on strike') });
    expect(existsSync(saved())).toBe(false);
    const empty = await logged(() => withYaml(noLayers, () => analyzeLocal(repo, 'main', 'feature/discount')), { FAKE_LLM_STRUCTURE_MODE: 'empty' });
    expect(empty.calls).toContain('structure');
    expect(empty.out.analysis.structure).toMatchObject({ status: 'failed', reason: '層を 1 つも推定できませんでした' });
  });

  it('推定の後に増えた分類できないファイルを数え、推定時の 5%（最低 5 件）以上なら警告する', async () => {
    const all = git(repo, 'ls-tree', '-r', '--name-only', 'feature/discount').split('\n').sort();
    const known = all.filter((p) => p.startsWith('src/main/'));
    const extra = all.filter((p) => !p.startsWith('src/main/'));
    mkdirSync(path.dirname(saved()), { recursive: true });
    writeFileSync(saved(), JSON.stringify({ version: 1, headSha: 'x'.repeat(40), at: '2026-10-09T00:00:00.000Z', command: 'c', layers: [{ name: 'Main', why: '' }], dirs: [{ dir: 'src/main', layer: 'Main' }], files: [], outside: [], known }));
    const { analysis, info } = await withYaml(noLayers, () => analyzeLocal(repo, 'main', 'feature/discount', { llm: 'off' }));
    expect(extra.length).toBeGreaterThanOrEqual(5);
    expect(analysis.structure?.unclassified).toEqual({ count: extra.length, total: known.length, warn: true, paths: extra.slice(0, 20) });
    expect(info).toContain(`構成に分類できないファイルが ${extra.length} 件増えました（2026-10-09 の推定以降）。ondina structure で推定し直せます`);
  });
});

// --ticket が無いとき、PR の題・ブランチ名・本文からチケットを探す（設計書 5.1 / 10.7。2026-10-12）。
// 候補はプログラムが拾い、偽 LLM（FAKE_LLM_TICKET_MODE）が選ぶ。取り方はコマンド（ONDINA_TICKET を返す）にして通信しない
describe('analyzeLocal のチケット探し', () => {
  let repo4: string;
  let cleanup4: () => void;
  let log: string;
  beforeAll(() => {
    ({ dir: repo4, cleanup: cleanup4 } = buildFixtureRepo());
    log = path.join(repo4, 'fake-llm.log');
    process.env['FAKE_LLM_LOG'] = log;
  });
  afterAll(() => {
    delete process.env['FAKE_LLM_LOG'];
    cleanup4();
  });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l === 'ticket').length : 0);
  const body = '[SHOP-421] 割引を足す。\n関連: SHOP-399';
  const ticket = () => ({ settings: { source: 'command' as const, command: 'printf \'{"key":"%s","title":"題 %s"}\' "$ONDINA_TICKET" "$ONDINA_TICKET"' }, cwd: repo4 });
  const withMode = async <T>(mode: string, run: () => Promise<T>): Promise<T> => {
    process.env['FAKE_LLM_TICKET_MODE'] = mode;
    try {
      return await run();
    } finally {
      delete process.env['FAKE_LLM_TICKET_MODE'];
    }
  };

  it('本文の候補から LLM が選んだチケットを取り、候補と選んだものを ticketSearch に残す', async () => {
    const { analysis, info } = await analyzeLocal(repo4, 'main', 'feature/discount', { body, ticket: ticket() });
    expect(analysis.pr.ticketSearch).toEqual({
      candidates: [
        { ref: 'SHOP-421', label: 'SHOP-421', places: [{ in: 'body', line: 1, text: '[SHOP-421] 割引を足す。', start: 1, end: 9 }] },
        { ref: 'SHOP-399', label: 'SHOP-399', places: [{ in: 'body', line: 2, text: '関連: SHOP-399', start: 4, end: 12 }] },
      ],
      chosen: 'SHOP-421',
      llm: { command: expect.stringContaining('fake-llm.mjs'), status: 'ok' },
    });
    expect(analysis.pr.ticket).toMatchObject({ ref: 'SHOP-421', source: 'command', key: 'SHOP-421', title: '題 SHOP-421' });
    expect(info).toEqual(expect.arrayContaining([expect.stringMatching(/^LLM（チケット選び）: node .*fake-llm\.mjs$/), 'チケット: SHOP-421 題 SHOP-421（コマンド。候補 2 件から LLM が選んだ推定）']));
    expect(calls()).toBe(1);
  });

  it('題・ブランチ名・本文が同じなら保存した答えを使い、本文が変われば選び直す', async () => {
    const before = calls();
    const { analysis, info } = await analyzeLocal(repo4, 'main', 'feature/discount', { body, ticket: ticket() });
    expect(calls()).toBe(before);
    expect(analysis.pr.ticketSearch?.chosen).toBe('SHOP-421');
    expect(info).toEqual(expect.arrayContaining([expect.stringMatching(/^LLM（チケット選び）: node .*fake-llm\.mjs（\.ondina\/local\/llm\/[0-9a-f]{40}\.ticket\.json を再利用）$/)]));
    await analyzeLocal(repo4, 'main', 'feature/discount', { body: `${body}\n追記`, ticket: ticket() });
    expect(calls()).toBe(before + 1);
  });

  it('ローカルモードの題は、--title で付けたときだけ候補を拾う（既定の題 main..feature/x は見ない）', async () => {
    const titled = await analyzeLocal(repo4, 'main', 'feature/discount', { title: 'SHOP-512 割引額に上限', ticket: ticket() });
    expect(titled.analysis.pr.ticketSearch?.candidates.map((c) => [c.label, c.places.map((p) => p.in)])).toEqual([['SHOP-512', ['title']]]);
    const plain = await analyzeLocal(repo4, 'main', 'feature/discount', { ticket: ticket() });
    expect(plain.analysis.pr.ticketSearch?.candidates ?? []).toEqual([]);
  });

  it('LLM がどれも選ばなければチケットは無く、見つからなかったと知らせる', async () => {
    const { analysis, info } = await withMode('none', () => analyzeLocal(repo4, 'main', 'feature/discount', { body, ticket: ticket(), llm: 'relabel' }));
    expect(analysis.pr.ticketSearch).toMatchObject({ llm: { status: 'ok' } });
    expect(analysis.pr.ticketSearch).not.toHaveProperty('chosen');
    expect(analysis.pr).not.toHaveProperty('ticket');
    expect(info).toContain('チケットは見つかりませんでした（候補 2 件のどれも、LLM がこの PR のチケットではないと答えました）');
  });

  it('候補に無い id を答えたら捨てて、選ばなかった扱い', async () => {
    const { analysis, info } = await withMode('bogus', () => analyzeLocal(repo4, 'main', 'feature/discount', { body, ticket: ticket(), llm: 'relabel' }));
    expect(analysis.pr.ticketSearch).not.toHaveProperty('chosen');
    expect(analysis.pr).not.toHaveProperty('ticket');
    expect(info).toContain('LLM が候補にないチケット（c9）を選んだので除外しました');
  });

  it('LLM が失敗したら候補だけ残し、理由を知らせる', async () => {
    const { analysis, info } = await withMode('fail', () => analyzeLocal(repo4, 'main', 'feature/discount', { body, ticket: ticket(), llm: 'relabel' }));
    expect(analysis.pr.ticketSearch).toMatchObject({ candidates: [{ label: 'SHOP-421' }, { label: 'SHOP-399' }], llm: { status: 'failed', reason: '終了コード 2: boom: the ticket clerk is on strike' } });
    expect(analysis.pr).not.toHaveProperty('ticket');
    expect(info).toContain('チケットを選んでいません（候補 2 件）: 終了コード 2: boom: the ticket clerk is on strike');
  });

  it('llm: off は LLM を呼ばず、候補だけ残す', async () => {
    const before = calls();
    const { analysis, info } = await analyzeLocal(repo4, 'main', 'feature/discount', { body, ticket: ticket(), llm: 'off' });
    expect(calls()).toBe(before);
    expect(analysis.pr.ticketSearch).toMatchObject({ llm: { status: 'skipped', reason: '--no-llm' } });
    expect(analysis.pr.ticketSearch?.candidates).toHaveLength(2);
    expect(info).toContain('チケットを選んでいません（候補 2 件）: --no-llm');
  });

  it('候補が無ければ LLM を呼ばず、標準エラーにも出さない（画面の「仕様」欄で分かる）', async () => {
    const before = calls();
    const { analysis, info } = await analyzeLocal(repo4, 'main', 'feature/discount', { body: '割引を足す。', ticket: ticket() });
    expect(calls()).toBe(before);
    expect(analysis.pr.ticketSearch).toEqual({ candidates: [] });
    expect(analysis.pr).not.toHaveProperty('ticket');
    expect(info.some((l) => l.includes('チケット'))).toBe(false);
  });

  it('--ticket があれば探さない', async () => {
    const before = calls();
    const { analysis } = await analyzeLocal(repo4, 'main', 'feature/discount', { body, ticket: { ...ticket(), ref: 'GH-7' } });
    expect(calls()).toBe(before);
    expect(analysis.pr).not.toHaveProperty('ticketSearch');
    expect(analysis.pr.ticket).toMatchObject({ ref: 'GH-7', title: '題 GH-7' });
  });
});

// 要求の抜き出し（設計書 10.8。2026-10-12）。取れたチケットから、1 回目の後に 2 回目と同時に呼ぶ。生出力は llm/<鍵>.spec.json。
// チケットは fixture の SHOP-421.md（ファイルで指定）。偽 LLM（FAKE_LLM_SPEC_MODE）は「要求 1」（最初の How）と「要求 2」（対応なし）を返す
describe('analyzeLocal の要求の抜き出し', () => {
  let repo5: string;
  let cleanup5: () => void;
  let log: string;
  let dumped: string;
  beforeAll(() => {
    ({ dir: repo5, cleanup: cleanup5 } = buildFixtureRepo());
    log = path.join(repo5, 'fake-llm.log');
    dumped = path.join(repo5, 'spec-input.json');
    process.env['FAKE_LLM_LOG'] = log;
    process.env['FAKE_LLM_SPEC_INPUT'] = dumped;
  });
  afterAll(() => {
    delete process.env['FAKE_LLM_LOG'];
    delete process.env['FAKE_LLM_SPEC_INPUT'];
    cleanup5();
  });
  const count = (kind: string) => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l === kind).length : 0);
  const shop421 = () => ({ ref: 'SHOP-421.md', cwd: path.join(FIXTURE_ROOT, 'ticket') });
  const withEnv = async <T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> => {
    Object.assign(process.env, env);
    try {
      return await run();
    } finally {
      for (const k of Object.keys(env)) delete process.env[k];
    }
  };
  const lastInput = () => JSON.parse(readFileSync(dumped, 'utf8')) as { ticket: { body: string }; hows: Array<{ id: number }>; previous?: unknown };
  /** 別の headSha の解析を「前回」として置く（findPrevious は更新の新しい順に引く） */
  const writePrevious = (from: string, edit: (a: Record<string, unknown>) => Record<string, unknown>) => {
    const prev = JSON.parse(readFileSync(from, 'utf8')) as Record<string, unknown>;
    const fake = 'f'.repeat(40);
    writeFileSync(path.join(path.dirname(from), `${fake}.json`), JSON.stringify(edit({ ...prev, pr: { ...(prev['pr'] as object), headSha: fake } })));
  };

  it('取れたチケットから要求を抜き出し、specs・How の specIds・llmSpecs を残す', async () => {
    const { analysis, info } = await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421() });
    expect(count('spec')).toBe(1);
    expect(analysis.specs).toEqual([
      { id: 's1', text: '要求 1', hows: [1] },
      { id: 's2', text: '要求 2', hows: [] },
    ]);
    expect(analysis.hows[0]!.specIds).toEqual(['s1']);
    expect(analysis.llmSpecs).toEqual({ command: expect.stringContaining('fake-llm.mjs'), status: 'ok' });
    expect(info).toEqual(expect.arrayContaining([expect.stringMatching(/^LLM（要求の抜き出し）: node .*fake-llm\.mjs$/), '要求: 2 件（対応するコースがあるもの 1 件）']));
    // なぜ（説明タブの背景。2026-10-29）: チケットの本文にある文だけ残す
    expect(analysis.background?.why).toEqual(['春のキャンペーン（SHOP-400）で割引コードを配る。']);
    expect(info).toContain('チケットの本文にない「なぜ」の文を除外しました: チケットに無い文。');
    // 入力: チケットの本文と、1 回目が分けた How。前回の解析が無いので previous は無い
    expect(lastInput().ticket.body).toContain('期限切れのコードは 400 を返す');
    expect(lastInput().hows.map((h) => h.id)).toEqual([1]);
    expect(lastInput()).not.toHaveProperty('previous');
  });

  it('同じ差分・同じチケットなら保存した答えを使い、チケットの本文が変われば抜き出し直す', async () => {
    const before = count('spec');
    const { analysis, info } = await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421() });
    expect(count('spec')).toBe(before);
    expect(analysis.specs).toHaveLength(2);
    expect(info).toEqual(expect.arrayContaining([expect.stringMatching(/^LLM（要求の抜き出し）: node .*fake-llm\.mjs（\.ondina\/local\/llm\/[0-9a-f]{40}\.spec\.json を再利用）$/)]));
    const edited = path.join(repo5, 'SHOP-421.md');
    writeFileSync(edited, `${readFileSync(path.join(FIXTURE_ROOT, 'ticket/SHOP-421.md'), 'utf8')}\n- 割引は 1 注文に 1 回まで\n`);
    await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: { ref: 'SHOP-421.md', cwd: repo5 } });
    expect(count('spec')).toBe(before + 1);
  });

  it('前回の解析が同じチケットなら、その要求を previous に渡す。違うチケットなら渡さない', async () => {
    const { cachePath } = await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421() });
    writePrevious(cachePath, (a) => ({ ...a, specs: [{ id: 's1', text: '前回の要求', hows: [1] }] }));
    await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421(), llm: 'relabel' });
    expect(lastInput().previous).toEqual({ specs: [{ text: '前回の要求', hows: [1] }] });
    writePrevious(cachePath, (a) => ({ ...a, pr: { ...(a['pr'] as object), ticket: { ref: 'SHOP-9.md', source: 'file', at: '' } }, specs: [{ id: 's1', text: '別のチケットの要求', hows: [1] }] }));
    await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421(), llm: 'relabel' });
    expect(lastInput()).not.toHaveProperty('previous');
  });

  it('前回の要求が変わっても、同じ差分・同じチケットなら保存を使う（古い headSha を解析し直しても同じ答え。原則 7）', async () => {
    const { cachePath } = await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421() });
    writePrevious(cachePath, (a) => ({ ...a, specs: [{ id: 's1', text: 'もっと前の要求', hows: [] }] }));
    const before = count('spec');
    const { analysis } = await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421() });
    expect(count('spec')).toBe(before);
    expect(analysis.specs.map((s) => s.text)).toEqual(['要求 1', '要求 2']);
  });

  it('知らない How の番号は捨てて知らせる', async () => {
    const { analysis, info } = await withEnv({ FAKE_LLM_SPEC_MODE: 'bogus' }, () => analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421(), llm: 'relabel' }));
    expect(analysis.specs[0]!.hows).toEqual([1]);
    expect(info).toContain('要求 1 の対応に不明な How の番号（99）があったので除外しました');
  });

  it('抜き出しが失敗したら specs は空で、llmSpecs に理由を残して解析は続ける。案内文は書ける', async () => {
    const { analysis, info } = await withEnv({ FAKE_LLM_SPEC_MODE: 'fail' }, () => analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421(), llm: 'relabel' }));
    expect(analysis.specs).toEqual([]);
    expect(analysis.hows.every((h) => h.specIds.length === 0)).toBe(true);
    expect(analysis.llmSpecs).toEqual({ command: expect.stringContaining('fake-llm.mjs'), status: 'failed', reason: '終了コード 2: boom: the spec reader is on strike' });
    expect(analysis.llmText?.status).toBe('ok');
    expect(info).toContain('要求を抜き出せませんでした: 終了コード 2: boom: the spec reader is on strike');
  });

  it('チケットが取れなかった・指定が無い・1 回目が失敗した・LLM を使わないときは走らせず、llmSpecs の欄も無い', async () => {
    const before = count('spec');
    const missing = await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: { ref: 'NOPE-1', cwd: repo5 } });
    expect(missing.analysis.pr.ticket?.error).toBeDefined();
    const none = await analyzeLocal(repo5, 'main', 'feature/discount');
    const failed = await withEnv({ FAKE_LLM_MODE: 'fail' }, () => analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421(), llm: 'relabel' }));
    const off = await analyzeLocal(repo5, 'main', 'feature/discount', { ticket: shop421(), llm: 'off' });
    expect(count('spec')).toBe(before);
    for (const { analysis } of [missing, none, failed, off]) {
      expect(analysis.specs).toEqual([]);
      expect(analysis).not.toHaveProperty('llmSpecs');
    }
  });
});

// どんな案件の一部か（設計書 3.1 / 5.1。2026-10-29）。チケットは偽 Jira（http）、同じ案件の PR は偽の gh（fixture の GraphQL の答え）。
// 偽 LLM は親の目的の 1 文と、親に無い 1 文（検証で捨てる）を返す
describe('analyzeLocal の案件', () => {
  let repo6: string;
  let cleanup6: () => void;
  let server: Server;
  let jira: string;
  let dumped: string;
  const read = (name: string) => readFileSync(path.join(FIXTURE_ROOT, 'ticket', name), 'utf8');
  beforeAll(async () => {
    ({ dir: repo6, cleanup: cleanup6 } = buildFixtureRepo());
    dumped = path.join(repo6, 'spec-input.json');
    process.env['FAKE_LLM_SPEC_INPUT'] = dumped;
    server = createServer((req, res) => {
      const u = new URL(req.url ?? '', 'http://x');
      const send = (body: string) => res.writeHead(200, { 'content-type': 'application/json' }).end(body);
      if (u.pathname === '/rest/api/2/issue/SHOP-421' && u.searchParams.get('fields') === 'parent') return send('{"key":"SHOP-421","fields":{"parent":{"key":"SHOP-400"}}}');
      if (u.pathname === '/rest/api/2/issue/SHOP-421') return send(read('jira-issue.json'));
      if (u.pathname === '/rest/api/2/issue/SHOP-400') return send(read('jira-parent.json'));
      if (u.pathname === '/rest/api/2/search') return send(read('jira-children.json'));
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    jira = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    delete process.env['FAKE_LLM_SPEC_INPUT'];
    server.close();
    cleanup6();
  });
  const ticket = () => ({ ref: `${jira}/browse/SHOP-421`, cwd: repo6, env: {} });
  const gh = (fail?: string) => async (args: string[]) => {
    if (fail !== undefined) throw new Error(fail);
    return args[0] === 'repo' ? '{"url":"https://ghe.example.com/shop/order-service"}' : read('github-search.json');
  };

  it('親チケット・同じ親の下のチケット・同じ案件の PR を background.project に残し、親の目的の文は親の本文にある物だけ', async () => {
    const { analysis, info } = await analyzeLocal(repo6, 'main', 'feature/discount', { ticket: ticket(), runGhAsync: gh() });
    const project = analysis.background?.project;
    expect(project?.parent).toMatchObject({ key: 'SHOP-400', url: `${jira}/browse/SHOP-400`, via: 'parent', title: '春のキャンペーン', kind: 'エピック', format: 'html' });
    expect(project?.why).toEqual(['4 月の 1 か月、割引コードを配って初めての注文を増やす。']);
    expect(project?.children).toEqual(['SHOP-420', 'SHOP-421', 'SHOP-422']);
    expect(project?.prs?.map((p) => [p.repo, p.number, p.state, p.self ?? false])).toEqual([
      ['shop/order-service', 40, 'merged', false],
      ['shop/order-service', 47, 'open', true],
      ['shop/order-service', 49, 'open', false],
      ['shop/mail-templates', 12, 'draft', false],
    ]);
    expect(Object.keys(analysis.background ?? {})).toEqual(['why', 'project', 'existing', 'terms']);
    expect(Object.keys(project ?? {})).toEqual(['parent', 'why', 'children', 'searched', 'repo', 'prs']);
    // 要求の抜き出しに親の本文（タグを外した文字）を渡す
    expect((JSON.parse(readFileSync(dumped, 'utf8')) as { parent: { key: string; body: string } }).parent).toMatchObject({ key: 'SHOP-400', body: expect.stringContaining('初めての注文を増やす') });
    expect(info).toContain('親チケットの本文にない文を除外しました: 親に無い文。');
    expect(info).toContain('案件: 親チケット SHOP-400 春のキャンペーン、同じ案件の PR 4 件（番号 4 個で検索）');
  });

  it('gh が失敗しても解析は続け、理由を project.errors と警告に残す', async () => {
    const { analysis, warnings } = await analyzeLocal(repo6, 'main', 'feature/discount', { ticket: ticket(), runGhAsync: gh('gh repo view に失敗しました: no git remotes found') });
    expect(analysis.background?.project?.parent?.key).toBe('SHOP-400');
    expect(analysis.background?.project?.errors).toEqual(['同じ案件の PR を探せませんでした: gh repo view に失敗しました: no git remotes found']);
    expect(warnings).toContain('同じ案件の PR を探せませんでした: gh repo view に失敗しました: no git remotes found');
  });

  it('ファイルのチケット・LLM を使わない解析: ファイルは親を調べず、LLM を使わなければ親の文は無いが PR は出す', async () => {
    const file = await analyzeLocal(repo6, 'main', 'feature/discount', { ticket: { ref: 'SHOP-421.md', cwd: path.join(FIXTURE_ROOT, 'ticket') }, runGhAsync: gh() });
    expect(file.analysis.background).not.toHaveProperty('project');
    const off = await analyzeLocal(repo6, 'main', 'feature/discount', { ticket: ticket(), runGhAsync: gh(), llm: 'off' });
    expect(off.analysis.background?.project?.parent?.key).toBe('SHOP-400');
    expect(off.analysis.background?.project).not.toHaveProperty('why');
    expect(off.analysis.background?.project?.prs).toHaveLength(4);
  });
});

/** ondina.config.yaml を書き換えて走らせ、終わったら戻す */
async function withYaml<T>(edit: (yaml: string) => string, run: () => Promise<T>): Promise<T> {
  const file = path.join(repo, 'ondina.config.yaml');
  const original = readFileSync(file, 'utf8');
  const edited = edit(original);
  if (edited === original) throw new Error('yaml を書き換えられませんでした');
  writeFileSync(file, edited);
  try {
    return await run();
  } finally {
    writeFileSync(file, original);
  }
}

describe('analyzeLocal の作業ツリー（head を渡さない。設計書 5.1）', () => {
  let wtRepo: string;
  let wtCleanup: () => void;
  beforeAll(() => {
    ({ dir: wtRepo, cleanup: wtCleanup } = buildFixtureRepo());
    git(wtRepo, 'checkout', '-q', 'feature/discount');
  });
  afterAll(() => wtCleanup());
  const order = 'src/main/kotlin/com/example/order/domain/Order.kt';
  /** 解析を 2 回するテストの上限。CI では 1 回 2〜3 秒かかり、既定の 5 秒では足りないことがある（2026-10-19 に 5.5 秒で落ちた） */
  const TWICE_MS = 15_000;

  it('ブランチのコミットとコミットしていない変更を解析する。headSha は作業ツリーの tree（コミットは作らない）、pr.head は今のブランチ、pr.workingTree が付く', async () => {
    const file = path.join(wtRepo, order);
    const commits = git(wtRepo, 'rev-list', '--all', '--count');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n// まだコミットしていない\n');
    writeFileSync(path.join(wtRepo, 'NOTES.md'), '新しいファイル\n');
    const { analysis, cachePath } = await analyzeLocal(wtRepo, 'main', undefined, { llm: 'off' });
    expect(analysis.pr.workingTree).toBe(true);
    expect(analysis.pr.head).toBe('feature/discount');
    expect(analysis.pr.base).toBe('main');
    expect(analysis.pr.title).toBe('main..feature/discount（作業中）');
    expect(analysis.pr.headSha).not.toBe(git(wtRepo, 'rev-parse', 'HEAD'));
    expect(git(wtRepo, 'cat-file', '-t', analysis.pr.headSha)).toBe('tree');
    // head の worktree も含め、コミットが増えない（git log --all に出ない。2026-10-15）
    expect(git(wtRepo, 'rev-list', '--all', '--count')).toBe(commits);
    expect(analysis.pr.baseSha).toBe(git(wtRepo, 'merge-base', 'main', 'HEAD'));
    // ブランチのコミットで足したファイル（作業ツリーでは変えていない）も入る（いまいるブランチで積んだコミットとコミットしていない差分を合わせて見る）
    expect(analysis.hunks.some((h) => h.path === 'src/main/kotlin/com/example/order/domain/DiscountCommand.kt')).toBe(true);
    expect(analysis.hunks.some((h) => h.path === 'NOTES.md')).toBe(true);
    expect(git(wtRepo, 'show', `${analysis.pr.headSha}:${order}`)).toContain('まだコミットしていない');
    expect(analysis.hunks.some((h) => h.path === order && h.lines.some((l) => l.includes('まだコミットしていない')))).toBe(true);
    expect(cachePath).toBe(path.join(wtRepo, '.ondina', 'local', `${analysis.pr.headSha}.json`));
    // 作業ツリーはそのまま（コミットも index も変えない）
    expect(git(wtRepo, 'status', '--porcelain')).toContain('NOTES.md');
  });

  it('作業ツリーが同じなら同じ headSha（.ondina の中身が増えても変わらない）', async () => {
    const a = await analyzeLocal(wtRepo, 'main', undefined, { llm: 'off' });
    const b = await analyzeLocal(wtRepo, 'main', undefined, { llm: 'off', title: '注文に割引' });
    expect(b.analysis.pr.headSha).toBe(a.analysis.pr.headSha);
    expect(b.analysis.pr.title).toBe('注文に割引');
  }, TWICE_MS);

  it('ブランチに乗っていない（detached HEAD）なら、pr.head と題は HEAD の短い sha', async () => {
    const short = git(wtRepo, 'rev-parse', '--short', 'HEAD');
    git(wtRepo, 'checkout', '-q', '--detach');
    try {
      const { analysis } = await analyzeLocal(wtRepo, 'main', undefined, { llm: 'off' });
      expect(analysis.pr.head).toBe(short);
      expect(analysis.pr.title).toBe(`main..${short}（作業中）`);
    } finally {
      git(wtRepo, 'checkout', '-q', 'feature/discount');
    }
  });

  it('リポジトリの中に置いた worktree の置き場は作業ツリーの tree に入れない', async () => {
    const { analysis } = await analyzeLocal(wtRepo, 'main', undefined, { llm: 'off', worktreeRoot: path.join(wtRepo, 'trees') });
    expect(git(wtRepo, 'ls-tree', '-r', '--name-only', analysis.pr.headSha).split('\n').some((f) => f.startsWith('trees/'))).toBe(false);
  });

  it('.ondina を .gitignore で無視していても、2 回目の解析が止まらない（2026-10-15）', async () => {
    // trees/ は前の it が置いた worktree の置き場（無視しないと入れ子のリポジトリとして入る）
    writeFileSync(path.join(wtRepo, '.gitignore'), '.ondina/\ntrees/\n');
    const a = await analyzeLocal(wtRepo, 'main', undefined, { llm: 'off' });
    writeFileSync(path.join(wtRepo, 'NOTES.md'), '書き足した\n');
    const b = await analyzeLocal(wtRepo, 'main', undefined, { llm: 'off' });
    expect(b.analysis.pr.headSha).not.toBe(a.analysis.pr.headSha);
    expect(b.analysis.hunks.some((h) => h.path === '.gitignore')).toBe(true);
    expect(b.analysis.hunks.some((h) => h.path.startsWith('.ondina'))).toBe(false);
  }, TWICE_MS);
});
