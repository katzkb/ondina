// 締め（設計書 3.9）。コースを回り終えた後の 1 枚: 終えたコース・問題なしの数・送るコメント、コース外の場所、見ていない差分、自分のメモと AI の下書き、GitHub で承認。
// 承認は PR ページを開くだけで、いつでも押せる（原則 8。ゲートしない）。数は closing.ts が出す（原則 3）。押したものは全部コマンド（原則 6）。
import type { Analysis, AnalysisSummary, ReviewState } from '@ondina/model';
import { AskButton } from './AskButton.js';
import { useMemo } from 'react';
import type { Command } from '../commands/commands.js';
import { closingFacts } from '../closing.js';
import { courseBg, OUTSIDE, plusMinus, stopInfo } from '../course.js';
import { shortPath } from '../files.js';
import { shortName } from '../map/graph.js';
import type { MemoUi, SendStatus } from '../state/reducer.js';
import { CommentDrafts } from './CommentDrafts.js';
import { Narr } from './Narr.js';

/** 見ていない差分は先頭のこれだけ並べ、残りは数だけ */
const UNSEEN_MAX = 12;

export interface ClosingViewProps {
  analysis: Analysis;
  review: ReviewState;
  current: AnalysisSummary | null;
  packagePrefix?: string | undefined;
  send: SendStatus;
  canSend: boolean;
  memo: MemoUi;
  /** AI の下書きを直している途中の文（AppState.draftText） */
  draftText: Readonly<Record<string, string>>;
  dispatch: (c: Command) => void;
}

export function ClosingView({ analysis, review, current, packagePrefix, send, canSend, memo, draftText, dispatch }: ClosingViewProps) {
  const f = useMemo(() => closingFacts(analysis, review), [analysis, review]);
  const outside = f.outside;
  const infos = outside ? outside.steps.map((_, k) => stopInfo(analysis, outside, k, review)) : [];
  const outsideDone = infos.every((x) => x.seen);
  const prUrl = current?.prUrl;
  /** PR の無い解析。承認の代わりに AI に返す（12 章） */
  const local = current?.key === 'local';
  return (
    <section className="view course closing" aria-label="締め">
      <div className="sum">
        <div className="main">
          <div>
            <span className="eyebrow">締め</span>
            <h2>{analysis.pr.title}</h2>
          </div>
          <div className="stat three">
            <div>
              <b>{`${f.courses.done} / ${f.courses.total}`}</b>
              <span>完了にしたコース</span>
            </div>
            <div>
              <b>{`${f.viewed.n} / ${f.viewed.total}`}</b>
              <span>差分に問題なし</span>
            </div>
            <div>
              <b>{f.memos + f.drafts.live > 0 ? String(f.toSend) : '—'}</b>
              <span>送るコメント</span>
            </div>
          </div>
          <Narr text={`${f.unseen.length > 0 ? `見ていない差分 ${f.unseen.length}。` : '差分は全部見ました。'}${local ? 'AI にはいつでも返せます。' : '承認はいつでも押せます。'}`} />
          {outside && (
            <div className="box outside">
              <h3>
                コースに入っていない差分
                <span className="sp" />
                <span className="chip w">{infos.length}</span>
              </h3>
              {infos.map((x, k) => (
                <div key={x.step.symbolId} className="row3">
                  <span className={`dot${x.seen ? ' done' : ''}`}>{x.seen ? '✓' : k + 1}</span>
                  <span className="nm">
                    <b>{x.name}</b>
                    {x.hunk && <small>{`${shortPath(x.hunk.path, packagePrefix)} · ${plusMinus(x.hunk)}`}</small>}
                  </span>
                  <span className={`st${x.seen ? ' ok' : ''}`}>{x.seen ? '問題なし' : '未確認'}</span>
                  <button className="btn sm" type="button" onClick={() => dispatch({ id: 'course.enter', courseId: OUTSIDE, at: k })}>
                    見る
                  </button>
                </div>
              ))}
              <div className="foot">
                <button className="btn" type="button" onClick={() => dispatch({ id: 'course.enter', courseId: OUTSIDE })}>
                  {outsideDone ? 'もう一度' : `${infos.length} か所を順に見る`}
                </button>
              </div>
            </div>
          )}
          {f.unseen.length > 0 && (
            <div className="box unseen">
              <h3>
                見ていない差分
                <span className="sp" />
                <span className="chip">{f.unseen.length}</span>
              </h3>
              {f.unseen.slice(0, UNSEEN_MAX).map((h) => (
                <div key={h.id} className="row3">
                  <span className={`cb sm cc${h.hows[0] ?? OUTSIDE}`} style={courseBg(h.hows[0] ?? OUTSIDE)}>{h.hows[0] ?? '外'}</span>
                  <span className="nm">
                    <b>{shortName(h.symbolFqName, h.path, h.symbolKind)}</b>
                    <small>{`${shortPath(h.path, packagePrefix)}${h.kind === 'ripple' && h.group ? ' · 同じ書き換え' : ''}`}</small>
                  </span>
                  <span className="st">未確認</span>
                  <button className="btn sm" type="button" onClick={() => dispatch({ id: 'diff.open', hunkId: h.id })}>
                    開く
                  </button>
                </div>
              ))}
              {f.unseen.length > UNSEEN_MAX && (
                <div className="row3 more">
                  <span />
                  <span className="nm">{`ほか ${f.unseen.length - UNSEEN_MAX}`}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="side">
          <CommentDrafts comments={review.comments} send={send} canSend={canSend} local={local} githubDiff={analysis.githubDiff} memo={memo} draftText={draftText} packagePrefix={packagePrefix} dispatch={dispatch} />
          <button className="btn primary" type="button" disabled={!prUrl} title={prUrl ? 'GitHub の PR ページを新しいタブで開く' : 'PR 番号のない解析なので、開く PR ページがありません'} onClick={() => dispatch({ id: 'closing.approve' })}>
            GitHub で承認 <kbd>Enter</kbd>
          </button>
          <span className="muted">{local ? 'PR がないので、承認する PR ページはありません' : 'いつでも押せます。PR ページを開きます'}</span>
          <button className="btn" type="button" onClick={() => dispatch({ id: 'view.home' })}>
            全体図へ
          </button>
          <AskButton className="btn" />
        </div>
      </div>
    </section>
  );
}
