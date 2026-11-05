// git 層。設計書 5.1。
//
// - baseSha は merge-base(base, head)。GitHub の Files changed と同じファイル集合になる（base が先に進んでいても混ざらない）
// - 変更ファイルは `git diff --name-status --no-renames` で列挙し、内容は `git cat-file --batch` で git から読む。リネームは削除 + 追加（5.2「リネームは別 ID」）
//   解析のために worktree は作らない。PR ごとに作って残すと、リポジトリ丸ごとの複製が PR の数だけ .ondina に溜まった（2026-10-23）
// - worktree を持つのは言語サーバー用の 1 組だけ（switchWorktree）。detach で作り、中身は checkout で切り替える
// - GitHub の差分の塊は `git diff -U3` の `@@` 見出し（12 章。行コメントを付けられる行。2026-10-06 に本物の PR と全部一致を確認）
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildConfigPaths, type BuildConfigFile, type ChangedFile } from '@ondina/core';
import type { GithubDiffFile } from '@ondina/model';

export interface RefPair {
  baseSha: string;
  headSha: string;
}

export function git(repo: string, ...args: string[]): string {
  return gitEnv(repo, undefined, ...args);
}

const mainWorktrees = new Map<string, string>();

/**
 * 元のフォルダ（.git があるフォルダ）。git worktree の中で打っても同じフォルダを返す。PR 番号の解析はここの .ondina に置く（store.ts の keyDir）。
 * 元のフォルダが無い形（bare のリポジトリ・submodule）と git が答えないときは repo のまま
 */
export function mainWorktree(repo: string): string {
  const hit = mainWorktrees.get(repo);
  if (hit !== undefined) return hit;
  let root = repo;
  try {
    const common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    if (path.basename(common) === '.git' && realpathSync(path.dirname(common)) !== realpathSync(repo)) root = path.dirname(common);
  } catch {
    // git リポジトリでない・古い git
  }
  mainWorktrees.set(repo, root);
  return root;
}

