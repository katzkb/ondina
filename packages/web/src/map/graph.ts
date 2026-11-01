// 地図（設計書 3.3）に載せるノードと辺。Analysis の symbols / edges から、描く前の形を組む純粋関数。
// 束（追従グループ）は 1 箱に畳み、テストは既定で外し、同じ向きの辺は 1 本にする（2026-09-24 決定。見本 map.html の buildGraph）。
// 箱は差分のある場所だけ。差分の無い相手は、差分の箱ごと・層ごとの「差分なし n か所」にまとめる（2026-10-11。差分が責任の単位で、
// Approve する人は全部の差分に責任を持つ。差分の無いコードは関係があると分かれば十分なので、差分と同じ扱いにしない）。
import type { Analysis, Edge, Symbol as OndinaSymbol, SymbolKind } from '@ondina/model';

/** 層の glob に当たらなかったシンボルのバンド */
export const NO_LAYER = '層なし';
/** 畳んだ束の箱の id は GROUP_PREFIX + 代表の hunk id。Symbol.id は sha1 の 16 進 40 文字なので ':' を含まず衝突しない（id の作り方を変えたらここも見る） */
export const GROUP_PREFIX = 'group:';
/** 「差分なし n か所」の箱（ほかの層の相手）の id の頭（REL_PREFIX + 差分の箱の id + ':' + 層）。GROUP_PREFIX と同じく Symbol.id とは衝突しない */
export const REL_PREFIX = 'rel:';
/** buildGraph の howId に渡すとコース外（どの How にも属さない hunk）で絞る。How の id は 1 始まりなので衝突しない（course.ts の OUTSIDE と同じ値） */
export const OUTSIDE_SCOPE = 0;

export interface MapNode {
  /** Symbol.id。畳んだ束は GROUP_PREFIX + 代表の hunk id */
  id: string;
  label: string;
  /** 2 行目。束だけが持つ（書き換えのパターン） */
  sub?: string;
  band: string;
  changed: boolean;
  group: boolean;
  /** 束だけ: 代表の hunk id */
  representative?: string;
  testCount?: number;
  /** testCount を数えたテストの見分けが推定（5.2 の 7）。チップの枠を点線にする（原則 2） */
  testGuess?: true;
  edgesMeasured?: boolean;
  /** How 表示だけ: 読む順番（tours のステップ）に無い箱。押すと右列で覗く（2026-09-26） */
  related?: boolean;
  /** 全体表示だけ: 差分のある箱のコース（hunk の最初の How。どの How にも属さなければ 0 = コース外）。入口の地図の丸の色と番号 */
  course?: number;
  /** How 表示だけ: 読む順番の番号（1 始まり。右列の一覧と同じ。テストのステップは地図に無いので番号が飛ぶことがある） */
  order?: number;
  /** 差分の箱だけ: 同じ層の差分の無い相手のまとまり。箱の右隣に「差分なし n か所」で描く（layout.ts の SIDE_GAP） */
  side?: RelGroup;
  /** 「差分なし n か所」の箱（ほかの層の相手のまとまり）だけ。id は REL_PREFIX から */
  rel?: RelGroup;
}

/** 差分の箱 1 つの、ある層の差分の無い相手のまとまり（2026-10-11） */
export interface RelGroup {
  /** 差分の箱の id */
  host: string;
  /** 相手の層（地図の帯） */
  layer: string;
  /** 差分の箱を呼んでいる相手の数 */
  callers: number;
  /** 差分の箱が呼んでいる相手の数 */
  callees: number;
  /** 相手との呼び出しに層を飛び越えるものがある */
  crosses: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  kind: Edge['kind'];
  /** まとめた本数（reference は参照した箇所の数を足す） */
  n: number;
  types?: { in?: string; out?: string };
  crosses: boolean;
  /** 「差分なし」の箱と差分の箱の線だけ。both = 呼び出し元と呼び出し先の両方がいる（両矢印） */
  rel?: { both: boolean };
}

export interface MapGraph {
  bands: string[];
  /** 帯の表示名。構成の推定（設計書 10.6）から来た帯は「（推定）」を付ける（原則 2）。無い帯は名前のまま */
  bandLabels?: Map<string, string>;
  nodes: MapNode[];
  edges: MapEdge[];
  /** 選んだ How の hunk のノード（紫の枠）。全体表示では空 */
  seed: Set<string>;
}

export interface GraphOptions {
  /** テストのシンボルと test 辺も出す。既定 false（2026-09-24「テストは別にマップで見たく無い」） */
  tests?: boolean;
  /** 参照辺を出す。既定 true */
  references?: boolean;
}

const RANK: Record<Edge['kind'], number> = { call: 4, schema: 3, test: 2, reference: 1 };

