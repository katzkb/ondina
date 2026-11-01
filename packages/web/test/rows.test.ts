// 選択ファイルの hunk 列を、仮想リストに流す 1 本の行列にする（設計書 18.4）。メモ（3.3）はその最後の行の下に差し込む。
import { describe, expect, it } from 'vitest';
import type { CommentDraft } from '@ondina/model';
import { groupFiles } from '../src/files.js';
import { pickFor, type MemoPick } from '../src/memo.js';
import { buildFileRows, buildRows, foldVirtual, withMemos, type MemoItem, type VirtualRow } from '../src/diff/rows.js';
import { fixtureAnalysis, fixtureFiles, fixtureHunks } from './fixture.js';

const order = () => fixtureHunks().filter((h) => h.path.endsWith('/order/domain/Order.kt'));

describe('buildRows', () => {
  it('左右: hunk ごとにヘッダ 1 行 + alignRows の段数', () => {
    const hunks = order();
    const rows = buildRows(hunks, 'sbs');
    expect(rows.filter((r) => r.kind === 'header').map((r) => r.hunk.id)).toEqual(hunks.map((h) => h.id));
    expect(rows[0]).toEqual({ kind: 'header', hunk: hunks[0] });
    const first = rows.filter((r) => r.kind === 'sbs' && r.hunk.id === hunks[0]!.id);
    expect(first.length).toBeLessThanOrEqual(hunks[0]!.lines.length);
    expect(first.length).toBeGreaterThan(0);
  });

  it('統合: 行数は lines と同じで、共通行は旧・新の両方、削除は旧だけ、追加は新だけの行番号を持つ', () => {
    const h = { ...order()[0]!, lnOld: 3, lnNew: 30, lines: [' a', '-b', '+c', ' d'] };
    const rows = buildRows([h], 'uni');
    expect(rows).toHaveLength(1 + 4);
    expect(rows.slice(1)).toEqual([
      { kind: 'uni', hunk: h, base: 0, i: 0, t: 'c', lnOld: 3, lnNew: 30 },
      { kind: 'uni', hunk: h, base: 0, i: 1, t: 'r', lnOld: 4, lnNew: null },
      { kind: 'uni', hunk: h, base: 0, i: 2, t: 'a', lnOld: null, lnNew: 31 },
      { kind: 'uni', hunk: h, base: 0, i: 3, t: 'c', lnOld: 5, lnNew: 32 },
    ]);
  });

  it('左右: 対になる側が無い段は null のまま持つ（斜線塗りの元）', () => {
    const h = { ...order()[0]!, lnOld: 1, lnNew: 1, lines: ['-a', '-b', '+c'] };
    const rows = buildRows([h], 'sbs');
    expect(rows[2]).toEqual({ kind: 'sbs', hunk: h, base: 0, o: { i: 1, t: 'r', ln: 2 }, n: null });
  });
});

describe('buildFileRows（目的ごとの画面のプレビュー。ファイル全体に差分を埋め込む）', () => {
  // fixture の OrderRepositoryImpl.kt: 差分 2 つ（save() / find()）。base 31 行 → head 36 行
  const PATH = 'src/main/kotlin/com/example/order/infra/OrderRepositoryImpl.kt';
  const repo = () => fixtureHunks().filter((h) => h.path === PATH);
  const file = () => fixtureFiles([PATH])[0]!;
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  /** 行番号の列（head 側 / base 側）。変わらない行（差分の外）と差分の行を上から順に */
  const heads = (rows: VirtualRow[]) => rows.flatMap((r) => (r.kind === 'ctx' ? [r.lnNew] : r.kind === 'uni' ? (r.lnNew === null ? [] : [r.lnNew]) : r.kind === 'sbs' ? (r.n ? [r.n.ln] : []) : []));
  const bases = (rows: VirtualRow[]) => rows.flatMap((r) => (r.kind === 'ctx' ? [r.lnOld] : r.kind === 'uni' ? (r.lnOld === null ? [] : [r.lnOld]) : r.kind === 'sbs' ? (r.o ? [r.o.ln] : []) : []));

  it('統合: 1 行目から差分の外の行（ctx）が並び、見出しは行の順（save → find）。head 側は 1〜36、base 側は 1〜31 が抜けなく続く', () => {
    const rows = buildFileRows(file(), [...repo()].reverse(), 'uni');
    expect(rows.filter((r) => r.kind === 'header').map((r) => r.hunk.symbol)).toEqual(['save()', 'find()']);
    expect(rows[0]).toEqual({ kind: 'ctx', path: PATH, lnOld: 1, lnNew: 1, tokens: file().tokens[0] });
    expect(heads(rows)).toEqual(range(36));
    expect(bases(rows)).toEqual(range(31));
  });

  it('左右: 同じく head 側 1〜36、base 側 1〜31。差分の外の行の数は統合と同じ', () => {
    const rows = buildFileRows(file(), repo(), 'sbs');
    expect(heads(rows)).toEqual(range(36));
    expect(bases(rows)).toEqual(range(31));
    const ctx = (rs: VirtualRow[]) => rs.filter((r) => r.kind === 'ctx').length;
    expect(ctx(rows)).toBe(ctx(buildFileRows(file(), repo(), 'uni')));
  });

  it('差分の見出しと行は buildRows と同じ（行の並び base も同じ数え方）', () => {
    for (const mode of ['uni', 'sbs'] as const) {
      expect(buildFileRows(file(), [...repo()].reverse(), mode).filter((r) => r.kind !== 'ctx')).toEqual(buildRows(repo(), mode));
    }
  });
});

