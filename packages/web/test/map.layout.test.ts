// 地図の配置。elkjs を本当に走らせ（ブラウザでは Web Worker、ここでは elk.bundled）、2026-09-24 に見本で踏んだ穴が無いことを見る。
import ELK from 'elkjs/lib/elk.bundled.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildGraph } from '../src/map/graph.js';
import { baseLayout, coreWidth, edgeLabel, nodeHeight, nodeWidth, relWidth, scopeView, SIDE_GAP, type BaseLayout, type ViewLayout } from '../src/map/layout.js';
import { fixtureAnalysis, fixtureWithNeighbors } from './fixture.js';

const analysis = fixtureAnalysis();
let base: BaseLayout;
beforeAll(async () => {
  base = await baseLayout(buildGraph(analysis, null), new ELK());
});

const views = (): Array<[string, ViewLayout]> => [['全体', scopeView(base, buildGraph(analysis, null))], ...analysis.hows.map((h) => [`How ${h.id}`, scopeView(base, buildGraph(analysis, h.id))] as [string, ViewLayout])];

describe('baseLayout', () => {
  it('全ノードに位置が付き、辺はすべて線になる', () => {
    const g = buildGraph(analysis, null);
    expect(base.nodeAt.size).toBe(g.nodes.length);
    expect(new Set(base.geom.map((p) => `${p.e.from}>${p.e.to}`)).size).toBe(g.edges.length);
  });

  it('バンドは上から設定の層の順（上のバンドの箱はすべて下のバンドの箱より上）', () => {
    const tops = new Map<string, { min: number; max: number }>();
    for (const v of base.nodeAt.values()) {
      const r = tops.get(v.n.band) ?? { min: Infinity, max: -Infinity };
      r.min = Math.min(r.min, v.y);
      r.max = Math.max(r.max, v.y + v.h);
      tops.set(v.n.band, r);
    }
    const order = base.bands.filter((b) => tops.has(b));
    for (let i = 1; i < order.length; i++) expect(tops.get(order[i - 1]!)!.max).toBeLessThan(tops.get(order[i]!)!.min);
  });

  it('線の端は from の箱から出て to の箱に入る（上向きの辺も描くときは向きを戻している）', () => {
    const near = (p: { x: number; y: number }, id: string) => {
      const v = base.nodeAt.get(id)!;
      return p.x >= v.x - 1 && p.x <= v.x + v.w + 1 && p.y >= v.y - 1 && p.y <= v.y + v.h + 1;
    };
    for (const g of base.geom) {
      expect(near(g.pts[0]!, g.e.from), `${g.e.from} > ${g.e.to} の始点`).toBe(true);
      expect(near(g.pts[g.pts.length - 1]!, g.e.to), `${g.e.from} > ${g.e.to} の終点`).toBe(true);
    }
  });
});

describe('scopeView', () => {
  it('全体でもどの How でも、線と箱が図の枠の中に収まる（「線がフレーム外に出る」の再発防止）', () => {
    for (const [name, v] of views()) {
      for (const p of v.paths) for (const q of p.pts) expect(q.x >= 0 && q.y >= 0 && q.x <= v.width && q.y <= v.height, `${name}: ${p.e.from} > ${p.e.to}`).toBe(true);
      for (const n of v.nodeAt.values()) expect(n.x + n.w <= v.width && n.y + n.h <= v.height, `${name}: ${n.n.label}`).toBe(true);
    }
  });

  it('詰めても左右の並びは変わらない（全体で左にあった箱は、絞っても左）', () => {
    for (const [, v] of views()) {
      const ids = [...v.nodeAt.keys()];
      for (const a of ids) {
        for (const b of ids) {
          const A = base.nodeAt.get(a)!;
          const B = base.nodeAt.get(b)!;
          if (A.x + A.w < B.x) expect(v.nodeAt.get(a)!.x).toBeLessThan(v.nodeAt.get(b)!.x);
        }
      }
    }
  });

  it('絞ると図は全体より小さい。seed の箱だけが紫の枠、辺は濃い表示', () => {
    const full = scopeView(base, buildGraph(analysis, null));
    const g5 = buildGraph(analysis, 5);
    const v5 = scopeView(base, g5);
    expect(v5.width * v5.height).toBeLessThan(full.width * full.height);
    expect([...v5.nodeAt.values()].filter((n) => n.seed).map((n) => n.n.id).sort()).toEqual([...g5.seed].sort());
    expect(v5.paths.every((p) => p.on)).toBe(true);
    expect(full.paths.some((p) => p.on)).toBe(false);
  });

  it('バンドのラベルは bandLabels の表示名（推定の帯は「（推定）」）', () => {
    const g = buildGraph(analysis, null);
    const v = scopeView(base, { ...g, bandLabels: new Map([['Domain', 'Domain（推定）']]) });
    expect(v.bands.find((b) => b.b === 'Domain')!.label.startsWith('Domain（推定）')).toBe(true);
    expect(v.bands.find((b) => b.b === 'API')!.label.startsWith('API')).toBe(true);
  });

  it('辺の無い箱があるバンドはラベルに件数が付く', () => {
    const full = scopeView(base, buildGraph(analysis, null));
    expect(full.bands.some((b) => /関連なし \d+/.test(b.label))).toBe(true);
  });
});

