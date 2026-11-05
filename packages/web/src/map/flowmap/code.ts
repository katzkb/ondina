// 流れの地図のステップの欄のコード（見本 flow5）。呼んでいる行を、段ごとの側で見せる。
// ① = 変わる前の行、③ = 変わった後の行、② = 呼んでいる行が差分に入れば hunk の行（- と +）、入らなければ変わった後の行。
// 根（入口）は宣言なので、入口の hunk の頭の行。事実（ファイルと hunk の行）だけで組む（原則 3）
import type { Analysis, FlowCall, Hunk } from '@ondina/model';
import type { Stage } from './steps.js';

export interface CodeRow {
  /** ' ' = そのまま、'+' = 足した行、'-' = 消した行 */
  k: ' ' | '+' | '-';
  text: string;
  /** 呼んでいる行 */
  hot: boolean;
}

export interface StepCode {
  path: string;
  rows: CodeRow[];
}

type Facts = Pick<Analysis, 'symbols' | 'hunks' | 'files' | 'baseFiles'>;

const lineOf = (files: Analysis['files'], path: string, ln: number): string | undefined => {
  const f = files?.find((x) => x.path === path);
  const t = f?.tokens[ln - 1];
  return t?.map((x) => x[0]).join('');
};

/** hunk の行に、変わる前・変わった後の行番号を振る */
function numbered(h: Pick<Hunk, 'lines' | 'lnOld' | 'lnNew'>): Array<{ k: CodeRow['k']; text: string; old?: number; neu?: number }> {
  let o = h.lnOld;
  let n = h.lnNew;
  return h.lines.map((l) => {
    const k = (l[0] === '+' || l[0] === '-' ? l[0] : ' ') as CodeRow['k'];
    const text = l.slice(1);
    if (k === '+') return { k, text, neu: n++ };
    if (k === '-') return { k, text, old: o++ };
    return { k, text, old: o++, neu: n++ };
  });
}

/** その行を含む hunk（同じファイル。side の行番号で見る） */
function hunkAt(hunks: readonly Hunk[], path: string, side: 'old' | 'neu', ln: number): Hunk | undefined {
  return hunks.find((h) => h.path === path && numbered(h).some((r) => r[side] === ln && (side === 'old' ? r.k !== '+' : r.k !== '-')));
}

/** 呼んでいる行の前後 ctx 行を hunk の行から切る。only を渡すとその向きの行だけ（① は '+' を、③ は '-' を落とす） */
function cut(h: Hunk, hot: (r: ReturnType<typeof numbered>[number]) => boolean, drop: '+' | '-' | null, ctx: number): CodeRow[] {
  const rows = numbered(h).filter((r) => r.k !== drop);
  const at = rows.map((r, i) => (hot(r) ? i : -1)).filter((i) => i >= 0);
  if (at.length === 0) return [];
  const a = Math.max(0, at[0]! - ctx);
  const b = Math.min(rows.length, at[at.length - 1]! + ctx + 1);
  return rows.slice(a, b).map((r) => ({ k: drop === null ? r.k : ' ', text: r.text, hot: hot(r) }));
}

/** 1 行だけ（差分に入らない行）。前後 ctx 行もファイルから */
function plain(files: Analysis['files'], path: string, ln: number, ctx: number): CodeRow[] {
  const out: CodeRow[] = [];
  for (let x = ln - ctx; x <= ln + ctx; x++) {
    const t = lineOf(files, path, x);
    if (t !== undefined) out.push({ k: ' ', text: t, hot: x === ln });
  }
  return out;
}

/** ステップのコード。呼ぶ側のファイルが分からなければ null */
export function stepCode(a: Facts, c: FlowCall, stage: Stage, ctx = 1): StepCode | null {
  const sym = new Map(a.symbols.map((s) => [s.id, s]));
  if (c.from === null) {
    // 根: 入口の hunk の頭
    const s = sym.get(c.to);
    const h = a.hunks.find((x) => x.id === (s?.hunkId ?? c.to));
    if (!s || !h) return null;
    const drop = stage === 1 ? '+' : stage === 3 ? '-' : null;
    const rows = numbered(h)
      .filter((r) => r.k !== drop)
      .slice(0, 4)
      .map((r): CodeRow => ({ k: drop === null ? r.k : ' ', text: r.text, hot: false }));
    return { path: s.path, rows };
  }
  const caller = sym.get(c.from);
  if (!caller) return null;
  const path = caller.path;
  const b = c.before?.line;
  const n = c.after?.line;
  const hotOld = (r: { k: string; old?: number }) => b !== undefined && r.k !== '+' && r.old === b;
  const hotNew = (r: { k: string; neu?: number }) => n !== undefined && r.k !== '-' && r.neu === n;
  if (stage === 1) {
    if (b === undefined) return null;
    const h = hunkAt(a.hunks, path, 'old', b);
    if (h) return { path, rows: cut(h, hotOld, '+', ctx) };
    // 差分に入らない行は変わった後と同じ（base の全文があればそれを使う）
    if (a.baseFiles?.some((f) => f.path === path)) return { path, rows: plain(a.baseFiles, path, b, ctx) };
    return n === undefined ? null : { path, rows: plain(a.files, path, n, ctx) };
  }
  if (stage === 3) {
    if (n === undefined) return null;
    const h = hunkAt(a.hunks, path, 'neu', n);
    return { path, rows: h ? cut(h, hotNew, '-', ctx) : plain(a.files, path, n, ctx) };
  }
  // ② 差分の行に入れば hunk の行（消した行と足した行の両方を光らせる）
  const h = (n !== undefined ? hunkAt(a.hunks, path, 'neu', n) : undefined) ?? (b !== undefined ? hunkAt(a.hunks, path, 'old', b) : undefined);
  if (h) {
    const rows = cut(h, (r) => hotOld(r) || hotNew(r), null, ctx);
    if (rows.some((r) => r.k !== ' ')) return { path, rows };
  }
  if (n !== undefined) return { path, rows: plain(a.files, path, n, ctx) };
  return null;
}
