// 入口（全体図。設計書 3.1）。承認したデモ（2026-09-29）の screenIntro が画面の正。
// 上: タブ（説明 1 / 地図 2。説明を読んでから地図を見る順）・題・件数・コースごとの割合・開始ボタン。題の下に LLM が動かなかった知らせ（1 回目か 2 回目）。
// 中: 地図タブ = 処理の流れの地図（FlowMap。① 背景 / ② この PR / ③ マージ後。コースを選ぶと ② でそのコースの変更だけで止まる。2026-11-05）/ 説明タブ = 差分から生成した説明。
//     流れの無い解析（古い解析・呼び出しの流れが無い差分）は、前の形の地図（CourseMap。変更した場所を全部並べ、選んだコースの道順を出す）。
// 下: コースの並び。押すとそのコースを選び（道順が出る）、選んだカードの「入る」でコースに入る。ここは描くだけで、押した物は全部コマンド（原則 6）。
import type { Analysis, ReviewState } from '@ondina/model';
import { AskButton } from './AskButton.js';
import { useMemo } from 'react';
import type { Command } from '../commands/commands.js';
import { courseBg, courseOf, courses, nextCourse, OUTSIDE, stopInfo } from '../course.js';
import { CourseMap } from '../map/CourseMap.js';
import { FlowMap } from './FlowMap.js';
import { buildGraph } from '../map/graph.js';
import type { ElkLike } from '../map/layout.js';
import { courseKeep, courseRoute } from '../map/route.js';
import type { HomeState } from '../state/reducer.js';
import { ExplainView } from './ExplainView.js';
import { Key } from './Key.js';
import { LlmNotice } from './LlmNotice.js';
import { chapterLabel, chapterText, NO_REQUIREMENT } from '../requirement.js';
import { startMap } from '../requirementMap.js';
import { RequirementMap } from './RequirementCourseView.js';
import { MapNotice } from './MapNotice.js';

export interface HomeViewProps {
  analysis: Analysis;
  review: ReviewState;
  /** テーマ（設定）。作者の説明の mermaid の色に使う */
  flavor: string;
  home: HomeState;
  zoom: number;
  /** 道順の再生の速さ（ui.mapSpeed。無ければ 1） */
  speed?: number;
  dispatch: (c: Command) => void;
  /** 差し替えはテスト用（jsdom に Web Worker が無い） */
  elk?: () => ElkLike;
}

// eslint-disable-next-line ondina/wording-endings -- 承認済みの見本で決めた短い状態ラベル
const MISSING_LABEL = '差分が見つからない';

const label = (id: number) => (id === OUTSIDE ? '外' : String(id));

