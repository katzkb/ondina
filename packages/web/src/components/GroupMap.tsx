// 入口の地図（設計書 3.1。2026-11-03 の見本 5 の形、分け方は案 A）。全景に変更のまとまりを並べ、押すとその中に入る。中は箱（差分のあるファイルか束）。
// 図の外の相手は点線の札（押すとそのまとまりへ）。上にパンくず、名前の共通の語は「…」で省いて下に書く。
// 箱を押すとその箱のコースを選ぶ（下のコースの並びと同じ home.select）。「差分なし n」は差分の無い相手の引き出し（rel.open）。
// コースを選ぶと、いま見ている段の図の上に道順を流す（2026-11-04。見本 5 の 2 版）。箱の左上に停留所の番号、線はコースの色、
// 今の歩の箱の下に札（中に入れる箱なら「… の中で見る」）。下に再生の帯（▶・前・次・歩の帯・速さ）。
// 動きを選ぶと、同じ図の上に呼び出しの矢印を流し、シーケンス図に切り替えられる（BehaviorFlow.tsx）。
// 押した物は全部コマンド（原則 6）。描くだけで、事実は view.ts、道順は flow.ts が組む（原則 3・5）
import type { Analysis, Behavior, MapGroups, ReviewState } from '@ondina/model';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Command } from '../commands/commands.js';
import { courseBg, OUTSIDE, stopInfo, type Course, type Narration } from '../course.js';
import { workerElk } from '../map/elk.js';
import { NO_LAYER } from '../map/graph.js';
import { behaviorSteps, flowDraw, seqLayout, seqRows } from '../map/groupmap/behavior.js';
import { mapRouteOf, moveMs, routeDraw, stepMs, whereTo, type MapRoute, type RouteDraw } from '../map/groupmap/flow.js';
import { layoutView, midOf, textW, type PlacedItem, type PlacedView } from '../map/groupmap/layout.js';
import { crumbName, groupName, leavesOf, litBy, mapFacts, pathTo, ROOT, viewOf, type MapFacts } from '../map/groupmap/view.js';
import type { ElkLike } from '../map/layout.js';
import { clampZoom, wheelZoom } from '../map/zoom.js';
import { BehaviorPicker, BehaviorPlayer, bandNameOf, FlowLayer, inCardAt, SeqView } from './BehaviorFlow.js';
import { ccOf, reducedMotion, Short, SpeedControl, stopKeys, Token } from './gmapParts.js';
import { Key } from './Key.js';

const ZOOMS = [0.5, 0.7, 1] as const;

/** Safari だけのピンチのイベント（標準外。scale はつまみ始めからの比） */
type GestureEvent = Event & { scale: number; clientX: number; clientY: number };

export interface GroupMapProps {
  analysis: Analysis;
  mapGroups: MapGroups;
  /** 見ているまとまりの道筋（home.path） */
  path: readonly string[];
  /** 選んでいるコース（home.sel） */
  sel: number | null;
  /** 選んでいるコース（道順を流す）。コース外も道順にする */
  course: Course | null;
  review: ReviewState;
  /** 道順の今の歩（home.step。0 = 全部）と再生中か（home.play） */
  step: number;
  play: boolean;
  /** 再生の速さ（ui.mapSpeed） */
  speed: number;
  /** 選んでいる動き（home.behavior）。コースとどちらか 1 つ */
  behavior: Behavior | null;
  /** 動きの見せ方（home.mode）と、矢印の札に引数を全部出すか（home.args） */
  mode: 'map' | 'seq';
  args: boolean;
  zoom: number;
  dispatch: (c: Command) => void;
  /** 差し替えはテスト用（jsdom に Web Worker が無い） */
  elk?: () => ElkLike;
}

