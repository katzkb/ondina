// PR 一覧（設計書 3.11）のカードと PR の詳細の引き出しが共有する部品: 作者の丸・上のチップ・ラベル・解析の行・AI の行。押すとコマンドを出すだけ（原則 6）
import type { CSSProperties, ReactNode } from 'react';
import type { OpenPr, WorkspaceJob } from '@ondina/model';
import type { Command } from '../commands/commands.js';
import { ago, avatarColor, youOf, type PrAiState, type PrAnalysisState } from '../prs.js';
import { clock } from '../reanalyze.js';

type Dispatch = (c: Command) => void;

/** 「5 分前に取得」「たった今取得」 */
export const when = (ms: number, verb: string) => {
  const a = ago(ms);
  return a === 'たった今' ? `${a}${verb}` : `${a}に${verb}`;
};

export function Avatar({ login, team = false }: { login: string; team?: boolean }) {
  return (
    <span className="av" style={{ '--c': `var(--${avatarColor(login)})` } as CSSProperties} title={team ? `${login}（チーム）` : login} aria-hidden="true">
      {login.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** #番号の横: Draft・修正の依頼・あなたの印 */
export function PrChips({ pr, viewer }: { pr: OpenPr; viewer: string | null }) {
  const you = youOf(pr, viewer);
  return (
    <>
      {pr.draft && <span className="chip">Draft</span>}
      {pr.reviewers.some((r) => r.state === 'changes') && <span className="chip d">修正の依頼</span>}
      {you && <span className={`chip ${you.asked ? 'you' : 'ok'}`}>{you.text}</span>}
    </>
  );
}

export function Labels({ pr }: { pr: OpenPr }) {
  if (pr.labels.length === 0) return null;
  return (
    <div className="tags">
      {pr.labels.map((l) => (
        <span key={l.name} className="tag" style={(/^[0-9a-f]{6}$/i.test(l.color) ? { '--c': `#${l.color}` } : {}) as CSSProperties}>
          {l.name}
        </span>
      ))}
    </div>
  );
}

function St({ k, label, sub, children }: { k: string; label: string; sub?: string; children?: ReactNode }) {
  return (
    <div className={`st k-${k}`}>
      <span className="dot" aria-hidden="true" />
      <span className="lbl">{label}</span>
      {sub !== undefined && <span className="sub">{sub}</span>}
      {children !== undefined && <span className="acts">{children}</span>}
    </div>
  );
}

export function AnalysisLine({ pr, state, now, dispatch }: { pr: OpenPr; state: PrAnalysisState; now: number; dispatch: Dispatch }) {
  const key = String(pr.number);
  const analyze = (from?: string) => dispatch({ id: 'pr.analyze', key, ...(from === undefined ? {} : { from }), now: Date.now() });
  const open = (headSha: string) => dispatch({ id: 'pr.open', key, headSha });
  switch (state.kind) {
    case 'none':
      return (
        <St k="none" label="未解析">
          <button type="button" className="btn sm primary" onClick={() => analyze()}>
            解析する
          </button>
        </St>
      );
    case 'queued':
      return <St k="wait" label="順番待ち" sub={`前に ${state.ahead} 件`} />;
    case 'running':
      return (
        <>
          <div className="st k-run">
            <span className="spin" aria-hidden="true" />
            <span className="lbl">解析中</span>
            <span className="sub">{clock(now - state.startedAt)}</span>
          </div>
          {state.line !== undefined && (
            <div className="step" title={state.line}>
              {state.line}
            </div>
          )}
        </>
      );
    case 'done':
      return (
        <St k="done" label="解析済み" sub={ago(now - state.at)}>
          <button type="button" className="btn sm" onClick={() => open(state.headSha)}>
            開く
          </button>
        </St>
      );
    case 'stale':
      return (
        <>
          <St k="stale" label="解析後に更新あり">
            <button type="button" className="btn sm primary" onClick={() => analyze(state.headSha)}>
              解析し直す
            </button>
          </St>
          <div className="st more">
            <span className="acts">
              <button type="button" className="btn sm" onClick={() => open(state.headSha)}>
                前の解析を開く
              </button>
            </span>
          </div>
        </>
      );
    case 'failed': {
      const last = state.last;
      return (
        <>
          <St k="failed" label="解析できませんでした">
            {last && (
              <button type="button" className="btn sm" onClick={() => open(last.headSha)}>
                開く
              </button>
            )}
            <button type="button" className="btn sm" onClick={() => analyze(last?.headSha)}>
              もう一度
            </button>
          </St>
          <div className="why" title={state.reason}>
            {state.reason}
          </div>
        </>
      );
    }
  }
}

/** AI の行（3.11）。AI の下書きはレビュアーが締めで採用か破棄を選ぶ（ondina は正しさを判断しない。原則 1）。off（コマンドが空）は呼ぶ側が出し分ける */
export function AiLine({ pr, state, now, dispatch }: { pr: OpenPr; state: PrAiState; now: number; dispatch: Dispatch }) {
  const key = String(pr.number);
  const ask = (label: string) => (
    <button type="button" className="btn sm" onClick={() => dispatch({ id: 'pr.review', key, headSha: pr.headSha })}>
      {label}
    </button>
  );
  const stop = (
    <button type="button" className="btn sm" onClick={() => dispatch({ id: 'pr.review.stop', key })}>
      止める
    </button>
  );
  switch (state.kind) {
    case 'off':
      return null;
    case 'none':
      return (
        <St k="none" label="未依頼">
          {ask('AI にレビューを頼む')}
        </St>
      );
    case 'waiting':
      return (
        <St k="wait" label="解析が終わったら始めます">
          {stop}
        </St>
      );
    case 'running':
      return (
        <div className="st k-run">
          <span className="spin" aria-hidden="true" />
          <span className="lbl">レビュー中</span>
          <span className="sub">{clock(now - state.startedAt)}</span>
          <span className="acts">{stop}</span>
        </div>
      );
    case 'done':
      return (
        <>
          <St k="done" label={`下書き ${state.drafts} 件`}>
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'pr.drafts', key, headSha: state.headSha })}>
              見る
            </button>
          </St>
          <Skipped n={state.skipped} />
        </>
      );
    case 'stale':
      return (
        <>
          <St k="stale" label={`下書き ${state.drafts} 件`} sub="レビュー後に更新あり">
            {ask('頼み直す')}
          </St>
          <Skipped n={state.skipped} />
        </>
      );
    case 'failed':
      return (
        <>
          <St k="failed" label="レビューできませんでした">
            {ask('もう一度')}
          </St>
          <div className="why" title={state.reason}>
            {state.reason}
          </div>
        </>
      );
    case 'stopped':
      return (
        <St k="none" label="止めました">
          {ask('もう一度')}
        </St>
      );
  }
}

