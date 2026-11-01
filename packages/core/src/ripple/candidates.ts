// 元になった変更の候補（設計書 8 章 1）。
// 宣言の追加・削除・シグネチャ変更を含む hunk を候補にし、削除された宣言名 R と追加された宣言名 A を取る。
// - 宣言の単位は declarations.ts と同じ + 主コンストラクタの val / var 引数（class_parameter）。
//   `class Order(val promo: Promo?)` の promo は property_declaration ではないので、ここでだけ宣言として数える
// - シグネチャ変更（両側にある同名の宣言で、本体を除いた単語列が違う）は名前を R と A の両方に入れる
// - 主コンストラクタの引数の増減は class 自体のシグネチャ変更ではなく、引数ごとの追加・削除として数える
import type { Node, Tree } from 'web-tree-sitter';
import { collectDeclarations, type DeclarationKind } from '../hunks/declarations.js';
import type { SemanticHunk } from '../hunks/extract.js';

export interface CandidateName {
  name: string;
  kind: DeclarationKind | 'parameter';
}

export interface CoreCandidate {
  removed: CandidateName[];
  added: CandidateName[];
}

interface Slot {
  key: string;
  name: string;
  kind: DeclarationKind | 'parameter';
  signature: string;
}

/** 本体（シグネチャに含めない子ノード） */
const BODY_TYPES = new Set(['function_body', 'class_body', 'enum_class_body', 'block', 'getter', 'setter', 'constructor_delegation_call', 'primary_constructor']);
const COMMENT_TYPES = new Set(['line_comment', 'block_comment', 'multiline_comment']);

type HunkLike = Pick<SemanticHunk, 'symbolKind' | 'symbolFqName' | 'lines' | 'lnOld' | 'lnNew'>;

/** 候補なら R / A、そうでなければ undefined。ファイル hunk は候補にしない */
export function coreCandidate(hunk: HunkLike, oldTree: Tree, newTree: Tree): CoreCandidate | undefined {
  if (hunk.symbolKind === 'file') return undefined;
  const oldSlots = slotsIn(oldTree, hunk.symbolFqName);
  const newSlots = slotsIn(newTree, hunk.symbolFqName);
  const removed: CandidateName[] = [];
  const added: CandidateName[] = [];
  for (const s of oldSlots.values()) {
    const n = newSlots.get(s.key);
    if (n === undefined) removed.push({ name: s.name, kind: s.kind });
    else if (n.signature !== s.signature) {
      removed.push({ name: s.name, kind: s.kind });
      added.push({ name: n.name, kind: n.kind });
    }
  }
  for (const n of newSlots.values()) if (!oldSlots.has(n.key)) added.push({ name: n.name, kind: n.kind });
  if (removed.length === 0 && added.length === 0) return undefined;
  return { removed, added };
}

/** hunk の宣言（fqName）とその中の全宣言を、key（fqName）→ Slot で集める */
function slotsIn(tree: Tree, fqName: string): Map<string, Slot> {
  const decls = collectDeclarations(tree);
  const slots = new Map<string, Slot>();
  const root = decls.byFqName.get(fqName);
  if (root === undefined) return slots;
  const visit = (fq: string): void => {
    const d = decls.byFqName.get(fq)!;
    const node = nodeAt(tree, d.kind, d.startLine, d.endLine);
    if (node === null) return;
    slots.set(fq, { key: fq, name: d.name, kind: d.kind, signature: signatureOf(node) });
    for (const p of classParameters(node)) {
      const key = `${fq}(${p.name})`;
      slots.set(key, { key, name: p.name, kind: 'parameter', signature: p.signature });
    }
    for (const c of d.children) visit(c.fqName);
  };
  visit(fqName);
  return slots;
}

const NODE_TYPE_BY_KIND: Record<DeclarationKind, string> = {
  class: 'class_declaration',
  object: 'object_declaration',
  companion: 'companion_object',
  function: 'function_declaration',
  property: 'property_declaration',
  constructor: 'secondary_constructor',
  init: 'anonymous_initializer',
  typealias: 'type_alias',
  enumEntry: 'enum_entry',
};

/** declarations.ts の宣言（行範囲。先頭のコメントを含む）に対応するノード */
function nodeAt(tree: Tree, kind: DeclarationKind, startLine: number, endLine: number): Node | null {
  const type = NODE_TYPE_BY_KIND[kind];
  let found: Node | null = null;
  const walk = (n: Node): void => {
    if (found !== null) return;
    const s = n.startPosition.row + 1;
    if (s > endLine) return;
    if (n.type === type && s >= startLine && s <= endLine) {
      found = n;
      return;
    }
    for (const c of n.children) walk(c);
  };
  walk(tree.rootNode);
  return found;
}

/** 本体を除いた単語列。空白・コメントは入らないので改行や整形の違いでは変わらない */
function signatureOf(node: Node): string {
  const words: string[] = [];
  const walk = (n: Node): void => {
    if (BODY_TYPES.has(n.type) || COMMENT_TYPES.has(n.type)) return;
    if (n.childCount === 0) {
      if (n.text !== '') words.push(n.text);
      return;
    }
    for (const c of n.children) walk(c);
  };
  if (node.type === 'property_declaration') {
    // `=` 以降（初期化式・委譲）は本体
    for (const c of node.children) {
      if (c.type === '=' || c.type === 'property_delegate') break;
      walk(c);
    }
  } else {
    walk(node);
  }
  return words.join(' ');
}

/** 主コンストラクタの val / var 引数。plain な引数は宣言ではないので含めない */
function classParameters(node: Node): Array<{ name: string; signature: string }> {
  if (node.type !== 'class_declaration') return [];
  const ctor = node.children.find((c) => c.type === 'primary_constructor');
  const params = ctor?.children.find((c) => c.type === 'class_parameters');
  if (params === undefined) return [];
  const out: Array<{ name: string; signature: string }> = [];
  for (const p of params.children) {
    if (p.type !== 'class_parameter') continue;
    const binding = p.children.find((c) => c.type === 'val' || c.type === 'var' || c.type === 'binding_pattern_kind');
    if (binding === undefined) continue;
    const name = p.children.find((c) => c.type === 'identifier')?.text;
    if (name === undefined) continue;
    out.push({ name, signature: signatureOf(p) });
  }
  return out;
}