// 2026-10-11: 同じ層の「差分なし n か所」は差分の箱の右隣（side）。elkjs には差分の箱と side を 1 つの箱として渡し、
// 線は差分の箱の上下の真ん中（ポート）に付ける（side の上に線が来て、side につながっているように見えないように）
describe('差分の無い相手の箱の大きさと置き場所', () => {
  const a = fixtureWithNeighbors();
  const g = buildGraph(a, null);
  const order = g.nodes.find((n) => n.label === 'domain.Order')!;
  const box = g.nodes.find((n) => n.rel !== undefined)!;

  it('side のある箱の幅 = 差分の箱の幅 + 間 + side の幅。side と「差分なし」の箱の幅は 2 行の文の長い方で計る（最小 130）', () => {
    expect(order.side).toBeDefined();
    expect(nodeWidth(order)).toBe(coreWidth(order) + SIDE_GAP + relWidth(order.side!));
    expect(coreWidth(order)).toBe(150);
    expect(relWidth({ host: 'x', layer: 'Domain', callers: 0, callees: 1, crosses: false })).toBe(130);
    const wide = { host: 'x', layer: 'Domain', callers: 1234, callees: 5678, crosses: false };
    expect(relWidth(wide)).toBeGreaterThan(130);
    expect(nodeWidth(box)).toBe(relWidth(box.rel!));
    expect(nodeHeight(box)).toBe(52);
  });

  it('箱どうしは重ならず、ほかの層の「差分なし」の箱はその層の帯に入る', async () => {
    const v = scopeView(await baseLayout(g, new ELK()), g);
    const boxes = [...v.nodeAt.values()];
    for (const p of boxes) {
      for (const q of boxes) {
        if (p === q) continue;
        const apart = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
        expect(apart, `${p.n.label} と ${q.n.label}`).toBe(true);
      }
    }
    const band = (name: string) => v.bands.find((b) => b.b === name)!;
    const next = (name: string) => v.bands[v.bands.indexOf(band(name)) + 1]?.top ?? Infinity;
    for (const r of boxes.filter((p) => p.n.rel)) expect(r.y >= band(r.n.band).top && r.y < next(r.n.band), r.n.id).toBe(true);
  });

  it('side のある箱への線は、差分の箱の部分（左の coreWidth）の真ん中に付く', async () => {
    const v = scopeView(await baseLayout(g, new ELK()), g);
    const host = v.nodeAt.get(order.id)!;
    const ends = v.paths.filter((p) => p.e.from === order.id || p.e.to === order.id).flatMap((p) => [p.e.from === order.id ? p.pts[0]! : p.pts[p.pts.length - 1]!]);
    expect(ends.length).toBeGreaterThan(0);
    for (const q of ends) expect(q.x).toBeCloseTo(host.x + coreWidth(order) / 2, 0);
  });

  it('コースで絞ると、範囲の外の箱は side を外した幅になる', async () => {
    const base = await baseLayout(g, new ELK());
    const g5 = buildGraph(a, 5);
    const v = scopeView(base, g5);
    for (const p of v.nodeAt.values()) expect(p.w, p.n.label).toBe(nodeWidth(p.n));
  });
});

describe('edgeLabel', () => {
  it('型が取れていれば「入り → 出」、まとめた本数が 2 以上なら ×n', () => {
    expect(edgeLabel({ from: 'a', to: 'b', kind: 'call', n: 1, types: { in: 'Cmd', out: 'Order' }, crosses: false })).toBe('Cmd → Order');
    expect(edgeLabel({ from: 'a', to: 'b', kind: 'call', n: 3, types: { out: 'Order' }, crosses: false })).toBe('? → Order ×3');
    expect(edgeLabel({ from: 'a', to: 'b', kind: 'reference', n: 21, crosses: false })).toBe('×21');
    expect(edgeLabel({ from: 'a', to: 'b', kind: 'reference', n: 1, crosses: false })).toBe('');
  });

  it('「差分なし」の箱の線にはラベルを付けない（数は箱に書いてある）', () => {
    expect(edgeLabel({ from: 'rel:x:Application', to: 'b', kind: 'call', n: 4, crosses: false, rel: { both: false } })).toBe('');
  });
});