/** 設定の層の順番。設定に層が無ければ構成の推定の並び（10.6）。最後に「層なし」 */
export function mapBands(analysis: Analysis): string[] {
  return [...layerNames(analysis), NO_LAYER];
}

function layerNames(analysis: Analysis): string[] {
  return analysis.config.layers.length > 0 ? analysis.config.layers.map((l) => l.name) : (analysis.structure?.layers ?? []);
}

/** 推定の帯の表示名。設定の層があれば推定の帯は無い */
function bandLabels(analysis: Analysis): Map<string, string> {
  if (analysis.config.layers.length > 0) return new Map();
  return new Map((analysis.structure?.layers ?? []).map((b) => [b, `${b}（推定）`]));
}

/** チップや薄字に出す層。層が無ければ「層なし」、LLM が推定した層は「（推定）」を付ける（原則 2） */
export function layerText(s: Pick<OndinaSymbol, 'layer' | 'layerProvenance'> | undefined): string {
  if (s?.layer === undefined) return NO_LAYER;
  return s.layerProvenance === 'llm' ? `${s.layer}（推定）` : s.layer;
}

/** テストを構成の推定のテストの置き場で見分けた解析か（5.2 の 7。設定にテストの置き場が無いとき）。画面の「テスト」に（推定）を付ける（原則 2） */
export function testsGuessed(analysis: Pick<Analysis, 'structure'>): boolean {
  return analysis.structure?.tests !== undefined;
}

/** 箱に書く名前。ファイル単位はファイル名、それ以外は最後の 2 つ（Class.member） */
export function shortName(fqName: string, path: string, kind: SymbolKind): string {
  if (kind === 'file') return path.split('/').pop() ?? path;
  return fqName.split('.').slice(-2).join('.');
}

type Group = NonNullable<Analysis['hunks'][number]['group']>;

/** 追従グループ（代表の hunk id → 束）と、束のメンバー → 箱の id。逸脱は畳まない（独立した箱のまま） */
function collapse(analysis: Analysis): { groups: Map<string, Group>; boxOf: Map<string, string> } {
  const groups = new Map<string, Group>();
  const boxOf = new Map<string, string>();
  for (const h of analysis.hunks) {
    if (!h.group || groups.has(h.group.representative)) continue;
    groups.set(h.group.representative, h.group);
    for (const m of h.group.members) boxOf.set(m, GROUP_PREFIX + h.group.representative);
  }
  return { groups, boxOf };
}

/** シンボルが地図のどの箱に載っているか（束のメンバーは束の箱） */
export function mapNodeOf(analysis: Analysis): (symbolId: string) => string {
  const { boxOf } = collapse(analysis);
  return (id) => boxOf.get(id) ?? id;
}

