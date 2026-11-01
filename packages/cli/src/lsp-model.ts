// 保存したプロジェクト構造で、Gradle の取り込みを省いて言語サーバーを起動する（設計書 9.1）。中身の読み書きの規則は core（project-model.ts）。
//
// 2026-10-19 の実測（fixture と Spring Boot のリポジトリ、kotlin-lsp 263.6379.0 / 263.7084.0）:
// - kotlin-lsp の exportWorkspace は、Gradle で取り込んだプロジェクト構造を workspace.json に書く。取り込みの直後（索引の前）でも中身は同じ
// - workspace.json だけがあり Gradle のファイルが無いフォルダを渡すと「Importing with Json」になり、Gradle は走らない。結果は完全に一致した
// - base / head それぞれのフォルダに置けば、モジュール名が同じでも両側とも一致した。Gradle の形では取り込みが 2 回走っていた
// - 構造には、書き出した時点に在るソースのフォルダしか入らない。後から増えたフォルダのファイルは色が欠けるので、増えていれば書き出し直す
//
// 置き場所:
// - 保存: .ondina/lsp/models/<key>/<書き出した版の sha>.json（<WORKSPACE> のまま）。key はビルドの設定ファイルの中身と kotlin-lsp の実体
// - 渡すフォルダ: <言語サーバー用の worktree の親>/json/{head,base}/workspace.json（<WORKSPACE> を各 worktree の絶対パスにしたもの）
// - 書き出し用の作業場所: .ondina/lsp/export（本体の索引と混ぜない）
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXPORT_PROJECT_MODEL_COMMAND, outsideSourceDirs, placeProjectModel, PROJECT_MODEL_FILE, projectModelFiles, projectModelKey, projectModelSourceDirs, type ImportNotificationRule } from '@ondina/core';
import type { LspRun } from '@ondina/model';
import { buildConfigFiles, hasPath } from './git.js';
import { formatDuration, lspHome, startLspSession, waitingLine } from './lsp.js';

/** 保存しておくプロジェクト構造の数。新しく使った順に残す（大きなリポジトリでは 1 つ数 MB） */
export const PROJECT_MODEL_KEEP = 20;

type Side = 'head' | 'base';
const SIDES: readonly Side[] = ['head', 'base'];

export function projectModelDir(repo: string): string {
  return path.join(lspHome(repo), 'models');
}

/** 書き出しのために起動する kotlin-lsp の作業場所（--system-path） */
export function exportCacheDir(repo: string): string {
  return path.join(lspHome(repo), 'export');
}

/** JSON の取り込みが失敗した kotlin-lsp の印。実体（バージョン）ごと。あれば、その kotlin-lsp では保存した構造を使わない */
function brokenMark(repo: string, server: string): string {
  return path.join(projectModelDir(repo), `broken-${createHash('sha256').update(server).digest('hex').slice(0, 16)}`);
}

/** 使っている保存 1 つ（その側の分） */
export interface UsedModel {
  /** 保存のファイル */
  file: string;
  /** 書き出した版（コミットか tree） */
  from: string;
  /** ソースのフォルダ（リポジトリ相対） */
  sourceDirs: string[];
}

export type PreparedModel =
  /** 保存した構造で起動する。folders を workspaceFolders に渡す */
  | { kind: 'json'; folders: string[]; used: Record<Side, UsedModel> }
  /** Gradle の形で起動する（今までどおり） */
  | { kind: 'gradle' }
  /** 書き出しのための取り込みが失敗した。その解析は unavailable（もう一度 Gradle で待たない） */
  | { kind: 'failed'; run: LspRun };

export interface PrepareModelArgs {
  repo: string;
  language: string;
  command: string;
  /** yaml の args（{cacheDir} は置換前） */
  args: readonly string[];
  readyTimeoutSec: number;
  readyCapSec?: number;
  rule: ImportNotificationRule;
  /** 言語サーバー用の worktree の親（<root>/head と <root>/base は切り替え済み） */
  root: string;
  shas: Record<Side, string>;
  /** 意味トークンを取るファイル（リポジトリ相対） */
  sides: Record<Side, readonly string[]>;
  progress?: (line: string) => void;
  waitReportMs?: number;
  env?: Record<string, string>;
  handleSignals?: boolean;
  signal?: AbortSignal;
}

