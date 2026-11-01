// PR の詳細（設計書 3.11 / 5.5。2026-10-22）。PR 一覧のカードを押すと出す引き出しの中身を、GitHub の GraphQL 1 回で取る。
// 宛先は PR 一覧と同じ（serve が覚えた GhTarget）。時系列は事実をそのまま古い順に出す（作者や bot を一覧のように除かない）。
import type { PrCheck, PrCheckResult, PrDetail, PrLineComment, PrReviewKind, PrTimelineItem } from '@ondina/model';
import { graphql, graphqlData, type GhTarget, type RunGhAsync } from './pr.js';
import { count, nodesOf, obj, str, type Obj } from './pr-list.js';

/**
 * GitHub Enterprise Server でも通る項目だけ。時系列は新しい 100 件（古い順で返る）。filteredCount は itemTypes で絞った後の数
 * （totalCount はラベルの付け外しなども数える）
 */
export const PR_DETAIL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number body
      timelineItems(itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, PULL_REQUEST_COMMIT], last: 100) {
        filteredCount
        nodes {
          __typename
          ... on IssueComment { author { login } createdAt body }
          ... on PullRequestReview { author { login } state submittedAt createdAt body comments(first: 10) { totalCount nodes { path line originalLine body } } }
          ... on PullRequestCommit { commit { committedDate author { name user { login } } } }
        }
      }
      files(first: 100) { totalCount nodes { path additions deletions } }
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { totalCount nodes {
        __typename
        ... on CheckRun { name status conclusion startedAt completedAt }
        ... on StatusContext { context state description }
      } } } } } }
    }
  }
}`;

/** PR の詳細を取る。番号は -F（Int!）、owner / name は -f（文字列のまま） */
export async function fetchPrDetail(repo: string, target: GhTarget, number: number, run: RunGhAsync): Promise<PrDetail> {
  const out = await graphql(repo, target, ['-f', `owner=${target.owner}`, '-f', `name=${target.name}`, '-F', `number=${number}`, '-f', `query=${PR_DETAIL_QUERY}`], run);
  return prDetailFromGraphql(graphqlData(out));
}

export function prDetailFromGraphql(data: unknown): PrDetail {
  const pr = obj(obj(obj(data)?.['repository'])?.['pullRequest']);
  const number = pr?.['number'];
  if (!pr || typeof number !== 'number') throw new Error('GitHub の応答に PR がありません');
  const items = obj(pr['timelineItems']);
  const raw = nodesOf(items);
  const files = obj(pr['files']);
  const contexts = obj(obj(obj(nodesOf(pr['commits'])[0]?.['commit'])?.['statusCheckRollup'])?.['contexts']);
  return {
    number,
    body: str(pr['body']) ?? '',
    timeline: timelineOf(raw),
    olderItems: Math.max(0, count(items?.['filteredCount']) - raw.length),
    files: nodesOf(files).flatMap((f) => (typeof f['path'] === 'string' ? [{ path: f['path'], additions: count(f['additions']), deletions: count(f['deletions']) }] : [])),
    filesTotal: count(files?.['totalCount']),
    checks: nodesOf(contexts).flatMap(checkOf),
    checksTotal: count(contexts?.['totalCount']),
  };
}

// 消えたアカウントは author が null（GitHub の画面では ghost）
const login = (a: unknown): string => str(obj(a)?.['login']) ?? 'ghost';

const REVIEW: Record<string, PrReviewKind> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', COMMENTED: 'commented', DISMISSED: 'dismissed' };

function timelineOf(nodes: Obj[]): PrTimelineItem[] {
  const out: PrTimelineItem[] = [];
  for (const n of nodes) {
    if (n['__typename'] === 'IssueComment') {
      out.push({ kind: 'comment', author: login(n['author']), at: str(n['createdAt']) ?? '', body: str(n['body']) ?? '' });
    } else if (n['__typename'] === 'PullRequestReview') {
      // PENDING は見ている人の書きかけ（送っていない）
      const state = REVIEW[str(n['state']) ?? ''];
      if (state === undefined) continue;
      const lines = obj(n['comments']);
      const comments = nodesOf(lines).flatMap(lineCommentOf);
      out.push({ kind: 'review', author: login(n['author']), at: str(n['submittedAt']) ?? str(n['createdAt']) ?? '', state, body: str(n['body']) ?? '', comments, moreComments: Math.max(0, count(lines?.['totalCount']) - comments.length) });
    } else if (n['__typename'] === 'PullRequestCommit') {
      const c = obj(n['commit']);
      const at = str(c?.['committedDate']) ?? '';
      const last = out.at(-1);
      if (last?.kind === 'commits') {
        out[out.length - 1] = { ...last, at, count: last.count + 1 };
        continue;
      }
      // GitHub のアカウントに結び付かないコミットは git の名前
      const author = obj(c?.['author']);
      out.push({ kind: 'commits', author: str(obj(author?.['user'])?.['login']) ?? str(author?.['name']) ?? 'ghost', at, count: 1 });
    }
  }
  return out;
}

function lineCommentOf(c: Obj): PrLineComment[] {
  const path = str(c['path']);
  if (path === undefined) return [];
  const line = c['line'] ?? c['originalLine'];
  return [{ path, line: typeof line === 'number' ? line : null, body: str(c['body']) ?? '' }];
}

const CONCLUSION: Record<string, PrCheckResult> = {
  SUCCESS: 'pass',
  FAILURE: 'fail',
  TIMED_OUT: 'fail',
  STARTUP_FAILURE: 'fail',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
  NEUTRAL: 'neutral',
  ACTION_REQUIRED: 'action',
  STALE: 'stale',
};
const STATUS: Record<string, PrCheckResult> = { SUCCESS: 'pass', FAILURE: 'fail', ERROR: 'fail', PENDING: 'pending', EXPECTED: 'pending' };

function checkOf(c: Obj): PrCheck[] {
  if (c['__typename'] === 'CheckRun') {
    const name = str(c['name']);
    if (name === undefined) return [];
    const done = c['status'] === 'COMPLETED';
    const result = (done ? CONCLUSION[str(c['conclusion']) ?? ''] : undefined) ?? 'pending';
    const ms = Date.parse(str(c['completedAt']) ?? '') - Date.parse(str(c['startedAt']) ?? '');
    // スキップは走っていない（終わりが始まりより前のこともある）ので、かかった時間を出さない
    return [{ name, result, ...(done && result !== 'skipped' && ms >= 0 ? { seconds: Math.round(ms / 1000) } : {}) }];
  }
  if (c['__typename'] === 'StatusContext') {
    const name = str(c['context']);
    if (name === undefined) return [];
    const description = str(c['description']);
    return [{ name, result: STATUS[str(c['state']) ?? ''] ?? 'pending', ...(description ? { description } : {}) }];
  }
  return [];
}
