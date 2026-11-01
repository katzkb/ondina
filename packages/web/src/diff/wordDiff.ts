// 行の中の変わった所（設計書 3.4。2026-10-30。GitHub と同じく、行の中で変わった語に印を付ける）。
// 組は左右表示（alignRows）と同じ: 続く消した行と、そのすぐ後に続く足した行の k 番目どうし。組の中を語の単位で比べ、変わった語の位置を返す。
// 解析（Analysis）は変えず、画面で hunk.lines から求める（前に解析した結果にも出る）。

/** 行の中の変わった所。行の文字（接頭辞の 1 文字を除いた line.slice(1)）の中の位置 [from, to) */
export type ChangeSpan = readonly [from: number, to: number];

type Spans = readonly ChangeSpan[] | undefined;

/** 比べる語の数の積がこれを超える組は比べない（表の大きさ。長い行どうしで画面が止まらないように） */
const MAX_CELLS = 250_000;
/** 空白以外の文字のうち共通の割合がこれ未満の組は塗らない。return order.getDiscount() → return order.discount（約 0.53）は塗り、
    val promo: Promo? = null, → var discount: Money = Money.ZERO,（約 0.12）のように書き換えた行は行の色だけにする */
const MIN_SIMILARITY = 0.4;

/** 名前・数の続き、空白の続き、それ以外の 1 文字 */
const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

interface Token {
  text: string;
  from: number;
}

const tokenize = (text: string): Token[] => [...text.matchAll(TOKEN)].map((m) => ({ text: m[0], from: m.index }));
const nonWs = (s: string) => s.replace(/\s/g, '').length;
const blank = (s: string) => /^\s*$/.test(s);

const cache = new WeakMap<readonly string[], readonly Spans[]>();

/** hunk.lines と同じ並び。塗る所が無い行（変わらない行・組の相手がいない行・似ていない組・変わった所が無い行）は undefined */
export function wordDiff(lines: readonly string[]): readonly Spans[] {
  const hit = cache.get(lines);
  if (hit) return hit;
  const out: Spans[] = lines.map(() => undefined);
  let i = 0;
  while (i < lines.length) {
    if (lines[i]![0] !== '-') {
      i++;
      continue;
    }
    const del: number[] = [];
    const add: number[] = [];
    while (i < lines.length && lines[i]![0] === '-') del.push(i++);
    while (i < lines.length && lines[i]![0] === '+') add.push(i++);
    for (let k = 0; k < Math.min(del.length, add.length); k++) {
      const pair = comparePair(lines[del[k]!]!.slice(1), lines[add[k]!]!.slice(1));
      if (pair) [out[del[k]!], out[add[k]!]] = pair;
    }
  }
  cache.set(lines, out);
  return out;
}

/** 1 組の両側の塗る所。比べない組・似ていない組は null */
function comparePair(oldText: string, newText: string): [Spans, Spans] | null {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_CELLS) return null;
  // dp[i * (m + 1) + j] = a の前 i 語と b の前 j 語の最長共通部分列の長さ
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i * w + j] = a[i - 1]!.text === b[j - 1]!.text ? dp[(i - 1) * w + j - 1]! + 1 : Math.max(dp[(i - 1) * w + j]!, dp[i * w + j - 1]!);
    }
  }
  // 後ろから辿り、同じ語はできるだけ後ろの語と合わせる（"[$level] $msg" に足した ${Instant.now()} を、{Instant.now()} $ と切らない）
  const keptA = new Array<boolean>(n).fill(false);
  const keptB = new Array<boolean>(m).fill(false);
  let common = 0;
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (a[i - 1]!.text === b[j - 1]!.text) {
      keptA[--i] = true;
      keptB[--j] = true;
      common += nonWs(a[i]!.text);
    } else if (dp[(i - 1) * w + j]! >= dp[i * w + j - 1]!) i--;
    else j--;
  }
  const total = nonWs(oldText) + nonWs(newText);
  // 両側とも空白だけの行（空白の数だけ変えた行）は比べる文字が無いので塗る
  if (total > 0 && (2 * common) / total < MIN_SIMILARITY) return null;
  return [spansOf(oldText, a, keptA), spansOf(newText, b, keptB)];
}

/** 合わなかった語を範囲にする。空白だけを挟んだ範囲はつなぎ、端の空白は除く（空白だけの範囲は字下げの変化なので残す） */
function spansOf(text: string, tokens: readonly Token[], kept: readonly boolean[]): Spans {
  const raw: [number, number][] = [];
  tokens.forEach((t, k) => {
    if (kept[k]) return;
    const last = raw[raw.length - 1];
    if (last && blank(text.slice(last[1], t.from))) last[1] = t.from + t.text.length;
    else raw.push([t.from, t.from + t.text.length]);
  });
  const spans = raw.map(([from, to]): ChangeSpan => {
    const s = text.slice(from, to);
    if (blank(s)) return [from, to];
    return [from + (s.length - s.trimStart().length), to - (s.length - s.trimEnd().length)];
  });
  return spans.length > 0 ? spans : undefined;
}
