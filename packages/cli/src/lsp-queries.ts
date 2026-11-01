// 準備完了した LSP に投げる問い合わせ（設計書 9.2）。runLsp の work コールバックの中身。
// core が決めた規則（edges.ts / targets.ts）を実際のサーバに当てるだけで、判断はしない。
//
// 2026-09-22 の実測で分かった注意点:
// - documentSymbol はバッククォートを外した名前を返す（`persists discount` → persists discount）。
//   突き合わせは core の symbolName が外す
// - prepareCallHierarchy は [] を返すことがある（戻り型が value class の関数）。呼ばれていないのではなく測れていないので、
//   probes には item 無しで残す（黙って消さない。原則 2）
// - incomingCalls はテストからの呼び出しを返さない。テストの辺はテスト側の outgoingCalls から作る
import { statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defTargetOf, diffLines, filesToAsk, findDeclarationPosition, findProbePosition, fqNameOf, namePositions, symbolName, type CallGraphSource, type DefinitionSource, type DefSide, type NamePosition, type RawDefTarget, type CallItem, type DeclarationRange, type DocumentSymbol, type LspClient, type Position, type SemanticLegend, type SemanticSource } from '@ondina/core';
import type { Hunk } from '@ondina/model';
import { realpathOr } from './lsp-model.js';

/** 変更ファイルの意味トークンを両側とも取る（設計書 7.2 / 9.1） */
export async function collectSemanticTokens(
  client: LspClient,
  legend: SemanticLegend,
  sides: { head: readonly string[]; base: readonly string[] },
  worktrees: { head: string; base: string },
): Promise<SemanticSource> {
  const out: SemanticSource = { legend, head: new Map(), base: new Map() };
  for (const side of ['head', 'base'] as const) {
    for (const rel of sides[side]) {
      const uri = pathToFileURL(path.join(worktrees[side], rel)).href;
      const res = await client.request<{ data: number[] } | null>('textDocument/semanticTokens/full', { textDocument: { uri } });
      if (res !== null && res.data.length > 0) (out[side] as Map<string, readonly number[]>).set(rel, res.data);
    }
  }
  return out;
}

/** LSP が返す CallHierarchyItem のうち使う欄 */
interface RawItem {
  name: string;
  detail?: string;
  kind: number;
  uri: string;
  selectionRange?: { start: Position };
}

/** documentSymbol の range（core の DocumentSymbol は selectionRange しか見ていないので、ここで足す） */
interface RangedSymbol extends DocumentSymbol {
  range?: { start: Position; end: Position };
  children?: RangedSymbol[];
}

export interface CollectCallGraphArgs {
  hunks: readonly Hunk[];
  /** head の worktree。uri を repo 相対に直すのに使う */
  root: string;
  /** そのパスがテストか（設定の layers の Tests に当たるか） */
  isTestPath: (repoRelative: string) => boolean;
}

/**
 * 変更シンボルの呼び出し関係・シグネチャ・テストからの参照を集める（設計書 9.2〜9.4）。
 * 広げるのは 1 ホップまで（変更シンボルから 1 つ隣まで。2026-09-22 に決めた）。
 */
