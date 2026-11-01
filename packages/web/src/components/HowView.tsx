// How 分解の画面（設計書 3.2）。3 列: How（依存順）| 差分（hunk 一覧）| プレビュー（選んだ hunk のファイル全体。その hunk の見出しまでスクロール）。
// 行の並びと束のまとめは hows.ts、選択・絞り込み・展開は reducer。ここは描くだけ。
// プレビューの名前は ⌘+クリックで定義へ（3.6。2026-10-29）。同じファイルの行ならそこへ移って光らせ、ヘッダの「← 戻る」・⌘[ で押した行へ。
import type { Analysis, Definitions, FileText, Hunk } from '@ondina/model';
import { AskButton } from './AskButton.js';
import { useMemo } from 'react';
import type { Command } from '../commands/commands.js';
import { DefLinks } from '../diff/DefLinks.js';
import { DiffList } from '../diff/DiffList.js';
import { FullButton } from '../diff/FoldBand.js';
import type { DiffMode } from '../diff/rows.js';
import type { FindUi, FocusLine } from '../state/reducer.js';
import { shortPath } from '../files.js';
import { howCounts, howRows, rippleCounts, type HowRow } from '../hows.js';
import { testsGuessed } from '../map/graph.js';
import { Key } from './Key.js';
import { LlmNotice } from './LlmNotice.js';

export interface HowViewProps {
  analysis: Analysis;
  viewed: readonly string[];
  mode: DiffMode;
  selectedHunk: string | null;
  selectedHow: number | null;
  openGroups: readonly string[];
  packagePrefix?: string | undefined;
  repoName: string | null;
  /** 帯で開いた行（AppState.fold）と、すべて表示（F。2026-10-13） */
  fold: Readonly<Record<string, readonly string[]>>;
  full: boolean;
  /** 差分の列の検索（⌘F。プレビューの中を探す） */
  find?: FindUi;
  /** 名前から定義へ（3.6）で移った行・案内人の答えの行の場所で来た行（光らせる） */
  focusLine?: FocusLine | null;
  /** 名前から定義へ（3.6）の戻り先の数（AppState.defBack）。無い = 名前から移れない解析（ヘッダに「← 戻る」を出さない） */
  defBack?: number | undefined;
  dispatch: (c: Command) => void;
}

const KIND_LABEL: Record<Hunk['kind'], string> = { core: '核', ripple: '追従', test: 'テスト', none: '未帰属' };
/** 種別の文字。テストの見分けが構成の推定から来たものは（推定）（5.2 の 7。原則 2） */
const kindLabel = (h: Pick<Hunk, 'kind' | 'kindProvenance'>) => (h.kind === 'test' && h.kindProvenance === 'llm' ? 'テスト（推定）' : KIND_LABEL[h.kind]);

function HowChips({ hows }: { hows: readonly number[] }) {
  return (
    <>
      {hows.map((n) => (
        <span key={n} className="chip h">
          {n}
        </span>
      ))}
      {hows.length > 1 && <span className="chip w">絡み</span>}
    </>
  );
}

function Eye({ hunk, viewed, dispatch }: { hunk: Hunk; viewed: boolean; dispatch: (c: Command) => void }) {
  return (
    <button
      type="button"
      className={`eye${viewed ? ' v' : ''}`}
      aria-label="見た印を付ける"
      onClick={(e) => {
        e.stopPropagation();
        dispatch({ id: 'hunk.markViewed', hunkId: hunk.id });
      }}
    >
      {viewed ? '✓' : ''}
    </button>
  );
}

