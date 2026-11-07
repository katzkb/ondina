// 読む前の案内の中身と、停留所の右の列の確かめること・知っておくこと（設計書 3.3。2026-10-22。見本を比べて案 1 にした）。
// 確かめることの文・変わること・要求は LLM の文（点線と「AI」）。読む順・PR の流れ・知っておくことの呼び出しは事実（実線と「自動」）。1 つの枠に混ぜない（原則 2）。
// 押したものは全部コマンドにする（原則 6）: 確かめることを選ぶ course.check、場所へ course.jump、覗く map.peek、1 か所目へ course.ok
import type { Analysis } from '@ondina/model';
import type { ReactNode } from 'react';
import type { Command } from '../commands/commands.js';
import { callEdge, callerFacts, courseChecks, courseFlow, courseSpecs, nextReason, placeLabel, type CallerFact, type CourseCheck } from '../brief.js';
import { courseBg, courseIntro, courseOf, courses, type Course, type StopInfo } from '../course.js';
import { Narr } from './Narr.js';

/** 呼ぶ行どうしがこの行数以内なら、覗いたときにまとめて光らせる */
const NEAR = 5;

const Chip = ({ ai }: { ai: boolean }) => <span className={ai ? 'chip ai' : 'chip'}>{ai ? 'AI' : '自動'}</span>;

/** 確かめることの番号。dim = 輪郭だけ（ここに無い・選んでいない）、ok = 場所を全部見た */
export function CheckNum({ n, dim = false, ok = false }: { n: number; dim?: boolean; ok?: boolean }) {
  return <span className={`cnum${ok ? ' ok' : dim ? ' dim' : ''}`}>{n}</span>;
}

