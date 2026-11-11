// 入口の地図タブ = 処理の流れの地図（設計書 3.1。2026-11-05 に承認した見本 flow5）。
// 上: 流れの選び方（2 本以上のとき）・段の切り替え（① 背景 = 変わる前の流れ / ② この PR = 同じ流れの上で、足された・変わった呼び出しに色 / ③ マージ後 = 変わった後の流れ）。
// 中: 地図。レイヤーは上から下の帯（境目は点線）、呼び出しは実線、戻りは同じ道を逆にたどる点線。玉が今のステップの線を走る。下に再生の帯。
// 下: 今のステップのコード（段の側の行）と、横の欄（① 出てくるクラス / ② 流れの外の変更 / ③ 変わる前との違い / コースの範囲ならそのコースで変わる所）。
// コースを選んでいれば（入口の home.sel、読む前の案内のコース）コースの範囲: ② で、そのコースの変更とその戻りだけ色、ほかは灰色。次・再生はそこだけで止まる。
// ステップ・箱・配置・コードは map/flowmap の純粋関数が組む（原則 3・5）。押した物は全部コマンド（原則 6）
import type { Analysis, CallFlow, FlowCall } from '@ondina/model';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement } from 'react';
import type { Command } from '../commands/commands.js';
import { courseBg, type Course } from '../course.js';
import { workerElk } from '../map/elk.js';
import type { ElkLike } from '../map/layout.js';
import { callText, flowFacts, type Diffness, type FlowBox } from '../map/flowmap/boxes.js';
import { stepCode } from '../map/flowmap/code.js';
import { along, flowLayout, midOf, moveMs, returnPath, snapSpeed, SPEED_MAX, SPEED_MIN, SPEED_SNAP, stepMs, type FlowLayout, type Pt } from '../map/flowmap/layout.js';
import { outsideOf } from '../map/flowmap/outside.js';
import { allCalls, curStep, flowSteps, inCourse, inStage, pickFlow, scoped, statusCounts, stopsOf, type FlowStep, type Scope, type Stage } from '../map/flowmap/steps.js';
import { clampZoom, wheelZoom } from '../map/zoom.js';
import { fitScale, REQ_MAP_MAX_H } from '../requirementMap.js';
import { sentences } from '../text.js';
import { Key } from './Key.js';

export interface FlowMapProps {
  analysis: Analysis;
  flows: readonly CallFlow[];
  stage: Stage;
  flowId: string | null;
  step: number;
  play: boolean;
  speed: number;
  zoom: number;
  /** 選んだコース（コースの範囲）。無ければ全部の変更 */
  course: Course | null;
  /** 上にコースの名前を出すか（読む前の案内では見出しにあるので出さない） */
  courseTitle?: boolean;
  /** 要求コースの小さい形（段の切り替え・下のコード欄・横の欄なし。段は ② だけ）。入口と読む前の案内には渡さない */
  req?: ReqMapProps;
  dispatch: (c: Command) => void;
  elk?: () => ElkLike;
}

export interface ReqMapProps {
  /** 濃くする呼び出しの key と箱の id。null = 全部を ② の色で（はじめに） */
  dark: { calls: ReadonlySet<string>; boxes: ReadonlySet<string> } | null;
  /** 押せる箱（箱の id → 押したときのコマンド） */
  boxCmd: ReadonlyMap<string, Command>;
  /** 箱に付けるチップ（箱の id → 要求の名前と章。押すとその章へ） */
  chips?: ReadonlyMap<string, ReadonlyArray<{ label: string; chapter: number }>>;
  /** 地図の下の凡例の 1 行 */
  legend: string;
}

const STAGE_KEY = { 1: 'before', 2: 'change', 3: 'after' } as const;

const STAGES: Array<{ n: Stage; title: string; sub: string }> = [
  { n: 1, title: '① 背景', sub: '変わる前の流れ' },
  { n: 2, title: '② この PR', sub: 'どこが変わったか' },
  { n: 3, title: '③ マージ後', sub: '変わった後の流れ' },
];

