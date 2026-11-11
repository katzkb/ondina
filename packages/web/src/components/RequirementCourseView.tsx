// 要求コース。章・意図は Analysis から、操作はすべてコマンドを通す。
import type { Analysis, AnalysisSummary, CommentDraft, DiffMode, Hunk, IntentNote, ReviewState, UiSettings } from '@ondina/model';
import { useEffect, useMemo, useRef } from 'react';
import type { Command } from '../commands/commands.js';
import { composingKey } from '../commands/keymap.js';
import { DefLinks } from '../diff/DefLinks.js';
import { DiffList } from '../diff/DiffList.js';
import { hunkAt } from '../files.js';
import type { ElkLike } from '../map/layout.js';
import { pickRange } from '../memo.js';
import { paneStyle } from '../panes.js';
import { chapterLabel, chapterText, intentOf, requirementFiles, requirementPick, type RequirementChapter, type RequirementUi } from '../requirement.js';
import { boxChapters, chapterMap, startMap, type ChapterMap, type NoMap } from '../requirementMap.js';
import type { FocusLine, MemoUi, SendStatus } from '../state/reducer.js';
import { AskButton } from './AskButton.js';
import { ApproveButton } from './ClosingView.js';
import { CommentDrafts } from './CommentDrafts.js';
import { ProjectQ, WhyQ } from './ExplainStages.js';
import { FlowMap, type ReqMapProps } from './FlowMap.js';
import { Lines } from './Lines.js';
import { Key } from './Key.js';
import { MemoEditor, MemoSaved } from './MemoBox.js';
import { PaneHandle } from './PaneHandle.js';

// eslint-disable-next-line ondina/wording-endings -- 承認済みの見本で決めた短い状態ラベル
const MISSING_LABEL = '差分が見つからない';
// eslint-disable-next-line ondina/wording-endings -- 意図の種類のラベル（お知らせの文ではない）
const NONE_LABEL = '書いていない';

export interface RequirementCourseViewProps {
  analysis: Analysis;
  review: ReviewState;
  at: RequirementUi;
  selectedHunk: string | null;
  memo: MemoUi;
  mode: DiffMode;
  focusLine?: FocusLine | null;
  /** 地図の再生の速さ・倍率（無ければ 1） */
  speed?: number;
  zoom?: number;
  elk?: () => ElkLike;
  /** 列の幅（ui.json の panes）。左の章と右のファイル列 */
  panes?: UiSettings['panes'];
  /** 最後のページ（締めにあった部品）用。無ければ送れない・承認の PR ページなしの形 */
  current?: AnalysisSummary | null;
  packagePrefix?: string | undefined;
  send?: SendStatus;
  canSend?: boolean;
  /** AI の下書きを直している途中の文（AppState.draftText） */
  draftText?: Readonly<Record<string, string>>;
  dispatch: (c: Command) => void;
}

const IDLE: SendStatus = { status: 'idle' };
const NO_DRAFT_TEXT: Readonly<Record<string, string>> = {};

const CHAPTER_LEGEND = '濃い箱と濃い線が、この章の差分です。薄い所は、この章の差分ではありません。再生は濃い線だけで止まり、濃い箱を押すとその差分へ移ります。';
const START_LEGEND = '箱の下のチップは、その箱に差分がある要求です。押すとその章へ移ります。再生は全部の呼び出しを順に流します。';

