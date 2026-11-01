// LSP の JSON-RPC の往復（設計書 9.1 / 9.2）。プロセスは知らない。書き出す関数と、届いたバイト列を渡す口だけを受け取る。
// 起動・終了は cli（packages/cli/src/lsp.ts）。llm.ts と同じ「core が決める / cli が起動する」分担。
//
// サーバからの要求は 2 つ来る（2026-09-21 実測）。答えないと kotlin-lsp は取り込みを進めない:
// - window/workDoneProgress/create → null
// - workspace/configuration → items の数だけ {}
// 知らない要求にも null で答える（黙って詰まらせないため）。
import { createMessageReader, encodeMessage, type LspMessage } from './protocol.js';

export interface LspIo {
  /** サーバへ書く */
  write(chunk: Buffer): void;
  /** サーバから届いたバイト列を渡す口を登録する */
  onData(cb: (chunk: Buffer) => void): void;
}

export interface LspClient {
  /** 応答を待つ。error で返ってきたら投げる */
  request<T>(method: string, params?: unknown): Promise<T>;
  /** 応答を待たない */
  notify(method: string, params?: unknown): void;
  /** サーバからの通知を受け取る */
  onNotification(cb: (method: string, params: unknown) => void): void;
  /** 待っている request を全部投げて終わらせる。以後のメッセージは捨てる */
  dispose(reason: string): void;
}

export function createLspClient(io: LspIo): LspClient {
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  const listeners: Array<(method: string, params: unknown) => void> = [];
  const read = createMessageReader();
  let seq = 0;
  let disposed = false;

  const send = (msg: LspMessage): void => {
    if (disposed) return;
    io.write(encodeMessage(msg));
  };

  const onMessage = (msg: LspMessage): void => {
    // サーバ → クライアントの応答
    if (msg.id !== undefined && msg.method === undefined) {
      const key = Number(msg.id);
      const waiting = pending.get(key);
      if (waiting === undefined) return;
      pending.delete(key);
      if (msg.error !== undefined) waiting.reject(new Error(`LSP: ${msg.error.message}`));
      else waiting.resolve(msg.result as never);
      return;
    }
    // サーバ → クライアントの要求。最小限に答える
    if (msg.id !== undefined && msg.method !== undefined) {
      const items = (msg.params as { items?: unknown[] } | undefined)?.items;
      const result = msg.method === 'workspace/configuration' && Array.isArray(items) ? items.map(() => ({})) : null;
      send({ jsonrpc: '2.0', id: msg.id, result });
      return;
    }
    // 通知
    if (msg.method !== undefined) for (const cb of listeners) cb(msg.method, msg.params);
  };

  io.onData((chunk) => {
    if (disposed) return;
    for (const msg of read(chunk)) onMessage(msg);
  });

  return {
    request<T>(method: string, params?: unknown): Promise<T> {
      const id = ++seq;
      return new Promise<T>((resolve, reject) => {
        if (disposed) {
          reject(new Error('LSP: すでに終了しています'));
          return;
        }
        pending.set(id, { resolve: resolve as (v: never) => void, reject });
        send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      });
    },
    notify(method: string, params?: unknown): void {
      send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
    },
    onNotification(cb: (method: string, params: unknown) => void): void {
      listeners.push(cb);
    },
    dispose(reason: string): void {
      disposed = true;
      for (const [, waiting] of pending) waiting.reject(new Error(`LSP: ${reason}`));
      pending.clear();
      listeners.length = 0;
    },
  };
}
