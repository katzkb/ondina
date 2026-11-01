// 地図の状態（MapState）を SVG に書く。要素は data-id / data-k / data-b で使い回し、毎フレーム属性だけ書き換える（見本 map.html の draw）。
// React の外で動かす: 1 秒のあいだ毎フレーム描くので、React の再描画に乗せない。
import { relLabel, relSub, type MapNode, type RelGroup } from './graph.js';
import { CH, coreWidth, relWidth, SIDE_GAP, type Placed, type Point } from './layout.js';
import { routePoints } from './route.js';
import { DURATION_MS, mix, type MapState } from './tween.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const clip = (t: string, w: number) => {
  const max = Math.floor((w - 20) / CH);
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1))}…` : t;
};
const round = (v: number) => Math.round(v * 10) / 10;
const pathD = (pts: readonly Point[]) => `M${pts.map((p) => `${round(p.x)} ${round(p.y)}`).join('L')}`;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 「差分なし n か所」の枠と 2 行（2026-10-11）。ほかの層の箱（rel）と、差分の箱の右隣（side）で同じ形 */
function relBody(g: RelGroup, w: number, h: number): SVGElement[] {
  return [el('rect', { x: 0, y: 0, width: w, height: h, rx: 4 }), el('text', { class: 'nm', x: 10, y: 20 }, relLabel(g)), el('text', { class: 'sub', x: 10, y: 36 }, relSub(g))];
}

/**
 * 箱の中身。2 行目は束ならパターン、それ以外は「? 測れていない」（2026-09-24 決定 6）と、How 表示の関連の箱は「関連」。
 * 読む順番の箱は左上に番号の丸（2026-09-26。見本は関連を灰色＋「関連」、読む順番に番号の B+C）。
 * 同じ層の差分の無い相手は右隣に「差分なし n か所」（side）と短い線。矢印は呼ばれる側へ（呼び出し元がいれば差分の箱へ、呼び出し先がいれば side へ）
 */
function nodeBody(v: Placed): SVGElement[] {
  const n: MapNode = v.n;
  if (n.rel) return relBody(n.rel, v.w, v.h);
  const w = coreWidth(n);
  const out: SVGElement[] = [el('rect', { x: 0, y: 0, width: w, height: v.h, rx: 4 })];
  out.push(el('text', { class: 'nm', x: 10, y: n.sub ? 20 : 19 }, clip(n.label, w)));
  const sub = n.sub ?? [n.related ? '関連' : '', n.edgesMeasured === false ? '? 未取得' : ''].filter(Boolean).join(' · ');
  if (sub) out.push(el('text', { class: 'sub', x: 10, y: n.sub ? 36 : 34 }, clip(sub, w)));
  if (n.testCount) {
    const g = el('g', { class: n.testGuess ? 'tb guess' : 'tb' });
    g.append(el('rect', { x: w - 52, y: v.h - 21, width: 46, height: 15, rx: 3 }), el('text', { x: w - 46, y: v.h - 10 }, `テスト ${n.testCount}`));
    out.push(g);
  }
  if (n.course !== undefined) {
    // 入口の地図: 丸の色と番号 = コース（0 はコース外 =「外」）
    const g = el('g', { class: 'cbadge' });
    g.append(el('circle', { cx: 0, cy: 0, r: 10, style: `fill:var(--c${n.course})` }), el('text', { x: 0, y: 4, 'text-anchor': 'middle' }, n.course === 0 ? '外' : String(n.course)));
    out.push(g);
  }
  if (n.order !== undefined) {
    const g = el('g', { class: 'no' });
    g.append(el('circle', { cx: 0, cy: 0, r: 10 }), el('text', { x: 0, y: 4, 'text-anchor': 'middle' }, String(n.order)));
    out.push(g);
  }
  if (n.side) {
    const y = v.h / 2;
    const link = el('path', { class: 'ed relg', d: `M${w} ${y}L${w + SIDE_GAP} ${y}` });
    if (n.side.callees > 0) link.setAttribute('marker-end', 'url(#map-ar-rel)');
    if (n.side.callers > 0) link.setAttribute('marker-start', 'url(#map-ar-rel)');
    const g = el('g', { class: 'side', transform: `translate(${w + SIDE_GAP},0)`, 'data-rel': n.side.layer });
    g.append(...relBody(n.side, relWidth(n.side), v.h));
    out.push(link, g);
  }
  return out;
}

/** 箱の中身が変わったかを見る鍵（How を切り替えると同じ箱の「関連」と番号が変わる） */
const bodyKey = (n: MapNode) => `${n.related ? 'r' : ''}${n.order ?? ''}c${n.course ?? ''}${n.side ? `s${n.side.callers}.${n.side.callees}` : ''}`;

/** 入口の地図で選んだコースの道順。route は停留所の箱の列、keep は沈めずに残す箱 */
export interface RouteOverlay {
  route: readonly string[];
  keep: ReadonlySet<string>;
}

/** 空の SVG に、矢印の定義と 4 枚の層（バンド・辺・道順・箱）を作る */
export function initSvg(svg: SVGSVGElement): void {
  svg.replaceChildren();
  const defs = el('defs');
  for (const [id, cls] of [
    ['map-ar', 'ar'],
    ['map-ar-on', 'ar on'],
    ['map-ar-skip', 'ar skip'],
    ['map-ar-rt', 'ar rt'],
    ['map-ar-rel', 'ar relg'],
  ] as const) {
    // 「差分なし」の線は両矢印があるので、始点でも向きが合う auto-start-reverse
    const m = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: id === 'map-ar-rel' ? 'auto-start-reverse' : 'auto' });
    m.append(el('path', { d: 'M0 0L10 5L0 10z', class: cls }));
    defs.append(m);
  }
  svg.append(defs, el('g', { class: 'bands' }), el('g', { class: 'edges' }), el('g', { class: 'route' }), el('g', { class: 'nodes' }));
}

function sync(parent: Element, attr: string, keys: Set<string>, make: (k: string) => Element, update: (el: SVGElement, k: string) => void) {
  const have = new Map<string, SVGElement>();
  for (const child of [...parent.children]) have.set((child as SVGElement).dataset[attr] ?? '', child as SVGElement);
  for (const [k, e] of have) if (!keys.has(k)) e.remove();
  for (const k of keys) {
    let e = have.get(k);
    if (!e) {
      e = make(k) as SVGElement;
      e.dataset[attr] = k;
      parent.append(e);
    }
    update(e, k);
  }
}

/** state をそのまま DOM に書く。current は今のステップの箱（リング）、peek は覗いている関連の箱、zoom は倍率（動いている間は変えない）、route は入口の道順 */
export function draw(svg: SVGSVGElement, s: MapState, current: string | null, zoom = 1, peek: string | null = null, route: RouteOverlay | null = null): void {
  // viewBox と幅・高さを同時に動かす → 倍率は一定、原点は固定。カメラは動かない
  svg.setAttribute('viewBox', `0 0 ${round(s.W)} ${round(s.H)}`);
  svg.setAttribute('width', String(Math.round(s.W * zoom)));
  svg.setAttribute('height', String(Math.round(s.H * zoom)));
  const [bandsG, edgesG, routeG, nodesG] = [svg.querySelector('g.bands')!, svg.querySelector('g.edges')!, svg.querySelector('g.route')!, svg.querySelector('g.nodes')!];
  // 道順を出している間は、残す箱（keep）と、両端が残す箱の辺以外を沈める（CSS の .routing）
  svg.classList.toggle('routing', route !== null);
  const kept = (id: string) => route === null || route.keep.has(id);

  sync(
    nodesG,
    'id',
    new Set(s.nodes.keys()),
    () => el('g'),
    (g, id) => {
      const q = s.nodes.get(id)!;
      const n = q.v.n;
      const key = bodyKey(n);
      if (g.dataset['body'] !== key) {
        g.replaceChildren(...nodeBody(q.v));
        g.dataset['body'] = key;
      }
      g.setAttribute('class', ['nd', n.rel ? 'relg' : n.changed ? 'ch' : 'un', n.group ? 'grp' : '', q.seed ? 'seed' : '', n.related ? 'rel' : '', id === current ? 'cur' : '', id === peek ? 'peek' : '', route && kept(id) ? 'keep' : ''].filter(Boolean).join(' '));
      g.setAttribute('transform', `translate(${round(q.x)},${round(q.y)})`);
      g.style.opacity = String(q.o);
      g.style.pointerEvents = q.o < 0.5 ? 'none' : '';
    },
  );

  // 辺と、その型ラベル
  const eKeys = new Set<string>();
  for (const [k, q] of s.edges) {
    eKeys.add(`p${k}`);
    if (q.lab) eKeys.add(`t${k}`);
  }
  sync(
    edgesG,
    'k',
    eKeys,
    (k) => el(k[0] === 'p' ? 'path' : 'text'),
    (e, k) => {
      const q = s.edges.get(k.slice(1))!;
      if (k[0] === 'p') {
        e.setAttribute('class', ['ed', q.e.kind, q.e.rel ? 'relg' : '', q.e.crosses ? 'skip' : '', q.on ? 'on' : '', route && kept(q.e.from) && kept(q.e.to) ? 'keep' : ''].filter(Boolean).join(' '));
        e.setAttribute('d', pathD(q.pts));
        e.setAttribute('marker-end', `url(#${q.e.crosses ? 'map-ar-skip' : q.e.rel ? 'map-ar-rel' : q.on ? 'map-ar-on' : 'map-ar'})`);
        if (q.e.rel?.both) e.setAttribute('marker-start', `url(#${q.e.crosses ? 'map-ar-skip' : 'map-ar-rel'})`);
        else e.removeAttribute('marker-start');
      } else {
        const p = q.pts;
        e.setAttribute('class', `lb${q.on ? ' on' : ''}`);
        e.setAttribute('x', String(round((p[1] ?? p[0]!).x + 6)));
        e.setAttribute('y', String(round((p[0]!.y + p[p.length - 1]!.y) / 2)));
        if (e.textContent !== q.lab) e.textContent = q.lab;
      }
      e.style.opacity = String(q.o);
    },
  );

  // 道順: 続く 2 箱を折れ線で結ぶ（箱が動いている間も箱に付いていく）
  const legs: Point[][] = [];
  for (let i = 1; route !== null && i < route.route.length; i++) {
    const a = s.nodes.get(route.route[i - 1]!);
    const b = s.nodes.get(route.route[i]!);
    // 右隣の「差分なし」は道順の箱ではないので、差分の箱の部分（coreWidth）を結ぶ
    if (a && b) legs.push(routePoints({ x: a.x, y: a.y, w: coreWidth(a.v.n), h: a.v.h }, { x: b.x, y: b.y, w: coreWidth(b.v.n), h: b.v.h }));
  }
  sync(
    routeG,
    'k',
    new Set(legs.map((_, i) => String(i))),
    () => el('path', { class: 'rt', 'marker-end': 'url(#map-ar-rt)' }),
    (e, k) => e.setAttribute('d', pathD(legs[Number(k)]!)),
  );

  const bKeys = new Set<string>();
  for (const b of s.bands.keys()) {
    bKeys.add(`l${b}`);
    bKeys.add(`t${b}`);
  }
  sync(
    bandsG,
    'b',
    bKeys,
    (k) => el(k[0] === 'l' ? 'line' : 'text'),
    (e, k) => {
      const q = s.bands.get(k.slice(1))!;
      if (k[0] === 'l') {
        e.setAttribute('class', 'bline');
        e.setAttribute('x1', '0');
        e.setAttribute('x2', String(round(s.W)));
        e.setAttribute('y1', String(round(q.top)));
        e.setAttribute('y2', String(round(q.top)));
      } else {
        // 左端に書く（右端は地図が列より広いと隠れる）
        e.setAttribute('class', 'band');
        e.setAttribute('x', '8');
        e.setAttribute('y', String(round(q.top - 6)));
        if (e.textContent !== q.label) e.textContent = q.label;
      }
      e.style.opacity = String(q.o);
    },
  );
}