export function buildGraph(analysis: Analysis, howId: number | null, opts: GraphOptions = {}): MapGraph {
  const hunkOf = new Map(analysis.hunks.map((h) => [h.id, h]));
  const testFrom = new Set(analysis.edges.filter((e) => e.kind === 'test').map((e) => e.from));
  const isTest = (id: string) => testFrom.has(id) || hunkOf.get(id)?.kind === 'test';
  const { groups, boxOf } = collapse(analysis);
  const node = (id: string) => boxOf.get(id) ?? id;
  const testGuess = testsGuessed(analysis);

  const bySymbol = new Map(analysis.symbols.map((s) => [s.id, s]));
  let nodes: MapNode[] = [];
  for (const s of analysis.symbols) {
    if (!s.changed || boxOf.has(s.id)) continue;
    if (!opts.tests && isTest(s.id)) continue;
    const own = howId === null && s.changed ? hunkOf.get(s.hunkId ?? s.id) : undefined;
    nodes.push({
      id: s.id,
      label: shortName(s.fqName, s.path, s.kind),
      ...(own ? { course: own.hows[0] ?? OUTSIDE_SCOPE } : {}),
      band: s.layer ?? NO_LAYER,
      changed: s.changed,
      group: false,
      ...(s.testCount === undefined ? {} : { testCount: s.testCount, ...(testGuess ? { testGuess: true as const } : {}) }),
      ...(s.edgesMeasured === undefined ? {} : { edgesMeasured: s.edgesMeasured }),
    });
  }
  for (const [rep, g] of groups) {
    const members = g.members.map((m) => bySymbol.get(m));
    const layers = new Set(members.map((m) => m?.layer ?? NO_LAYER));
    const unmeasured = members.filter((m) => m?.edgesMeasured === false).length;
    nodes.push({
      id: GROUP_PREFIX + rep,
      label: `追従 ${g.members.length} 件 · 差異あり ${g.deviations.length}`,
      sub: unmeasured === g.members.length ? `${g.pattern}（${g.members.length} 件とも呼び出し関係は未取得）` : g.pattern,
      band: layers.size === 1 ? [...layers][0]! : NO_LAYER,
      changed: true,
      group: true,
      representative: rep,
      ...(howId === null ? { course: hunkOf.get(rep)?.hows[0] ?? OUTSIDE_SCOPE } : {}),
    });
  }

  const present = new Set(nodes.map((n) => n.id));
  const merged = new Map<string, MapEdge>();
  for (const e of analysis.edges) {
    if (opts.references === false && e.kind === 'reference') continue;
    if (!opts.tests && e.kind === 'test') continue;
    const from = node(e.from);
    const to = node(e.to);
    if (from === to || !present.has(from) || !present.has(to)) continue;
    const key = `${from}>${to}`;
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, { from, to, kind: e.kind, n: e.n ?? 1, ...(e.types ? { types: e.types } : {}), crosses: e.crossesLayers });
      continue;
    }
    cur.n += e.n ?? 1;
    cur.crosses ||= e.crossesLayers;
    if (RANK[e.kind] > RANK[cur.kind]) {
      cur.kind = e.kind;
      if (e.types) cur.types = e.types;
    } else if (!cur.types && e.types) cur.types = e.types;
  }
  let edges = [...merged.values()];
  // 差分の無い相手のまとまり。絞る前の全体で組むので、「差分なし」の箱の id はどの地図でも同じ
  ({ nodes, edges } = relGroups(analysis, nodes, edges));

  const seed = new Set<string>();
  if (howId !== null) {
    // How の hunk と、辺で繋がる隣を残す。隣は「この How の変更が何に効くか」（影響範囲）なので消さない。
    // 2026-09-25 に読む順番の箱だけにしたが、影響範囲が見えなくなったので戻した（2026-09-26）。読む順番に無い箱は related にし、押すと覗く
    // 0 はコース外（どの How にも属さない hunk。3.3）。停留所はその hunk の並び（course.ts の courses と同じ）
    const inScope = (h: Analysis['hunks'][number]) => (howId === OUTSIDE_SCOPE ? h.hows.length === 0 : h.hows.includes(howId));
    for (const h of analysis.hunks) if (inScope(h) && present.has(node(h.id))) seed.add(node(h.id));
    const keep = new Set(seed);
    for (const e of edges) {
      if (seed.has(e.from) || seed.has(e.to)) {
        keep.add(e.from);
        keep.add(e.to);
      }
    }
    // 読む順番の番号。束のメンバーは束の箱に丸め、最初に出た番号を使う
    const steps = howId === OUTSIDE_SCOPE ? analysis.hunks.filter(inScope).map((h) => ({ symbolId: h.id })) : (analysis.tours.find((t) => t.howId === howId)?.steps ?? []);
    const order = new Map<string, number>();
    steps.forEach((s, i) => {
      const id = node(s.symbolId);
      if (!order.has(id)) order.set(id, i + 1);
    });
    // 読む順番にあるのに隣でも hunk でもない箱も残す
    for (const id of order.keys()) if (present.has(id)) keep.add(id);
    // 「差分なし」の箱は線で範囲の箱（seed）につながるときだけ残る（上の keep）。範囲の外の箱の右隣のまとまりは外す
    nodes = nodes.filter((n) => keep.has(n.id)).map((n) => {
      if (n.rel) return n;
      const { side, ...rest } = n;
      const own = side !== undefined && seed.has(n.id) ? { side } : {};
      const o = order.get(n.id);
      return o === undefined ? { ...rest, ...own, related: true } : { ...rest, ...own, related: false, order: o };
    });
    edges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  }
  return { bands: mapBands(analysis), bandLabels: bandLabels(analysis), nodes, edges, seed };
}

export interface RelItem {
  /** Symbol.id（差分の無いシンボル） */
  id: string;
  /** 箱に書く名前（shortName） */
  name: string;
  /** 層（地図の帯）。無ければ「層なし」 */
  layer: string;
  path: string;
  /** その呼び出しが層を飛び越える */
  crosses: boolean;
}

export interface Relations {
  /** 差分の箱を呼んでいる差分の無いシンボル */
  callers: RelItem[];
  /** 差分の箱が呼んでいる差分の無いシンボル */
  callees: RelItem[];
}

const relCache = new WeakMap<Analysis, Map<string, Relations>>();

/**
 * 地図の箱（束のメンバーは束の箱）ごとの、差分の無い呼び出し元・呼び出し先（2026-10-11）。名前順・決定的。
 * 言語サーバーが変更シンボルごとに 1 段だけ聞いた相手（core/src/lsp/edges.ts）。テストの呼び出し先も持つ（テストの id で引く）。
 * 差分の無いテストからの呼び出しは数えない（テストは地図に出さない。testCount のバッジが受け持つ）。同じ相手は 1 回だけ
 */