/** 線と札の色の名前（CSS の class） */
type Tone = 'plain' | 'same' | 'chg' | 'add' | 'del' | 'other';
const TONE: Record<FlowCall['status'], Tone> = { same: 'same', changed: 'chg', added: 'add', removed: 'del' };
const STATUS_TEXT: Record<FlowCall['status'], string> = { same: '変わる前と同じ', changed: '変わった', added: '足された', removed: 'なくなった' };
const DIFF_TAG: Partial<Record<Diffness, string>> = { added: '新しい', changed: '変わった', removed: '消えた', none: '差分なし' };

/** Enter / Space はこの部品だけのもの（App の Enter =「選んだコースに入る」に流さない） */
const stopKeys = (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
};
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function FlowMap({ analysis, flows, stage, flowId, step, play, speed, zoom, course, courseTitle = true, req, dispatch, elk = workerElk }: FlowMapProps) {
  const courseSel = course?.id ?? null;
  const sel: Scope | null = req ? (req.dark?.calls ?? null) : courseSel;
  const flow = pickFlow({ flows: [...flows] }, flowId, courseSel)!;
  const facts = useMemo(() => flowFacts(analysis, flow), [analysis, flow]);
  const [layout, setLayout] = useState<{ id: string; L: FlowLayout } | Error | null>(null);
  useEffect(() => {
    let live = true;
    flowLayout(flow, facts, elk())
      .then((L) => live && setLayout({ id: flow.id, L }))
      .catch((e: unknown) => live && setLayout(e instanceof Error ? e : new Error(String(e))));
    return () => {
      live = false;
    };
  }, [flow, facts, elk]);
  const steps = useMemo(() => flowSteps(flow, stage), [flow, stage]);
  const stops = stopsOf(steps, stage, sel);
  const i = curStep(stops, step);
  const cur = steps[i - 1];
  const scope = scoped(stage, sel);
  const focus = (s: FlowStep) => !scope || inCourse(s, sel!);

  // 再生: ステップごとに待って次へ。最後のステップで reducer が止める
  useEffect(() => {
    if (!play) return;
    const t = setTimeout(() => dispatch({ id: 'map.tick' }), stepMs(speed));
    return () => clearTimeout(t);
  }, [play, i, speed, dispatch]);

  // つまむと地図だけ拡大・縮小（Ctrl 付きの wheel と Safari のピンチ。画面全体の拡大は止める）。描き直した直後に、指の下の点を指の下へ戻す
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const shownZoom = useRef(zoom);
  const askedZoom = useRef(zoom);
  const anchor = useRef<{ clientX: number; clientY: number; px: number; py: number } | null>(null);
  useLayoutEffect(() => {
    shownZoom.current = zoom;
    askedZoom.current = zoom;
    const a = anchor.current;
    anchor.current = null;
    const st = stageRef.current;
    const box = st?.parentElement;
    if (!a || !st || !box) return;
    const r = st.getBoundingClientRect();
    box.scrollLeft += r.left + a.px * zoom - a.clientX;
    box.scrollTop += r.top + a.py * zoom - a.clientY;
  }, [zoom]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ask = (next: number, clientX: number, clientY: number) => {
      if (next === askedZoom.current) return;
      const st = stageRef.current;
      if (st) {
        const r = st.getBoundingClientRect();
        anchor.current = { clientX, clientY, px: (clientX - r.left) / shownZoom.current, py: (clientY - r.top) / shownZoom.current };
      }
      askedZoom.current = next;
      dispatch({ id: 'map.zoom', zoom: next });
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      ask(wheelZoom(askedZoom.current, e.deltaY), e.clientX, e.clientY);
    };
    let start = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      start = askedZoom.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      ask(clampZoom(start * g.scale), g.clientX, g.clientY);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('gesturestart', onGestureStart);
    root.addEventListener('gesturechange', onGestureChange);
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('gesturestart', onGestureStart);
      root.removeEventListener('gesturechange', onGestureChange);
    };
  }, [dispatch]);

  const L = layout && !(layout instanceof Error) && layout.id === flow.id ? layout.L : null;
  // 要求コースの小さい形: 地図全体が窓に収まる倍率（つまむ拡大は効かせない）。窓の幅は測る（測れなければ高さだけで決める）
  const scrollRef = useRef<HTMLDivElement>(null);
  const [winW, setWinW] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!req || !el) return;
    const read = () => setWinW(el.clientWidth);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [req !== undefined]);
  const shown = req && L ? fitScale(L.w, L.h, winW, REQ_MAP_MAX_H) : zoom;
  const counts = statusCounts(flow);
  const mine = scope ? steps.filter((s) => s.dir === 'call' && inCourse(s, sel!)) : [];
  // 段ごとの文（LLM）。コースの範囲の ② はコースの変更の数を出すので、流れ全体の文は出さない（見本どおり）
  const say = scope ? undefined : flow.stages?.[STAGE_KEY[stage]];
  const said = say === undefined ? [] : sentences(say);

  return (
    <div className={req ? 'fmap compact' : 'fmap'} ref={rootRef} style={course ? ({ ['--cc' as string]: `var(--c${course.id})` } as CSSProperties) : undefined}>
      <div className="fm-top">
        {flows.length > 1 ? (
          <span className="fm-flows" role="group" aria-label="処理の流れ">
            <span className="lbl">流れ</span>
            {flows.map((f) => (
              <button key={f.id} type="button" aria-pressed={f.id === flow.id} onClick={() => dispatch({ id: 'map.flow', flowId: f.id })} onKeyDown={stopKeys}>
                <span className={f.titleProvenance === 'llm' ? 'guess' : ''}>{f.title}</span>
              </button>
            ))}
          </span>
        ) : (
          <span className="fm-flow">
            <span className="lbl">流れ</span>
            <b className={flow.titleProvenance === 'llm' ? 'guess' : ''}>{flow.title}</b>
          </span>
        )}
        {!req && <span className="fm-stages" role="group" aria-label="段">
          {STAGES.map((s) => (
            <button key={s.n} type="button" aria-pressed={stage === s.n} onClick={() => dispatch({ id: 'map.stage', stage: s.n })} onKeyDown={stopKeys}>
              <em>{s.title}</em>
              <small>{s.sub}</small>
            </button>
          ))}
          <Key action="home.stage" />
        </span>}
      </div>
      <div className="fm-say">
        {req && scope && mine.length === 0 && <p>この章の差分を通る呼び出しはありません。</p>}
        {course && courseTitle && (
          <p className="fm-ctitle">
            <span className={`cb cc${course.id}`} style={courseBg(course.id)}>
              {course.id}
            </span>
            {`コース ${course.id}: ${course.title}`}
          </p>
        )}
        {scope && !req && <p>{mine.length > 0 ? `このコースの変更は、流れの中の ${mine.length} か所です。色の付いた線がこのコースの変更、灰色はほかのコースの変更です。` : 'このコースの変更は、この流れを通りません。'}</p>}
        {course && !req && !scope && <p className="muted">コースの範囲は ② この PR で出します。</p>}
        {said.length > 0 && (
          <div className="narr ai fm-narr">
            {said.map((t, k) => (
              <p key={k}>
                {k === 0 && <span className="chip ai">AI</span>}
                {t}
              </p>
            ))}
          </div>
        )}
        {stage === 2 && !scope && !req && (
          <div className="fm-chips">
            <span className="fc add">{`足された呼び出し ${counts.added}`}</span>
            <span className="fc chg">{`変わった呼び出し ${counts.changed}`}</span>
            <span className="fc same">{`同じ呼び出し ${counts.same}`}</span>
            <span className="fc del">{`なくなった呼び出し ${counts.removed}`}</span>
          </div>
        )}
        {steps.length === 0 && <p>{stage === 1 ? '変わる前には、この流れはありません（入口が新しく足されました）。' : 'マージ後には、この流れはありません（入口が消されました）。'}</p>}
      </div>
      <div className="fm-mapw">
        <div className="fm-scroll" ref={scrollRef}>
          {layout instanceof Error ? (
            <div className="empty">{`地図を作れませんでした: ${layout.message}`}</div>
          ) : L === null ? (
            <div className="empty">地図を作っています…</div>
          ) : (
            <div className="fm-stage" ref={stageRef} style={{ width: L.w * shown, height: L.h * shown }}>
              <div className="fm-zoom" style={{ width: L.w, height: L.h, transform: `scale(${shown})` }}>
                <MapBody L={L} facts={facts} steps={steps} i={i} stage={stage} sel={sel} focus={focus} speed={speed} play={play} {...(req ? { req } : {})} dispatch={dispatch} />
              </div>
            </div>
          )}
        </div>
        {steps.length > 0 && <Player steps={steps} stops={stops} i={i} play={play} speed={speed} stage={stage} focus={focus} keys={!req} dispatch={dispatch} />}
        <div className="fm-legend">
          {req ? req.legend : ((stage === 2 ? '色は、緑が足された呼び出し、黄が変わった呼び出し、灰が変わる前と同じ呼び出し、赤がなくなった呼び出しです。' : '') +
            (scope ? '薄い灰色はほかのコースの変更で、「次」では止まりません。' : '') +
            '実線が呼び出し、点線が戻りです。玉が今のステップ、番号は呼ばれる順、上の点は呼び出し元です。薄い箱は、この段では呼ばれないクラスです。')}
        </div>
      </div>
      {!req && <div className="fm-bottom">
        {cur ? <StepPane analysis={analysis} facts={facts} step={cur} stage={stage} focus={focus(cur)} dispatch={dispatch} /> : <div className="fm-pane" />}
        <SidePane analysis={analysis} flows={flows} flow={flow} facts={facts} steps={steps} stage={stage} course={course} scope={scope} dispatch={dispatch} />
      </div>}
    </div>
  );
}

