// 要求コース。章・意図は Analysis から、操作はすべてコマンドを通す。
import type { Analysis, CommentDraft, DiffMode, Hunk, IntentNote, ReviewState } from '@ondina/model';
import { useEffect, useRef } from 'react';
import type { Command } from '../commands/commands.js';
import { composingKey } from '../commands/keymap.js';
import { DefLinks } from '../diff/DefLinks.js';
import { DiffList } from '../diff/DiffList.js';
import { hunkAt } from '../files.js';
import { pickRange } from '../memo.js';
import { chapterLabel, chapterText, intentOf, requirementFiles, requirementPick, type RequirementChapter, type RequirementUi } from '../requirement.js';
import type { FocusLine, MemoUi } from '../state/reducer.js';
import { Key } from './Key.js';
import { MemoEditor, MemoSaved } from './MemoBox.js';

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
  dispatch: (c: Command) => void;
}

export function RequirementCourseView(props: RequirementCourseViewProps) {
  const { analysis, review, at, selectedHunk, dispatch } = props;
  const chapters = analysis.chapters ?? [];
  const chapter = typeof at.chapter === 'number' ? chapters[at.chapter] : undefined;
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
  useEffect(() => {
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
    <section className="view req-course" aria-label="要求コース">
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
            </>}
          </div>
        </div>
        {at.chapter === 'start' && <>
          <ol className="req-start-list">{chapters.map((c, i) => c.kind === 'spec' && <li key={i}><button className="btn" type="button" onClick={() => dispatch({ id: 'req.go', chapter: i })}>{chapterLabel(analysis, i)} · {chapterText(analysis, c)}</button></li>)}</ol>
          <button className="btn" type="button" onClick={() => dispatch({ id: 'route.go', page: { kind: 'explain' } })}>説明を開く</button>
        </>}
        {at.chapter === 'end' && <>
          <dl className="req-counts"><dt>わかった・聞く</dt><dd>{review.viewed.length} / {analysis.hunks.length}</dd><dt>聞く</dt><dd>{review.comments.filter((c) => c.label === 'ask' && c.state !== 'discarded').length}</dd><dt>意見</dt><dd>{review.comments.filter((c) => c.label === 'imo' && c.state !== 'discarded').length}</dd><dt>Viewed が付いていないファイル</dt><dd>{files.filter((f) => !doneFile(f.path)).length}</dd></dl>
          <button className="btn" type="button" onClick={() => dispatch({ id: 'view.closing' })}>締めを開く</button>
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