/** GitHub の差分に出ない行のコメントは、そのジョブでは入れずに数だけ残す（3.11） */
function Skipped({ n }: { n: number }) {
  return n > 0 ? <div className="skip">{n} 件は GitHub の差分に出ない行なので入れませんでした</div> : null;
}

/** PR のレビュー用作業場。UI は外部ツールを直接呼ばず、コマンドだけを出す */
export function WorkspaceLine({ pr, job, dispatch }: { pr: OpenPr; job?: WorkspaceJob | undefined; dispatch: Dispatch }) {
  const open = (label: string) => (
    <button type="button" className="btn sm" onClick={() => dispatch({ id: 'pr.workspace', key: String(pr.number), branch: pr.head, title: pr.title, url: pr.url, now: new Date().toISOString() })}>
      {label}
    </button>
  );
  if (!job) return <St k="none" label="">{open('レビュー用に開く')}</St>;
  if (job.status === 'running') return (
    <div role="status">
      <div className="st k-run">
        <span className="spin" aria-hidden="true" />
        <span className="lbl">作業場を開いています</span>
      </div>
      {job.steps.map((step, i) => <div className="step" key={step}>{i < job.done ? `✓ ${step}` : step}</div>)}
    </div>
  );
  if (job.status === 'failed') return (
    <>
      <St k="failed" label="作業場を開けませんでした">{open('もう一度')}</St>
      <div className="why">{job.error}</div>
    </>
  );
  const name = { 'herdr-app': 'Herdr アプリ', herdr: 'herdr', orca: 'orca' }[job.app];
  return <St k="done" label={`${name} で開いています`}>{open('開く')}</St>;
}