interface MapBodyProps {
  L: FlowLayout;
  facts: ReturnType<typeof flowFacts>;
  steps: readonly FlowStep[];
  i: number;
  stage: Stage;
  sel: Scope | null;
  focus: (s: FlowStep) => boolean;
  speed: number;
  play: boolean;
  req?: ReqMapProps;
  dispatch: (c: Command) => void;
}

/** その段のステップの線（根は上の点から、同じ箱の中の呼び出しは無し）。戻りは呼び出しの道を逆に */
function pathOf(L: FlowLayout, s: FlowStep): Pt[] | null {
  const pts = s.call.from === null ? L.entry : L.edges.get(s.call.key);
  if (!pts || pts.length === 0) return null;
  return s.dir === 'ret' ? returnPath(pts) : pts;
}

function MapBody({ L, facts, steps, i, stage, sel, focus, speed, play, req, dispatch }: MapBodyProps) {
  const cur = steps[i - 1];
  const tone = (s: FlowStep): Tone => (stage !== 2 ? 'plain' : !focus(s) ? 'other' : TONE[s.call.status]);
  const scope = scoped(stage, sel);
  // 箱の上の印: 今のステップが着く箱（呼び出しなら呼ばれる側、戻りなら呼ぶ側）
  const hereBox = cur ? (cur.dir === 'call' ? facts.boxIdOf.get(cur.call.to) : cur.call.from === null ? null : facts.boxIdOf.get(cur.call.from)) : null;
  const courseBox: ReadonlySet<string | undefined> = req?.dark ? req.dark.boxes : new Set(scope ? steps.filter((s) => s.dir === 'call' && inCourse(s, sel!)).map((s) => facts.boxIdOf.get(s.call.to)) : []);
  const curPath = cur ? pathOf(L, cur) : null;
  const moveKey = `${stage}|${i}|${play ? 'p' : ''}`;
  const [arrived, setArrived] = useState<string | null>(null);
  const moving = curPath !== null && arrived !== moveKey && !reducedMotion();
  const labels: ReactElement[] = [];
  const lines: ReactElement[] = [];
  for (const s of steps) {
    const when = s.i < i ? 'past' : s.i === i ? 'cur' : 'future';
    const t = tone(s);
    const pts = pathOf(L, s);
    if (pts) lines.push(<polyline key={`${s.i}`} className={`fm-ar ${t} ${when}${s.dir === 'ret' ? ' ret' : ''}`} points={pts.map((p) => p.map(Math.round).join(',')).join(' ')} markerEnd={`url(#fm-m-${t})`} />);
    const at: Pt | null = pts ? midOf(pts) : (() => {
      const r = L.boxes.get(facts.boxIdOf.get(s.call.to) ?? '');
      return r ? [r.x + r.w / 2, r.y + r.h + 14] : null;
    })();
    if (!at || when === 'future') continue;
    if (when === 'cur' && !moving) {
      const text = s.dir === 'ret' ? `↩ ${s.call.after?.returns ?? s.call.before?.returns ?? '（戻り型なし）'}` : pts === null ? `↻ 中で ${callText(s.call, stage) ?? ''}` : (callText(s.call, stage) ?? facts.boxes.find((b) => b.id === facts.boxIdOf.get(s.call.to))?.name ?? '');
      labels.push(
        <span key={`l${s.i}`} className={`fm-lb ${t} cur`} style={{ left: at[0], top: at[1] }}>
          <span className="n">{s.n}</span>
          {text}
        </span>,
      );
    } else if (s.dir === 'call' && when !== 'cur') {
      labels.push(
        <span key={`l${s.i}`} className={`fm-lb ${t} past only`} style={{ left: at[0], top: at[1] }}>
          <span className="n">{s.n}</span>
        </span>,
      );
    }
  }
  const end = curPath ? curPath[curPath.length - 1]! : null;
  // 今のステップの箱が見える所まで地図を送る（段を替えたとき・コースを選んだときも）
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (req) return; // 小さい形は全体が見えている。呼ぶと真ん中の欄までスクロールする
    const el = bodyRef.current?.parentElement?.querySelector<HTMLElement>('.fm-box.cur');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', ...(reducedMotion() ? {} : { behavior: 'smooth' }) });
  }, [hereBox, stage, i]);
  return (
    <>
      <div ref={bodyRef} hidden />
      {L.bands.map((b) => (
        <div key={b.name} className="fm-lane" style={{ top: b.y }}>
          {facts.boxes.find((x) => x.band === b.name)?.layerGuessed ? `${b.name}（推定）` : b.name}
        </div>
      ))}
      {facts.boxes.map((b) => {
        const r = L.boxes.get(b.id);
        if (!r) return null;
        return <BoxView key={b.id} b={b} r={r} stage={stage} here={hereBox === b.id} dim={scope && !courseBox.has(b.id)} {...(req?.boxCmd.has(b.id) ? { onClick: () => dispatch(req.boxCmd.get(b.id)!) } : {})} />;
      })}
      {req?.chips &&
        facts.boxes.flatMap((b) => {
          const r = L.boxes.get(b.id);
          return (req.chips!.get(b.id) ?? []).map((c, k) => (
            <button key={`${b.id}|${c.chapter}`} type="button" className="fm-chip" style={{ left: r ? r.x + 6 + k * 62 : 0, top: r ? r.y + r.h + 9 : 0 }} onClick={() => dispatch({ id: 'req.go', chapter: c.chapter })} onKeyDown={stopKeys}>
              {c.label}
            </button>
          ));
        })}
      <svg className="fm-svg" width={L.w} height={L.h} aria-hidden="true">
        <defs>
          {(['plain', 'same', 'chg', 'add', 'del', 'other'] as const).map((k) => (
            <marker key={k} id={`fm-m-${k}`} className={`fm-mk ${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" />
            </marker>
          ))}
        </defs>
        {L.entry.length > 0 && <circle className="fm-caller" cx={L.entry[0]![0]} cy={L.entry[0]![1]} r="5"><title>呼び出し元</title></circle>}
        {lines}
        {moving && curPath ? (
          <Ball key={moveKey} pts={curPath} ms={moveMs(speed)} back={cur!.dir === 'ret'} onDone={() => setArrived(moveKey)} />
        ) : end ? (
          <circle className={`fm-ball${cur!.dir === 'ret' ? ' back' : ''}`} r="7" cx={end[0]} cy={end[1]} />
        ) : null}
      </svg>
      {labels}
    </>
  );
}

function BoxView({ b, r, stage, here, dim, onClick }: { b: FlowBox; r: { x: number; y: number; w: number; h: number }; stage: Stage; here: boolean; dim: boolean; onClick?: () => void }) {
  const ghost = stage === 1 && b.diff === 'added';
  const idle = !ghost && !b.used[stage];
  const tone = stage === 2 && !dim ? (b.diff === 'added' ? ' add' : b.diff === 'changed' ? ' chg' : '') : '';
  const tag = stage === 2 ? DIFF_TAG[b.diff] : undefined;
  return (
    <div
      className={`fm-box${ghost ? ' ghost' : idle ? ' idle' : dim ? ' dimc' : ''}${tone}${here ? ' cur' : ''}${onClick ? ' click' : ''}`}
      data-id={b.id}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
      {...(onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e: KeyboardEvent) => { stopKeys(e); if (e.key === 'Enter' || e.key === ' ') onClick(); } } : {})}
    >
      <div className="nm">
        <span title={b.id}>{b.name}</span>
        {tag && <span className={`tagb ${b.diff}`}>{tag}</span>}
      </div>
      {ghost ? (
        <span className="fm-m">まだありません</span>
      ) : (
        b.members
          .filter((m) => stage === 2 || m.stages[stage])
          .map((m) => (
            <span key={`${m.sym}|${m.name}`} className={`fm-m${stage === 2 && !dim ? ` ${m.diff}` : ''}`}>
              {stage === 2 && m.diff === 'added' ? `＋ ${m.name}` : m.name}
            </span>
          ))
      )}
      {idle && <span className="fm-m note">この段では呼ばれません</span>}
    </div>
  );
}

/** 玉。線の上を呼ぶ側から呼ばれる側へ（戻りは逆へ）走る（React の外で毎フレーム属性を書く） */
function Ball({ pts, ms, back, onDone }: { pts: Pt[]; ms: number; back: boolean; onDone: () => void }) {
  const ref = useRef<SVGCircleElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - t) ** 3;
      const [x, y] = along(pts, e);
      ref.current?.setAttribute('cx', String(x));
      ref.current?.setAttribute('cy', String(y));
      if (t < 1) raf = requestAnimationFrame(frame);
      else done.current();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [pts, ms]);
  return <circle ref={ref} className={`fm-ball${back ? ' back' : ''}`} r="7" cx={pts[0]![0]} cy={pts[0]![1]} />;
}

interface PlayerProps {
  steps: readonly FlowStep[];
  stops: readonly number[];
  i: number;
  play: boolean;
  speed: number;
  stage: Stage;
  focus: (s: FlowStep) => boolean;
  /** ← / → のキーの表示を出すか（要求コースでは ← / → は章の移動なので出さない） */
  keys: boolean;
  dispatch: (c: Command) => void;
}

/** 再生の帯: ▶・前・次・ステップの帯・n/全部・速さ */
function Player({ steps, stops, i, play, speed, stage, focus, keys, dispatch }: PlayerProps) {
  const first = stops[0] ?? 0;
  const last = stops[stops.length - 1] ?? 0;
  return (
    <div className="fm-play" role="group" aria-label="再生">
      <button type="button" className="pb" onClick={() => dispatch({ id: 'map.play' })} onKeyDown={stopKeys}>
        {play ? '■ 止める' : '▶ 再生'}
      </button>
      <button type="button" className="pb" disabled={i <= first} onClick={() => dispatch({ id: 'map.prev' })} onKeyDown={stopKeys}>
        ◀ 前 {keys && <Key action="course.prev" />}
      </button>
      <button type="button" className="pb" disabled={i >= last} onClick={() => dispatch({ id: 'map.next' })} onKeyDown={stopKeys}>
        次 ▶ {keys && <Key action="course.forward" />}
      </button>
      <span className="fm-ticks">
        {steps.map((s) => {
          const t = stage !== 2 ? 'plain' : !focus(s) ? 'other' : TONE[s.call.status];
          return (
            <button
              key={s.i}
              type="button"
              aria-label={`ステップ ${s.i}`}
              className={`${t}${s.dir === 'ret' ? ' r' : ''}${s.i <= i ? ' done' : ''}${s.i === i ? ' cur' : ''}`}
              onClick={() => dispatch({ id: 'map.step', to: s.i })}
              onKeyDown={stopKeys}
            />
          );
        })}
      </span>
      <span className="fm-n">{`${i}/${steps.length}`}</span>
      <SpeedControl speed={speed} dispatch={dispatch} />
    </div>
  );
}

/** 再生の速さのつまみ。動かしている間は画面の数だけ変え、止まってから保存する（ui.json への書き込みを減らす） */
function SpeedControl({ speed, dispatch }: { speed: number; dispatch: (c: Command) => void }) {
  const [spd, setSpd] = useState(speed);
  useEffect(() => setSpd(speed), [speed]);
  useEffect(() => {
    if (spd === speed) return;
    const t = setTimeout(() => dispatch({ id: 'map.speed', speed: spd }), 250);
    return () => clearTimeout(t);
  }, [spd, speed, dispatch]);
  return (
    <label className="fm-spd" title="再生の速さ（0.5 刻みの数に吸い付く）">
      <input
        type="range"
        min={SPEED_MIN}
        max={SPEED_MAX}
        step={0.01}
        value={spd}
        list="fm-spd-snap"
        aria-label="再生の速さ"
        onChange={(e) => setSpd(snapSpeed(Number(e.target.value)))}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <datalist id="fm-spd-snap">
        {SPEED_SNAP.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <span className="v">{`${+spd.toFixed(2)}×`}</span>
    </label>
  );
}

/** 箱の名前とメンバー（「OrderController.apply」）。根の呼び出し元は「呼び出し元」 */
function nameOf(analysis: Analysis, facts: ReturnType<typeof flowFacts>, sym: string | null): string {
  if (sym === null) return '呼び出し元';
  const box = facts.boxes.find((b) => b.id === facts.boxIdOf.get(sym));
  const m = box?.members.find((x) => x.sym === sym);
  const s = analysis.symbols.find((x) => x.id === sym);
  if (!box) return s?.fqName.split('.').slice(-2).join('.') ?? sym;
  return m && m.name !== box.name ? `${box.name}.${m.name}` : box.name;
}

function StepPane({ analysis, facts, step, stage, focus, dispatch }: { analysis: Analysis; facts: ReturnType<typeof flowFacts>; step: FlowStep; stage: Stage; focus: boolean; dispatch: (c: Command) => void }) {
  const c = step.call;
  const code = stepCode(analysis, c, stage);
  const ret = step.dir === 'ret';
  const returns = c.after?.returns ?? c.before?.returns;
  const head = ret ? `${nameOf(analysis, facts, c.to)} → ${nameOf(analysis, facts, c.from)}  ↩ ${returns ?? '（戻り型なし）'}` : `${nameOf(analysis, facts, c.from)} → ${nameOf(analysis, facts, c.to)}`;
  // 差分一覧で開く hunk: 呼んでいる行のある呼ぶ側（根は入口）
  const owner = analysis.symbols.find((s) => s.id === (c.from ?? c.to));
  const hunkId = owner?.changed ? (owner.hunkId ?? owner.id) : null;
  const callTxt = callText(c, stage);
  return (
    <div className="fm-pane fm-step" aria-label="今のステップ">
      <h3>
        {`ステップ ${step.i}`}
        {ret && <span className="fc same">戻り</span>}
        {stage === 2 && <span className={`fc ${focus ? TONE[c.status] : 'same'}`}>{focus ? STATUS_TEXT[c.status] : 'ほかのコースの変更'}</span>}
      </h3>
      <p className="fm-head">{head}</p>
      {!ret && callTxt && <p className="fm-call">{callTxt}</p>}
      {code ? (
        <div className="fm-code">
          <span className="f">{code.path}</span>
          {code.rows.map((r, k) => (
            <span key={k} className={`${r.k === '+' ? 'a' : r.k === '-' ? 'd' : 'x'}${r.hot ? ' hot' : ''}`}>
              {`${r.k === ' ' ? ' ' : r.k}${r.text}`}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted">この呼び出しの行は解析に入っていません。</p>
      )}
      {!ret && c.cut && <p className="muted">… この先は省略しました（深さの上限か、呼び出しが輪になっています）。</p>}
      {hunkId && (
        <button type="button" className="btn sm" onClick={() => dispatch({ id: 'diff.open', hunkId })} onKeyDown={stopKeys}>
          差分一覧で開く
        </button>
      )}
    </div>
  );
}

interface SidePaneProps {
  analysis: Analysis;
  flows: readonly CallFlow[];
  flow: CallFlow;
  facts: ReturnType<typeof flowFacts>;
  steps: readonly FlowStep[];
  stage: Stage;
  course: Course | null;
  scope: boolean;
  dispatch: (c: Command) => void;
}

function SidePane({ analysis, flows, flow, facts, steps, stage, course, scope, dispatch }: SidePaneProps) {
  const outside = useMemo(() => outsideOf(analysis, flows), [analysis, flows]);
  if (scope && course) {
    const mine = steps.filter((s) => s.dir === 'call' && inCourse(s, course.id));
    const out = outside.items.filter((x) => x.courses.includes(course.id));
    return (
      <div className="fm-pane fm-side">
        <h3>{`コース ${course.id} で変わる所`}</h3>
        {mine.length === 0 && <p className="muted">この流れの呼び出しにはありません。</p>}
        <ul className="fm-list">
          {mine.map((s) => (
            <li key={s.i}>
              <button type="button" onClick={() => dispatch({ id: 'map.step', to: s.i })} onKeyDown={stopKeys}>
                <span className={`fc ${TONE[s.call.status]}`}>{STATUS_TEXT[s.call.status]}</span>
                {`ステップ ${s.i}  ${callText(s.call, 2) ?? nameOf(analysis, facts, s.call.to)}`}
              </button>
            </li>
          ))}
        </ul>
        {out.length > 0 && (
          <>
            <h3>流れの外</h3>
            <OutsideList items={out} dispatch={dispatch} />
          </>
        )}
      </div>
    );
  }
  if (stage === 2) {
    return (
      <div className="fm-pane fm-side">
        <h3>流れの外の変更</h3>
        {outside.items.length === 0 && outside.tests.n === 0 && <p className="muted">全部の差分が流れの上にあります。</p>}
        <OutsideList items={outside.items} dispatch={dispatch} />
        {outside.tests.n > 0 && outside.tests.hunkId && (
          <button type="button" className="fm-tests" onClick={() => dispatch({ id: 'diff.open', hunkId: outside.tests.hunkId! })} onKeyDown={stopKeys}>
            {`テスト ${outside.tests.n} か所`}
          </button>
        )}
      </div>
    );
  }
  if (stage === 1) {
    const used = facts.boxes.filter((b) => b.used[1]).map((b) => b.name);
    const later = facts.boxes.filter((b) => !b.used[1]);
    return (
      <div className="fm-pane fm-side">
        <h3>この流れに出てくるクラス</h3>
        <p className="muted">{used.length > 0 ? used.join(' → ') : '変わる前には、この流れはありません。'}</p>
        {later.length > 0 && (
          <p className="muted">
            {`変わる前は呼ばれないクラス: ${later.map((b) => `${b.name}${b.diff === 'added' ? '（新しいクラス）' : ''}`).join('、')}`}
          </p>
        )}
      </div>
    );
  }
  const calls = allCalls(flow).filter((c) => c.from !== null);
  const n1 = calls.filter((c) => inStage(c, 1)).length;
  const n3 = calls.filter((c) => inStage(c, 3)).length;
  const k = statusCounts(flow);
  return (
    <div className="fm-pane fm-side">
      <h3>変わる前との違い</h3>
      <p className="muted">{`呼び出しは ${n1} → ${n3} になりました。足された呼び出しが ${k.added}、なくなった呼び出しが ${k.removed}、変わった呼び出しが ${k.changed} です。② で 1 ステップずつ見られます。`}</p>
    </div>
  );
}

function OutsideList({ items, dispatch }: { items: ReturnType<typeof outsideOf>['items']; dispatch: (c: Command) => void }) {
  return (
    <ul className="fm-out">
      {items.map((x) => (
        <li key={x.hunkId}>
          <button type="button" onClick={() => dispatch({ id: 'diff.open', hunkId: x.hunkId })} onKeyDown={stopKeys}>
            <span className={`fc ${x.diff === 'added' ? 'add' : x.diff === 'removed' ? 'del' : 'chg'}`}>{DIFF_TAG[x.diff === 'none' ? 'changed' : x.diff]}</span>
            <b>{x.label}</b>
            <small>{x.sub}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}
