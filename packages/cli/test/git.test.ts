// git 層: ref の解決、変更ファイル一覧、言語サーバー用の worktree。設計書 5.1。
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changedFixtureFiles } from '../../core/test/fixture.js';
import { buildConfigFiles, changedFiles, githubDiff, hasPath, parseDiffHunks, readBlobs, resolveLocalRefs, resolveWorkingTree, snapshotWorkingTree, switchWorktree } from '../src/git.js';
import { buildFixtureRepo, FIXTURE_ROOT, git } from './fixture-repo.js';

let repo: string;
let cleanup: () => void;
beforeAll(() => ({ dir: repo, cleanup } = buildFixtureRepo()));
afterAll(() => cleanup());

describe('resolveLocalRefs', () => {
  it('baseSha は merge-base、headSha は head の先端', () => {
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    expect(refs).toEqual({
      baseSha: git(repo, 'merge-base', 'main', 'feature/discount'),
      headSha: git(repo, 'rev-parse', 'feature/discount'),
    });
  });

  it('main が先に進んでいても baseSha は分岐点のまま', () => {
    const before = git(repo, 'rev-parse', 'main');
    writeFileSync(path.join(repo, 'NOTES.md'), 'later\n');
    git(repo, 'add', 'NOTES.md');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'main moves on');
    expect(resolveLocalRefs(repo, 'main', 'feature/discount').baseSha).toBe(before);
  });

  it('解決できない ref はエラーになる', () => {
    expect(() => resolveLocalRefs(repo, 'main', 'no-such-branch')).toThrow(/no-such-branch/);
  });
});

describe('switchWorktree（言語サーバー用。設計書 9.1）', () => {
  const dir = () => path.join(repo, '.ondina', 'lsp', 'head');

  it('無ければ detach で作り、前の中身は無い（previous: null）', () => {
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    expect(switchWorktree(repo, dir(), refs.baseSha)).toEqual({ previous: null, changed: [] });
    expect(git(dir(), 'rev-parse', 'HEAD')).toBe(refs.baseSha);
    expect(git(dir(), 'rev-parse', '--show-toplevel')).toBe(realpathSync(dir()));
  });

  it('同じ sha なら何もしない', () => {
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    expect(switchWorktree(repo, dir(), refs.baseSha)).toEqual({ previous: refs.baseSha, changed: [] });
  });

  it('別の sha には作り直さず checkout で切り替え、前の sha と変わったファイルを返す', () => {
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    const marker = path.join(dir(), '.gradle-marker');
    writeFileSync(marker, 'kept\n'); // 作り直していれば消える（追跡していないファイル。Gradle の .gradle/ や build/ と同じ）
    const r = switchWorktree(repo, dir(), refs.headSha);
    expect(r.previous).toBe(refs.baseSha);
    expect(r.changed.map((c) => c.path)).toEqual(git(repo, 'diff', '--name-only', '--no-renames', refs.baseSha, refs.headSha).split('\n'));
    expect(r.changed).toContainEqual({ path: 'src/main/kotlin/com/example/order/domain/DiscountCommand.kt', status: 'A' });
    expect(r.changed).toContainEqual({ path: 'src/main/kotlin/com/example/order/api/OrderController.kt', status: 'M' });
    expect(git(dir(), 'rev-parse', 'HEAD')).toBe(refs.headSha);
    expect(existsSync(path.join(dir(), 'src/main/kotlin/com/example/order/domain/DiscountCommand.kt'))).toBe(true);
    expect(existsSync(marker)).toBe(true);
  });

  it('追跡しているファイルが書き換わっていても切り替えられる', () => {
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    writeFileSync(path.join(dir(), 'build.gradle.kts'), 'broken\n');
    expect(switchWorktree(repo, dir(), refs.baseSha).previous).toBe(refs.headSha);
    expect(git(dir(), 'status', '--porcelain', '--untracked-files=no')).toBe('');
  });

  it('worktree として登録されていないディレクトリが残っていても作り直せる', () => {
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    git(repo, 'worktree', 'remove', '--force', dir());
    mkdirSync(dir(), { recursive: true });
    writeFileSync(path.join(dir(), 'stale.txt'), 'stale\n');
    expect(switchWorktree(repo, dir(), refs.headSha).previous).toBe(null);
    expect(git(dir(), 'rev-parse', 'HEAD')).toBe(refs.headSha);
    expect(git(dir(), 'rev-parse', '--show-toplevel')).toBe(realpathSync(dir()));
    expect(existsSync(path.join(dir(), 'stale.txt'))).toBe(false);
  });

  it('リポジトリ本体と同じ sha でも、素のディレクトリは worktree とみなさない', () => {
    // 素のディレクトリで git rev-parse HEAD を叩くと、外側のリポジトリの HEAD（= main = baseSha）が返る
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    git(repo, 'worktree', 'remove', '--force', dir());
    mkdirSync(dir(), { recursive: true });
    expect(switchWorktree(repo, dir(), refs.baseSha).previous).toBe(null);
    expect(git(dir(), 'rev-parse', '--show-toplevel')).toBe(realpathSync(dir()));
    expect(existsSync(path.join(dir(), 'build.gradle.kts'))).toBe(true);
  });
});