/** 環境変数を足して git を呼ぶ（一時の index・コミットの作者と日時） */
function gitEnv(repo: string, env: Record<string, string> | undefined, ...args: string[]): string {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(env === undefined ? {} : { env: { ...process.env, ...env } }) }).replace(/\n$/, '');
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args.join(' ')} に失敗しました${stderr ? `: ${stderr}` : ''}`);
  }
}

/** ローカルの 2 ref（gh 無し）から baseSha / headSha を求める */
export function resolveLocalRefs(repo: string, base: string, head: string): RefPair {
  const headSha = git(repo, 'rev-parse', '--verify', '--quiet', `${head}^{commit}`);
  const baseTip = git(repo, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  return { baseSha: git(repo, 'merge-base', baseTip, headSha), headSha };
}

/**
 * 作業ツリー（コミットしていない変更と、git が無視しない新しいファイル）を 1 つの tree にして sha を返す。設計書 5.1。
 * - コミットは作らない（2026-10-15）。tree と中身（blob）は git に書くが、コミット・ブランチ・タグには載せないので `git log --all` に出ない
 * - 一時の index（本物の index の写し。変わっていないファイルを読み直さない）に `git add -A` するので、本物の index・HEAD・ブランチは変わらない
 * - 同じ作業ツリーなら同じ sha になり、解析と LLM の保存を使い回せる（原則 7）
 * - 変更が無ければ HEAD のコミットをそのまま返す
 * - exclude（リポジトリ直下からのパス）は入れない。既定の .ondina には base / head の worktree があり、入れると入れ子のリポジトリになる。
 *   git が無視しているパスは除外に書かない（`git add` は元々拾わないうえ、無視したパスを除外に書くと止まる。.ondina を .gitignore に入れたとき。2026-10-15）
 */
export function snapshotWorkingTree(repo: string, exclude: readonly string[] = ['.ondina']): string {
  const head = git(repo, 'rev-parse', '--verify', 'HEAD^{commit}');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ondina-index-'));
  const index = path.join(dir, 'index');
  try {
    const real = path.resolve(repo, git(repo, 'rev-parse', '--git-path', 'index'));
    if (existsSync(real)) copyFileSync(real, index);
    const env = { GIT_INDEX_FILE: index };
    const skip = exclude.filter((e) => !isIgnored(repo, e));
    gitEnv(repo, env, 'add', '-A', '--', '.', ...skip.map((e) => `:(exclude)${e}`));
    const tree = gitEnv(repo, env, 'write-tree');
    return tree === git(repo, 'rev-parse', `${head}^{tree}`) ? head : tree;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** git が無視しているパスか（`git check-ignore`。無視していなければ 1 で終わる） */
function isIgnored(repo: string, p: string): boolean {
  try {
    git(repo, 'check-ignore', '-q', '--', p);
    return true;
  } catch {
    return false;
  }
}

/**
 * analyze と新しい変更を聞くとき（reanalyze.ts）の両方が使う作業ツリーの tree。同じ除外で作らないと sha がずれる。
 * .ondina と、リポジトリの中にある worktree の置き場を除く
 */
export function workingTreeHead(repo: string, worktreeRoot: string | undefined): string {
  const rel = worktreeRoot === undefined ? undefined : path.relative(repo, path.resolve(repo, worktreeRoot));
  const inside = rel !== undefined && rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  return snapshotWorkingTree(repo, ['.ondina', ...(inside ? [rel] : [])]);
}

/**
 * 作業ツリーの解析の base と head。baseSha は merge-base(base, HEAD) なので、このブランチのコミットとコミットしていない変更の両方が差分に入る。
 * headSha は workingTreeHead（tree。merge-base には渡せないので HEAD で求める）
 */
export function resolveWorkingTree(repo: string, base: string, worktreeRoot: string | undefined): RefPair {
  const head = git(repo, 'rev-parse', '--verify', 'HEAD^{commit}');
  const baseTip = git(repo, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  return { baseSha: git(repo, 'merge-base', baseTip, head), headSha: workingTreeHead(repo, worktreeRoot) };
}

/**
 * dir を sha の worktree にする。sha が作業ツリーの tree なら、リポジトリの HEAD のコミットで作ってから tree を読み込む
 * （worktree の HEAD にはコミットしか置けない）
 */
function ensureWorktree(repo: string, dir: string, sha: string): void {
  if (existsSync(dir)) {
    if (worktreeAt(dir) === sha) return;
    removeDir(repo, dir);
  }
  if (isCommit(repo, sha)) {
    git(repo, 'worktree', 'add', '--detach', dir, sha);
    return;
  }
  git(repo, 'worktree', 'add', '--detach', dir, 'HEAD');
  git(dir, 'read-tree', '--reset', '-u', sha);
}

/**
 * 言語サーバー用の worktree（設計書 9.1）を sha にする。ensureWorktree と違い、作り直さずに checkout で切り替える。
 * 起動したままの言語サーバーは置き場所ごとに索引を持つので、場所と中身を残したまま差分だけ動かしたい（2026-10-15 実測）。
 * previous は切り替える前の sha（無かった・作り直したなら null）、changed は previous から変わったファイル（リポジトリ相対。A 追加 / M 変更 / D 削除）。
 * 追跡しているファイルの書き換えは捨てる（--force）。追跡していないファイル（Gradle の .gradle/ や build/）は残す
 */
export interface WorktreeChange {
  path: string;
  status: 'A' | 'M' | 'D';
}

export function switchWorktree(repo: string, dir: string, sha: string): { previous: string | null; changed: WorktreeChange[] } {
  const previous = existsSync(dir) ? worktreeAt(dir) : null;
  if (previous === null) {
    git(repo, 'worktree', 'prune');
    ensureWorktree(repo, dir, sha);
    return { previous: null, changed: [] };
  }
  if (previous === sha) return { previous, changed: [] };
  // 作業ツリーの tree は HEAD を動かさずに読み込む（index と中身だけ）。コミットへは checkout で戻る（tree で足したファイルも消える）
  if (isCommit(repo, sha)) git(dir, 'checkout', '-q', '--force', '--detach', sha);
  else git(dir, 'read-tree', '--reset', '-u', sha);
  const fields = git(repo, 'diff', '--name-status', '--no-renames', '-z', previous, sha).split('\0').filter((s) => s !== '');
  const changed: WorktreeChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const st = fields[i]!;
    changed.push({ path: fields[i + 1]!, status: st === 'A' || st === 'D' ? st : 'M' });
  }
  return { previous, changed };
}

/**
 * worktree が今どの版か。コミットを checkout したならそのコミット、作業ツリーの tree を読み込んだなら（index が HEAD と違うなら）その tree。
 * 素のディレクトリ・index を読めない（壊れている）なら null（呼ぶ側が作り直す）
 */
function worktreeAt(dir: string): string | null {
  const head = worktreeHead(dir);
  if (head === null) return null;
  try {
    const tree = git(dir, 'write-tree');
    return tree === git(dir, 'rev-parse', 'HEAD^{tree}') ? head : tree;
  } catch {
    return null;
  }
}

function isCommit(repo: string, sha: string): boolean {
  return git(repo, 'cat-file', '-t', sha) === 'commit';
}

/**
 * その版（コミットか tree）のビルドの設定ファイルと blob（設計書 9.1。保存したプロジェクト構造の key）。
 * 規則の無い言語では undefined（restart.ts の buildConfigPaths）
 */
export function buildConfigFiles(repo: string, sha: string, language: string): BuildConfigFile[] | undefined {
  const blobs = new Map<string, string>();
  for (const entry of git(repo, 'ls-tree', '-r', '-z', '--full-tree', sha).split('\0')) {
    const tab = entry.indexOf('\t');
    const [, type, blob] = entry.slice(0, tab).split(' ');
    if (tab !== -1 && type === 'blob' && blob !== undefined) blobs.set(entry.slice(tab + 1), blob);
  }
  return buildConfigPaths(language, [...blobs.keys()])?.map((p) => ({ path: p, blob: blobs.get(p)! }));
}

/** その版（コミットか tree）にリポジトリ相対のパス（フォルダかファイル）があるか */
export function hasPath(repo: string, sha: string, repoRelative: string): boolean {
  try {
    git(repo, 'cat-file', '-e', `${sha}:${repoRelative}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * dir が worktree の最上位ならその HEAD。素のディレクトリなら null。
 * （素のディレクトリで `git rev-parse HEAD` を叩くと外側のリポジトリの HEAD が返るので、最上位かどうかを見る）
 */
