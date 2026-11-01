// GitHub の Viewed（PR のファイルごとの閲覧の印）を GraphQL で読み書きする（設計書 12.1）。
// GitHub の閲覧の印はファイル単位だけ。ondina はファイルの差分が全部問題なしになったら付け、全部でなくなったら外す（どちらも web が決める）。
// gh api はホストをリポジトリから決めないので、先に gh pr view で PR のホストと owner / name を取って渡す（pr.ts の GhTarget。コメントの送信と同じ）。
// GraphQL の文と出力の解釈は純関数にする。
import { graphql, graphqlData, prUrlArgs, targetFromGhJson, type GhTarget, type RunGhAsync } from './pr.js';

export interface GithubViewed {
  /** PR の node id（markFileAsViewed の pullRequestId） */
  prId: string;
  /** GitHub の PR の今の head */
  headSha: string;
  /** viewerViewedState が VIEWED のファイル。DISMISSED（見た後に変更あり。GitHub の画面でもチェックが外れる）は入れない */
  viewed: string[];
}

export interface ViewedChange {
  mark: string[];
  unmark: string[];
}

/** GitHub の PR の head が解析と違う。解析の後に足されたコミットを ondina で見ていないので、Viewed は変えない */
export class HeadMismatchError extends Error {
  constructor(
    readonly analysisHead: string,
    readonly prHead: string,
  ) {
    super('PR に解析より新しいコミットがあるため、GitHub の Viewed は変更しませんでした。analyze を実行し直してください');
  }
}

const VIEWED_QUERY =
  'query($owner: String!, $name: String!, $number: Int!, $after: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { ' +
  'id headRefOid files(first: 100, after: $after) { nodes { path viewerViewedState } pageInfo { hasNextPage endCursor } } } } }';

export interface ViewedPage extends GithubViewed {
  /** 次のページのカーソル。最後なら null */
  next: string | null;
}

export function parseViewedPage(json: string): ViewedPage {
  const data = graphqlData(json) as { repository?: { pullRequest?: Record<string, unknown> | null } | null } | undefined;
  const pr = data?.repository?.pullRequest;
  const files = pr?.['files'] as { nodes?: Array<{ path?: unknown; viewerViewedState?: unknown }>; pageInfo?: { hasNextPage?: unknown; endCursor?: unknown } } | undefined;
  if (!pr || typeof pr['id'] !== 'string' || typeof pr['headRefOid'] !== 'string' || !Array.isArray(files?.nodes)) throw new Error('GitHub の応答に PR のファイルがありません');
  const viewed = files.nodes.filter((n) => n.viewerViewedState === 'VIEWED' && typeof n.path === 'string').map((n) => n.path as string);
  const next = files.pageInfo?.hasNextPage === true && typeof files.pageInfo.endCursor === 'string' ? files.pageInfo.endCursor : null;
  return { prId: pr['id'], headSha: pr['headRefOid'], viewed, next };
}

/** 付ける・外すを別名（m0, m1, …, u0, …）で 1 つの mutation に並べる。パスは JSON の文字列（GraphQL の文字列と同じエスケープ） */
export function viewedMutation(change: ViewedChange): string {
  const one = (name: string, field: string, p: string) => `${name}: ${field}(input: {pullRequestId: $id, path: ${JSON.stringify(p)}}) { clientMutationId }`;
  const parts = [...change.mark.map((p, i) => one(`m${i}`, 'markFileAsViewed', p)), ...change.unmark.map((p, i) => one(`u${i}`, 'unmarkFileAsViewed', p))];
  return `mutation($id: ID!) { ${parts.join(' ')} }`;
}

const targetOf = async (repo: string, number: number, run: RunGhAsync): Promise<GhTarget> => targetFromGhJson(await run(prUrlArgs(number), repo));

async function readPage(repo: string, target: GhTarget, number: number, after: string | null, run: RunGhAsync): Promise<ViewedPage> {
  const fields = ['-F', `owner=${target.owner}`, '-F', `name=${target.name}`, '-F', `number=${number}`, '-f', `query=${VIEWED_QUERY}`, ...(after === null ? [] : ['-f', `after=${after}`])];
  return parseViewedPage(await graphql(repo, target, fields, run));
}

/** PR のファイルの Viewed を全ページ読む */
export async function readViewed(repo: string, number: number, run: RunGhAsync): Promise<GithubViewed> {
  const target = await targetOf(repo, number, run);
  let page = await readPage(repo, target, number, null, run);
  const viewed = [...page.viewed];
  while (page.next !== null) {
    page = await readPage(repo, target, number, page.next, run);
    viewed.push(...page.viewed);
  }
  return { prId: page.prId, headSha: page.headSha, viewed };
}

/** PR の head が解析（headSha）と同じときだけ、付ける・外すを 1 回の GraphQL で送る */
export async function setViewed(repo: string, number: number, headSha: string, change: ViewedChange, run: RunGhAsync): Promise<void> {
  if (change.mark.length === 0 && change.unmark.length === 0) return;
  const target = await targetOf(repo, number, run);
  const pr = await readPage(repo, target, number, null, run);
  if (pr.headSha !== headSha) throw new HeadMismatchError(headSha, pr.headSha);
  graphqlData(await graphql(repo, target, ['-f', `id=${pr.prId}`, '-f', `query=${viewedMutation(change)}`], run));
}