describe('buildConfigFiles（保存したプロジェクト構造の key。設計書 9.1）', () => {
  it('その版のビルドの設定ファイルと blob。コミットでも tree でも', () => {
    const sha = git(repo, 'rev-parse', 'main');
    const files = buildConfigFiles(repo, sha, 'kotlin');
    expect(files?.map((f) => f.path)).toEqual(['build.gradle.kts', 'settings.gradle.kts']);
    expect(files?.[0]?.blob).toBe(git(repo, 'rev-parse', `${sha}:build.gradle.kts`));
    expect(buildConfigFiles(repo, git(repo, 'rev-parse', `${sha}^{tree}`), 'kotlin')).toEqual(files);
  });

  it('規則の無い言語では undefined', () => {
    expect(buildConfigFiles(repo, git(repo, 'rev-parse', 'main'), 'typescript')).toBeUndefined();
  });
});

describe('hasPath', () => {
  it('その版にフォルダやファイルがあるか', () => {
    const sha = git(repo, 'rev-parse', 'main');
    expect(hasPath(repo, sha, 'src/main/kotlin')).toBe(true);
    expect(hasPath(repo, sha, 'build.gradle.kts')).toBe(true);
    expect(hasPath(repo, sha, 'src/main/java')).toBe(false);
    expect(hasPath(repo, git(repo, 'rev-parse', `${sha}^{tree}`), 'src/main/kotlin')).toBe(true);
  });
});

describe('changedFiles', () => {
  it('fixture の base/ と head/ の差分と同じ ChangedFile 列を返す（追加・削除を含む、パス順）', () => {
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    expect(changedFiles(repo, refs)).toEqual(changedFixtureFiles());
  });

  it('中身は git から読み、worktree を作らない', () => {
    const before = git(repo, 'worktree', 'list', '--porcelain');
    changedFiles(repo, resolveLocalRefs(repo, 'main', 'feature/discount'));
    expect(git(repo, 'worktree', 'list', '--porcelain')).toBe(before);
  });
});

describe('readBlobs', () => {
  it('その版のファイルの中身を、渡した順に返す。無いパスは null', () => {
    const sha = git(repo, 'rev-parse', 'main');
    const order = 'src/main/kotlin/com/example/order/domain/Order.kt';
    expect(readBlobs(repo, sha, ['no/such.kt', order, 'build.gradle.kts'])).toEqual([
      null,
      readFileSync(path.join(FIXTURE_ROOT, 'base', order), 'utf8'),
      readFileSync(path.join(FIXTURE_ROOT, 'base', 'build.gradle.kts'), 'utf8'),
    ]);
  });

  it('フォルダは null', () => {
    expect(readBlobs(repo, git(repo, 'rev-parse', 'main'), ['src/main/kotlin'])).toEqual([null]);
  });
});

describe('parseDiffHunks', () => {
  it('ファイルごとに @@ の塊を読む。数の省略は 1、新規は --- /dev/null、削除は +++ /dev/null', () => {
    const diff = [
      'diff --git a/a.kt b/a.kt',
      'index 1..2 100644',
      '--- a/a.kt',
      '+++ b/a.kt',
      '@@ -5,2 +5,3 @@ import x',
      ' a',
      '+b',
      ' z',
      '@@ -13 +14,2 @@ class A(',
      '-c',
      '+d',
      '+e',
      'diff --git a/new.sql b/new.sql',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.sql',
      '@@ -0,0 +1,2 @@',
      '+x',
      '+y',
      'diff --git a/gone.kt b/gone.kt',
      'deleted file mode 100644',
      '--- a/gone.kt',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-p',
      '-q',
      '-r',
    ].join('\n');
    expect(parseDiffHunks(diff)).toEqual([
      { path: 'a.kt', hunks: [{ oldStart: 5, oldLines: 2, newStart: 5, newLines: 3 }, { oldStart: 13, oldLines: 1, newStart: 14, newLines: 2 }] },
      { path: 'gone.kt', hunks: [{ oldStart: 1, oldLines: 3, newStart: 0, newLines: 0 }] },
      { path: 'new.sql', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2 }] },
    ]);
  });

  it('本文の行が @@ や --- で始まっても見出しと取り違えない', () => {
    const diff = ['--- a/a.sql', '+++ b/a.sql', '@@ -1,2 +1,2 @@', '--- comment', '+++ comment', ' @@ -9,9 +9,9 @@'].join('\n');
    expect(parseDiffHunks(diff)).toEqual([{ path: 'a.sql', hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2 }] }]);
  });
});

