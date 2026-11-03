// 入口の地図のまとまり（設計書 3.3。2026-11-04 の案 A）。箱をコースで分け、コースが 8 つ以上なら LLM の題でまとめる
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { How, Hunk } from '@ondina/model';
import { buildMapGroups } from '../src/mapgroup/build.js';
import { fixtureAnalysis } from './fixture-analysis.js';
import { FIXTURE_ROOT } from './fixture.js';

const H = (id: string, p: string, hows: number[], kind: Hunk['kind'] = 'core'): Hunk => ({
  id,
  path: p,
  lang: 'kotlin',
  symbol: id,
  symbolFqName: id,
  symbolKind: 'function',
  kind,
  kindProvenance: 'ast',
  hows,
  n: 1,
  lnOld: 1,
  lnNew: 1,
  lines: [`+${id}`],
  say: {} as Hunk['say'],
  facts: [],
});
const W = (id: number): How => ({ id, title: `コース ${id}`, why: '', specIds: [] });

describe('fixture', () => {
  const a = fixtureAnalysis({ files: false });
  const { mapGroups, info } = buildMapGroups({ hunks: a.hunks, hows: a.hows, tours: a.tours });

  it('7 コースならコースとコース外がそのまま全景に並ぶ', () => {
    expect(mapGroups.root).toEqual(['course:1', 'course:2', 'course:3', 'course:4', 'course:5', 'course:6', 'course:7', 'outside']);
    expect(info).toEqual([]);
  });

  it('テストの hunk は箱にしない。束は 1 箱', () => {
    const boxed = new Set(mapGroups.boxes.flatMap((b) => b.hunkIds));
    expect(a.hunks.filter((h) => h.kind === 'test').some((h) => boxed.has(h.id))).toBe(false);
    expect(a.hunks.filter((h) => h.kind !== 'test').every((h) => boxed.has(h.id))).toBe(true);
    expect(mapGroups.boxes.filter((b) => b.id.startsWith('group:'))).toHaveLength(1);
  });

  it('どの箱もちょうど 1 つのまとまりに入る', () => {
    const children = mapGroups.groups.flatMap((g) => g.children);
    expect([...children].sort()).toEqual(mapGroups.boxes.map((b) => b.id).sort());
  });

  it('ゴールデン', async () => {
    await expect(JSON.stringify(mapGroups, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/map-groups.json'));
  });
});

describe('コースが 8 つ以上', () => {
  const hows = [1, 2, 3, 4, 5, 6, 7, 8].map(W);
  // コース 1 は箱 8 つ、ほかは 1 つずつ
  const hunks = [...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => H(`a${i}`, `src/A${i}.kt`, [1])), ...[2, 3, 4, 5, 6, 7, 8].map((n) => H(`b${n}`, `src/B${n}.kt`, [n]))];
  const themes = [
    { title: '大きい題', howIds: [2, 1] },
    { title: '小さい題', howIds: [3, 4] },
    { title: '残り', howIds: [5, 6, 7, 8] },
  ];

  it('題が全景に並び、箱が 8 つ以上の題の中はコース、7 つ以下の題の中は箱', () => {
    const { mapGroups, info } = buildMapGroups({ hunks, hows, tours: [], themes });
    expect(info).toEqual([]);
    expect(mapGroups.root).toEqual(['theme:1', 'theme:2', 'theme:3']);
    const g = new Map(mapGroups.groups.map((x) => [x.id, x]));
    expect(g.get('theme:1')).toMatchObject({ title: '大きい題', provenance: 'llm', children: ['course:1', 'course:2'] });
    expect(g.get('theme:2')).toMatchObject({ children: ['file:src/B3.kt', 'file:src/B4.kt'] });
    expect(g.get('course:1')?.children).toHaveLength(8);
  });

  it('題が規則に合わなければ使わず、コースを全部並べて理由を残す', () => {
    const { mapGroups, info } = buildMapGroups({ hunks, hows, tours: [], themes: [{ title: '大きい題', howIds: [1, 2] }] });
    expect(mapGroups.root).toEqual(['course:1', 'course:2', 'course:3', 'course:4', 'course:5', 'course:6', 'course:7', 'course:8']);
    expect(info).toEqual(['地図のまとまりの名前を使いませんでした: どのまとまりにも入らないコースがあります（3、4、5、6、7、8）']);
  });

  it('2 つの題に入ったコースがあれば使わない', () => {
    const { info } = buildMapGroups({ hunks, hows, tours: [], themes: [...themes, { title: '重複', howIds: [1] }] });
    expect(info).toEqual(['地図のまとまりの名前を使いませんでした: 2 つのまとまりに入ったコースがあります']);
  });
});

describe('箱のコース', () => {
  it('ファイルの hunk の How のうち一番小さいもの。どこにも無ければコース外', () => {
    const { mapGroups } = buildMapGroups({ hunks: [H('x1', 'src/X.kt', [3]), H('x2', 'src/X.kt', [2, 3]), H('y', 'src/Y.kt', [], 'none')], hows: [W(2), W(3)], tours: [] });
    expect(mapGroups.boxes.map((b) => [b.label, b.course])).toEqual([
      ['X', 2],
      ['Y', 0],
    ]);
    expect(mapGroups.root).toEqual(['course:2', 'outside']);
  });
});
