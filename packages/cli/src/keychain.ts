// Mac のキーチェーンに Jira のトークンを置く（2026-10-12）。読むのは ticket.ts（環境変数が無いとき）、入れるのは `ondina token`。
// どちらも /usr/bin/security を呼ぶ。入れるときはトークンを引数に載せず（ps に見える）、`security -i` の標準入力で渡す。
import { execFile } from 'node:child_process';

export const KEYCHAIN_SERVICE = 'ondina-jira';
/** ロックされたキーチェーンは解除の画面を出して待つので、Jira より長く待つ */
const KEYCHAIN_TIMEOUT_MS = 60 * 1000;
const SECURITY = '/usr/bin/security';

/** キーチェーンを読んだ結果。token = 見つけた、none = 無い、error = 読めなかった（拒否・ロックなど） */
export type KeychainRead = { token: string } | { none: true } | { error: string };

export interface SecurityRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** security を呼ぶ関数。input があれば標準入力に流す */
export type RunSecurity = (args: string[], timeoutMs: number, input?: string) => Promise<SecurityRun>;

interface KeychainOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  run?: RunSecurity;
}

/** サービス名でパスワードを読む（`security find-generic-password -s <サービス> -w`）。Mac でなければ読まずに undefined */
export async function readKeychain(service: string, opts: KeychainOptions = {}): Promise<KeychainRead | undefined> {
  if ((opts.platform ?? process.platform) !== 'darwin') return undefined;
  const timeoutMs = opts.timeoutMs ?? KEYCHAIN_TIMEOUT_MS;
  const r = await (opts.run ?? runSecurity)(['find-generic-password', '-s', service, '-w'], timeoutMs);
  if (r.timedOut) return { error: timedOut(timeoutMs) };
  // 44 = 見つからない（errSecItemNotFound）
  if (r.code === 44) return { none: true };
  if (r.code !== 0) return { error: failure(r) };
  const token = r.stdout.replace(/\r?\n$/, '');
  return token === '' ? { none: true } : { token };
}

/** 引用符なしで `security -i` に渡せる文字（空白・引用符・\ 以外の ASCII の印字文字） */
export const SAFE_SECRET = /^[!#-&(-[\]-~]+$/;

/** サービス名とアカウントでパスワードを入れる。あれば上書き（-U）。失敗したら理由、できたら undefined */
export async function writeKeychain(service: string, account: string, secret: string, opts: KeychainOptions = {}): Promise<string | undefined> {
  if ((opts.platform ?? process.platform) !== 'darwin') return 'キーチェーンは Mac だけです';
  if (![service, account, secret].every((v) => SAFE_SECRET.test(v))) return '空白・引用符・\\ は使えません';
  const timeoutMs = opts.timeoutMs ?? KEYCHAIN_TIMEOUT_MS;
  const r = await (opts.run ?? runSecurity)(['-i'], timeoutMs, `add-generic-password -U -s ${service} -a ${account} -w ${secret}\n`);
  if (r.timedOut) return timedOut(timeoutMs);
  return r.code === 0 ? undefined : failure(r);
}

function timedOut(timeoutMs: number): string {
  return `キーチェーンから ${timeoutMs / 1000} 秒以内に応答がありませんでした`;
}

function failure(r: SecurityRun): string {
  const last = r.stderr.trim().split('\n').at(-1) ?? '';
  return `${last === '' ? 'security が失敗しました' : last}（終了コード ${r.code ?? '不明'}）`;
}

function runSecurity(args: string[], timeoutMs: number, input?: string): Promise<SecurityRun> {
  return new Promise((resolve) => {
    const child = execFile(SECURITY, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      if (e === null) return resolve({ code: 0, stdout, stderr, timedOut: false });
      if (e.killed === true) return resolve({ code: null, stdout, stderr, timedOut: true });
      resolve({ code: typeof e.code === 'number' ? e.code : null, stdout, stderr: stderr || e.message, timedOut: false });
    });
    child.stdin?.end(input ?? '');
  });
}

/** 隠して読む入力の形（process.stdin と、テストの偽物） */
export interface SecretInput extends NodeJS.EventEmitter {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  setEncoding: (encoding: BufferEncoding) => unknown;
  resume: () => unknown;
  pause: () => unknown;
}

/**
 * 端末から画面に出さずに 1 行読む（貼り付けて Enter）。Ctrl+C で undefined。
 * 端末でなければ（`pbpaste | ondina token`）標準入力を全部読む。どちらも前後の空白を落とす
 */
export function readSecret(prompt: string, input: SecretInput = process.stdin, output: { write: (s: string) => unknown } = process.stderr): Promise<string | undefined> {
  input.setEncoding('utf8');
  if (input.isTTY !== true || input.setRawMode === undefined) {
    return new Promise((resolve) => {
      let all = '';
      input.on('data', (chunk: string) => (all += chunk));
      input.once('end', () => resolve(all.trim()));
      input.resume();
    });
  }
  const setRawMode = input.setRawMode.bind(input);
  output.write(prompt);
  return new Promise((resolve) => {
    let text = '';
    const done = (value: string | undefined): void => {
      input.off('data', onData);
      setRawMode(false);
      input.pause();
      output.write('\n');
      resolve(value?.trim());
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done(text);
        if (ch === '\u0003') return done(undefined);
        if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1);
        else if (ch >= ' ') text += ch;
      }
    };
    setRawMode(true);
    input.on('data', onData);
    input.resume();
  });
}
