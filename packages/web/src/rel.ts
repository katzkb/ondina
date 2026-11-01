// 差分の無い相手の引き出し（設計書 3.3。2026-10-11。見本 3 版を比べて決めた）の中身を引く純粋関数。reducer と RelDrawer が使う。
// 地図の箱（差分のある場所）ごとの差分の無い呼び出し元・呼び出し先（relationsOf）を、向きと層で絞って並べる。見た印は持たない
import type { Analysis } from '@ondina/model';
import { GROUP_PREFIX, mapBands, relationsOf, shortName, type RelItem } from './map/graph.js';

/** in = 差分の箱を呼んでいる相手（呼び出し元）、out = 差分の箱が呼んでいる相手（呼び出し先） */
export type RelDir = 'in' | 'out';

export interface RelView {
  /** 地図の箱の id（束は束の箱） */
  host: string;
  dir: RelDir;
  /** 絞っている層。null は全部 */
  layer: string | null;
  /** 選んでいる相手（Symbol.id） */
  sel: string | null;
  /** side = 右からの引き出し（R）、big = 真ん中いっぱい（Shift+R）。地図の引き出しと同じ */
  size: 'side' | 'big';
}

/** その向きの相手（全部の層）。地図の帯の順、同じ層は名前順 */
export function relItems(analysis: Analysis, host: string, dir: RelDir): RelItem[] {
  const r = relationsOf(analysis).get(host);
  if (!r) return [];
  const bands = mapBands(analysis);
  const at = (layer: string) => {
    const i = bands.indexOf(layer);
    return i < 0 ? bands.length : i;
  };
  return (dir === 'in' ? r.callers : r.callees).slice().sort((a, b) => at(a.layer) - at(b.layer) || (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0));
}

/** 一覧に出る相手（層で絞る） */
export function relVisible(analysis: Analysis, v: Pick<RelView, 'host' | 'dir' | 'layer'>): RelItem[] {
  return relItems(analysis, v.host, v.dir).filter((x) => v.layer === null || x.layer === v.layer);
}

/** 層ごとの数（地図の帯の順） */
export function relLayers(analysis: Analysis, host: string, dir: RelDir): Array<{ layer: string; n: number }> {
  const out: Array<{ layer: string; n: number }> = [];
  for (const x of relItems(analysis, host, dir)) {
    const last = out[out.length - 1];
    if (last?.layer === x.layer) last.n += 1;
    else out.push({ layer: x.layer, n: 1 });
  }
  return out;
}

/**
 * 開いた形。向きを省けば、その層に呼び出し元がいれば呼び出し元、いなければ呼び出し先。相手を省くか一覧に無ければ一覧の最初。
 * 相手が 1 つもいなければ null（開かない）
 */
export function openRel(analysis: Analysis, host: string, opt: { dir?: RelDir | undefined; layer?: string | null | undefined; sel?: string | undefined; size: RelView['size'] }): RelView | null {
  const layer = opt.layer ?? null;
  const dir = opt.dir ?? (relVisible(analysis, { host, dir: 'in', layer }).length > 0 ? 'in' : 'out');
  const vis = relVisible(analysis, { host, dir, layer });
  const first = vis[0];
  if (!first) return null;
  const sel = opt.sel !== undefined && vis.some((x) => x.id === opt.sel) ? opt.sel : first.id;
  return { host, dir, layer, sel, size: opt.size };
}

/** 次 / 前の相手。端で止まる */
export function relMove(analysis: Analysis, v: RelView, d: 1 | -1): RelView {
  const vis = relVisible(analysis, v);
  const i = vis.findIndex((x) => x.id === v.sel);
  const next = vis[Math.max(0, Math.min(vis.length - 1, (i < 0 ? 0 : i) + d))];
  return next === undefined || next.id === v.sel ? v : { ...v, sel: next.id };
}

/** 引き出しの見出しに書く、差分の箱の名前 */
export function relHostLabel(analysis: Analysis, host: string): string {
  if (host.startsWith(GROUP_PREFIX)) {
    const group = analysis.hunks.find((h) => h.group?.representative === host.slice(GROUP_PREFIX.length))?.group;
    return group ? `追従 ${group.members.length} 件` : host;
  }
  const s = analysis.symbols.find((x) => x.id === host);
  return s ? shortName(s.fqName, s.path, s.kind) : host;
}

/**
 * 差分の無いファイルの行を出す引き出しの開き方（2026-10-11）。締めのメモの「開く」と案内人の答えの行の場所で、どの停留所にも見えない行に使う。
 * その行が中心の行（宣言か差分を呼ぶ行）の相手 → その行を抜粋に含む相手 → 同じファイルの最初の相手 の順に選ぶ。
 * どの差分の箱の相手にも無いファイルなら null
 */
export function relAt(analysis: Analysis, path: string, line: number): { host: string; dir: RelDir; sel: string } | null {
  const hits: Array<{ host: string; dir: RelDir; sel: string; score: number }> = [];
  for (const [host, r] of relationsOf(analysis)) {
    for (const [dir, xs] of [['in', r.callers], ['out', r.callees]] as const) {
      for (const x of xs) {
        if (x.path !== path) continue;
        const blocks = analysis.symbols.find((y) => y.id === x.id)?.excerpt ?? [];
        const score = blocks.some((b) => b.centers.includes(line)) ? 2 : blocks.some((b) => line >= b.start && line < b.start + b.lines.length) ? 1 : 0;
        hits.push({ host, dir, sel: x.id, score });
      }
    }
  }
  const best = hits.reduce<(typeof hits)[number] | null>((m, h) => (m === null || h.score > m.score ? h : m), null);
  return best === null ? null : { host: best.host, dir: best.dir, sel: best.sel };
}
