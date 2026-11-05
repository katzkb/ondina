// diff 列の本体。選択ファイルの全 hunk を 1 本の仮想リストで描く（設計書 18.4 / 18.5）。
// hunk ヘッダの要素 id は hunk-<id>（View Transitions の共有要素の前提）。
// メモ（3.3 / 3.4）: memo を渡した画面（差分一覧）だけ、行番号の「+」を押して行を選び（押したまま上下になぞると範囲）、離すと選んだ最後の行の下に書く枠を開く。
// 保存したメモもその行の下に残る。左右表示ではその行の側の列の下（base 側は左、head 側は右。2026-10-06。見本を比べて決めた）。
// AI の下書きもメモと同じ所に箱で出す（2026-10-13）。
// 目的ごとの画面のプレビュー（3.2）: file（head の全文）を渡すと、ファイル全体に差分を埋め込んで描き、選んだ差分の見出しを一番上に合わせる。
// 選んだ差分の行は行番号の左に紫の線（cur）。2026-10-08。見本を比べて決めた。
// 変わった行から離れた行は帯にまとめる（2026-10-13。rows.ts の foldVirtual）。メモ・AI の下書き・案内人の答えの行は畳まない。
// 差分一覧（3.4）は jump を渡し、全部のファイルを 1 本の列にする（2026-10-20。GitHub と同じく、ファイルをまたいでスクロールする）:
// ファイルごとの見出しの行と、一番上に貼り付く今のファイルの見出し。見えている範囲は diff.viewport で reducer に知らせ、スクロールは jump.n が進んだときだけ。
// 列の中の検索（⌘F。2026-10-27。diff/find.ts）: 画面の外の行と帯に畳んだ行は DOM に無く、ブラウザのページ内検索では見つからないので、畳む前の行列から探す。
// 今の 1 件の行は帯から出し（案内人の答えの行と同じく畳まない）、真ん中へスクロールする。見つけた所は mark で囲む。
// 行の中の変わった語（2026-10-30。diff/wordDiff.ts）: 左右表示と同じ組の消した行と足した行で、変わった所を濃く塗る（統合でも同じ組）。
import type { CommentDraft, FileText, GithubDiffFile, Hunk } from '@ondina/model';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Command } from '../commands/commands.js';
import { DraftBox, LineMark, MemoEditor, MemoHoldSpace, MemoSaved } from '../components/MemoBox.js';
import { hunkAt } from '../files.js';
import { isMemo, pickRange, pickSpan } from '../memo.js';
import type { DiffJump, FindUi, FocusLine, MemoUi } from '../state/reducer.js';
import { flashClass, litBy } from './FileView.js';
import type { Side } from './alignRows.js';
import { curIndex, findHits, marksByRow, type FindCell, type FindMark } from './find.js';
import { bodyStart, FILE_HEAD_H, layoutOf, revealPlan, stickyOf, viewportOf } from './follow.js';
import { FoldBand } from './FoldBand.js';
import { FindBar } from './FindBar.js';
import { buildFileRows, buildRows, foldVirtual, withMemos, type DiffMode, type MemoItem, type VirtualRow } from './rows.js';
import { Marked, TokenSpans } from './TokenSpans.js';
import { wordDiff } from './wordDiff.js';
import { courseBg, OUTSIDE } from '../course.js';

/** メモを書ける画面が渡す物（FileView の memo と同じ形） */
export interface DiffMemo {
  comments: readonly CommentDraft[];
  ui: MemoUi;
  githubDiff: readonly GithubDiffFile[] | undefined;
  /** AI の下書きを直している途中の文（AppState.draftText） */
  draftText: Readonly<Record<string, string>>;
}

