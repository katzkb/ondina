// 説明の画面の「作者の説明」（設計書 3.1）: 原文を改変せず、裏付けのない文（claims の backed: false）と完全一致する箇所にマーカーを打つ。
// 一致しない文は unmatched に出して、近似（完全一致）の破綻が画面で分かるようにする（2026-09-19 決定）。
import type { Claim } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { markClaims } from '../src/claims.js';
import { fixtureAnalysis } from './fixture.js';

const claim = (text: string, backed: boolean, reason = ''): Claim => ({ text, backed, reason });

describe('markClaims', () => {
  it('fixture: 裏付け無しの 2 文にマーカーが付き、原文は前後を合わせると元のまま', () => {
    const a = fixtureAnalysis();
    const { segments, unmatched } = markClaims(a.pr.body!, a.claims);
    expect(segments.map((s) => s.text).join('')).toBe(a.pr.body);
    const marked = segments.filter((s) => s.claim);
    expect(marked).toHaveLength(2);
    expect(marked.map((s) => s.text)).toContain('キャッシュ層を横断的に更新し、割引後の合計が古い値で返らないようにした');
    expect(marked.find((s) => s.text === 'キャッシュ層を横断的に更新し、割引後の合計が古い値で返らないようにした')!.claim!.reason).toContain('キャッシュに当たる変更ファイルが差分に無い');
    expect(unmatched).toEqual([]);
  });

  it('backed: true の文は探さない', () => {
    const { segments, unmatched } = markClaims('ab', [claim('a', true)]);
    expect(segments).toEqual([{ text: 'ab' }]);
    expect(unmatched).toEqual([]);
  });

  it('本文に無い文は unmatched に入る', () => {
    const c = claim('無い文', false, 'r');
    const { segments, unmatched } = markClaims('本文', [c]);
    expect(segments).toEqual([{ text: '本文' }]);
    expect(unmatched).toEqual([c]);
  });

  it('複数の文は出現順に区切られ、同じ文が 2 回あっても最初の 1 箇所だけ', () => {
    const x = claim('x', false);
    const y = claim('y', false);
    const { segments } = markClaims('0y1x2x', [x, y]);
    expect(segments).toEqual([{ text: '0' }, { text: 'y', claim: y }, { text: '1' }, { text: 'x', claim: x }, { text: '2x' }]);
  });

  it('重なる文は先に見つかった方を優先し、もう一方は unmatched', () => {
    const ab = claim('ab', false);
    const bc = claim('bc', false);
    const { segments, unmatched } = markClaims('abc', [ab, bc]);
    expect(segments).toEqual([{ text: 'ab', claim: ab }, { text: 'c' }]);
    expect(unmatched).toEqual([bc]);
  });

  it('空の本文と空の claims', () => {
    expect(markClaims('', [])).toEqual({ segments: [], unmatched: [] });
    expect(markClaims('', [claim('a', false)])).toEqual({ segments: [], unmatched: [claim('a', false)] });
  });
});
