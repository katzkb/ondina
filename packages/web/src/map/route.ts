// 入口の地図の道順（設計書 3.1）。選んだコースの停留所の箱を順に結び、道順とそのコースの差分以外の箱を沈める。
// 規則は承認したデモ（2026-09-29）の hubMap と同じ。プログラムが停留所の並びから機械的に作る（原則 3）。
import type { Analysis } from '@ondina/model';
import type { Course } from '../course.js';
import { mapNodeOf, REL_PREFIX } from './graph.js';
import type { Point } from './layout.js';

/** 停留所の箱の列。束のメンバーは束の箱、地図に無い箱（テスト）は落とし、続く同じ箱は 1 つにする */
export function courseRoute(analysis: Analysis, course: Course, present: ReadonlySet<string>): string[] {
  const boxOf = mapNodeOf(analysis);
  const out: string[] = [];
  for (const s of course.steps) {
    const id = boxOf(s.symbolId);
    if (present.has(id) && out[out.length - 1] !== id) out.push(id);
  }
  return out;
}

/** 沈めずに残す箱: 道順の箱と、そのコースの差分の箱と、それらの「差分なし n か所」（id が REL_PREFIX + 箱の id + ':' + 層） */
export function courseKeep(analysis: Analysis, course: Course, route: readonly string[], present: ReadonlySet<string>): Set<string> {
  const boxOf = mapNodeOf(analysis);
  const keep = new Set(route);
  for (const h of course.hunkIds) if (present.has(boxOf(h))) keep.add(boxOf(h));
  const hosts = [...keep];
  for (const id of present) if (id.startsWith(REL_PREFIX) && hosts.some((k) => id.startsWith(`${REL_PREFIX}${k}:`))) keep.add(id);
  return keep;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 2 つの箱を結ぶ折れ線。同じ段（上下が重なる）なら横の直線、段が違えば縦に出て間の高さで折れる */
export function routePoints(a: Box, b: Box): Point[] {
  if (a.y < b.y + b.h && b.y < a.y + a.h) {
    const y = a.y + a.h / 2;
    return a.x <= b.x
      ? [
          { x: a.x + a.w, y },
          { x: b.x, y },
        ]
      : [
          { x: a.x, y },
          { x: b.x + b.w, y },
        ];
  }
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  const down = a.y < b.y;
  const from = down ? a.y + a.h : a.y;
  const to = down ? b.y : b.y + b.h;
  const mid = (from + to) / 2;
  return [
    { x: ax, y: from },
    { x: ax, y: mid },
    { x: bx, y: mid },
    { x: bx, y: to },
  ];
}
