// PR 一覧（3.11）のテストの PR。GET /api/prs の答えの形
import type { OpenPr, PrDetail, PrList } from '@ondina/model';

export function openPr(o: Partial<OpenPr> = {}): OpenPr {
  return {
    number: 7,
    title: '割引を足す',
    url: 'https://github.com/o/order-service/pull/7',
    author: 'yamada',
    draft: false,
    head: 'feature/discount',
    base: 'main',
    headSha: 'a'.repeat(40),
    labels: [],
    reviewers: [],
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    comments: 0,
    updatedAt: '2026-10-22T01:00:00Z',
    checks: 'none',
    ...o,
  };
}

export const prList = (prs: OpenPr[], o: Partial<PrList> = {}): PrList => ({ fetchedAt: Date.parse('2026-10-22T02:00:00Z'), viewer: 'katzkb', prs, truncated: false, ...o });

/** GET /api/prs/:n（PR の詳細）の答え。既定は本文だけ */
export const prDetail = (o: Partial<PrDetail> = {}): PrDetail => ({ number: 7, body: '割引を足します。', timeline: [], olderItems: 0, files: [], filesTotal: 0, checks: [], checksTotal: 0, ...o });
