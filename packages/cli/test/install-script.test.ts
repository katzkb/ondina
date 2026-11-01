// scripts/install.sh（設計書 5.5 clone して入れる）を一時ディレクトリで走らせる。
// origin 役の裸のリポジトリから clone した所で本物のスクリプトを動かし、pnpm は偽物に差し替える。ネットワークは使わない。
import { execFileSync, spawnSync } from 'node:child_process';
import { accessSync, appendFileSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(import.meta.dirname, '../../../scripts/install.sh');

// 利用者のグローバル設定（hook など）に左右されない git
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'ondina-test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'ondina-test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...GIT_ENV } }).trim();
}

// 偽の install-kotlin-lsp.sh（6 段目）。本物は install-kotlin-lsp-script.test.ts で確かめる
const FAKE_KOTLIN_LSP = `echo "fake kotlin-lsp"
exit \${FAKE_LSP_EXIT:-0}
`;

// AI エージェントのスキル（設計書 12 章）。origin/main（b）にだけある
const SKILL = '---\nname: ondina-comments\ndescription: test\n---\n';

// 偽の pnpm: 呼ばれた引数を記録し、build で packages/cli/dist/index.js を作る
const FAKE_PNPM = `#!/bin/sh
echo "pnpm $*" >> "$FAKE_LOG"
case "$1" in
  -v|--version) echo "\${FAKE_PNPM_VERSION:-12.4.1}" ;;
  build)
    if [ -n "$FAKE_BUILD_FAIL" ]; then echo "build failed" >&2; exit 1; fi
    mkdir -p packages/cli/dist
    printf '#!/usr/bin/env node\\nconsole.log("fake ondina")\\n' > packages/cli/dist/index.js
    ;;
esac
`;

interface Sandbox {
  root: string;
  /** origin に積むコミットを作る所 */
  seed: string;
  clone: string;
  bin: string;
  fakeBin: string;
  log: string;
  /** 1 つ目のコミット（clone はここから始まる） */
  a: string;
  /** origin/main の先頭。scripts/install-kotlin-lsp.sh はここで入る（a には無い） */
  b: string;
}

let sb: Sandbox;

beforeEach(() => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ondina-install-'));
  const seed = path.join(root, 'seed');
  mkdirSync(path.join(seed, 'scripts'), { recursive: true });
  git(seed, 'init', '-q', '-b', 'main');
  copyFileSync(SCRIPT, path.join(seed, 'scripts/install.sh'));
  writeFileSync(path.join(seed, '.gitignore'), 'dist/\nnode_modules/\n');
  writeFileSync(path.join(seed, 'note.txt'), 'first\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'first commit');
  const a = git(seed, 'rev-parse', 'HEAD');
  writeFileSync(path.join(seed, 'later.txt'), 'second\n');
  writeFileSync(path.join(seed, 'scripts/install-kotlin-lsp.sh'), FAKE_KOTLIN_LSP);
  mkdirSync(path.join(seed, 'skills/ondina-comments'), { recursive: true });
  writeFileSync(path.join(seed, 'skills/ondina-comments/SKILL.md'), SKILL);
  git(seed, 'add', '.');
  git(seed, 'commit', '-q', '-m', 'second commit subject');
  const b = git(seed, 'rev-parse', 'HEAD');

  execFileSync('git', ['clone', '-q', '--bare', seed, path.join(root, 'origin.git')], { stdio: 'pipe', env: { ...process.env, ...GIT_ENV } });
  const clone = path.join(root, 'clone');
  execFileSync('git', ['clone', '-q', path.join(root, 'origin.git'), clone], { stdio: 'pipe', env: { ...process.env, ...GIT_ENV } });
  git(clone, 'reset', '-q', '--hard', a);

  const fakeBin = path.join(root, 'fake-bin');
  mkdirSync(fakeBin);
  writeFileSync(path.join(fakeBin, 'pnpm'), FAKE_PNPM);
  chmodSync(path.join(fakeBin, 'pnpm'), 0o755);
  const home = path.join(root, 'home');
  mkdirSync(home);
  sb = { root, seed, clone, bin: path.join(root, 'bin'), fakeBin, log: path.join(root, 'pnpm.log'), a, b };
});

afterEach(() => rmSync(sb.root, { recursive: true, force: true }));

