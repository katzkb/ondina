// fixtures/order-service の base/ と head/ を読むテスト用ヘルパ。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SemanticSource } from '../src/highlight/attach.js';
import type { DefinitionSource } from '../src/lsp/definitions.js';
import type { CallGraphSource } from '../src/lsp/edges.js';
import type { ChangedFile } from '../src/hunks/extract.js';

export const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/order-service');

function readOrNull(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** repo 相対パスの base / head を読む */
export function fixtureFile(relPath: string): ChangedFile {
  return {
    path: relPath,
    before: readOrNull(path.join(FIXTURE_ROOT, 'base', relPath)),
    after: readOrNull(path.join(FIXTURE_ROOT, 'head', relPath)),
  };
}

function walk(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    return statSync(full).isDirectory() ? walk(full, rel) : [rel];
  });
}

/** base と head で内容が異なるファイル（追加・削除を含む）をパス順に返す */
export function changedFixtureFiles(): ChangedFile[] {
  const paths = new Set([...walk(path.join(FIXTURE_ROOT, 'base')), ...walk(path.join(FIXTURE_ROOT, 'head'))]);
  return [...paths]
    .sort()
    .map(fixtureFile)
    .filter((f) => f.before !== f.after);
}

/**
 * 2026-09-22 に kotlin-lsp 263.4702.0 を fixture の base / head 両方の worktree に向けて実際に起こし、
 * semanticTokens/full の生の data を記録したもの（設計書 7.2 / 9.1）。実機なしで重ね合わせを回すため。
 */
export function readFixtureSemanticTokens(): SemanticSource {
  const raw = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'lsp/semantic-tokens.json'), 'utf8')) as {
    legend: SemanticSource['legend'];
    head: Record<string, number[]>;
    base: Record<string, number[]>;
  };
  return { legend: raw.legend, head: new Map(Object.entries(raw.head)), base: new Map(Object.entries(raw.base)) };
}

/**
 * 2026-09-22 に kotlin-lsp 263.4702.0 を fixture の base / head の worktree に向けて実際に起こし、
 * 呼び出し関係・シグネチャ・テストからの参照を記録したもの（設計書 9 章）。実機なしで辺の組み立てを回すため。
 * 採り直しは ONDINA_LSP_RECORD=<このファイル> を付けて analyze --lsp を打つ。
 * 2026-09-26 に同じ版で採り直し、宣言の行（CallItem.line）と呼んでいる位置（calls[].lines）を足した（それ以外は refs の並びだけが違った）。
 */
export function readFixtureCallGraph(): CallGraphSource {
  return JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'lsp/call-edges.json'), 'utf8')) as CallGraphSource;
}

/**
 * 2026-11-05 に kotlin-lsp 263.7084.0 を fixture の base の worktree に向けて起こし、呼び出し関係を記録したもの（流れの地図の ① の材料）。
 * 参照・テストの参照・宣言の範囲は使わないので記録しない。採り直しは ONDINA_LSP_RECORD_BASE=<このファイル> を付けて analyze --lsp を打つ
 */
export function readFixtureCallGraphBase(): CallGraphSource {
  return JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'lsp/call-edges-base.json'), 'utf8')) as CallGraphSource;
}

/**
 * 2026-10-29 に kotlin-lsp 263.6379.0 を fixture の base / head の worktree に向けて実際に起こし、差分の行の名前と、
 * その行き先のうち差分の列に無いファイル全体の名前に textDocument/definition を聞いた答え（設計書 3.6 / 9.2）。
 * 採り直しは ONDINA_LSP_RECORD_DEFS=<このファイル> を付けて analyze --lsp を打つ
 */
export function readFixtureDefinitions(): DefinitionSource {
  return JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'lsp/definitions.json'), 'utf8')) as DefinitionSource;
}

/** head 側のファイル本文（analyze が head の worktree から読むのと同じ）。無ければ undefined */
export function readFixtureHead(repoRelative: string): string | undefined {
  try {
    return readFileSync(path.join(FIXTURE_ROOT, 'head', repoRelative), 'utf8');
  } catch {
    return undefined;
  }
}

/** base の本文（repo 相対パス）。無ければ undefined */
export function readFixtureBase(repoRelative: string): string | undefined {
  try {
    return readFileSync(path.join(FIXTURE_ROOT, 'base', repoRelative), 'utf8');
  } catch {
    return undefined;
  }
}
