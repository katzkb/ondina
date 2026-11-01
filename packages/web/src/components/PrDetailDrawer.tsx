// PR 一覧（設計書 3.11）のカードを押すと右から出す PR の詳細。上はカードと同じ事実と解析の行・AI の行、下は 4 つのタブ（説明 / レビューとコメント / 変更したファイル / チェック）。
// 形はモックで確かめた。コースの地図の引き出しと同じく右から出し、背景は暗くしない（左の表は押せたまま）。中身は GET /api/prs/:n
import type { OpenPr, PrCheckResult, PrDetail, PrReviewKind, PrTimelineItem } from '@ondina/model';
import type { Command } from '../commands/commands.js';
import { ago, duration, type DetailTab, type PrAiState, type PrAnalysisState } from '../prs.js';
import type { PrDetailUi } from '../state/reducer.js';
import { BodyMarkdown } from './ExplainView.js';
import { AiLine, AnalysisLine, Avatar, Labels, PrChips, when } from './PrParts.js';

type Dispatch = (c: Command) => void;

const TAB_NAME: Record<DetailTab, string> = { desc: '説明', talk: 'レビューとコメント', files: '変更したファイル', checks: 'チェック' };
const TABS: readonly DetailTab[] = ['desc', 'talk', 'files', 'checks'];

const REVIEW_WORD: Record<PrReviewKind, string> = { approved: '承認', changes: '修正の依頼', commented: 'レビューのコメント', dismissed: '取り下げたレビュー' };

const CHECK_WORD: Record<PrCheckResult, string> = {
  pass: '成功',
  fail: '失敗',
  pending: '実行中',
  skipped: 'スキップ',
  cancelled: 'キャンセル',
  neutral: 'ニュートラル',
  action: '対応が必要',
  stale: '古い結果',
};

/** タブの横の数。レビューとコメントはコミットの追加を数えない */
function countOf(tab: DetailTab, d: PrDetail): number | undefined {
  if (tab === 'talk') return d.timeline.filter((t) => t.kind !== 'commits').length;
  if (tab === 'files') return d.filesTotal;
  if (tab === 'checks') return d.checksTotal;
  return undefined;
}

export function PrDetailDrawer({ pr, viewer, tab, loaded, state, ai, now, flavor, dispatch }: { pr: OpenPr; viewer: string | null; tab: DetailTab; loaded: PrDetailUi | undefined; state: PrAnalysisState; ai: PrAiState; now: number; flavor: string; dispatch: Dispatch }) {
  const updated = Date.parse(pr.updatedAt);
  const data = loaded?.data ?? null;
  const error = loaded?.error ?? null;
  return (
    <aside className="drawer prd" aria-label="PR の詳細">
      <div className="dw-hd">
        <div className="dw-t1">
          <span className="num">#{pr.number}</span>
          <PrChips pr={pr} viewer={viewer} />
          <span className="sp">
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'pr.github', number: pr.number })}>
              GitHub で開く ↗
            </button>
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'pr.detail', number: pr.number })}>
              閉じる <kbd>Esc</kbd>
            </button>
          </span>
        </div>
        <div className="dw-title">{pr.title}</div>
        <div className="dw-meta">
          <Avatar login={pr.author} />
          <span className="mono">{pr.author}</span>
          <span className="mono">
            {pr.head} → {pr.base}
          </span>
          {Number.isFinite(updated) && <span>{when(now - updated, '更新')}</span>}
          <Labels pr={pr} />
        </div>
        <div className="ops">
          <span className="cap">解析</span>
          <div>
            <AnalysisLine pr={pr} state={state} now={now} dispatch={dispatch} />
          </div>
          <span className="cap">AI</span>
          <div>
            {ai.kind === 'off' ? (
              <div className="st">
                <span className="sub">設定で AI レビューのコマンドを入れると、ここから頼めます。</span>
                <span className="acts">
                  <button type="button" className="btn sm" onClick={() => dispatch({ id: 'settings.open' })}>
                    設定を開く
                  </button>
                </span>
              </div>
            ) : (
              <AiLine pr={pr} state={ai} now={now} dispatch={dispatch} />
            )}
          </div>
        </div>
      </div>
      <div className="dw-tabs" role="tablist" aria-label="PR の詳細の中身">
        {TABS.map((t) => {
          const n = data === null ? undefined : countOf(t, data);
          return (
            <button key={t} type="button" role="tab" aria-selected={t === tab} className={t === tab ? 'on' : ''} onClick={() => dispatch({ id: 'pr.detail.tab', tab: t })}>
              {TAB_NAME[t]}
              {n !== undefined && (
                <>
                  {' '}
                  <span className="n">{n}</span>
                </>
              )}
            </button>
          );
        })}
        {loaded?.loading && data !== null && <span className="dw-busy">取得しています</span>}
      </div>
      {/* 番号・タブを替えたら一番上から */}
      <div key={`${pr.number}/${tab}`} className="dw-body" role="tabpanel" aria-label={TAB_NAME[tab]}>
        {error !== null && (
          <div className="dw-err" role="alert">
            <p>GitHub から PR の詳細を取得できませんでした。</p>
            <p className="why">{error}</p>
            <button type="button" className="btn sm" onClick={() => dispatch({ id: 'pr.detail.refresh' })}>
              もう一度
            </button>
          </div>
        )}
        {data === null ? error === null && <div className="dw-empty">GitHub から PR の詳細を取得しています</div> : <TabBody tab={tab} detail={data} now={now} flavor={flavor} />}
      </div>
    </aside>
  );
}

