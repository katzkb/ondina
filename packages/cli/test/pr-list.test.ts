// PR 一覧（設計書 3.11 / 5.5。2026-10-22）: GitHub の GraphQL の答えを OpenPr にする純粋関数と、リポジトリの宛先の読み方。
import { describe, expect, it } from 'vitest';
import { prsFromGraphql, repoTargetFromGhJson } from '../src/pr-list.js';
import { graphqlOf, prNode } from './pr-graphql.js';

const user = (login: string) => ({ login, __typename: 'User' });
const review = (login: string, state: string) => ({ author: user(login), state });

describe('prsFromGraphql', () => {
  it('PR の事実を写す', () => {
    const r = prsFromGraphql(graphqlOf([prNode({ isDraft: true, labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] } })]));
    expect(r).toEqual({
      viewer: 'katzkb',
      truncated: false,
      prs: [
        {
          number: 7,
          title: '割引を足す',
          url: 'https://ghe.example.co.jp/team-a/order-service/pull/7',
          author: 'yamada',
          draft: true,
          head: 'feature/discount',
          base: 'main',
          headSha: 'a'.repeat(40),
          labels: [{ name: 'bug', color: 'd73a4a' }],
          reviewers: [],
          additions: 10,
          deletions: 2,
          changedFiles: 3,
          comments: 0,
          updatedAt: '2026-10-22T01:00:00Z',
          checks: 'none',
        },
      ],
    });
  });

  it('人ごとの最後の意見: 承認・修正の依頼は上書き、取り下げ（DISMISSED）は意見を消してコメントに戻す、コメントだけのレビューは上書きしない、下書き（PENDING）は見ない', () => {
    const reviews = [
      review('a', 'COMMENTED'),
      review('a', 'APPROVED'),
      review('b', 'APPROVED'),
      review('b', 'CHANGES_REQUESTED'),
      review('c', 'CHANGES_REQUESTED'),
      review('c', 'DISMISSED'),
      review('d', 'APPROVED'),
      review('d', 'COMMENTED'),
      review('e', 'PENDING'),
    ];
    expect(prsFromGraphql(graphqlOf([prNode({ reviews: { nodes: reviews } })])).prs[0]!.reviewers).toEqual([
      { login: 'a', state: 'approved' },
      { login: 'b', state: 'changes' },
      { login: 'c', state: 'commented' },
      { login: 'd', state: 'approved' },
    ]);
  });

  it('作者と bot はレビューした人に入れない（自分の PR へのコメント、Bot の型、login が [bot] で終わる人）', () => {
    const node = prNode({
      reviews: { nodes: [review('yamada', 'COMMENTED'), { author: { login: 'renovate', __typename: 'Bot' }, state: 'APPROVED' }, review('sato', 'COMMENTED')] },
      comments: { totalCount: 3, nodes: [{ author: user('yamada') }, { author: { login: 'github-actions[bot]', __typename: 'User' } }, { author: user('ito') }] },
    });
    expect(prsFromGraphql(graphqlOf([node])).prs[0]!.reviewers).toEqual([
      { login: 'sato', state: 'commented' },
      { login: 'ito', state: 'commented' },
    ]);
  });

  it('依頼中でまだレビューしていない人は requested。チームは名前で team。レビュー済みの人は今の意見のまま', () => {
    const node = prNode({
      reviews: { nodes: [review('sato', 'APPROVED')] },
      reviewRequests: {
        nodes: [
          { requestedReviewer: { __typename: 'User', login: 'sato' } },
          { requestedReviewer: { __typename: 'User', login: 'katzkb' } },
          { requestedReviewer: { __typename: 'Team', name: 'backend' } },
          { requestedReviewer: null },
        ],
      },
    });
    expect(prsFromGraphql(graphqlOf([node])).prs[0]!.reviewers).toEqual([
      { login: 'sato', state: 'approved' },
      { login: 'katzkb', state: 'requested' },
      { login: 'backend', state: 'requested', team: true },
    ]);
  });

  it('CI: 成功は pass、失敗とエラーは fail、実行中と待ちは pending、無ければ none', () => {
    const checks = (state: string | null) =>
      prsFromGraphql(graphqlOf([prNode({ commits: { nodes: [{ commit: { statusCheckRollup: state === null ? null : { state } } }] } })])).prs[0]!.checks;
    expect([checks('SUCCESS'), checks('FAILURE'), checks('ERROR'), checks('PENDING'), checks('EXPECTED'), checks(null)]).toEqual(['pass', 'fail', 'fail', 'pending', 'pending', 'none']);
    expect(prsFromGraphql(graphqlOf([prNode({ commits: { nodes: [] } })])).prs[0]!.checks).toBe('none');
  });

  it('コメントの数は会話のコメントとレビューのスレッドの合計', () => {
    expect(prsFromGraphql(graphqlOf([prNode({ comments: { totalCount: 4, nodes: [] }, reviewThreads: { totalCount: 3 } })])).prs[0]!.comments).toBe(7);
  });

  it('次のページがあれば truncated。viewer が取れなければ null', () => {
    expect(prsFromGraphql(graphqlOf([], { hasNextPage: true })).truncated).toBe(true);
    expect(prsFromGraphql(graphqlOf([], { viewer: null })).viewer).toBeNull();
  });

  it('作者のいない PR（消えたアカウント）は ghost', () => {
    expect(prsFromGraphql(graphqlOf([prNode({ author: null })])).prs[0]!.author).toBe('ghost');
  });

  it('PR の一覧が無い・PR の欄が足りなければエラー', () => {
    expect(() => prsFromGraphql({ viewer: null, repository: null })).toThrow(/PR の一覧/);
    expect(() => prsFromGraphql(graphqlOf([prNode({ headRefOid: null })]))).toThrow(/#7/);
  });
});

describe('repoTargetFromGhJson', () => {
  it('gh repo view の url からホストと owner / name を読む', () => {
    expect(repoTargetFromGhJson('{"url":"https://ghe.example.co.jp/team-a/order-service"}')).toEqual({ host: 'ghe.example.co.jp', owner: 'team-a', name: 'order-service' });
  });

  it('リポジトリの URL の形でなければ、その値を含めてエラー', () => {
    expect(() => repoTargetFromGhJson('{"url":"https://ghe.example.co.jp/team-a"}')).toThrow(/ghe\.example\.co\.jp\/team-a/);
  });
});
