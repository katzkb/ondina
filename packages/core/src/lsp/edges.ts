// 呼び出し辺の組み立て（設計書 9.2〜9.4）。LSP が返した生の答え（CallGraphSource）から Edge と Symbol を作る。
// プロセスも LSP クライアントも知らない純粋な処理。問い合わせるのは cli（packages/cli/src/lsp-queries.ts）。
//
// 2026-09-22 に kotlin-lsp 263.4702.0 で実測した形:
// - CallHierarchyItem の name は "Order.applyDiscount(DiscountCommand)"、detail はパッケージ。繋げば FQ 名になる
// - 引数の型は name の括弧の中にもあるが、引数名が無い。hover のシグネチャなら引数も戻り型も取れるので、辺ラベルは hover から取る
// - 戻り型が @JvmInline value class の関数は callHierarchy に一切出てこない（実測 6/6）。
//   「呼ばれていない」と「測れていない」は別物なので、答えが無かった変更シンボルには edgesMeasured: false を付ける（原則 2）
// - incomingCalls はテストからの呼び出しを返さない。テストの辺はテスト側の outgoingCalls から作る（kind: 'test' は cli が付ける）
import type { Edge, Hunk, Symbol as OndinaSymbol, SymbolKind } from '../model.js';
import { changedLines } from '../hunks/changed-lines.js';
import { hunkId } from '../hunks/stable-id.js';
import { createLayerAssigner, type LayerRule } from '../layers/assign.js';
import { cutExcerpt } from './excerpt.js';

/** LSP の CallHierarchyItem のうち使う欄だけ。uri は cli が repo 相対パスに直して渡す */
export interface CallItem {
  /** "Order.applyDiscount(DiscountCommand)" */
  name: string;
  /** パッケージ。"com.example.order.domain"。トップレベル宣言では空のことがある */
  detail?: string;
  /** LSP の SymbolKind（6 = Method、12 = Function、7 = Property、…） */
  kind: number;
  /** repo 相対 */
  path: string;
  /** 宣言の名前の行（selectionRange の開始。0 始まり）。欄が無い = 位置の無い記録（2026-09-26 より前） */
  line?: number;
}

export interface CallGraphSource {
  /** 変更 hunk ごとの問い合わせ結果。item が無い = 位置が取れなかったか prepareCallHierarchy が [] を返した */
  probes: Array<{ hunkId: string; item?: CallItem }>;
  /** lines: 呼んでいる位置（fromRanges の開始行。いつも from のファイル。0 始まり）。欄が無い = 位置の無い記録、空 = 言語サーバーが返さなかった（インターフェース → 実装） */
  calls: Array<{ from: CallItem; to: CallItem; kind: 'call' | 'test'; lines?: number[] }>;
  /** FQ 名 → hover のシグネチャ */
  signatures: Record<string, string>;
  /** 変更 hunk の id → そのシンボルを参照しているテスト関数の FQ 名（重複なし） */
  testRefs: Record<string, string[]>;
  /**
   * 変更 hunk の id → そのシンボルを参照している位置（宣言自身は含まない。テストも含む）。
   * 欄があって空 = 測って 0 件、欄が無い = 測っていない（原則 2）。2026-09-24 に足した（参照辺の材料）
   */
  refs: Record<string, Array<{ path: string; line: number }>>;
  /** 参照が出たファイルの宣言の範囲。参照の位置を囲っている宣言へ丸めるため。name は入れ子を . で繋いだもの（"Order.total"） */
  ranges: Record<string, DeclarationRange[]>;
}

export interface DeclarationRange {
  name: string;
  /** LSP の SymbolKind */
  kind: number;
  /** 0 始まりの行。両端を含む */
  start: number;
  end: number;
}

export interface CallGraphContext {
  hunks: readonly Hunk[];
  /** buildSymbols が組んだ変更シンボル */
  symbols: readonly OndinaSymbol[];
  layers: readonly LayerRule[];
  /** layers が設定の glob なら config（既定）、構成の推定から組んだ規則なら llm（10.6）。経路上の未変更シンボルに付ける */
  layerProvenance?: 'config' | 'llm';
  allowedDependencies: Record<string, readonly string[]>;
  /** head のファイル本文（repo 相対パス）。未変更シンボルの行を切り出すのに使う。無い・読めなければ excerpt を付けない */
  readHead?: (repoRelative: string) => string | undefined;
}