/** 章の地図（はじめには全体の地図）。出さない章は理由の 1 文 */
export function RequirementMap({ analysis, at, plan, speed, zoom, elk, dispatch }: { analysis: Analysis; at: RequirementUi; plan: ChapterMap | NoMap; speed: number; zoom: number; elk?: () => ElkLike; dispatch: (c: Command) => void }) {
  const chips = useMemo(() => (plan.kind === 'map' && plan.calls === null ? boxChapters(analysis, plan.facts) : null), [analysis, plan]);
  if (plan.kind === 'none') return <p className="req-nomap">{plan.reason}</p>;
  const req: ReqMapProps = chips
    ? {
        dark: null,
        boxCmd: new Map([...chips].map(([box, list]) => [box, { id: 'req.go', chapter: list[0]! }])),
        chips: new Map([...chips].map(([box, list]) => [box, list.map((chapter) => ({ label: chapterLabel(analysis, chapter), chapter }))])),
        legend: START_LEGEND,
      }
    : {
        dark: { calls: plan.calls ?? new Set(), boxes: new Set(plan.boxes?.keys()) },
        boxCmd: new Map([...(plan.boxes ?? [])].map(([box, hunkId]) => [box, { id: 'req.focus', hunkId }])),
        legend: CHAPTER_LEGEND,
      };
  return (
    <>
      <FlowMap analysis={analysis} flows={plan.flows} stage={2} flowId={at.map.flow} step={at.map.step} play={at.map.play} speed={speed} zoom={zoom} course={null} req={req} dispatch={dispatch} {...(elk ? { elk } : {})} />
      {plan.outside.length > 0 && <p className="req-outside">{`地図の外: ${plan.outside.join('、')}`}</p>}
    </>
  );
}

