// 構成の推定（設計書 10.6）の cli 側。追跡ファイルの一覧と .kt の最上位の宣言を git から読み、LLM コマンドを起動し、
// 検査を通った構成を .ondina/structure.json に保存する。入力・プロンプト・検査・規則への組み直しは core（packages/core/src/structure/）。
// 推定はそのリポジトリで初めて analyze するとき（保存が無いとき）に 1 回だけ走る。推定し直すのは `ondina structure`。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildStructureInput,
  collectDeclarations,
  isStructureWarn,
  parseKotlin,
  parseStructureOutput,
  renderStructurePrompt,
  structureRules,
  unclassifiedSince,
  verifyStructure,
  type DeclarationKind,
  type LayerRule,
  type SavedStructure,
  type StructureRun,
} from '@ondina/core';
import { git } from './git.js';
import { runLlmCommand, type LlmRunResult } from './llm.js';

export const STRUCTURE_FILE = '.ondina/structure.json';
/** LLM の生の出力（失敗の調査用。label / text の llm/<headSha>.json と同じ形） */
const STRUCTURE_LLM_FILE = '.ondina/structure.llm.json';
/** 1 ファイルに添える最上位の宣言の数 */
const DECLS_PER_FILE = 20;
/** 画面と Analysis に載せる未分類のパスの数 */
const UNCLASSIFIED_SHOWN = 20;

/** その commit の追跡ファイル全部（昇順） */
export function listTrackedFiles(repo: string, sha: string): string[] {
  return git(repo, 'ls-tree', '-r', '--name-only', '-z', sha)
    .split('\0')
    .filter((p) => p !== '')
    .sort();
}

/** `git cat-file --batch` で、その commit のファイルの中身をまとめて読む（1 プロセス） */
function readBlobs(repo: string, sha: string, paths: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const buf = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: paths.map((p) => `${sha}:${p}\n`).join(''), maxBuffer: 1024 * 1024 * 1024 });
  let at = 0;
  for (const p of paths) {
    const nl = buf.indexOf(0x0a, at);
    const header = buf.subarray(at, nl).toString('utf8');
    at = nl + 1;
    const m = / blob (\d+)$/.exec(header);
    if (!m) continue; // missing など
    const size = Number(m[1]);
    out.set(p, buf.subarray(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return out;
}

// Map にする（DeclarationKind の 'constructor' が Object のプロパティとぶつかるため）
const KEYWORD = new Map<DeclarationKind, string>([
  ['class', 'class'],
  ['object', 'object'],
  ['function', 'fun'],
  ['property', 'val'],
  ['typealias', 'typealias'],
]);

/** .kt の最上位の宣言（`class Order` など）。読めなければ空 */
async function topDeclarations(source: string): Promise<string[]> {
  try {
    const tree = collectDeclarations(await parseKotlin(source));
    return tree.declarations.flatMap((d) => (KEYWORD.has(d.kind) ? [`${KEYWORD.get(d.kind)} ${d.name}`] : [])).slice(0, DECLS_PER_FILE);
  } catch {
    return [];
  }
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string';
/** 配列で、要素が全部 ok を満たすか */
const each = (v: unknown, ok: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every(ok);
const has = (...keys: string[]) => (x: unknown) => isObj(x) && keys.every((k) => str(x[k]));

/** 保存した構成。無い・形が違う（古い版・手で直して壊れたなど）ときは undefined（推定し直す。analyze を落とさない） */
export function readStructure(repo: string): SavedStructure | undefined {
  const file = path.join(repo, STRUCTURE_FILE);
  if (!existsSync(file)) return undefined;
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!isObj(s) || s['version'] !== 1 || !str(s['headSha']) || !str(s['at']) || !str(s['command'])) return undefined;
    // tests は 2026-10-12 より前の保存には無い（analyze が推定し直す）
    const shaped = each(s['layers'], has('name')) && each(s['dirs'], has('dir', 'layer')) && each(s['files'], has('path', 'layer')) && each(s['outside'], str) && each(s['known'], str) && (s['tests'] === undefined || each(s['tests'], str));
    return shaped ? (s as unknown as SavedStructure) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(repo: string, rel: string, value: unknown): void {
  const file = path.join(repo, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
}

export type RunLlm = (command: string, prompt: string, cwd: string) => Promise<LlmRunResult>;

/**
 * その commit のリポジトリ全体から構成を推定し、検査を通ったものを .ondina/structure.json に保存する。
 * 失敗したら保存しない（次の analyze でやり直す）。生の出力は成否にかかわらず .ondina/structure.llm.json に残す
 */
export async function inferStructure(
  repo: string,
  sha: string,
  command: string,
  runLlm: RunLlm = runLlmCommand,
  /** 推定し直すとき: 前回の層の名前（上から）。名前と並びを保たせる（原則 7） */
  previous?: readonly string[],
): Promise<{ saved: SavedStructure; info: string[] } | { error: string }> {
  const paths = listTrackedFiles(repo, sha);
  const kt = paths.filter((p) => p.endsWith('.kt'));
  const blobs = readBlobs(repo, sha, kt);
  const decls = new Map<string, string[]>();
  for (const p of kt) {
    const src = blobs.get(p);
    if (src !== undefined) decls.set(p, await topDeclarations(src));
  }
  const built = buildStructureInput(
    paths.map((p) => ({ path: p, ...(decls.has(p) ? { decls: decls.get(p)! } : {}) })),
    previous === undefined ? {} : { previous },
  );
  if ('error' in built) return { error: built.error };
  const run = await runLlm(command, renderStructurePrompt(built.input), repo);
  writeJson(repo, STRUCTURE_LLM_FILE, { command, headSha: sha, stdout: run.stdout, stderr: run.stderr, exitCode: run.exitCode, recordedAt: new Date().toISOString() });
  if (run.timedOut) return { error: `時間切れ（${Math.round(run.stdout.length / 1024)} KB 受信）` };
  if (run.exitCode !== 0) return { error: `終了コード ${run.exitCode ?? 'なし'}: ${run.stderr.trim().slice(0, 200) || '（stderr なし）'}` };
  const parsed = parseStructureOutput(run.stdout);
  if ('error' in parsed) return { error: parsed.error };
  const { structure, info } = verifyStructure(parsed.output, paths);
  if (structure.layers.length === 0) return { error: '層を 1 つも推定できませんでした' };
  const saved: SavedStructure = { version: 1, headSha: sha, at: new Date().toISOString(), command, ...structure, known: paths };
  writeJson(repo, STRUCTURE_FILE, saved);
  return { saved, info: built.declsDropped ? ['構成の推定: 入力が大きいので .kt の宣言を落としてパスだけ渡しました', ...info] : info };
}

/** 保存した構成を、その commit のファイルに当てる。層の規則と、Analysis に残す記録（増えた未分類の数を含む） */
export function applyStructure(saved: SavedStructure, paths: readonly string[]): { rules: LayerRule[]; run: StructureRun } {
  const unclassified = unclassifiedSince(saved, paths);
  return {
    rules: structureRules(saved),
    run: {
      status: 'ok',
      command: saved.command,
      inferred: { headSha: saved.headSha, at: saved.at },
      layers: saved.layers.map((l) => l.name),
      unclassified: { count: unclassified.length, total: saved.known.length, warn: isStructureWarn(unclassified.length, saved.known.length), paths: unclassified.slice(0, UNCLASSIFIED_SHOWN) },
    },
  };
}

/** 推定の日付（表示用。手元の時刻で YYYY-MM-DD） */
export const inferredDate = (at: string): string => new Date(at).toLocaleDateString('sv-SE');
