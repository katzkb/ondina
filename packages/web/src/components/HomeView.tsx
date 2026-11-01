// 入口（全体図。設計書 3.1）。承認したデモ（2026-09-29）の screenIntro が画面の正。
// 上: タブ（地図 1 / 説明 2）・題・件数・コースごとの割合・開始ボタン。題の下に LLM が動かなかった知らせ（1 回目か 2 回目）。
// 中: 地図タブ = 変更した場所を全部並べた地図（丸の色と番号 = コース。選んだコースの道順を出し、他を沈める）/ 説明タブ = 差分から生成した説明。
// 下: コースの並び。押すとそのコースを選び（道順が出る）、選んだカードの「入る」でコースに入る。ここは描くだけで、押した物は全部コマンド（原則 6）。
import type { Analysis, ReviewState } from '@ondina/model';
import { AskButton } from './AskButton.js';
import { useMemo } from 'react';
import type { Command } from '../commands/commands.js';
import { courseBg, courseOf, courses, nextCourse, OUTSIDE, stopInfo } from '../course.js';
import { CourseMap } from '../map/CourseMap.js';
import { buildGraph } from '../map/graph.js';
import type { ElkLike } from '../map/layout.js';
import { courseKeep, courseRoute } from '../map/route.js';
import type { HomeState } from '../state/reducer.js';
import { ExplainView } from './ExplainView.js';
import { Key } from './Key.js';
import { LlmNotice } from './LlmNotice.js';
import { MapNotice } from './MapNotice.js';

export interface HomeViewProps {
  analysis: Analysis;
  review: ReviewState;
  /** テーマ（設定）。作者の説明の mermaid の色に使う */
  flavor: string;
  home: HomeState;
  zoom: number;
  dispatch: (c: Command) => void;
  /** 差し替えはテスト用（jsdom に Web Worker が無い） */
  elk?: () => ElkLike;
}

const label = (id: number) => (id === OUTSIDE ? '外' : String(id));

export function HomeView({ analysis, review, flavor, home, zoom, dispatch, elk }: HomeViewProps) {
  const all = useMemo(() => courses(analysis), [analysis]);
  // 箱の id と丸のコースを引くだけ。「差分なし n か所」を押したときの引き出しは CourseMap が開く（設計書 3.3）
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
  const start = sel ? `${sel.id === OUTSIDE ? 'コース外' : `コース ${sel.id} `}に入る` : nx ? `コース ${nx.id} から始める` : all.some((c) => c.id !== OUTSIDE) ? '締めへ' : all.length > 0 ? 'コース外から始める' : null;
  const completed = new Set(review.course?.completed ?? []);

  const onNode = (id: string) => {
    const c = full.nodes.find((n) => n.id === id)?.course;
    if (c !== undefined) dispatch({ id: 'home.select', courseId: c });
  };

  return (
    <section className="view home" aria-label="入口">
      <div className="hubhd">
        <span className="seg" role="tablist" aria-label="入口のタブ">
          <button type="button" role="tab" aria-selected={home.tab === 'map'} className={home.tab === 'map' ? 'on' : ''} onClick={() => dispatch({ id: 'home.tab', tab: 'map' })}>
            地図 <Key action="home.tab.map" />
          </button>
          <button type="button" role="tab" aria-selected={home.tab === 'text'} className={home.tab === 'text' ? 'on' : ''} onClick={() => dispatch({ id: 'home.tab', tab: 'text' })}>
            説明 <Key action="home.tab.text" />
          </button>
        </span>
        <h2>{analysis.pr.title}</h2>
        <span className="chip">{`差分 ${analysis.hunks.length} · コース ${all.filter((c) => c.id !== OUTSIDE).length} · 外 ${outside}`}</span>
        <span className="share" aria-label="コースごとの差分の割合">
          {share.map((x) => (
            <i key={x.id} className={`cc${x.id}`} style={{ ...courseBg(x.id), flexGrow: x.n }} title={`${x.id === OUTSIDE ? 'コース外' : `コース ${x.id}`}: 差分 ${x.n}`} />
          ))}
        </span>
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
        {home.tab === 'map' ? (
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
    </section>
  );
}