export function RequirementCourseView(props: RequirementCourseViewProps) {
  const { analysis, review, at, selectedHunk, dispatch } = props;
  const chapters = analysis.chapters ?? [];
  const mapPlan = useMemo(
    () => (at.chapter === 'end' ? null : at.chapter === 'start' ? startMap(analysis, at.map.flow) : chapterMap(analysis, at.chapter, at.map.flow)),
    [analysis, at.chapter, at.map.flow],
  );
  const mapProps = { analysis, at, speed: props.speed ?? 1, zoom: props.zoom ?? 1, dispatch, ...(props.elk ? { elk: props.elk } : {}) };
  const chapter = typeof at.chapter === 'number' ? chapters[at.chapter] : undefined;
  const specs = chapters.filter((c) => c.kind === 'spec');
  const missing = chapters.flatMap((c, i) => c.kind === 'spec' && c.hunkIds.length === 0 ? [i] : []);
  const comments = review.comments.filter((c) => c.source === 'reviewer' && c.state !== 'discarded');
  const asks = comments.filter((c) => c.label === 'ask');
  const imos = comments.filter((c) => c.label === 'imo');
  const mine = new Set(chapter?.hunkIds ?? []);
  const viewed = new Set(review.viewed);
  const complete = chapter !== undefined && chapter.hunkIds.length > 0 && chapter.hunkIds.every((id) => viewed.has(id));
  const center = useRef<HTMLDivElement>(null);
  const files = requirementFiles(analysis);
  const hunksOf = (path: string) => analysis.hunks.filter((h) => h.path === path).sort((a, b) => a.lnNew - b.lnNew || a.lnOld - b.lnOld);
  const doneFile = (path: string) => {
    const hunks = hunksOf(path);
    return hunks.length > 0 && hunks.every((h) => viewed.has(h.id));
  };
  // 地図のある章に入ったときは、地図を先に見せる（欄の一番上）。差分を選び直したときは、その差分の見出しへ
  const entered = useRef<RequirementChapter | null>(null);
  useEffect(() => {
    const entering = entered.current !== at.chapter;
    entered.current = at.chapter;
    if (entering && mapPlan?.kind === 'map') {
      if (center.current) center.current.scrollTop = 0;
      return;
    }
    center.current?.querySelector('.focus > .req-hunk-head')?.scrollIntoView?.({ block: 'start' });
  }, [selectedHunk, at.chapter, at.focusN]);
  useEffect(() => {
    if (!at.scroll) return;
    const el = [...(center.current?.querySelectorAll<HTMLElement>('[data-req-file]') ?? [])].find((e) => e.dataset.reqFile === at.scroll!.path);
    el?.scrollIntoView?.({ block: 'start' });
  }, [at.scroll]);
  useEffect(() => {
    if (!props.memo.drag) return;
    const drop = () => dispatch({ id: 'memo.drop' });
    window.addEventListener('mouseup', drop);
    window.addEventListener('blur', drop);
    return () => { window.removeEventListener('mouseup', drop); window.removeEventListener('blur', drop); };
  }, [props.memo.drag, dispatch]);
  const nav = (to: RequirementChapter, label: string, text?: string, ids: readonly string[] = []) => (
    <button type="button" className={`req-nav-item${at.chapter === to ? ' on' : ''}`} aria-current={at.chapter === to ? 'page' : undefined} onClick={() => dispatch({ id: 'req.go', chapter: to })}>
      <b>{label}</b>{text && <span className="req-short" title={text}>{text}</span>}
      {typeof to === 'number' && <small>{ids.filter((id) => viewed.has(id)).length} / {ids.length}{ids.length === 0 && <span className="chip">{MISSING_LABEL}</span>}</small>}
    </button>
  );
  return (
    <section className="view req-course" aria-label="要求コース" style={paneStyle(props.panes, ['reqNav', 'reqFiles'])}>
      <PaneHandle pane="reqNav" dispatch={dispatch} />
      <PaneHandle pane="reqFiles" dispatch={dispatch} />
      <nav className="req-nav" aria-label="章" style={{ viewTransitionName: 'req-nav' }}>
        <h2>読む順番</h2>
        {nav('start', 'はじめに')}
        {chapters.map((c, i) => <div key={i}>{nav(i, chapterLabel(analysis, i), chapterText(analysis, c), c.hunkIds)}</div>)}
        {nav('end', 'Approve の前に')}
      </nav>
      <div className="req-center" role="region" aria-label="読む差分" ref={center}>
        <div className="req-banner" style={{ viewTransitionName: 'req-banner' }}>
          <h2>{at.chapter === 'start' ? 'はじめに' : at.chapter === 'end' ? 'Approve の前に' : chapterLabel(analysis, at.chapter)}</h2>
          {chapter && <p>{chapterText(analysis, chapter)}</p>}
          <div className="req-actions">
            <button className="btn sm" type="button" disabled={at.chapter === 'start'} onClick={() => dispatch({ id: 'req.prevChapter' })}>前の章 <Key action="course.prev" /></button>
            <button className="btn sm" type="button" disabled={at.chapter === 'end'} onClick={() => dispatch({ id: 'req.nextChapter' })}>次の章 <Key action="course.forward" /></button>
            {chapter && chapter.hunkIds.length > 0 && <>
              <button className={`btn sm${at.narrow ? ' on' : ''}`} type="button" aria-pressed={at.narrow} onClick={() => dispatch({ id: 'req.narrow' })}>{at.narrow ? '全部のファイルに戻す' : 'この要求の差分だけにする'} <Key action="file.full" /></button>
              <button className="btn sm" type="button" onClick={() => dispatch({ id: 'hunk.prev' })}>前の場所 <Key action="hunk.prev" /></button>
              <button className="btn sm" type="button" onClick={() => dispatch({ id: 'hunk.next' })}>次の場所 <Key action="hunk.next" /></button>
              <span className="seg"><button type="button" className={props.mode === 'sbs' ? 'on' : ''} onClick={() => dispatch({ id: 'diff.mode.sbs' })}>左右</button><button type="button" className={props.mode === 'uni' ? 'on' : ''} onClick={() => dispatch({ id: 'diff.mode.unified' })}>統合</button></span>
              {analysis.defs && <button className="btn sm" type="button" onClick={() => dispatch({ id: 'def.back' })}>定義から戻る <Key action="def.back" /></button>}
              {mapPlan?.kind === 'map' && <button className={`btn sm${at.pin ? ' on' : ''}`} type="button" aria-pressed={at.pin} onClick={() => dispatch({ id: 'req.pin' })}>地図を上に留める</button>}
            </>}
          </div>
        </div>
        {chapter && mapPlan && <div className={`req-map${at.pin ? ' pin' : ''}`} aria-label="この章の地図"><RequirementMap {...mapProps} plan={mapPlan} /></div>}
        {at.chapter === 'start' && <>
          {analysis.background?.project !== undefined && <div className="box"><div className="bd ex-qa"><ProjectQ project={analysis.background.project} /></div></div>}
          <div className={analysis.summary.headline !== undefined ? 'box ai' : 'box'}>
            <h3>このチケットの理由{analysis.summary.headline !== undefined && <span className="chip ai">AI</span>}</h3>
            <div className="bd ex-qa"><WhyQ analysis={analysis} /></div>
          </div>
          {analysis.summary.example !== undefined && <div className="box ai">
            <h3>この PR で変わること<span className="chip ai">AI</span></h3>
            <div className="bd"><Lines text={analysis.summary.example.text} /></div>
          </div>}
          {mapPlan?.kind === 'map' && <div className="box req-map" aria-label="全体の地図"><h3>処理の流れと要求<span className="chip">自動</span></h3><div className="bd"><RequirementMap {...mapProps} plan={mapPlan} /></div></div>}
          <div className="box">
            <h3>要求と差分の対応<span className="chip">自動</span></h3>
            <div className="bd">
              <p>{`チケットの要求 ${specs.length} 件のうち、差分があるもの ${specs.length - missing.length} 件${missing.length > 0 ? `、差分が見つからないもの ${missing.length} 件` : ''}です。`}</p>
              <div className="req-rows">{chapters.map((c, i) => <button className="req-row" type="button" key={i} onClick={() => dispatch({ id: 'req.go', chapter: i })}>
                <b>{chapterLabel(analysis, i)}</b>
                {c.kind === 'spec' && <span className="req-row-text" title={chapterText(analysis, c)}>{chapterText(analysis, c)}</span>}
                <span className="req-row-count">{c.hunkIds.length > 0 ? `差分 ${c.hunkIds.length} か所` : <span className="chip">{MISSING_LABEL}</span>}</span>
              </button>)}</div>
            </div>
          </div>
          <div className="req-actions">
            <button className="btn primary" type="button" onClick={() => dispatch({ id: 'req.nextChapter' })}>次へ · {chapterLabel(analysis, 0)} <Key action="enter" /></button>
            <button className="btn" type="button" onClick={() => dispatch({ id: 'route.go', page: { kind: 'explain' } })}>説明を開く</button>
          </div>
        </>}
        {at.chapter === 'end' && <>
          <div className="req-tiles">
            <div><b>{files.filter((f) => doneFile(f.path)).length} / {files.length}</b><span>GitHub の Viewed</span></div>
            <div><b>{asks.length}</b><span>聞くこと</span></div>
            <div><b>{imos.length}</b><span>意見</span></div>
            <div><b>{files.filter((f) => !doneFile(f.path)).length}</b><span>まだのファイル</span></div>
          </div>
          <div className="box">
            <h3>要求と差分のずれ<span className="chip">自動</span></h3>
            <div className="bd req-rows">
              {missing.map((i) => <button className="req-row" type="button" key={i} onClick={() => dispatch({ id: 'req.go', chapter: i })}>{chapterLabel(analysis, i)} · {chapterText(analysis, chapters[i]!)}</button>)}
              {missing.length === 0 && <p>差分が見つからない要求はありません。</p>}
            </div>
          </div>
          <RequirementComments title="聞くこと" comments={asks} analysis={analysis} dispatch={dispatch} />
          <RequirementComments title="意見" comments={imos} analysis={analysis} dispatch={dispatch} />
          <div className="box">
            <h3>まだ「わかった」も「聞く」も付けていないファイル</h3>
            <div className="bd req-rows">
              {files.filter((f) => !doneFile(f.path)).map((f) => {
                const first = hunksOf(f.path).find((h) => !viewed.has(h.id));
                return first ? <button className="req-row" type="button" key={f.path} onClick={() => dispatch({ id: 'req.goHunk', hunkId: first.id })}><span className="req-row-path">{f.path}</span></button>
                  : <div className="req-row" key={f.path}><span className="req-row-path">{f.path}</span></div>;
              })}
              {files.every((f) => doneFile(f.path)) && <p>ありません。</p>}
            </div>
          </div>
          {/* 締めにあった部品（送るコメント・承認）。同じ部品を使い回す */}
          <div className="req-closing">
            <CommentDrafts comments={review.comments} send={props.send ?? IDLE} canSend={props.canSend ?? false} local={props.current?.key === 'local'} githubDiff={analysis.githubDiff} memo={props.memo} draftText={props.draftText ?? NO_DRAFT_TEXT} packagePrefix={props.packagePrefix} dispatch={dispatch} />
            <div className="req-actions">
              <ApproveButton enterKey={false} prUrl={props.current?.prUrl} local={props.current?.key === 'local'} dispatch={dispatch} />
              <AskButton className="btn" />
            </div>
          </div>
        </>}
        {chapter?.kind === 'spec' && chapter.hunkIds.length === 0 && <p className="req-missing">この要求に当たる差分が見つかりません</p>}
        {chapter && <DefLinks defs={analysis.defs} dispatch={dispatch}>
          {at.narrow && chapter.hunkIds.length > 0 ? <>
            <p>この要求の差分 {chapter.hunkIds.length} か所だけを、読む順に並べています</p>
            {chapter.hunkIds.map((id, i) => {
              const h = analysis.hunks.find((h) => h.id === id);
              if (!h) return null;
              const current = selectedHunk === id;
              const asked = hunkComments(analysis, review, h).some((c) => c.label === 'ask' && c.state !== 'discarded');
              const status = viewed.has(id) ? asked ? 'ask' : 'ok' : null;
              return <section className={`req-card${current ? ' focus' : ''}${status ? ` st-${status}` : ''}`} key={id} data-req-hunk={id} style={{ viewTransitionName: `req-h${analysis.hunks.indexOf(h)}` }}>
                <button className="req-hunk-head" type="button" onClick={() => dispatch({ id: 'req.focus', hunkId: id })}>
                  <span className="req-number">{i + 1}</span>{current && <span className="here">いまここ</span>}
                  <span className="req-card-path">{h.path}</span>
                  <span>@@ −{h.lnOld} +{h.lnNew} @@ {h.symbol}</span>
                  {chapters.map((c, n) => c.hunkIds.includes(id) && <span className="chip" key={n}>{chapterLabel(analysis, n)}</span>)}
                  {status && <span className="req-more">{asked ? '聞く' : 'わかった'}</span>}
                </button>
                <HunkBody {...props} hunk={h} guide member={chapter.kind === 'follow' && h.group !== undefined && h.group.representative !== h.id} />
              </section>;
            })}
          </> : files.map((file) => {
            const hunks = hunksOf(file.path);
            const relevant = hunks.some((h) => mine.has(h.id));
            const open = at.files[file.path] ?? relevant;
            const chapterIds = chapters.flatMap((c, i) => c.hunkIds.some((id) => hunks.some((h) => h.id === id)) ? [i] : []);
            const add = hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith('+')).length, 0);
            const del = hunks.reduce((n, h) => n + h.lines.filter((l) => l.startsWith('-')).length, 0);
            return <section className={`req-file${doneFile(file.path) ? ' viewed' : ''}`} key={file.path} data-req-file={file.path}>
              <div className="req-file-head">
                <button className="req-path" type="button" aria-label={`ファイルを開閉 ${file.path}`} aria-expanded={open} onClick={() => dispatch({ id: 'req.toggleFile', path: file.path, open })}>{open ? '▾' : '▸'} {file.path}</button>
                <span className="req-stats"><span>+{add}</span> <span>−{del}</span></span>
                <span className="req-chips">{chapterIds.map((i) => <span className={`chip${at.chapter === i ? ' h' : ''}`} key={i}>{chapterLabel(analysis, i)}</span>)}</span>
                <Viewed path={file.path} checked={doneFile(file.path)} dispatch={dispatch} />
              </div>
              {open && hunks.map((h) => {
                const own = mine.has(h.id);
                const expanded = own || at.openHunks.includes(h.id);
                const current = own && selectedHunk === h.id;
                return <section className={`gh-hunk${current ? ' focus' : ''}`} key={h.id} data-req-hunk={h.id} style={own ? { viewTransitionName: `req-h${analysis.hunks.indexOf(h)}` } : undefined}>
                  <button className="req-hunk-head" type="button" aria-expanded={expanded} onClick={() => dispatch({ id: own ? 'req.focus' : 'req.toggleHunk', hunkId: h.id })}>
                    {current && <span className="here">いまここ</span>}{own && <span className="req-number">{chapter.hunkIds.indexOf(h.id) + 1}</span>}
                    <span>@@ −{h.lnOld} +{h.lnNew} @@ {h.symbol}</span>
                    {chapters.map((c, i) => c.hunkIds.includes(h.id) && <span className="chip" key={i}>{chapterLabel(analysis, i)}</span>)}
                    {!own && <span className="req-more">{expanded ? 'たたむ' : `${h.lines.length} 行 · 開く`}</span>}
                  </button>
                  {expanded && <HunkBody {...props} hunk={h} guide={own} member={chapter.kind === 'follow' && h.group !== undefined && h.group.representative !== h.id} />}
                </section>;
              })}
            </section>;
          })}
        </DefLinks>}
      </div>
      {complete && <div className="req-complete" role="status">
        <span>この章の差分をすべて見ました。</span>
        <button type="button" className="btn sm" onClick={() => dispatch({ id: 'req.nextChapter' })}>次の章へ <Key action="course.forward" /></button>
      </div>}
      <aside className="req-files" aria-label="Files changed" style={{ viewTransitionName: 'req-files' }}>
        <h2>Files changed</h2><p>{files.filter((f) => doneFile(f.path)).length} / {files.length} Viewed</p>
        {files.map((f) => <div className={`req-file-row${hunksOf(f.path).some((h) => h.id === selectedHunk) ? ' now' : ''}`} key={f.path}>
          <button type="button" className="req-path" title={f.path} onClick={() => dispatch({ id: 'req.file', path: f.path })}>
            <span className="req-file-name">{f.path.slice(f.path.lastIndexOf('/') + 1)}</span>
            <span className="req-file-dir">{f.path.slice(0, f.path.lastIndexOf('/') + 1)}</span>
          </button>
          <Viewed path={f.path} checked={doneFile(f.path)} dispatch={dispatch} />
        </div>)}
      </aside>
    </section>
  );
}

