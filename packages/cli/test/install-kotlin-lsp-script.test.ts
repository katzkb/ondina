// scripts/install-kotlin-lsp.sh（kotlin-lsp を最新版にする。設計書 5.5 clone して入れる）を一時ディレクトリで走らせる。
// スクリプトは一時ディレクトリの scripts/ に写し、横の kotlin-lsp-version（入れる版の番号）をテストごとに書く。
// curl / ditto / uname / mv は test/kotlin-lsp-fakes/ の偽物に差し替える。ネットワークは使わない。
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPTS = path.resolve(import.meta.dirname, '../../../scripts');
const FAKES = path.resolve(import.meta.dirname, 'kotlin-lsp-fakes');
const LATEST = '263.6379.0';
const OLD = '263.4702.0';
const sitUrl = (ver: string, arch = '-aarch64') => `https://download.jetbrains.com/language-server/kotlin-server/${ver}/kotlin-server-${ver}${arch}.sit`;

interface Sandbox {
  root: string;
  /** 写したスクリプト */
  script: string;
  /** 写したスクリプトの横の kotlin-lsp-version */
  versionFile: string;
  /** kotlin-lsp の置き場（ONDINA_LSP_DIR） */
  dir: string;
  home: string;
  fakeBin: string;
  log: string;
}

let sb: Sandbox;

beforeEach(() => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ondina-kotlin-lsp-'));
  const fakeBin = path.join(root, 'fake-bin');
  mkdirSync(fakeBin);
  for (const name of ['curl', 'ditto', 'uname', 'mv']) {
    copyFileSync(path.join(FAKES, name), path.join(fakeBin, name));
    chmodSync(path.join(fakeBin, name), 0o755);
  }
  const scripts = path.join(root, 'ondina/scripts');
  mkdirSync(scripts, { recursive: true });
  const script = path.join(scripts, 'install-kotlin-lsp.sh');
  copyFileSync(path.join(SCRIPTS, 'install-kotlin-lsp.sh'), script);
  const versionFile = path.join(scripts, 'kotlin-lsp-version');
  writeFileSync(versionFile, `${LATEST}\n`);
  const home = path.join(root, 'home');
  mkdirSync(home);
  sb = { root, script, versionFile, dir: path.join(root, 'kotlin-lsp'), home, fakeBin, log: path.join(root, 'calls.log') };
});

afterEach(() => rmSync(sb.root, { recursive: true, force: true }));

