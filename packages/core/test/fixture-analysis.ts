// fixtures/order-service のゴールデンから、cli の analyze --lsp が 2 回の LLM まで終えたときと同じ Analysis を組む（テスト用）。
// web の test/fixture.ts と同じ組み方（あちらは Vite の import.meta.glob、こちらは fs）。トークンは色なし 1 トークンの行で足りる。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Analysis, Claim, Edge, FileText, How, Hunk, RippleGroup, Summary, Symbol, TokenLine, Tour } from '@ondina/model';
import { FIXTURE_ROOT } from './fixture.js';

const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8')) as T;

type Golden = Omit<Hunk, 'kind' | 'kindProvenance' | 'hows' | 'n' | 'tokens'>;
type Hows = { hows: How[]; hunks: Array<{ id: string; kind: Hunk['kind']; kindProvenance: Hunk['kindProvenance']; hows: number[] }>; claims: Claim[] };

function headFile(p: string): FileText | null {
  try {
    const text = readFileSync(path.join(FIXTURE_ROOT, 'head', p), 'utf8');
    return { path: p, tokens: text.replace(/\n$/, '').split('\n').map((l): TokenLine => [[l, null, 0]]) };
  } catch {
    return null;
  }
}

export function fixtureAnalysis({ files = true }: { files?: boolean } = {}): Analysis {
  const labeled = read<Hows>('expected/hows.json');
  const groups = read<{ groups: RippleGroup[] }>('expected/ripples.json').groups;
  const written = read<{ summary: Summary; tours: Tour[] }>('expected/text.json');
  const byId = new Map(labeled.hunks.map((h) => [h.id, h]));
  const groupOf = new Map(groups.flatMap((g) => [...g.members, ...g.deviations].map((id) => [id, g] as const)));
  const hunks: Hunk[] = read<Golden[]>('expected/hunks.json').map((h) => {
    const l = byId.get(h.id);
    const g = groupOf.get(h.id);
    return { ...h, kind: l?.kind ?? 'none', kindProvenance: l?.kindProvenance ?? 'ast', hows: l ? [...l.hows] : [], n: 1, ...(g ? { group: g } : {}) };
  });
  const symbols = read<Symbol[]>('expected/symbols-lsp.json');
  const paths = [...new Set([...hunks.map((h) => h.path), ...symbols.map((s) => s.path)])].sort();
  return {
    pr: { number: 0, title: 'main..feature/discount', base: 'main', head: 'feature/discount', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) },
    hunks,
    hows: labeled.hows,
    symbols,
    edges: read<Edge[]>('expected/edges.json'),
    tours: written.tours,
    specs: [],
    claims: labeled.claims,
    summary: written.summary,
    config: { sourceRoots: [], layers: [], allowedDependencies: {}, normalize: {}, lsp: {} },
    ...(files ? { files: paths.map(headFile).filter((f): f is FileText => f !== null) } : {}),
  };
}
