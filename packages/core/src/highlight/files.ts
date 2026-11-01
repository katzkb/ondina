// head 側の全文（設計書 3.3 の実物の画面）。hunk と同じトークン化・意味トークンの重ね合わせを通す。
// 画面は差分の前後だけを出して残りを畳むので、全文を Analysis.files に持たせる（web はファイルを読まない。原則 5）。
import type { FileText, TokenLine } from '../model.js';
import { langOf, type ChangedFile } from '../hunks/extract.js';
import type { AttachTokensOptions } from './attach.js';
import { decodeSemanticTokens, overlaySemanticTokens } from './semantic.js';
import { createTokenizer } from './tokenizer.js';

export interface HeadFileSource {
  path: string;
  text: string;
}

/**
 * 全文を持たせるファイル: 差分のあるファイル（削除を除く）と Symbol.path のファイル。path 順に 1 回ずつ。
 * 差分の無いファイルは readHead で head から読み、読めなければ入れない
 */
export function headFileSources(files: readonly ChangedFile[], symbols: ReadonlyArray<{ path: string }>, readHead: (rel: string) => string | undefined): HeadFileSource[] {
  const out = new Map<string, string>();
  for (const f of files) if (f.after !== null) out.set(f.path, f.after);
  const changed = new Set(files.map((f) => f.path));
  for (const s of symbols) {
    if (out.has(s.path) || changed.has(s.path)) continue;
    const text = readHead(s.path);
    if (text !== undefined) out.set(s.path, text);
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, text]) => ({ path, text }));
}

/** 1 ファイルずつトークン化する。Shiki が知らない言語は色なし 1 トークンの行。末尾の改行で空の行を足さない */
export async function headFileTokens(sources: readonly HeadFileSource[], opts: AttachTokensOptions = {}): Promise<FileText[]> {
  const { tokenizer, semantic } = opts;
  if (tokenizer === undefined) {
    const own = createTokenizer();
    try {
      return await headFileTokens(sources, { ...opts, tokenizer: own });
    } finally {
      own.dispose();
    }
  }
  const out: FileText[] = [];
  for (const { path, text } of sources) {
    const lexical = await tokenizer.tokenize(text, langOf(path));
    let tokens: TokenLine[] = lexical ?? text.split('\n').map((line) => [[line, null, 0]]);
    const data = semantic?.head.get(path);
    if (semantic !== undefined && data !== undefined && lexical !== undefined) tokens = overlaySemanticTokens(tokens, decodeSemanticTokens(data, semantic.legend));
    if (text.endsWith('\n') && tokens.length > 0 && tokens[tokens.length - 1]!.every(([t]) => t === '')) tokens = tokens.slice(0, -1);
    out.push({ path, tokens });
  }
  return out;
}
