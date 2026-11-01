// 名前から定義へ（設計書 3.6。2026-10-29。見本を比べて「右に出す」にした）。Analysis.defs を行ごとに引けるようにする。
// 行き先がコード欄に出ている行（差分一覧は shown、コース・目的ごとはコード欄のファイル）ならそこへ動かし、無ければ右の引き出しにファイル全体を出し、ライブラリなら知らせるだけ（reducer の def.go）
import type { Analysis, DefTarget, Definitions } from '@ondina/model';

export type DefSide = 'head' | 'base';

/** 1 行の名前: [列（0 始まり）, 長さ, targets の添字] */
export type DefName = readonly [number, number, number];

/** 引き出しに出す行き先（リポジトリの中） */
export type DefPlaceTarget = Exclude<DefTarget, { lib: string }>;

export interface DefIndex {
  /** その行（1 始まり）の名前。列の順 */
  names(side: DefSide, path: string, line: number): readonly DefName[];
  /** そのファイルの名前を聞いたか。whole = 全部の行、part = 差分の行だけ、null = 聞いていない（その先のファイル） */
  asked(side: DefSide, path: string): 'whole' | 'part' | null;
  targets: readonly DefTarget[];
}

const NONE: readonly DefName[] = [];
const cache = new WeakMap<Definitions, DefIndex>();

export function defIndex(defs: Definitions | undefined): DefIndex | null {
  if (defs === undefined) return null;
  const hit = cache.get(defs);
  if (hit) return hit;
  const lines = new Map<string, DefName[]>();
  const asked = new Map<string, 'whole' | 'part'>();
  for (const f of defs.files) {
    asked.set(`${f.side}\n${f.path}`, f.part ? 'part' : 'whole');
    for (const [line, col, len, t] of f.names) {
      const k = `${f.side}\n${f.path}\n${line}`;
      const list = lines.get(k) ?? [];
      list.push([col, len, t]);
      lines.set(k, list);
    }
  }
  const index: DefIndex = {
    names: (side, path, line) => lines.get(`${side}\n${path}\n${line}`) ?? NONE,
    asked: (side, path) => asked.get(`${side}\n${path}`) ?? null,
    targets: defs.targets,
  };
  cache.set(defs, index);
  return index;
}

/** 押した名前（その行のその列から始まる名前）の行き先 */
export function defTargetAt(analysis: Analysis | null, side: DefSide, path: string, line: number, col: number): DefTarget | undefined {
  const index = defIndex(analysis?.defs);
  const name = index?.names(side, path, line).find(([c]) => c === col);
  return name === undefined ? undefined : index!.targets[name[2]];
}