/** 実体のパス。無ければそのまま */
export function realpathOr(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** 変更ファイルが、保存の書き出した版に無かったソースのフォルダにあれば、その最も上のフォルダ（増えたフォルダ） */
export function grownSourceDir(repo: string, used: UsedModel, files: readonly string[]): string | undefined {
  for (const f of outsideSourceDirs(used.sourceDirs, files)) {
    const parts = path.posix.dirname(f).split('/').filter((p) => p !== '' && p !== '.');
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      // 書き出した版に在ったフォルダなら、Gradle はそれを見たうえでソースにしなかった（毎回書き出し直さないように）
      if (!hasPath(repo, used.from, dir)) return dir;
    }
  }
  return undefined;
}

/** 新しく使った順に keep 個まで残し、ほかを消す */
export function pruneProjectModels(repo: string, keep: number = PROJECT_MODEL_KEEP): void {
  const dir = projectModelDir(repo);
  if (!existsSync(dir)) return;
  const files: { file: string; at: number }[] = [];
  for (const key of readdirSync(dir)) {
    const sub = path.join(dir, key);
    if (!statSync(sub).isDirectory()) continue;
    for (const f of readdirSync(sub)) if (f.endsWith('.json')) files.push({ file: path.join(sub, f), at: statSync(path.join(sub, f)).mtimeMs });
  }
  files.sort((a, b) => b.at - a.at);
  for (const { file } of files.slice(keep)) {
    rmSync(file, { force: true });
    const sub = path.dirname(file);
    if (readdirSync(sub).length === 0) rmSync(sub, { recursive: true, force: true });
  }
}

/** JSON の取り込みが失敗した。その保存を消し、この kotlin-lsp では保存した構造を使わない印を残す */
export function forgetProjectModels(repo: string, command: string, used: Record<Side, UsedModel>, reason: string): void {
  for (const side of SIDES) rmSync(used[side].file, { force: true });
  mkdirSync(projectModelDir(repo), { recursive: true });
  writeFileSync(brokenMark(repo, realpathOr(command)), `${reason}\n`);
}

/** 書き出し 1 回。取り込みの成功を受けたら exportWorkspace を打ち、読んで返す。索引は待たない */
async function exportModel(a: PrepareModelArgs, dir: string): Promise<{ text: string } | { gradle: string } | { failed: LspRun }> {
  const out = path.join(dir, PROJECT_MODEL_FILE);
  if (existsSync(out)) return { gradle: `worktree に ${PROJECT_MODEL_FILE} があるので、プロジェクト構造を保存せずに Gradle で取り込みます` };
  const started = await startLspSession({
    command: a.command,
    args: a.args,
    roots: { head: dir, base: dir },
    folders: [dir],
    openFiles: [],
    cacheDir: exportCacheDir(a.repo),
    readyTimeoutSec: a.readyTimeoutSec,
    ...(a.readyCapSec === undefined ? {} : { readyCapSec: a.readyCapSec }),
    rule: a.rule,
    targets: [],
    until: 'imported',
    requireCommand: EXPORT_PROJECT_MODEL_COMMAND,
    ...(a.env === undefined ? {} : { env: a.env }),
    ...(a.waitReportMs === undefined ? {} : { waitReportMs: a.waitReportMs }),
    ...(a.progress === undefined ? {} : { onWaiting: (w) => a.progress?.(waitingLine(w)) }),
    ...(a.handleSignals === undefined ? {} : { handleSignals: a.handleSignals }),
    ...(a.signal === undefined ? {} : { signal: a.signal }),
  });
  if ('run' in started) {
    if (started.missingCommand !== undefined) return { gradle: 'この kotlin-lsp はプロジェクト構造を書き出せないので、Gradle で取り込みます' };
    return { failed: started.run };
  }
  try {
    await started.session.client.request('workspace/executeCommand', { command: EXPORT_PROJECT_MODEL_COMMAND, arguments: [dir] });
    const text = readFileSync(out, 'utf8');
    JSON.parse(text);
    return { text };
  } catch (e) {
    return { gradle: `プロジェクト構造を書き出せませんでした（${e instanceof Error ? e.message : String(e)}）。Gradle で取り込みます` };
  } finally {
    // 書き出しが worktree に書いたファイルは残さない（Gradle のファイルと同じ場所なので、残っても Gradle が勝つ）
    rmSync(out, { force: true });
    await started.session.close();
  }
}

/** 保存を書く（tmp → rename） */
function save(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** key の保存を新しく使った順に */
function candidates(repo: string, key: string): string[] {
  const dir = path.join(projectModelDir(repo), key);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f))
    .sort((x, y) => statSync(y).mtimeMs - statSync(x).mtimeMs);
}

