// analyze と serve のあいだの言語サーバーの仕事の本文（設計書 9.1 / 5.5）。PR で変わったファイル（changed）は analyze が渡し、
// 定義（3.6）より前の analyze は送らないので、serve の側で hunk と sides のファイルで埋める
import { describe, expect, it } from 'vitest';
import { KOTLIN_IMPORT_NOTIFICATION } from '@ondina/core';
import type { Hunk } from '@ondina/model';
import { isLspJobRequest, toJobArgs, type LspJobRequest } from '../src/lsp-remote.js';

const hunk = (path: string): Hunk => ({ id: path, path, lang: 'kotlin', symbol: 'x', symbolFqName: 'x', symbolKind: 'file', kind: 'none', kindProvenance: 'ast', hows: [], n: 1, lnOld: 1, lnNew: 1, lines: [] });

const request = (extra: Partial<LspJobRequest> = {}): LspJobRequest => ({
  language: 'kotlin',
  command: 'kotlin-lsp',
  args: [],
  readyTimeoutSec: 10,
  rule: KOTLIN_IMPORT_NOTIFICATION,
  root: '/w/lsp',
  cacheDir: '/w/cache',
  shas: { base: 'b', head: 'h' },
  sides: { head: ['A.kt'], base: ['B.kt'] },
  targets: [],
  hunks: [hunk('A.kt'), hunk('db/V1.sql')],
  tests: { layers: [], sourceRoots: [] },
  ...extra,
});

describe('LspJobRequest の changed', () => {
  it('analyze が渡した変わったファイルをそのまま使う', () => {
    expect(toJobArgs(request({ changed: ['A.kt', 'B.kt', 'db/V1.sql', 'README.md'] }), () => {}).changed).toEqual(['A.kt', 'B.kt', 'db/V1.sql', 'README.md']);
  });

  it('前の analyze（changed 無し）なら hunk と sides のファイルで埋める。形の検査も通す', () => {
    const old = request();
    expect(isLspJobRequest(JSON.parse(JSON.stringify(old)))).toBe(true);
    expect(toJobArgs(old, () => {}).changed).toEqual(['A.kt', 'db/V1.sql', 'B.kt']);
  });

  it('changed が文字列の並びでなければ形の検査で落とす', () => {
    expect(isLspJobRequest({ ...request(), changed: 'A.kt' })).toBe(false);
  });
});
