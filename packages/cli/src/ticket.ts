// --ticket で指定したチケットを取る（設計書 5.1。2026-10-12）。取れなくても例外にせず、理由を error に入れて返す（解析は止めない）。
// 順番: 値がファイルとして在ればそれ → 設定がコマンドならコマンド → Jira（既定）。
// Jira は Cloud と Server / Data Center の両方にある REST API v2 で引く。Jira 以外のトラッカーはコマンドで足す。
// Jira のトークンは環境変数 ONDINA_TICKET_TOKEN、無ければ Mac のキーチェーン（サービス名 ondina-jira）から読む（2026-10-12）。
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Ticket, TicketSettings } from '@ondina/model';
import { KEYCHAIN_SERVICE, type KeychainRead, readKeychain } from './keychain.js';
import { runLlmCommand } from './llm.js';

export const TICKET_TOKEN_ENV = 'ONDINA_TICKET_TOKEN';
const JIRA_TIMEOUT_MS = 30 * 1000;
const COMMAND_TIMEOUT_MS = 60 * 1000;
const KEY = /^[A-Z][A-Z0-9_]*-\d+$/i;

export interface TicketDeps {
  /** ファイルの値を解決する場所（analyze を打ったディレクトリ） */
  cwd: string;
  /** トークンを読み、コマンドに渡す環境変数 */
  env: NodeJS.ProcessEnv;
  /** 環境変数にトークンが無いときに読むキーチェーン。既定は readKeychain */
  keychain?: (service: string) => Promise<KeychainRead | undefined>;
  now?: () => Date;
  jiraTimeoutMs?: number;
  commandTimeoutMs?: number;
}

/** Jira の場所と番号。番号（SHOP-421）は設定の場所で、URL はその中から読む */
export function parseJiraRef(ref: string, jiraUrl: string | undefined): { base: string; key: string } | { error: string } {
  const setting = jiraUrl?.trim().replace(/\/+$/, '') || undefined;
  if (KEY.test(ref)) {
    if (setting === undefined) return { error: 'Jira の URL が設定にありません。設定画面の「チケット」で設定するか、URL で指定してください' };
    return { base: setting, key: ref.toUpperCase() };
  }
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return { error: `チケットの番号か URL の形式ではありません: ${ref}` };
  }
  const browse = /^(.*)\/browse\/([^/]+)/.exec(url.pathname);
  const selected = url.searchParams.get('selectedIssue');
  const issues = /\/issues\/([^/]+)\/?$/.exec(url.pathname);
  const key = browse?.[2] ?? selected ?? issues?.[1];
  if (key === undefined || !KEY.test(key)) return { error: `URL からチケットの番号を読めません: ${ref}` };
  const prefix = browse?.[1] ?? /^(.*)\/secure\//.exec(url.pathname)?.[1] ?? '';
  const base = setting !== undefined && ref.startsWith(setting) ? setting : url.origin + prefix;
  return { base, key: key.toUpperCase() };
}

export async function fetchTicket(ref: string, settings: TicketSettings | undefined, deps: TicketDeps): Promise<Ticket> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  const file = path.resolve(deps.cwd, ref);
  if (isFile(file)) return { ref, source: 'file', at, body: readFileSync(file, 'utf8'), format: 'markdown' };
  if (settings?.source === 'command') return { ref, source: 'command', at, ...(await fromCommand(ref, settings.command, deps)) };
  return { ref, source: 'jira', at, ...(await fromJira(ref, settings, deps)) };
}

type Fetched = Omit<Ticket, 'ref' | 'source' | 'at'>;

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

async function fromJira(ref: string, settings: TicketSettings | undefined, deps: TicketDeps): Promise<Fetched> {
  const parsed = parseJiraRef(ref, settings?.jiraUrl);
  if ('error' in parsed) return { error: parsed.error };
  const { base, key } = parsed;
  const where = { key, url: `${base}/browse/${key}` };
  const got = await jiraGet(await jiraAccess(base, settings, deps), `/rest/api/2/issue/${key}?fields=summary,description,issuetype,status&expand=renderedFields`);
  if ('error' in got) return { ...where, error: got.status === 404 ? `Jira に ${key} がありません。番号か、見る権限を確かめてください` : got.error };
  const json = got.json as JiraIssue;
  const realKey = typeof json.key === 'string' ? json.key : key;
  return { key: realKey, url: `${base}/browse/${realKey}`, ...issueFields(json) };
}

/** Jira の issue の題・種類・状態・本文（Jira が直した HTML、無ければ改行を保った文字）。親チケット（project.ts）も同じ形で読む */
export function issueFields(json: JiraIssue): Pick<Ticket, 'title' | 'kind' | 'status' | 'body' | 'format'> {
  const f = json.fields ?? {};
  const html = json.renderedFields?.description;
  const body = typeof html === 'string' && html !== '' ? { body: html, format: 'html' as const } : typeof f.description === 'string' ? { body: f.description, format: 'text' as const } : {};
  return { ...str('title', f.summary), ...str('kind', f.issuetype?.name), ...str('status', f.status?.name), ...body };
}

/** Jira に頼む場所と頭。missing = トークンが無いときに 401 / 403 の理由に添える文 */
export interface JiraAccess {
  base: string;
  headers: Record<string, string>;
  missing: string;
  timeoutMs: number;
}

