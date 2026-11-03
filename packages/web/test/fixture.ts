// fixtures/order-service のゴールデン（hunks.json + tokens.json + ripples.json + hows.json + symbols-lsp.json + edges.json + tours.json + text.json + github-diff.json + definitions.json）と pr-body.md から、
// cli の analyze --lsp が 2 回の LLM（目的ごとに分ける・文を書く）まで終えたときと同じ Analysis を組む。
// hunks.json は Stage 1 の SemanticHunk なので、ripples.json の group と hows.json の kind / hows（LLM の検証結果）を重ねる。
import type { Analysis, Background, Claim, Definitions, Edge, FileText, GithubDiffFile, How, Hunk, MapGroups, ReviewState, RippleGroup, Summary, Symbol, TokenLine, Tour } from '@ondina/model';
import definitionsJson from '../../../fixtures/order-service/expected/definitions.json';
import edgesJson from '../../../fixtures/order-service/expected/edges.json';
import githubDiffJson from '../../../fixtures/order-service/expected/github-diff.json';
import howsJson from '../../../fixtures/order-service/expected/hows.json';
import mapGroupsJson from '../../../fixtures/order-service/expected/map-groups.json';
import hunksJson from '../../../fixtures/order-service/expected/hunks.json';
import ripplesJson from '../../../fixtures/order-service/expected/ripples.json';
import symbolsJson from '../../../fixtures/order-service/expected/symbols-lsp.json';
import tokensJson from '../../../fixtures/order-service/expected/tokens.json';
import textJson from '../../../fixtures/order-service/expected/text.json';
import toursJson from '../../../fixtures/order-service/expected/tours.json';
import prBody from '../../../fixtures/order-service/pr-body.md?raw';