export interface CallGraphResult {
  edges: Edge[];
  /** 変更シンボル（testCount / edgesMeasured を足したもの）+ 経路上の未変更シンボル */
  symbols: OndinaSymbol[];
  /** callHierarchy が答えなかった変更シンボルの数 */
  unmeasured: number;
}

/** detail（パッケージ）と name の括弧より前を繋ぐ。detail が無ければ name だけ */
export function fqNameOf(item: CallItem): string {
  const name = item.name.slice(0, cut(item.name, '(')).trim();
  return item.detail === undefined || item.detail === '' ? name : `${item.detail}.${name}`;
}

/** LSP の SymbolKind を Symbol.kind に写す。知らない番号は function（推測を増やさない） */
export function symbolKindOf(lspKind: number): SymbolKind {
  const table: Readonly<Record<number, SymbolKind>> = { 5: 'class', 6: 'function', 7: 'property', 8: 'property', 9: 'constructor', 10: 'enumEntry', 12: 'function', 13: 'property', 14: 'property', 22: 'enumEntry', 23: 'class' };
  return table[lspKind] ?? 'function';
}

/**
 * hover のシグネチャから辺ラベルを取る（設計書 9.3）。
 * 取れなかった側は欄ごと無い（Unit の関数に out: '' を入れない。原則 2）。
 */
export function signatureTypes(signature: string): { in?: string; out?: string } {
  const line = signature.split('\n').find((l) => l.includes('(')) ?? '';
  const open = line.indexOf('(');
  if (open === -1) return {};
  const close = matching(line, open);
  if (close === -1) return {};
  const params = splitTop(line.slice(open + 1, close))
    .map(paramType)
    .filter((t): t is string => t !== undefined);
  const rest = line.slice(close + 1).trim();
  const out = rest.startsWith(':') ? rest.slice(1).trim() : '';
  return { ...(params.length === 0 ? {} : { in: params.join(', ') }), ...(out === '' ? {} : { out }) };
}

/** 両端に層があるときだけ判定する。片方でも無ければ false（層を知らないだけで赤い破線にしない。設計書 9.4） */
export function crossesLayers(from: OndinaSymbol, to: OndinaSymbol, allowed: Record<string, readonly string[]>): boolean {
  if (from.layer === undefined || to.layer === undefined) return false;
  if (from.layer === to.layer) return false;
  // 呼んでよい向きが 1 つも書かれていなければ判定しない（推定した層には決まりが無い。9.4）
  if (Object.keys(allowed).length === 0) return false;
  return !(allowed[from.layer] ?? []).includes(to.layer);
}