export async function collectCallGraph(client: LspClient, args: CollectCallGraphArgs): Promise<CallGraphSource> {
  const targets = args.hunks.filter((h) => h.symbolKind !== 'file' && h.path.endsWith('.kt'));
  const docs = new Map<string, RangedSymbol[]>();
  const uriOf = (repoRelative: string): string => pathToFileURL(path.join(args.root, repoRelative)).href;
  const rel = (uri: string): string => path.relative(args.root, fileURLToPath(uri));
  const documentSymbols = async (repoRelative: string): Promise<RangedSymbol[]> => {
    const cached = docs.get(repoRelative);
    if (cached !== undefined) return cached;
    const res = (await client.request<RangedSymbol[] | null>('textDocument/documentSymbol', { textDocument: { uri: uriOf(repoRelative) } })) ?? [];
    docs.set(repoRelative, res);
    return res;
  };

  const src: CallGraphSource = { probes: [], calls: [], signatures: {}, testRefs: {}, refs: {}, ranges: {} };
  /** FQ 名 → hover を打つ場所。同じ宣言に 2 回打たない */
  const hoverAt = new Map<string, { uri: string; position: Position }>();
  const seen = (raw: RawItem): CallItem => {
    const start = raw.selectionRange?.start;
    const item: CallItem = { name: raw.name, ...(raw.detail === undefined ? {} : { detail: raw.detail }), kind: raw.kind, path: rel(raw.uri), ...(start === undefined ? {} : { line: start.line }) };
    if (start !== undefined && !hoverAt.has(fqNameOf(item))) hoverAt.set(fqNameOf(item), { uri: raw.uri, position: start });
    return item;
  };

  for (const hunk of targets) {
    const uri = uriOf(hunk.path);
    const symbols = await documentSymbols(hunk.path);
    const name = symbolName(hunk.symbolFqName);

    // 参照（プロパティ・クラスにも打つ。呼び出し関係が測れないシンボルでも参照は取れる。2026-09-23 実測）。
    // 位置は宣言そのもの。テストからの参照は囲っているテスト関数に丸めて数える（同じテストから 2 回参照しても 1 件）
    const declaration = findDeclarationPosition(symbols, name);
    if (declaration !== undefined) {
      const refs = (await client.request<Array<{ uri: string; range: { start: Position } }> | null>('textDocument/references', { textDocument: { uri }, position: declaration, context: { includeDeclaration: false } })) ?? [];
      const locations: Array<{ path: string; line: number }> = [];
      const tests = new Set<string>();
      for (const ref of refs) {
        const refPath = rel(ref.uri);
        const line = ref.range.start.line;
        locations.push({ path: refPath, line });
        const refSymbols = await documentSymbols(refPath);
        if (!(refPath in src.ranges)) src.ranges[refPath] = flattenRanges(refSymbols);
        if (!args.isTestPath(refPath)) continue;
        const fn = enclosingFunction(refSymbols, line);
        if (fn !== undefined) tests.add(`${refPath}#${fn}`);
      }
      src.refs[hunk.id] = locations;
      src.testRefs[hunk.id] = [...tests].sort();
    }

    const position = findProbePosition(symbols, name);
    if (position === undefined) {
      src.probes.push({ hunkId: hunk.id });
      continue;
    }
    const items = (await client.request<RawItem[] | null>('textDocument/prepareCallHierarchy', { textDocument: { uri }, position })) ?? [];
    const raw = items[0];
    if (raw === undefined) {
      src.probes.push({ hunkId: hunk.id });
      continue;
    }
    const item = seen({ ...raw, selectionRange: raw.selectionRange ?? { start: position } });
    src.probes.push({ hunkId: hunk.id, item });

    // fromRanges はどちら向きでも呼ぶ側（from）のファイルの位置（未変更シンボルの行の切り出しに使う。設計書 3.3）
    const outgoing = (await client.request<Array<{ to: RawItem; fromRanges?: Array<{ start: Position }> }> | null>('callHierarchy/outgoingCalls', { item: raw })) ?? [];
    for (const call of outgoing) src.calls.push({ from: item, to: seen(call.to), kind: args.isTestPath(item.path) ? 'test' : 'call', lines: linesOf(call.fromRanges) });
    const incoming = (await client.request<Array<{ from: RawItem; fromRanges?: Array<{ start: Position }> }> | null>('callHierarchy/incomingCalls', { item: raw })) ?? [];
    for (const call of incoming) {
      const from = seen(call.from);
      src.calls.push({ from, to: item, kind: args.isTestPath(from.path) ? 'test' : 'call', lines: linesOf(call.fromRanges) });
    }
  }

  // 辺に出た宣言のシグネチャ（辺ラベル）。取れなければ欄ごと入れない
  for (const [fqName, where] of hoverAt) {
    const hover = await client.request<{ contents?: { value?: string } | string } | null>('textDocument/hover', { textDocument: { uri: where.uri }, position: where.position });
    const value = typeof hover?.contents === 'string' ? hover.contents : (hover?.contents?.value ?? '');
    const signature = fencedCode(value);
    if (signature !== undefined) src.signatures[fqName] = signature;
  }

  const record = process.env['ONDINA_LSP_RECORD'];
  if (record !== undefined && record !== '') writeFileSync(record, JSON.stringify(src, null, 2) + '\n');
  return src;
}

/** markdown の ```kotlin … ``` の中身。KDoc が前に付いていても中身だけ取れる */
/** fromRanges の開始行（0 始まり。重複なし・昇順） */
function linesOf(ranges: ReadonlyArray<{ start: Position }> | undefined): number[] {
  return [...new Set((ranges ?? []).map((r) => r.start.line))].sort((a, b) => a - b);
}