function run(env: Record<string, string> = {}) {
  const r = spawnSync('sh', [sb.script], {
    encoding: 'utf8',
    // install.sh と同じく clone の最上位から走らせる。スクリプトは置き場所の横の kotlin-lsp-version を読む
    cwd: sb.home,
    env: {
      // 日本語の環境。macOS の /bin/sh（bash 3.2）は UTF-8 のとき、$var の直後の全角文字を変数名に含めてしまう
      LANG: 'ja_JP.UTF-8',
      PATH: [sb.fakeBin, process.env['PATH'] ?? ''].join(':'),
      HOME: sb.home,
      ONDINA_LSP_DIR: sb.dir,
      FAKE_LOG: sb.log,
      ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** 置き場に展開済みの版を置く（前に入れた版、または README の手順で手で入れた版） */
function placed(ver: string, date = '20260908') {
  const d = path.join(sb.dir, `kotlin-server-${ver}`);
  mkdirSync(path.join(d, 'bin'), { recursive: true });
  writeFileSync(path.join(d, 'bin/intellij-server'), '#!/bin/sh\n');
  chmodSync(path.join(d, 'bin/intellij-server'), 0o755);
  writeFileSync(path.join(d, 'product-info.json'), `{\n  "versionSuffix": "EAP",\n  "buildNumber": "${ver}",\n  "majorVersionReleaseDate": "${date}"\n}\n`);
}

function useCurrent(ver: string) {
  symlinkSync(`kotlin-server-${ver}`, path.join(sb.dir, 'current'));
}

const current = () => readlinkSync(path.join(sb.dir, 'current'));
const entries = () => readdirSync(sb.dir).sort();
const calls = () => (existsSync(sb.log) ? readFileSync(sb.log, 'utf8').trim().split('\n') : []);
const command = () => path.join(sb.dir, 'current/bin/intellij-server');

describe('scripts/install-kotlin-lsp.sh', () => {
  it('置き場が空なら、kotlin-lsp-version の版を JetBrains から落として SHA-256 を確かめ、展開して current を張る', () => {
    const r = run();
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(current()).toBe(`kotlin-server-${LATEST}`);
    accessSync(command(), constants.X_OK);
    expect(entries()).toEqual(['current', `kotlin-server-${LATEST}`]);
    // github.com には問い合わせない（GitHub Enterprise Server だけを使う環境では届かない。版は ondina の clone が持っている）
    expect(calls()).toEqual([`curl ${sitUrl(LATEST)}`, `curl ${sitUrl(LATEST)}.sha256`, `ditto kotlin-server-${LATEST}-aarch64.sit`]);
    expect(r.out).toContain(`kotlin-lsp を ${LATEST} にしました（2026-09-30 の版）`);
  });

  it('入っていない言語設定（LANG）でも、shasum（perl）の警告を出さずに入れる', () => {
    // CI の Linux には ja_JP.UTF-8 が無く、perl が「Setting locale failed」を stderr に出していた
    const r = run({ LANG: 'zz_ZZ.UTF-8' });
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(current()).toBe(`kotlin-server-${LATEST}`);
  });

  it('Intel の Mac では -aarch64 の付かない .sit を落とす', () => {
    const r = run({ FAKE_UNAME_M: 'x86_64' });
    expect(r.code).toBe(0);
    expect(calls()).toContain(`curl ${sitUrl(LATEST, '')}`);
    expect(current()).toBe(`kotlin-server-${LATEST}`);
  });

  it('最新が current なら何も落とさず、最新ですと出す', () => {
    placed(LATEST, '20260930');
    useCurrent(LATEST);
    const r = run();
    expect(r.code).toBe(0);
    expect(calls()).toEqual([]);
    expect(r.out).toContain(`kotlin-lsp は最新です（${LATEST}、2026-09-30 の版）`);
    expect(r.out).not.toContain('にしました');
  });

  it('手で入れた最新版（kotlin-server-<版>/）があれば、落とさずに current を張る', () => {
    placed(LATEST, '20260930');
    const r = run();
    expect(r.code).toBe(0);
    expect(calls()).toEqual([]);
    expect(current()).toBe(`kotlin-server-${LATEST}`);
    expect(r.out).toContain(`kotlin-lsp を ${LATEST} にしました（2026-09-30 の版）`);
  });

  it('新しい版が出ていれば入れ替え、古い版（展開した物と手で落とした .sit）を消す。置き場のほかのファイルは残す', () => {
    placed(OLD);
    useCurrent(OLD);
    writeFileSync(path.join(sb.dir, `kotlin-server-${OLD}-aarch64.sit`), 'old archive\n');
    writeFileSync(path.join(sb.dir, 'memo.txt'), 'mine\n');
    const r = run();
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(current()).toBe(`kotlin-server-${LATEST}`);
    expect(entries()).toEqual(['current', `kotlin-server-${LATEST}`, 'memo.txt']);
    expect(r.out).toContain(`kotlin-lsp を ${OLD} → ${LATEST} にしました（2026-09-30 の版）`);
    expect(r.out).toContain(`使っていない物を消しました: kotlin-server-${OLD} kotlin-server-${OLD}-aarch64.sit`);
  });

  it('前に途中で止めた残り（.tmp-<版>）は消す', () => {
    placed(LATEST, '20260930');
    useCurrent(LATEST);
    mkdirSync(path.join(sb.dir, `.tmp-${LATEST}`));
    writeFileSync(path.join(sb.dir, `.tmp-${LATEST}/kotlin-server-${LATEST}-aarch64.sit`), 'half\n');
    expect(run().code).toBe(0);
    expect(entries()).toEqual(['current', `kotlin-server-${LATEST}`]);
  });

  it('kotlin-lsp-version が無ければ、理由と今の版を出して 0 以外で終わる。current は動かない', () => {
    placed(OLD);
    useCurrent(OLD);
    rmSync(sb.versionFile);
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(`入れる版の番号を ${sb.versionFile} から読み取れませんでした`);
    expect(r.err).toContain(`今の版（${OLD}）のまま`);
    expect(calls()).toEqual([]);
    expect(current()).toBe(`kotlin-server-${OLD}`);
    expect(entries()).toEqual(['current', `kotlin-server-${OLD}`]);
  });

  it.each([[''], ['latest\n'], ['../263.6379.0\n']])('kotlin-lsp-version の中身が版の番号でなければ（%j）、何も落とさずに止まる', (content) => {
    writeFileSync(sb.versionFile, content);
    const r = run();
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('入れる版の番号を');
    expect(r.err).toContain('kotlin-lsp は入っていません');
    expect(calls()).toEqual([]);
    expect(existsSync(sb.dir)).toBe(false);
  });

  it('リポジトリの scripts/kotlin-lsp-version は版の番号 1 行（GitHub Actions が毎日書き換える）', () => {
    expect(readFileSync(path.join(SCRIPTS, 'kotlin-lsp-version'), 'utf8')).toMatch(/^\d+\.\d+\.\d+\n$/);
  });

  it('落とせなければ current は動かず、途中の物を残さない', () => {
    placed(OLD);
    useCurrent(OLD);
    const r = run({ FAKE_SIT_FAIL: '1' });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(`kotlin-server-${LATEST}-aarch64.sit を落とせませんでした`);
    expect(current()).toBe(`kotlin-server-${OLD}`);
    expect(entries()).toEqual(['current', `kotlin-server-${OLD}`]);
  });

  it('SHA-256 が合わなければ展開せず、途中の物を残さない', () => {
    const r = run({ FAKE_SHA_BAD: '1' });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('SHA-256 が合いません');
    expect(calls().some((c) => c.startsWith('ditto'))).toBe(false);
    expect(existsSync(sb.dir) ? entries() : []).toEqual([]);
  });

  it('展開できなければ止まり、途中の物を残さない', () => {
    const r = run({ FAKE_DITTO_FAIL: '1' });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('展開できませんでした');
    expect(existsSync(sb.dir) ? entries() : []).toEqual([]);
  });

  it('展開した物を置き場へ移せなければ、理由と今の版を出し、current は動かず途中の物を残さない', () => {
    placed(OLD);
    useCurrent(OLD);
    const r = run({ FAKE_MV_FAIL: '1' });
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(`kotlin-server-${LATEST} を置き場へ移せませんでした`);
    expect(r.err).toContain(`今の版（${OLD}）のまま`);
    expect(current()).toBe(`kotlin-server-${OLD}`);
    expect(entries()).toEqual(['current', `kotlin-server-${OLD}`]);
  });

  // ondina は置き場の current を自分で見つける。~/.zshrc の export は AI エージェントの非対話シェル（zsh -lc）に届かない（2026-10-19）
  it('ONDINA_LSP_COMMAND が無ければ、~/.zshrc に足す行を出さない', () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('ONDINA_LSP_COMMAND');
    expect(r.out).not.toContain('.zshrc');
  });

  it('ONDINA_LSP_COMMAND が別の場所（版の番号入りのパスなど）を指していれば、そちらが使われるので、消すよう出す', () => {
    placed(LATEST, '20260930');
    useCurrent(LATEST);
    const other = path.join(sb.dir, `kotlin-server-${LATEST}/bin/intellij-server`);
    const r = run({ ONDINA_LSP_COMMAND: other });
    expect(r.out).toContain(`環境変数 ONDINA_LSP_COMMAND が別の場所（${other}）を指しているので、ondina はそちらを使います`);
    expect(r.out).toContain(`${path.join(sb.home, '.zshrc')} などの ONDINA_LSP_COMMAND の行を消して`);
    expect(r.out).not.toContain('export ONDINA_LSP_COMMAND=');
  });

  it('ONDINA_LSP_COMMAND が current を指していれば、何も出さない', () => {
    placed(LATEST, '20260930');
    useCurrent(LATEST);
    const r = run({ ONDINA_LSP_COMMAND: command() });
    expect(r.out).not.toContain('ONDINA_LSP_COMMAND');
  });

  it('Mac 以外では何もせず 0 で終わる', () => {
    const r = run({ FAKE_UNAME_S: 'Linux' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('Mac 以外');
    expect(calls()).toEqual([]);
    expect(existsSync(sb.dir)).toBe(false);
  });
});
