// 意味トークンの重ね合わせ。設計書 7.2 パイプラインの 2 行目と 3 行目。
//
// 対応表は JetBrains 版 Catppuccin（catppuccin/jetbrains の templates/editor.tera）の属性割当から起こした。
// 2026-09-22 に実測で確定させたもので、7.2 の初版とは property（lavender → text）・operator（teal → sky）・
// decorator（未確認 → yellow italic）の 3 か所が違う。
//
// kotlin-lsp 263.4702.0 の実測（fixtures/order-service と hands-on-server-side-kotlin の 2 repo）で分かったこと:
// - keyword / string / number / comment / modifier / regexp は 1 個も返らない。字句レイヤーと衝突しない
// - 演算子は `*` `-` だけ返り `=` は返らない。上書きすると同じ行で sky と teal が割れるので使わない
// - アノテーションの使用（@Test / @RestController）は method で返る。decorator が付くのは import 行のほう。
//   IntelliJ は使用のほうを DEFAULT_METADATA（yellow italic）で塗るので、ここは kotlin-lsp が外している
//
// 重ね合わせの規則（案3 + 例外）:
//   1. 字句が色を付けていない       → 対応表を当てる
//   2. 字句が非識別子の役割を付けた → 対応表を当てる（例外。字句の読み違いが確定する場所）
//   3. 字句が識別子の役割を付けた   → 字句を残す
// 2 repo 814 か所の実測では、規則 2 が当たるのは 19 か所（Kotlin のソフトキーワード value / actual と
// 文字列テンプレート ${...} の中）だけで、アノテーション 68 か所には当たらない。
import type { TokenLine } from '../model.js';

/** initialize の応答の capabilities.semanticTokensProvider.legend。クライアントが送った legend は無視されるので応答側を読む */
export interface SemanticLegend {
  tokenTypes: readonly string[];
  tokenModifiers: readonly string[];
}

/** 絶対位置に展開した意味トークン。1 行に収まる（multilineTokenSupport を申告しないので LSP が分割して返す） */
export interface SemanticToken {
  /** 0 起点 */
  line: number;
  /** 0 起点。UTF-16 単位 */
  char: number;
  length: number;
  type: string;
  modifiers: readonly string[];
}

/**
 * 字句が「識別子ではない」と読んだときの役割（設計書 7.1 の字句カテゴリ）。
 * キーワード mauve / 文字列 green / コメント overlay2 / 数値 peach / 演算子 teal / リテラル red。
 * Shiki 側ではこの 6 つが識別子に付くことはないので、意味トークンが識別子だと言ったら字句の読み違い。
 */
export const NON_IDENTIFIER_ROLES: ReadonlySet<string> = new Set(['mauve', 'green', 'overlay2', 'peach', 'teal', 'red']);

/** 1 組 = [deltaLine, deltaChar, length, tokenType, tokenModifiers] */
const STRIDE = 5;

/** LSP の相対エンコードを絶対位置に展開する。5 の倍数でない余りは捨てる（壊れた応答で落ちない） */
export function decodeSemanticTokens(data: readonly number[], legend: SemanticLegend): SemanticToken[] {
  const out: SemanticToken[] = [];
  let line = 0;
  let char = 0;
  for (let i = 0; i + STRIDE <= data.length; i += STRIDE) {
    const [deltaLine, deltaChar, length, type, modifiers] = data.slice(i, i + STRIDE) as [number, number, number, number, number];
    line += deltaLine;
    char = deltaLine === 0 ? char + deltaChar : deltaChar;
    out.push({
      line,
      char,
      length,
      type: legend.tokenTypes[type] ?? String(type),
      modifiers: legend.tokenModifiers.filter((_, bit) => (modifiers >> bit) & 1),
    });
  }
  return out;
}

interface RoleEntry {
  role: string | null;
  /** declaration 修飾子が付いているときだけ italic */
  declItalic?: boolean;
  italic?: boolean;
}

