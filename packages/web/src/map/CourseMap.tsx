// コースの地図（設計書 3.3）。停留所の画面の重ね物（M で引き出し、Shift+M で大きく）と、入口の全体の地図（3.1。scope = null）で使う。
// elkjs で全体を 1 回組み、コースの範囲（How の hunk と辺で繋がる隣）に詰めて描く。組み方は 2026-09-24 の承認のまま（map/*）。
// 押した箱の扱いは呼ぶ側が決める（停留所へ移る / 覗く / 束を開く）。「差分なし n か所」だけはここで差分の無い相手の引き出しを開く（rel.open）。
import type { Analysis } from '@ondina/model';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Command } from '../commands/commands.js';
import { MapAnimator, type RouteOverlay } from './draw.js';
import { workerElk } from './elk.js';
import { buildGraph, type RelGroup } from './graph.js';
import { baseLayout, scopeView, type BaseLayout, type ElkLike } from './layout.js';
import { targetState } from './tween.js';
import { clampZoom, wheelZoom } from './zoom.js';

const ZOOMS = [0.5, 0.7, 1] as const;

/** Safari だけのピンチのイベント（標準外。scale はつまみ始めからの比） */
type GestureEvent = Event & { scale: number; clientX: number; clientY: number };

export interface CourseMapProps {
  analysis: Analysis;
  /** コース（How の id。コース外は 0）。null は全体（入口の地図。丸の色 = コース） */
  scope: number | null;
  /** 入口の地図で選んだコースの道順（null は出さない） */
  route?: RouteOverlay | null;
  /** 凡例の最後の 1 行（既定はコースの地図の説明） */
  legend?: string;
  /** 印を付ける箱（地図の箱の id）。今の停留所 */
  current: string | null;
  peek: string | null;
  zoom: number;
  /** 見出しの左（「次はここ」など） */
  title: string;
  note?: string;
  /** 見出しの右端（倍率の右）に足すボタン（コースの地図の「大きく」「閉じる」） */
  actions?: ReactNode;
  onNode: (nodeId: string) => void;
  dispatch: (c: Command) => void;
  /** 差し替えはテスト用（jsdom に Web Worker が無い） */
  elk?: () => ElkLike;
}

