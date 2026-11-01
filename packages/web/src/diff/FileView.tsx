// 停留所の画面（設計書 3.3）のコード。ファイル全体（Analysis.files）に差分を埋め込み、見ている場所の変わった行の前後 3 行以外を帯に畳む（F で全体）。
// 帯は差分一覧と同じ（2026-10-13。FoldBand。↓ ↑ で 20 行ずつ）。見ている hunk の中の変わらない行も畳む。
// 今の「前後 3 行」の範囲（foldRows。メモを置く停留所を決める memoPlace と同じ）の中のメモ・AI の下書きの行は畳まない。範囲の外の物は帯に数を出す。
// 全文が無い古い解析では、その hunk だけ（差分の無い停留所は Symbol.excerpt）を出し、全文が無いことを書く（原則 2）。
// メモ（3.3）: 行番号の「+」を押して行を選び（押したまま上下になぞると範囲）、離すと選んだ最後の行のすぐ下に書く枠を開く。保存したメモもその行の下に残る。
// 左右（既定）と統合（2026-10-09）。左右の「+」とメモの置き場所は差分一覧の左右と同じ（消した行は左、他は右。メモはその行の側の列の下）。
// AI の下書きもメモと同じ所に箱で出す（2026-10-13）。同じ行では メモ → 下書き → 書く枠。
// 読む場所（places。2026-10-19）: コースでこのファイルに 2 か所以上あれば、ほかの場所の変わった行も畳まずに薄く出し、各場所の最初の行の行番号の左に読む順の番号の丸。
// 帯に「このファイルの n / m か所目」。同じファイルの中で場所を移るときは、開き直さずなめらかにスクロールする（見本を比べて決めた。左は 1 ファイル 1 行）。
// 覗いているファイル（all。2026-10-20）: そのファイルの差分を全部見ている場所にする（どの差分も薄くしない。差分一覧の右と同じ見え方）。
// 確かめることの根拠の行（marks。2026-10-22）: head 側の行（左右では右の列）の背景を光らせ、各文の最初の行の行番号に文の番号の丸。畳まない。
// 選んでいる文があれば、その文の行だけ濃く（ほかは薄く）。
// 名前から定義へ（3.6。2026-10-29）: DefLinks で包んだ所だけ、行の名前を ⌘+クリックで定義へ。コード欄（defBack を渡す）では押した行を戻り先にし、帯に「← 戻る」。
import type { Analysis, CommentDraft, Symbol } from '@ondina/model';
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Command } from '../commands/commands.js';
import { Key } from '../components/Key.js';
import { DraftBox, LineMark, MemoEditor, MemoSaved } from '../components/MemoBox.js';
import { endsAt, isMemo, pickRange, pickSpan } from '../memo.js';
import type { FocusLine } from '../state/reducer.js';
import { DiffList, type DiffMemo } from './DiffList.js';
import { Excerpt } from './Excerpt.js';
import { fileRows, foldRows, splitRows, type FileRow, type SplitSide } from './fileRows.js';
import { foldLines } from './fold.js';
import { FoldBand } from './FoldBand.js';
import type { DiffMode } from './rows.js';
import type { DefAt } from './DefLinks.js';
import { TokenSpans } from './TokenSpans.js';

export interface FileViewProps {
  analysis: Analysis;
  path: string | undefined;
  /** 見ている hunk。差分の無い停留所・覗いているファイル（all）では null */
  hunkId: string | null;
  /** そのファイルの差分を全部見る（停留所の画面で覗いているファイル）。どの差分も薄くせず、変わった行の前後以外を畳む */
  all?: boolean;
  /** 差分の無い停留所のシンボル（中心の行は excerpt の centers） */
  symbol: Symbol | undefined;
  full: boolean;
  /** 左右 / 統合（設定の diffMode.c） */
  mode: DiffMode;
  viewed: readonly string[];
  dispatch: (c: Command) => void;
  /** メモを書ける画面（コースの停留所の画面・差分の無い相手の引き出し）だけが渡す。無ければ「+」もメモも AI の下書きも出さない */
  memo?: DiffMemo;
  /** 案内人の答えの行の場所で来た行（3.10）。その行までスクロールして光らせる */
  focusLine?: FocusLine | null;
  /** 左右 / 統合とファイル全体の切り替えを出す（既定）。差分の無い相手の引き出しは出さない（統合でファイル全体。2026-10-11） */
  controls?: boolean;
  /** 帯で開いた行の key（AppState.fold のこのファイルの分） */
  open?: readonly string[] | undefined;
  /** このファイルにある、今のコースの読む場所（コースの停留所の画面だけが渡す）。2 か所以上で番号の丸と「か所目」を出す */
  places?: readonly FilePlace[] | undefined;
  /** 確かめることの根拠の行（コースの停留所の画面だけが渡す） */
  marks?: readonly LineMarks[] | undefined;
  /** base = 変更前の全文（Analysis.baseFiles）をそのまま出す（定義の引き出し。3.6）。差分は埋め込まない */
  side?: 'head' | 'base';
  /**
   * 名前から定義へ（3.6）の戻り先の数。コード欄（コースの停留所・覗いている物）が渡す。渡すと押した行を戻り先にし、帯に「← 戻る」を出す。
   * 無い = 名前から移れない解析か、定義の引き出しの中（引き出しは自分で前の定義へ戻る）
   */
  defBack?: number | undefined;
}