/** 読む前の案内の画面の中身（真ん中と右をまとめた 1 枚） */
export function BriefBody({ analysis, course, infos, check, next, map, dispatch }: { analysis: Analysis; course: Course; infos: readonly StopInfo[]; check: number | undefined; next: number; map?: ReactNode; dispatch: (c: Command) => void }) {
  const tour = analysis.tours.find((t) => t.howId === course.id);
  const checks = courseChecks(analysis, course, infos);
  const sel = checks.find((c) => c.n === check);
  const facts = callerFacts(analysis, course, infos);
  const other = infos.filter((x) => x.other !== null).length;
  const specs = courseSpecs(analysis, course);
  const change = tour?.change;
  return (
    <div className="brief">
      <div className="eyebrow">
        <span className={`cb sm cc${course.id}`} style={courseBg(course.id)}>{course.id}</span>
        {`コース ${course.id} · 読む前の案内`}
      </div>
      <h2>{course.title}</h2>
      <Flow analysis={analysis} course={course} />
      {map && (
        <section className="bsec">
          <h3>
            呼び出しの流れの中で <Chip ai={false} />
          </h3>
          {map}
        </section>
      )}
      {change ? (
        <section className="bsec">
          <h3>
            変わること <Chip ai />
          </h3>
          <div className="ba ai">
            {change.before !== undefined && (
              <>
                <span className="k">前</span>
                <p>{change.before}</p>
              </>
            )}
            {change.after !== undefined && (
              <>
                <span className="k">後</span>
                <p>{change.after}</p>
              </>
            )}
          </div>
        </section>
      ) : (
        <Narr {...courseIntro(course)} />
      )}
      <div className={checks.length > 0 ? 'btwo' : undefined}>
        <section className="bsec">
          <h3>
            読む順 <Chip ai={false} />
            <span className="r">間の文字 = 渡す型</span>
          </h3>
          <Route analysis={analysis} infos={infos} checks={checks} sel={sel} dispatch={dispatch} />
        </section>
        {checks.length > 0 && (
          <section className="bsec">
            <h3>
              {`確かめること ${checks.length}`} <Chip ai />
              <span className="r">押すと読む順の場所が光る</span>
            </h3>
            <div className="bchecks">
              {checks.map((c) => (
                <button key={c.n} type="button" className={`bcheck${c.n === check ? ' sel' : ''}`} aria-pressed={c.n === check} onClick={() => dispatch({ id: 'course.check', n: c.n })}>
                  <CheckNum n={c.n} ok={c.seen} />
                  <span className="t">{c.text}</span>
                  <span className="w">
                    {c.at.map((a) => (
                      <span key={a.symbolId} className={`loc${infos[a.k]!.seen ? ' done' : ''}`}>
                        {a.label}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      {(facts.length > 0 || other > 0 || specs.length > 0) && (
        <section className="bsec">
          <h3>知っておくこと</h3>
          <div className="know">
            {facts.map((f) => (
              <CallerBox key={f.callerId} fact={f} dispatch={dispatch} />
            ))}
            {other > 0 && (
              <div className="fact">
                <div className="who">
                  知っておくこと <Chip ai={false} />
                </div>
                <p>{`読む ${infos.length} か所のうち ${other} か所は、ほかのコースの差分です。`}</p>
                <p>中身はそのコースで見ます。ここでは呼ばれ方を見ます。</p>
              </div>
            )}
            {specs.length > 0 && (
              <div className="fact ai">
                <div className="who">
                  {`対応する要求 ${specs.length}`} <Chip ai />
                </div>
                {specs.map((t) => (
                  <p key={t}>{t}</p>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
      <div className="bgo">
        <button className="btn primary" type="button" onClick={() => dispatch({ id: 'course.ok' })}>
          {`${next + 1} か所目へ`} <kbd>Enter</kbd>
        </button>
        <span className="muted">{`読む順に ${infos.length} か所を回ります。${checks.length > 0 ? '確かめることは右の列にずっと出ています。' : ''}`}</span>
      </div>
    </div>
  );
}

/** PR の流れの中で: このコースを呼ぶコース → このコース → このコースが呼ぶコース。呼び出しでつながるコースが無ければ出さない */
function Flow({ analysis, course }: { analysis: Analysis; course: Course }) {
  const { callers, callees } = courseFlow(analysis, course);
  if (callers.length === 0 && callees.length === 0) return null;
  const all = courses(analysis);
  const node = (id: number, me = false) => (
    <span key={id} className={`n${me ? ' me' : ''}`}>
      <span className={`cb sm cc${id}`} style={courseBg(id)}>{id}</span>
      {`${courseOf(all, id)?.title ?? ''}${me ? '（このコース）' : ''}`}
    </span>
  );
  const join = (ids: readonly number[]) => ids.flatMap((id, i) => [...(i > 0 ? [<span key={`s${id}`} className="ar">·</span>] : []), node(id)]);
  return (
    <div className="bflow">
      <span className="lbl">
        PR の流れの中で <Chip ai={false} />
      </span>
      {callers.length > 0 && (
        <>
          {join(callers)}
          <span className="ar">→</span>
        </>
      )}
      {node(course.id, true)}
      {callees.length > 0 && (
        <>
          <span className="ar">→</span>
          {join(callees)}
        </>
      )}
    </div>
  );
}

/** 読む順: 停留所を上から。間は呼ばれ方の辺（渡す型）、辺の無い停留所（テスト・import・辺に乗らない差分）の前は点線 */
function Route({ analysis, infos, checks, sel, dispatch }: { analysis: Analysis; infos: readonly StopInfo[]; checks: readonly CourseCheck[]; sel: CourseCheck | undefined; dispatch: (c: Command) => void }) {
  return (
    <div className="route">
      {infos.map((info, k) => {
        const e = k === 0 ? null : callEdge(analysis, info);
        const here = checks.filter((c) => c.at.some((a) => a.k === k));
        const lit = sel?.at.some((a) => a.k === k) === true;
        return (
          <div key={info.step.symbolId}>
            {k > 0 && (
              <div className="redge">
                <span className={`l${e === null ? ' dash' : ''}`} />
                <span className="ty">{e?.types?.in ?? ''}</span>
              </div>
            )}
            <button type="button" className={`rnode${info.other !== null ? ' oth' : ''}${info.test ? ' test' : ''}${lit ? ' hl' : ''}`} title={info.symbol?.fqName ?? info.name} onClick={() => dispatch({ id: 'course.jump', i: k })}>
              <span className="bul">{info.seen ? '✓' : ''}</span>
              <span className="nm">
                <b>{info.name}</b>
                {info.other !== null ? <span className="chip">{`コース ${info.other} の差分`}</span> : <span className="chip">{info.layer}</span>}
              </span>
              <span className="cl">
                {here.map((c) => (
                  <CheckNum key={c.n} n={c.n} dim={sel?.n !== c.n} />
                ))}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** 知っておくこと 1 件: ほかのコースの差分がこのコースの停留所を呼ぶ。「覗く」で呼ぶ側のコードのその行へ（近ければ最後の呼ぶ行まで光らせる） */
export function CallerBox({ fact, dispatch }: { fact: CallerFact; dispatch: (c: Command) => void }) {
  const lines = fact.calls.flatMap((c) => (c.line === undefined ? [] : [c.line]));
  const line = lines[0];
  const last = lines.at(-1);
  const endLine = line !== undefined && last !== undefined && last > line && last - line <= NEAR ? last : undefined;
  return (
    <div className="fact">
      <div className="who">
        知っておくこと <Chip ai={false} />
      </div>
      <p>{fact.text}</p>
      <div className="act">
        <button className="btn sm" type="button" onClick={() => dispatch({ id: 'map.peek', symbolId: fact.callerId, ...(line === undefined ? {} : { line }), ...(endLine === undefined ? {} : { endLine }) })}>
          {line === undefined ? `${fact.name.split('.').pop()} を覗く` : `${fact.name.split('.').pop()} の ${line} 行を覗く`}
        </button>
      </div>
    </div>
  );
}

/**
 * 停留所の右の列の確かめること: 全部の文。ここに根拠のある文は明るく、場所のチップ（ここ / 見た）とここで見るもの。押すとその文の行だけ光る。
 * ほかの文は薄い 1 行で、押すとまだ見ていない根拠の場所へ（全部見ていれば最初の場所へ）。onlyHere はたたんだときのコードの上の帯（ここにある文だけ）
 */
export function StopChecks({ checks, k, check, infos, onlyHere = false, dispatch }: { checks: readonly CourseCheck[]; k: number; check: number | undefined; infos: readonly StopInfo[]; onlyHere?: boolean; dispatch: (c: Command) => void }) {
  const here = checks.filter((c) => c.at.some((a) => a.k === k));
  const shown = onlyHere ? here : checks;
  if (shown.length === 0) return null;
  return (
    <section className="schecks">
      <h3>
        確かめること <Chip ai />
        <span className="r">{here.length > 0 ? `ここに ${here.length} つ` : 'ここにはありません'}</span>
      </h3>
      {shown.map((c) => {
        const mine = c.at.filter((a) => a.k === k);
        if (mine.length > 0) {
          return (
            <button key={c.n} type="button" className={`sck here${c.n === check ? ' sel' : ''}`} aria-pressed={c.n === check} onClick={() => dispatch({ id: 'course.check', n: c.n })}>
              <CheckNum n={c.n} ok={c.seen} />
              <span className="t">{c.text}</span>
              <span className="w">
                {c.at.map((a) => (
                  <span key={a.symbolId} className={`loc${a.k === k ? ' here' : infos[a.k]!.seen ? ' done' : ''}`}>
                    {a.label}
                  </span>
                ))}
              </span>
              {mine.map((a) => a.say !== undefined && <span key={a.symbolId} className="say">{a.say}</span>)}
            </button>
          );
        }
        const to = (c.at.find((a) => !infos[a.k]!.seen) ?? c.at[0]!).k;
        return (
          <button key={c.n} type="button" className="sck away" title={`${to + 1} か所目へ`} onClick={() => dispatch({ id: 'course.jump', i: to })}>
            <CheckNum n={c.n} dim={!c.seen} ok={c.seen} />
            <span className="t">{c.text}</span>
          </button>
        );
      })}
    </section>
  );
}

/** 停留所の右の列の下: この停留所に関わる知っておくこと・ほかのコースの差分の一言・次は X */
export function StopNotes({ analysis, course, infos, k, nextK, dispatch }: { analysis: Analysis; course: Course; infos: readonly StopInfo[]; k: number; nextK: number | null; dispatch: (c: Command) => void }) {
  const info = infos[k]!;
  const facts = callerFacts(analysis, course, infos).filter((f) => f.calls.some((c) => c.k === k));
  const next = nextK === null ? undefined : infos[nextK];
  const reason = next ? nextReason(analysis, next) : '';
  return (
    <>
      {facts.map((f) => (
        <CallerBox key={f.callerId} fact={f} dispatch={dispatch} />
      ))}
      {info.other !== null && (
        <div className="fact">
          <div className="who">
            ほかのコースの差分 <span className={`cb sm cc${info.other}`} style={courseBg(info.other)}>{info.other}</span> <Chip ai={false} />
          </div>
          <p>{`この差分はコース ${info.other} のものです。中身はコース ${info.other} で見ます。`}</p>
        </div>
      )}
      <div className="snext">
        <span>次は</span>
        <b>{next ? placeLabel(next) : '総括'}</b>
        {reason !== '' && <span>{reason}</span>}
      </div>
    </>
  );
}

/** 上の帯の右: 確かめること（場所を全部見た数）と問題なしの数。確かめることが無ければ問題なしだけ */
export function CourseMeter({ checks, infos }: { checks: readonly CourseCheck[]; infos: readonly StopInfo[] }) {
  const seen = infos.filter((x) => x.seen).length;
  return (
    <span className="meter">
      {checks.length > 0 && (
        <>
          確かめること <b>{`${checks.filter((c) => c.seen).length} / ${checks.length}`}</b>
          {' · '}
        </>
      )}
      問題なし <b>{`${seen} / ${infos.length}`}</b>
    </span>
  );
}

/** 総括の確かめること: 文ごとに 場所を全部見た / まだ見ていない場所がある。場所のチップを押すとその停留所へ */
export function SummaryChecks({ checks, infos, dispatch }: { checks: readonly CourseCheck[]; infos: readonly StopInfo[]; dispatch: (c: Command) => void }) {
  if (checks.length === 0) return null;
  return (
    <div className="box schecks-sum">
      <h3>
        確かめること <Chip ai />
        <span className="sp" />
        <span className="chip">{`${checks.filter((c) => c.seen).length} / ${checks.length}`}</span>
      </h3>
      {checks.map((c) => (
        <div key={c.n} className="row">
          <CheckNum n={c.n} ok={c.seen} dim={!c.seen} />
          <span className="t">
            {c.text}
            <span className="muted">{c.seen ? ' · 場所を全部見た' : ' · まだ見ていない場所がある'}</span>
          </span>
          <span className="w">
            {c.at.map((a) => (
              <button key={a.symbolId} type="button" className={`loc${infos[a.k]!.seen ? ' done' : ''}`} onClick={() => dispatch({ id: 'course.jump', i: a.k })}>
                {a.label}
              </button>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 上の帯の「読む前の案内」 */
export function BriefPill({ cur, dispatch }: { cur: boolean; dispatch: (c: Command) => void }) {
  return (
    <button type="button" className={`bpill${cur ? ' cur' : ''}`} aria-current={cur ? 'step' : undefined} onClick={() => dispatch({ id: 'course.brief' })}>
      読む前の案内
    </button>
  );
}