export function buildCallGraph(src: CallGraphSource, ctx: CallGraphContext): CallGraphResult {
  const layerOf = createLayerAssigner(ctx.layers);
  // 変更シンボルは「パス + FQ 名」で引く。関数がクラス丸ごとの hunk に入っていることがあるので接頭辞でも引く（5.2 の 1 の格上げ）。
  // FQ 名はバッククォートを外して比べる: ondina の hunk は `persists discount` と持つが、LSP のアイテムは外した名前で返す（2026-09-22 実測）
  const changed = new Map(ctx.symbols.filter((s) => s.changed).map((s) => [`${s.path}#${bare(s.fqName)}`, s]));
  const byPath = new Map<string, OndinaSymbol[]>();
  for (const s of ctx.symbols.filter((s) => s.changed)) byPath.set(s.path, [...(byPath.get(s.path) ?? []), s]);

  /** 変更シンボルに当たればそれ。同じファイルの変更シンボルのうち、FQ 名の接頭辞になっているもののいちばん長いものへ丸める */
  const changedOf = (item: CallItem): OndinaSymbol | undefined => {
    const fqName = bare(fqNameOf(item));
    return (
      changed.get(`${item.path}#${fqName}`) ??
      (byPath.get(item.path) ?? []).filter((s) => fqName.startsWith(`${bare(s.fqName)}.`)).sort((a, b) => b.fqName.length - a.fqName.length)[0]
    );
  };

  const added = new Map<string, OndinaSymbol>();
  const resolve = (item: CallItem): OndinaSymbol => {
    const hit = changedOf(item);
    if (hit !== undefined) return hit;
    const fqName = fqNameOf(item);
    const id = hunkId(item.path, fqName);
    const existing = added.get(id);
    if (existing !== undefined) return existing;
    const layer = layerOf(item.path);
    const symbol: OndinaSymbol = {
      id,
      fqName,
      path: item.path,
      ...(layer === undefined ? {} : { layer, layerProvenance: ctx.layerProvenance ?? 'config' }),
      kind: symbolKindOf(item.kind),
      changed: false,
      edgesMeasured: true,
    };
    added.set(id, symbol);
    return symbol;
  };

  // 変更シンボルから差分の無い相手への呼び出しは、呼んでいる位置のどれかが足した行（head の + の行）に当たるものだけ使う（2026-10-12）。
  // 変わらない行からの呼び出しや、クラス丸ごとの hunk で同じクラスのほかのメソッドからの呼び出しは、差分と関係しない。
  // 位置が無い（位置の無い記録）・空（言語サーバーが返さなかった）・hunk が引けないときは残す（測れていないものを隠さない。原則 2）。
  // 位置は呼び出しの名前の行なので、名前の行が変わらず次の行の引数だけ変えた呼び出しは落ちる（9.6 の既知の穴）
  const addedLines = new Map(ctx.hunks.map((h) => [h.id, new Set(changedLines(h).newLines)]));
  const fromDiff = (call: CallGraphSource['calls'][number]): boolean => {
    const from = changedOf(call.from);
    if (from === undefined || changedOf(call.to) !== undefined) return true;
    const lines = from.hunkId === undefined ? undefined : addedLines.get(from.hunkId);
    if (lines === undefined || call.lines === undefined || call.lines.length === 0) return true;
    return call.lines.some((l) => lines.has(l + 1));
  };
  const calls = src.calls.filter(fromDiff);

  const edges = new Map<string, Edge>();
  // 同じ両端の記録（インターフェースと実装など）の呼んでいる行は合わせる。位置は 0 始まりで来る
  const callLines = new Map<string, Set<number>>();
  for (const call of calls) {
    const from = resolve(call.from);
    const to = resolve(call.to);
    if (from.id === to.id) continue; // 丸めた結果の自己ループは描かない
    const types = signatureTypes(src.signatures[fqNameOf(call.to)] ?? '');
    const key = `${from.id}\u0000${to.id}\u0000${call.kind}`;
    for (const l of call.lines ?? []) callLines.set(key, (callLines.get(key) ?? new Set()).add(l + 1));
    if (edges.has(key)) continue;
    edges.set(key, {
      from: from.id,
      to: to.id,
      kind: call.kind,
      ...(types.in === undefined && types.out === undefined ? {} : { types }),
      crossesLayers: crossesLayers(from, to, ctx.allowedDependencies),
      provenance: 'lsp',
    });
  }
  for (const [key, lines] of callLines) edges.get(key)!.lines = [...lines].sort((a, b) => a - b);

  // 参照辺（references。設計書 9.2）。参照の位置を囲っている宣言を内側から外へ辿り、最初に当たった変更シンボルから引く。
  // 両端が変更シンボルのものだけ（未変更シンボルは作らない。外すと fixture で 178 本に膨らむ。2026-09-23 実測）
  const changedByHunk = new Map(ctx.symbols.filter((s) => s.changed && s.hunkId !== undefined).map((s) => [s.hunkId!, s]));
  const enclosingChanged = (path: string, line: number): OndinaSymbol | undefined => {
    const inside = (src.ranges[path] ?? [])
      .filter((r) => line >= r.start && line <= r.end)
      .sort((a, b) => b.start - a.start || a.end - b.end);
    for (const r of inside) {
      const hit = (byPath.get(path) ?? []).find((s) => bare(s.fqName) === r.name || bare(s.fqName).endsWith(`.${r.name}`));
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  for (const [refHunkId, locations] of Object.entries(src.refs ?? {})) {
    const to = changedByHunk.get(refHunkId);
    if (to === undefined) continue;
    for (const loc of locations) {
      const from = enclosingChanged(loc.path, loc.line);
      if (from === undefined || from.id === to.id) continue;
      const key = `${from.id}\u0000${to.id}\u0000reference`;
      const existing = edges.get(key);
      if (existing !== undefined) {
        existing.n = (existing.n ?? 0) + 1;
        continue;
      }
      edges.set(key, { from: from.id, to: to.id, kind: 'reference', n: 1, crossesLayers: crossesLayers(from, to, ctx.allowedDependencies), provenance: 'lsp' });
    }
  }

  // 未変更シンボルの行（設計書 3.3）。中心 = 宣言の行 + その中で変更シンボルを呼んでいる行。
  // 呼ばれる側の辺の lines は相手（呼ぶ側）のファイルの位置なので使わない（その行は相手の差分に出ている）
  const centers = new Map<string, Set<number>>();
  const addCenter = (s: OndinaSymbol, line: number | undefined): void => {
    if (s.changed || line === undefined) return;
    centers.set(s.id, (centers.get(s.id) ?? new Set()).add(line));
  };
  for (const call of calls) {
    const from = resolve(call.from);
    const to = resolve(call.to);
    addCenter(from, call.from.line);
    addCenter(to, call.to.line);
    if (to.changed) for (const line of call.lines ?? []) addCenter(from, line);
  }
  for (const s of added.values()) {
    const lines = centers.get(s.id);
    const text = lines === undefined ? undefined : ctx.readHead?.(s.path);
    if (lines === undefined || text === undefined) continue;
    const excerpt = cutExcerpt(text, [...lines]);
    if (excerpt.length > 0) s.excerpt = excerpt;
  }

  const probed = new Map(src.probes.map((p) => [p.hunkId, p.item !== undefined]));
  const symbols = ctx.symbols.map((s) => {
    const measured = s.hunkId === undefined ? undefined : probed.get(s.hunkId);
    const refs = s.hunkId === undefined ? undefined : src.testRefs[s.hunkId];
    return {
      ...s,
      ...(refs === undefined ? {} : { testCount: refs.length }),
      ...(measured === undefined ? {} : { edgesMeasured: measured }),
    };
  });

  return {
    edges: [...edges.values()].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.kind, b.kind)),
    symbols: [...symbols, ...[...added.values()].sort((a, b) => cmp(a.id, b.id))],
    unmeasured: src.probes.filter((p) => p.item === undefined).length,
  };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * バッククォート名（`persists discount`）の引用符を外す。突き合わせのときだけ使う。
 * オーバーロードの `#2` 接尾辞は**外さない**: CallHierarchyItem に `#2` は付かないので外せば当たるが、
 * 何番目の多重定義かは分からないため、対応づけが推測になる（原則 2）。変更されたオーバーロードは
 * 未変更シンボルとして別に立つ（設計書 9.6 の「オーバーロードの既知の穴」。直すには 5.2 の TODO が先）。
 */
const bare = (fqName: string): string => fqName.replaceAll('`', '');

/** ch の位置。無ければ文字列長（slice でそのまま全部になる） */
function cut(s: string, ch: string): number {
  const i = s.indexOf(ch);
  return i === -1 ? s.length : i;
}

/** open の位置の括弧に対応する閉じ括弧。入れ子を数える。見つからなければ -1 */
function matching(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/** 深さ 0 の , で割る（ジェネリクスやラムダの中の , で割らない） */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(' || c === '<' || c === '[') depth++;
    if (c === ')' || c === '>' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  const last = s.slice(start);
  if (last.trim() !== '') out.push(last);
  return out.filter((p) => p.trim() !== '');
}

/** "@PathVariable id: String = \"x\"" → "String"。型が書いていなければ undefined */
function paramType(param: string): string | undefined {
  const colon = param.indexOf(':');
  if (colon === -1) return undefined;
  const after = param.slice(colon + 1);
  const eq = topLevelEquals(after);
  const type = (eq === -1 ? after : after.slice(0, eq)).trim();
  return type === '' ? undefined : type;
}

/** 深さ 0 の = の位置（既定値の手前）。無ければ -1。`->` と `==` は数えない */
function topLevelEquals(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '(' || c === '<' || c === '[') depth++;
    if (c === ')' || c === '>' || c === ']') depth--;
    if (c === '=' && depth === 0 && s[i - 1] !== '-' && s[i - 1] !== '=' && s[i + 1] !== '=') return i;
  }
  return -1;
}
