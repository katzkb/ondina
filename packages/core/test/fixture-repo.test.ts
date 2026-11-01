// fixtures/order-service/scripts/build-repo.sh が main / feature/discount の2ブランチを持つ git リポジトリを作ること。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changedFixtureFiles, FIXTURE_ROOT } from './fixture.js';

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

describe('build-repo.sh', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-order-service-'));
    execFileSync('sh', [path.join(FIXTURE_ROOT, 'scripts/build-repo.sh'), dir], { encoding: 'utf8' });
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('main と feature/discount の2ブランチを持ち、main をチェックアウトした状態で終わる', () => {
    expect(git(dir, 'branch', '--format=%(refname:short)').split('\n').sort()).toEqual(['feature/discount', 'main']);
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
  });

  it('空でないディレクトリを渡すと何もせずに失敗する', () => {
    expect(() => execFileSync('sh', [path.join(FIXTURE_ROOT, 'scripts/build-repo.sh'), dir], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/not empty/);
  });

  it('2ブランチの差分は base/ と head/ の差分と同じファイル集合になる', () => {
    const fromGit = git(dir, 'diff', '--name-only', 'main', 'feature/discount').split('\n').sort();
    expect(fromGit).toEqual(changedFixtureFiles().map((f) => f.path));
  });
});
