// Mac のキーチェーン（2026-10-12）。security の呼び出しは差し替えて、手元のキーチェーンに触らない
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readKeychain, readSecret, type SecretInput, writeKeychain } from '../src/keychain.js';

describe('readKeychain', () => {
  const ok = (stdout: string) => async () => ({ code: 0, stdout, stderr: '', timedOut: false });
  it('security find-generic-password -s <サービス> -w で読み、末尾の改行を落とす', async () => {
    const calls: string[][] = [];
    const r = await readKeychain('ondina-jira', { platform: 'darwin', run: async (args) => (calls.push(args), { code: 0, stdout: 'tok-123\n', stderr: '', timedOut: false }) });
    expect(r).toEqual({ token: 'tok-123' });
    expect(calls).toEqual([['find-generic-password', '-s', 'ondina-jira', '-w']]);
  });
  it('見つからない（終了コード 44）・空なら無い', async () => {
    expect(await readKeychain('ondina-jira', { platform: 'darwin', run: async () => ({ code: 44, stdout: '', stderr: 'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n', timedOut: false }) })).toEqual({ none: true });
    expect(await readKeychain('ondina-jira', { platform: 'darwin', run: ok('\n') })).toEqual({ none: true });
  });
  it('ほかの失敗は stderr の最後の行を理由に', async () => {
    const r = await readKeychain('ondina-jira', { platform: 'darwin', run: async () => ({ code: 51, stdout: '', stderr: 'security: SecKeychainItemCopyContent: User interaction is not allowed.\n', timedOut: false }) });
    expect(r).toEqual({ error: 'security: SecKeychainItemCopyContent: User interaction is not allowed.（終了コード 51）' });
  });
  it('時間内に終わらなければ理由（ロック解除の画面を閉じていないなど）', async () => {
    const r = await readKeychain('ondina-jira', { platform: 'darwin', timeoutMs: 100, run: async () => ({ code: null, stdout: '', stderr: '', timedOut: true }) });
    expect(r).toEqual({ error: 'キーチェーンから 0.1 秒以内に応答がありませんでした' });
  });
  it('Mac でなければ読まない（undefined）', async () => {
    let ran = 0;
    expect(await readKeychain('ondina-jira', { platform: 'linux', run: async () => (ran++, { code: 0, stdout: 'x', stderr: '', timedOut: false }) })).toBeUndefined();
    expect(ran).toBe(0);
  });
});

describe('writeKeychain', () => {
  it('security -i の標準入力で add-generic-password -U を渡す（トークンを引数に載せない）', async () => {
    const calls: { args: string[]; input?: string }[] = [];
    const r = await writeKeychain('ondina-jira', 'me', 'ATATT3x=_-tok', { platform: 'darwin', run: async (args, _t, input) => (calls.push({ args, ...(input === undefined ? {} : { input }) }), { code: 0, stdout: '', stderr: '', timedOut: false }) });
    expect(r).toBeUndefined();
    expect(calls).toEqual([{ args: ['-i'], input: 'add-generic-password -U -s ondina-jira -a me -w ATATT3x=_-tok\n' }]);
  });
  it('空白・引用符・\\ を含むものは security に渡さずに理由', async () => {
    let ran = 0;
    const run = async () => (ran++, { code: 0, stdout: '', stderr: '', timedOut: false });
    for (const bad of ['a b', 'a"b', "a'b", 'a\\b', '']) expect(await writeKeychain('ondina-jira', 'me', bad, { platform: 'darwin', run })).toBe('空白・引用符・\\ は使えません');
    expect(ran).toBe(0);
  });
  it('失敗は stderr の最後の行と終了コード', async () => {
    const r = await writeKeychain('ondina-jira', 'me', 'tok', { platform: 'darwin', run: async () => ({ code: 45, stdout: '', stderr: 'add-generic-password: returned -25299\n', timedOut: false }) });
    expect(r).toBe('add-generic-password: returned -25299（終了コード 45）');
  });
  it('Mac でなければ入れない', async () => {
    expect(await writeKeychain('ondina-jira', 'me', 'tok', { platform: 'linux' })).toBe('キーチェーンは Mac だけです');
  });
});

describe('readSecret', () => {
  const tty = () => {
    const s = new PassThrough() as PassThrough & SecretInput;
    const modes: boolean[] = [];
    s.isTTY = true;
    s.setRawMode = (m: boolean) => modes.push(m);
    return { s, modes };
  };
  const out = () => {
    const w: string[] = [];
    return { write: (x: string) => w.push(x), w };
  };
  it('端末では画面に出さずに Enter まで読む。貼り付けは 1 回で届く。前後の空白は落とす', async () => {
    const { s, modes } = tty();
    const o = out();
    const p = readSecret('トークン: ', s, o);
    s.write(' tok-123 \r');
    expect(await p).toBe('tok-123');
    expect(o.w).toEqual(['トークン: ', '\n']);
    expect(modes).toEqual([true, false]);
  });
  it('Backspace で 1 文字消す。ほかの制御文字は入れない', async () => {
    const { s } = tty();
    const p = readSecret('', s, out());
    s.write('abx\u007fc\u001b');
    s.write('d\n');
    expect(await p).toBe('abcd');
  });
  it('Ctrl+C でやめる（undefined）', async () => {
    const { s, modes } = tty();
    const p = readSecret('', s, out());
    s.write('ab\u0003');
    expect(await p).toBeUndefined();
    expect(modes).toEqual([true, false]);
  });
  it('端末でなければ標準入力を全部読む（pbpaste | ondina token）。プロンプトは出さない', async () => {
    const s = new PassThrough() as PassThrough & SecretInput;
    const o = out();
    const p = readSecret('トークン: ', s, o);
    s.end('tok-456\n');
    expect(await p).toBe('tok-456');
    expect(o.w).toEqual([]);
  });
});