// head の全文（Analysis.files）。cli はトークン化して入れるが、ここは色なし 1 トークンの行で足りる（行の対応を見る）
const HEAD_ROOT = '../../../fixtures/order-service/head/';
const headTexts = import.meta.glob('../../../fixtures/order-service/head/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const BASE_ROOT = '../../../fixtures/order-service/base/';
const baseTexts = import.meta.glob('../../../fixtures/order-service/base/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const linesOf = (text: string) => text.replace(/\n$/, '').split('\n').map((l): TokenLine => [[l, null, 0]]);

/** 差分のあるファイルと Symbol.path のファイル（cli の headFileSources と同じ選び方。削除ファイルは head に無いので入らない） */
export function fixtureFiles(paths: Iterable<string>): FileText[] {
  return [...new Set(paths)]
    .filter((p) => headTexts[HEAD_ROOT + p] !== undefined)
    .sort()
    .map((p) => ({ path: p, tokens: linesOf(headTexts[HEAD_ROOT + p]!) }));
}

/** 名前から定義へ（3.6）。実機の記録（lsp/definitions.json）を core が組んだゴールデン */
export function fixtureDefs(): Definitions {
  return structuredClone(definitionsJson as unknown as Definitions);
}

/** 定義の引き出しに出すファイル（行き先のうち差分の列に無いもの。cli の drawerFiles と同じ選び方） */
function drawerPaths(defs: Definitions, side: 'head' | 'base'): string[] {
  return defs.targets.flatMap((t) => ('lib' in t || t.shown !== undefined || t.side !== side ? [] : [t.path]));
}

/** base の全文（定義の行き先が base で、差分の列に無いファイル） */
function fixtureBaseFiles(paths: Iterable<string>): FileText[] {
  return [...new Set(paths)]
    .filter((p) => baseTexts[BASE_ROOT + p] !== undefined)
    .sort()
    .map((p) => ({ path: p, tokens: linesOf(baseTexts[BASE_ROOT + p]!) }));
}

type Golden = Omit<Hunk, 'kind' | 'kindProvenance' | 'hows' | 'n' | 'tokens'>;
type Ripples = { groups: RippleGroup[] };
type Hows = { hows: How[]; hunks: Array<{ id: string; kind: Hunk['kind']; kindProvenance: Hunk['kindProvenance']; hows: number[] }>; claims: Claim[] };
/** 2 回目の LLM（文を書く）の記録を検証した結果。tours は tours.json に紹介・停留所の 2 行を重ねたもの。background は前からあるものと言葉（2026-10-29） */
type Text = { summary: Summary; background: Background; tours: Tour[] };

/** hows.json（LLM の記録を検証した結果）を重ねた hunk。kind / kindProvenance / hows は hows.json が最終 */
export function fixtureHunks(): Hunk[] {
  const tokens = tokensJson as unknown as Record<string, TokenLine[]>;
  const ripples = ripplesJson as unknown as Ripples;
  const labeled = new Map((howsJson as unknown as Hows).hunks.map((h) => [h.id, h]));
  const groupOf = new Map(ripples.groups.flatMap((g) => [...g.members, ...g.deviations].map((id) => [id, g] as const)));
  return (hunksJson as Golden[]).map((h) => {
    const t = tokens[h.id];
    const l = labeled.get(h.id);
    const g = groupOf.get(h.id);
    return {
      ...h,
      kind: l?.kind ?? 'none',
      kindProvenance: l?.kindProvenance ?? 'ast',
      hows: l ? [...l.hows] : [],
      n: 1,
      ...(t ? { tokens: t } : {}),
      ...(g ? { group: structuredClone(g) } : {}),
    };
  });
}

/** text: false = 2 回目の LLM が無い解析（tours に文が無く、summary は空、llmText の欄も無い）。画面は事実から組んだ「自動」の文 */
export function fixtureAnalysis({ text = true }: { text?: boolean } = {}): Analysis {
  const hows = howsJson as unknown as Hows;
  const written = textJson as unknown as Text;
  const hunks = fixtureHunks();
  const symbols = structuredClone(symbolsJson as unknown as Symbol[]);
  const defs = fixtureDefs();
  return {
    pr: { number: 0, title: 'main..feature/discount', base: 'main', head: 'feature/discount', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), body: prBody },
    hunks,
    hows: structuredClone(hows.hows),
    symbols,
    edges: structuredClone(edgesJson as unknown as Edge[]),
    tours: structuredClone(text ? written.tours : (toursJson as unknown as Tour[])),
    specs: [],
    claims: structuredClone(hows.claims),
    summary: text ? structuredClone(written.summary) : {},
    ...(text ? { background: structuredClone(written.background) } : {}),
    // 層の名前と順番は fixtures/order-service/ondina.config.yaml と同じ（地図のバンドになる）
    config: {
      sourceRoots: [],
      layers: [
        { name: 'Tests', match: ['src/test/**'] },
        { name: 'API', match: ['**/api/**'] },
        { name: 'Application', match: ['**/application/**', '**/usecase/**'] },
        { name: 'Domain', match: ['**/domain/**'] },
        { name: 'Infrastructure', match: ['**/infra/**', 'src/main/resources/db/**'] },
      ],
      allowedDependencies: {},
      normalize: {},
      lsp: {},
    },
    lsp: { command: 'fixture', status: 'ok' },
    llm: { command: 'fixture', status: 'ok' },
    ...(text ? { llmText: { command: 'fixture', status: 'ok' as const } } : {}),
    files: fixtureFiles([...hunks.map((h) => h.path), ...symbols.map((s) => s.path), ...drawerPaths(defs, 'head')]),
    baseFiles: fixtureBaseFiles(drawerPaths(defs, 'base')),
    defs,
    githubDiff: structuredClone(githubDiffJson as GithubDiffFile[]),
    mapGroups: structuredClone(mapGroupsJson as unknown as MapGroups),
  };
}

/**
 * fixture に差分の無い呼び出し元・呼び出し先を足した Analysis（地図で未変更の箱をまとめる規則を見る。設計書 3.3）。
 * 言語サーバーは変更シンボルごとに incomingCalls / outgoingCalls を 1 段聞き、相手を changed: false で載せる（core/src/lsp/edges.ts）。
 * - domain.Order の呼び出し元 4（Application）: まとめる
 * - OrderRepositoryImpl.find の呼び出し元 2（Application）: まとめない（2 個以下）
 * - ApplyDiscountUseCase.execute の呼び出し先 3（Domain）: まとめる。同じ相手の停留所 OrderRepository.find は入れない
 */
export function fixtureWithNeighbors(): Analysis {
  const a = fixtureAnalysis();
  const id = (fq: string) => a.symbols.find((s) => s.fqName === fq)!.id;
  const add = (fqName: string, path: string, layer: string, target: string, dir: 'in' | 'out') => {
    const sid = `unchanged:${fqName}`;
    a.symbols.push({ id: sid, fqName, path, layer, layerProvenance: 'config', kind: 'function', changed: false, edgesMeasured: true });
    a.edges.push({ ...(dir === 'in' ? { from: sid, to: id(target) } : { from: id(target), to: sid }), kind: 'call', crossesLayers: false, provenance: 'lsp' });
  };
  for (const p of ['stock', 'billing', 'refund', 'cart']) {
    const c = `${p[0]!.toUpperCase()}${p.slice(1)}UseCase`;
    add(`com.example.${p}.application.${c}.execute`, `src/main/kotlin/com/example/${p}/application/${c}.kt`, 'Application', 'com.example.order.domain.Order', 'in');
  }
  for (const p of ['report', 'search']) {
    const c = `${p[0]!.toUpperCase()}${p.slice(1)}Query`;
    add(`com.example.${p}.application.${c}.load`, `src/main/kotlin/com/example/${p}/application/${c}.kt`, 'Application', 'com.example.order.infra.OrderRepositoryImpl.find', 'in');
  }
  for (const [c, f] of [['Money', 'plus'], ['Clock', 'now'], ['OrderId', 'of']] as const) {
    add(`com.example.order.domain.${c}.${f}`, `src/main/kotlin/com/example/order/domain/${c}.kt`, 'Domain', 'com.example.order.application.ApplyDiscountUseCase.execute', 'out');
  }
  return a;
}

export function emptyReview(): ReviewState {
  return { viewed: [], comments: [] };
}