describe('行の並び（base）', () => {
  it('base はそのファイルの前の hunk の行数の合計（行の並び = base + i。左右・統合で同じ数）', () => {
    const a = { ...order()[0]!, id: 'a', lnOld: 1, lnNew: 1, lines: [' x', '-y', '+z'] };
    const b = { ...order()[0]!, id: 'b', lnOld: 20, lnNew: 20, lines: [' p', '+q'] };
    const uni = buildRows([a, b], 'uni').filter((r) => r.kind === 'uni');
    expect(uni.map((r) => r.base + r.i)).toEqual([0, 1, 2, 3, 4]);
    const sbs = buildRows([a, b], 'sbs').filter((r) => r.kind === 'sbs');
    expect(sbs.map((r) => `${r.o ? r.base + r.o.i : '-'}|${r.n ? r.base + r.n.i : '-'}`)).toEqual(['0|0', '1|2', '3|3', '-|4']);
  });
});

describe('差分一覧の列（全部のファイルを 1 本に。2026-10-20）', () => {
  const kinds = (rows: VirtualRow[]) => rows.map((r) => (r.kind === 'file' ? `file ${r.path}` : r.kind === 'header' ? `header ${r.hunk.id}` : r.kind === 'uni' ? r.base + r.i : r.kind));

  it('heads を渡すと、ファイルが替わる所にファイルの見出しの行を挟む。行の並び（base + i）はファイルごとに 0 から', () => {
    const h = order()[0]!;
    const a1 = { ...h, id: 'a1', path: 'A.kt', lnOld: 1, lnNew: 1, lines: [' x', '+y'] };
    const a2 = { ...h, id: 'a2', path: 'A.kt', lnOld: 20, lnNew: 21, lines: ['-p'] };
    const b1 = { ...h, id: 'b1', path: 'B.kt', lnOld: 5, lnNew: 5, lines: [' q', '+r'] };
    expect(kinds(buildRows([a1, a2, b1], 'uni', true))).toEqual(['file A.kt', 'header a1', 0, 1, 'header a2', 2, 'file B.kt', 'header b1', 0, 1]);
    // heads を渡さなければ今までと同じ（1 ファイルの画面）
    expect(buildRows([a1, a2], 'uni')).toEqual(buildRows([a1, a2], 'uni', true).slice(1));
  });

  it('どの行の並びも、案内人の答えの「メモにする」が差分一覧で選び直す数（pickFor）と同じ', () => {
    const analysis = fixtureAnalysis();
    const hunks = groupFiles(analysis.hunks, []).flatMap((f) => f.hunks);
    const rows = buildRows(hunks, 'uni', true).filter((r) => r.kind === 'uni');
    expect(new Set(rows.map((r) => r.hunk.path)).size).toBe(37);
    for (const r of rows) {
      const at = r.t === 'r' ? { side: 'base' as const, line: r.lnOld! } : { side: 'head' as const, line: r.lnNew! };
      expect(pickFor(analysis, { kind: 'diff', hunks }, { path: r.hunk.path, start: at, end: at })?.anchor.order).toBe(r.base + r.i);
    }
  });

  it('メモ・AI の下書き・書く枠は、同じ行番号の別のファイルではなく自分のファイルの行の下に出る', () => {
    const h = order()[0]!;
    const a = { ...h, id: 'a', path: 'A.kt', lnOld: 1, lnNew: 1, lines: [' x', '+y'] };
    const b = { ...h, id: 'b', path: 'B.kt', lnOld: 1, lnNew: 1, lines: [' x', '+y'] };
    const note = (id: string, path: string, source = 'reviewer'): CommentDraft => ({ id, path, line: 2, side: 'RIGHT', body: id, source, state: 'adopted' });
    const pick: MemoPick = { path: 'B.kt', anchor: { side: 'RIGHT', line: 1, order: 0 }, head: { side: 'RIGHT', line: 1, order: 0 } };
    const rows = withMemos(buildRows([a, b], 'uni', true), [note('ma', 'A.kt'), note('db', 'B.kt', 'codex')], pick);
    const item = (x: MemoItem) => (x.kind === 'new' ? 'new' : x.kind === 'draft' ? `ai:${x.draft.id}` : x.memo.id);
    expect(rows.map((r) => (r.kind === 'memo' ? `memo ${r.hunk.path} ${[...r.left, ...r.right].map(item)}` : r.kind === 'uni' ? `${r.hunk.path}:${r.lnNew}` : r.kind))).toEqual([
      'file', 'header', 'A.kt:1', 'A.kt:2', 'memo A.kt ma',
      'file', 'header', 'B.kt:1', 'memo B.kt new', 'B.kt:2', 'memo B.kt ai:db',
    ]);
  });

  it('帯はファイルの見出しをまたがず、ファイルごとの最後の帯は末尾（↓ だけ）', () => {
    const h = order()[0]!;
    const ctx = (n: number) => Array.from({ length: n }, (_, k) => ` c${k}`);
    const a = { ...h, id: 'a', path: 'A.kt', lnOld: 1, lnNew: 1, lines: ['+x', ...ctx(10)] };
    const b = { ...h, id: 'b', path: 'B.kt', lnOld: 1, lnNew: 1, lines: ['+x', ...ctx(10)] };
    const rows = foldVirtual(buildRows([a, b], 'uni', true), new Set(), false);
    expect(rows.map((r) => (r.kind === 'fold' ? `[${r.path} ${r.keys.length}${r.bottom ? ' bottom' : ''}]` : r.kind === 'uni' ? r.i : r.kind))).toEqual([
      'file', 'header', 0, 1, 2, 3, '[A.kt 7 bottom]',
      'file', 'header', 0, 1, 2, 3, '[B.kt 7 bottom]',
    ]);
  });
});