const label = (c: number) => (c === OUTSIDE ? '外' : String(c));
const Dots = ({ cs }: { cs: readonly number[] }) => (
  <span className="gdots">
    {cs.map((c) => (
      <span key={c} className={`cb sm cc${c}`} style={courseBg(c)} title={c === OUTSIDE ? 'コース外' : `コース ${c}`}>
        {label(c)}
      </span>
    ))}
  </span>
);

export function GroupMap({ analysis, mapGroups, path, sel, course, review, step, play, speed, behavior, mode, args, zoom, dispatch, elk = workerElk }: GroupMapProps) {
  const facts = useMemo(() => mapFacts(analysis, mapGroups), [analysis, mapGroups]);
  const at = path[path.length - 1] ?? ROOT;
  const labelOf = useMemo(() => (id: string) => facts.tree.boxes.get(id)?.label ?? id, [facts]);
  const nameOf = useMemo(() => (id: string) => {
    const g = facts.tree.groups.get(id);
    return g ? groupName(analysis, g) : { text: labelOf(id), guess: false };
  }, [analysis, facts, labelOf]);
  const [placed, setPlaced] = useState<PlacedView | Error | null>(null);
  const cache = useRef(new Map<string, PlacedView>());
  const prev = useRef<{ at: string; view: PlacedView } | null>(null);
  const [anim, setAnim] = useState<{ cls: 'zin' | 'zout'; ox: number; oy: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cache.current = new Map();
    prev.current = null;
  }, [facts]);

  useEffect(() => {
    let off = false;
    const hit = cache.current.get(at);
    const done = (v: PlacedView) => {
      if (off) return;
      cache.current.set(at, v);
      setAnim(motion(facts, prev.current, v));
      prev.current = { at, view: v };
      setPlaced(v);
    };
    if (hit) done(hit);
    else
      Promise.resolve()
        .then(() => layoutView(viewOf(facts, labelOf, at), elk(), (id) => nameOf(id).text))
        .then(done, (e: unknown) => !off && setPlaced(e instanceof Error ? e : new Error(String(e))));
    return () => {
      off = true;
    };
  }, [facts, at, elk, labelOf, nameOf]);

  // 倍率とつまむ操作は CourseMap と同じ（設計書 3.3）。描き直した直後に、指の下の点を指の下へ戻す
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
      const g = e as GestureEvent;
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

  const view = placed instanceof Error || placed === null ? null : placed;
  const lit = view ? litBy(facts, view.spec, sel) : null;
  const route = useMemo(() => (course ? mapRouteOf(analysis, facts.tree, course) : null), [analysis, facts, course]);
  const draw = view && route ? routeDraw(facts.tree, view, route, step) : null;
  const [paneW, setPaneW] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => setPaneW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const bsteps = useMemo(() => (behavior ? behaviorSteps(analysis, facts.tree, behavior) : null), [analysis, facts, behavior]);
  const fdraw = view && bsteps ? flowDraw(facts.tree, view, bsteps, step) : null;
  const seq = useMemo(() => {
    if (!view || !bsteps || !behavior || mode !== 'seq') return null;
    const rows = seqRows(facts.tree, view.spec, behavior, bsteps);
    // 幅は地図の枠いっぱい（長い呼び出しの式を切らない）
    return { rows, layout: seqLayout(view, rows, Math.max(680, view.w, Math.floor((paneW - 4) / zoom))) };
  }, [view, bsteps, behavior, mode, facts, paneW, zoom]);
  const curLine = draw?.lines.find((l) => l.state === 'cur') ?? (seq ? null : fdraw?.cur?.arrow) ?? null;
  // 今の歩の線を玉が動き終わったら、着いた箱を光らせて札を出す（動きを減らす設定では玉を出さずすぐ）
  const moveKey = `${view?.spec.at ?? ''}|${course?.id ?? behavior?.id ?? ''}|${step}|${mode}`;
  const [arrived, setArrived] = useState<string | null>(null);
  const moving = curLine !== null && arrived !== moveKey && !reducedMotion();
  const says = course && route && draw?.cur ? route.steps[draw.cur.n - 1]!.stops.map((k) => stopInfo(analysis, course, k, review).say) : [];
  const card = view && draw?.cur && !moving ? cardAt(view, view.items.find((it) => it.id === draw.cur!.item)!, says) : null;
  const fcur = fdraw?.cur;
  const fcard = view && fcur && !moving && fcur.place.t === 'in' && fcur.place.at !== null ? inCardAt(view, view.items.find((it) => it.id === (fcur.place as { at: string }).at)!, fcur.step, args) : null;
  // 動きで今の歩が着いた item（矢印の先。呼び出し元へ戻る矢印は無いので CALLER にならない）
  const fhot = fcur && !moving ? (fcur.place.t === 'arrow' ? fcur.place.b : fcur.place.at) : null;
  // 札は箱の下に出す。図の下にはみ出す分だけ図を伸ばす（上に出すと箱と線を隠す）
  const below = card ?? fcard;
  const h = seq ? seq.layout.h : view ? Math.max(view.h, below ? below.top + below.h + 8 : 0) : 0;
  const w = seq ? seq.layout.w : (view?.w ?? 0);
  const bandName = useMemo(() => bandNameOf(analysis, facts.bands), [analysis, facts]);

  // 地図とシーケンス図を切り替えたら、箱を元の場所から新しい場所へ動かす（同じ data-id の箱と列の頭。見本 5 の morph）
  const geom = useRef<{ key: string; mode: string; rects: Map<string, { x: number; y: number; w: number; h: number }> } | null>(null);
  useLayoutEffect(() => {
    if (!view) return;
    const rects = new Map((seq ? seq.layout.lanes : view.items).map((r) => [r.id, { x: r.x, y: r.y, w: r.w, h: r.h }]));
    const key = `${view.spec.at}|${behavior?.id ?? ''}`;
    const before = geom.current;
    geom.current = { key, mode: seq ? 'seq' : 'map', rects };
    const root = rootRef.current;
    if (!root || !before || before.key !== key || before.mode === geom.current.mode || reducedMotion()) return;
    const els = [...root.querySelectorAll<HTMLElement>('.vw [data-id]')].filter((el) => before.rects.has(el.dataset.id!) && rects.has(el.dataset.id!));
    for (const el of els) {
      const a = before.rects.get(el.dataset.id!)!;
      const b = rects.get(el.dataset.id!)!;
      el.style.transition = 'none';
      el.style.transformOrigin = '0 0';
      el.style.transform = `translate(${a.x - b.x}px,${a.y - b.y}px) scale(${a.w / (b.w || 1)},${a.h / (b.h || 1)})`;
    }
    const raf = requestAnimationFrame(() => {
      for (const el of els) {
        el.style.transition = 'transform .5s cubic-bezier(.3,.7,.2,1)';
        el.style.transform = '';
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [view, seq, behavior]);

  // 再生: 歩ごとに待って次へ。最後の歩で reducer が止める
  useEffect(() => {
    if (!play) return;
    const t = setTimeout(() => dispatch({ id: 'map.tick' }), stepMs(speed));
    return () => clearTimeout(t);
  }, [play, step, speed, dispatch]);
  const crumbs = [ROOT, ...path];
  const guessShown = view?.spec.kind === 'groups' && view.items.some((it) => it.kind === 'group' && nameOf(it.id).guess);
  const behaviors = analysis.behaviors ?? [];

  return (
    <div className="cmap gmap" ref={rootRef} style={course ? ccOf(course.id) : undefined}>
      <div className="hd">
        <nav className="crumbs" aria-label="地図の場所">
          {crumbs.map((id, k) => (
            <Fragment key={id}>
              {k > 0 && <span className="csep">›</span>}
              {k === crumbs.length - 1 ? (
                <b aria-current="location">{crumbName(analysis, facts.tree, id)}</b>
              ) : (
                <button type="button" onClick={() => dispatch({ id: 'map.enter', group: id })}>
                  {crumbName(analysis, facts.tree, id)}
                </button>
              )}
            </Fragment>
          ))}
        </nav>
        <span>{at === ROOT ? 'まとまりを押すと中に入る' : 'Esc で 1 段上 · 箱を押すとそのコースを選ぶ'}</span>
        <span className="sp">
          <span className="seg" aria-label="倍率">
            {ZOOMS.map((z) => (
              <button key={z} type="button" className={zoom === z ? 'on' : ''} onClick={() => dispatch({ id: 'map.zoom', zoom: z })}>
                {`${Math.round(z * 100)}%`}
              </button>
            ))}
          </span>
        </span>
      </div>
      {behaviors.length > 0 && mapGroups.boxes.length > 0 && <BehaviorPicker behaviors={behaviors} sel={behavior?.id ?? null} dispatch={dispatch} />}
      {mapGroups.boxes.length === 0 ? (
        <div className="empty">地図に載せる変更がありません</div>
      ) : placed instanceof Error ? (
        <div className="empty danger">地図を作れませんでした: {placed.message}</div>
      ) : (
        <>
          {view === null && <div className="empty">地図を作っています…</div>}
          {view && (
            <div className="map">
              <div className="gstage" ref={stageRef} style={{ width: w * zoom, height: h * zoom }}>
                <div className="gzoom" style={{ width: w, height: h, transform: `scale(${zoom})` }}>
                  <div
                    key={view.spec.at}
                    className={`vw${anim ? ` ${anim.cls}` : ''}`}
                    style={{ width: w, height: seq ? h : view.h, ...(anim ? { transformOrigin: `${anim.ox}px ${anim.oy}px` } : {}) }}
                    role="group"
                    aria-label={`${seq ? 'シーケンス図' : '地図'}: ${crumbName(analysis, facts.tree, view.spec.at)}`}
                  >
                    {seq && bsteps ? (
                      <SeqView view={view} facts={facts} steps={bsteps} rows={seq.rows} layout={seq.layout} step={step} args={args} nameOf={nameOf} bandName={bandName} dispatch={dispatch} />
                    ) : (
                      <>
                      <Bands view={view} bands={facts.bands} analysis={analysis} />
                      <Edges view={view} dim={lit !== null} />
                      {view.items.map((it) => (
                        <Item
                          key={it.id}
                          it={it}
                          facts={facts}
                          name={nameOf(it.id)}
                          dim={fdraw ? !fdraw.used.has(it.id) : lit !== null && !lit.has(it.id) && !(draw?.badges.has(it.id) ?? false)}
                          lit={(lit?.has(it.id) ?? false) && !(draw?.cur?.item === it.id && !moving)}
                          hot={(draw?.cur?.item === it.id && !moving) || fhot === it.id}
                          dispatch={dispatch}
                        />
                      ))}
                      {draw && course && route && (
                        <RouteLayer
                          view={view}
                          draw={draw}
                          course={course}
                          route={route}
                          facts={facts}
                          analysis={analysis}
                          says={says}
                          card={card}
                          moving={moving ? moveKey : null}
                          speed={speed}
                          onArrive={setArrived}
                          dispatch={dispatch}
                        />
                      )}
                      {fdraw && <FlowLayer view={view} facts={facts} analysis={analysis} draw={fdraw} args={args} moving={moving ? moveKey : null} speed={speed} onArrive={setArrived} dispatch={dispatch} />}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {view && behavior && bsteps && <BehaviorPlayer view={view} facts={facts} analysis={analysis} behavior={behavior} steps={bsteps} step={step} play={play} speed={speed} mode={mode} dispatch={dispatch} />}
          {view && course && route && <Player view={view} facts={facts} analysis={analysis} course={course} route={route} review={review} step={step} play={play} speed={speed} dispatch={dispatch} />}
          <div className="legend">
            {view && view.spec.common.length > 0 && (
              <span className="gcommon">
                名前の … は、この中の名前に共通の語
                {view.spec.common.map((t) => (
                  <code key={t}>{t}</code>
                ))}
              </span>
            )}
            <span>丸の色と番号 = コース（外 = どのコースにも入らない差分）</span>
            {course && <span>箱の左上の番号 = 選んだコースの停留所の順</span>}
            {behavior && <span>矢印の札 = 呼び出し（押すと引数を出す）· ↩ = 戻り型 · 灰色の点 = 呼び出し元</span>}
            <span>点線の札 = ほかのまとまりとの呼び出し（押すとそこへ）</span>
            <span>「差分なし n」= 差分のない相手（押すと右に出す）</span>
            {guessShown && (
              <span>
                <span className="guess">点線の下線の名前</span>は AI の推定
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** 前の図から次の図へ: 中に入るときは押した箱の所から広げ、上へ戻るときは元いたまとまりの所へ縮める */
function motion(facts: MapFacts, from: { at: string; view: PlacedView } | null, to: PlacedView): { cls: 'zin' | 'zout'; ox: number; oy: number } | null {
  if (!from || from.at === to.spec.at) return null;
  const center = (r: PlacedItem) => ({ ox: r.x + r.w / 2, oy: r.y + r.h / 2 });
  const under = (top: string, x: string) => {
    for (let y: string | undefined = x; y !== undefined; y = facts.tree.parent.get(y)) if (y === top) return true;
    return top === ROOT;
  };
  // 入った先（またはその上）が前の図にあれば、そこから広げる
  const into = from.view.items.find((it) => under(it.id, to.spec.at));
  if (into) return { cls: 'zin', ...center(into) };
  // 前の図（またはその上）が次の図にあれば、そこへ縮める
  const back = to.items.find((it) => under(it.id, from.at));
  if (back) return { cls: 'zout', ...center(back) };
  return null;
}

function Bands({ view, bands, analysis }: { view: PlacedView; bands: readonly string[]; analysis: Analysis }) {
  if (view.spec.kind !== 'boxes') return null;
  // 構成の推定から来た帯は「（推定）」（原則 2）
  const guessed = analysis.config.layers.length === 0 && (analysis.structure?.layers?.length ?? 0) > 0;
  return (
    <>
      {view.bands.map((b) => {
        const name = bands[b.layer] ?? NO_LAYER;
        return (
          <div key={b.layer} className="gband" style={{ top: b.y }}>
            {guessed && name !== NO_LAYER ? `${name}（推定）` : name}
          </div>
        );
      })}
    </>
  );
}

function Edges({ view, dim }: { view: PlacedView; dim: boolean }) {
  return (
    <>
      <svg className="gedges" width={view.w} height={view.h} aria-hidden="true">
        <defs>
          <marker id="garrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        {view.edges.map((e) => (
          <polyline key={`${e.a}>${e.b}`} className={`ged${e.portal ? ' portal' : ''}${dim ? ' dim' : ''}`} points={e.pts.map((p) => p.join(',')).join(' ')} markerEnd="url(#garrow)" />
        ))}
      </svg>
      {view.edges
        .filter((e) => e.n > 1 && e.pts.length > 1)
        .map((e) => {
          const [x, y] = midOf(e.pts);
          return (
            <span key={`n${e.a}>${e.b}`} className={`gcnt${dim ? ' dim' : ''}`} style={{ left: x, top: y }} title={`呼び出し ${e.n} か所`}>
              {e.n}
            </span>
          );
        })}
    </>
  );
}

interface ItemProps {
  it: PlacedItem;
  facts: MapFacts;
  name: { text: string; guess: boolean };
  dim: boolean;
  lit: boolean;
  /** 道順の今の歩が載っている */
  hot: boolean;
  dispatch: (c: Command) => void;
}

function Item({ it, facts, name, dim, lit, hot, dispatch }: ItemProps) {
  const pos: CSSProperties = { left: it.x, top: it.y, width: it.w, height: it.h };
  const state = `${dim ? ' dim' : ''}${lit ? ' lit' : ''}${hot ? ' hot' : ''}`;
  if (it.kind === 'portal') {
    // 札は、相手を含むまとまりへ移る。箱の札（木の作りでは出ない）はその箱の親へ
    const go = facts.tree.groups.has(it.id) ? it.id : (facts.tree.parent.get(it.id) ?? ROOT);
    return (
      <button type="button" className={`gn portal${state}`} data-id={it.id} style={pos} title={`${name.text} に入る`} onClick={() => dispatch({ id: 'map.enter', group: go })} onKeyDown={stopKeys}>
        <span className={name.guess ? 'guess' : ''}>{name.text}</span>
        <i>›</i>
      </button>
    );
  }
  if (it.kind === 'group') {
    const leaves = leavesOf(facts.tree, it.id);
    const fs = leaves.map((b) => facts.box.get(b.id)!);
    const courses = [...new Set(leaves.map((b) => b.course))].sort((a, b) => (a === OUTSIDE ? 1 : b === OUTSIDE ? -1 : a - b));
    const hunks = fs.reduce((s, f) => s + f.hunks, 0);
    const rel = fs.reduce((s, f) => s + f.rel, 0);
    const layers = [...new Set(fs.map((f) => f.layer))].sort((a, b) => a - b);
    return (
      <button type="button" className={`gn group${fs.every((f) => f.added) ? ' add' : ''}${state}`} data-id={it.id} style={pos} onClick={() => dispatch({ id: 'map.enter', group: it.id })} onKeyDown={stopKeys}>
        <span className="gn-h">
          <b className={name.guess ? 'guess' : ''}>{name.text}</b>
          <Dots cs={courses} />
        </span>
        <span className="gn-n">{`箱 ${leaves.length} · 差分 ${hunks}${rel > 0 ? ` · 差分なし ${rel}` : ''}`}</span>
        <span className="gmini" title="点は箱。行は層（上から順）">
          {layers.map((L) => (
            <span key={L} className="mr">
              {fs
                .filter((f) => f.layer === L)
                .map((f) => (
                  <i key={f.id} className={f.added ? 'add' : ''} />
                ))}
            </span>
          ))}
        </span>
        <span className="gn-go">›</span>
      </button>
    );
  }
  const f = facts.box.get(it.id)!;
  const box = facts.tree.boxes.get(it.id)!;
  const first = box.course;
  const tag = [f.added ? '新規' : '', f.bundle ? `追従 ${f.bundle.members} 件` : ''].filter(Boolean);
  return (
    <>
      <button
        type="button"
        className={`gn box${f.added ? ' add' : ''}${f.bundle ? ' bundle' : ''}${state}`}
        data-id={it.id}
        style={pos}
        title={box.path ?? box.label}
        onClick={() => dispatch({ id: 'home.select', courseId: first })}
        onKeyDown={stopKeys}
      >
        <span className="gn-tag">
          {tag.map((t) => (
            <span key={t} className="mk">
              {t}
            </span>
          ))}
          {f.bundle && f.bundle.deviations > 0 && <span className="mk dev">{`差異あり ${f.bundle.deviations}`}</span>}
          <Dots cs={f.courses} />
        </span>
        <b className="cn">
          <Short text={it.short ?? box.label} />
        </b>
        {!f.bundle && <code>{f.members.join(' · ')}</code>}
      </button>
      {f.rel > 0 && (
        <button type="button" className={`grel${state}`} style={{ left: it.x + it.w - 6, top: it.y - 9 }} onClick={() => dispatch({ id: 'rel.open', host: it.id })} onKeyDown={stopKeys}>
          {`差分なし ${f.rel}`}
        </button>
      )}
    </>
  );
}

interface RouteLayerProps {
  view: PlacedView;
  draw: RouteDraw;
  course: Course;
  route: MapRoute;
  facts: MapFacts;
  analysis: Analysis;
  /** 今の歩の停留所の文と、札の場所 */
  says: Narration[];
  card: CardBox | null;
  /** 玉が動いている歩の鍵（動いていなければ null） */
  moving: string | null;
  speed: number;
  onArrive: (key: string) => void;
  dispatch: (c: Command) => void;
}

/** 道順: 線（コースの色。今の歩は太く、玉が前の箱から動く）・箱の左上の番号・今の歩の札 */
function RouteLayer({ view, draw, course, route, facts, analysis, says, card, moving, speed, onArrive, dispatch }: RouteLayerProps) {
  const byId = new Map(view.items.map((it) => [it.id, it]));
  const cur = draw.cur;
  const curLine = draw.lines.find((l) => l.state === 'cur');
  return (
    <>
      <svg className="groute" width={view.w} height={view.h} style={ccOf(course.id)} aria-hidden="true">
        <defs>
          <marker id="grarrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        {draw.lines.map((l) => (
          <polyline key={l.n} className={`grt ${l.state}`} points={l.pts.map((p) => p.map(Math.round).join(',')).join(' ')} markerEnd="url(#grarrow)" />
        ))}
        {moving !== null && curLine && <Token key={moving} pts={curLine.pts} ms={moveMs(speed)} onDone={() => onArrive(moving)} />}
      </svg>
      {[...draw.badges].map(([id, list]) => {
        const r = byId.get(id)!;
        return (
          <span key={id} className="gsbs" data-for={id} style={{ ...ccOf(course.id), left: r.x + 8, top: r.y - 9 }}>
            {list.map((b) => (
              <span key={b.n} className={`gsb ${b.state}`}>
                {b.n}
              </span>
            ))}
          </span>
        );
      })}
      {cur && card && <StepCard view={view} item={byId.get(cur.item)!} n={cur.n} box={route.steps[cur.n - 1]!.box} says={says} card={card} course={course} facts={facts} analysis={analysis} dispatch={dispatch} />}
    </>
  );
}

const CARD_W = 330;

interface CardBox {
  left: number;
  top: number;
  /** 見積もりの高さ（図を伸ばす分） */
  h: number;
}

/** 今の歩の札の場所。箱の下（図の右端を越えないよう左へ寄せる） */
function cardAt(view: PlacedView, item: PlacedItem, says: readonly Narration[]): CardBox {
  const h = 30 + says.reduce((a, s) => a + Math.ceil((textW(s.text) + 30) / (CARD_W - 20)) * 18, 0);
  return { left: Math.max(0, Math.min(item.x, view.w - CARD_W - 4)), top: item.y + item.h + 6, h };
}

interface StepCardProps {
  view: PlacedView;
  item: PlacedItem;
  n: number;
  box: string;
  says: Narration[];
  card: CardBox;
  course: Course;
  facts: MapFacts;
  analysis: Analysis;
  dispatch: (c: Command) => void;
}

/** 今の歩の札（箱の下）。まとまり・札に載るときは、どの箱かと、その箱のまとまりへ入る › */
function StepCard({ view, item, n, box, says, card, course, facts, analysis, dispatch }: StepCardProps) {
  const parent = facts.tree.parent.get(box) ?? ROOT;
  const inner = item.id !== box;
  const label = facts.tree.boxes.get(box)?.label ?? box;
  const pos: CSSProperties = { ...ccOf(course.id), left: card.left, top: card.top };
  return (
    <div className="gcard" style={pos}>
      <div className="gcard-h">
        <span className="gsb cur">{n}</span>
        {inner && (
          <b>
            {parent !== item.id && parent !== ROOT ? `${crumbName(analysis, facts.tree, parent)} の ` : ''}
            {label}
          </b>
        )}
        {inner && parent !== view.spec.at && (
          <button type="button" title={`${crumbName(analysis, facts.tree, parent)} に入る`} onClick={() => dispatch({ id: 'map.enter', group: parent })} onKeyDown={stopKeys}>
            ›
          </button>
        )}
      </div>
      {says.map((s, k) => (
        <p key={k} className={s.ai ? 'ai' : ''}>
          {s.ai && <span className="chip ai">AI</span>}
          {s.text}
        </p>
      ))}
    </div>
  );
}

interface PlayerProps {
  view: PlacedView;
  facts: MapFacts;
  analysis: Analysis;
  course: Course;
  route: MapRoute;
  review: ReviewState;
  step: number;
  play: boolean;
  speed: number;
  dispatch: (c: Command) => void;
}

/** 再生の帯（▶・前・次・歩の帯・速さ）と、今の歩の 1 行（全部を見ているときはコースの紹介）。歩が別の図で起きていれば「… で見る ›」 */
function Player({ view, facts, analysis, course, route, review, step, play, speed, dispatch }: PlayerProps) {
  const n = route.steps.length;
  const cur = step > 0 ? route.steps[step - 1] : undefined;
  const boxes = cur ? [cur.box] : route.steps.map((s) => s.box);
  const where = boxes.length > 0 ? whereTo(facts.tree, view.spec, boxes) : null;
  const whereLabel = where
    ? where.under
      ? `${(pathTo(facts.tree, where.to) ?? [])
          .slice(pathTo(facts.tree, view.spec.at)?.length ?? 0)
          .map((id) => crumbName(analysis, facts.tree, id))
          .join(' › ')} の中で見る`
      : `${crumbName(analysis, facts.tree, where.to)} で見る`
    : '';
  const name = course.id === OUTSIDE ? 'コース外' : `コース ${course.id}`;
  const added = (id: string) => facts.box.get(id)?.added ?? false;
  return (
    <>
      <div className="gplay" style={ccOf(course.id)} role="group" aria-label={`${name}の道順`}>
        <button type="button" className="pri" title={play ? '止める' : '再生'} aria-label={play ? '止める' : '再生'} onClick={() => dispatch({ id: 'map.play' })} disabled={n === 0}>
          {play ? '❚❚' : '▶'}
        </button>
        <button type="button" title="前の歩" aria-label="前の歩" onClick={() => dispatch({ id: 'map.step', to: step - 1 })} disabled={step === 0}>
          ◀ <Key action="course.prev" />
        </button>
        <button type="button" title="次の歩" aria-label="次の歩" onClick={() => dispatch({ id: 'map.step', to: step + 1 })} disabled={step >= n}>
          ▶▶ <Key action="course.forward" />
        </button>
        <span className="gpl-seg">
          {route.steps.map((s, k) => (
            <button
              key={k}
              type="button"
              className={`${added(s.box) ? 'add' : ''}${k + 1 === step ? ' cur' : ''}${step > 0 && k + 1 > step ? ' fut' : ''}`}
              title={`${k + 1} 歩目: ${facts.tree.boxes.get(s.box)?.label ?? s.box}`}
              aria-label={`${k + 1} 歩目`}
              onClick={() => dispatch({ id: 'map.step', to: k + 1 })}
            />
          ))}
        </span>
        <span className="gpl-n">{`${step}/${n}`}</span>
        <SpeedControl speed={speed} dispatch={dispatch} />
      </div>
      <div className="gpl-cap">
        {cur && <span className={`mk${added(cur.box) ? ' add' : ''}`}>{added(cur.box) ? '新規' : '変更'}</span>}
        <span className="t">
          {cur
            ? cur.stops.map((k) => stopInfo(analysis, course, k, review).say.text).join(' ')
            : `${name}。地図の上の停留所 ${n} か所${route.off > 0 ? `（テストの停留所 ${route.off} か所は地図にありません）` : ''}`}
        </span>
        {where && (
          <button type="button" className="gwhere" onClick={() => dispatch({ id: 'map.enter', group: where.to })} onKeyDown={stopKeys}>
            {`${whereLabel} ›`}
          </button>
        )}
      </div>
    </>
  );
}