/** LSP の token type → Catppuccin の役割。もとにした IntelliJ の属性を添える */
const ROLES: Readonly<Record<string, RoleEntry>> = {
  // DEFAULT_CLASS_NAME（宣言は italic）/ DEFAULT_CLASS_REFERENCE（参照は italic なし）/ DEFAULT_INTERFACE_NAME
  class: { role: 'yellow', declItalic: true },
  enum: { role: 'yellow', declItalic: true },
  struct: { role: 'yellow', declItalic: true },
  interface: { role: 'yellow', declItalic: true },
  // DEFAULT_CLASS_REFERENCE / KOTLIN_TYPE_PARAMETER。どちらも italic なし。
  // type は object の宣言にも付く（class ではなく type [declaration] で返る。2026-09-22 実測）が、
  // KOTLIN_TYPE_PARAMETER も DEFAULT_CLASS_REFERENCE も italic を持たないので宣言でも付けない
  type: { role: 'yellow' },
  typeParameter: { role: 'yellow' },
  // DEFAULT_FUNCTION_DECLARATION / DEFAULT_FUNCTION_CALL / DEFAULT_STATIC_METHOD。どれも FONT_TYPE=2
  method: { role: 'blue', italic: true },
  function: { role: 'blue', italic: true },
  // DEFAULT_PARAMETER
  parameter: { role: 'maroon', italic: true },
  // DEFAULT_INSTANCE_FIELD。static のときだけ DEFAULT_STATIC_FIELD（teal）。
  // ただし kotlin-lsp 263.4702.0 は const val にも static を付けないので、この分岐は実機では発火しない
  // （2026-09-22 に companion object の const val で確認）。定数を teal にする手は今のところ無い
  property: { role: 'text' },
  // DEFAULT_LOCAL_VARIABLE
  variable: { role: 'text' },
  // KOTLIN_ENUM_ENTRY
  enumMember: { role: 'peach' },
  // DEFAULT_METADATA
  decorator: { role: 'yellow', italic: true },
  // パッケージ名に当たる属性は無い。継承色のまま
  namespace: { role: null },
};

/**
 * 対応表を引く。表に無い種別（operator / keyword / string / number / comment / event / macro …）は undefined。
 * operator を入れていないのは、kotlin-lsp が `*` `-` だけ返して `=` を返さず、
 * 上書きすると同じ行で sky（JetBrains）と teal（Shiki）が割れるため。字句が正しい。
 */
export function semanticRole(type: string, modifiers: readonly string[]): { role: string | null; fontStyle: number } | undefined {
  const entry = ROLES[type];
  if (entry === undefined) return undefined;
  if (type === 'property' && modifiers.includes('static')) return { role: 'teal', fontStyle: 0 };
  const italic = entry.declItalic === true ? modifiers.includes('declaration') : entry.italic === true;
  return { role: entry.role, fontStyle: italic ? 1 : 0 };
}

/** 意味トークンを重ねてよい字句トークンか（規則 1 と 2） */
const overridable = (role: string | null): boolean => role === null || NON_IDENTIFIER_ROLES.has(role);

/**
 * ファイル 1 本分の TokenLine[] に意味トークンを重ねる。
 * 字句トークンは行内で連続していて、結合すると行文字列になる（tokenizer.ts の出力）。この不変条件は重ねても保つ。
 */
export function overlaySemanticTokens(lines: readonly TokenLine[], tokens: readonly SemanticToken[]): TokenLine[] {
  if (tokens.length === 0) return lines.map((l) => [...l]);
  const byLine = new Map<number, SemanticToken[]>();
  for (const t of tokens) {
    const list = byLine.get(t.line);
    if (list === undefined) byLine.set(t.line, [t]);
    else list.push(t);
  }
  return lines.map((line, index) => {
    const here = byLine.get(index);
    return here === undefined ? [...line] : overlayLine(line, here);
  });
}

function overlayLine(line: TokenLine, tokens: readonly SemanticToken[]): TokenLine {
  const out: TokenLine = [];
  // 行頭からの位置。字句トークンは隙間なく並んでいる
  let col = 0;
  for (const [text, role, fontStyle] of line) {
    let pos = 0;
    while (pos < text.length) {
      const abs = col + pos;
      const covering = tokens.find((t) => t.char <= abs && abs < t.char + t.length);
      // 覆われていないときは、次の意味トークンが始まる手前までを 1 つに切る
      const end =
        covering === undefined
          ? Math.min(text.length, ...tokens.filter((t) => t.char > abs).map((t) => t.char - col))
          : Math.min(text.length, covering.char + covering.length - col);
      const piece = text.slice(pos, end);
      const hit = covering === undefined ? undefined : semanticRole(covering.type, covering.modifiers);
      if (hit !== undefined && overridable(role)) out.push([piece, hit.role, hit.fontStyle]);
      else out.push([piece, role, fontStyle]);
      pos = end;
    }
    col += text.length;
  }
  return out.filter(([text]) => text.length > 0);
}
