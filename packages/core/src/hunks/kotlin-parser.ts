// web-tree-sitter と @tree-sitter-grammars/tree-sitter-kotlin の同梱 wasm で Kotlin をパースする。
// 設計書 5.2 手順1 / 6章。Parser と Language はプロセス内で1回だけ初期化する。
import { createRequire } from 'node:module';
import { Language, Parser, type Tree } from 'web-tree-sitter';

const require = createRequire(import.meta.url);

let parserPromise: Promise<Parser> | undefined;

function loadParser(): Promise<Parser> {
  parserPromise ??= (async () => {
    await Parser.init();
    const wasmPath = require.resolve('@tree-sitter-grammars/tree-sitter-kotlin/tree-sitter-kotlin.wasm');
    const language = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  })();
  return parserPromise;
}

/** Kotlin ソースをパースして構文木を返す。 */
export async function parseKotlin(source: string): Promise<Tree> {
  const parser = await loadParser();
  const tree = parser.parse(source);
  if (tree === null) {
    throw new Error('tree-sitter-kotlin: parse returned null');
  }
  return tree;
}