function used(file: string, model: unknown): UsedModel {
  return { file, from: path.basename(file, '.json'), sourceDirs: projectModelSourceDirs(model) };
}

/**
 * 起動の前に、保存したプロジェクト構造を用意する。無い・使えない側だけ Gradle で書き出す（base と head が同じ設定なら 1 回）。
 * 書き出しの失敗は戻り値で返す。git やファイルの読み書きが投げたら、そのまま投げる（呼ぶ側の job が unavailable にする）
 */
export async function prepareProjectModel(a: PrepareModelArgs): Promise<PreparedModel> {
  const server = realpathOr(a.command);
  if (existsSync(brokenMark(a.repo, server))) {
    a.progress?.('この kotlin-lsp では保存したプロジェクト構造を読み込めなかったので、Gradle で取り込みます');
    return { kind: 'gradle' };
  }
  const files = { head: buildConfigFiles(a.repo, a.shas.head, a.language), base: buildConfigFiles(a.repo, a.shas.base, a.language) };
  // 規則の無い言語・Gradle のファイルが無い（Gradle の形でない）なら、今までどおり
  if (files.head === undefined || files.base === undefined || files.head.length === 0 || files.base.length === 0) return { kind: 'gradle' };
  const keys = { head: projectModelKey(server, files.head), base: projectModelKey(server, files.base) };
  const worktree = (side: Side): string => path.join(a.root, side);
  const home = os.homedir();
  const chosen: Partial<Record<Side, { file: string; model: unknown }>> = {};

  for (const side of SIDES) {
    // base が head と同じ設定なら、head で選んだ（書き出したばかりかもしれない）保存を使う。フォルダが増えていなければ
    const same = side === 'base' && keys.base === keys.head ? chosen.head : undefined;
    if (same !== undefined && grownSourceDir(a.repo, used(same.file, same.model), a.sides.base) === undefined) {
      chosen.base = same;
      continue;
    }
    let reason = `このビルドの設定のプロジェクト構造はまだ保存していないので、Gradle で取り込んで保存します（${keys.head === keys.base && side === 'head' ? 'head・base' : side}）`;
    for (const file of candidates(a.repo, keys[side])) {
      if (file === chosen.head?.file) continue;
      let model: unknown;
      try {
        model = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        rmSync(file, { force: true });
        continue;
      }
      const missing = projectModelFiles(model, home).find((p) => !existsSync(p));
      if (missing !== undefined) {
        // Gradle のキャッシュを消した・kotlin-lsp のバージョンを入れ替えた。この保存はもう使えない
        rmSync(file, { force: true });
        reason = `保存してあるプロジェクト構造が指すファイルが見つからないので、Gradle で取り込み直します（${path.basename(missing)}）`;
        continue;
      }
      const grown = grownSourceDir(a.repo, used(file, model), a.sides[side]);
      if (grown !== undefined) {
        reason = `ソースのフォルダ（${grown}）が増えたので、Gradle で取り込み直します`;
        continue;
      }
      chosen[side] = { file, model };
      break;
    }
    if (chosen[side] !== undefined) continue;

    a.progress?.(reason);
    const t = Date.now();
    const exported = await exportModel(a, worktree(side));
    if ('failed' in exported) return { kind: 'failed', run: exported.failed };
    if ('gradle' in exported) {
      a.progress?.(exported.gradle);
      return { kind: 'gradle' };
    }
    const file = path.join(projectModelDir(a.repo), keys[side], `${a.shas[side]}.json`);
    save(file, exported.text);
    chosen[side] = { file, model: JSON.parse(exported.text) };
    a.progress?.(`プロジェクト構造を保存しました（${formatDuration(Date.now() - t)}）。同じビルドの設定なら、次からは Gradle の取り込みを省きます`);
  }

  const folders: string[] = [];
  const out: Partial<Record<Side, UsedModel>> = {};
  const now = new Date();
  for (const side of SIDES) {
    const c = chosen[side]!;
    const dir = path.join(a.root, 'json', side);
    const target = path.join(dir, PROJECT_MODEL_FILE);
    const text = placeProjectModel(c.model, worktree(side));
    mkdirSync(dir, { recursive: true });
    if (!existsSync(target) || readFileSync(target, 'utf8') !== text) writeFileSync(target, text);
    utimesSync(c.file, now, now);
    folders.push(dir);
    out[side] = used(c.file, c.model);
  }
  pruneProjectModels(a.repo);
  a.progress?.('保存してあるプロジェクト構造を使うので、Gradle の取り込みを省きます');
  return { kind: 'json', folders, used: out as Record<Side, UsedModel> };
}
