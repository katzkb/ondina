// 動き（設計書 3.3。2026-11-04）。呼び出しの線から呼ぶ順に並べ、構文木で呼び出しの式を付ける
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Edge, Symbol as OndinaSymbol } from '@ondina/model';
import { buildBehaviors } from '../src/behavior/build.js';
import { attachCalls } from '../src/behavior/calls.js';
import { fixtureAnalysis } from './fixture-analysis.js';
import { FIXTURE_ROOT } from './fixture.js';

const readHead = (p: string): string | undefined => {
  try {
    return readFileSync(path.join(FIXTURE_ROOT, 'head', p), 'utf8');
  } catch {
    return undefined;
  }
};

const S = (id: string, fqName: string, changed = true, p = `${id}.kt`): OndinaSymbol => ({ id, fqName, path: p, kind: 'function', changed });
const E = (from: string, to: string, lines?: number[], out?: string): Edge => ({
  from,
  to,
  kind: 'call',
  ...(lines === undefined ? {} : { lines }),
  ...(out === undefined ? {} : { types: { out } }),
  crossesLayers: false,
  provenance: 'lsp',
});
const build = (symbols: OndinaSymbol[], edges: Edge[]) => buildBehaviors({ symbols, edges, hunks: [], layers: [] });
const route = (b: ReturnType<typeof build>[number]) => b.messages.map((m) => `${m.from}>${m.to}${m.line === undefined ? '' : `@${m.line}`}`);

describe('fixture', async () => {
  const a = fixtureAnalysis({ files: false });
  const built = buildBehaviors({ symbols: a.symbols, edges: a.edges, hunks: a.hunks, layers: [{ name: 'API' }, { name: 'Application' }, { name: 'Domain' }, { name: 'Infrastructure' }] });
  const behaviors = await attachCalls(built, { symbols: a.symbols, readHead });
  const name = (id: string) => a.symbols.find((s) => s.id === id)!.fqName.split('.').slice(-2).join('.');

  it('始まりは OrderController.apply の 1 本だけ', () => {
    expect(behaviors.map((b) => name(b.start))).toEqual(['OrderController.apply']);
  });

  it('呼ぶ順に並ぶ。インターフェースと実装の 2 本は差分のある実装の 1 本にする', () => {
    expect(behaviors[0]!.messages.map((m) => `${name(m.to)} ${m.call?.text}${m.returns === undefined ? '' : ` ↩ ${m.returns}`}`)).toEqual([
      'ApplyDiscountUseCase.execute useCase.execute(OrderId(id), body.discountCode) ↩ Order',
      'OrderRepositoryImpl.find repository.find(id) ↩ Order?',
      'domain.Order order.applyDiscount(DiscountCommand(code))',
      'DiscountPolicy.rateFor DiscountPolicy.rateFor(cmd.code) ↩ Rate',
      'OrderRepositoryImpl.save repository.save(order)',
      'OrderRepositoryImpl.save repository.save(order)',
      'api.OrderResponse OrderResponse.from(order) ↩ OrderResponse',
    ]);
  });

  it('ゴールデン expected/behaviors.json と一致する', async () => {
    await expect(JSON.stringify(behaviors, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/behaviors.json'));
  });
});

describe('buildBehaviors', () => {
  it('差分のある呼び出し元を持つものは始まりにしない。差分の無い呼び出し元なら始まりにする', () => {
    const r = build([S('a', 'p.A.a'), S('b', 'p.B.b'), S('c', 'p.C.c'), S('u', 'p.U.u', false)], [E('a', 'b', [1]), E('u', 'c', [1]), E('c', 'b', [2])]);
    expect(r.map((b) => b.start)).toEqual(['a', 'c']);
  });

  it('呼び出しを 1 本も出さないものは動きにしない', () => {
    expect(build([S('a', 'p.A.a'), S('b', 'p.B.b', false)], [E('b', 'a', [1])])).toEqual([]);
  });

  it('深さ優先で、同じ呼ぶ側の中は行の順。1 本の線の何行かは行ごとに 1 回。行の無い線は後ろ', () => {
    const r = build([S('a', 'p.A.a'), S('b', 'p.B.b'), S('c', 'p.C.c'), S('d', 'p.D.d')], [E('a', 'c', [9]), E('a', 'b', [3, 12]), E('b', 'd', [5]), E('a', 'd')]);
    expect(route(r[0]!)).toEqual(['a>b@3', 'b>d@5', 'a>c@9', 'a>b@12', 'a>d']);
  });

  it('輪になっても終わる。同じシンボルには 1 回だけ入る', () => {
    const r = build([S('a', 'p.A.a'), S('b', 'p.B.b', false), S('c', 'p.C.c', false)], [E('a', 'b', [1]), E('b', 'c', [1]), E('c', 'b', [1])]);
    expect(route(r[0]!)).toEqual(['a>b@1', 'b>c@1', 'c>b@1']);
  });

  it('戻り型は線の types.out', () => {
    expect(build([S('a', 'p.A.a'), S('b', 'p.B.b')], [E('a', 'b', [1], 'Order?')])[0]!.messages[0]!.returns).toBe('Order?');
  });

  it('追従グループの代表でないメンバーは使わない', () => {
    const symbols = [S('a', 'p.A.a'), { ...S('m', 'p.M.m'), hunkId: 'hm' }];
    const r = buildBehaviors({ symbols, edges: [E('a', 'm', [1])], hunks: [{ id: 'hm', group: { id: 'g1', representative: 'hr' } as never }], layers: [] });
    expect(r).toEqual([]);
  });
});

describe('attachCalls', () => {
  const run = async (src: string, line: number, callee = 'p.B.save', p = 'A.kt') => {
    const symbols = [S('a', 'p.A.a', true, p), S('b', callee)];
    const [b] = await attachCalls(build(symbols, [E('a', 'b', [line])]), { symbols, readHead: () => src });
    return b!.messages[0]!.call;
  };

  it('何行にもまたがる呼び出しは 1 行に詰め、引数を 1 つずつ持つ', async () => {
    const src = 'fun a() {\n  val x = repo.save(\n    order,\n    OffsetDateTime.now(clock),\n  )\n}\n';
    expect(await run(src, 2)).toEqual({ text: 'repo.save(order, OffsetDateTime.now(clock))', exact: true, name: 'save', args: ['order', 'OffsetDateTime.now(clock)'] });
  });

  it('名前が合わなければ外側の呼び出し。後ろのラムダは {…}', async () => {
    const src = 'fun a() {\n  items.map { it.total() }\n}\n';
    expect(await run(src, 2, 'p.Item')).toEqual({ text: 'items.map { it.total() }', exact: true, name: 'map', args: ['{…}'] });
  });

  it('Kotlin でないファイルは行の中身', async () => {
    expect(await run('a\n   repo.save(order);\n', 2, 'p.B.save', 'A.java')).toEqual({ text: 'repo.save(order);', exact: false });
  });

  it('ファイルを読めなければ欄を付けない', async () => {
    const symbols = [S('a', 'p.A.a'), S('b', 'p.B.b')];
    const [b] = await attachCalls(build(symbols, [E('a', 'b', [1])]), { symbols, readHead: () => undefined });
    expect(b!.messages[0]!.call).toBeUndefined();
  });
});
