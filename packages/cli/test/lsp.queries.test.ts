// 準備完了後の問い合わせ（設計書 9.2）。偽の LspClient を渡すので、プロセスは 1 つも起こさない。
// 実機の形は src/lsp-queries.ts の先頭に控えてある。
import { describe, expect, it } from 'vitest';
import type { LspClient } from '@ondina/core';
import type { Hunk } from '@ondina/model';
import { collectCallGraph } from '../src/lsp-queries.js';

const ROOT = '/repo';
const IMPL = 'src/main/kotlin/com/example/order/infra/OrderRepositoryImpl.kt';
const TEST = 'src/test/kotlin/com/example/order/infra/OrderRepositoryImplTest.kt';
const LOGGER = 'src/main/kotlin/com/example/common/Logger.kt';
const uri = (rel: string) => `file://${ROOT}/${rel}`;

function hunk(path: string, fqName: string, over: Partial<Hunk> = {}): Hunk {
  return {
    id: `id-${fqName}`,
    path,
    lang: 'kotlin',
    symbol: fqName,
    symbolFqName: fqName,
    symbolKind: 'function',
    kind: 'none',
    kindProvenance: 'ast',
    hows: [],
    n: 1,
    lnOld: 1,
    lnNew: 1,
    lines: [],
    ...over,
  };
}

const range = (from: number, to: number) => ({ start: { line: from, character: 4 }, end: { line: to, character: 5 } });
const decl = (name: string, line: number, kind = 6) => ({ name, kind, range: range(line, line + 2), selectionRange: { start: { line, character: 8 }, end: { line, character: 8 + name.length } } });

interface Answers {
  documentSymbol?: Record<string, unknown>;
  prepare?: unknown[];
  outgoing?: unknown[];
  incoming?: unknown[];
  references?: unknown[];
  hover?: string;
}

/** 呼ばれたメソッドと params を全部控える偽クライアント */
function fakeClient(answers: Answers) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const client: LspClient = {
    request: async <T>(method: string, params?: unknown): Promise<T> => {
      calls.push({ method, params });
      const p = params as { textDocument?: { uri: string } };
      if (method === 'textDocument/documentSymbol') return ((answers.documentSymbol?.[p.textDocument!.uri] ?? []) as T);
      if (method === 'textDocument/prepareCallHierarchy') return ((answers.prepare ?? []) as T);
      if (method === 'callHierarchy/outgoingCalls') return ((answers.outgoing ?? []) as T);
      if (method === 'callHierarchy/incomingCalls') return ((answers.incoming ?? []) as T);
      if (method === 'textDocument/references') return ((answers.references ?? []) as T);
      if (method === 'textDocument/hover') return ({ contents: { kind: 'markdown', value: answers.hover ?? '' } } as T);
      return (null as T);
    },
    notify: () => undefined,
    onNotification: () => undefined,
    dispose: () => undefined,
  };
  return { client, calls };
}

const isTestPath = (p: string) => p.startsWith('src/test/');

