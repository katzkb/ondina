// gh 層。設計書 5.1「`gh pr view --json` でメタ情報」。
// gh の実行は差し替え可能にし、JSON の解釈は純関数にする。
import { execFile, execFileSync } from 'node:child_process';
import { git, type RefPair } from './git.js';

export interface PrRef {
  number: number;
  title: string;
  /** 作者の説明原文（10.1 pr.body）。無ければ空 */
  body: string;
  /** base ブランチ名 */
  base: string;
  /** head ブランチ名 */
  head: string;
  headSha: string;
}

/** gh を実行して stdout を返す。input があれば stdin に流す（`gh api --input -`） */
export type RunGh = (args: string[], cwd: string, input?: string) => string;

const GH_FIELDS = 'number,title,body,baseRefName,headRefName,headRefOid';

/** RunGh の非同期版。serve で押すたびに呼ぶもの（GitHub の Viewed。12.1）は、往復の間ほかのリクエストを待たせないようこちらを使う */
export type RunGhAsync = (args: string[], cwd: string) => Promise<string>;

function ghError(shown: string[], e: unknown): Error {
  const err = e as { code?: string; stderr?: string; message: string };
  if (err.code === 'ENOENT') return new Error('gh が見つかりません。GitHub CLI をインストールしてください');
  return new Error(`gh ${shown.join(' ')} に失敗しました: ${err.stderr?.trim() || err.message}`);
}

/** サブコマンドだけ（最初のオプションの前まで）。GraphQL の文のような長い引数を、画面の通知に出さない */
const subcommand = (args: string[]) => args.slice(0, Math.max(1, args.findIndex((a) => a.startsWith('-'))));

export const runGh: RunGh = (args, cwd, input) => {
  try {
    return execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], ...(input === undefined ? {} : { input }) });
  } catch (e) {
    throw ghError(args, e);
  }
};

export const runGhAsync: RunGhAsync = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (e, stdout, stderr) => (e ? reject(ghError(subcommand(args), Object.assign(e, { stderr }))) : resolve(stdout)));
  });

export function prFromGhJson(json: string): PrRef {
  const v = JSON.parse(json) as Record<string, unknown>;
  const num = v['number'];
  const title = v['title'];
  const base = v['baseRefName'];
  const head = v['headRefName'];
  const headSha = v['headRefOid'];
  const body = v['body'];
  if (typeof num !== 'number' || typeof title !== 'string' || typeof base !== 'string' || typeof head !== 'string' || typeof headSha !== 'string') {
    throw new Error(`gh pr view の出力に必要なフィールドがありません（${GH_FIELDS}）`);
  }
  return { number: num, title, body: typeof body === 'string' ? body : '', base, head, headSha };
}

/**
 * `gh api` の宛先。gh api はホストを今のリポジトリから決めず、gh の既定のホスト（GH_HOST、無ければログイン先が 1 つならそこ、2 つ以上なら github.com）に送る。
 * `{owner}/{repo}` だけはリポジトリから埋まるので、GitHub Enterprise Server の owner/repo を github.com に聞いて「リポジトリが見つからない」になった（2026-10-15）。
 * `gh pr view` はリポジトリのホストに行くので、その URL からホストと owner / name を決めて `--hostname` で渡す
 */
export interface GhTarget {
  host: string;
  owner: string;
  name: string;
}

export const prUrlArgs = (number: number): string[] => ['pr', 'view', String(number), '--json', 'url'];

/** `gh pr view <n> --json url` の出力（`https://<host>/<owner>/<name>/pull/<n>`）を読む */
export function targetFromGhJson(json: string): GhTarget {
  const url = (JSON.parse(json) as Record<string, unknown>)['url'];
  const m = typeof url === 'string' ? /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/\d+\/?$/.exec(url) : null;
  if (!m) throw new Error(`gh pr view の出力から PR の URL を読めません: ${String(url)}`);
  return { host: m[1]!, owner: m[2]!, name: m[3]! };
}

/** GraphQL の応答を読む。errors があればその文で失敗にする */
export function graphqlData(json: string): unknown {
  const v = JSON.parse(json) as { data?: unknown; errors?: Array<{ message?: unknown }> };
  if (Array.isArray(v.errors) && v.errors.length > 0) throw new Error(`GitHub の GraphQL がエラーを返しました: ${v.errors.map((e) => String(e.message)).join(' / ')}`);
  return v.data;
}

/** gh api graphql をリポジトリのホストに送る。失敗の理由に宛先を足す（コピー&ペーストできない環境では貼れないので、画面の通知の文だけで宛先が分かるように） */
export async function graphql(repo: string, target: GhTarget, fields: string[], run: RunGhAsync): Promise<string> {
  try {
    return await run(['api', 'graphql', '--hostname', target.host, ...fields], repo);
  } catch (e) {
    throw new Error(`${e instanceof Error ? e.message : String(e)}（宛先: ${target.host}/${target.owner}/${target.name}）`);
  }
}

/** `gh pr view <n>` で PR のメタ情報を取る */
export function fetchPr(repo: string, number: number, run: RunGh = runGh): PrRef {
  return prFromGhJson(run(['pr', 'view', String(number), '--json', GH_FIELDS], repo));
}

/**
 * origin から PR の head（refs/pull/<n>/head）と base ブランチを fetch し、baseSha = merge-base を求める。
 * TODO: リモート名は origin 固定
 */
export function resolvePrRefs(repo: string, pr: PrRef): RefPair {
  // shallow clone（CI の actions/checkout 既定 fetch-depth: 1）だと分岐点が手元に無く merge-base が失敗するので、先に履歴を全部取る
  if (git(repo, 'rev-parse', '--is-shallow-repository') === 'true') git(repo, 'fetch', '--quiet', '--unshallow', 'origin');
  // 1 ref ずつ fetch して FETCH_HEAD を読む（リモート追跡ブランチの設定に依存しない）
  git(repo, 'fetch', '--quiet', 'origin', `refs/heads/${pr.base}`);
  const baseTip = git(repo, 'rev-parse', '--verify', '--quiet', 'FETCH_HEAD^{commit}');
  git(repo, 'fetch', '--quiet', 'origin', `refs/pull/${pr.number}/head`);
  return { baseSha: git(repo, 'merge-base', baseTip, pr.headSha), headSha: pr.headSha };
}