function RequirementComments({ title, comments, analysis, dispatch }: { title: string; comments: CommentDraft[]; analysis: Analysis; dispatch: (c: Command) => void }) {
  return <div className="box">
    <h3>{title}</h3>
    <div className="bd req-rows">
      {comments.map((c) => {
        const hunk = hunkAt(analysis.hunks, c.path, c.line, c.side);
        const body = <><span className="req-row-path">{c.path}:{c.line}</span><span className="req-row-body">{c.body}</span></>;
        return hunk ? <button className="req-row req-comment" type="button" key={c.id} onClick={() => dispatch({ id: 'req.goHunk', hunkId: hunk.id })}>{body}</button>
          : <div className="req-row req-comment" key={c.id}>{body}</div>;
      })}
      {comments.length === 0 && <p>まだありません。</p>}
    </div>
  </div>;
}

function HunkBody(props: RequirementCourseViewProps & { hunk: Hunk; guide: boolean; member: boolean }) {
  const { analysis, review, hunk: h, dispatch } = props;
  return <>
    <div className="req-code"><DiffList embedded hunks={[h]} mode={props.mode} full viewed={review.viewed} selectedHunk={null} focusLine={props.focusLine ?? null} dispatch={dispatch} memo={{ selectionOnly: true, comments: [], ui: props.memo.pick && requirementPick(analysis, h.id, props.memo.pick) ? props.memo : { ...props.memo, pick: null }, githubDiff: analysis.githubDiff, draftText: {} }} /></div>
    {props.guide && <Guide {...props} />}
  </>;
}
function hunkComments(analysis: Analysis, review: ReviewState, hunk: Hunk): CommentDraft[] {
  return review.comments.filter((c) => c.source === 'reviewer' && hunkAt(analysis.hunks, c.path, c.line, c.side)?.id === hunk.id);
}