export function relationsOf(analysis: Analysis): Map<string, Relations> {
  const hit = relCache.get(analysis);
  if (hit) return hit;
  const box = mapNodeOf(analysis);
  const bySymbol = new Map(analysis.symbols.map((s) => [s.id, s]));
  const out = new Map<string, Relations>();
  const seen = new Set<string>();
  const add = (host: string, dir: 'callers' | 'callees', s: OndinaSymbol, crosses: boolean) => {
    const key = `${host}\u0000${dir}\u0000${s.id}`;
    if (seen.has(key)) {
      if (crosses) for (const x of out.get(host)![dir]) if (x.id === s.id) x.crosses = true;
      return;
    }
    seen.add(key);
    const r = out.get(host) ?? { callers: [], callees: [] };
    r[dir].push({ id: s.id, name: shortName(s.fqName, s.path, s.kind), layer: s.layer ?? NO_LAYER, path: s.path, crosses });
    out.set(host, r);
  };
  for (const e of analysis.edges) {
    if (e.kind !== 'call' && e.kind !== 'test') continue;
    const f = bySymbol.get(e.from);
    const t = bySymbol.get(e.to);
    if (!f || !t || f.changed === t.changed) continue;
    if (f.changed) add(box(f.id), 'callees', t, e.crossesLayers);
    else if (e.kind === 'call') add(box(t.id), 'callers', f, e.crossesLayers);
  }
  const byName = (a: RelItem, b: RelItem) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const r of out.values()) {
    r.callers.sort(byName);
    r.callees.sort(byName);
  }
  relCache.set(analysis, out);
  return out;
}

/** 「差分なし n か所」の 1 行目と 2 行目 */
export const relLabel = (g: RelGroup) => `差分なし ${g.callers + g.callees} か所`;
export const relSub = (g: RelGroup) => [g.callers > 0 ? `呼び出し元 ${g.callers}` : '', g.callees > 0 ? `呼び出し先 ${g.callees}` : ''].filter(Boolean).join(' · ');

/**
 * 差分の無い相手を、差分の箱ごと・層ごとにまとめる（2026-10-11。見本 2 版「層ごと」）。
 * 同じ層のまとまりは差分の箱の side（右隣）。ほかの層のまとまりはその層の帯の箱（rel）にし、差分の箱と線で結ぶ。
 * 線の向きは多い方（呼び出し元が多ければ相手 → 差分の箱）。両方いれば both（両矢印）。数は箱に書くので線に型ラベルは付けない
 */
function relGroups(analysis: Analysis, nodes: MapNode[], edges: MapEdge[]): { nodes: MapNode[]; edges: MapEdge[] } {
  const rels = relationsOf(analysis);
  const bands = mapBands(analysis);
  const bandAt = (b: string) => {
    const i = bands.indexOf(b);
    return i < 0 ? bands.length : i;
  };
  const extra: MapNode[] = [];
  const lines: MapEdge[] = [];
  const out = nodes.map((n) => {
    const r = rels.get(n.id);
    if (!r) return n;
    const by = new Map<string, RelGroup>();
    const put = (x: RelItem, dir: 'callers' | 'callees') => {
      const g = by.get(x.layer) ?? { host: n.id, layer: x.layer, callers: 0, callees: 0, crosses: false };
      g[dir] += 1;
      g.crosses ||= x.crosses;
      by.set(x.layer, g);
    };
    for (const x of r.callers) put(x, 'callers');
    for (const x of r.callees) put(x, 'callees');
    let side: RelGroup | undefined;
    for (const g of [...by.values()].sort((p, q) => bandAt(p.layer) - bandAt(q.layer) || (p.layer < q.layer ? -1 : 1))) {
      if (g.layer === n.band) {
        side = g;
        continue;
      }
      const id = `${REL_PREFIX}${n.id}:${g.layer}`;
      extra.push({ id, label: relLabel(g), sub: relSub(g), band: g.layer, changed: false, group: false, rel: g });
      const both = g.callers > 0 && g.callees > 0;
      const [from, to] = g.callers >= g.callees ? [id, n.id] : [n.id, id];
      lines.push({ from, to, kind: 'call', n: g.callers + g.callees, crosses: g.crosses, rel: { both } });
    }
    return side ? { ...n, side } : n;
  });
  extra.sort((p, q) => (p.id < q.id ? -1 : 1));
  lines.sort((p, q) => (p.from < q.from ? -1 : p.from > q.from ? 1 : p.to < q.to ? -1 : 1));
  return { nodes: [...out, ...extra], edges: [...edges, ...lines] };
}