function TabBody({ tab, detail, now, flavor }: { tab: DetailTab; detail: PrDetail; now: number; flavor: string }) {
  switch (tab) {
    case 'desc':
      return detail.body.trim() === '' ? <div className="dw-empty">説明は書かれていません。</div> : <BodyMarkdown body={detail.body} flavor={flavor} />;
    case 'talk':
      return <Timeline detail={detail} now={now} flavor={flavor} />;
    case 'files':
      if (detail.files.length === 0) return <div className="dw-empty">変更したファイルはありません。</div>;
      return (
        <>
          <table className="fl">
            <tbody>
              {detail.files.map((f) => (
                <tr key={f.path}>
                  <td className="p">{f.path}</td>
                  <td className="n a">+{f.additions}</td>
                  <td className="n d">−{f.deletions}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <More n={detail.filesTotal - detail.files.length} />
        </>
      );
    case 'checks':
      if (detail.checks.length === 0) return <div className="dw-empty">チェックはありません。</div>;
      return (
        <>
          <div className="ck">
            {detail.checks.map((c, i) => (
              <div key={`${c.name}/${i}`} className={`ckr ${c.result}`}>
                <span className="nm">{c.name}</span>
                <span className="nt">{c.description ?? (c.seconds === undefined ? '' : duration(c.seconds))}</span>
                <span className="s2">{CHECK_WORD[c.result]}</span>
              </div>
            ))}
          </div>
          <More n={detail.checksTotal - detail.checks.length} />
        </>
      );
  }
}

function More({ n }: { n: number }) {
  return n > 0 ? <div className="dw-more">ほか {n} 件</div> : null;
}

/** 「3 時間前」。ポインタを載せると手元の日時 */
function At({ at, now }: { at: string; now: number }) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return null;
  return <span title={new Date(t).toLocaleString()}>{ago(now - t)}</span>;
}

function Timeline({ detail, now, flavor }: { detail: PrDetail; now: number; flavor: string }) {
  if (detail.timeline.length === 0) return <div className="dw-empty">まだレビューもコメントもありません。</div>;
  return (
    <>
      {detail.olderItems > 0 && <div className="dw-more">古い {detail.olderItems} 件は出していません。GitHub で見られます。</div>}
      <div className="tl">
        {detail.timeline.map((item, i) => (
          <TimelineItem key={i} item={item} now={now} flavor={flavor} />
        ))}
      </div>
    </>
  );
}

function TimelineItem({ item, now, flavor }: { item: PrTimelineItem; now: number; flavor: string }) {
  if (item.kind === 'commits') {
    return (
      <div className="tli sys">
        <Avatar login={item.author} />
        <div className="h2">
          <b>{item.author}</b>
          <span>コミットを {item.count} 件追加</span>
          <At at={item.at} now={now} />
        </div>
      </div>
    );
  }
  const tag = item.kind === 'comment' ? { cls: 'comment', word: 'コメント' } : { cls: item.state, word: REVIEW_WORD[item.state] };
  return (
    <div className="tli">
      <Avatar login={item.author} />
      <div>
        <div className="h2">
          <b>{item.author}</b>
          <span className={`tlt ${tag.cls}`}>{tag.word}</span>
          <At at={item.at} now={now} />
        </div>
        {item.body.trim() !== '' && (
          <div className="bd">
            <BodyMarkdown body={item.body} flavor={flavor} />
          </div>
        )}
        {item.kind === 'review' && item.comments.length > 0 && (
          <div className="lcs">
            {item.comments.map((c, i) => (
              <div key={i} className="lc">
                <div className="lp">{c.line === null ? c.path : `${c.path}:${c.line}`}</div>
                <div className="bd">
                  <BodyMarkdown body={c.body} flavor={flavor} />
                </div>
              </div>
            ))}
            <More n={item.moreComments} />
          </div>
        )}
      </div>
    </div>
  );
}