function fencedCode(markdown: string): string | undefined {
  if (markdown.trim() === '') return undefined;
  const fence = /`{3,}\s*kotlin\s*\n([\s\S]*?)`{3,}/.exec(markdown);
  const body = (fence?.[1] ?? markdown).trim();
  return body === '' ? undefined : body;
}

/** documentSymbol の木を、入れ子を . で繋いだ名前と行の範囲の平らな列にする（親が先）。range が無い宣言は飛ばす */
function flattenRanges(symbols: readonly RangedSymbol[], prefix = ''): DeclarationRange[] {
  const out: DeclarationRange[] = [];
  for (const s of symbols) {
    const name = prefix === '' ? s.name : `${prefix}.${s.name}`;
    if (s.range !== undefined) out.push({ name, kind: s.kind, start: s.range.start.line, end: s.range.end.line });
    out.push(...flattenRanges(s.children ?? [], name));
  }
  return out;
}

/** その行を含むいちばん内側の関数の名前。documentSymbol の range で探す */
function enclosingFunction(symbols: readonly RangedSymbol[], line: number): string | undefined {
  let found: string | undefined;
  const walk = (list: readonly RangedSymbol[]): void => {
    for (const s of list) {
      if (s.range === undefined || line < s.range.start.line || line > s.range.end.line) continue;
      if (s.kind === 6 || s.kind === 12) found = s.name;
      walk(s.children ?? []);
    }
  };
  walk(symbols);
  return found;
}

/** 同時に投げる definition の数。実測では 795 本を一度に投げても 0.6 秒だった（2026-10-29）。サーバーを詰まらせない程度に区切る */
const DEFINITION_BATCH = 64;

/** 全体を聞くために開いたファイルの意味トークンを、同時に聞く数（definition より重いので少なめ） */
const WHOLE_BATCH = 16;

export interface CollectDefinitionsArgs {
  legend: SemanticLegend;
  /** 名前を探す意味トークン（変わったファイル。collectSemanticTokens の答え）。開いて全体を聞いた差分の無いファイルの分をここに足す */
  semantic: SemanticSource;
  hunks: readonly Hunk[];
  /** PR で変わったファイル（base の行き先を head の同じ場所にしてよいかを決める） */
  changed: ReadonlySet<string>;
  worktrees: { head: string; base: string };
  /** 差分の無いシンボルのファイル（head。呼び出し関係の相手。コースの停留所と覗く箱に全文が出る。unchangedFiles） */
  unchanged: readonly string[];
  /** didOpen（全体を聞くファイルを開く） */
  open: (abs: string) => void;
}

/**
 * 呼び出し関係に出た、PR で変わっていないファイル（repo 相対。リポジトリの外は除く）。path の順。
 * 呼び出し関係は head でだけ聞く（collectCallGraph の root は head）ので、どれも head のパス。head に無いファイルは開けずに飛ばす（openAll）
 */
export function unchangedFiles(graph: CallGraphSource, changed: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const c of graph.calls) for (const p of [c.from.path, c.to.path]) if (!changed.has(p) && !p.startsWith('..') && !path.isAbsolute(p)) out.add(p);
  return [...out].sort();
}

/**
 * 名前から定義へ（設計書 3.6 / 9.2）。画面に出る行の名前と、その行き先のうち差分の列に無いファイル全体の名前に definition を聞く。
 * 1 つの問い合わせが失敗しても全体は止めず、その名前を答え無しにする（意味トークンと辺を道連れにしない）
 */
