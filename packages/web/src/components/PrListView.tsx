// PR 一覧（設計書 3.11。2026-10-22）。行 = 作者、列 = レビューの状況（誰も見ていない / コメントあり / 承認あり）、カードの中に解析の状態と「解析する」、AI レビューの状態と「AI にレビューを頼む」。
// 形はモックを比べて決めた（作者 × レビューの状況）。何を出すかは prs.ts。押すとコマンドを出すだけ（原則 6）
// カードを押すと右に PR の詳細（PrDetailDrawer）。左の表は押せたままで、別のカードを押すと中身が切り替わる
import { useEffect, useReducer, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import type { AnalysisSummary, AnalyzeJob, OpenPr, PrChecks, PrReviewerState, ReviewJob } from '@ondina/model';
import type { Command } from '../commands/commands.js';
import { avatarColor, prAiReview, prAnalysis, prRows, REVIEW_COLUMNS, type PrAiState, type PrAnalysisState, type ReviewColumn } from '../prs.js';
import type { PrsUi } from '../state/reducer.js';
import { PrDetailDrawer } from './PrDetailDrawer.js';
import { AiLine, AnalysisLine, Avatar, Labels, PrChips, when } from './PrParts.js';

const COLUMNS: Record<ReviewColumn, { name: string; note: string }> = {
  // eslint-disable-next-line ondina/wording-endings -- 列の見出し（「。」の無いラベル）。名前はモックを比べて決めた
  none: { name: '誰も見ていない', note: 'レビューもコメントもまだ' },
  commented: { name: 'コメントあり', note: 'コメントか修正の依頼がある' },
  approved: { name: '承認あり', note: '1 人以上が承認した' },
};

const WORD: Record<PrReviewerState, string> = { approved: '承認', changes: '修正の依頼', commented: 'コメント', requested: '未レビュー' };

const CI: Record<PrChecks, { text: string; cls: string } | null> = {
  pass: { text: 'CI 通過', cls: 'ok' },
  fail: { text: 'CI 失敗', cls: 'bad' },
  pending: { text: 'CI 実行中', cls: '' },
  none: null,
};

type Dispatch = (c: Command) => void;

/** カードと引き出しの状態を決める材料。reviewEnabled = AI レビューのコマンドがある */
interface Sources {
  analyses: AnalysisSummary[];
  jobs: AnalyzeJob[];
  reviews: ReviewJob[];
  reviewEnabled: boolean;
}

export function PrListView({ prs, flavor, dispatch, ...src }: { prs: PrsUi; flavor: string; dispatch: Dispatch } & Sources) {
  // 経過（○○前・解析中と AI レビュー中の m:ss）を進める。どちらかが動いていれば 1 秒ごと、それ以外は 30 秒ごと
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const running = src.jobs.some((j) => j.status === 'running') || src.reviews.some((j) => j.status === 'running');
  useEffect(() => {
    const t = window.setInterval(tick, running ? 1000 : 30_000);
    return () => window.clearInterval(t);
  }, [running]);
  const now = Date.now();
  const { list, loading, error, filter, detail } = prs;
  const refresh = () => dispatch({ id: 'prs.refresh' });
  const shown = detail === null ? undefined : list?.prs.find((p) => p.number === detail.number);
  return (
    <section className={`view vp${shown === undefined ? '' : ' dw-open'}`} aria-label="PR 一覧">
      <div className="pbar">
        <span className="seg" role="group" aria-label="出す PR">
          <button type="button" className={filter.mine ? '' : 'on'} aria-pressed={!filter.mine} onClick={() => dispatch({ id: 'prs.filter', mine: false })}>
            すべて
          </button>
          <button type="button" className={filter.mine ? 'on' : ''} aria-pressed={filter.mine} onClick={() => dispatch({ id: 'prs.filter', mine: true })}>
            あなたに依頼
          </button>
        </span>
        <label className="chk">
          <input type="checkbox" checked={filter.drafts} onChange={(e) => dispatch({ id: 'prs.filter', drafts: e.target.checked })} />
          Draft も出す
        </label>
        {list?.truncated && <span className="note">更新が新しい 100 件だけを出しています。</span>}
        <span className="sp">
          {list !== null && error !== null && (
            <span className="err" role="alert" title={error}>
              取得できませんでした: {error}
            </span>
          )}
          {list !== null && <span className="fetched">GitHub から{when(now - list.fetchedAt, '取得')}</span>}
          <button type="button" className="btn sm" disabled={loading} onClick={refresh}>
            {loading ? '取得中' : '更新'}
          </button>
        </span>
      </div>
      <div className="pbody">
        <Body prs={prs} src={src} now={now} dispatch={dispatch} />
      </div>
      {detail !== null && shown !== undefined && (
        <PrDetailDrawer pr={shown} viewer={list?.viewer ?? null} tab={detail.tab} loaded={prs.details[detail.number]} state={prAnalysis(shown, src.analyses, src.jobs)} ai={prAiReview(shown, src.reviews, src.reviewEnabled)} now={now} flavor={flavor} dispatch={dispatch} />
      )}
    </section>
  );
}

function Body({ prs, src, now, dispatch }: { prs: PrsUi; src: Sources; now: number; dispatch: Dispatch }) {
  const { list, error, filter, detail } = prs;
  if (list === null) {
    if (error === null) return <div className="empty">GitHub から PR の一覧を取得しています</div>;
    return (
      <div className="empty" role="alert">
        <p>GitHub から PR の一覧を取得できませんでした。</p>
        <p className="why">{error}</p>
        <button type="button" className="btn sm" onClick={() => dispatch({ id: 'prs.refresh' })}>
          もう一度
        </button>
      </div>
    );
  }
  if (list.prs.length === 0) return <div className="empty">開いている PR はありません。</div>;
  const rows = prRows(list, filter);
  if (rows.length === 0) return <div className="empty">条件に合う PR はありません。</div>;
  const count = (c: ReviewColumn) => rows.reduce((n, r) => n + r.cells[c].length, 0);
  return (
    <div className="mx" role="table" aria-label="作者とレビューの状況">
      <div className="mrow" role="row">
        <div className="ch" role="columnheader" aria-label="作者" />
        {REVIEW_COLUMNS.map((c) => (
          <div key={c} className={`ch c-${c}`} role="columnheader">
            <span className="rvd" aria-hidden="true" />
            <b>{COLUMNS[c].name}</b>
            <span className="n">{count(c)}</span>
            <span className="d">{COLUMNS[c].note}</span>
          </div>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.author} className="mrow" role="row">
          <div className="rh" role="rowheader" style={{ '--c': `var(--${avatarColor(r.author)})` } as CSSProperties}>
            <span className="who">
              <Avatar login={r.author} />
              <span className="h">{r.author}</span>
              {r.author === list.viewer && <span className="me">あなた</span>}
            </span>
            <span className="cnt">{REVIEW_COLUMNS.reduce((n, c) => n + r.cells[c].length, 0)} 件</span>
          </div>
          {REVIEW_COLUMNS.map((c) => (
            <div key={c} className={`cell${c === 'none' ? ' hot' : ''}`} role="cell">
              {r.cells[c].map((pr) => (
                <PrCard key={pr.number} pr={pr} viewer={list.viewer} open={detail?.number === pr.number} state={prAnalysis(pr, src.analyses, src.jobs)} ai={prAiReview(pr, src.reviews, src.reviewEnabled)} now={now} dispatch={dispatch} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PrCard({ pr, viewer, open, state, ai, now, dispatch }: { pr: OpenPr; viewer: string | null; open: boolean; state: PrAnalysisState; ai: PrAiState; now: number; dispatch: Dispatch }) {
  const ci = CI[pr.checks];
  const updated = Date.parse(pr.updatedAt);
  const detail = () => dispatch({ id: 'pr.detail', number: pr.number });
  // 引き出しの裏に隠れた列のカードを開いたら、横に送って見える所に出す（開いている印が見えるように）
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [open]);
  // カードの中のボタン（解析する・開く など）はそのボタンの操作だけ
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (!(e.target as HTMLElement).closest('button, a, input, label')) detail();
  };
  // Enter はカードにフォーカスがあるときだけ。上の帯の Enter（決める・次へ）には届けない
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' || e.target !== e.currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    detail();
  };
  return (
    <article ref={ref} className={`card${pr.draft ? ' draft' : ''}${open ? ' sel' : ''}`} aria-label={`#${pr.number} ${pr.title}`} aria-expanded={open} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown}>
      <div className="ctop">
        <span className="num">#{pr.number}</span>
        <PrChips pr={pr} viewer={viewer} />
      </div>
      <div className="ctt">{pr.title}</div>
      <Labels pr={pr} />
      <div className="rvs">
        {pr.reviewers.length === 0 ? (
          <span className="rv0">レビューはまだありません</span>
        ) : (
          pr.reviewers.map((r) => (
            <span key={`${r.team ? 't' : 'u'}:${r.login}`} className={`rv ${r.state}`}>
              <Avatar login={r.login} team={r.team === true} />
              <span className="w">{r.login}</span>
              <span className="s">{WORD[r.state]}</span>
            </span>
          ))
        )}
      </div>
      <div className="facts">
        <span>
          <span className="add">+{pr.additions}</span> <span className="del">−{pr.deletions}</span>
        </span>
        <span>{pr.changedFiles} ファイル</span>
        {Number.isFinite(updated) && <span>{when(now - updated, '更新')}</span>}
        {ci && <span className={ci.cls}>{ci.text}</span>}
        <span>コメント {pr.comments}</span>
      </div>
      <div className="ops">
        <span className="cap">解析</span>
        <div>
          <AnalysisLine pr={pr} state={state} now={now} dispatch={dispatch} />
        </div>
        {/* AI レビューのコマンドが空なら、カードには行を出さない（設定への入口は引き出しだけ） */}
        {ai.kind !== 'off' && (
          <>
            <span className="cap">AI</span>
            <div>
              <AiLine pr={pr} state={ai} now={now} dispatch={dispatch} />
            </div>
          </>
        )}
      </div>
    </article>
  );
}
