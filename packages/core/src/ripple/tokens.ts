// 追従検出の「形」の材料（設計書 8 章 3）。
// 変更行の構文木の葉を単語として並べ、R∪A 以外の識別子をプレースホルダにし、Kotlin の表記ゆれを揃える。
// 空白・改行・コメントは葉に含めないので、この時点で消える。
import type { Node, Tree } from 'web-tree-sitter';

export interface Token {
  text: string;
  /** tree-sitter のノード型（identifier / . / ?. など） */
  type: string;
  /** ラムダの引数宣言の中にある識別子（lambdaIt が見る） */
  lambdaParam: boolean;
}

/** 今回実装した正規化ルール。設定 `normalize.<lang>` の名前と一致させる */
export const NORMALIZE_RULES = ['safeCall', 'lambdaIt', 'trailingComma'] as const;
export type NormalizeRule = (typeof NORMALIZE_RULES)[number];
/** 設計書 8 章にあるが未対応のルール（呼び先の宣言順が要る。M2 の LSP 後） */
export const DEFERRED_RULES = ['namedArgOrder'] as const;

const COMMENT_TYPES = new Set(['line_comment', 'block_comment', 'multiline_comment']);
const CLOSERS = new Set([')', ']', '}', '>']);

/** 指定した行（1 始まり）にある葉を出現順に返す */
export function leafTokens(tree: Tree, lines: readonly number[]): Token[] {
  const want = new Set(lines);
  const out: Token[] = [];
  const walk = (n: Node, inLambdaParams: boolean): void => {
    if (COMMENT_TYPES.has(n.type)) return;
    if (n.childCount === 0) {
      if (n.text !== '' && want.has(n.startPosition.row + 1)) out.push({ text: n.text, type: n.type, lambdaParam: inLambdaParams && n.type === 'identifier' });
      return;
    }
    const inner = inLambdaParams || n.type === 'lambda_parameters';
    for (const c of n.children) walk(c, inner);
  };
  walk(tree.rootNode, false);
  return out;
}

/** R∪A（keep）以外の識別子を、旧・新を通した出現順で `$1` `$2` … に置き換える。`it` は Kotlin の暗黙引数なのでそのまま */
export function placeholders(oldTokens: readonly Token[], newTokens: readonly Token[], keep: ReadonlySet<string>): [string[], string[]] {
  const numbered = new Map<string, string>();
  const rename = (t: Token): string => {
    if (t.type !== 'identifier' || t.text === 'it' || keep.has(t.text)) return t.text;
    let p = numbered.get(t.text);
    if (p === undefined) {
      p = `$${numbered.size + 1}`;
      numbered.set(t.text, p);
    }
    return p;
  };
  return [oldTokens.map(rename), newTokens.map(rename)];
}

/** 設定で有効にしたルールだけ適用する。知らない名前は無視（analyze が別途知らせる） */
export function normalizeTokens(tokens: readonly Token[], rules: readonly string[]): Token[] {
  const on = new Set(rules);
  let out = [...tokens];
  if (on.has('safeCall')) out = out.map((t) => (t.text === '?.' ? { ...t, text: '.' } : t));
  if (on.has('lambdaIt')) out = lambdaIt(out);
  if (on.has('trailingComma')) out = out.filter((t, i) => !(t.text === ',' && CLOSERS.has(out[i + 1]?.text ?? '')));
  return out;
}

/** `{ p -> p.x }` を `{ it.x }` に。引数が 1 つ（識別子の直後が `->`）のラムダだけ */
function lambdaIt(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const name = tokens[i + 1];
    const arrow = tokens[i + 2];
    if (t.text === '{' && name?.lambdaParam && arrow?.text === '->') {
      out.push(t);
      let depth = 0;
      let j = i + 3;
      for (; j < tokens.length; j++) {
        const u = tokens[j]!;
        if (u.text === '{') depth++;
        if (u.text === '}') {
          if (depth === 0) break;
          depth--;
        }
        out.push(u.type === 'identifier' && u.text === name.text ? { ...u, text: 'it' } : u);
      }
      i = j - 1;
      continue;
    }
    out.push(t);
  }
  return out;
}