describe('collectCallGraph', () => {
  it('バッククォート名のテスト関数でも位置が取れて、辺が test になる', async () => {
    const h = hunk(TEST, 'com.example.order.infra.OrderRepositoryImplTest.`persists discount`', { kind: 'test' });
    const { client } = fakeClient({
      documentSymbol: { [uri(TEST)]: [{ ...decl('OrderRepositoryImplTest', 8, 5), children: [decl('persists discount', 18)] }] },
      prepare: [{ name: 'OrderRepositoryImplTest.persists discount()', detail: 'com.example.order.infra', kind: 6, uri: uri(TEST), selectionRange: { start: { line: 18, character: 8 } } }],
      outgoing: [{ to: { name: 'OrderRepositoryImpl.save(Order)', detail: 'com.example.order.infra', kind: 6, uri: uri(IMPL), selectionRange: { start: { line: 12, character: 17 } } } }],
    });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(src.probes).toEqual([{ hunkId: h.id, item: { name: 'OrderRepositoryImplTest.persists discount()', detail: 'com.example.order.infra', kind: 6, path: TEST, line: 18 } }]);
    expect(src.calls).toHaveLength(1);
    expect(src.calls[0]!.kind).toBe('test');
    expect(src.calls[0]!.to.path).toBe(IMPL);
  });

  it('宣言の行と、呼んでいる位置（fromRanges の開始行。重複なし・昇順）を残す。fromRanges が無ければ空（設計書 3.3）', async () => {
    const h = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.save');
    const at = (line: number) => ({ start: { line, character: 4 }, end: { line, character: 9 } });
    const { client } = fakeClient({
      documentSymbol: { [uri(IMPL)]: [decl('save', 12)] },
      prepare: [{ name: 'OrderRepositoryImpl.save(Order)', detail: 'com.example.order.infra', kind: 6, uri: uri(IMPL), selectionRange: { start: { line: 12, character: 17 } } }],
      outgoing: [{ to: { name: 'Logger.log(Logger.Level, String)', detail: 'com.example.common', kind: 6, uri: uri(LOGGER), selectionRange: { start: { line: 9, character: 8 } } }, fromRanges: [at(15), at(13), at(15)] }],
      incoming: [{ from: { name: 'OrderRepository.save(Order)', detail: 'com.example.order.domain', kind: 6, uri: uri(IMPL), selectionRange: { start: { line: 4, character: 8 } } } }],
    });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(src.calls.map((c) => [c.from.line, c.to.line, c.lines])).toEqual([
      [12, 9, [13, 15]],
      [4, 12, []],
    ]);
  });

  it('prepareCallHierarchy が [] を返したら probes に item 無しで残す（黙って消さない）', async () => {
    const h = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.save');
    const { client } = fakeClient({ documentSymbol: { [uri(IMPL)]: [decl('save', 10)] }, prepare: [] });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(src.probes).toEqual([{ hunkId: h.id }]);
    expect(src.calls).toEqual([]);
  });

  it('宣言が見つからなくても probes に残す', async () => {
    const h = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.missing');
    const { client } = fakeClient({ documentSymbol: { [uri(IMPL)]: [decl('save', 10)] } });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(src.probes).toEqual([{ hunkId: h.id }]);
  });

  it('本番のコードから出た辺は call、シグネチャは FQ 名で引ける', async () => {
    const h = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.save');
    const { client } = fakeClient({
      documentSymbol: { [uri(IMPL)]: [decl('save', 10)] },
      prepare: [{ name: 'OrderRepositoryImpl.save(Order)', detail: 'com.example.order.infra', kind: 6, uri: uri(IMPL), selectionRange: { start: { line: 10, character: 8 } } }],
      hover: '````kotlin\noverride fun save(order: Order)\n````\n',
    });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(src.signatures).toEqual({ 'com.example.order.infra.OrderRepositoryImpl.save': 'override fun save(order: Order)' });
  });

  it('同じ宣言に hover を 2 回打たない', async () => {
    const a = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.save');
    const b = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.find');
    const item = { name: 'OrderRepositoryImpl.save(Order)', detail: 'com.example.order.infra', kind: 6, uri: uri(IMPL), selectionRange: { start: { line: 10, character: 8 } } };
    const { client, calls } = fakeClient({
      documentSymbol: { [uri(IMPL)]: [decl('save', 10), decl('find', 14)] },
      prepare: [item],
      outgoing: [{ to: item }],
      hover: '````kotlin\noverride fun save(order: Order)\n````',
    });
    await collectCallGraph(client, { hunks: [a, b], root: ROOT, isTestPath });
    expect(calls.filter((c) => c.method === 'textDocument/hover')).toHaveLength(1);
  });

  it('documentSymbol は 1 ファイルに 1 回しか打たない', async () => {
    const a = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.save');
    const b = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.find');
    const { client, calls } = fakeClient({ documentSymbol: { [uri(IMPL)]: [decl('save', 10), decl('find', 14)] } });
    await collectCallGraph(client, { hunks: [a, b], root: ROOT, isTestPath });
    expect(calls.filter((c) => c.method === 'textDocument/documentSymbol')).toHaveLength(1);
  });

  it('テストからの参照は囲っているテスト関数に丸める（同じテストから 2 回でも 1 件）', async () => {
    const h = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.save');
    const { client } = fakeClient({
      documentSymbol: {
        [uri(IMPL)]: [decl('save', 10)],
        // クラスの range は中の関数を全部含む（本物の documentSymbol と同じ）
        [uri(TEST)]: [{ ...decl('OrderRepositoryImplTest', 8, 5), range: range(8, 40), children: [decl('round trips subtotal', 12), decl('persists discount', 18)] }],
      },
      prepare: [{ name: 'OrderRepositoryImpl.save(Order)', detail: 'com.example.order.infra', kind: 6, uri: uri(IMPL), selectionRange: { start: { line: 10, character: 8 } } }],
      references: [
        { uri: uri(TEST), range: { start: { line: 13, character: 8 } } },
        { uri: uri(TEST), range: { start: { line: 14, character: 8 } } },
        { uri: uri(TEST), range: { start: { line: 19, character: 8 } } },
      ],
    });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(src.testRefs[h.id]).toEqual([`${TEST}#persists discount`, `${TEST}#round trips subtotal`]);
  });

  it('テスト以外からの参照は数えない（testCount はテストの数）', async () => {
    const h = hunk(IMPL, 'com.example.order.infra.OrderRepositoryImpl.save');
    const { client } = fakeClient({
      documentSymbol: { [uri(IMPL)]: [decl('save', 10)] },
      prepare: [{ name: 'OrderRepositoryImpl.save(Order)', detail: 'com.example.order.infra', kind: 6, uri: uri(IMPL), selectionRange: { start: { line: 10, character: 8 } } }],
      references: [{ uri: uri(IMPL), range: { start: { line: 30, character: 8 } } }],
    });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(src.testRefs[h.id]).toEqual([]);
  });

  it('ファイル hunk と .kt 以外は問い合わせない', async () => {
    const file = hunk(IMPL, IMPL, { symbolKind: 'file' });
    const sql = hunk('src/main/resources/db/V2__add.sql', 'src/main/resources/db/V2__add.sql', { symbolKind: 'file', lang: 'sql' });
    const { client, calls } = fakeClient({});
    const src = await collectCallGraph(client, { hunks: [file, sql], root: ROOT, isTestPath });
    expect(src.probes).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('collectCallGraph の参照（references を辺の材料にする。2026-09-24 決定）', () => {
  const ORDER = 'src/main/kotlin/com/example/order/domain/Order.kt';
  const declWithRange = (name: string, line: number, end: number, kind = 6) => ({ ...decl(name, line, kind), range: { start: { line, character: 0 }, end: { line: end, character: 1 } } });

  it('プロパティにも参照を打ち、位置を repo 相対パスと行で refs に記録する。テストの参照は testRefs にも数える', async () => {
    const h = hunk(ORDER, 'com.example.order.domain.Order.discount', { symbolKind: 'property' });
    const { client, calls } = fakeClient({
      documentSymbol: {
        [uri(ORDER)]: [{ ...declWithRange('Order', 2, 20, 5), children: [declWithRange('discount', 5, 5, 13), declWithRange('total', 12, 15)] }],
        [uri(IMPL)]: [{ ...declWithRange('OrderRepositoryImpl', 1, 30, 5), children: [declWithRange('save', 10, 20)] }],
        [uri(TEST)]: [{ ...declWithRange('OrderRepositoryImplTest', 8, 40, 5), children: [declWithRange('persists discount', 18, 25)] }],
      },
      prepare: [],
      references: [
        { uri: uri(IMPL), range: { start: { line: 12, character: 4 } } },
        { uri: uri(TEST), range: { start: { line: 20, character: 4 } } },
      ],
    });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(calls.filter((c) => c.method === 'textDocument/references')).toHaveLength(1);
    expect(src.probes).toEqual([{ hunkId: h.id }]);
    expect(src.refs).toEqual({ [h.id]: [{ path: IMPL, line: 12 }, { path: TEST, line: 20 }] });
    expect(src.testRefs).toEqual({ [h.id]: [`${TEST}#persists discount`] });
  });

  it('参照が出たファイルの宣言の範囲を、入れ子を . で繋いだ名前で ranges に記録する', async () => {
    const h = hunk(ORDER, 'com.example.order.domain.Order.discount', { symbolKind: 'property' });
    const { client } = fakeClient({
      documentSymbol: {
        [uri(ORDER)]: [{ ...declWithRange('Order', 2, 20, 5), children: [declWithRange('discount', 5, 5, 13)] }],
        [uri(IMPL)]: [{ ...declWithRange('OrderRepositoryImpl', 1, 30, 5), children: [declWithRange('save', 10, 20)] }],
      },
      prepare: [],
      references: [{ uri: uri(IMPL), range: { start: { line: 12, character: 4 } } }],
    });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(src.ranges).toEqual({
      [IMPL]: [
        { name: 'OrderRepositoryImpl', kind: 5, start: 1, end: 30 },
        { name: 'OrderRepositoryImpl.save', kind: 6, start: 10, end: 20 },
      ],
    });
  });

  it('参照が 1 件も無ければ refs は空配列で残す（測った 0 件と測っていないを混ぜない）', async () => {
    const h = hunk(ORDER, 'com.example.order.domain.Order.discount', { symbolKind: 'property' });
    const { client } = fakeClient({ documentSymbol: { [uri(ORDER)]: [{ ...declWithRange('Order', 2, 20, 5), children: [declWithRange('discount', 5, 5, 13)] }] }, prepare: [], references: [] });
    const src = await collectCallGraph(client, { hunks: [h], root: ROOT, isTestPath });
    expect(src.refs).toEqual({ [h.id]: [] });
    expect(src.ranges).toEqual({});
  });
});