function install(args: string[] = [], env: Record<string, string> = {}, pathHead: string[] = []) {
  const r = spawnSync('sh', [path.join(sb.clone, 'scripts/install.sh'), ...args], {
    encoding: 'utf8',
    env: {
      ...GIT_ENV,
      // 日本語の環境。macOS の /bin/sh（bash 3.2）は UTF-8 のとき、$var の直後の全角文字を変数名に含めてしまう
      LANG: 'ja_JP.UTF-8',
      PATH: [...pathHead, sb.fakeBin, process.env['PATH'] ?? ''].join(':'),
      HOME: path.join(sb.root, 'home'),
      ONDINA_BIN_DIR: sb.bin,
      FAKE_LOG: sb.log,
      ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const head = () => git(sb.clone, 'rev-parse', 'HEAD');
const short = (sha: string) => git(sb.clone, 'rev-parse', '--short=7', sha);
const date = (sha: string) => git(sb.clone, 'log', '-1', '--format=%cs', sha);
const pnpmCalls = () => (existsSync(sb.log) ? readFileSync(sb.log, 'utf8').trim().split('\n') : []);

describe('scripts/install.sh', () => {
  it('初回: origin/main を取って組み立て、ondina コマンドを置き、どの版からどの版になったかを出す', () => {
    const r = install();
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(head()).toBe(sb.b);
    expect(git(sb.clone, 'status', '--porcelain', '--branch').split('\n')[0]).toMatch(/HEAD \(no branch\)/);
    expect(pnpmCalls()).toEqual(['pnpm -v', 'pnpm install --frozen-lockfile', 'pnpm build']);

    const link = path.join(sb.bin, 'ondina');
    expect(realpathSync(link)).toBe(realpathSync(path.join(sb.clone, 'packages/cli/dist/index.js')));
    accessSync(link, constants.X_OK);
    expect(execFileSync(link, { encoding: 'utf8' })).toBe('fake ondina\n');

    expect(r.out).toContain(`ondina を ${short(sb.a)} → ${short(sb.b)} にしました（${date(sb.b)}）`);
    expect(r.out).toContain('入ったコミット:');
    expect(r.out).toContain(`${short(sb.b)} second commit subject`);
  });

  it('各段で [n/6] を出す', () => {
    const r = install();
    for (const n of [1, 2, 3, 4, 5, 6]) expect(r.out).toContain(`[${n}/6] `);
  });

  it('6 段目で、取った版の scripts/install-kotlin-lsp.sh を走らせる', () => {
    const r = install();
    expect(r.out).toContain('[6/6] kotlin-lsp を最新にする\nfake kotlin-lsp\n');
  });

  it('install-kotlin-lsp.sh が失敗しても止まらず、ondina の更新を済ませて 0 で終わる', () => {
    const r = install([], { FAKE_LSP_EXIT: '1' });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`ondina を ${short(sb.a)} → ${short(sb.b)} にしました`);
  });

  it('戻した版に install-kotlin-lsp.sh が無ければ、そう出して続ける', () => {
    install();
    const r = install([short(sb.a)]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('この版は kotlin-lsp を入れません');
    expect(r.out).not.toContain('fake kotlin-lsp');
  });

  it('もう一度走らせると「最新です」と出す', () => {
    install();
    const r = install();
    expect(r.code).toBe(0);
    expect(r.out).toContain(`ondina は最新です（${short(sb.b)}、${date(sb.b)}）`);
    expect(r.out).not.toContain('にしました');
  });

  it('版を指定するとその版に戻し、外れたコミットを出す', () => {
    install();
    const r = install([short(sb.a)]);
    expect(r.code).toBe(0);
    expect(head()).toBe(sb.a);
    expect(r.out).toContain(`ondina を ${short(sb.b)} → ${short(sb.a)} にしました（${date(sb.a)}）`);
    expect(r.out).toContain('外れたコミット:');
    expect(r.out).toContain(`${short(sb.b)} second commit subject`);
  });

  it('追跡しているファイルが書き換わっていたら止まり、版も動かさず組み立てもしない', () => {
    appendFileSync(path.join(sb.clone, 'note.txt'), 'edited on the work PC\n');
    const r = install();
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('直接直さない');
    expect(r.err).toContain(`git -C ${sb.clone} status`);
    expect(head()).toBe(sb.a);
    expect(pnpmCalls()).not.toContain('pnpm install --frozen-lockfile');
  });

  it('追跡していないファイルがあるだけなら止まらない', () => {
    writeFileSync(path.join(sb.clone, 'stray.txt'), 'x\n');
    expect(install().code).toBe(0);
    expect(head()).toBe(sb.b);
  });

  it('main 以外の名前付きブランチにいたら止まる（開発用の clone で誤って走らせない）', () => {
    git(sb.clone, 'checkout', '-q', '-b', 'topic');
    const r = install();
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("ブランチ 'topic'");
    expect(head()).toBe(sb.a);
    expect(pnpmCalls()).not.toContain('pnpm install --frozen-lockfile');
  });

  it('github.com から取れなければネットワークを確かめる案内を出して止まり、版は動かさない', () => {
    git(sb.clone, 'remote', 'set-url', 'origin', path.join(sb.root, 'nowhere.git'));
    const r = install();
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('github.com から取れませんでした。ネットワークを確かめてから、もう一度走らせてください');
    expect(head()).toBe(sb.a);
  });

  it('組み立てに失敗したら、前の版に戻すコマンドを出して止まる', () => {
    const r = install([], { FAKE_BUILD_FAIL: '1' });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(`sh ${path.join(sb.clone, 'scripts/install.sh')} ${short(sb.a)}`);
    expect(existsSync(path.join(sb.bin, 'ondina'))).toBe(false);
  });

  it('Node.js が 22 より古ければ止まり、何も変えない', () => {
    const oldNode = path.join(sb.root, 'old-node');
    mkdirSync(oldNode);
    writeFileSync(path.join(oldNode, 'node'), '#!/bin/sh\necho v20.11.0\n');
    chmodSync(path.join(oldNode, 'node'), 0o755);
    const r = install([], {}, [oldNode]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('Node.js 22 以上');
    expect(r.err).toContain('v20.11.0');
    expect(head()).toBe(sb.a);
    expect(pnpmCalls()).not.toContain('pnpm install --frozen-lockfile');
  });

  it('pnpm が 12 より古ければ止まる', () => {
    const r = install([], { FAKE_PNPM_VERSION: '10.4.0' });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('pnpm 12 以上');
    expect(r.err).toContain('10.4.0');
    expect(head()).toBe(sb.a);
  });

  // ~/.zshrc は対話の zsh しか読まない。AI エージェントはコマンドを非対話の zsh（zsh -lc）で打つ（2026-10-19）
  it('コマンドの置き場が PATH に無ければ、非対話の zsh も読む ~/.zshenv に足す 1 行を出す', () => {
    const r = install();
    expect(r.out).toContain(`${sb.bin} が PATH にありません。${path.join(sb.root, 'home/.zshenv')} に次の 1 行を足して`);
    expect(r.out).toContain(`export PATH="${sb.bin}:$PATH"`);
  });

  it('コマンドの置き場が PATH にあれば、その 1 行は出さない', () => {
    const r = install([], {}, [sb.bin]);
    expect(r.out).not.toContain('export PATH=');
  });

  it('Tab 補完: ondina completion zsh の出力を ~/.zsh_functions/_ondina に置く（偽の dist は "fake ondina" を出す）', () => {
    const r = install();
    expect(r.code).toBe(0);
    expect(readFileSync(path.join(sb.root, 'home/.zsh_functions/_ondina'), 'utf8')).toBe('fake ondina\n');
  });

  it('Tab 補完: ZDOTDIR があればその下の .zsh_functions に置く', () => {
    const zdot = path.join(sb.root, 'zdot');
    const r = install([], { ZDOTDIR: zdot });
    expect(r.code).toBe(0);
    expect(readFileSync(path.join(zdot, '.zsh_functions/_ondina'), 'utf8')).toBe('fake ondina\n');
  });

  describe('Tab 補完が効くかを、普段の zsh を起こして確かめる', () => {
    const sourceLine = () => `source "${path.join(sb.root, 'home/.zsh_functions/_ondina')}"`;
    const compinitLine = 'autoload -Uz compinit && compinit';
    // 偽の zsh: install.sh が起こす対話の zsh の代わりに、FAKE_ZSH_OUT をそのまま出す
    const asZsh = (out: string, env: Record<string, string> = {}) => {
      const dir = path.join(sb.root, 'fake-zsh');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'zsh'), '#!/bin/sh\nprintf "%s" "$FAKE_ZSH_OUT"\n');
      chmodSync(path.join(dir, 'zsh'), 0o755);
      return install([], { FAKE_ZSH_OUT: out, ...env }, [dir]);
    };

    it('ondina が補完の対象に登録されていれば、何も案内しない', () => {
      const r = asZsh('ondina-completion:1:_ondina\n');
      expect(r.code).toBe(0);
      expect(r.out).not.toContain('fpath+=');
      expect(r.out).not.toContain('source "');
      expect(r.out).not.toContain(compinitLine);
    });

    it('~/.zshrc が先に制御文字を出していても、同じ行の後ろから読む', () => {
      const r = asZsh('\u001b[?1042londina-completion:1:_ondina\n');
      expect(r.out).not.toContain('fpath+=');
      expect(r.out).not.toContain('source "');
      expect(r.out).not.toContain('確かめられませんでした');
    });

    it('~/.zshrc に .zsh_functions の行があっても、登録されていなければ、末尾に足す source の 1 行を出す', () => {
      // prezto などが先に compinit を走らせると、後ろの fpath の行は効かない（2026-10-12 にこの Mac で起きた）
      writeFileSync(path.join(sb.root, 'home/.zshrc'), 'fpath+=${ZDOTDIR:-~}/.zsh_functions\n');
      const r = asZsh('ondina-completion:1:\n');
      expect(r.code).toBe(0);
      expect(r.out).toContain(`${path.join(sb.root, 'home/.zshrc')} の末尾に`);
      expect(r.out).toContain(`  ${sourceLine()}\n`);
      expect(r.out).not.toContain(compinitLine);
    });

    it('compinit が走っていなければ、compinit と source の 2 行を出す', () => {
      const r = asZsh('ondina-completion:0:\n');
      expect(r.out).toContain(`  ${compinitLine}\n  ${sourceLine()}\n`);
    });

    it('zsh から答えが返らなければ、確かめられなかったと出し、効かないときの 1 行を出す', () => {
      const r = asZsh('');
      expect(r.code).toBe(0);
      expect(r.out).toContain('確かめられませんでした');
      expect(r.out).toContain(`  ${sourceLine()}\n`);
    });

    it('ZDOTDIR があれば、その下の .zshrc と .zsh_functions/_ondina を案内する', () => {
      const zdot = path.join(sb.root, 'zdot');
      const r = asZsh('ondina-completion:1:\n', { ZDOTDIR: zdot });
      expect(r.out).toContain(`${path.join(zdot, '.zshrc')} の末尾に`);
      expect(r.out).toContain(`  source "${path.join(zdot, '.zsh_functions/_ondina')}"\n`);
    });

    const hasZsh = spawnSync('zsh', ['-c', 'true']).status === 0;

    it.skipIf(!hasZsh)('本物の zsh: ~/.zshrc が無ければ（compinit が走らない）、compinit と source の 2 行を出す', () => {
      const r = install();
      expect(r.out).toContain(`  ${compinitLine}\n  ${sourceLine()}\n`);
    });

    it.skipIf(!hasZsh)('本物の zsh: ~/.zshrc で ondina が登録されていれば、何も案内しない', () => {
      writeFileSync(path.join(sb.root, 'home/.zshrc'), 'autoload -Uz compinit && compinit -i -D\ncompdef _ondina ondina\n');
      const r = install();
      expect(r.out).not.toContain('fpath+=');
      expect(r.out).not.toContain('source "');
      expect(r.out).not.toContain('確かめられませんでした');
    });
  });

  it('スキル: 取った版の skills/ を ~/.agents/skills/ に置く（Codex と OpenCode が読む）', () => {
    const r = install();
    expect(r.code).toBe(0);
    expect(readFileSync(path.join(sb.root, 'home/.agents/skills/ondina-comments/SKILL.md'), 'utf8')).toBe(SKILL);
    expect(r.out).toContain(`スキルを置きました: ${path.join(sb.root, 'home/.agents/skills')}/ondina-comments`);
  });

  it('スキル: 置き直すと、前の版にだけあったファイルは残らない', () => {
    const dir = path.join(sb.root, 'home/.agents/skills/ondina-comments');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'old.md'), 'old\n');
    install();
    expect(existsSync(path.join(dir, 'old.md'))).toBe(false);
    expect(readFileSync(path.join(dir, 'SKILL.md'), 'utf8')).toBe(SKILL);
  });

  it('スキル: ほかのスキルには触らない', () => {
    const other = path.join(sb.root, 'home/.agents/skills/mine/SKILL.md');
    mkdirSync(path.dirname(other), { recursive: true });
    writeFileSync(other, 'mine\n');
    install();
    expect(readFileSync(other, 'utf8')).toBe('mine\n');
  });

  it('スキル: 戻した版に skills/ が無ければ、そう出して置いてあるものは残す', () => {
    install();
    const r = install([short(sb.a)]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('この版はスキルを置きません');
    expect(readFileSync(path.join(sb.root, 'home/.agents/skills/ondina-comments/SKILL.md'), 'utf8')).toBe(SKILL);
  });

});