export async function collectDefinitions(client: LspClient, args: CollectDefinitionsArgs): Promise<DefinitionSource> {
  const roots = { head: rootUrls(args.worktrees.head), base: rootUrls(args.worktrees.base) };
  const src: DefinitionSource = { files: [], answers: [] };
  const ask = async (jobs: ReadonlyArray<{ side: DefSide; path: string; at: NamePosition }>): Promise<void> => {
    for (let i = 0; i < jobs.length; i += DEFINITION_BATCH) {
      const batch = jobs.slice(i, i + DEFINITION_BATCH);
      const res = await Promise.all(
        batch.map((j) =>
          client
            .request<unknown>('textDocument/definition', { textDocument: { uri: pathToFileURL(path.join(args.worktrees[j.side], j.path)).href }, position: { line: j.at.line, character: j.at.col } })
            .catch(() => null),
        ),
      );
      batch.forEach((j, k) => src.answers.push({ side: j.side, path: j.path, line: j.at.line + 1, col: j.at.col, len: j.at.len, to: fileTarget(defTargetOf(res[k], roots), args.worktrees) }));
    }
  };

  const lines = diffLines(args.hunks);
  /**
   * 開いていないファイルを開いて意味トークンを聞き、args.semantic に足す（名前の位置と、全文の色。引き出し・コースの停留所）。
   * WHOLE_BATCH 本ずつ同時に聞く。開けない・答えの無いファイルは足さない。足す順は files の順（記録の並びを毎回同じにする）
   */
  const openAll = async (files: ReadonlyArray<{ side: DefSide; path: string }>): Promise<void> => {
    for (let i = 0; i < files.length; i += WHOLE_BATCH) {
      const batch = files.slice(i, i + WHOLE_BATCH).filter((f) => {
        try {
          args.open(path.join(args.worktrees[f.side], f.path));
          return true;
        } catch {
          return false;
        }
      });
      const res = await Promise.all(
        batch.map((f) => client.request<{ data: number[] } | null>('textDocument/semanticTokens/full', { textDocument: { uri: pathToFileURL(path.join(args.worktrees[f.side], f.path)).href } }).catch(() => null)),
      );
      batch.forEach((f, k) => {
        const data = res[k]?.data;
        if (data !== undefined) (args.semantic[f.side] as Map<string, readonly number[]>).set(f.path, data);
      });
    }
  };

  // 1 段目: 画面に出る行の名前。head は全文（コースと目的ごとの画面は変わっていない行も出す。差分の無いシンボルのファイルも）、
  // base は差分の行（画面に出る base の行は、消した行と差分の中の変わらない行だけ）
  await openAll(args.unchanged.filter((rel) => !args.semantic.head.has(rel)).map((rel) => ({ side: 'head' as const, path: rel })));
  const first: Array<{ side: DefSide; path: string; at: NamePosition }> = [];
  for (const [rel, data] of args.semantic.head) {
    src.files.push({ side: 'head', path: rel });
    for (const at of namePositions(data, args.legend)) first.push({ side: 'head', path: rel, at });
  }
  for (const [rel, data] of args.semantic.base) {
    const want = lines.base.get(rel);
    if (want === undefined) continue;
    src.files.push({ side: 'base', path: rel, part: true });
    for (const at of namePositions(data, args.legend, (l) => want.has(l + 1))) first.push({ side: 'base', path: rel, at });
  }
  await ask(first);

  // 2 段目: 行き先のうち差分の列に無いファイル全体。全体を聞いていないのは、差分の無いファイル（まだ開いていない）と base の変わったファイル。
  // base の変わったファイルは、1 段目で聞いた差分の行を聞き直さない
  const toAsk = filesToAsk(src, args.hunks, args.changed);
  await openAll(toAsk.filter((f) => !args.semantic[f.side].has(f.path)));
  const second: Array<{ side: DefSide; path: string; at: NamePosition }> = [];
  for (const f of toAsk) {
    const data = args.semantic[f.side].get(f.path);
    if (data === undefined) continue;
    src.files.push({ side: f.side, path: f.path });
    const done = lines[f.side].get(f.path);
    for (const at of namePositions(data, args.legend, (l) => done?.has(l + 1) !== true)) second.push({ side: f.side, path: f.path, at });
  }
  await ask(second);

  const record = process.env['ONDINA_LSP_RECORD_DEFS'];
  if (record !== undefined && record !== '') writeFileSync(record, JSON.stringify(src, null, 2) + '\n');
  return src;
}

/** パッケージの名前はフォルダを指す（2026-10-29 実測。package / import の名前）。開けるファイルでない行き先は答え無しにする */
function fileTarget(to: RawDefTarget | null, worktrees: { head: string; base: string }): RawDefTarget | null {
  if (to === null || 'lib' in to) return to;
  try {
    return statSync(path.join(worktrees[to.side], to.path)).isFile() ? to : null;
  } catch {
    return null;
  }
}

/** worktree の file URL。言語サーバーが実体のパス（/tmp → /private/tmp など）で答えることがあるので、両方 */
function rootUrls(dir: string): string[] {
  const urls = [dir, realpathOr(dir)].map((d) => pathToFileURL(d).href.replace(/\/$/, ''));
  return [...new Set(urls)];
}
