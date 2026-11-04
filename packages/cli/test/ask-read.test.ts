// 案内人が need で頼んだファイルと文字列を、解析した版（コミットか tree）から読む（設計書 10.5。2026-11-04）。
// fixture のリポジトリ（build-repo.sh）と、上限を見る一時のリポジトリで。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_FILE_LINES, MAX_HITS, readForAsk } from '../src/ask-read.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

const PROMO = 'src/main/kotlin/com/example/promo/PromoService.kt';
const APPLY = '        val d = order.discount.takeIf { it > Money.ZERO } ?: legacyPromo(order)';
const LEGACY = '    private fun legacyPromo(order: Order): Money = legacy.amountFor(order.id)';

describe('readForAsk（fixture のリポジトリ）', () => {
  let repo: string;
  let cleanup: () => void;
  let head: string;
  beforeAll(() => {
    ({ dir: repo, cleanup } = buildFixtureRepo());
    head = git(repo, 'rev-parse', 'feature/discount');
  });
  afterAll(() => cleanup());

  it('ファイルは解析した版の全文に head の番号を付ける（作業ツリーの今の中身は読まない）', async () => {
    writeFileSync(path.join(repo, PROMO), 'changed after the analysis\n');
    try {
      const [read] = await readForAsk(repo, head, { files: [PROMO], search: [] });
      expect(read).toMatchObject({ kind: 'file', request: PROMO, path: PROMO });
      expect(read!.lines).toHaveLength(15);
      expect(read!.lines[0]).toBe('h1   package com.example.promo');
      expect(read!.lines[13]).toBe(`h14   ${LEGACY}`);
    } finally {
      git(repo, 'checkout', '--', PROMO);
    }
  });

  it('作業ツリーの解析（headSha が tree の sha）でも読める。search は当たった行を path ごとに 1 件', async () => {
    const tree = git(repo, 'rev-parse', `${head}^{tree}`);
    const reads = await readForAsk(repo, tree, { files: [PROMO], search: ['legacyPromo'] });
    expect(reads[0]!.lines[0]).toBe('h1   package com.example.promo');
    expect(reads[1]).toEqual({ kind: 'search', request: 'legacyPromo', path: PROMO, lines: [`h10   ${APPLY}`, `h14   ${LEGACY}`] });
  });

  it('search は path の順で、ファイルごとに分ける', async () => {
    const reads = await readForAsk(repo, head, { files: [], search: ['Money.ZERO'] });
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.map((r) => r.path)).toEqual([...new Set(reads.map((r) => r.path))].sort());
    for (const r of reads) expect(r.lines.every((l) => /^h\d+ {3}.*Money\.ZERO/.test(l)), r.path).toBe(true);
  });

  it('頭の ./ と / は外して読む。無いパス・フォルダ・当たらない文字列は lines が空の 1 件（頼んだ順）', async () => {
    const reads = await readForAsk(repo, head, { files: [`./${PROMO}`, 'nope/Missing.kt', 'src'], search: ['zzNoSuchThing'] });
    expect(reads.map((r) => [r.kind, r.request, r.path, r.lines.length])).toEqual([
      ['file', `./${PROMO}`, PROMO, 15],
      ['file', 'nope/Missing.kt', 'nope/Missing.kt', 0],
      ['file', 'src', 'src', 0],
      ['search', 'zzNoSuchThing', '', 0],
    ]);
  });
});

describe('readForAsk の上限（一時のリポジトリ）', () => {
  let repo: string;
  let head: string;
  beforeAll(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'ondina-ask-read-'));
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(repo, 'long.txt'), Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    writeFileSync(path.join(repo, 'a.txt'), Array.from({ length: 30 }, (_, i) => `hit a${i + 1}`).join('\n') + '\n');
    writeFileSync(path.join(repo, 'b.txt'), Array.from({ length: 30 }, (_, i) => `hit b${i + 1}`).join('\n') + '\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x');
    head = git(repo, 'rev-parse', 'HEAD');
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it(`ファイルは先頭から ${MAX_FILE_LINES} 行で、続きは ⋯`, async () => {
    const [read] = await readForAsk(repo, head, { files: ['long.txt'], search: [] });
    expect(read!.lines).toHaveLength(MAX_FILE_LINES + 1);
    expect(read!.lines.at(-2)).toBe(`h${MAX_FILE_LINES}   line ${MAX_FILE_LINES}`);
    expect(read!.lines.at(-1)).toBe('⋯');
  });

  it(`文字列は ${MAX_HITS} か所までで、続きは最後の 1 件の末尾に ⋯`, async () => {
    const reads = await readForAsk(repo, head, { files: [], search: ['hit'] });
    expect(reads.map((r) => [r.path, r.lines.length])).toEqual([
      ['a.txt', 30],
      ['b.txt', MAX_HITS - 30 + 1],
    ]);
    expect(reads[1]!.lines.at(-2)).toBe(`h${MAX_HITS - 30}   hit b${MAX_HITS - 30}`);
    expect(reads[1]!.lines.at(-1)).toBe('⋯');
  });
});