describe('withMemos', () => {
  const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
  const memo = (id: string, line: number, side: 'LEFT' | 'RIGHT', over: Partial<CommentDraft> = {}): CommentDraft => ({ id, path: ORDER, line, side, body: id, source: 'reviewer', state: 'adopted', ...over });
  // fixture の Order.kt（1 つの塊）に、見本と同じ 4 件。base 8・base 10 は消した行、8〜11・13 は足した行
  const memos = [memo('m1', 8, 'LEFT'), memo('m2', 11, 'RIGHT', { startLine: 8, startSide: 'RIGHT' }), memo('m3', 10, 'LEFT'), memo('m4', 13, 'RIGHT')];
  const item = (x: MemoItem) => (x.kind === 'new' ? 'new' : x.kind === 'draft' ? `ai:${x.draft.id}` : x.memo.id);
  const shape = (rows: VirtualRow[]) =>
    rows.map((r) => (r.kind === 'memo' ? `memo L[${r.left.map(item)}] R[${r.right.map(item)}]` : r.kind === 'sbs' ? `${r.o?.ln ?? '-'}|${r.n?.ln ?? '-'}` : r.kind === 'uni' ? `${r.lnOld ?? '-'}|${r.lnNew ?? '-'}` : 'header'));

  it('左右: 消した行のメモは左、足した行・変わらない行のメモは右。同じ段の左右は 1 つのメモの行に並ぶ', () => {
    expect(shape(withMemos(buildRows(order(), 'sbs'), memos, null))).toEqual([
      'header', '3|3', '4|4', '5|5', '6|6', '7|7', '8|8', 'memo L[m1] R[]', '-|9', '-|10', '-|11', 'memo L[] R[m2]', '9|12', '10|13', 'memo L[m3] R[m4]', '11|14',
    ]);
  });

  it('統合: その行の下に 1 つずつ', () => {
    const out = shape(withMemos(buildRows(order(), 'uni'), memos, null));
    expect(out.slice(out.indexOf('8|-'), out.indexOf('8|-') + 2)).toEqual(['8|-', 'memo L[m1] R[]']);
    expect(out.slice(out.indexOf('-|11'), out.indexOf('-|11') + 2)).toEqual(['-|11', 'memo L[] R[m2]']);
    expect(out.slice(out.indexOf('10|-'), out.indexOf('10|-') + 2)).toEqual(['10|-', 'memo L[m3] R[]']);
  });

  it('書く枠は選んだ範囲の最後の行の下、その行の側に。保存したメモの後', () => {
    const at = (side: 'LEFT' | 'RIGHT', line: number, ord: number) => ({ side, line, order: ord });
    // base 8 行目（lines の 6）から head 13 行目（lines の 13）まで。最後の行は右
    const pick: MemoPick = { path: ORDER, anchor: at('LEFT', 8, 6), head: at('RIGHT', 13, 13) };
    const out = shape(withMemos(buildRows(order(), 'sbs'), [memo('m4', 13, 'RIGHT')], pick));
    expect(out).toContain('memo L[] R[m4,new]');
    expect(shape(withMemos(buildRows(order(), 'sbs'), [], { path: ORDER, anchor: at('LEFT', 10, 12), head: at('LEFT', 10, 12) }))).toContain('memo L[new] R[]');
  });

  it('AI の下書きも差し込む（破棄した物も 1 行にたたんで出すので入れる）。同じ行では 自分のメモ → 下書き → 書く枠', () => {
    const ai = (id: string, line: number, side: 'LEFT' | 'RIGHT', state: CommentDraft['state'] = 'draft') => memo(id, line, side, { source: 'codex', state });
    const at = (side: 'LEFT' | 'RIGHT', line: number, ord: number) => ({ side, line, order: ord });
    const pick: MemoPick = { path: ORDER, anchor: at('RIGHT', 13, 13), head: at('RIGHT', 13, 13) };
    const comments = [ai('d1', 13, 'RIGHT'), memo('m4', 13, 'RIGHT'), ai('d2', 8, 'LEFT', 'discarded'), ai('d3', 11, 'RIGHT', 'adopted')];
    const sbs = shape(withMemos(buildRows(order(), 'sbs'), comments, pick));
    expect(sbs).toContain('memo L[ai:d2] R[]');
    expect(sbs).toContain('memo L[] R[ai:d3]');
    expect(sbs).toContain('memo L[] R[m4,ai:d1,new]');
    const uni = shape(withMemos(buildRows(order(), 'uni'), comments, null));
    expect(uni.slice(uni.indexOf('8|-'), uni.indexOf('8|-') + 2)).toEqual(['8|-', 'memo L[ai:d2] R[]']);
  });

  it('別のファイルの選んだ行とメモ、消したメモは差し込まない', () => {
    const other = { ...memo('x', 13, 'RIGHT'), path: 'other.kt' };
    const pick: MemoPick = { path: 'other.kt', anchor: { side: 'RIGHT', line: 13, order: 13 }, head: { side: 'RIGHT', line: 13, order: 13 } };
    const rows = buildRows(order(), 'sbs');
    expect(withMemos(rows, [other, memo('d', 13, 'RIGHT', { state: 'discarded' })], pick)).toEqual(rows);
  });
});

