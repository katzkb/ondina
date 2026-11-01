// GitHub の GraphQL（PR 一覧の問い合わせ）の答えを組む。pr-list.test.ts と serve.prs.test.ts が使う
type GqlNode = Record<string, unknown>;

/** GraphQL の pullRequests の 1 件。o で上書きする */
export function prNode(o: GqlNode = {}): GqlNode {
  return {
    number: 7,
    title: '割引を足す',
    url: 'https://ghe.example.co.jp/team-a/order-service/pull/7',
    isDraft: false,
    updatedAt: '2026-10-22T01:00:00Z',
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    headRefName: 'feature/discount',
    baseRefName: 'main',
    headRefOid: 'a'.repeat(40),
    author: { login: 'yamada' },
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    reviews: { nodes: [] },
    comments: { totalCount: 0, nodes: [] },
    reviewThreads: { totalCount: 0 },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    ...o,
  };
}

export const graphqlOf = (nodes: GqlNode[], o: { viewer?: string | null; hasNextPage?: boolean } = {}) => ({
  viewer: o.viewer === null ? null : { login: o.viewer ?? 'katzkb' },
  repository: { pullRequests: { pageInfo: { hasNextPage: o.hasNextPage ?? false }, nodes } },
});

/** GraphQL の pullRequest（PR の詳細の問い合わせ）。o で上書きする。時系列・ファイル・チェックは空 */
export function detailNode(o: GqlNode = {}): GqlNode {
  return {
    number: 7,
    body: '割引を足します。',
    timelineItems: { filteredCount: 0, nodes: [] },
    files: { totalCount: 0, nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    ...o,
  };
}

export const detailOf = (node: GqlNode | null) => ({ repository: { pullRequest: node } });

export const issueComment = (login: string, createdAt: string, body: string) => ({ __typename: 'IssueComment', author: { login }, createdAt, body });
export const prCommit = (login: string | null, committedDate: string, name = 'Some One') => ({ __typename: 'PullRequestCommit', commit: { committedDate, author: { name, user: login === null ? null : { login } } } });
export const prReview = (login: string, state: string, submittedAt: string, body = '', comments: GqlNode[] = [], totalCount = comments.length) => ({
  __typename: 'PullRequestReview',
  author: { login },
  state,
  submittedAt,
  createdAt: submittedAt,
  body,
  comments: { totalCount, nodes: comments },
});
