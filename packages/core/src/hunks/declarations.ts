// 構文木から「hunk の単位になる宣言」のツリーを作る。設計書 5.2 手順1。
//
// 単位にする宣言: class / object / companion / fun / property / secondary constructor / init / typealias / enum entry。
// 関数本体の中のローカル宣言には降りない（hunk の単位は関数まで）。
// 直前に隣接するコメント（KDoc など）は宣言の範囲に含める。アノテーションは構文木上すでに宣言の中にある。
import type { Node, Tree } from 'web-tree-sitter';

export type DeclarationKind =
  | 'class'
  | 'object'
  | 'companion'
  | 'function'
  | 'property'
  | 'constructor'
  | 'init'
  | 'typealias'
  | 'enumEntry';

export interface Declaration {
  kind: DeclarationKind;
  /** 表示名。関数なら `applyDiscount`、無名 companion なら `Companion` */
  name: string;
  /** package と外側の宣言で修飾した名前。同名の兄弟は出現順に `#2` `#3` を付けて区別する */
  fqName: string;
  parentFqName?: string;
  /** 1始まり・両端含む */
  startLine: number;
  endLine: number;
  children: Declaration[];
  /** class の主コンストラクタの val / var の引数（プロパティになる物）。hunk の単位にはしない（変えるとクラスの hunk）。無ければ欄なし */
  ctorProperties?: Array<{ name: string; line: number }>;
}

export interface DeclarationTree {
  packageName: string;
  declarations: Declaration[];
  byFqName: Map<string, Declaration>;
}

const KIND_BY_NODE_TYPE: Record<string, DeclarationKind> = {
  class_declaration: 'class',
  object_declaration: 'object',
  companion_object: 'companion',
  function_declaration: 'function',
  property_declaration: 'property',
  secondary_constructor: 'constructor',
  anonymous_initializer: 'init',
  type_alias: 'typealias',
  enum_entry: 'enumEntry',
};

/** メンバーを持てる宣言。この中の class_body / enum_class_body を再帰する */
const CONTAINER_KINDS = new Set<DeclarationKind>(['class', 'object', 'companion']);
const BODY_NODE_TYPES = new Set(['class_body', 'enum_class_body']);
const COMMENT_NODE_TYPES = new Set(['line_comment', 'block_comment', 'multiline_comment']);

export function collectDeclarations(tree: Tree): DeclarationTree {
  const root = tree.rootNode;
  const packageName = readPackageName(root);
  const byFqName = new Map<string, Declaration>();
  const declarations = collectChildren(root, packageName, undefined, byFqName);
  return { packageName, declarations, byFqName };
}

/** 行を含む最も内側の宣言。宣言の外（package / import / トップレベルコメント）なら undefined */
export function declarationAt(tree: DeclarationTree, line: number): Declaration | undefined {
  let found: Declaration | undefined;
  let candidates = tree.declarations;
  for (;;) {
    const next = candidates.find((d) => d.startLine <= line && line <= d.endLine);
    if (next === undefined) return found;
    found = next;
    candidates = next.children;
  }
}

/** fqName の宣言とその祖先を、外側から順に返す */
export function ancestorChain(tree: DeclarationTree, fqName: string): string[] {
  const chain: string[] = [];
  let current: Declaration | undefined = tree.byFqName.get(fqName);
  while (current !== undefined) {
    chain.unshift(current.fqName);
    current = current.parentFqName === undefined ? undefined : tree.byFqName.get(current.parentFqName);
  }
  return chain;
}

function readPackageName(root: Node): string {
  const header = root.children.find((c) => c.type === 'package_header');
  const qualified = header?.children.find((c) => c.type === 'qualified_identifier');
  return qualified?.text.replace(/\s+/g, '') ?? '';
}

function collectChildren(container: Node, prefix: string, parentFqName: string | undefined, byFqName: Map<string, Declaration>): Declaration[] {
  const result: Declaration[] = [];
  const seen = new Map<string, number>();
  for (const child of container.children) {
    const kind = KIND_BY_NODE_TYPE[child.type];
    if (kind === undefined) continue;
    const name = declarationName(child, kind);
    const ordinal = (seen.get(name) ?? 0) + 1;
    seen.set(name, ordinal);
    const localName = ordinal === 1 ? name : `${name}#${ordinal}`;
    const fqName = prefix === '' ? localName : `${prefix}.${localName}`;
    const decl: Declaration = {
      kind,
      name,
      fqName,
      startLine: startLineWithLeadingComments(child),
      endLine: endLine(child),
      children: [],
    };
    if (parentFqName !== undefined) decl.parentFqName = parentFqName;
    if (kind === 'class') {
      const props = ctorProperties(child);
      if (props.length > 0) decl.ctorProperties = props;
    }
    if (CONTAINER_KINDS.has(kind)) {
      for (const body of child.children.filter((c) => BODY_NODE_TYPES.has(c.type))) {
        decl.children.push(...collectChildren(body, fqName, fqName, byFqName));
      }
    }
    byFqName.set(fqName, decl);
    result.push(decl);
  }
  return result;
}

function declarationName(node: Node, kind: DeclarationKind): string {
  switch (kind) {
    case 'constructor':
      return 'constructor';
    case 'init':
      return 'init';
    case 'companion':
      return directIdentifier(node) ?? 'Companion';
    case 'property': {
      const names = node.children
        .filter((c) => c.type === 'variable_declaration' || c.type === 'multi_variable_declaration')
        .flatMap((c) => (c.type === 'variable_declaration' ? [directIdentifier(c)] : c.children.filter((g) => g.type === 'variable_declaration').map(directIdentifier)))
        .filter((n): n is string => n !== undefined);
      return names.length > 0 ? names.join(',') : '<property>';
    }
    default:
      return directIdentifier(node) ?? `<${kind}>`;
  }
}

function ctorProperties(node: Node): Array<{ name: string; line: number }> {
  const params = node.children.find((c) => c.type === 'primary_constructor')?.children.find((c) => c.type === 'class_parameters')?.children ?? [];
  return params.flatMap((p) => {
    if (p.type !== 'class_parameter' || !p.children.some((c) => c.type === 'val' || c.type === 'var')) return [];
    const name = directIdentifier(p);
    return name === undefined ? [] : [{ name, line: p.startPosition.row + 1 }];
  });
}

function directIdentifier(node: Node): string | undefined {
  const named = node.childForFieldName('name');
  if (named !== null) return named.text;
  return node.children.find((c) => c.type === 'identifier' || c.type === 'type_identifier')?.text;
}

function startLineWithLeadingComments(node: Node): number {
  let start = node.startPosition.row;
  let prev = node.previousSibling;
  while (prev !== null && COMMENT_NODE_TYPES.has(prev.type) && prev.endPosition.row >= start - 1) {
    start = prev.startPosition.row;
    prev = prev.previousSibling;
  }
  return start + 1;
}

function endLine(node: Node): number {
  const { row, column } = node.endPosition;
  // ノードが次の行の先頭で終わる（末尾に改行だけ含む）場合は前の行まで
  return column === 0 && row > node.startPosition.row ? row : row + 1;
}