export async function jiraAccess(base: string, settings: TicketSettings | undefined, deps: TicketDeps): Promise<JiraAccess> {
  const { token, missing } = await jiraToken(deps);
  const email = settings?.email?.trim() || undefined;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token !== undefined) headers['authorization'] = email === undefined ? `Bearer ${token}` : `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  return { base, headers, missing, timeoutMs: deps.jiraTimeoutMs ?? JIRA_TIMEOUT_MS };
}

/** GET <base><path> の JSON。取れなければ画面にそのまま出す理由と、返した番号（届かなければ無い） */
export async function jiraGet(access: JiraAccess, pathQuery: string): Promise<{ json: unknown } | { status?: number; error: string }> {
  let res: Response;
  try {
    res = await fetch(`${access.base}${pathQuery}`, { headers: access.headers, signal: AbortSignal.timeout(access.timeoutMs) });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') return { error: `Jira から ${access.timeoutMs / 1000} 秒以内に応答がありませんでした` };
    return { error: `Jira に接続できませんでした: ${reasonOf(e)}` };
  }
  if (res.status === 401 || res.status === 403) return { status: res.status, error: `Jira が ${res.status} を返しました。トークンがないか、期限が切れています${access.missing}` };
  if (!res.ok) return { status: res.status, error: `Jira が ${res.status} を返しました` };
  try {
    return { json: await res.json() };
  } catch {
    return { status: res.status, error: 'Jira の答えが JSON ではありません。ログイン画面に回された可能性があります' };
  }
}

/** Jira のトークン。環境変数が先、無ければキーチェーン。missing = 無いときに 401 / 403 の理由に添える文 */
async function jiraToken(deps: TicketDeps): Promise<{ token?: string; missing: string }> {
  const env = deps.env[TICKET_TOKEN_ENV] || undefined;
  if (env !== undefined) return { token: env, missing: '' };
  const read = await (deps.keychain ?? readKeychain)(KEYCHAIN_SERVICE);
  if (read === undefined) return { missing: `（環境変数 ${TICKET_TOKEN_ENV} がありません）` };
  if ('token' in read) return { token: read.token, missing: '' };
  if ('error' in read) return { missing: `（環境変数 ${TICKET_TOKEN_ENV} がなく、キーチェーンの ${KEYCHAIN_SERVICE} を読めませんでした: ${read.error}）` };
  return { missing: `（環境変数 ${TICKET_TOKEN_ENV} も、キーチェーンの ${KEYCHAIN_SERVICE} もありません）` };
}

export interface JiraIssue {
  key?: unknown;
  fields?: { summary?: unknown; description?: unknown; issuetype?: { name?: unknown }; status?: { name?: unknown } };
  renderedFields?: { description?: unknown };
}

function str<K extends string>(k: K, v: unknown): Partial<Record<K, string>> {
  return typeof v === 'string' && v !== '' ? ({ [k]: v } as Record<K, string>) : {};
}

function reasonOf(e: unknown): string {
  const cause = e instanceof Error ? (e.cause as { message?: unknown } | undefined) : undefined;
  if (typeof cause?.message === 'string') return cause.message;
  return e instanceof Error ? e.message : String(e);
}

async function fromCommand(ref: string, command: string | undefined, deps: TicketDeps): Promise<Fetched> {
  if (command === undefined || command.trim() === '') return { error: 'チケットを取得するコマンドが設定にありません。設定画面の「チケット」で設定してください' };
  const timeoutMs = deps.commandTimeoutMs ?? COMMAND_TIMEOUT_MS;
  const r = await runLlmCommand(command, '', deps.cwd, timeoutMs, undefined, { ...deps.env, ONDINA_TICKET: ref });
  if (r.timedOut) return { error: `チケットを取得するコマンドが ${timeoutMs / 1000} 秒以内に終わりませんでした` };
  if (r.exitCode !== 0) {
    const last = r.stderr.trim().split('\n').at(-1) ?? '';
    return { error: `チケットを取得するコマンドが失敗しました（終了コード ${r.exitCode ?? '不明'}）${last === '' ? '' : `: ${last}`}` };
  }
  if (r.stdout.trim() === '') return { error: 'チケットを取得するコマンドが何も出力しませんでした' };
  const json = parseJson(r.stdout);
  if (json === undefined) return { body: r.stdout, format: 'markdown' };
  const body = str('body', json['body']);
  return { ...str('key', json['key']), ...str('url', json['url']), ...str('title', json['title']), ...str('kind', json['kind']), ...str('status', json['status']), ...(body.body === undefined ? {} : { ...body, format: 'markdown' as const }) };
}

const COMMAND_FIELDS = ['key', 'url', 'title', 'kind', 'status', 'body'] as const;

/** コマンドの出力が、知っている欄（COMMAND_FIELDS）を 1 つでも文字で持つ JSON ならその中身。そうでなければ undefined（全体を本文として読む。黙って消さない） */
function parseJson(s: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(s);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
    const o = v as Record<string, unknown>;
    if (COMMAND_FIELDS.some((k) => typeof o[k] === 'string' && o[k] !== '')) return o;
  } catch {
    // JSON でない
  }
  return undefined;
}
