// LSP のフレーミング（設計書 9.1）。Content-Length は「バイト数」なので、日本語が混ざっても切り出せることを固定する。
import { describe, expect, it } from 'vitest';
import { createMessageReader, encodeMessage } from '../src/lsp/protocol.js';

const frame = (obj: unknown): Buffer => {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
};

describe('encodeMessage', () => {
  it('Content-Length をバイト数で付ける（日本語は 1 文字 3 バイト）', () => {
    const msg = { jsonrpc: '2.0', method: 'x', params: { m: 'あ' } };
    const body = JSON.stringify(msg);
    expect(Buffer.byteLength(body, 'utf8')).toBeGreaterThan(body.length);
    expect(encodeMessage(msg).toString('utf8')).toBe(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
  });
});

describe('createMessageReader', () => {
  it('1 チャンクに 1 メッセージ', () => {
    const read = createMessageReader();
    expect(read(frame({ id: 1, result: null }))).toEqual([{ id: 1, result: null }]);
  });

  it('1 チャンクに 2 メッセージ', () => {
    const read = createMessageReader();
    expect(read(Buffer.concat([frame({ id: 1 }), frame({ method: 'a' })]))).toEqual([{ id: 1 }, { method: 'a' }]);
  });

  it('ヘッダの途中で切れても持ち越す', () => {
    const read = createMessageReader();
    const full = frame({ method: 'a' });
    expect(read(full.subarray(0, 6))).toEqual([]);
    expect(read(full.subarray(6))).toEqual([{ method: 'a' }]);
  });

  it('本文の途中で切れても持ち越す', () => {
    const read = createMessageReader();
    const full = frame({ method: 'あいうえお' });
    const cut = full.length - 4;
    expect(read(full.subarray(0, cut))).toEqual([]);
    expect(read(full.subarray(cut))).toEqual([{ method: 'あいうえお' }]);
  });

  it('Content-Length の無いヘッダは投げる', () => {
    const read = createMessageReader();
    expect(() => read(Buffer.from('Content-Type: x\r\n\r\n{}', 'utf8'))).toThrow(/Content-Length/);
  });

  it('JSON として読めない本文は投げる', () => {
    const read = createMessageReader();
    expect(() => read(Buffer.from('Content-Length: 3\r\n\r\nnot', 'utf8'))).toThrow(/JSON/);
  });
});
