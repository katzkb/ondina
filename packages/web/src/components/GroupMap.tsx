// 入口の地図（設計書 3.1。2026-11-03 の見本 5 の形、分け方は案 A）。全景に変更のまとまりを並べ、押すとその中に入る。中は箱（差分のあるファイルか束）。
// 図の外の相手は点線の札（押すとそのまとまりへ）。上にパンくず、名前の共通の語は「…」で省いて下に書く。
// 箱を押すとその箱のコースを選ぶ（下のコースの並びと同じ home.select）。「差分なし n」は差分の無い相手の引き出し（rel.open）。
// 道順を流す・動き・シーケンス図は次の PR（計画の PR 3〜5）。押した物は全部コマンド（原則 6）。描くだけで、事実は view.ts が組む（原則 5）
import type { Analysis, MapGroups } from '@ondina/model';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Command } from '../commands/commands.js';
import { courseBg, OUTSIDE } from '../course.js';
import { workerElk } from '../map/elk.js';
import { NO_LAYER } from '../map/graph.js';
import { layoutView, midOf, type PlacedItem, type PlacedView } from '../map/groupmap/layout.js';
import { crumbName, groupName, leavesOf, litBy, mapFacts, ROOT, viewOf, type MapFacts } from '../map/groupmap/view.js';
import type { ElkLike } from '../map/layout.js';
import { clampZoom, wheelZoom } from '../map/zoom.js';

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

/** 「…」を薄くし、キャメルケースの切れ目で折り返せるようにする */
function Short({ text }: { text: string }) {
  const parts = text.split('…');
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <i className="el">…</i>}
          {p.split(/(?<=[a-z\d])(?=[A-Z])/).map((w, k) => (
            <Fragment key={k}>
              {k > 0 && <wbr />}
              {w}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  );
}

/** Enter / Space はこの箱だけのもの（App の Enter =「選んだコースに入る」に流さない） */
const stopKeys = (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
};

export function GroupMap({ analysis, mapGroups, path, sel, zoom, dispatch, elk = workerElk }: GroupMapProps) {
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
  const crumbs = [ROOT, ...path];
  const guessShown = view?.spec.kind === 'groups' && view.items.some((it) => it.kind === 'group' && nameOf(it.id).guess);

  return (
    <div className="cmap gmap" ref={rootRef}>
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
      {mapGroups.boxes.length === 0 ? (
        <div className="empty">地図に載せる変更がありません</div>
      ) : placed instanceof Error ? (
        <div className="empty danger">地図を作れませんでした: {placed.message}</div>
      ) : (
        <>
          {view === null && <div className="empty">地図を作っています…</div>}
          {view && (
            <div className="map">
              <div className="gstage" ref={stageRef} style={{ width: view.w * zoom, height: view.h * zoom }}>
                <div className="gzoom" style={{ width: view.w, height: view.h, transform: `scale(${zoom})` }}>
                  <div
                    key={view.spec.at}
                    className={`vw${anim ? ` ${anim.cls}` : ''}`}
                    style={{ width: view.w, height: view.h, ...(anim ? { transformOrigin: `${anim.ox}px ${anim.oy}px` } : {}) }}
                    role="group"
                    aria-label={`地図: ${crumbName(analysis, facts.tree, view.spec.at)}`}
                  >
                    <Bands view={view} bands={facts.bands} analysis={analysis} />
                    <Edges view={view} dim={lit !== null} />
                    {view.items.map((it) => (
                      <Item key={it.id} it={it} facts={facts} name={nameOf(it.id)} dim={lit !== null && !lit.has(it.id)} lit={lit?.has(it.id) ?? false} dispatch={dispatch} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
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
  dispatch: (c: Command) => void;
}

function Item({ it, facts, name, dim, lit, dispatch }: ItemProps) {
  const pos: CSSProperties = { left: it.x, top: it.y, width: it.w, height: it.h };
  const state = `${dim ? ' dim' : ''}${lit ? ' lit' : ''}`;
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
