// 構成の推定の cli 側（設計書 10.6）: git から読んだ事実を LLM に渡し、生の出力を残す。LLM は差し替えて中身を見る。
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StructureInput } from '@ondina/core';
import { inferStructure, readStructure } from '../src/structure.js';
import { buildFixtureRepo, git } from './fixture-repo.js';

let repo: string;
let cleanup: () => void;
beforeAll(() => ({ dir: repo, cleanup } = buildFixtureRepo()));
afterAll(() => cleanup());

const inputOf = (prompt: string) => JSON.parse(prompt.slice(prompt.lastIndexOf('入力:\n') + '入力:\n'.length)) as StructureInput;
const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, timedOut: false });

describe('inferStructure', () => {
  it('その commit の追跡ファイル全部をディレクトリごとに渡し、.kt には最上位の宣言を添える', async () => {
    let prompt = '';
    const sha = git(repo, 'rev-parse', 'feature/discount');
    const r = await inferStructure(repo, sha, 'fake', async (_c, p) => {
      prompt = p;
      return ok(JSON.stringify({ layers: [{ name: 'Domain', why: '' }], dirs: [{ dir: 'src/main/kotlin/com/example/order/domain', layer: 'Domain' }], files: [], outside: ['gradle'], tests: ['src/test/'] }));
    });
    const input = inputOf(prompt);
    expect(input.files).toBe(git(repo, 'ls-tree', '-r', '--name-only', sha).split('\n').length);
    const domain = input.dirs.find((d) => d.dir === 'src/main/kotlin/com/example/order/domain')!;
    expect(domain.files.find((f) => f.name === 'Order.kt')?.decls).toContain('class Order');
    expect(input.dirs.find((d) => d.dir === '.')?.files.some((f) => f.name === 'ondina.config.yaml' && f.decls === undefined)).toBe(true);
    if ('error' in r) throw new Error(r.error);
    // 無いディレクトリ（gradle/）は検査で落ち、理由が残る
    expect(r.saved.outside).toEqual([]);
    expect(r.info).toContain('構成の推定を除外しました（ないディレクトリ）: gradle');
    // テストの置き場（5.2 の 7）も検査を通して保存する
    expect(r.saved.tests).toEqual(['src/test']);
    expect((JSON.parse(readFileSync(path.join(repo, '.ondina/structure.json'), 'utf8')) as { tests?: string[] }).tests).toEqual(['src/test']);
  });

  it('推定し直すときは前回の層の名前を previous で渡す（原則 7）', async () => {
    let prompt = '';
    await inferStructure(repo, git(repo, 'rev-parse', 'HEAD'), 'fake', async (_c, p) => {
      prompt = p;
      return ok('{}');
    }, ['API', 'Core']);
    expect(inputOf(prompt).previous).toEqual({ layers: ['API', 'Core'] });
  });

  it('生の出力を .ondina/structure.llm.json に残す（失敗でも）', async () => {
    rmSync(path.join(repo, '.ondina/structure.json'), { force: true });
    const r = await inferStructure(repo, git(repo, 'rev-parse', 'HEAD'), 'fake', async () => ({ stdout: 'nope', stderr: 'bad', exitCode: 3, timedOut: false }));
    expect(r).toEqual({ error: '終了コード 3: bad' });
    const rec = JSON.parse(readFileSync(path.join(repo, '.ondina/structure.llm.json'), 'utf8')) as { stdout: string; exitCode: number };
    expect(rec).toMatchObject({ stdout: 'nope', exitCode: 3 });
    expect(existsSync(path.join(repo, '.ondina/structure.json'))).toBe(false);
  });
});

describe('readStructure', () => {
  const file = () => path.join(repo, '.ondina/structure.json');
  const good = { version: 1, headSha: 'a'.repeat(40), at: '2026-10-09T00:00:00.000Z', command: 'c', layers: [{ name: 'API', why: '' }], dirs: [{ dir: 'src', layer: 'API' }], files: [{ path: 'a.kt', layer: 'API' }], outside: ['docs'], known: ['a.kt'] };
  const write = (v: unknown) => {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify(v));
  };

  it('形の合った保存を読む。テストの置き場は無くても読む（2026-10-12 より前の保存）', () => {
    write(good);
    expect(readStructure(repo)).toEqual(good);
    write({ ...good, tests: ['src/test'] });
    expect(readStructure(repo)?.tests).toEqual(['src/test']);
  });

  it('配列の中身の形が違えば undefined（手で直した・壊れた保存は推定し直す。analyze を落とさない）', () => {
    for (const broken of [
      { ...good, dirs: [{ dir: 'src' }] },
      { ...good, files: [{ layer: 'API' }] },
      { ...good, layers: [{ why: '' }] },
      { ...good, outside: [1] },
      { ...good, known: [null] },
      { ...good, tests: [1] },
      { ...good, tests: 'src/test' },
    ]) {
      write(broken);
      expect(readStructure(repo), JSON.stringify(broken)).toBeUndefined();
    }
  });
});
