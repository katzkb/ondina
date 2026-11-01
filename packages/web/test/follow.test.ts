// 差分一覧の列（全部のファイルを 1 本。2026-10-20）の位置の計算。行の高さの数だけで確かめる（DOM を読まない）
import type { Hunk } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { bodyStart, FILE_HEAD_H, layoutOf, revealPlan, stickyOf, viewportOf } from '../src/diff/follow.js';
import { buildRows } from '../src/diff/rows.js';
import { fixtureHunks } from './fixture.js';

const h = (id: string, path: string, lines: string[]): Hunk => ({ ...fixtureHunks()[0]!, id, path, lnOld: 1, lnNew: 1, lines });
// A.kt: a1（見出し + 3 行）, a2（見出し + 2 行）/ B.kt: b1（見出し + 3 行）/ C.kt: c1（見出し + 1 行）
const rows = buildRows([h('a1', 'A.kt', ['+1', '+2', '+3']), h('a2', 'A.kt', ['+1', '+2']), h('b1', 'B.kt', ['+1', '+2', '+3']), h('c1', 'C.kt', ['+1'])], 'uni', true);
const layout = layoutOf(rows);
// ファイルの見出しと差分の見出しは 34、行は 21。上から: A 0, a1 34, a2 131, B 207, b1 241, C 338, c1 372。全体 427
const items = rows.reduce<{ index: number; start: number; end: number; size: number }[]>((out, r, index) => {
  const start = out.at(-1)?.end ?? 0;
  const size = r.kind === 'file' || r.kind === 'header' ? 34 : 21;
  return [...out, { index, start, end: start + size, size }];
}, []);
const total = items.at(-1)!.end;
const at = (kind: 'file' | 'header', key: string) => rows.findIndex((r) => (r.kind === 'file' ? kind === 'file' && r.path === key : r.kind === 'header' && kind === 'header' && r.hunk.id === key));

/** 仮想リスト（virtual-core の getOffsetForIndex）と同じ答え方。scrollPaddingStart = FILE_HEAD_H、行き先は 0〜(全体 - 画面) に収める */
const offsetOf = (offset: number, height: number) => (i: number, align: 'start' | 'auto' | 'center'): [number, string] | undefined => {
  const it = items[i];
  if (!it) return undefined;
  const clamp = (x: number) => Math.max(0, Math.min(total - height, x));
  if (align === 'auto') {
    if (it.end >= offset + height) return [clamp(it.end - height), 'end'];
    if (it.start <= offset + FILE_HEAD_H) return [clamp(it.start - FILE_HEAD_H), 'start'];
    return [offset, 'auto'];
  }
  if (align === 'center') return [clamp(it.start - FILE_HEAD_H + (it.size - height) / 2), 'center'];
  return [clamp(it.start - FILE_HEAD_H), 'start'];
};

describe('viewportOf（一番上のファイルと見えている差分）', () => {
  it('file は一番上の行のファイル。hunks は貼り付く見出しの下に 1 行でも出ている差分を上から', () => {
    expect(viewportOf(layout, items, { offset: 0, height: 150, total }, null)).toEqual({ file: 'A.kt', hunks: ['a1', 'a2'] });
    expect(viewportOf(layout, items, { offset: 207, height: 150, total }, null)).toEqual({ file: 'B.kt', hunks: ['b1'] });
  });

  it('貼り付く見出しの下に全部隠れた差分は見えていない', () => {
    // a1 の最後の行（110〜131）は 100〜134 に隠れる
    expect(viewportOf(layout, items, { offset: 100, height: 150, total }, null)).toEqual({ file: 'A.kt', hunks: ['a2', 'b1'] });
  });

  it('一番下まで来ていて選んだ差分が見えていれば、そのファイル（最後の短いファイルは一番上に来られない）', () => {
    const end = { offset: total - 150, height: 150, total };
    expect(viewportOf(layout, items, end, 'c1')).toEqual({ file: 'C.kt', hunks: ['b1', 'c1'] });
    expect(viewportOf(layout, items, end, 'b1')!.file).toBe('B.kt');
    expect(viewportOf(layout, items, end, 'a1')!.file).toBe('B.kt');
    // 一番下でなければ、選んだ差分が見えていても一番上のファイル
    expect(viewportOf(layout, items, { offset: 250, height: 150, total }, 'c1')).toEqual({ file: 'B.kt', hunks: ['b1', 'c1'] });
  });
});

describe('revealPlan（スクロールの行き先）', () => {
  it('file: そのファイルの最初の中身の行を start（padding の分だけ上 = ファイルの見出しが一番上）', () => {
    const i = at('header', 'b1');
    expect(bodyStart(layout, i)).toBe(at('file', 'B.kt') + 1);
    expect(revealPlan(i, 'file', bodyStart(layout, i), offsetOf(0, 150))).toEqual({ index: at('file', 'B.kt') + 1, align: 'start' });
  });

  it('hunk: 見えていれば動かさない', () => {
    const i = at('header', 'a2');
    expect(revealPlan(i, 'hunk', bodyStart(layout, i), offsetOf(90, 150))).toBeNull();
  });

  it('hunk: 下のファイルの差分へは、前のファイルの末尾を一番上に残さずファイルの頭へ', () => {
    const i = at('header', 'b1');
    expect(revealPlan(i, 'hunk', bodyStart(layout, i), offsetOf(0, 150))).toEqual({ index: bodyStart(layout, i), align: 'start' });
  });

  it('hunk: ファイルの頭から 1 画面より奥の差分と、上の差分はそのまま見える所まで', () => {
    const a2 = at('header', 'a2');
    expect(revealPlan(a2, 'hunk', bodyStart(layout, a2), offsetOf(0, 100))).toEqual({ index: a2, align: 'auto' });
    // B を一番上にしてから A の最後の差分へ戻る
    expect(revealPlan(a2, 'hunk', bodyStart(layout, a2), offsetOf(207, 150))).toEqual({ index: a2, align: 'auto' });
  });

  it('line: 真ん中に寄せるとファイルの頭より上が出るなら、ファイルの頭へ', () => {
    const first = at('header', 'b1') + 1;
    expect(revealPlan(first, 'line', bodyStart(layout, first), offsetOf(0, 150))).toEqual({ index: bodyStart(layout, first), align: 'start' });
    const third = first + 2;
    expect(revealPlan(third, 'line', bodyStart(layout, third), offsetOf(0, 150))).toEqual({ index: third, align: 'center' });
  });
});

describe('stickyOf（貼り付く見出し）', () => {
  const startOf = (i: number) => items[i]!.start;

  it('ファイルの中では押し上げない。次のファイルの見出しが見出しの高さより近づくと、その分だけ上へ', () => {
    expect(stickyOf(layout, startOf, 0)).toEqual({ head: at('file', 'A.kt'), path: 'A.kt', shift: 0 });
    expect(stickyOf(layout, startOf, 190)).toEqual({ head: at('file', 'A.kt'), path: 'A.kt', shift: -17 });
  });

  it('次のファイルの見出しがちょうど一番上に来たら、そのファイル。最後のファイルは押し上げない', () => {
    expect(stickyOf(layout, startOf, 207)).toEqual({ head: at('file', 'B.kt'), path: 'B.kt', shift: 0 });
    expect(stickyOf(layout, startOf, total - 30)).toEqual({ head: at('file', 'C.kt'), path: 'C.kt', shift: 0 });
  });

  it('見出しの行が無い列（1 ファイルの画面）では出さない', () => {
    expect(stickyOf(layoutOf(buildRows([h('a1', 'A.kt', ['+1'])], 'uni')), startOf, 0)).toBeNull();
  });
});