export function CourseMap({ analysis, scope, route = null, legend, current, peek, zoom, title, note, actions, onNode, dispatch, elk = workerElk }: CourseMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const animRef = useRef<MapAnimator | null>(null);
  const [base, setBase] = useState<BaseLayout | Error | null>(null);
  const full = useMemo(() => buildGraph(analysis, null), [analysis]);
  // 「差分なし」の箱（ほかの層の相手）の id → まとまり
  const rels = useMemo(() => new Map(full.nodes.flatMap((n): Array<[string, RelGroup]> => (n.rel ? [[n.id, n.rel]] : []))), [full]);
  const currentRef = useRef(current);
  currentRef.current = current;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const peekRef = useRef(peek);
  peekRef.current = peek;
  const routeRef = useRef(route);
  routeRef.current = route;
  // 描き直す前に次のピンチが来ても崩れないよう、描いてある倍率と最後に頼んだ倍率を分けて持つ
  const shownZoom = useRef(zoom);
  const askedZoom = useRef(zoom);
  /** 指の位置と、その下にある図の点（viewBox の座標）。描き直した直後にこの点を指の下へ戻す */
  const anchor = useRef<{ clientX: number; clientY: number; px: number; py: number } | null>(null);

  useEffect(() => {
    let off = false;
    setBase(null);
    Promise.resolve()
      .then(() => baseLayout(full, elk()))
      .then(
        (b) => !off && setBase(b),
        (e: unknown) => !off && setBase(e instanceof Error ? e : new Error(String(e))),
      );
    return () => {
      off = true;
    };
  }, [full, elk]);

  // 地図を組み終えたら描き、コースが変わったら 1 本のタイムラインで次の形へ動かす。最初の 1 回は動かさない
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !base || base instanceof Error) return;
    const first = animRef.current === null;
    animRef.current ??= new MapAnimator(svg, () => svg.querySelector('g.nd.cur')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
    animRef.current.setCurrent(currentRef.current);
    animRef.current.setPeek(peekRef.current);
    animRef.current.setZoom(zoomRef.current);
    animRef.current.setRoute(routeRef.current);
    const view = scopeView(base, buildGraph(analysis, scope));
    // 全体の地図では線の型ラベルを出さない（箱が多く、文字が重なる。承認したデモと同じ）
    if (scope === null) for (const p of view.paths) p.lab = '';
    animRef.current.go(targetState(view), first ? 0 : undefined);
  }, [base, analysis, scope]);

  useEffect(() => {
    animRef.current?.setCurrent(current);
    svgRef.current?.querySelector('g.nd.cur')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  useEffect(() => animRef.current?.setPeek(peek), [peek]);

  useLayoutEffect(() => {
    animRef.current?.setZoom(zoom);
    shownZoom.current = zoom;
    askedZoom.current = zoom;
    const a = anchor.current;
    anchor.current = null;
    const svg = svgRef.current;
    const box = svg?.parentElement;
    if (!a || !svg || !box) return;
    const r = svg.getBoundingClientRect();
    box.scrollLeft += r.left + a.px * zoom - a.clientX;
    box.scrollTop += r.top + a.py * zoom - a.clientY;
  }, [zoom]);

  // つまむと地図だけを拡大・縮小する。止めないとブラウザが画面全体を拡大するので、preventDefault できる native の listener で受ける（React の onWheel は passive）
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ask = (next: number, clientX: number, clientY: number) => {
      // 倍率が変わらないと描き直さないので、指の点を残さない
      if (next === askedZoom.current) return;
      const svg = svgRef.current;
      if (svg) {
        const r = svg.getBoundingClientRect();
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
    // Safari はピンチで wheel を出さず、gesture* だけを出す
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

  useEffect(() => animRef.current?.setRoute(route), [route]);

  useEffect(
    () => () => {
      animRef.current?.dispose();
      animRef.current = null;
    },
    [],
  );

  // 「差分なし n か所」（差分の箱の右隣と、ほかの層の箱）は差分の無い相手の引き出しを、その層で開く。ほかの箱は onNode
  const onClick = (e: React.MouseEvent) => {
    const t = e.target as Element;
    const id = t.closest<SVGGElement>('g.nd')?.dataset['id'];
    if (!id) return;
    const side = t.closest<SVGGElement>('g.side')?.dataset['rel'];
    if (side !== undefined) return dispatch({ id: 'rel.open', host: id, layer: side });
    const rel = rels.get(id);
    if (rel) return dispatch({ id: 'rel.open', host: rel.host, layer: rel.layer });
    onNode(id);
  };

  // 層や関連の線が無いわけは入口の知らせ（MapNotice）が言う。ここは載せる箱が 1 つも無いときだけ
  const empty = analysis.symbols.length === 0;
  return (
    <div className="cmap" ref={rootRef}>
      <div className="hd">
        <b>{title}</b>
        {note && <span>{note}</span>}
        <span className="sp">
          <span className="seg" aria-label="倍率">
            {ZOOMS.map((z) => (
              <button key={z} type="button" className={zoom === z ? 'on' : ''} onClick={() => dispatch({ id: 'map.zoom', zoom: z })}>
                {`${Math.round(z * 100)}%`}
              </button>
            ))}
          </span>
          {actions}
        </span>
      </div>
      {empty ? (
        <div className="empty">地図に載せる変更がありません</div>
      ) : base instanceof Error ? (
        <div className="empty danger">地図を作れませんでした: {base.message}</div>
      ) : (
        <>
          {base === null && <div className="empty">地図を作っています…</div>}
          <div className="map">
            <svg ref={svgRef} role="img" aria-label="層ごとのシンボルの地図" onClick={onClick} />
          </div>
          <div className="legend">
            <span>
              <i className="l-call" />
              呼び出し
            </span>
            <span>
              <i className="l-ref" />
              参照
            </span>
            <span>
              <i className="l-skip" />
              層を飛び越える呼び出し（事実のみ）
            </span>
            <span>{legend ?? '番号 = 停留所の順 · 灰色の「関連」= 停留所にない箱（押すとコードを覗く） · 点線の「差分なし n か所」= 差分のない相手（押すと右に出す）'}</span>
          </div>
        </>
      )}
    </div>
  );
}
