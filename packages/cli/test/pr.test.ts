// gh 層: `gh pr view --json` の出力を PrRef にし、origin から base / head を fetch して sha を解決する。設計書 5.1。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchPr, prFromGhJson, prUrlArgs, resolvePrRefs, runGhAsync, targetFromGhJson } from '../src/pr.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

const ghJson = JSON.stringify({
  number: 42,
  title: 'Apply discount to orders',
  body: '割引を足した。',
  baseRefName: 'main',
  headRefName: 'feature/discount',
  headRefOid: '0123456789abcdef0123456789abcdef01234567',
});

describe('prFromGhJson', () => {
  it('gh の JSON を PrRef に写す', () => {
    expect(prFromGhJson(ghJson)).toEqual({
      number: 42,
      title: 'Apply discount to orders',
      body: '割引を足した。',
      base: 'main',
      head: 'feature/discount',
      headSha: '0123456789abcdef0123456789abcdef01234567',
    });
    // body が null（本文なし）なら空文字
    expect(prFromGhJson(ghJson.replace('"割引を足した。"', 'null')).body).toBe('');
  });

  it('足りないフィールドがあればエラー', () => {
    expect(() => prFromGhJson('{"number": 1}')).toThrow(/gh/);
  });
});

describe('targetFromGhJson', () => {
  it('gh pr view の url からホストと owner / name を読む（GitHub Enterprise Server も同じ形）', () => {
    expect(prUrlArgs(42)).toEqual(['pr', 'view', '42', '--json', 'url']);
    expect(targetFromGhJson('{"url":"https://ghe.example.co.jp/team-a/order-service/pull/42"}')).toEqual({ host: 'ghe.example.co.jp', owner: 'team-a', name: 'order-service' });
    expect(targetFromGhJson('{"url":"https://github.com/katzkb/ondina/pull/7"}')).toEqual({ host: 'github.com', owner: 'katzkb', name: 'ondina' });
  });

  it('PR の URL の形でなければ、その値を含めてエラー', () => {
    expect(() => targetFromGhJson('{"url":"https://ghe.example.co.jp/team-a"}')).toThrow(/ghe\.example\.co\.jp\/team-a/);
    expect(() => targetFromGhJson('{}')).toThrow(/URL/);
  });
});

describe('fetchPr', () => {
  it('gh pr view <n> --json … を対象リポジトリで実行する', () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const pr = fetchPr('/repo', 42, (args, cwd) => {
      calls.push({ args, cwd });
      return ghJson;
    });
    expect(pr.number).toBe(42);
    expect(calls).toEqual([{ args: ['pr', 'view', '42', '--json', 'number,title,body,baseRefName,headRefName,headRefOid'], cwd: '/repo' }]);
  });

  it('gh が失敗したら理由を含めてエラー', () => {
    expect(() =>
      fetchPr('/repo', 42, () => {
        throw new Error('gh: command not found');
      }),
    ).toThrow(/gh: command not found/);
  });
});

describe('resolvePrRefs', () => {
  // origin = fixture リポジトリ（refs/pull/1/head を feature/discount に向ける）、対象 = その clone
  let origin: { dir: string; cleanup: () => void };
  let clone: string;
  beforeAll(() => {
    origin = buildFixtureRepo();
    git(origin.dir, 'update-ref', 'refs/pull/1/head', 'feature/discount');
    clone = mkdtempSync(path.join(os.tmpdir(), 'ondina-clone-'));
    git(clone, 'clone', '-q', '--branch', 'main', origin.dir, clone);
  });
  afterAll(() => {
    origin.cleanup();
    rmSync(clone, { recursive: true, force: true });
  });

  it('origin から refs/pull/<n>/head と base ブランチを fetch し、merge-base と headSha を返す', () => {
    const headSha = git(origin.dir, 'rev-parse', 'feature/discount');
    expect(git(clone, 'branch', '--list', 'feature/discount')).toBe('');
    const refs = resolvePrRefs(clone, { number: 1, title: 't', base: 'main', head: 'feature/discount', headSha });
    expect(refs).toEqual({ baseSha: git(origin.dir, 'merge-base', 'main', 'feature/discount'), headSha });
    expect(git(clone, 'cat-file', '-t', headSha)).toBe('commit');
  });

  it('対象が shallow clone（CI の actions/checkout 既定）でも merge-base を求められる', () => {
    // main を 1 コミット進めてから depth 1 で clone すると、分岐点のコミットが手元に無い
    const originRepo = origin.dir;
    writeFileSync(path.join(originRepo, 'NOTES.md'), 'later\n');
    git(originRepo, 'add', 'NOTES.md');
    git(originRepo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'main moves on');
    const shallow = mkdtempSync(path.join(os.tmpdir(), 'ondina-shallow-'));
    try {
      git(shallow, 'clone', '-q', '--depth', '1', '--branch', 'main', `file://${originRepo}`, shallow);
      expect(git(shallow, 'rev-parse', '--is-shallow-repository')).toBe('true');
      const headSha = git(originRepo, 'rev-parse', 'feature/discount');
      const refs = resolvePrRefs(shallow, { number: 1, title: 't', base: 'main', head: 'feature/discount', headSha });
      expect(refs.baseSha).toBe(git(originRepo, 'merge-base', 'main', 'feature/discount'));
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  });
});

describe('runGhAsync', () => {
  // PATH の先頭に偽の gh（stderr に書いて 1 で終わる / stdout に書く）を置く
  let bin: string;
  let path0: string | undefined;
  beforeAll(() => {
    bin = mkdtempSync(path.join(os.tmpdir(), 'ondina-gh-'));
    writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nif [ "$3" = ok ]; then echo out; exit 0; fi\necho "gh: Bad credentials (HTTP 401)" >&2\nexit 1\n', { mode: 0o755 });
    path0 = process.env['PATH'];
    process.env['PATH'] = `${bin}${path.delimiter}${path0 ?? ''}`;
  });
  afterAll(() => {
    process.env['PATH'] = path0;
    rmSync(bin, { recursive: true, force: true });
  });

  it('stdout を返す', async () => {
    expect(await runGhAsync(['api', 'graphql', 'ok'], os.tmpdir())).toBe('out\n');
  });

  it('失敗は gh のサブコマンドと gh のエラーだけを言う（GraphQL の文などの引数は出さない。通知に出るので）', async () => {
    const err = await runGhAsync(['api', 'graphql', '-F', 'owner={owner}', '-f', 'query=query($owner: String!) { repository { id } }'], os.tmpdir()).catch((e: unknown) => e as Error);
    expect(err.message).toBe('gh api graphql に失敗しました: gh: Bad credentials (HTTP 401)');
  });
});