/** 確かめること 1 つの根拠の行。n = 文の番号、lines = head の行番号、on = 濃く光らせる（選んでいる文か、何も選んでいない） */
export interface LineMarks {
  n: number;
  lines: readonly number[];
  on: boolean;
}

/** コースの読む場所 1 つ。k は読む順の番号（0 から。course.jump の i） */
export interface FilePlace {
  hunkId: string;
  k: number;
  /** 問題なしを付けた */
  seen: boolean;
  test: boolean;
  name: string;
}

const cls = (r: FileRow) => [r.kind === 'add' ? 'a' : r.kind === 'del' ? 'r' : '', r.center ? 'ctr' : '', r.hunkId !== null && !r.focus ? 'o' : '', r.focus ? 'f' : ''].filter(Boolean).join(' ');

/** 行の side と行番号（消した行は base 側、他は head 側） */
const posOf = (r: FileRow): { side: 'LEFT' | 'RIGHT'; line: number } | null => (r.kind === 'del' ? (r.old === null ? null : { side: 'LEFT', line: r.old }) : r.new === null ? null : { side: 'RIGHT', line: r.new });

/** 行の場所（3.10）が指す行か。範囲なら始まりから終わりまで */
export function litBy(f: FocusLine | null | undefined, path: string | undefined, side: 'LEFT' | 'RIGHT', line: number | null): boolean {
  return f !== null && f !== undefined && line !== null && f.path === path && f.side === side && line >= f.line && line <= (f.endLine ?? f.line);
}

/** 光らせる class。押すたびに名前を替えて、同じ行をもう一度押しても光らせ直す */
export const flashClass = (f: FocusLine) => ` lflash l${f.n % 2}`;