export function HomeView({ analysis, review, flavor, home, zoom, speed = 1, dispatch, elk }: HomeViewProps) {
  const all = useMemo(() => courses(analysis), [analysis]);
  // 古い解析の地図で、箱の id と丸のコースを引くだけ。「差分なし n か所」を押したときの引き出しは CourseMap が開く（設計書 3.3）
  const full = useMemo(() => buildGraph(analysis, null), [analysis]);
  const present = useMemo(() => new Set(full.nodes.map((n) => n.id)), [full]);
  const sel = home.sel === null ? undefined : courseOf(all, home.sel);
  const route = useMemo(() => {
    if (!sel) return null;
    const r = courseRoute(analysis, sel, present);
    return { route: r, keep: courseKeep(analysis, sel, r, present) };
  }, [analysis, sel, present]);

  // 割合のバー: hunk をその最初のコース（無ければコース外）で数える（地図の丸と同じ決め方）
  const share = useMemo(() => {
    const n = new Map<number, number>();
    for (const h of analysis.hunks) n.set(h.hows[0] ?? OUTSIDE, (n.get(h.hows[0] ?? OUTSIDE) ?? 0) + 1);
    return all.map((c) => ({ id: c.id, n: n.get(c.id) ?? 0 })).filter((x) => x.n > 0);
  }, [analysis, all]);
  const outside = analysis.hunks.filter((h) => h.hows.length === 0).length;

  const nx = nextCourse(all, review);
  // 選んでいなければ次のコース。全部完了なら締めへ（コースが無くコース外だけのときはコース外。reducer の startHome と同じ）
  const chapters = analysis.chapters;
  const start = chapters ? 'はじめから読む' : sel ? `${sel.id === OUTSIDE ? 'コース外' : `コース ${sel.id} `}に入る` : nx ? `コース ${nx.id} から始める` : all.some((c) => c.id !== OUTSIDE) ? '締めへ' : all.length > 0 ? 'コース外から始める' : null;
  const completed = new Set(review.course?.completed ?? []);

  const onNode = (id: string) => {
    const c = full.nodes.find((n) => n.id === id)?.course;
    if (c !== undefined) dispatch({ id: 'home.select', courseId: c });
  };

  return (
    <section className="view home" aria-label="入口">
      <div className="hubhd">
        <span className="seg" role="tablist" aria-label="入口のタブ">
          <button type="button" role="tab" aria-selected={home.tab === 'text'} className={home.tab === 'text' ? 'on' : ''} onClick={() => dispatch({ id: 'home.tab', tab: 'text' })}>
            説明 <Key action="home.tab.text" />
          </button>
          <button type="button" role="tab" aria-selected={home.tab === 'map'} className={home.tab === 'map' ? 'on' : ''} onClick={() => dispatch({ id: 'home.tab', tab: 'map' })}>
            地図 <Key action="home.tab.map" />
          </button>
        </span>
        <h2>{analysis.pr.title}</h2>
        {chapters ? (
          <span className="chip">{`差分 ${analysis.hunks.length} · 要求 ${chapters.filter((c) => c.kind === 'spec').length}`}</span>
        ) : (
          <>
            <span className="chip">{`差分 ${analysis.hunks.length} · コース ${all.filter((c) => c.id !== OUTSIDE).length} · 外 ${outside}`}</span>
            <span className="share" aria-label="コースごとの差分の割合">
              {share.map((x) => (
                <i key={x.id} className={`cc${x.id}`} style={{ ...courseBg(x.id), flexGrow: x.n }} title={`${x.id === OUTSIDE ? 'コース外' : `コース ${x.id}`}: 差分 ${x.n}`} />
              ))}
            </span>
          </>
        )}
        <span className="sp" />
        <AskButton className="btn" />
        {start && (
          <button type="button" className="btn primary" onClick={() => dispatch({ id: 'enter' })}>
            {start} <kbd>Enter</kbd>
          </button>
        )}
      </div>
      <LlmNotice llm={analysis.llm} text={analysis.llmText} dispatch={dispatch} />
      <MapNotice analysis={analysis} />
      <div className="hubbody">
        {chapters && home.tab === 'map' ? (
          // チケットのある PR は、要求コースの「はじめに」と同じ地図（箱に要求のチップ）
          <div className="req-home-map" aria-label="全体の地図">
            <RequirementMap analysis={analysis} at={{ ...NO_REQUIREMENT, chapter: 'start', map: { flow: home.flow, step: home.step, play: home.play } }} plan={startMap(analysis, home.flow)} speed={speed} zoom={zoom} dispatch={dispatch} {...(elk ? { elk } : {})} />
          </div>
        ) : home.tab === 'map' && analysis.flows && analysis.flows.length > 0 ? (
          <FlowMap
            analysis={analysis}
            flows={analysis.flows}
            stage={home.mapStage}
            flowId={home.flow}
            step={home.step}
            play={home.play}
            speed={speed}
            zoom={zoom}
            course={sel ?? null}
            dispatch={dispatch}
            {...(elk ? { elk } : {})}
          />
        ) : home.tab === 'map' ? (
          // 流れの無い解析だけ。知らせは MapNotice
          <CourseMap
            analysis={analysis}
            scope={null}
            route={route}
            current={null}
            peek={null}
            zoom={zoom}
            title="変更した場所"
            note={sel ? `${sel.id === OUTSIDE ? 'コース外' : `コース ${sel.id} `}の道順 · Esc で全部を見る` : '層ごとの並び · 丸の色 = コース · 下のコースを押すと道順'}
            legend="丸の色と番号 = コース（外 = どのコースにも入らない差分） · 点線の「差分なし n か所」= 差分のない相手（押すと右に出す）"
            onNode={onNode}
            dispatch={dispatch}
            {...(elk ? { elk } : {})}
          />
        ) : (
          <ExplainView analysis={analysis} flavor={flavor} sel={home.sel} ticketOpen={home.ticket} stage={home.stage} dispatch={dispatch} />
        )}
      </div>
      {chapters ? (
        <div className="cards" role="list" aria-label="章の並び">
          {chapters.map((c, i) => {
            const seen = c.hunkIds.filter((id) => review.viewed.includes(id)).length;
            const text = chapterText(analysis, c);
            return (
              <div key={i} role="listitem" className="ccard">
                <button type="button" className="pick" onClick={() => dispatch({ id: 'req.go', chapter: i })} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}>
                  <span className="h">
                    <b>{chapterLabel(analysis, i)}</b>
                    {c.kind === 'spec' && c.hunkIds.length === 0 && <span className="chip d">{MISSING_LABEL}</span>}
                  </span>
                  {text !== '' && <span className="req-short" title={text}>{text}</span>}
                  {c.hunkIds.length > 0 && (
                    <>
                      <small>
                        <span>{`${seen} / ${c.hunkIds.length}`}</span>
                        <span>{`差分 ${c.hunkIds.length}`}</span>
                      </small>
                      <span className="bar">
                        <i style={{ width: `${Math.round((seen / c.hunkIds.length) * 100)}%` }} />
                      </span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
      <div className="cards" role="list" aria-label="コースの並び">
        {all.length === 0 && <div className="empty">コースがありません（LLM が目的ごとに分けていない解析）</div>}
        {all.map((c) => {
          const seen = c.steps.filter((_, k) => stopInfo(analysis, c, k, review).seen).length;
          const on = sel?.id === c.id;
          return (
            // カードの本体はネイティブのボタン（Tab で届き、Enter / Space で選ぶ。原則 6）。「入る」はその外に置く（ボタンを入れ子にしない）
            <div key={c.id} role="listitem" className={`ccard${on ? ' sel' : ''}${completed.has(c.id) ? ' done' : ''}`}>
              <button
                type="button"
                className="pick"
                aria-pressed={on}
                onClick={() => dispatch({ id: 'home.select', courseId: c.id })}
                onKeyDown={(e) => {
                  // 上の Enter は「選んだコースに入る」（App のキー）に流さない。ここでは選ぶだけ
                  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
                }}
              >
                <span className="h">
                  <span className={`cb cc${c.id}`} style={courseBg(c.id)}>{label(c.id)}</span>
                  {!on && completed.has(c.id) && <span className="chip ok">完了</span>}
                </span>
                <b>{c.title}</b>
                <small>
                  <span>{`${c.steps.length} か所`}</span>
                  <span>{`差分 ${c.hunkIds.length}`}</span>
                </small>
                <span className="bar">
                  <i style={{ width: `${c.steps.length ? Math.round((seen / c.steps.length) * 100) : 0}%` }} />
                </span>
              </button>
              {on && (
                <button type="button" className="btn sm primary go" onClick={() => dispatch({ id: 'course.enter', courseId: c.id })} onKeyDown={(e) => e.stopPropagation()}>
                  入る
                </button>
              )}
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}