export function HowView({ analysis, viewed, mode, selectedHunk, selectedHow, openGroups, packagePrefix, repoName, fold, full, find, focusLine = null, defBack, dispatch }: HowViewProps) {
  const rows = useMemo(() => howRows(analysis, viewed, openGroups, selectedHow), [analysis, viewed, openGroups, selectedHow]);
  const counts = useMemo(() => howCounts(analysis, viewed), [analysis, viewed]);
  const testGuess = testsGuessed(analysis);
  const viewedSet = useMemo(() => new Set(viewed), [viewed]);
  const selected = analysis.hunks.find((h) => h.id === selectedHunk) ?? null;
  // プレビューに出すファイル（選んだ hunk のファイル）の hunk 全部と全文。パスが同じなら作り直さない（同じファイルの中ではスクロールだけ）
  const selectedPath = selected?.path ?? null;
  const fileHunks = useMemo(() => (selectedPath === null ? [] : analysis.hunks.filter((h) => h.path === selectedPath)), [analysis, selectedPath]);
  const file = useMemo(() => (selectedPath === null ? undefined : analysis.files?.find((f) => f.path === selectedPath)), [analysis, selectedPath]);
  const total = analysis.hunks.length;
  const unassigned = analysis.hunks.filter((h) => h.hows.length === 0).length;
  const shown = selectedHow === null ? total : analysis.hunks.filter((h) => h.hows.includes(selectedHow)).length;
  const path = (p: string) => shortPath(p, packagePrefix);

  const rowEl = (r: HowRow, i: number) => {
    if (r.kind === 'group') {
      const g = r.group;
      const rc = rippleCounts(r.hunks);
      const inGroup = selected !== null && r.hunks.some((h) => h.id === selected.id);
      return (
        <div
          key={`g:${g.representative}`}
          className={`row grp-row${inGroup && !r.open ? ' on' : ''}${r.dim ? ' dim' : ''}`}
          data-group={g.representative}
          onClick={() => {
            dispatch({ id: 'hunk.select', hunkId: r.representative.id });
            dispatch({ id: 'group.toggle', hunkId: r.representative.id });
          }}
        >
          <span className="p">
            {r.files} ファイル <small>› 追従 {r.hunks.length} 件</small>
            <span className="sub">
              {g.pattern} · {g.uniform === 'ast' ? '一様（AST 判定）' : 'たぶん一様（LLM 判定）'} · 差異あり {rc.deviations} · わずかな差異 {rc.near}
            </span>
          </span>
          <span className="hs">
            <HowChips hows={r.representative.hows} />
          </span>
          <span className="chip">追従</span>
          <span className="seen">
            見た {r.viewedCount}/{r.hunks.length}
          </span>
        </div>
      );
    }
    const h = r.hunk;
    const on = h.id === selectedHunk;
    if (r.kind === 'member') {
      const role =
        r.role === 'representative' ? (
          <span className="chip">サンプル</span>
        ) : r.role === 'deviation' ? (
          <span className={`chip${h.group?.near.includes(h.id) ? ' d' : ''}`}>差異あり</span>
        ) : (
          <span className="chip">追従</span>
        );
      return (
        <div key={h.id} className={`row mem${on ? ' on' : ''}${r.dim ? ' dim' : ''}`} data-hunk={h.id} onClick={() => dispatch({ id: 'hunk.select', hunkId: h.id })}>
          <span className="p">
            {path(h.path)} <small>› {h.symbol}</small>
          </span>
          <span className="hs" />
          {role}
          <Eye hunk={h} viewed={viewedSet.has(h.id)} dispatch={dispatch} />
        </div>
      );
    }
    return (
      <div key={h.id} className={`row${on ? ' on' : ''}${r.dim ? ' dim' : ''}${h.hows.length === 0 ? ' bad' : ''}`} data-hunk={h.id} data-index={i} onClick={() => dispatch({ id: 'hunk.select', hunkId: h.id })}>
        <span className="p">
          {path(h.path)} <small>› {h.symbol}</small>
        </span>
        <span className="hs">
          <HowChips hows={h.hows} />
        </span>
        <span className={`chip${h.kind === 'none' ? ' d' : ''}`}>{kindLabel(h)}</span>
        <Eye hunk={h} viewed={viewedSet.has(h.id)} dispatch={dispatch} />
      </div>
    );
  };

  return (
    <section className="view vb">
      <LlmNotice llm={analysis.llm} dispatch={dispatch} />
      <div className="col">
        <div className="hd">
          <b>How</b>
          <span>依存順 · クリックで絞り込み</span>
        </div>
        {analysis.hows.length === 0 && <div className="empty">How はまだありません</div>}
        {analysis.hows.map((w) => {
          const c = counts.get(w.id)!;
          const lit = selectedHow === null && selected !== null && selected.hows.includes(w.id);
          return (
            <div key={w.id} className={`how${selectedHow === w.id ? ' on' : ''}${lit ? ' lit' : ''}`} tabIndex={0} onClick={() => dispatch({ id: 'how.select', howId: w.id })}>
              <div className="t">
                <span className="i">{w.id}</span>
                <span>{w.title}</span>
              </div>
              <div className="why">{w.why}</div>
              <div className="cnt">
                <span className="chip">核 {c.core}</span>
                <span className="chip">追従 {c.ripple}</span>
                <span className="chip">
                  テスト {c.test}
                  {testGuess ? '（推定）' : ''}
                </span>
                <span className={`chip${c.pct === 100 ? ' ok' : ''}`}>見た {c.pct}%</span>
              </div>
              <div className="bar">
                <i style={{ width: `${c.pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="col">
        <div className="hd">
          <b>差分</b>
          <span>{selectedHow === null ? `${total} hunk` : `How ${selectedHow} · ${shown} / ${total} hunk`}</span>
          <span className="sp">
            <span className="chip d">未帰属 {unassigned}</span>
          </span>
        </div>
        {rows.map(rowEl)}
      </div>

      <Preview
        hunk={selected}
        fileHunks={fileHunks}
        file={file}
        noFiles={analysis.files === undefined}
        mode={mode}
        viewed={viewed}
        repoName={repoName}
        packagePrefix={packagePrefix}
        open={selectedPath === null ? undefined : fold[selectedPath]}
        full={full}
        find={find}
        defs={analysis.defs}
        focusLine={focusLine}
        defBack={defBack}
        dispatch={dispatch}
      />
    </section>
  );
}

/**
 * fileHunks = 選んだ hunk のファイルの hunk 全部、file = その head の全文（消したファイルには無い。そのときは hunk だけで、それがファイルの全部）。
 * noFiles = 全文の欄が無い古い解析（hunk だけを出し、そう書く。原則 2）。defs = 名前から定義へ（3.6）の答え（無ければ名前から移れない）
 */
function Preview({
  hunk,
  fileHunks,
  file,
  noFiles,
  mode,
  viewed,
  repoName,
  packagePrefix,
  open,
  full,
  find,
  defs,
  focusLine,
  defBack,
  dispatch,
}: {
  hunk: Hunk | null;
  fileHunks: readonly Hunk[];
  file: FileText | undefined;
  noFiles: boolean;
  mode: DiffMode;
  viewed: readonly string[];
  repoName: string | null;
  packagePrefix: string | undefined;
  open: readonly string[] | undefined;
  full: boolean;
  find: FindUi | undefined;
  defs: Definitions | undefined;
  focusLine: FocusLine | null;
  defBack: number | undefined;
  dispatch: (c: Command) => void;
}) {
  const isViewed = hunk !== null && viewed.includes(hunk.id);
  const g = hunk?.group;
  const isRep = g !== undefined && g.representative === hunk?.id;
  const isDev = g !== undefined && hunk !== null && g.deviations.includes(hunk.id);
  return (
    <div className="col preview">
      <div className="hd">
        <b>プレビュー</b>
        <span className="seg">
          <button type="button" className={mode === 'sbs' ? 'on' : ''} onClick={() => dispatch({ id: 'diff.mode.sbs' })}>
            左右
          </button>
          <button type="button" className={mode === 'uni' ? 'on' : ''} onClick={() => dispatch({ id: 'diff.mode.unified' })}>
            統合
          </button>
        </span>
        {hunk !== null && <FullButton full={full} dispatch={dispatch} />}
        {/* 名前を ⌘+クリックして定義へ移る前の行へ（⌘[ と同じコマンド）。戻り先が無い間も出して、移れることを見せる */}
        {hunk !== null && defBack !== undefined && (
          <button type="button" className="btn sm" disabled={defBack === 0} onClick={() => dispatch({ id: 'def.back' })}>
            ← 戻る <Key action="def.back" />
          </button>
        )}
        <span className="sp">
          <AskButton />
          {repoName && hunk && (
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'jump.ide' })}>
              IDEA で開く
            </button>
          )}
          {hunk && (
            <button type="button" className={`btn sm${isViewed ? '' : ' primary'}`} onClick={() => dispatch({ id: 'hunk.markViewed', hunkId: hunk.id })}>
              {isViewed ? '見た ✓' : '見た'}
            </button>
          )}
        </span>
      </div>
      {hunk === null ? (
        <div className="empty">左で hunk を選ぶと、ここにコードを表示します</div>
      ) : (
        <>
          <div className="prev-hd">
            <div className="p">
              {shortPath(hunk.path, packagePrefix)} › {hunk.symbol}
            </div>
            <div className="meta">
              <HowChips hows={hunk.hows} />
              <span className={`chip${hunk.kind === 'none' ? ' d' : ''}`}>{kindLabel(hunk)}</span>
              {hunk.hows.length > 1 && <span className="chip w">絡み · How {hunk.hows.join(' と ')} の両方が触る</span>}
              {hunk.hows.length === 0 && <span className="danger">どの How にも入らない差分です。作者に聞くか、別の PR に分けるかを考えるときに見ます。</span>}
              {noFiles && <span className="chip w">ファイル全体は解析にありません（analyze を実行し直すと表示されます）</span>}
            </div>
            {g && (
              <div className="meta muted">
                {isRep
                  ? `同じ書き換え ${g.members.length} 件のサンプルです。残りは展開して 1 件ずつ確認できます`
                  : isDev
                    ? `同じ書き換えのうち、サンプルと差異のある 1 件です。パターン: ${g.pattern}`
                    : `同じ書き換え ${g.members.length} 件の 1 つです。パターン: ${g.pattern}`}
              </div>
            )}
          </div>
          <DefLinks defs={defs} dispatch={dispatch}>
            <DiffList hunks={fileHunks} file={file} mode={mode} viewed={viewed} selectedHunk={hunk.id} dispatch={dispatch} focusLine={focusLine} open={open} full={full} find={find} />
          </DefLinks>
        </>
      )}
    </div>
  );
}
