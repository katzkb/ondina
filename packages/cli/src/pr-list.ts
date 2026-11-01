// PR 一覧（設計書 3.11 / 5.5。2026-10-22）。開いている PR を GitHub の GraphQL 1 回で取り、人ごとのレビューの状況にする。
// gh pr list --json は本文やコメントまで全部取って 100 件で重く、ログインしている人も取れないので使わない。
// gh api はホストをリポジトリから決めないので、gh repo view の URL からホストと owner / name を決めて --hostname で渡す（pr.ts の GhTarget）。
// 列分け（誰も見ていない / コメントあり / 承認あり）は画面の都合なので web が決める。ここは人ごとの事実だけ。
import type { OpenPr, PrChecks, PrList, PrReviewer } from '@ondina/model';
import { graphql, graphqlData, type GhTarget, type RunGhAsync } from './pr.js';

export const repoUrlArgs = ['repo', 'view', '--json', 'url'];

/** `gh repo view --json url` の出力（`https://<host>/<owner>/<name>`）を読む */
export function repoTargetFromGhJson(json: string): GhTarget {
  const url = (JSON.parse(json) as Record<string, unknown>)['url'];
  const m = typeof url === 'string' ? /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/.exec(url) : null;
  if (!m) throw new Error(`gh repo view の出力からリポジトリの URL を読めません: ${String(url)}`);
  return { host: m[1]!, owner: m[2]!, name: m[3]! };
}

/** GitHub Enterprise Server でも通る項目だけ。更新の新しい 100 件 */
export const PR_LIST_QUERY = `query($owner: String!, $name: String!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage }
      nodes {
        number title url isDraft updatedAt additions deletions changedFiles
        headRefName baseRefName headRefOid
        author { login }
        labels(first: 20) { nodes { name color } }
        reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Mannequin { login } } } }
        reviews(first: 100) { nodes { author { login __typename } state } }
        comments(last: 50) { totalCount nodes { author { login __typename } } }
        reviewThreads { totalCount }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
}`;

/** 開いている PR の一覧を取る。owner / name は -f（文字列のまま。-F は数字だけの名前を数に変える） */
export async function fetchPrList(repo: string, target: GhTarget, run: RunGhAsync, now: number): Promise<PrList> {
  const out = await graphql(repo, target, ['-f', `owner=${target.owner}`, '-f', `name=${target.name}`, '-f', `query=${PR_LIST_QUERY}`], run);
  return { fetchedAt: now, ...prsFromGraphql(graphqlData(out)) };
}

/** GraphQL の答えを読む小さな道具（PR の詳細の pr-detail.ts も使う） */
export type Obj = Record<string, unknown>;
export const obj = (v: unknown): Obj | undefined => (typeof v === 'object' && v !== null ? (v as Obj) : undefined);
export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
export const count = (v: unknown): number => (typeof v === 'number' ? v : 0);
export const nodesOf = (v: unknown): Obj[] => {
  const nodes = obj(v)?.['nodes'];
  return Array.isArray(nodes) ? nodes.map(obj).filter((n): n is Obj => n !== undefined) : [];
};

const CHECKS: Record<string, PrChecks> = { SUCCESS: 'pass', FAILURE: 'fail', ERROR: 'fail', PENDING: 'pending', EXPECTED: 'pending' };

export function prsFromGraphql(data: unknown): Omit<PrList, 'fetchedAt'> {
  const d = obj(data);
  const prs = obj(obj(d?.['repository'])?.['pullRequests']);
  if (!prs) throw new Error('GitHub の応答に PR の一覧がありません');
  return { viewer: str(obj(d?.['viewer'])?.['login']) ?? null, prs: nodesOf(prs).map(openPr), truncated: obj(prs['pageInfo'])?.['hasNextPage'] === true };
}

function openPr(n: Obj): OpenPr {
  const { number, title, url, headRefName, baseRefName, headRefOid } = n;
  if (typeof number !== 'number' || typeof title !== 'string' || typeof url !== 'string' || typeof headRefName !== 'string' || typeof baseRefName !== 'string' || typeof headRefOid !== 'string') {
    throw new Error(`GitHub の応答の PR #${String(number)} に必要な欄がありません`);
  }
  // 消えたアカウントの PR は author が null（GitHub の画面では ghost）
  const author = str(obj(n['author'])?.['login']) ?? 'ghost';
  const rollup = str(obj(obj(nodesOf(n['commits'])[0]?.['commit'])?.['statusCheckRollup'])?.['state']);
  return {
    number,
    title,
    url,
    author,
    draft: n['isDraft'] === true,
    head: headRefName,
    base: baseRefName,
    headSha: headRefOid,
    labels: nodesOf(n['labels']).flatMap((l) => (typeof l['name'] === 'string' ? [{ name: l['name'], color: str(l['color']) ?? '' }] : [])),
    reviewers: reviewersOf(n, author),
    additions: count(n['additions']),
    deletions: count(n['deletions']),
    changedFiles: count(n['changedFiles']),
    comments: count(obj(n['comments'])?.['totalCount']) + count(obj(n['reviewThreads'])?.['totalCount']),
    updatedAt: str(n['updatedAt']) ?? '',
    checks: (rollup === undefined ? undefined : CHECKS[rollup]) ?? 'none',
  };
}

const isBot = (a: Obj): boolean => a['__typename'] === 'Bot' || (str(a['login']) ?? '').endsWith('[bot]');

/**
 * 人ごとの最後の意見。レビューは古い順に見る: 承認・修正の依頼は上書き、取り下げ（DISMISSED）は意見を消す、下書き（PENDING）は見ない。
 * 意見が無くてもレビューか会話のコメントがあれば commented。依頼中でまだいない人は requested。作者と bot は入れない
 */
function reviewersOf(n: Obj, author: string): PrReviewer[] {
  const opinion = new Map<string, 'approved' | 'changes' | null>();
  const person = (a: unknown): string | undefined => {
    const o = obj(a);
    const login = str(o?.['login']);
    return o === undefined || login === undefined || login === author || isBot(o) ? undefined : login;
  };
  for (const r of nodesOf(n['reviews'])) {
    const login = person(r['author']);
    if (login === undefined || r['state'] === 'PENDING') continue;
    const was = opinion.get(login) ?? null;
    opinion.set(login, r['state'] === 'APPROVED' ? 'approved' : r['state'] === 'CHANGES_REQUESTED' ? 'changes' : r['state'] === 'DISMISSED' ? null : was);
  }
  for (const c of nodesOf(n['comments'])) {
    const login = person(c['author']);
    if (login !== undefined && !opinion.has(login)) opinion.set(login, null);
  }
  const out: PrReviewer[] = [...opinion].map(([login, o]) => ({ login, state: o ?? 'commented' }));
  for (const q of nodesOf(n['reviewRequests'])) {
    const r = obj(q['requestedReviewer']);
    if (r === undefined) continue;
    if (r['__typename'] === 'Team') {
      const name = str(r['name']);
      if (name !== undefined) out.push({ login: name, state: 'requested', team: true });
      continue;
    }
    const login = str(r['login']);
    if (login !== undefined && !opinion.has(login)) out.push({ login, state: 'requested' });
  }
  return out;
}
