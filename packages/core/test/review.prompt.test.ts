// PR 一覧から AI にレビューを頼む（設計書 3.11）ときに、レビューのコマンドへ stdin で渡す指示文。決定的で、PR・読み方・付け方・出力の形を全部含む。
import { describe, expect, it } from 'vitest';
import { renderReviewPrompt } from '../src/review/prompt.js';

const BASE = 'b'.repeat(40);
const HEAD = 'a'.repeat(40);
const input = { number: 42, title: '割引を足す', base: 'main', head: 'feature/discount', baseSha: BASE, headSha: HEAD };

describe('renderReviewPrompt', () => {
  it('PR の番号・題・base と head の sha を入れ、同じ入力には同じ本文（原則 7）', () => {
    const p = renderReviewPrompt(input);
    for (const s of ['#42', '割引を足す', `main（${BASE}）`, `feature/discount（${HEAD}）`]) expect(p, s).toContain(s);
    expect(renderReviewPrompt(input)).toBe(p);
  });

  it('差分は head の sha の行番号で読む（git diff と git show）', () => {
    const p = renderReviewPrompt(input);
    for (const s of [`git diff ${BASE} ${HEAD}`, `git show ${HEAD}:<path>`, `git show ${BASE}:<path>`, '行番号がずれる']) expect(p, s).toContain(s);
  });

  it('差分に出る行だけ、1 件 1 行、side と line の決まり、本文の頭のラベル、日本語', () => {
    const p = renderReviewPrompt(input);
    for (const s of ['@@ の塊の中', '1 件に付けるのは 1 行だけ', '"RIGHT"', '"LEFT"', '[must]', '[imo]', '[ask]', '日本語で書く']) expect(p, s).toContain(s);
  });

  it('本文（body）は PR を書いた人へ短く、根拠はレビュアーだけが読む説明（note）に分ける。例にも両方がある', () => {
    const p = renderReviewPrompt(input);
    for (const s of ['PR を書いた人に GitHub で送る', 'レビュアーだけが読む説明で、GitHub には送らない', '"note":']) expect(p, s).toContain(s);
  });

  it('出力は source / headSha / comments の JSON 1 つだけ。GitHub に送らず、ファイルを書き換えない', () => {
    const p = renderReviewPrompt(input);
    for (const s of ['JSON オブジェクト 1 つだけ', '"source"', `"headSha":"${HEAD}"`, '"comments"', 'GitHub に送らない', 'ファイルを書き換えない']) expect(p, s).toContain(s);
  });

  it('例文は fixture と別の題材（在庫の引き当て）', () => {
    const p = renderReviewPrompt(input);
    expect(p).toContain('在庫');
    expect(p.replace('割引を足す', '').replace('feature/discount', '')).not.toMatch(/割引|注文/);
  });
});
