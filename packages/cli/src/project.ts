// どんな案件の一部か（設計書 3.1 / 5.1。2026-10-29）。チケットを Jira から取れたときだけ調べる。
// 親チケット: Jira の親の欄（parent。Jira Cloud はエピックも、Jira Server / Data Center は sub-task の親）。無ければエピックの欄（Epic Link。
//   欄の id は Jira ごとに違い、名前も言語で変わるので、/rest/api/2/field の schema.custom で探す）。
// 同じ親の下のチケット: JQL（parent = X、エピックなら cf[id] = X）。古い /rest/api/2/search が無い Jira Cloud（404 / 410）は /rest/api/2/search/jql。
// 同じ案件の PR: 親と子の番号を、この PR の GitHub（github.com か GitHub Enterprise Server）で題・本文から探す。GraphQL の search を番号ごとの別名にして 1 回で頼む。
//   検索は語を緩く当てるので、題・本文・ブランチ名に番号が前後の英数字なしで出る物だけ残す（SHOP-4210 を SHOP-421 にしない）。
// 全部プログラムの事実で、LLM を通さない（原則 3）。親の本文から目的の文を写すのは要求の抜き出し（10.8）で、analyze が why に入れる。
// 取れなくても解析は止めず、理由を errors に残す（画面にそのまま出す。コピー&ペーストできない環境では、診断のコマンドの結果を貼れない）。
import type { ParentTicket, Project, ProjectPr, Ticket, TicketSettings } from '@ondina/model';
import { graphql, graphqlData, prUrlArgs, targetFromGhJson, type GhTarget, type RunGhAsync } from './pr.js';
import { nodesOf, obj, repoTargetFromGhJson, repoUrlArgs, str } from './pr-list.js';
import { issueFields, jiraAccess, jiraGet, type JiraAccess, type JiraIssue, type TicketDeps } from './ticket.js';

/** 探す番号の上限（GitHub の検索を 1 回の頼みにまとめる数） */
export const MAX_PROJECT_KEYS = 30;
/** 番号 1 つで取る PR の数 */
const PRS_PER_KEY = 30;
const EPIC_LINK = 'com.pyxis.greenhopper.jira:gh-epic-link';

export interface ProjectContext {
  /** gh を打つ場所 */
  repo: string;
  /** この PR。number = 0 はローカルの解析（ブランチ名で見分ける） */
  pr: { number: number; head: string };
  settings: TicketSettings | undefined;
  deps: TicketDeps;
  run: RunGhAsync;
}

