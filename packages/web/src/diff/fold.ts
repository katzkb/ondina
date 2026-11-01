// 変わった行から離れた変わらない行を帯にまとめる（GitHub と同じ。2026-10-13。見本を比べて 20 行ずつにした）。
// 差分一覧・目的ごとのプレビュー（DiffList）とコースの停留所（FileView）が使う。行の種類は呼ぶ側が at で教える。
// 開いた行は key で覚える（AppState.fold）。帯の ↓ は上側から、↑ は下側から FOLD_STEP 行ずつ開く。

/** 変わった行の前後に残す行数 */
export const FOLD_AROUND = 3;
/** 帯の ↓ / ↑ が 1 回に開く行数 */
export const FOLD_STEP = 20;

/**
 * 開いた行の記録（AppState.fold）の key。hunk の行は hunk の id と lines の位置、hunk の外の行は head 側の行番号。
 * 差分一覧・目的ごとのプレビュー（rows.ts）とコースの停留所（fileRows.ts）で同じ key なので、どこかで開いた行は他の画面でも開いている
 */
export const foldKey = (hunkId: string | null, i: number, lnNew: number | null): string => (hunkId === null ? `n${lnNew}` : `${hunkId}:${i}`);

/**
 * 行の種類。break = 常に出し、帯と前後の行の数え方を切る行（hunk の見出し）。keep = 常に出し、錨と同じく前後を残す行（メモの行）。
 * 他は畳める行: key = 開いた行の記録の鍵、anchor = 畳まない行（変わった行・メモの付いた行など）
 */
export type FoldAt = 'break' | 'keep' | { key: string; anchor: boolean };

export type FoldPart<T> =
  | { kind: 'row'; row: T }
  /** 帯。keys / rows は隠れた行（上から順）。top = 列の先頭から、bottom = 列の末尾まで */
  | { kind: 'fold'; keys: string[]; rows: T[]; top: boolean; bottom: boolean };

export type Fold<T = unknown> = Extract<FoldPart<T>, { kind: 'fold' }>;

/** 帯のボタン: down = ↓（上側から開く）、up = ↑（下側から開く）、all = ↕（全部） */
export type FoldDir = 'down' | 'up' | 'all';

/**
 * 畳む。all（すべて表示）か、錨も常に出す行も無い列（見る場所が無い）は畳まない。
 * 錨と常に出す行から FOLD_AROUND 行以内（区切りを越えない）と、open にある key の行を出す。残りの続く行を帯にし、1 行だけなら出す
 */
export function foldLines<T>(rows: readonly T[], at: (row: T) => FoldAt, open: ReadonlySet<string>, all: boolean): FoldPart<T>[] {
  const kinds = rows.map(at);
  const plain = (): FoldPart<T>[] => rows.map((row) => ({ kind: 'row', row }));
  const isAnchor = (k: FoldAt) => k === 'keep' || (typeof k === 'object' && k.anchor);
  if (all || !kinds.some(isAnchor)) return plain();
  const shown = kinds.map((k) => typeof k !== 'object' || k.anchor || open.has(k.key));
  kinds.forEach((k, i) => {
    if (!isAnchor(k)) return;
    for (const dir of [-1, 1]) {
      for (let d = 1, j = i + dir; d <= FOLD_AROUND && j >= 0 && j < rows.length && kinds[j] !== 'break'; d++, j += dir) shown[j] = true;
    }
  });
  const out: FoldPart<T>[] = [];
  for (let i = 0; i < rows.length; ) {
    if (shown[i]) {
      out.push({ kind: 'row', row: rows[i]! });
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < rows.length && !shown[j + 1]) j++;
    const hidden = rows.slice(i, j + 1);
    if (hidden.length === 1) out.push({ kind: 'row', row: hidden[0]! });
    else out.push({ kind: 'fold', keys: kinds.slice(i, j + 1).map((k) => (k as { key: string }).key), rows: hidden, top: i === 0, bottom: j === rows.length - 1 });
    i = j + 1;
  }
  return out;
}

/** 帯のボタン。FOLD_STEP 行以下の真ん中の帯は ↕ だけ。先頭の帯は ↑ だけ、末尾の帯は ↓ だけ */
export function foldButtons(f: Fold): FoldDir[] {
  if (f.keys.length <= FOLD_STEP && !f.top && !f.bottom) return ['all'];
  return [...(f.top ? [] : (['down'] as const)), ...(f.bottom ? [] : (['up'] as const))];
}

/** ボタンを押すと開く行の key */
export function foldKeys(f: Fold, dir: FoldDir): string[] {
  if (dir === 'down') return f.keys.slice(0, FOLD_STEP);
  if (dir === 'up') return f.keys.slice(-FOLD_STEP);
  return [...f.keys];
}
