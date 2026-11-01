// hunk の各行に字句トークンを付ける。設計書 7.2。
//
// ファイル全体を before / after それぞれ 1 回トークン化し（複数行コメント・文字列の文脈を保つため）、
// hunk の統合形式 lines を lnOld / lnNew から歩いて該当行を拾う。' ' と '-' は before 側、'+' は after 側。
// tokens[i] は lines[i] の接頭辞（' ' | '+' | '-'）を除いた文字列に対応する（prototype の TOK と同じ）。
// トークンを結合した文字列が行と一致しない場合は、その行だけ継承色 1 トークンに落とす（表示する文字列は常に lines が正）。
// フォールバックした行の index は hunkTokenLines が返す（fixture テストで 0 件を確認し、hunk 切り出しや diff の変更で静かに劣化しないようにする）。
// Shiki が知らない言語のファイル、files に無い path の hunk には tokens を付けない。
import type { Hunk, TokenLine } from '../model.js';
import type { ChangedFile } from '../hunks/extract.js';
import { decodeSemanticTokens, overlaySemanticTokens, type SemanticLegend } from './semantic.js';
import { createTokenizer, type Tokenizer } from './tokenizer.js';

/**
 * LSP から取った意味トークン（設計書 7.2 / 9.1）。生の data 配列のまま持ち、ここで展開する。
 * 1 プロセスに base / head の 2 つの workspaceFolder を入れて取るので legend は 1 つ。
 */
export interface SemanticSource {
  legend: SemanticLegend;
  /** repo 相対パス → semanticTokens/full の data */
  head: ReadonlyMap<string, readonly number[]>;
  base: ReadonlyMap<string, readonly number[]>;
}

export interface AttachTokensOptions {
  tokenizer?: Tokenizer;
  /** 欄が無い = LSP を起こしていない。字句トークンだけ付ける */
  semantic?: SemanticSource;
}

/** 統合形式の lines を lnOld / lnNew から歩き、before / after のトークン行を対応付ける */
export function hunkTokenLines(
  hunk: Pick<Hunk, 'lnOld' | 'lnNew' | 'lines'>,
  before: TokenLine[],
  after: TokenLine[],
): { tokens: TokenLine[]; fallbacks: number[] } {
  let i = hunk.lnOld;
  let j = hunk.lnNew;
  const fallbacks: number[] = [];
  const tokens = hunk.lines.map((line, index) => {
    const text = line.slice(1);
    let picked: TokenLine | undefined;
    if (line[0] === '+') picked = after[j++ - 1];
    else if (line[0] === '-') picked = before[i++ - 1];
    else {
      picked = before[i++ - 1];
      j++;
    }
    if (picked && picked.map(([t]) => t).join('') === text) return picked;
    fallbacks.push(index);
    return [[text, null, 0] satisfies TokenLine[number]];
  });
  return { tokens, fallbacks };
}

export async function attachTokens(hunks: Hunk[], files: ChangedFile[], opts: AttachTokensOptions = {}): Promise<Hunk[]> {
  const { tokenizer, semantic } = opts;
  if (tokenizer === undefined) {
    // 自分で作った Tokenizer は自分で解放する（呼び出しごとに wasm を積み上げない）
    const own = createTokenizer();
    try {
      return await attachTokens(hunks, files, { ...opts, tokenizer: own });
    } finally {
      own.dispose();
    }
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  const cache = new Map<string, Promise<{ before: TokenLine[]; after: TokenLine[] } | undefined>>();

  /** その側にその path の意味トークンがあれば重ねる。無ければ字句のまま */
  const overlay = (lines: TokenLine[], side: 'base' | 'head', path: string): TokenLine[] => {
    const data = semantic?.[side].get(path);
    if (semantic === undefined || data === undefined) return lines;
    return overlaySemanticTokens(lines, decodeSemanticTokens(data, semantic.legend));
  };

  const tokensOf = (hunk: Hunk) => {
    const file = byPath.get(hunk.path);
    if (!file) return undefined;
    let p = cache.get(hunk.path);
    if (!p) {
      p = (async () => {
        const before = file.before === null ? [] : await tokenizer.tokenize(file.before, hunk.lang);
        const after = file.after === null ? [] : await tokenizer.tokenize(file.after, hunk.lang);
        if (before === undefined || after === undefined) return undefined;
        // 意味トークンはファイル単位で先に重ねる。hunk への切り出しは今までどおり lnOld / lnNew で歩く
        return { before: overlay(before, 'base', hunk.path), after: overlay(after, 'head', hunk.path) };
      })();
      cache.set(hunk.path, p);
    }
    return p;
  };

  const out: Hunk[] = [];
  for (const hunk of hunks) {
    const sides = await tokensOf(hunk);
    if (!sides) {
      out.push(hunk);
      continue;
    }
    out.push({ ...hunk, tokens: hunkTokenLines(hunk, sides.before, sides.after).tokens });
  }
  return out;
}
