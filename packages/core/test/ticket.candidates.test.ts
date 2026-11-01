// --ticket が無いとき、PR の題・ブランチ名・本文からチケットの候補を拾う（設計書 5.1。2026-10-12）。
// 拾うのは番号の形と URL だけ（事実）。どれがこの PR のチケットかは LLM が選ぶ（原則 3）
import { describe, expect, it } from 'vitest';
import { findTicketCandidates, TICKET_CANDIDATE_LIMIT } from '../src/ticket/candidates.js';

const JIRA = 'https://example.atlassian.net/browse/SHOP-421';

describe('findTicketCandidates', () => {
  it('題の番号と本文の URL が同じ番号なら 1 つの候補にまとめ、取りに行く値は URL にする', () => {
    const r = findTicketCandidates({ title: '[SHOP-421] 割引を足す', branch: 'feature/discount', body: `チケット: ${JIRA}\n\n## 概要` });
    expect(r).toEqual({
      candidates: [
        {
          ref: JIRA,
          label: 'SHOP-421',
          places: [
            { in: 'title', text: '[SHOP-421] 割引を足す', start: 1, end: 9 },
            { in: 'body', line: 1, text: `チケット: ${JIRA}`, start: 6, end: 6 + JIRA.length },
          ],
        },
      ],
      more: 0,
    });
  });

  it('ブランチ名は小文字の番号も拾い、名前は大文字にする', () => {
    const r = findTicketCandidates({ branch: 'feature/shop-421-discount', body: '' });
    expect(r.candidates).toEqual([{ ref: 'SHOP-421', label: 'SHOP-421', places: [{ in: 'branch', text: 'feature/shop-421-discount', start: 8, end: 16 }] }]);
  });

  it('題と本文は大文字の番号だけを拾う', () => {
    expect(findTicketCandidates({ title: 'step-1 を直す', branch: 'main', body: 'item-3 と utf-8' }).candidates).toEqual([]);
  });

  it('複数の番号を出てきた順に並べ、本文の行番号を残す。チケットでなさそうな番号の形（UTF-8）も拾う', () => {
    const r = findTicketCandidates({ title: '[SHOP-421] 割引', branch: 'x', body: 'SHOP-421 と SHOP-425 をまとめて対応\n関連: SHOP-399\nCSV は UTF-8' });
    expect(r.candidates.map((c) => [c.label, c.places.map((p) => `${p.in}${p.line ?? ''}`)])).toEqual([
      ['SHOP-421', ['title', 'body1']],
      ['SHOP-425', ['body1']],
      ['SHOP-399', ['body2']],
      ['UTF-8', ['body3']],
    ]);
  });

  it('同じ行の Markdown のリンク（番号の文字と URL）は場所 1 つにまとめ、取りに行く値は URL', () => {
    const r = findTicketCandidates({ branch: 'x', body: `[SHOP-421](${JIRA}) を参照` });
    expect(r.candidates).toEqual([{ ref: JIRA, label: 'SHOP-421', places: [{ in: 'body', line: 1, text: `[SHOP-421](${JIRA}) を参照`, start: 1, end: 9 }] }]);
  });

  it('番号の無い URL はその URL で 1 つの候補。同じ URL はまとめる', () => {
    const url = 'https://github.com/org/repo/issues/12';
    const r = findTicketCandidates({ branch: 'x', body: `${url}\n再掲 ${url}` });
    expect(r.candidates).toEqual([{ ref: url, label: url, places: [expect.objectContaining({ line: 1 }), expect.objectContaining({ line: 2 })] }]);
  });

  it('URL の末尾の句読点と括弧は外す', () => {
    const r = findTicketCandidates({ branch: 'x', body: `（${JIRA}）。\n(${JIRA}).\n${JIRA}、次` });
    expect(r.candidates.map((c) => c.ref)).toEqual([JIRA]);
    expect(r.candidates[0]!.places.map((p) => p.text.slice(p.start, p.end))).toEqual([JIRA, JIRA, JIRA]);
  });

  it('Markdown の画像の URL と HTML コメントの中（PR テンプレートの書き方の例）は拾わない', () => {
    const body = '![画面](https://example.com/SHOP-1.png)\n<!-- 例: https://example.atlassian.net/browse/XXX-000 -->\n<!--\nチケット: ABC-1\n-->\n本文 SHOP-421';
    expect(findTicketCandidates({ branch: 'x', body }).candidates.map((c) => c.label)).toEqual(['SHOP-421']);
  });

  it(`候補は ${TICKET_CANDIDATE_LIMIT} 個まで。超えた数を more に入れる`, () => {
    const body = Array.from({ length: TICKET_CANDIDATE_LIMIT + 3 }, (_, i) => `A-${i + 1}`).join('\n');
    const r = findTicketCandidates({ branch: 'x', body });
    expect(r.candidates).toHaveLength(TICKET_CANDIDATE_LIMIT);
    expect(r.more).toBe(3);
  });

  it('何も無ければ空', () => {
    expect(findTicketCandidates({ title: '割引を足す', branch: 'feature/discount', body: '' })).toEqual({ candidates: [], more: 0 });
  });
});