describe('foldVirtual（変わった行から離れた行を帯にまとめる。2026-10-13）', () => {
  const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
  const ctx = (n: number, from: number) => Array.from({ length: n }, (_, k) => ` c${from + k}`);
  // 変わらない行 10 → 消した行 → 足した行 → 変わらない行 10（lines の 0〜9、10、11、12〜21）
  const big = () => ({ ...order()[0]!, id: 'h1', lnOld: 1, lnNew: 1, lines: [...ctx(10, 0), '-b', '+c', ...ctx(10, 12)] });
  const shape = (rows: VirtualRow[]) =>
    rows.map((r) => (r.kind === 'fold' ? `[${r.keys.length}${r.top ? ' top' : ''}${r.bottom ? ' bottom' : ''}]` : r.kind === 'uni' ? r.i : r.kind === 'sbs' ? `${r.o?.i ?? '-'}|${r.n?.i ?? '-'}` : r.kind === 'memo' ? 'memo' : r.kind));

  it('統合: 変わった行の前後 3 行を残し、離れた行は帯。帯は隠れた行の key（hunk の id と lines の位置）とファイルを持つ', () => {
    const rows = foldVirtual(buildRows([big()], 'uni'), new Set(), false);
    expect(shape(rows)).toEqual(['header', '[7]', 7, 8, 9, 10, 11, 12, 13, 14, '[7 bottom]']);
    expect(rows[1]).toEqual({ kind: 'fold', path: ORDER, keys: ['h1:0', 'h1:1', 'h1:2', 'h1:3', 'h1:4', 'h1:5', 'h1:6'], top: false, bottom: false });
  });

  it('左右: 帯の key は統合と同じ（切り替えても開いた行はそのまま）', () => {
    const open = new Set(['h1:5', 'h1:6']);
    const rows = foldVirtual(buildRows([big()], 'sbs'), open, false);
    expect(shape(rows)).toEqual(['header', '[5]', '5|5', '6|6', '7|7', '8|8', '9|9', '10|11', '12|12', '13|13', '14|14', '[7 bottom]']);
    expect(shape(foldVirtual(buildRows([big()], 'uni'), open, false)).slice(0, 4)).toEqual(['header', '[5]', 5, 6]);
  });

  it('すべて表示なら畳まない', () => {
    expect(foldVirtual(buildRows([big()], 'uni'), new Set(), true)).toEqual(buildRows([big()], 'uni'));
  });

  it('メモ・AI の下書きの行は畳まない（その行の前後 3 行も残す）', () => {
    const draft: CommentDraft = { id: 'd1', path: ORDER, line: 2, side: 'RIGHT', body: 'x', source: 'codex', state: 'draft' };
    const rows = foldVirtual(withMemos(buildRows([big()], 'uni'), [draft], null), new Set(), false);
    expect(shape(rows)).toEqual(['header', 0, 1, 'memo', 2, 3, 4, '[2]', 7, 8, 9, 10, 11, 12, 13, 14, '[7 bottom]']);
  });

  it('keep に当たる行（案内人の答えの行）も畳まない', () => {
    const rows = foldVirtual(buildRows([big()], 'uni'), new Set(), false, (r) => r.kind === 'uni' && r.i === 20);
    expect(shape(rows)).toEqual(['header', '[7]', 7, 8, 9, 10, 11, 12, 13, 14, '[2]', 17, 18, 19, 20, 21]);
  });

  it('帯は見出しをまたがない', () => {
    const b = { ...big(), id: 'h2', lnOld: 40, lnNew: 40 };
    expect(shape(foldVirtual(buildRows([big(), b], 'uni'), new Set(), false))).toEqual([
      'header', '[7]', 7, 8, 9, 10, 11, 12, 13, 14, '[7]',
      'header', '[7]', 7, 8, 9, 10, 11, 12, 13, 14, '[7 bottom]',
    ]);
  });

  it('ファイル全体（目的ごとのプレビュー）: 差分の外の行は key が head 側の行番号。ファイルの先頭の帯は top', () => {
    const PATH = 'src/main/kotlin/com/example/order/infra/OrderRepositoryImpl.kt';
    const file = fixtureFiles([PATH])[0]!;
    const hunks = fixtureHunks().filter((h) => h.path === PATH);
    const rows = foldVirtual(buildFileRows(file, hunks, 'uni'), new Set(), false);
    const first = rows[0]!;
    expect(first.kind).toBe('fold');
    if (first.kind !== 'fold') return;
    expect(first.top).toBe(true);
    expect(first.keys[0]).toBe('n1');
    expect(first.path).toBe(PATH);
  });
});
