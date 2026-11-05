// 基準リクエストの対象選び（設計書 9.1 の 3 段目）と、documentSymbol の走査。
//
// 「準備完了」の最後の確かめは、既知の変更シンボルに callHierarchy を打って辺が取れるかで決める。
// 対象は同じ headSha で同じものになるように決定的に選ぶ（原則 7）。
//
// 選び方（2026-09-21 の実機確認で決めた）: 核 → テスト → 未帰属 → 追従 の順に優先する。
// 追従グループのメンバーは「1 行をなぞっただけ」のことが多く、fixture では上位 3 件がどれも `return order.discount` で、
// 呼び出し辺が 0 本だった。LSP が健康でも 0 本になるので、準備完了の判定に使えない。
// 核 hunk は追従の導出元なので呼び出し関係を必ず持ち、テスト hunk は対象を呼ぶので出る辺を必ず持つ。
//
// documentSymbol の形は 2026-09-21 に実測した: 階層形で、name は識別子だけ（"applyDiscount"）、detail は返ってこない。
// 関数は kind 6（Method）か 12（Function）で、クラスと同名のコンストラクタが kind 9 で混ざる。
// selectionRange.start がそのまま prepareCallHierarchy に渡せる位置。
// 核 hunk はクラス全体になることがある（5.2 の 1 の格上げ）ので、当たった宣言が呼べなければ中の関数に降りる。
import type { Hunk, Kind } from '../model.js';

export interface ProbeTarget {
  /** repo 相対 */
  path: string;
  /** documentSymbol の name と突き合わせる識別子。クラス名のこともある */
  name: string;
  hunkId: string;
}

/** 3 件まで試す。1 件目がたまたま呼び出しの無い宣言でも取りこぼさない程度 */
export const PROBE_TARGET_LIMIT = 3;

/** LSP の SymbolKind のうち呼べるもの。6 = Method、12 = Function */
export const CALLABLE_SYMBOL_KINDS: readonly number[] = [6, 12];

/** 呼び出し関係を持ちやすい順。数が小さいほど先に試す */
const KIND_ORDER: Record<Kind, number> = { core: 0, test: 1, none: 2, ripple: 3 };

/** 変更 hunk から基準シンボルを選ぶ。ファイル hunk は宣言ではないので除く */
export function chooseProbeTargets(hunks: readonly Hunk[], limit: number = PROBE_TARGET_LIMIT): ProbeTarget[] {
  return hunks
    .filter((h) => h.symbolKind !== 'file')
    .slice()
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit)
    .map((h) => ({ path: h.path, name: symbolName(h.symbolFqName), hunkId: h.id }));
}

/**
 * com.example.order.domain.Order.applyDiscount → applyDiscount。オーバーロードの #2 接尾辞は落とす（5.2 の 1）。
 * バッククォート名のテスト関数（`persists discount`）はバッククォートを外す:
 * documentSymbol が外した形（"persists discount"）で返すので、そうしないと突き合わせが 1 件も当たらない（2026-09-22 実測）。
 * 名前の中に . が入っていても壊れないように、閉じるバッククォートから開きを探す。
 */
export function symbolName(fqName: string): string {
  const base = fqName.replace(/#\d+$/, '');
  if (base.endsWith('`')) {
    const open = base.lastIndexOf('`', base.length - 2);
    if (open !== -1) return base.slice(open + 1, -1);
  }
  return base.slice(base.lastIndexOf('.') + 1);
}

/** LSP の DocumentSymbol のうち、ここで使う欄だけ */
export interface DocumentSymbol {
  name: string;
  kind: number;
  selectionRange: { start: { line: number; character: number } };
  children?: DocumentSymbol[];
}

export interface Position {
  line: number;
  character: number;
}

/**
 * name の宣言を探し、callHierarchy を打てる位置を返す。
 * 当たった宣言が呼べる種別ならその宣言名の位置、そうでなければ（クラスなど）中の最初の関数の位置（準備完了の確かめに使う）。
 * 見つからなければ undefined。
 */
/**
 * 参照検索（textDocument/references）の基準。宣言そのものの位置を返す。
 * findProbePosition と違ってクラスでも中の関数に降りない（クラスへの参照を数えたい）し、プロパティでも位置を返す。
 */
export function findDeclarationPosition(symbols: readonly DocumentSymbol[], name: string): Position | undefined {
  return findByName(symbols, name)?.selectionRange.start;
}

export function findProbePosition(symbols: readonly DocumentSymbol[], name: string): Position | undefined {
  return findCallablePositions(symbols, name)[0];
}

/**
 * name の宣言の中の呼べる宣言の位置を全部（深さ優先の順）。宣言そのものが呼べればそれ 1 つ。
 * クラス丸ごとの hunk で最初の関数だけ聞くと、2 つ目以降の関数からの呼び出しが線にならない（2026-11-05。新しいクラスが差分の無い相手を呼ぶ形）
 */
export function findCallablePositions(symbols: readonly DocumentSymbol[], name: string): Position[] {
  const found = findByName(symbols, name);
  if (found === undefined) return [];
  if (CALLABLE_SYMBOL_KINDS.includes(found.kind)) return [found.selectionRange.start];
  return callables(found.children ?? []);
}

/**
 * name の宣言を幅優先で探す。同じ名前が入れ子の内側にもあるとき（入れ子クラスの同名メソッドなど）は浅いほうを選ぶ。
 * 基準シンボルは hunk の宣言そのものなので、外側にあるほうが当たりである可能性が高い。
 */
function findByName(symbols: readonly DocumentSymbol[], name: string): DocumentSymbol | undefined {
  let level: readonly DocumentSymbol[] = symbols;
  while (level.length > 0) {
    const hit = level.find((s) => s.name === name);
    if (hit !== undefined) return hit;
    level = level.flatMap((s) => s.children ?? []);
  }
  return undefined;
}

/** 木を深さ優先で見て、呼べる宣言の位置を全部。コンストラクタ（kind 9）は呼べる種別に入れていない */
function callables(symbols: readonly DocumentSymbol[]): Position[] {
  return symbols.flatMap((s) => (CALLABLE_SYMBOL_KINDS.includes(s.kind) ? [s.selectionRange.start] : callables(s.children ?? [])));
}
