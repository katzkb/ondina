// JSON-RPC の往復。プロセスは知らず、書き出す関数と読み込みの口だけを受け取る（起動は cli）。
// サーバからの要求（window/workDoneProgress/create と workspace/configuration）に最小限で答えないと
// kotlin-lsp は取り込みを進めないので、そこを固定する。
import { describe, expect, it, vi } from 'vitest';
import { createLspClient } from '../src/lsp/client.js';
import { createMessageReader, encodeMessage } from '../src/lsp/protocol.js';

/** サーバ役。client が書いたものを溜め、こちらからはフレームを流し込む */
function pair() {
  const written: unknown[] = [];
  const readBack = createMessageReader();
  let feed: (chunk: Buffer) => void = () => undefined;
  const client = createLspClient({
    write: (chunk) => written.push(...readBack(chunk)),
    onData: (cb) => (feed = cb),
  });
  return { client, written, send: (msg: unknown) => feed(encodeMessage(msg as never)) };
}

describe('createLspClient', () => {
  it('request は id を 1 から振り、応答の result で解決する', async () => {
    const { client, written, send } = pair();
    const p = client.request<{ ok: boolean }>('initialize', { a: 1 });
    expect(written).toEqual([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { a: 1 } }]);
    send({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('応答が error なら投げる', async () => {
    const { client, send } = pair();
    const p = client.request('x');
    send({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'no such method' } });
    await expect(p).rejects.toThrow('no such method');
  });

  it('順番が入れ替わって返っても取り違えない', async () => {
    const { client, send } = pair();
    const a = client.request<string>('a');
    const b = client.request<string>('b');
    send({ jsonrpc: '2.0', id: 2, result: 'B' });
    send({ jsonrpc: '2.0', id: 1, result: 'A' });
    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
  });

  it('notify は id を付けない', () => {
    const { client, written } = pair();
    client.notify('initialized', {});
    expect(written).toEqual([{ jsonrpc: '2.0', method: 'initialized', params: {} }]);
  });

  it('通知は onNotification に流す', () => {
    const { client, send } = pair();
    const seen = vi.fn();
    client.onNotification(seen);
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 't', value: { kind: 'begin' } } });
    expect(seen).toHaveBeenCalledWith('$/progress', { token: 't', value: { kind: 'begin' } });
  });

  it('window/workDoneProgress/create には null で答える', () => {
    const { written, send } = pair();
    send({ jsonrpc: '2.0', id: 7, method: 'window/workDoneProgress/create', params: { token: 't' } });
    expect(written).toEqual([{ jsonrpc: '2.0', id: 7, result: null }]);
  });

  it('workspace/configuration には items の数だけ空オブジェクトで答える', () => {
    const { written, send } = pair();
    send({ jsonrpc: '2.0', id: 8, method: 'workspace/configuration', params: { items: [{ section: 'a' }, { section: 'b' }] } });
    expect(written).toEqual([{ jsonrpc: '2.0', id: 8, result: [{}, {}] }]);
  });

  it('知らない要求にも null で答える（黙って詰まらせない）', () => {
    const { written, send } = pair();
    send({ jsonrpc: '2.0', id: 9, method: 'client/registerCapability', params: { registrations: [] } });
    expect(written).toEqual([{ jsonrpc: '2.0', id: 9, result: null }]);
  });

  it('dispose のあとは待っている request を投げ、以後のメッセージは捨てる', async () => {
    const { client, send } = pair();
    const p = client.request('x');
    client.dispose('接続が切れました');
    await expect(p).rejects.toThrow('接続が切れました');
    expect(() => send({ jsonrpc: '2.0', id: 1, result: 1 })).not.toThrow();
    await expect(client.request('y')).rejects.toThrow('すでに終了しています');
  });
});