/** 親が無い・Jira で取れたチケットでないときは undefined。why は入れない（要求の抜き出しの後に analyze が入れる） */
export async function fetchProject(ticket: Ticket, ctx: ProjectContext): Promise<Project | undefined> {
  if (ticket.source !== 'jira' || ticket.error !== undefined || ticket.key === undefined || ticket.url === undefined) return undefined;
  const base = ticket.url.replace(/\/browse\/[^/]+$/, '');
  const access = await jiraAccess(base, ctx.settings, ctx.deps);
  const found = await parentOf(access, ticket.key);
  if (found === undefined) return undefined;
  if ('error' in found) return { errors: [`親チケットを調べられませんでした: ${found.error}`] };
  const errors: string[] = [];
  const parent: ParentTicket = { key: found.key, url: `${base}/browse/${found.key}`, via: found.via };
  const [content, kids] = await Promise.all([
    jiraGet(access, `/rest/api/2/issue/${found.key}?fields=summary,description,issuetype,status&expand=renderedFields`),
    childrenOf(access, found.via === 'parent' ? `parent = ${found.key}` : `cf[${found.field.replace(/^customfield_/, '')}] = ${found.key}`),
  ]);
  if ('error' in content) errors.push(`親チケット ${found.key} を取得できませんでした: ${content.error}`);
  else Object.assign(parent, issueFields(content.json as JiraIssue));
  if ('error' in kids) errors.push(`同じ親の下のチケットを探せませんでした: ${kids.error}`);
  const children = 'keys' in kids ? kids.keys : undefined;
  const all = unique([found.key, ticket.key, ...(children ?? [])]);
  const searched = all.slice(0, MAX_PROJECT_KEYS);
  const hits = await searchPrs(searched, ctx).catch((e: unknown) => {
    errors.push(`同じ案件の PR を探せませんでした: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  });
  return {
    parent,
    ...(children === undefined ? {} : { children }),
    searched,
    ...(all.length > searched.length ? { skipped: all.length - searched.length } : {}),
    ...(hits === undefined ? {} : hits),
    ...(errors.length === 0 ? {} : { errors }),
  };
}

type Found = { key: string; via: 'parent'; field?: undefined } | { key: string; via: 'epic'; field: string };

/** 親の欄、無ければエピックの欄。どちらも無ければ undefined */
async function parentOf(access: JiraAccess, key: string): Promise<Found | { error: string } | undefined> {
  const issue = await jiraGet(access, `/rest/api/2/issue/${key}?fields=parent`);
  if ('error' in issue) return issue;
  const parent = str(obj(obj(obj(issue.json)?.['fields'])?.['parent'])?.['key']);
  if (parent !== undefined) return { key: parent, via: 'parent' };
  const fields = await jiraGet(access, '/rest/api/2/field');
  if ('error' in fields) return fields;
  const field = (Array.isArray(fields.json) ? fields.json : []).map(obj).find((f) => obj(f?.['schema'])?.['custom'] === EPIC_LINK)?.['id'];
  if (typeof field !== 'string') return undefined;
  const epic = await jiraGet(access, `/rest/api/2/issue/${key}?fields=${field}`);
  if ('error' in epic) return epic;
  const value = str(obj(obj(epic.json)?.['fields'])?.[field]);
  return value === undefined || value === '' ? undefined : { key: value, via: 'epic', field };
}

/** 同じ親の下のチケットの番号（番号順） */
async function childrenOf(access: JiraAccess, jql: string): Promise<{ keys: string[] } | { error: string }> {
  const query = `?jql=${encodeURIComponent(`${jql} ORDER BY key ASC`)}&fields=summary&maxResults=100`;
  let got = await jiraGet(access, `/rest/api/2/search${query}`);
  if ('error' in got && (got.status === 404 || got.status === 410)) got = await jiraGet(access, `/rest/api/2/search/jql${query}`);
  if ('error' in got) return got;
  const issues = obj(got.json)?.['issues'];
  const keys = (Array.isArray(issues) ? issues : []).flatMap((i) => str(obj(i)?.['key']) ?? []);
  return { keys: unique(keys).sort(byKey) };
}

/** SHOP-9 < SHOP-10（番号は数で比べる） */
function byKey(a: string, b: string): number {
  const [pa = '', na = '0'] = a.split(/-(?=\d+$)/);
  const [pb = '', nb = '0'] = b.split(/-(?=\d+$)/);
  return pa === pb ? Number(na) - Number(nb) : pa < pb ? -1 : 1;
}

const unique = (xs: readonly string[]): string[] => [...new Set(xs)];

/** この PR の GitHub。PR の解析は PR の URL、ローカルの解析はリポジトリの URL から */
async function targetOf(ctx: ProjectContext): Promise<GhTarget> {
  if (ctx.pr.number > 0) return targetFromGhJson(await ctx.run(prUrlArgs(ctx.pr.number), ctx.repo));
  return repoTargetFromGhJson(await ctx.run(repoUrlArgs, ctx.repo));
}

/** GitHub Enterprise Server でも通る項目だけ */
export function projectPrQuery(count: number): string {
  const vars = Array.from({ length: count }, (_, i) => `$q${i}: String!`).join(', ');
  const fields = 'issueCount nodes { ... on PullRequest { number title url state isDraft headRefName body repository { nameWithOwner } } }';
  const searches = Array.from({ length: count }, (_, i) => `  k${i}: search(query: $q${i}, type: ISSUE, first: ${PRS_PER_KEY}) { ${fields} }`).join('\n');
  return `query(${vars}) {\n${searches}\n}`;
}

async function searchPrs(keys: readonly string[], ctx: ProjectContext): Promise<{ repo: string; prs: ProjectPr[] }> {
  const target = await targetOf(ctx);
  const fields = keys.flatMap((k, i) => ['-f', `q${i}="${k}" is:pr in:title,body`]);
  const data = obj(graphqlData(await graphql(ctx.repo, target, [...fields, '-f', `query=${projectPrQuery(keys.length)}`], ctx.run)));
  const here = `${target.owner}/${target.name}`;
  const byUrl = new Map<string, ProjectPr>();
  keys.forEach((key, i) => {
    // 番号は Jira の答えそのままなので、記号は文字どおりに比べる
    const has = new RegExp(`(?<![A-Za-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9])`, 'i');
    for (const n of nodesOf(data?.[`k${i}`])) {
      const repo = str(obj(n['repository'])?.['nameWithOwner']);
      const url = str(n['url']);
      const title = str(n['title']) ?? '';
      const head = str(n['headRefName']) ?? '';
      if (repo === undefined || url === undefined || typeof n['number'] !== 'number') continue;
      if (![title, str(n['body']) ?? '', head].some((t) => has.test(t))) continue;
      const known = byUrl.get(url);
      if (known !== undefined) {
        if (!known.keys.includes(key)) known.keys.push(key);
        continue;
      }
      const self = repo === here && (n['number'] === ctx.pr.number || head === ctx.pr.head);
      byUrl.set(url, { repo, number: n['number'], title, url, state: stateOf(n), keys: [key], ...(self ? { self: true as const } : {}) });
    }
  });
  const prs = [...byUrl.values()].sort((a, b) => (a.repo === b.repo ? a.number - b.number : a.repo === here ? -1 : b.repo === here ? 1 : a.repo < b.repo ? -1 : 1));
  return { repo: here, prs };
}

function stateOf(n: Record<string, unknown>): ProjectPr['state'] {
  if (n['state'] === 'MERGED') return 'merged';
  if (n['state'] === 'CLOSED') return 'closed';
  return n['isDraft'] === true ? 'draft' : 'open';
}
