// GitHub の差分の塊（12 章）に行が入るか。cli が AI の下書きを受けるときと送るときに使う
import type { GithubDiffFile } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { onGithubDiff } from '../src/review/github-diff.js';

const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
const CTRL = 'src/main/kotlin/com/example/order/api/OrderController.kt';
// fixture の GitHub の差分（2026-10-06 に本物の PR と一致を確認した塊）
const DIFF: GithubDiffFile[] = [
  { path: CTRL, hunks: [{ oldStart: 5, oldLines: 6, newStart: 5, newLines: 7 }, { oldStart: 13, oldLines: 8, newStart: 14, newLines: 9 }] },
  { path: ORDER, hunks: [{ oldStart: 3, oldLines: 9, newStart: 3, newLines: 12 }] },
];
const c = (over: { line: number; startLine?: number; startSide?: 'LEFT' | 'RIGHT' }) => ({ path: CTRL, side: 'RIGHT' as const, ...over });

describe('onGithubDiff', () => {
  it('塊の端の文脈行（変更から 3 行目）は入る、塊の間の行は入らない', () => {
    expect(onGithubDiff(DIFF, c({ line: 11 }))).toBe(true);
    expect(onGithubDiff(DIFF, c({ line: 12 }))).toBe(false);
  });

  it('範囲は始まりと終わりがどちらも塊に入れば入る（2 つの塊にまたがってもよい）。始まりが外なら入らない', () => {
    expect(onGithubDiff(DIFF, c({ startLine: 10, startSide: 'RIGHT', line: 15 }))).toBe(true);
    expect(onGithubDiff(DIFF, c({ startLine: 12, startSide: 'RIGHT', line: 15 }))).toBe(false);
  });

  it('base 側の行は oldStart / oldLines で見る', () => {
    expect(onGithubDiff(DIFF, { path: ORDER, line: 11, side: 'LEFT' })).toBe(true);
    expect(onGithubDiff(DIFF, { path: ORDER, line: 12, side: 'LEFT' })).toBe(false);
    expect(onGithubDiff(DIFF, { path: ORDER, startLine: 6, startSide: 'LEFT', line: 11, side: 'RIGHT' })).toBe(true);
  });

  it('差分の無いファイル（変わっていない場所）は入らない', () => {
    expect(onGithubDiff(DIFF, { path: 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt', line: 10, side: 'RIGHT' })).toBe(false);
  });

  it('GitHub の差分の範囲が無い解析（local と古い解析）は決めない', () => {
    expect(onGithubDiff(undefined, c({ line: 12 }))).toBeUndefined();
  });
});
