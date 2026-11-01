// LSP のフレーミング（設計書 9.1）。Content-Length ヘッダ + 空行 + 本文。
// Content-Length は文字数ではなくバイト数なので、Buffer のまま数えて切り出してから utf8 に直す。
// ここはプロセスを知らない。起動と終了は cli（packages/cli/src/lsp.ts）。

export interface LspMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

const HEADER_END = Buffer.from('\r\n\r\n', 'ascii');

/** メッセージ 1 個を Content-Length 付きのバイト列にする */
export function encodeMessage(msg: LspMessage): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/**
 * 到着したチャンクを食わせると、揃ったメッセージだけを返す。途中で切れた分は次のチャンクまで持ち越す。
 * ヘッダが壊れている・本文が JSON でないのは、黙って進むと後段が事実でない値を見るので投げる。
 */
export function createMessageReader(): (chunk: Buffer) => LspMessage[] {
  let buf = Buffer.alloc(0);
  return (chunk: Buffer): LspMessage[] => {
    buf = Buffer.concat([buf, chunk]);
    const out: LspMessage[] = [];
    for (;;) {
      const sep = buf.indexOf(HEADER_END);
      if (sep === -1) return out;
      const header = buf.subarray(0, sep).toString('ascii');
      const m = /^Content-Length:[ \t]*(\d+)/im.exec(header);
      if (m === null) throw new Error(`LSP: Content-Length のないヘッダを受け取りました: ${JSON.stringify(header)}`);
      const len = Number(m[1]);
      const start = sep + HEADER_END.length;
      if (buf.length < start + len) return out;
      const body = buf.subarray(start, start + len).toString('utf8');
      buf = buf.subarray(start + len);
      try {
        out.push(JSON.parse(body) as LspMessage);
      } catch {
        throw new Error(`LSP: JSON として読めないメッセージを受け取りました: ${body.slice(0, 120)}`);
      }
    }
  };
}
