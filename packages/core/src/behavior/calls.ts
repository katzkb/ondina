// 動きの呼び出し 1 回に、呼び出しの式（BehaviorCall）を付ける（設計書 3.3。2026-11-04）。決定的（原則 7）。
// 呼んでいる行（呼ぶ側のファイルの head）を構文木で読み、その行にある呼び出しの式を選ぶ（見本で「呼び出しだけ」に決めた）。
//
// 規則:
// - Kotlin のファイル（.kt / .kts）だけ構文木で読む。呼んでいる名前がその行にある呼び出しの式が候補
// - 候補のうち、名前が呼ばれる側の FQ 名の最後の名前と同じものを選ぶ。無ければ（呼ばれる側がクラス全体の差分のときなど。
//   fixture の Order と order.applyDiscount）、いちばん長い式（外側の呼び出し）を選ぶ
// - 式は何行にまたがっても 1 行に詰める。引数は 1 つずつ原文で、後ろに付けたラムダは "{…}"
// - 式が見つからない・Kotlin でないなら、行の中身（前後の空白を落とす）を exact: false で入れる。ファイルを読めなければ欄を付けない
import type { Node } from 'web-tree-sitter';
import { parseKotlin } from '../hunks/kotlin-parser.js';
import type { Behavior, BehaviorCall, Symbol as OndinaSymbol } from '../model.js';

export interface AttachCallsArgs {
  symbols: readonly Pick<OndinaSymbol, 'id' | 'fqName' | 'path'>[];
  /** repo 相対のパスで head の全文を返す。読めなければ undefined */
  readHead: (path: string) => string | undefined;
}

export async function attachCalls(behaviors: readonly Behavior[], { symbols, readHead }: AttachCallsArgs): Promise<Behavior[]> {
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const trees = new Map<string, Promise<Node | undefined>>();
  const rootOf = (p: string, text: string): Promise<Node | undefined> => {
    if (!trees.has(p)) trees.set(p, /\.kts?$/.test(p) ? parseKotlin(text).then((t) => t.rootNode) : Promise.resolve(undefined));
    return trees.get(p)!;
  };

  const out: Behavior[] = [];
  for (const b of behaviors) {
    const messages = [];
    for (const m of b.messages) {
      const from = byId.get(m.from);
      const to = byId.get(m.to);
      const text = m.line === undefined || from === undefined ? undefined : readHead(from.path);
      const lineText = text?.split('\n')[m.line! - 1];
      if (text === undefined || lineText === undefined || to === undefined) {
        messages.push(m);
        continue;
      }
      const root = await rootOf(from!.path, text);
      const call = (root === undefined ? undefined : callOn(root, m.line! - 1, lastName(to.fqName))) ?? { text: lineText.trim(), exact: false };
      messages.push({ ...m, call });
    }
    out.push({ ...b, messages });
  }
  return out;
}

/** row（0 始まり）に名前がある呼び出しの式から 1 つを選ぶ */
function callOn(root: Node, row: number, want: string): BehaviorCall | undefined {
  const found: Array<{ node: Node; name: string }> = [];
  const walk = (n: Node): void => {
    if (n.startPosition.row > row || n.endPosition.row < row) return;
    if (n.type === 'call_expression') {
      const name = nameOf(n);
      if (name !== undefined && name.startPosition.row === row) found.push({ node: n, name: name.text });
    }
    for (const c of n.namedChildren) if (c !== null) walk(c);
  };
  walk(root);
  if (found.length === 0) return undefined;
  const size = (n: Node) => n.endIndex - n.startIndex;
  const pick = found.find((f) => f.name === want) ?? found.slice().sort((a, b) => size(b.node) - size(a.node))[0]!;
  return { text: flat(pick.node.text), exact: true, name: pick.name, args: argsOf(pick.node) };
}

/** 呼んでいる名前の識別子。a.b.c(x) なら c、f(x) なら f */
function nameOf(call: Node): Node | undefined {
  const callee = call.namedChildren[0];
  if (callee === null || callee === undefined) return undefined;
  if (callee.type === 'identifier' || callee.type === 'simple_identifier') return callee;
  if (callee.type === 'navigation_expression') {
    const last = callee.namedChildren[callee.namedChildren.length - 1];
    return last !== null && last !== undefined && (last.type === 'identifier' || last.type === 'simple_identifier') ? last : undefined;
  }
  return undefined;
}

function argsOf(call: Node): string[] {
  const args: string[] = [];
  for (const c of call.namedChildren.slice(1)) {
    if (c === null) continue;
    if (c.type === 'value_arguments') for (const a of c.namedChildren) if (a !== null && a.type === 'value_argument') args.push(flat(a.text));
    if (c.type === 'annotated_lambda' || c.type === 'lambda_literal') args.push('{…}');
  }
  return args;
}

/** 何行にもまたがる式を 1 行に詰める。括弧の内側の空白は落とす */
function flat(s: string): string {
  return s
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/,?\s+\)/g, ')');
}

const lastName = (fqName: string): string => fqName.split(/[./]/).pop()!;