function worktreeHead(dir: string): string | null {
  try {
    const top = git(dir, 'rev-parse', '--show-toplevel');
    if (realpathSync(top) !== realpathSync(dir)) return null;
    return git(dir, 'rev-parse', 'HEAD');
  } catch {
    return null;
  }
}

/** worktree として登録されていれば `git worktree remove`、そうでなければ（残骸なら）ディレクトリごと消す */
function removeDir(repo: string, dir: string): void {
  try {
    git(repo, 'worktree', 'remove', '--force', dir);
  } catch {
    rmSync(dir, { recursive: true, force: true });
    git(repo, 'worktree', 'prune');
  }
}

/** baseSha..headSha で変わったファイルを、base / head の内容付きでパス順に返す */
export function changedFiles(repo: string, refs: RefPair): ChangedFile[] {
  const out = git(repo, 'diff', '--name-status', '--no-renames', '-z', refs.baseSha, refs.headSha);
  const fields = out.split('\0').filter((s) => s !== '');
  const paths: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) paths.push(fields[i + 1]!);
  paths.sort();
  const before = readBlobs(repo, refs.baseSha, paths);
  const after = readBlobs(repo, refs.headSha, paths);
  return paths.map((p, i) => ({ path: p, before: before[i]!, after: after[i]! }));
}