export interface DiffListProps {
  hunks: readonly Hunk[];
  mode: DiffMode;
  viewed: readonly string[];
  selectedHunk: string | null;
  dispatch: (command: Command) => void;
  /** メモを書ける画面（差分一覧）だけが渡す。無ければ「+」もメモも出さない */
  memo?: DiffMemo;
  /** 案内人の答えの行の場所で来た行（3.10）。その行までスクロールして光らせる */
  focusLine?: FocusLine | null;
  /** そのファイルの head の全文。渡すとファイル全体に差分を埋め込む（目的ごとの画面のプレビュー。3.2）。hunks はそのファイルの差分全部 */
  file?: FileText | undefined;
  /** 帯で開いた行の key（AppState.fold のそのファイルの分） */
  open?: readonly string[] | undefined;
  /** すべて表示（F）。帯を出さない */
  full?: boolean;
  /**
   * 差分一覧だけが渡す（AppState.diffJump）。渡すと hunks は全部のファイルの差分で、ファイルの見出しの行と貼り付く見出しを出し、
   * 見えている範囲を diff.viewport で知らせる。スクロールは jump.n が進んだときだけ（選んだ差分が変わっただけでは動かさない）。
   * 渡さなければ今までどおり selectedHunk の変化で動く（目的ごとの画面のプレビュー・コース）
   */
  jump?: DiffJump;
  /** 列の中の検索（AppState.find）。渡した画面（差分一覧・目的ごとの画面のプレビュー）だけ、開いていれば検索欄を出す */
  find?: FindUi | undefined;
}

/** 行の場所ごとの検索の印 */
type RowMarks = Partial<Record<FindCell, FindMark[]>>;

/** 差分一覧に出ない行（hunk の外）の自分のメモと AI の下書き（行の上から） */
interface Outside {
  memos: CommentDraft[];
  drafts: CommentDraft[];
}

const KIND_LABEL: Record<Exclude<Hunk['kind'], 'none'>, string> = { core: '核', ripple: '追従', test: 'テスト' };

/** 種別チップ（設計書 3.4、8 章）。差異ありは代表の形と違う hunk（画面では語の数を出さない）、近いものは赤。種別のない hunk はチップを出さない（どのコースにも入らないことは「外」の丸で出す） */
function kindChip(hunk: Hunk): { label: string; danger: boolean } | null {
  const g = hunk.group;
  if (hunk.kind === 'ripple' && g?.deviations.includes(hunk.id)) {
    return { label: '差異あり', danger: g.near.includes(hunk.id) };
  }
  if (hunk.kind === 'none') return null;
  // テストの見分けが構成の推定から来たものは（推定）（5.2 の 7。原則 2）
  return { label: hunk.kind === 'test' && hunk.kindProvenance === 'llm' ? 'テスト（推定）' : KIND_LABEL[hunk.kind], danger: false };
}

/** 仮想リストの行の鍵。メモの行を差し込んでも、他の行の鍵（測った高さ）は変わらない */
function rowKey(r: VirtualRow): string {
  if (r.kind === 'file') return `fh-${r.path}`;
  if (r.kind === 'header') return `h-${r.hunk.id}`;
  if (r.kind === 'memo') return r.key;
  if (r.kind === 'uni') return `u-${r.hunk.id}-${r.i}`;
  if (r.kind === 'ctx') return `c-${r.lnOld}-${r.lnNew}`;
  if (r.kind === 'fold') return `f-${r.keys[0]}`;
  return `s-${r.hunk.id}-${r.o?.i ?? ''}-${r.n?.i ?? ''}`;
}

/** 行の場所（3.10）が指す行か。消した行は base 側（LEFT）、他は head 側（RIGHT） */
function litRow(r: VirtualRow, f: FocusLine | null): boolean {
  if (f === null || r.kind === 'file' || r.kind === 'header' || r.kind === 'memo' || r.kind === 'fold') return false;
  if (r.kind === 'ctx') return litBy(f, r.path, 'RIGHT', r.lnNew);
  if (r.kind === 'uni') return r.t === 'r' ? litBy(f, r.hunk.path, 'LEFT', r.lnOld) : litBy(f, r.hunk.path, 'RIGHT', r.lnNew);
  return (r.o !== null && r.o.t === 'r' && litBy(f, r.hunk.path, 'LEFT', r.o.ln)) || (r.n !== null && litBy(f, r.hunk.path, 'RIGHT', r.n.ln));
}