describe('githubDiff', () => {
  it('fixture の OrderController.kt は 2 つの塊（GitHub の PR と同じ。2026-10-06 確認）', () => {
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    const files = githubDiff(repo, refs);
    expect(files.find((f) => f.path === 'src/main/kotlin/com/example/order/api/OrderController.kt')?.hunks).toEqual([
      { oldStart: 5, oldLines: 6, newStart: 5, newLines: 7 },
      { oldStart: 13, oldLines: 8, newStart: 14, newLines: 9 },
    ]);
    expect(files.map((f) => f.path)).toEqual(changedFixtureFiles().map((f) => f.path));
  });

  it('全ファイルの塊はゴールデン expected/github-diff.json（2026-10-06 に GitHub の PR の 39 個と一致を確認した物）', async () => {
    const refs = resolveLocalRefs(repo, 'main', 'feature/discount');
    await expect(JSON.stringify(githubDiff(repo, refs), null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/github-diff.json'));
  });
});

describe('snapshotWorkingTree', () => {
  // 作業ツリーを変えるので、ほかの describe とは別のリポジトリで（feature/discount を checkout した状態）
  let wtRepo: string;
  let wtCleanup: () => void;
  beforeAll(() => {
    ({ dir: wtRepo, cleanup: wtCleanup } = buildFixtureRepo());
    git(wtRepo, 'checkout', '-q', 'feature/discount');
  });
  afterAll(() => wtCleanup());
  const headOf = () => git(wtRepo, 'rev-parse', 'HEAD');
  const controller = 'src/main/kotlin/com/example/order/api/OrderController.kt';

  it('変更が無ければ HEAD をそのまま返す', () => {
    expect(snapshotWorkingTree(wtRepo)).toBe(headOf());
  });

  it('コミットしていない変更・新しいファイル・消したファイルを含む tree を返す。コミットは作らず、本物の index・HEAD・ブランチは変えない', () => {
    const head = headOf();
    const indexBefore = git(wtRepo, 'ls-files', '--stage');
    const commits = git(wtRepo, 'rev-list', '--all', '--count');
    writeFileSync(path.join(wtRepo, controller), 'changed\n');
    writeFileSync(path.join(wtRepo, 'NEW.md'), 'new\n');
    git(wtRepo, 'rm', '-q', '--cached', 'ondina.config.yaml');
    const sha = snapshotWorkingTree(wtRepo);
    expect(sha).not.toBe(head);
    expect(git(wtRepo, 'cat-file', '-t', sha)).toBe('tree');
    // コミットが増えない（git log --all に出ない。2026-10-15）
    expect(git(wtRepo, 'rev-list', '--all', '--count')).toBe(commits);
    expect(git(wtRepo, 'show', `${sha}:${controller}`)).toBe('changed');
    expect(git(wtRepo, 'show', `${sha}:NEW.md`)).toBe('new');
    // index から外しただけで作業ツリーに残っているファイルは入る（作業ツリーが正）
    expect(git(wtRepo, 'cat-file', '-t', `${sha}:ondina.config.yaml`)).toBe('blob');
    expect(headOf()).toBe(head);
    expect(git(wtRepo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature/discount');
    expect(git(wtRepo, 'ls-files', '--stage')).not.toBe(indexBefore);
    git(wtRepo, 'add', 'ondina.config.yaml');
    expect(git(wtRepo, 'ls-files', '--stage')).toBe(indexBefore);
  });

  it('同じ作業ツリーなら同じ sha（時刻に左右されない）', () => {
    expect(snapshotWorkingTree(wtRepo)).toBe(snapshotWorkingTree(wtRepo));
  });

  it('ファイルを消した変更も入る', () => {
    rmSync(path.join(wtRepo, controller));
    const sha = snapshotWorkingTree(wtRepo);
    expect(() => git(wtRepo, 'cat-file', '-e', `${sha}:${controller}`)).toThrow();
  });

  it('.ondina と git が無視するファイル、渡した置き場は入れない', () => {
    mkdirSync(path.join(wtRepo, '.ondina', 'local'), { recursive: true });
    writeFileSync(path.join(wtRepo, '.ondina', 'local', 'x.json'), '{}\n');
    writeFileSync(path.join(wtRepo, '.gitignore'), 'ignored.txt\n');
    writeFileSync(path.join(wtRepo, 'ignored.txt'), 'x\n');
    mkdirSync(path.join(wtRepo, 'trees'), { recursive: true });
    writeFileSync(path.join(wtRepo, 'trees', 'y.txt'), 'y\n');
    const sha = snapshotWorkingTree(wtRepo, ['.ondina', 'trees']);
    const files = git(wtRepo, 'ls-tree', '-r', '--name-only', sha).split('\n');
    expect(files).toContain('.gitignore');
    expect(files.filter((f) => f.startsWith('.ondina') || f === 'ignored.txt' || f.startsWith('trees/'))).toEqual([]);
  });

  it('.ondina と置き場を .gitignore で無視していても失敗しない（除外の指定に無視したパスを書くと git add が止まる。2026-10-15）', () => {
    writeFileSync(path.join(wtRepo, '.gitignore'), '.ondina/\ntrees/\nignored.txt\n');
    const sha = snapshotWorkingTree(wtRepo, ['.ondina', 'trees']);
    const files = git(wtRepo, 'ls-tree', '-r', '--name-only', sha).split('\n');
    expect(files).toContain('NEW.md');
    expect(files.filter((f) => f.startsWith('.ondina') || f === 'ignored.txt' || f.startsWith('trees/'))).toEqual([]);
  });
});

describe('作業ツリーの解析の base と head、worktree（設計書 5.1）', () => {
  // ブランチのコミット（feature/discount）の上にコミットしていない変更がある状態
  let wtRepo: string;
  let wtCleanup: () => void;
  const order = 'src/main/kotlin/com/example/order/domain/Order.kt';
  const committed = 'src/main/kotlin/com/example/order/domain/DiscountCommand.kt';
  beforeAll(() => {
    ({ dir: wtRepo, cleanup: wtCleanup } = buildFixtureRepo());
    git(wtRepo, 'checkout', '-q', 'feature/discount');
    writeFileSync(path.join(wtRepo, order), readFileSync(path.join(wtRepo, order), 'utf8') + '// 作業中\n');
    writeFileSync(path.join(wtRepo, 'NOTES.md'), 'new\n');
  });
  afterAll(() => wtCleanup());

  it('baseSha は merge-base(base, HEAD)、headSha は作業ツリーの tree。ブランチのコミットとコミットしていない変更の両方が変更ファイルに入る', () => {
    const refs = resolveWorkingTree(wtRepo, 'main', undefined);
    expect(refs.baseSha).toBe(git(wtRepo, 'merge-base', 'main', 'HEAD'));
    expect(refs.headSha).toBe(snapshotWorkingTree(wtRepo));
    const files = changedFiles(wtRepo, refs).map((f) => f.path);
    expect(files).toContain(committed);
    expect(files).toContain(order);
    expect(files).toContain('NOTES.md');
  });

  it('changedFiles: head が tree なら、コミットしていない変更も含めて作業ツリーと同じ中身を読む', () => {
    const files = changedFiles(wtRepo, resolveWorkingTree(wtRepo, 'main', undefined));
    expect(files.find((f) => f.path === order)?.after).toContain('// 作業中');
    expect(files.find((f) => f.path === 'NOTES.md')?.after).toBe('new\n');
    // 全角の文字はバイト数と文字数が違う。後ろのファイルの読み取りがずれていないこと
    for (const f of files) expect(f.after).toBe(existsSync(path.join(wtRepo, f.path)) ? readFileSync(path.join(wtRepo, f.path), 'utf8') : null);
  });

  it('switchWorktree: コミット → tree → コミットと切り替え、前の版と変わったファイルを返す', () => {
    const dir = path.join(wtRepo, '.ondina', 'lsp', 'head');
    const head = git(wtRepo, 'rev-parse', 'HEAD');
    const tree = snapshotWorkingTree(wtRepo);
    expect(switchWorktree(wtRepo, dir, head).previous).toBe(null);
    const toTree = switchWorktree(wtRepo, dir, tree);
    expect(toTree.previous).toBe(head);
    expect(toTree.changed).toEqual([
      { path: 'NOTES.md', status: 'A' },
      { path: order, status: 'M' },
    ]);
    expect(readFileSync(path.join(dir, order), 'utf8')).toContain('// 作業中');
    expect(switchWorktree(wtRepo, dir, tree)).toEqual({ previous: tree, changed: [] });
    const back = switchWorktree(wtRepo, dir, head);
    expect(back.previous).toBe(tree);
    expect(back.changed).toEqual([
      { path: 'NOTES.md', status: 'D' },
      { path: order, status: 'M' },
    ]);
    expect(existsSync(path.join(dir, 'NOTES.md'))).toBe(false);
    expect(readFileSync(path.join(dir, order), 'utf8')).not.toContain('// 作業中');
    expect(git(dir, 'status', '--porcelain', '--untracked-files=no')).toBe('');
  });
});
