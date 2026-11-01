// analyze と serve のあいだで、言語サーバーの仕事をやり取りする（設計書 9.1 / 5.5）。
// serve は言語サーバーを起動したまま持つ（lsp-session.ts）。analyze は serve の子でも CLI からでも、
// 元のフォルダの .ondina/serve.json（serve が起動時に書き、終わるときに消す）で serve を見つけて POST /api/lsp を送る。
// 応答は 1 行 1 JSON: 進み {"progress": "…"} を何行か、最後に {"done": …}。意味トークンの Map は [パス, data] の組で送る。
import { readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { testPathsFor, type CallGraphSource, type DefinitionSource, type ImportNotificationRule, type LayerRule, type ProbeTarget, type SemanticLegend } from '@ondina/core';
import type { Hunk, LspRun } from '@ondina/model';
import { mainWorktree } from './git.js';
import { alive, type LspJobArgs, type LspJobResult } from './lsp-session.js';

/** POST /api/lsp の本文。LspJobArgs のうち関数を除いたもの（テストの見分けは作る材料を送る） */
export interface LspJobRequest extends Omit<LspJobArgs, 'isTestPath' | 'progress' | 'hunks' | 'targets' | 'sides' | 'changed'> {
  sides: { head: string[]; base: string[] };
  /** 無い = 定義（3.6）より前の analyze。toJobArgs が hunk と sides のファイルで埋める */
  changed?: string[];
  targets: ProbeTarget[];
  hunks: Hunk[];
  /** testPathsFor の材料（設定の layers / sourceRoots と、構成の推定のテストの置き場） */
  tests: { layers: LayerRule[]; sourceRoots: string[]; inferred?: string[] };
}

interface WireResult {
  run: LspRun;
  reused: boolean;
  result?: { semantic: { legend: SemanticLegend; head: Array<[string, number[]]>; base: Array<[string, number[]]> }; callGraph: CallGraphSource; definitions?: DefinitionSource };
}

export type WireLine = { progress: string } | { done: WireResult };

export function toWire(r: LspJobResult): WireResult {
  if (r.result === undefined) return { run: r.run, reused: r.reused };
  const s = r.result.semantic;
  const pairs = (m: ReadonlyMap<string, readonly number[]>) => [...m].map(([k, v]) => [k, [...v]] as [string, number[]]);
  const defs = r.result.definitions === undefined ? {} : { definitions: r.result.definitions };
  return { run: r.run, reused: r.reused, result: { semantic: { legend: s.legend, head: pairs(s.head), base: pairs(s.base) }, callGraph: r.result.callGraph, ...defs } };
}

export function fromWire(w: WireResult): LspJobResult {
  if (w.result === undefined) return { run: w.run, reused: w.reused };
  const s = w.result.semantic;
  // 定義の答えを持たない古い serve の答えなら欄ごと無し（名前から移れない解析になる）
  const defs = w.result.definitions === undefined ? {} : { definitions: w.result.definitions };
  return { run: w.run, reused: w.reused, result: { semantic: { legend: s.legend, head: new Map(s.head), base: new Map(s.base) }, callGraph: w.result.callGraph, ...defs } };
}

/** serve の側で、本文から LspJobArgs を組む */
export function toJobArgs(req: LspJobRequest, progress: (line: string) => void): LspJobArgs {
  const { tests, changed, ...rest } = req;
  return { ...rest, changed: changed ?? [...new Set([...req.hunks.map((h) => h.path), ...req.sides.head, ...req.sides.base])], isTestPath: testPathsFor(tests, tests.inferred).isTest, progress };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

/** 形だけ見る（送るのは同じ ondina の analyze。壊れた本文で言語サーバーを起こさない） */
export function isLspJobRequest(v: unknown): v is LspJobRequest {
  if (!isObj(v)) return false;
  const shas = v['shas'];
  const sides = v['sides'];
  const tests = v['tests'];
  const rule = v['rule'] as ImportNotificationRule | undefined;
  return (
    typeof v['language'] === 'string' &&
    typeof v['command'] === 'string' &&
    isStrings(v['args']) &&
    typeof v['readyTimeoutSec'] === 'number' &&
    isObj(rule) &&
    typeof v['root'] === 'string' &&
    typeof v['cacheDir'] === 'string' &&
    isObj(shas) && typeof shas['base'] === 'string' && typeof shas['head'] === 'string' &&
    isObj(sides) && isStrings(sides['head']) && isStrings(sides['base']) &&
    (v['changed'] === undefined || isStrings(v['changed'])) &&
    Array.isArray(v['targets']) &&
    Array.isArray(v['hunks']) &&
    isObj(tests) && Array.isArray(tests['layers']) && isStrings(tests['sourceRoots'])
  );
}

/** serve が起動時に書く。{ pid, port }。git worktree の中で起動しても元のフォルダの .ondina（どの worktree の analyze も見つける） */
export function serveFile(repo: string): string {
  return path.join(mainWorktree(repo), '.ondina', 'serve.json');
}

function readServeFile(repo: string): { pid?: unknown; port?: unknown } | undefined {
  try {
    return JSON.parse(readFileSync(serveFile(repo), 'utf8')) as { pid?: unknown; port?: unknown };
  } catch {
    return undefined;
  }
}

/**
 * 生きている別の serve が書いたものがあれば上書きしない。言語サーバーとそのロックはその serve が持つので、
 * 2 つ目の serve（別の worktree で PR のない変更を開いたとき）が奪うと、2 つ目は 1 つ目のロックを待ち続ける。
 * serve は起動したあとも間をおいて呼び、登録していた serve が終わっていれば引き継ぐ（serve.ts）
 */
export function writeServeFile(repo: string, port: number): void {
  const v = readServeFile(repo);
  if (v?.pid === process.pid && v.port === port) return;
  if (v !== undefined && typeof v.pid === 'number' && v.port !== port && alive(v.pid)) return;
  mkdirSync(path.dirname(serveFile(repo)), { recursive: true });
  writeFileSync(serveFile(repo), JSON.stringify({ pid: process.pid, port }));
}

/** 自分が書いたものだけ消す（後から起動した別の serve のものは残す） */
export function removeServeFile(repo: string, port: number): void {
  const v = readServeFile(repo);
  if (v?.pid === process.pid && v.port === port) rmSync(serveFile(repo), { force: true });
}

function sameDir(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/**
 * このリポジトリの serve が動いていれば、その URL（末尾の / なし）。同じリポジトリの別の worktree で起動した serve も使う
 * （言語サーバーの仕事は打ったフォルダに依らない。スキルの serve --background は別の worktree の serve を使い回す）。
 * pid が死んでいる・別のリポジトリ・答えなければ undefined
 */
export async function findServe(repo: string): Promise<string | undefined> {
  const info = readServeFile(repo);
  if (info === undefined || typeof info.pid !== 'number' || typeof info.port !== 'number' || !alive(info.pid)) return undefined;
  const url = `http://127.0.0.1:${info.port}`;
  try {
    const res = await fetch(`${url}/api/repo`, { signal: AbortSignal.timeout(2000) });
    const body = (await res.json()) as { repo?: unknown };
    return typeof body.repo === 'string' && sameDir(mainWorktree(body.repo), mainWorktree(repo)) ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * serve に言語サーバーの仕事を頼む。進みは届くたびに progress へ。
 * serve が古い（/api/lsp が無い）・途中で切れた場合は error を返す（analyze は自分で起動する）
 */
export async function requestServeLsp(url: string, req: LspJobRequest, progress: (line: string) => void): Promise<LspJobResult | { error: string }> {
  let res: Response;
  try {
    res = await fetch(`${url}/api/lsp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  } catch (e) {
    return { error: `serve に頼めませんでした: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok || res.body === null) return { error: `serve に頼めませんでした（${res.status}）` };
  const decoder = new TextDecoder();
  let buf = '';
  let done: WireResult | undefined;
  const take = (line: string): void => {
    if (line.trim() === '') return;
    const msg = JSON.parse(line) as WireLine;
    if ('progress' in msg) progress(msg.progress);
    else done = msg.done;
  };
  try {
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) take(l);
    }
    take(buf);
  } catch (e) {
    return { error: `serve からの応答が途中で切れました: ${e instanceof Error ? e.message : String(e)}` };
  }
  return done === undefined ? { error: 'serve から結果が届きませんでした' } : fromWire(done);
}
