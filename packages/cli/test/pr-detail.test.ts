// PR の詳細（設計書 3.11 / 5.5。2026-10-22）: GitHub の GraphQL の答えを PrDetail にする純粋関数。
import { describe, expect, it } from 'vitest';
import { prDetailFromGraphql } from '../src/pr-detail.js';
import { detailNode, detailOf, issueComment, prCommit, prReview } from './pr-graphql.js';

const at = (h: number, m = 0) => `2026-10-22T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const lineComment = (i: number) => ({ path: `src/F${i}.kt`, line: i, originalLine: i, body: `行 ${i}` });

describe('prDetailFromGraphql', () => {
  it('時系列を GitHub の順のまま種類に分け、続いたコミットは 1 件にまとめる（人をまたいでも）。コメントの間で切れたら別の件', () => {
    const d = prDetailFromGraphql(
      detailOf(
        detailNode({
          timelineItems: {
            filteredCount: 7,
            nodes: [
              prCommit('yamada', at(1)),
              prCommit('sato', at(2)),
              issueComment('github-actions[bot]', at(3), 'ありがとうございます'),
              prReview('sato', 'CHANGES_REQUESTED', at(4), '直してください'),
              prCommit('yamada', at(5)),
              prReview('ito', 'APPROVED', at(6)),
              prReview('suzuki', 'COMMENTED', at(7), '質問です'),
            ],
          },
        }),
      ),
    );
    expect(d.timeline).toEqual([
      { kind: 'commits', author: 'yamada', at: at(2), count: 2 },
      { kind: 'comment', author: 'github-actions[bot]', at: at(3), body: 'ありがとうございます' },
      { kind: 'review', author: 'sato', at: at(4), state: 'changes', body: '直してください', comments: [], moreComments: 0 },
      { kind: 'commits', author: 'yamada', at: at(5), count: 1 },
      { kind: 'review', author: 'ito', at: at(6), state: 'approved', body: '', comments: [], moreComments: 0 },
      { kind: 'review', author: 'suzuki', at: at(7), state: 'commented', body: '質問です', comments: [], moreComments: 0 },
    ]);
    expect(d.olderItems).toBe(0);
  });

  it('レビューの行へのコメントは最初の 10 件と残りの数。差分から外れた行は書いたときの行、ファイルへのコメントは行なし', () => {
    const ten = Array.from({ length: 10 }, (_, i) => lineComment(i + 1));
    const outdated = { path: 'src/Old.kt', line: null, originalLine: 42, body: '古い行' };
    const whole = { path: 'README.md', line: null, originalLine: null, body: 'ファイル全体' };
    const d = prDetailFromGraphql(
      detailOf(
        detailNode({
          timelineItems: {
            filteredCount: 2,
            nodes: [prReview('sato', 'COMMENTED', at(1), '', ten, 13), prReview('ito', 'COMMENTED', at(2), '', [outdated, whole])],
          },
        }),
      ),
    );
    const [first, second] = d.timeline;
    expect(first).toMatchObject({ kind: 'review', moreComments: 3 });
    expect(first?.kind === 'review' && first.comments.map((c) => `${c.path}:${c.line}`)).toEqual(ten.map((c) => `${c.path}:${c.line}`));
    expect(second).toMatchObject({ comments: [{ path: 'src/Old.kt', line: 42, body: '古い行' }, { path: 'README.md', line: null, body: 'ファイル全体' }], moreComments: 0 });
  });

  it('下書きのレビュー（PENDING）は出さない。取り下げたレビューは dismissed。消えたアカウントは ghost、コミットの作者が GitHub の人でなければ名前', () => {
    const d = prDetailFromGraphql(
      detailOf(
        detailNode({
          timelineItems: {
            filteredCount: 4,
            nodes: [prReview('me', 'PENDING', at(1), '途中'), prReview('sato', 'DISMISSED', at(2), '前の意見'), { ...issueComment('x', at(3), '消えた人'), author: null }, prCommit(null, at(4), 'Local Name')],
          },
        }),
      ),
    );
    expect(d.timeline.map((t) => [t.kind, t.author, t.kind === 'review' ? t.state : null])).toEqual([
      ['review', 'sato', 'dismissed'],
      ['comment', 'ghost', null],
      ['commits', 'Local Name', null],
    ]);
  });

  it('取っていない古い時系列の数（新しい 100 件だけを取る）', () => {
    const d = prDetailFromGraphql(detailOf(detailNode({ timelineItems: { filteredCount: 130, nodes: [issueComment('a', at(1), 'x'), issueComment('b', at(2), 'y')] } })));
    expect(d.olderItems).toBe(128);
  });

  it('ファイルは GitHub の順と合計。チェックは結果・かかった秒数・説明と合計', () => {
    const d = prDetailFromGraphql(
      detailOf(
        detailNode({
          files: { totalCount: 120, nodes: [{ path: 'b/B.kt', additions: 3, deletions: 0 }, { path: 'a/A.kt', additions: 0, deletions: 5 }] },
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      totalCount: 60,
                      nodes: [
                        { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', startedAt: at(1, 0), completedAt: at(1, 3) },
                        { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'TIMED_OUT', startedAt: at(1, 0), completedAt: at(1, 30) },
                        { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: null, startedAt: at(1, 0), completedAt: null },
                        { __typename: 'CheckRun', name: 'label', status: 'COMPLETED', conclusion: 'SKIPPED', startedAt: '2026-10-22T01:00:01Z', completedAt: '2026-10-22T01:00:00Z' },
                        { __typename: 'CheckRun', name: 'label2', status: 'COMPLETED', conclusion: 'SKIPPED', startedAt: at(1, 0), completedAt: at(1, 0) },
                        { __typename: 'StatusContext', context: 'ci/jenkins', state: 'ERROR', description: 'ビルドが壊れています' },
                        { __typename: 'StatusContext', context: 'deploy/preview', state: 'PENDING', description: null },
                      ],
                    },
                  },
                },
              },
            ],
          },
        }),
      ),
    );
    expect(d.files).toEqual([
      { path: 'b/B.kt', additions: 3, deletions: 0 },
      { path: 'a/A.kt', additions: 0, deletions: 5 },
    ]);
    expect(d.filesTotal).toBe(120);
    expect(d.checks).toEqual([
      { name: 'build', result: 'pass', seconds: 180 },
      { name: 'test', result: 'fail', seconds: 1800 },
      { name: 'lint', result: 'pending' },
      { name: 'label', result: 'skipped' },
      { name: 'label2', result: 'skipped' },
      { name: 'ci/jenkins', result: 'fail', description: 'ビルドが壊れています' },
      { name: 'deploy/preview', result: 'pending' },
    ]);
    expect(d.checksTotal).toBe(60);
  });

  it('本文が null なら空。チェックが無ければ 0 件', () => {
    const d = prDetailFromGraphql(detailOf(detailNode({ body: null })));
    expect(d).toEqual({ number: 7, body: '', timeline: [], olderItems: 0, files: [], filesTotal: 0, checks: [], checksTotal: 0 });
  });

  it('PR が無ければ理由付きで失敗する', () => {
    expect(() => prDetailFromGraphql(detailOf(null))).toThrow(/PR/);
  });
});