/**
 * 1 本のタイムラインで今の状態から次の状態へ動かす。途中で次を頼まれたら「今見えている位置」から続けて動く。
 * prefers-reduced-motion なら動かさずに切り替える（設計書 18.3）。
 */
export class MapAnimator {
  private cur: MapState | null = null;
  private raf = 0;
  private current: string | null = null;
  private peek: string | null = null;
  private zoom = 1;
  private route: RouteOverlay | null = null;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly onSettled: () => void = () => {},
  ) {
    initSvg(svg);
  }

  go(to: MapState, ms = DURATION_MS): void {
    cancelAnimationFrame(this.raf);
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = this.cur;
    if (!from || ms <= 0 || reduced) {
      this.cur = to;
      draw(this.svg, to, this.current, this.zoom, this.peek, this.route);
      this.onSettled();
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      this.cur = t < 1 ? mix(from, to, t) : to;
      draw(this.svg, this.cur, this.current, this.zoom, this.peek, this.route);
      if (t < 1) this.raf = requestAnimationFrame(step);
      else this.onSettled();
    };
    this.raf = requestAnimationFrame(step);
  }

  /** 今のステップの箱にリングを付ける（リングの動きは CSS の 180ms。設計書 18.3） */
  setCurrent(id: string | null): void {
    this.current = id;
    if (this.cur) draw(this.svg, this.cur, id, this.zoom, this.peek, this.route);
  }

  /** 覗いている関連の箱に紫の太枠を付ける */
  setPeek(id: string | null): void {
    this.peek = id;
    if (this.cur) draw(this.svg, this.cur, this.current, this.zoom, id, this.route);
  }

  /** 倍率を変える。動いている間も次のフレームから効く */
  setZoom(zoom: number): void {
    this.zoom = zoom;
    if (this.cur) draw(this.svg, this.cur, this.current, zoom, this.peek, this.route);
  }

  /** 入口の道順を出す / 消す（null） */
  setRoute(route: RouteOverlay | null): void {
    this.route = route;
    if (this.cur) draw(this.svg, this.cur, this.current, this.zoom, this.peek, route);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}