function Viewed({ path, checked, dispatch }: { path: string; checked: boolean; dispatch: (c: Command) => void }) {
  return <label className="req-viewed" title={checked ? '押すと、このファイルの見た印を外します' : '差分が全部「わかった」か「聞く」になると付きます'}><input type="checkbox" aria-label={`Viewed ${path}`} checked={checked} disabled={!checked} onChange={() => dispatch({ id: 'req.file.unview', path })} />Viewed</label>;
}
function Intent({ note }: { note: IntentNote }) {
  const source = note.kind !== 'written' ? '' : note.from === 'pr-body' ? 'PR の本文' : note.from === 'ticket' ? 'チケット' : note.from === 'parent' ? '親チケット' : `コミット ${note.commit?.slice(0, 7) ?? ''}`;
  return <div className={`intent ${note.kind}`}><div className="req-intent-label">意図 · {note.kind === 'written' ? '書いてある' : note.kind === 'guess' ? '推定' : NONE_LABEL}{note.kind === 'guess' && <span className="chip ai">AI</span>}</div>
    {note.kind === 'written' ? <><q>{note.quote}</q><div className="req-source">{source}</div></> : <p>{note.text}</p>}
  </div>;
}
function Guide(props: RequirementCourseViewProps & { hunk: Hunk; member: boolean }) {
  const { analysis, review, at, hunk, member, memo, dispatch } = props;
  const g = hunk.group;
  const comments = hunkComments(analysis, review, hunk);
  const viewed = review.viewed.includes(hunk.id);
  const asked = comments.some((c) => c.label === 'ask' && c.state !== 'discarded');
  const editing = at.editor?.hunkId === hunk.id;
  const canSave = requirementPick(analysis, hunk.id, memo.pick) && memo.draft.trim() !== '';
  return <div className={`req-guide thread${member ? ' mini' : ''}`}>
    <div className="req-guide-title">ondina の案内{viewed && <b>{asked ? '聞く' : 'わかった'}</b>}</div>
    {member && g ? <p>{`同じ書き換え ${g.members.length} 件の 1 つです。パターン: ${g.pattern}`}</p> : intentOf(analysis, hunk)?.notes.map((note, i) => <Intent key={i} note={note} />)}
    {comments.map((c: CommentDraft) => <div key={c.id} className={`req-draft ${c.label ?? ''}`}>
      {c.label && <b>{c.label === 'ask' ? '聞く（下書き）' : '意見（下書き）'}</b>}
      {memo.editing === c.id ? <MemoEditor path={c.path} span={c} memo={c} draft={memo.draft} dispatch={dispatch} /> : <MemoSaved memo={c} githubDiff={analysis.githubDiff} dispatch={dispatch} />}
    </div>)}
    {editing ? <div className="req-editor">
      <textarea aria-label={at.editor?.label === 'ask' ? '聞くこと' : '意見'} autoFocus value={memo.draft} onChange={(e) => dispatch({ id: 'memo.draft', body: e.target.value })} onKeyDown={(e) => {
        if (composingKey(e.nativeEvent)) return;
        if (e.key === 'Escape') { e.preventDefault(); dispatch({ id: 'memo.cancel' }); }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (canSave) dispatch({ id: 'req.save', body: memo.draft }); }
      }} />
      {!requirementPick(analysis, hunk.id, memo.pick) ? <p className="req-hint">差分の「+」で、この場所の行を選んでください。</p> : memo.pick && <p className="req-hint">選んだ行: {pickRange(memo.pick).line}</p>}
      <div className="req-actions"><button type="button" className="btn sm primary" disabled={!canSave} onClick={() => dispatch({ id: 'req.save', body: memo.draft })}>保存</button><button type="button" className="btn sm" onClick={() => dispatch({ id: 'memo.cancel' })}>やめる</button></div>
    </div> : <div className="req-actions">
      {viewed ? <button type="button" className="btn sm" onClick={() => dispatch({ id: 'req.undo', hunkId: hunk.id })}>{asked ? '「聞く」を外す' : '「わかった」を外す'}</button> : <>
        <button type="button" className="btn sm" onClick={() => dispatch({ id: 'req.ok', hunkId: hunk.id })}>わかった <Key action="enter" /></button>
        <button type="button" className="btn sm" onClick={() => dispatch({ id: 'req.edit', hunkId: hunk.id, label: 'ask' })}>聞く</button>
      </>}
      <button type="button" className="btn sm" onClick={() => dispatch({ id: 'req.edit', hunkId: hunk.id, label: 'imo' })}>意見を書く</button>
    </div>}
  </div>;
}