/** 「開く」で来たメモ・AI の下書きの行か */
const hasMemo = (r: VirtualRow, id: string) => r.kind === 'memo' && [...r.left, ...r.right].some((x) => (x.kind === 'saved' && x.memo.id === id) || (x.kind === 'draft' && x.draft.id === id));

/** なめらかに動かす距離の上限（画面の高さの何枚分か）。遠い所へは一瞬で移る（長いファイルで 1 秒を超えて待たせない） */
const SMOOTH_SCREENS = 2;

/** なめらかなスクロールを控える設定か（jsdom には matchMedia が無い） */
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function DiffList({ hunks, mode, viewed, selectedHunk, dispatch, memo, focusLine = null, file, open, full = false, jump, find }: DiffListProps) {
  const list = jump !== undefined;
  const base = useMemo(() => (file ? buildFileRows(file, hunks, mode) : buildRows(hunks, mode, list)), [hunks, mode, file, list]);
  const comments = memo?.comments;
  const pick = memo?.ui.pick ?? null;
  // なぞっている間は書く枠を差し込まない（差し込むと下の行がずれて、なぞる先がずれる）。押したとき開いていた書く枠の場所には同じ高さの空きを出す（MemoUi.hold）
  const editAt = memo?.ui.drag ? (memo.ui.hold?.pick ?? null) : pick;
  const opened = useMemo(() => new Set(open ?? []), [open]);
  // 検索は畳む前の行列から（帯の中の行も探す）。閉じている間は印を出さない
  const query = find?.open ? find.query : '';
  const hits = useMemo(() => findHits(base, query), [base, query]);
  const cur = curIndex(find?.at ?? 0, hits.length);
  const curRow = cur < 0 ? null : hits[cur]!.row;
  const marks = useMemo(() => marksByRow(hits, cur), [hits, cur]);
  // 畳むのはメモの行を差し込んだ後（メモの行とその前後を残す）。スクロールの効果は base を見るので、帯を開いても選んだ hunk へ跳び直さない
  const rows = useMemo(
    () => foldVirtual(comments ? withMemos(base, comments, editAt) : base, opened, full, (r) => r === curRow || litRow(r, focusLine)),
    [base, comments, editAt, opened, full, focusLine, curRow],
  );
  const layout = useMemo(() => layoutOf(rows), [rows]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i]!.kind === 'file' ? FILE_HEAD_H : rows[i]!.kind === 'header' ? 34 : rows[i]!.kind === 'memo' ? 96 : rows[i]!.kind === 'fold' ? 30 : 21),
    getItemKey: (i) => rowKey(rows[i]!),
    overscan: 24,
    // 差分一覧は貼り付く見出しの下に揃える（ファイルの最初の行を start に揃えると、ファイルの見出しの行がちょうど一番上に来る）
    scrollPaddingStart: list ? FILE_HEAD_H : 0,
  });
  // スクロールの効果は、メモの行を足し引きしたとき（行を選ぶ・保存する）には走らせない。その時点の行は ref から読む
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // 前にスクロールしたときの行列。同じなら（同じファイルの中で選び替えた）なめらかに動かす
  const scrolledBase = useRef<VirtualRow[] | null>(null);

  useEffect(() => {
    if (list || selectedHunk === null) return;
    const i = rowsRef.current.findIndex((r) => r.kind === 'header' && r.hunk.id === selectedHunk);
    if (i < 0) return;
    if (!file) {
      virtualizer.scrollToIndex(i, { align: 'auto' });
      return;
    }
    // ファイル全体: 見出しを一番上に（ファイルの終わりに近ければ終わりで止まる）。
    // 同じファイルの中で近くへ選び替えたときだけなめらかに。ファイル・左右と統合を替えたとき、遠い所へは一瞬で
    const target = virtualizer.getOffsetForIndex(i, 'start')?.[0];
    const near = target !== undefined && Math.abs(target - (virtualizer.scrollOffset ?? 0)) <= (virtualizer.scrollRect?.height ?? 0) * SMOOTH_SCREENS;
    const smooth = scrolledBase.current === base && near && !reducedMotion();
    scrolledBase.current = base;
    virtualizer.scrollToIndex(i, { align: 'start', ...(smooth ? { behavior: 'smooth' as const } : {}) });
    // base が変わったとき（ファイル切替・左右と統合の切替）も選んだ hunk まで戻す
  }, [selectedHunk, base, virtualizer, file, list]);

  // 差分一覧: reducer の合図（jump.n が進んだとき）でだけ動かす。スクロールに付いてきた選びでは動かさない（選んだ見出しへ引き戻さない）
  const jumpN = jump?.n;
  useEffect(() => {
    if (!jump) return;
    const i = rowsRef.current.findIndex((r) => r.kind === 'header' && r.hunk.id === jump.hunkId);
    const plan = i < 0 ? null : revealPlan(i, jump.to, bodyStart(layoutRef.current, i), virtualizer.getOffsetForIndex);
    if (plan) virtualizer.scrollToIndex(plan.index, { align: plan.align });
  }, [jumpN, virtualizer]);

  /** 行 i を真ん中へ。差分一覧ではファイルの頭より上を出さない（前のファイルの末尾を一番上に残さない） */
  const center = (i: number) => {
    const plan = list ? revealPlan(i, 'line', bodyStart(layoutRef.current, i), virtualizer.getOffsetForIndex) : ({ index: i, align: 'center' } as const);
    if (plan) virtualizer.scrollToIndex(plan.index, { align: plan.align });
  };

  // 締めの「開く」で来たメモ（focus）は、その行まで。hunk の見出しへのスクロールより後に走らせる
  const focus = memo?.ui.focus ?? null;
  useEffect(() => {
    if (focus === null) return;
    const i = rowsRef.current.findIndex((r) => hasMemo(r, focus));
    if (i >= 0) center(i);
  }, [focus, virtualizer]);

  // 案内人の答えの行の場所で来た行も、その行まで
  useEffect(() => {
    if (focusLine === null) return;
    const i = rowsRef.current.findIndex((r) => litRow(r, focusLine));
    if (i >= 0) center(i);
  }, [focusLine, base, virtualizer]);

  // 検索の今の 1 件の行を真ん中へ（文字を替えた・次へ / 前へ・開き直した・左右と統合を替えたとき）
  useEffect(() => {
    if (curRow === null) return;
    const i = rowsRef.current.indexOf(curRow);
    if (i >= 0) center(i);
  }, [curRow, find?.at, find?.n, virtualizer]);

  // 差分一覧: 一番上のファイルと見えている差分を reducer に知らせる（描くたび。中身が変わったときだけ）。スクロールより後に走らせる。
  // 位置は DOM の scrollTop（scrollTo の直後でも今の値）と、描くのに使った行の位置。reached = 行き先を画面に出し終えた jump の番号
  const reached = useRef(-1);
  const sent = useRef('');
  useEffect(() => {
    const el = parentRef.current;
    if (!jump || !el) return;
    const seen = viewportOf(layout, virtualizer.measurementsCache, { offset: el.scrollTop, height: el.clientHeight, total: virtualizer.getTotalSize() }, selectedHunk);
    if (!seen) return;
    const target = jump.hunkId;
    // 行き先が列に無ければ（解析を読み直した・差分が無い）出し終えたことにする（付いてくる選びを止めたままにしない）
    if (target === null || seen.hunks.includes(target) || !layout.owners.some((o) => o.hunk === target)) reached.current = jump.n;
    const key = `${seen.file}|${seen.hunks.join(' ')}|${reached.current}`;
    if (key === sent.current) return;
    sent.current = key;
    dispatch({ id: 'diff.viewport', file: seen.file, hunks: seen.hunks, n: reached.current });
  });

  // 貼り付く見出し（差分一覧）: どのファイルかも押し上げも、描いた後（行を測り直した後）の行の位置と DOM の scrollTop から決める。
  // 描く最中の位置は測り直す前のことがあり、左右と統合を替えた直後に前のファイルの名前が残った。押し上げは 1 px ごとに React で描き直さず style を替え、ファイルが替わったときだけ描き直す
  const [stuckPath, setStuckPath] = useState<string | null>(null);
  const stuck = list && stuckPath !== null ? { path: stuckPath, head: layout.heads.find((h) => layout.owners[h]!.path === stuckPath) } : null;
  const stickRef = useRef<HTMLDivElement>(null);
  const pushUp = useCallback(() => {
    // 位置は DOM の scrollTop（仮想リストの scroll の処理より先に呼ばれても今の値）
    const s = stickyOf(layoutRef.current, (i) => virtualizer.measurementsCache[i]?.start ?? 0, parentRef.current?.scrollTop ?? 0);
    if (stickRef.current) stickRef.current.style.transform = `translateY(${s?.shift ?? 0}px)`;
    setStuckPath(s?.path ?? null);
  }, [virtualizer]);
  useLayoutEffect(pushUp);
  useEffect(() => {
    const el = parentRef.current;
    if (!list || !el) return;
    el.addEventListener('scroll', pushUp, { passive: true });
    return () => el.removeEventListener('scroll', pushUp);
  }, [list, pushUp]);

  // 差分一覧に出ない行の自分のメモと AI の下書き（ファイルごと）。ファイルの見出しに「差分の外の… n」と出す（黙って隠さない。2026-10-06 / 10-13）
  const outside = useMemo(() => {
    const out = new Map<string, Outside>();
    if (!list) return out;
    for (const c of [...(comments ?? [])].sort((a, b) => a.line - b.line)) {
      if (c.state === 'discarded' || hunkAt(hunks, c.path, c.line, c.side)) continue;
      const o = out.get(c.path) ?? { memos: [], drafts: [] };
      (isMemo(c) ? o.memos : o.drafts).push(c);
      out.set(c.path, o);
    }
    return out;
  }, [list, comments, hunks]);

  const viewedSet = useMemo(() => new Set(viewed), [viewed]);
  const span = pick ? pickSpan(pick) : null;
  // 左右表示では、範囲の始まりか終わりの側の列だけに色を付ける（head 側どうしの範囲なら、間の消した行は塗らない）。並びはファイルごとなので path も見る
  const inSpan = (path: string, order: number, side?: 'LEFT' | 'RIGHT') =>
    span !== null && path === pick?.path && order >= span.start.order && order <= span.end.order && (side === undefined || side === span.start.side || side === span.end.side);

  return (
    <div className="dscroll" ref={parentRef}>
      {stuck && (
        // 仮想行の外に重ねる（高さ 0 で貼り付き、行の並びに触らない）
        <div className="dstick">
          <div ref={stickRef}>
            <FileHead path={stuck.path} outside={outside.get(stuck.path)} marks={stuck.head === undefined ? undefined : marks.get(rows[stuck.head]!)?.path} dispatch={dispatch} />
          </div>
        </div>
      )}
      {find?.open && <FindBar label="差分の中を検索" find={find} count={hits.length} cur={cur} below={list} dispatch={dispatch} />}
      <div className="dbody" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index]!;
          const m = marks.get(row);
          // 貼り付いている見出しの本物の行は、重ねた見出しの下（見えない所）にあるので隠す（同じボタンを 2 つ出さない）
          const under = stuck?.head === v.index ? { visibility: 'hidden' as const } : {};
          return (
            <div key={v.key} className="vrow" data-index={v.index} ref={virtualizer.measureElement} style={{ transform: `translateY(${v.start}px)`, ...under }}>
              {row.kind === 'file' ? (
                <FileHead path={row.path} outside={outside.get(row.path)} marks={m?.path} dispatch={dispatch} />
              ) : row.kind === 'header' ? (
                <Header hunk={row.hunk} viewed={viewedSet.has(row.hunk.id)} selected={row.hunk.id === selectedHunk} marks={m?.head} dispatch={dispatch} />
              ) : row.kind === 'memo' ? (
                memo && <MemoRow row={row} mode={mode} memo={memo} dispatch={dispatch} />
              ) : row.kind === 'fold' ? (
                <div className={`diff ${mode}`}>
                  <FoldBand path={row.path} fold={row} dispatch={dispatch} />
                </div>
              ) : row.kind === 'ctx' ? (
                <CtxLine row={row} mode={mode} lit={litRow(row, focusLine) ? flashClass(focusLine!) : ''} marks={m} />
              ) : (
                <Line row={row} inSpan={inSpan} dispatch={memo ? dispatch : null} githubDiff={memo?.githubDiff} drag={memo?.ui.drag ?? false} lit={litRow(row, focusLine) ? flashClass(focusLine!) : ''} cur={file !== undefined && row.hunk.id === selectedHunk} marks={m} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** ファイルの見出し（差分一覧の列の行と、一番上に貼り付く見出し）。パスと、差分一覧に出ない行のメモ・AI の下書きの数（押すと 1 件目を、その行が見えるコースの画面で開く） */
function FileHead({ path, outside, marks, dispatch }: { path: string; outside: Outside | undefined; marks?: FindMark[] | undefined; dispatch: (c: Command) => void }) {
  const memos = outside?.memos ?? [];
  const drafts = outside?.drafts ?? [];
  return (
    <div className="fh">
      <b title={path}>{marks ? <Marked pieces={[[path, null, 0]]} marks={marks} /> : path}</b>
      <span className="sp">
        {memos.length > 0 && (
          <button type="button" className="btn sm mout" title="差分一覧に出ない行（変更から離れた行）のメモ。押すと、その行が見えるコースの画面で開く" onClick={() => dispatch({ id: 'comment.open', commentId: memos[0]!.id })}>
            {`差分の外のメモ ${memos.length}`}
          </button>
        )}
        {drafts.length > 0 && (
          <button type="button" className="btn sm mout ai" title="差分一覧に出ない行（変更から離れた行）の AI の下書き。押すと、その行が見えるコースの画面で開く" onClick={() => dispatch({ id: 'comment.open', commentId: drafts[0]!.id })}>
            {`差分の外の下書き ${drafts.length}`}
          </button>
        )}
      </span>
    </div>
  );
}

function Header({ hunk, viewed, selected, marks, dispatch }: { hunk: Hunk; viewed: boolean; selected: boolean; marks?: FindMark[] | undefined; dispatch: (c: Command) => void }) {
  const chip = kindChip(hunk);
  return (
    <div id={`hunk-${hunk.id}`} className={`hh${selected ? ' on' : ''}`} onClick={() => dispatch({ id: 'hunk.select', hunkId: hunk.id })}>
      @@ {marks ? <Marked pieces={[[hunk.symbol, null, 0]]} marks={marks} /> : hunk.symbol}
      <span className="sp">
        {/* コースの色の丸（How の id）。どのコースにも入らなければ赤い「外」 */}
        {hunk.hows.length === 0 ? (
          <span className="cb sm cc0" style={courseBg(OUTSIDE)}>外</span>
        ) : (
          hunk.hows.map((n) => (
            <span key={n} className={`cb sm cc${n}`} style={courseBg(n)}>
              {n}
            </span>
          ))
        )}
        {chip && <span className={`chip${chip.danger ? ' d' : ''}`}>{chip.label}</span>}
        {/* 「問題なし」は見た印（v と同じトグル）。承認ではない（原則 8） */}
        <button
          type="button"
          className={`btn sm okmark${viewed ? ' on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            dispatch({ id: 'hunk.markViewed', hunkId: hunk.id });
          }}
        >
          {viewed ? '問題なし ✓' : '問題なし'}
        </button>
      </span>
    </div>
  );
}

/** hunk の外の行（ファイル全体のとき）。左右では同じ行を両側に。名前から定義へ（3.6）は head 側の行で、押した行が戻り先 */
function CtxLine({ row, mode, lit, marks }: { row: Extract<VirtualRow, { kind: 'ctx' }>; mode: DiffMode; lit: string; marks: RowMarks | undefined }) {
  const code = (
    <div className="cd">
      <TokenSpans line=" " tokens={row.tokens} marks={marks?.code} at={{ side: 'head', path: row.path, line: row.lnNew, back: { path: row.path, side: 'RIGHT', line: row.lnNew } }} />
    </div>
  );
  if (mode === 'uni') {
    return (
      <div className={`diff uni${lit}`}>
        <div className="ln">{row.lnOld}</div>
        <div className="ln">{row.lnNew}</div>
        {code}
      </div>
    );
  }
  return (
    <div className={`diff sbs${lit}`}>
      <div className="ln">{row.lnOld}</div>
      {code}
      <div className="ln">{row.lnNew}</div>
      {code}
    </div>
  );
}

/**
 * cur = ファイル全体で選んでいる差分の行（左端の行番号に紫の線）。drag = 「+」を押したままなぞっている（入った行まで範囲を伸ばす）。
 * dispatch が無ければ（メモを書けない画面）行番号の印を出さない。githubDiff は印の「+」と「?」を分ける
 */
function Line({
  row,
  inSpan,
  dispatch,
  githubDiff,
  drag,
  lit,
  cur,
  marks,
}: {
  row: Extract<VirtualRow, { kind: 'uni' | 'sbs' }>;
  inSpan: (path: string, order: number, side?: 'LEFT' | 'RIGHT') => boolean;
  dispatch: ((c: Command) => void) | null;
  githubDiff: readonly GithubDiffFile[] | undefined;
  drag: boolean;
  lit: string;
  cur: boolean;
  marks: RowMarks | undefined;
}) {
  const { hunk } = row;
  const mark = cur ? ' cur' : '';
  const dragTo = (side: 'LEFT' | 'RIGHT', line: number | null, order: number) =>
    drag && dispatch && line !== null ? { onMouseEnter: () => dispatch({ id: 'memo.drag', path: hunk.path, side, line, order }) } : {};
  if (row.kind === 'uni') {
    // 消した行は base 側、他は head 側（コースの画面の FileView と同じ決め方）
    const order = row.base + row.i;
    const sel = inSpan(hunk.path, order) ? ' msel' : '';
    const pos = row.t === 'r' ? { side: 'LEFT' as const, line: row.lnOld } : { side: 'RIGHT' as const, line: row.lnNew };
    return (
      <div className={`diff uni${lit}`} {...dragTo(pos.side, pos.line, order)}>
        <div className={`ln ${row.t}${sel}${mark}`}>
          {dispatch && pos.line !== null && <LineMark path={hunk.path} side={pos.side} line={pos.line} order={order} githubDiff={githubDiff} dispatch={dispatch} />}
          {row.lnOld ?? ''}
        </div>
        <div className={`ln ${row.t}${sel}`}>{row.lnNew ?? ''}</div>
        <div className={`cd ${row.t}${sel}`}>
          <TokenSpans line={hunk.lines[row.i]!} tokens={hunk.tokens?.[row.i]} marks={marks?.code} chg={wordDiff(hunk.lines)[row.i]} at={pos.line === null ? undefined : { side: pos.side === 'LEFT' ? 'base' : 'head', path: hunk.path, line: pos.line, back: { path: hunk.path, side: pos.side, line: pos.line } }} />
        </div>
      </div>
    );
  }
  // 左右: 左の「+」は消した行だけ。変わらない行と足した行は右（head 側）。.mside（display: contents）で片側の 2 つのセルを束ね、重ねた側にだけ「+」を出す
  const cell = (s: Side | null, side: 'LEFT' | 'RIGHT') => {
    const m = side === 'LEFT' ? mark : '';
    if (!s) {
      return (
        <div className="mside">
          <div className={`ln x${m}`} />
          <div className="cd x" />
        </div>
      );
    }
    const order = row.base + s.i;
    const writable = side === 'RIGHT' || s.t === 'r';
    const sel = writable && inSpan(hunk.path, order, side) ? ' msel' : '';
    // なぞって入った列の行。左の変わらない行は、右と同じ head 側の行
    const to = writable ? dragTo(side, s.ln, order) : row.n ? dragTo('RIGHT', row.n.ln, row.base + row.n.i) : {};
    // 名前から定義へ（3.6）。左の列の名前は base の定義へ。戻り先は光らせる行（左の変わらない行は右の行）
    const back = writable ? { path: hunk.path, side, line: s.ln } : row.n ? { path: hunk.path, side: 'RIGHT' as const, line: row.n.ln } : undefined;
    const at = { side: side === 'LEFT' ? ('base' as const) : ('head' as const), path: hunk.path, line: s.ln, ...(back ? { back } : {}) };
    return (
      <div className="mside" {...to}>
        <div className={`ln ${s.t}${sel}${m}`}>
          {dispatch && writable && <LineMark path={hunk.path} side={side} line={s.ln} order={order} githubDiff={githubDiff} dispatch={dispatch} />}
          {s.ln}
        </div>
        <div className={`cd ${s.t}${sel}`}>
          <TokenSpans line={hunk.lines[s.i]!} tokens={hunk.tokens?.[s.i]} marks={side === 'LEFT' ? marks?.left : marks?.right} chg={wordDiff(hunk.lines)[s.i]} at={at} />
        </div>
      </div>
    );
  };
  return (
    <div className={`diff sbs${lit}`}>
      {cell(row.o, 'LEFT')}
      {cell(row.n, 'RIGHT')}
    </div>
  );
}

/** メモの行（AI の下書きも）。統合は全幅、左右はその行の側の列の下 */
function MemoRow({ row, mode, memo, dispatch }: { row: Extract<VirtualRow, { kind: 'memo' }>; mode: DiffMode; memo: DiffMemo; dispatch: (c: Command) => void }) {
  const item = (x: MemoItem) => {
    const hold = memo.ui.drag ? memo.ui.hold : undefined;
    if (x.kind === 'new') {
      if (hold) return <MemoHoldSpace key="new" height={hold.height} />;
      const pick = memo.ui.pick!;
      const span = pickRange(pick);
      return <MemoEditor key="new" path={pick.path} span={span} githubDiff={memo.githubDiff} draft={memo.ui.draft} dispatch={dispatch} />;
    }
    if (x.kind === 'draft') return <DraftBox key={x.draft.id} draft={x.draft} text={memo.draftText[x.draft.id]} githubDiff={memo.githubDiff} dispatch={dispatch} />;
    const m = x.memo;
    if (hold?.editing === m.id) return <MemoHoldSpace key={m.id} height={hold.height} />;
    return memo.ui.editing === m.id ? <MemoEditor key={m.id} path={m.path} span={m} memo={m} draft={memo.ui.draft} dispatch={dispatch} /> : <MemoSaved key={m.id} memo={m} githubDiff={memo.githubDiff} dispatch={dispatch} />;
  };
  if (mode === 'uni') return <div className="dmemo uni">{[...row.left, ...row.right].map(item)}</div>;
  return (
    <div className="dmemo sbs">
      <div className="mhalf l">{row.left.map(item)}</div>
      <div className="mhalf r">{row.right.map(item)}</div>
    </div>
  );
}