export function FileView({ analysis, path, hunkId, all = false, symbol, full, mode, viewed, dispatch, memo, focusLine = null, controls = true, open, places, marks = [], side = 'head', defBack }: FileViewProps) {
  const file = path === undefined ? undefined : (side === 'base' ? analysis.baseFiles : analysis.files)?.find((f) => f.path === path);
  const centers = useMemo(() => (hunkId === null ? (symbol?.excerpt?.flatMap((b) => b.centers) ?? null) : null), [hunkId, symbol]);
  const rows = useMemo(() => {
    if (!file) return null;
    const r = fileRows(file.tokens, side === 'base' ? [] : analysis.hunks.filter((h) => h.path === file.path), hunkId, centers);
    return all ? r.map((x) => (x.hunkId === null ? x : { ...x, focus: true })) : r;
  }, [file, analysis, hunkId, centers, all, side]);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 見ている場所を画面に入れる（全体表示に切り替えたときも、見ている行へ）。同じファイルの中で場所を移ったときはなめらかに
  const shownPath = useRef(path);
  useEffect(() => {
    const same = shownPath.current === path;
    shownPath.current = path;
    const smooth = same && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    bodyRef.current?.querySelector('.cd.f')?.scrollIntoView?.({ block: 'center', ...(smooth ? { behavior: 'smooth' } : {}) });
  }, [path, hunkId, full]);
  // 締め・総括の「開く」で来たメモ（focus）は、そのメモまで。見ている場所へのスクロールより後に走らせる（ファイル全体で開いた遠い行でも画面に入る）
  const focus = memo?.ui.focus ?? null;
  useEffect(() => {
    if (focus === null) return;
    bodyRef.current?.querySelector(`[data-memo="${focus}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [focus, path, hunkId, full]);
  // 案内人の答えの行の場所で来た行も、その行まで（同じ行を押し直したときも n が変わるので走る）
  useEffect(() => {
    if (focusLine === null) return;
    // .mrow は display: contents で箱が無いので、中のコードのセルへ
    bodyRef.current?.querySelector('.mrow.lflash .cd')?.scrollIntoView?.({ block: 'center' });
  }, [focusLine, path, hunkId, full]);

  const hunk = hunkId === null ? undefined : analysis.hunks.find((h) => h.id === hunkId);
  const shownHunks = all ? analysis.hunks.filter((h) => h.path === path) : hunk ? [hunk] : [];
  if (!rows) {
    return (
      <div className="fv">
        <div className="filebar">
          <span className="path">{path ?? '位置なし'}</span>
          <span className="chip w">ファイル全体は解析にありません（analyze を実行し直すと表示されます）</span>
          {shownHunks.length > 0 && (
            <span className="sp">
              <ModeSwitch mode={mode} dispatch={dispatch} />
            </span>
          )}
        </div>
        {shownHunks.length > 0 ? <DiffList hunks={shownHunks} mode={mode} viewed={viewed} selectedHunk={hunk?.id ?? null} dispatch={dispatch} open={open} full={full} /> : <Excerpt symbol={symbol} />}
      </div>
    );
  }
  const noFocus = !rows.some((r) => r.focus);
  // 今の「前後 3 行」の範囲（畳む前の行の位置）
  const region = foldRows(rows, false);
  const inRegion = (order: number) => order >= region.above && order < region.above + region.rows.length;
  const memos = memo ? memo.comments.filter((c) => isMemo(c) && c.path === path && c.state !== 'discarded') : [];
  // AI の下書き（破棄した物も 1 行にたたんで出す）
  const drafts = memo ? memo.comments.filter((c) => !isMemo(c) && c.path === path) : [];
  const pick = memo?.ui.pick && memo.ui.pick.path === path ? memo.ui.pick : null;
  const span = pick ? pickSpan(pick) : null;
  const rowOf = (c: CommentDraft) => rows.findIndex((r) => endsAt(c, r));
  const liveDrafts = drafts.filter((c) => c.state !== 'discarded');
  const inSpan = (order: number) => span !== null && order >= span.start.order && order <= span.end.order;
  const isLit = (r: FileRow) => {
    const at = posOf(r);
    return focusLine !== null && at !== null && litBy(focusLine, path, at.side, at.line);
  };
  /** 名前から定義へ（3.6。DefLinks で包んだ所だけ効く）。消した行は base 側、他は head 側。base の全文は全部 base 側。コード欄では押した行が戻り先（光らせる行） */
  const defAt = (r: FileRow): DefAt | undefined => {
    const line = side === 'base' ? r.new : r.kind === 'del' ? r.old : r.new;
    if (path === undefined || line === null) return undefined;
    const pos = defBack === undefined ? null : posOf(r);
    return { side: side === 'base' || r.kind === 'del' ? 'base' : 'head', path, line, ...(pos ? { back: { path, ...pos } } : {}) };
  };
  /** その行を根拠にする確かめること（head 側の行だけ） */
  const marksOf = (r: FileRow): readonly LineMarks[] => (r.kind === 'del' || r.new === null ? [] : marks.filter((m) => m.lines.includes(r.new!)));
  const markCls = (r: FileRow) => {
    const ms = marksOf(r);
    return ms.length === 0 ? '' : ms.some((m) => m.on) ? ' ck on' : ' ck';
  };
  // 畳まない行: 見ている場所の変わった行と中心の行、範囲の中のメモ・AI の下書きの行、書く枠を開く行、答えの行。位置が無い停留所は畳まない。
  // 書く枠を開く行は、なぞっている間は数えない（その前後の帯が開くと行が下にずれて、なぞる先がずれる。離してから開く）
  const noted = new Set([...memos, ...drafts].map(rowOf).filter(inRegion));
  const editAt = memo?.ui.drag ? null : (span?.end.order ?? null);
  // このファイルに読む場所が 2 か所以上なら、ほかの場所の変わった行も畳まない
  const shown = places !== undefined && places.length > 1 ? places : [];
  const placeOf = new Map(shown.map((p) => [p.hunkId, p]));
  const parts = foldLines(
    rows.map((row, order) => ({ row, order })),
    ({ row, order }) => ({ key: row.key, anchor: (row.focus && (row.kind !== 'ctx' || row.center)) || (row.hunkId !== null && row.kind !== 'ctx' && placeOf.has(row.hunkId)) || noted.has(order) || editAt === order || isLit(row) || marksOf(row).length > 0 }),
    new Set(open ?? []),
    full || noFocus,
  );
  // hunk の見出しへのスクロール先（hunk ごとに、その hunk の見ている行で見えている最初の 1 行。差分の無い停留所の中心の行は 2 つの hunk に重なることもある）
  const firstOf = new Map<number, string>();
  const anchored = new Set<string>();
  for (const p of parts) {
    if (p.kind !== 'row' || !p.row.row.focus || p.row.row.hunkId === null || anchored.has(p.row.row.hunkId)) continue;
    anchored.add(p.row.row.hunkId);
    firstOf.set(p.row.order, p.row.row.hunkId);
  }
  const anchorOf = (order: number): { id: string } | object => (firstOf.has(order) ? { id: `hunk-${firstOf.get(order)}` } : {});
  // 読む場所の番号の丸を置く行（場所ごとに、見えている最初の行）
  const placeAt = new Map<number, FilePlace>();
  const placed = new Set<string>();
  for (const p of parts) {
    if (p.kind !== 'row' || p.row.row.hunkId === null || placed.has(p.row.row.hunkId)) continue;
    const place = placeOf.get(p.row.row.hunkId);
    if (!place) continue;
    placed.add(place.hunkId);
    placeAt.set(p.row.order, place);
  }
  const placeDot = (order: number | undefined) => {
    const place = order === undefined ? undefined : placeAt.get(order);
    if (!place) return null;
    const cur = place.hunkId === hunkId;
    return (
      <button type="button" className={`pdot dot sm${place.seen ? ' done' : cur ? ' cur' : ''}${cur ? ' now' : ''}${place.test ? ' test' : ''}`} aria-label={`${place.k + 1} か所目: ${place.name}`} title={place.name} onClick={() => dispatch({ id: 'course.jump', i: place.k })}>
        {place.seen ? '✓' : place.k + 1}
      </button>
    );
  };
  // 確かめることの番号の丸を置く行（文ごとに、見えている最初の根拠の行）
  const markAt = new Map<number, LineMarks[]>();
  for (const m of marks) {
    const first = parts.find((p) => p.kind === 'row' && p.row.row.new !== null && p.row.row.kind !== 'del' && m.lines.includes(p.row.row.new));
    if (first?.kind === 'row') markAt.set(first.row.order, [...(markAt.get(first.row.order) ?? []), m]);
  }
  const markDots = (order: number | undefined) => {
    const ms = order === undefined ? undefined : markAt.get(order);
    if (!ms) return null;
    return (
      <span className="cnums">
        {ms.map((m) => (
          <span key={m.n} className={`cnum${m.on ? '' : ' dim'}`} aria-label={`確かめること ${m.n}`}>
            {m.n}
          </span>
        ))}
      </span>
    );
  };
  /** 行番号の印（「+」か、GitHub の差分に出ない行は「?」）。pos はメモの行（消した行は base 側、他は head 側） */
  const plus = (pos: { side: 'LEFT' | 'RIGHT'; line: number }, order: number) => path !== undefined && <LineMark path={path} side={pos.side} line={pos.line} order={order} githubDiff={memo?.githubDiff} dispatch={dispatch} />;
  /** なぞっている間、マウスが入った行（pos。左右では入った列の行）まで範囲を伸ばす。なぞっていなければ何もしない */
  const dragTo = (pos: { side: 'LEFT' | 'RIGHT'; line: number } | null, order: number) =>
    memo?.ui.drag && pos !== null && path !== undefined ? { onMouseEnter: () => dispatch({ id: 'memo.drag', path, side: pos.side, line: pos.line, order }) } : {};
  // own = 全幅のメモの行（統合）。左右では半分の列の中に置くので行の箱を持たない
  const saved = (m: CommentDraft, own = true) => (
    <div key={`m-${m.id}`} className={own ? 'mrow-memo' : undefined} data-memo={m.id}>
      {memo?.ui.editing === m.id ? <MemoEditor path={m.path} span={m} memo={m} draft={memo.ui.draft} dispatch={dispatch} /> : <MemoSaved memo={m} githubDiff={memo?.githubDiff} dispatch={dispatch} />}
    </div>
  );
  const draftBox = (d: CommentDraft, own = true) =>
    memo && (
      <div key={`d-${d.id}`} className={own ? 'mrow-memo' : undefined} data-memo={d.id}>
        <DraftBox draft={d} text={memo.draftText[d.id]} githubDiff={memo.githubDiff} dispatch={dispatch} />
      </div>
    );
  /** その行の下に出すメモと AI の下書き */
  const under = (r: FileRow, own = true) => [...memos.filter((m) => endsAt(m, r)).map((m) => saved(m, own)), ...drafts.filter((d) => endsAt(d, r)).map((d) => draftBox(d, own))];
  // なぞっている間は出さない（出すと下の行がずれて、なぞる先がずれる）
  const editor = (key: string, own = true) =>
    pick &&
    memo &&
    !memo.ui.drag && (
      <div key={key} className={own ? 'mrow-memo' : undefined}>
        <MemoEditor path={pick.path} span={pickRange(pick)} githubDiff={memo.githubDiff} draft={memo.ui.draft} dispatch={dispatch} />
      </div>
    );

  /** 続けて見える行（start = 最初の行の畳む前の位置） */
  const chunk = (shown: readonly FileRow[], start: number): ReactNode => {
    if (mode === 'uni') {
      return shown.map((r, i) => {
        // order は畳む前の行の並び（範囲の始まりと終わりを決める。畳み方が変わっても同じ）
        const order = start + i;
        const c = `${cls(r)}${inSpan(order) ? ' msel' : ''}${markCls(r)}`;
        const pos = memo && path !== undefined ? posOf(r) : null;
        return (
          <Fragment key={order}>
            <div className={`mrow${isLit(r) ? flashClass(focusLine!) : ''}`} {...dragTo(pos, order)}>
              <div className={`ln ${c}`}>
                {placeDot(order)}
                {pos && plus(pos, order)}
                {r.old ?? ''}
              </div>
              <div className={`ln ${c}`}>
                {markDots(order)}
                {r.new ?? ''}
              </div>
              <div className={`cd ${c}`} {...anchorOf(order)}>
                <TokenSpans line={' '} tokens={r.tokens} chg={r.chg} at={defAt(r)} />
              </div>
            </div>
            {under(r)}
            {span?.end.order === order && editor(`new-${span.start.order}-${order}`)}
          </Fragment>
        );
      });
    }
    // 左右: 左の「+」は消した行だけ。変わらない行と足した行は右（head 側）。選んだ行の色は範囲の始まりか終わりの側の列だけ
    const cell = (s: SplitSide | null, side: 'LEFT' | 'RIGHT', anchor: boolean, dot: ReactNode = null, num: ReactNode = null) => {
      if (s === null) {
        return (
          <div className="mside">
            <div className="ln x">{dot}</div>
            <div className="cd x" />
          </div>
        );
      }
      const writable = side === 'RIGHT' || s.row.kind === 'del';
      const sel = writable && inSpan(s.order) && (side === span!.start.side || side === span!.end.side) ? ' msel' : '';
      const c = `${cls(s.row)}${sel}${side === 'RIGHT' ? markCls(s.row) : ''}`;
      const line = side === 'LEFT' ? s.row.old : s.row.new;
      return (
        <div className="mside" {...dragTo(posOf(s.row), s.order)}>
          <div className={`ln ${c}`}>
            {dot}
            {num}
            {memo && writable && line !== null && plus({ side, line }, s.order)}
            {line ?? ''}
          </div>
          <div className={`cd ${c}`} {...(anchor ? anchorOf(s.order) : {})}>
            <TokenSpans line={' '} tokens={s.row.tokens} chg={s.row.chg} at={defAt(s.row)} />
          </div>
        </div>
      );
    };
    return splitRows(shown, start).map(({ o, n }) => {
      const key = `${o?.order ?? ''}-${n?.order ?? ''}`;
      const lit = (o !== null && isLit(o.row)) || (n !== null && isLit(n.row));
      // メモはその行の側の列の下（消した行のメモは左、他は右）
      const left: ReactNode[] = o !== null && o.row.kind === 'del' ? under(o.row, false) : [];
      const right: ReactNode[] = n !== null ? under(n.row, false) : [];
      if (span !== null && span.end.side === 'LEFT' && o?.row.kind === 'del' && o.order === span.end.order) left.push(editor(`new-${span.start.order}-${o.order}`, false));
      if (span !== null && span.end.side === 'RIGHT' && n?.order === span.end.order) right.push(editor(`new-${span.start.order}-${n.order}`, false));
      return (
        <Fragment key={key}>
          <div className={`mrow${lit ? flashClass(focusLine!) : ''}`}>
            {cell(o, 'LEFT', true, placeDot(o?.order) ?? placeDot(n?.order))}
            {/* 変わらない行は両側に同じ行。hunk の見出しの印は左だけに付ける（id を 1 つに） */}
            {cell(n, 'RIGHT', o === null || o.order !== n?.order, null, markDots(n?.order))}
          </div>
          {(left.length > 0 || right.length > 0) && (
            <div className="mrow-memo sbs">
              <div className="mhalf l">{left}</div>
              <div className="mhalf r">{right}</div>
            </div>
          )}
        </Fragment>
      );
    });
  };
  // 見える行の塊と帯を上から順に。帯には畳んだ行の中のメモと AI の下書き（破棄した物は数えない）の数（見えない所に隠さない）
  const lines: ReactNode[] = [];
  for (let k = 0; k < parts.length; ) {
    const p = parts[k]!;
    if (p.kind === 'fold') {
      const hidden = new Set(p.rows.map((x) => x.order));
      const count = (list: readonly CommentDraft[]) => list.filter((c) => hidden.has(rowOf(c))).length;
      lines.push(<FoldBand key={`f-${p.keys[0]}`} path={path!} fold={p} memos={count(memos)} drafts={count(liveDrafts)} dispatch={dispatch} />);
      k++;
      continue;
    }
    const shown: Array<{ row: FileRow; order: number }> = [];
    for (let q = parts[k]; q?.kind === 'row'; q = parts[++k]) shown.push(q.row);
    lines.push(<Fragment key={`c-${shown[0]!.order}`}>{chunk(shown.map((x) => x.row), shown[0]!.order)}</Fragment>);
  }
  return (
    <div className="fv">
      <div className="filebar">
        <span className="path">{path}</span>
        {hunkId === null && !all && <span className="chip">{noFocus ? '位置なし（言語サーバーが位置を返しませんでした）' : '差分なし · 宣言と呼ぶ行'}</span>}
        <PlaceChip places={shown} hunkId={hunkId} />
        {controls && (
          <span className="sp">
            <ModeSwitch mode={mode} dispatch={dispatch} />
            <button className="btn sm" type="button" onClick={() => dispatch({ id: 'file.full' })}>
              {full ? '前後だけ' : 'ファイル全体'} <Key action="file.full" />
            </button>
            {/* 名前を ⌘+クリックして定義へ移る前の行へ（⌘[ と同じコマンド）。戻り先が無い間も出して、移れることを見せる */}
            {defBack !== undefined && (
              <button className="btn sm" type="button" disabled={defBack === 0} onClick={() => dispatch({ id: 'def.back' })}>
                ← 戻る <Key action="def.back" />
              </button>
            )}
          </span>
        )}
      </div>
      <div className={`diff fv-body ${mode}${placeAt.size > 0 ? ' pl' : ''}`} ref={bodyRef}>
        {lines}
      </div>
    </div>
  );
}

/** 「このファイルの n / m か所目」（読む順で数える）。2 か所以上で、今の場所がこのファイルにあるときだけ */
function PlaceChip({ places, hunkId }: { places: readonly FilePlace[]; hunkId: string | null }) {
  const at = [...places].sort((a, b) => a.k - b.k).findIndex((p) => p.hunkId === hunkId);
  if (places.length < 2 || at < 0) return null;
  return <span className="chip h">{`このファイルの ${at + 1} / ${places.length} か所目`}</span>;
}

/** 左右 / 統合（差分一覧の見出しと同じ。`s` / `u` と同じコマンド） */
function ModeSwitch({ mode, dispatch }: { mode: DiffMode; dispatch: (c: Command) => void }) {
  return (
    <span className="seg">
      <button type="button" className={mode === 'sbs' ? 'on' : ''} onClick={() => dispatch({ id: 'diff.mode.sbs' })}>
        左右
      </button>
      <button type="button" className={mode === 'uni' ? 'on' : ''} onClick={() => dispatch({ id: 'diff.mode.unified' })}>
        統合
      </button>
    </span>
  );
}

