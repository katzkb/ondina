// 設計書 5.2 手順2: 安定ID = sha1(path + '#' + fqName)。push 後も安定で、閲覧状態のキーになる。
// リネームは別 ID になる（許容。16章）。
import { createHash } from 'node:crypto';

export function hunkId(path: string, fqName: string): string {
  return createHash('sha1').update(`${path}#${fqName}`).digest('hex');
}