/**
 * その版（コミットか tree）のファイルの中身を、paths と同じ順に返す。無いパスとファイルでないものは null。
 * `git cat-file --batch` を 1 回だけ起こす（1 ファイルずつ起こすと 300 ファイルで 2.4 秒、まとめると 0.05 秒。2026-10-23 実測）。
 * 改行を含むパスは 1 行 1 件の入力に書けないので null。リポジトリの外を指すパスも null
 */
/** リポジトリ相対のパスが、リポジトリの外を指すか（../ で始まる・絶対パス） */
export function outsideRepo(p: string): boolean {
  return path.isAbsolute(p) || p === '..' || p.startsWith('../');
}

export function readBlobs(repo: string, sha: string, paths: readonly string[]): (string | null)[] {
  // リポジトリの外（../ で始まる・絶対パス）は git が cat-file ごと止めるので聞かない。言語サーバーの答えには worktree の外のファイルが混ざる（2026-11-05）
  const asked = paths.filter((p) => !p.includes('\n') && !outsideRepo(p));
  if (asked.length === 0) return paths.map(() => null);
  let out: Buffer;
  try {
    out = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: asked.map((p) => `${sha}:${p}\n`).join(''), maxBuffer: 1024 ** 3, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim();
    throw new Error(`git cat-file --batch に失敗しました${stderr ? `: ${stderr}` : ''}`);
  }
  // 1 件ごとに「<oid> <type> <size>」の行と中身と改行。無ければ「<入力> missing」の 1 行。size はバイト数
  const found = new Map<string, string | null>();
  let at = 0;
  for (const p of asked) {
    const eol = out.indexOf(0x0a, at);
    const head = /^[0-9a-f]+ (\S+) (\d+)$/.exec(out.toString('utf8', at, eol));
    at = eol + 1;
    if (head === null) {
      found.set(p, null);
      continue;
    }
    const size = Number(head[2]);
    found.set(p, head[1] === 'blob' ? out.toString('utf8', at, at + size) : null);
    at += size + 1;
  }
  return paths.map((p) => found.get(p) ?? null);
}

/**
 * baseSha..headSha の GitHub の差分の塊（ファイルごと、path 順）。利用者の設定に左右されないよう、文脈 3 行・git の既定の方式・接頭辞 a/ b/ に固定する
 */
export function githubDiff(repo: string, refs: RefPair): GithubDiffFile[] {
  const out = git(repo, '-c', 'core.quotePath=false', 'diff', '-U3', '--no-renames', '--no-color', '--no-ext-diff', '--diff-algorithm=default', '--src-prefix=a/', '--dst-prefix=b/', refs.baseSha, refs.headSha);
  return parseDiffHunks(out);
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** `git diff` の出力から、ファイルごとの `@@` の塊を読む。塊の中の行は見出しの数だけ読み飛ばす（`--- ` で始まる本文の行を見出しと取り違えない） */
export function parseDiffHunks(diff: string): GithubDiffFile[] {
  const files = new Map<string, GithubDiffFile['hunks']>();
  let oldPath: string | null = null;
  let current: GithubDiffFile['hunks'] | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  for (const line of diff.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      const c = line[0];
      if (c === '-') oldLeft--;
      else if (c === '+') newLeft--;
      else if (c === ' ' || line === '') {
        oldLeft--;
        newLeft--;
      }
      // '\ No newline at end of file' は数えない
      continue;
    }
    if (line.startsWith('--- ')) oldPath = line === '--- /dev/null' ? null : line.slice(6);
    else if (line.startsWith('+++ ')) {
      const p = line === '+++ /dev/null' ? oldPath : line.slice(6);
      if (p !== null) {
        current = files.get(p) ?? [];
        files.set(p, current);
      }
    } else if (current) {
      const m = HUNK.exec(line);
      if (!m) continue;
      const hunk = { oldStart: +m[1]!, oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3]!, newLines: m[4] === undefined ? 1 : +m[4] };
      current.push(hunk);
      oldLeft = hunk.oldLines;
      newLeft = hunk.newLines;
    }
  }
  return [...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, hunks]) => ({ path: p, hunks }));
}
