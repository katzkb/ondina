// 処理の流れ（設計書 3.3。2026-11-05）。変わる前と変わった後の呼び出しの線を合わせ、入口から呼び出しの木を組む
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Edge, CallFlow, FlowCall, Hunk, Symbol as OndinaSymbol } from '@ondina/model';
import { buildFlows, stageOf } from '../src/flow/build.js';
import { attachFlowCalls } from '../src/flow/calls.js';
import { buildBaseCallEdges } from '../src/lsp/edges.js';
import { fixtureAnalysis } from './fixture-analysis.js';
import { FIXTURE_ROOT, readFixtureBase, readFixtureCallGraphBase, readFixtureHead } from './fixture.js';

const LAYERS = [{ name: 'API' }, { name: 'Application' }, { name: 'Domain' }, { name: 'Infrastructure' }];

describe('fixture', async () => {
  const a = fixtureAnalysis({ files: false });
  const base = buildBaseCallEdges(readFixtureCallGraphBase(), { hunks: a.hunks, symbols: a.symbols.filter((s) => s.changed), layers: [], allowedDependencies: {}, readHead: readFixtureBase });
  const symbols = [...a.symbols, ...base.symbols.filter((s) => !a.symbols.some((t) => t.id === s.id))];
  const built = buildFlows({ symbols, edges: a.edges, edgesBase: base.edges, hunks: a.hunks, layers: LAYERS });
  const flows = await attachFlowCalls(built, { symbols, readHead: readFixtureHead, readBase: readFixtureBase });
  const name = (id: string) => symbols.find((s) => s.id === id)!.fqName.split('.').slice(-2).join('.');
  const lines = (c: FlowCall, depth = 0): string[] => [
    `${'  '.repeat(depth)}${name(c.to)} ${c.status}${c.courses.length === 0 ? '' : ` [${c.courses.join(',')}]`}`,
    ...c.kids.flatMap((k) => lines(k, depth + 1)),
  ];

  it('入口は OrderController.apply の 1 本だけ', () => {
    expect(flows.map((f) => name(f.root.to))).toEqual(['OrderController.apply']);
  });

  it('② この PR: 変わる前と後を合わせた木。save は 2 回出る', () => {
    expect(lines(flows[0]!.root).map((l) => l.replace(/ \[.*\]$/, ''))).toEqual([
      'OrderController.apply changed',
      '  ApplyDiscountUseCase.execute changed',
      '    OrderRepositoryImpl.find same',
      '    domain.Order added',
      '      DiscountPolicy.rateFor added',
      '    OrderRepositoryImpl.save added',
      '  OrderRepositoryImpl.save added',
      '  api.OrderResponse same',
    ]);
  });

  it('① 背景は変わる前の 4 呼び出し、③ マージ後は 8 呼び出し', () => {
    const count = (c: FlowCall | undefined): number => (c === undefined ? 0 : 1 + c.kids.reduce((n, k) => n + count(k), 0));
    const before = stageOf(flows[0]!.root, 'before');
    expect(before === undefined ? [] : lines(before).map((l) => l.trim().replace(/ .*/, ''))).toEqual(['OrderController.apply', 'ApplyDiscountUseCase.execute', 'OrderRepositoryImpl.find', 'api.OrderResponse']);
    expect(count(stageOf(flows[0]!.root, 'after'))).toBe(8);
  });

  it('呼び出しの式は変わる前は base、後は head のファイルから。行も各々のファイル', () => {
    const execute = flows[0]!.root.kids[0]!;
    expect(execute.before).toEqual({ line: 17, call: { text: 'useCase.execute(OrderId(id))', exact: true, name: 'execute', args: ['OrderId(id)'] }, returns: 'Order' });
    expect(execute.after?.line).toBe(18);
    expect(execute.after?.call?.text).toBe('useCase.execute(OrderId(id), body.discountCode)');
    const from = flows[0]!.root.kids.at(-1)!;
    expect([from.before?.line, from.after?.line, from.after?.call?.text]).toEqual([18, 20, 'OrderResponse.from(order)']);
  });

  it('コース: 呼んでいる行が入る hunk の How。差分の行に入らない呼び出しはコースなし', () => {
    const root = flows[0]!.root;
    const howsOf = (h: Pick<Hunk, 'hows'> | undefined) => h?.hows ?? [];
    const applyHunk = a.hunks.find((h) => h.id === symbols.find((s) => s.id === root.to)!.hunkId);
    expect(root.courses).toEqual(howsOf(applyHunk));
    expect(root.kids[0]!.courses.length).toBeGreaterThan(0);
    expect(root.kids[0]!.kids[0]!.courses).toEqual([]);
    expect(root.kids.at(-1)!.courses).toEqual([]);
  });

  it('key は根から辿った呼び出しの道。木の中で重ならない', () => {
    const keys = (c: FlowCall): string[] => [c.key, ...c.kids.flatMap(keys)];
    const all = keys(flows[0]!.root);
    expect(new Set(all).size).toBe(all.length);
    expect(flows[0]!.root.key).toBe(`>${flows[0]!.root.to}#1`);
    expect(flows[0]!.root.kids[0]!.key.startsWith(`${flows[0]!.root.key}/`)).toBe(true);
  });

  it('ゴールデン expected/flows.json と一致する', async () => {
    await expect(JSON.stringify(flows, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/flows.json'));
  });
});

const S = (id: string, changed = true): OndinaSymbol => ({ id, fqName: `p.${id.toUpperCase()}.${id}`, path: `${id}.kt`, kind: 'function', changed, ...(changed ? { hunkId: `h${id}` } : {}) });
const E = (from: string, to: string, lines?: number[]): Edge => ({ from, to, kind: 'call', ...(lines === undefined ? {} : { lines }), crossesLayers: false, provenance: 'lsp' });
/** 1 シンボル 1 hunk。lines は統合形式（' ' / '+' / '-'）を 1 文字ずつ。lnOld / lnNew は 1 */
const H = (id: string, shape: string, hows: number[] = []): Hunk =>
  ({ id: `h${id}`, path: `${id}.kt`, lang: 'kotlin', symbol: id, symbolFqName: id, symbolKind: 'function', kind: 'core', kindProvenance: 'ast', hows, n: 1, lnOld: 1, lnNew: 1, lines: [...shape].map((c) => `${c}x`) }) as Hunk;
const flat = (f: CallFlow | undefined) => {
  const walk = (c: FlowCall): string[] => [`${c.from ?? ''}>${c.to} ${c.status}${c.cut ? ' cut' : ''}`, ...c.kids.flatMap(walk)];
  return f === undefined ? [] : walk(f.root);
};

describe('buildFlows', () => {
  const build = (symbols: OndinaSymbol[], edges: Edge[], edgesBase: Edge[], hunks: Hunk[] = []) => buildFlows({ symbols, edges, edgesBase, hunks, layers: [] });

  it('消えた呼び出しは変わる前の順の位置に入る', () => {
    const symbols = [S('a'), S('b', false), S('c', false), S('d', false)];
    const flows = build(symbols, [E('a', 'b', [1]), E('a', 'd', [3])], [E('a', 'b', [1]), E('a', 'c', [2]), E('a', 'd', [3])], [H('a', ' - ')]);
    expect(flat(flows[0])).toEqual(['>a changed', 'a>b same', 'a>c removed', 'a>d same']);
  });

  it('呼んでいる行が差分の行に入れば changed（base は消した行、head は足した行で見る）', () => {
    const symbols = [S('a'), S('b', false)];
    // base: 1 行目 = 消した行、head: 1 行目 = 足した行
    const flows = build(symbols, [E('a', 'b', [1])], [E('a', 'b', [1])], [H('a', '-+')]);
    expect(flat(flows[0])).toEqual(['>a changed', 'a>b changed']);
  });

  it('同じ呼ぶ側から同じ先への 2 回目は別の呼び出し。後から足した 2 回目は added', () => {
    const symbols = [S('a'), S('b', false)];
    const flows = build(symbols, [E('a', 'b', [1, 2])], [E('a', 'b', [1])], [H('a', ' +')]);
    expect(flat(flows[0])).toEqual(['>a changed', 'a>b same', 'a>b added']);
    expect(flows[0]!.root.kids.map((k) => k.key.split('/').pop())).toEqual(['a>b#1', 'a>b#2']);
  });

  it('呼ばれるたびに中を開く。輪になったら開かずに cut', () => {
    const symbols = [S('a'), S('b'), S('c')];
    const edges = [E('a', 'b', [1]), E('a', 'c', [2]), E('c', 'b', [1]), E('b', 'c', [1])];
    const flows = build(symbols, edges, [], [H('a', '++'), H('b', '+'), H('c', '+')]);
    expect(flat(flows[0])).toEqual(['>a added', 'a>b added', 'b>c added', 'c>b added cut', 'a>c added', 'c>b added', 'b>c added cut']);
  });

  it('深さ 6 で打ち切る', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    const symbols = ids.map((id) => S(id));
    const edges = ids.slice(1).map((id, i) => E(ids[i]!, id, [1]));
    const flows = build(symbols, edges, edges, ids.map((id) => H(id, ' ')));
    const depth = (c: FlowCall): number => 1 + Math.max(0, ...c.kids.map(depth));
    expect(depth(flows[0]!.root)).toBe(7);
    expect(flat(flows[0]).at(-1)).toBe('f>g same cut');
  });

  it('消えた呼び出しの先は変わる前の呼び出しだけ、足した呼び出しの先は後の呼び出しだけを開く', () => {
    const symbols = [S('a'), S('b'), S('c', false), S('d', false)];
    // b は変わる前は c を、後は d を呼ぶ。a → b は消えた
    const flows = build(symbols, [E('b', 'd', [1])], [E('a', 'b', [1]), E('b', 'c', [1])], [H('a', ' -'), H('b', '-+')]);
    expect(flat(flows[0])).toEqual(['>a changed', 'a>b removed', 'b>c removed']);
  });

  it('入口: 変わる前か後に差分のある呼び出し元があればそこから辿る。呼び出しの無いシンボルは流れにしない', () => {
    const symbols = [S('a'), S('b'), S('c')];
    // 変わる前だけ a → b。c は呼び出しを持たない
    const flows = build(symbols, [E('b', 'c', [1])], [E('a', 'b', [1])], [H('a', '-'), H('b', '+'), H('c', '+')]);
    expect(flows.map((f) => f.root.to)).toEqual(['a']);
  });

  it('根の状態は入口の hunk で決める: 足しただけは added、消しただけは removed', () => {
    const symbols = [S('a'), S('b', false), S('x'), S('y', false)];
    const flows = build(symbols, [E('a', 'b', [1])], [E('x', 'y', [1])], [H('a', '+'), H('x', '-')]);
    expect(flows.map((f) => [f.root.to, f.root.status, f.root.before !== undefined, f.root.after !== undefined])).toEqual([
      ['a', 'added', false, true],
      ['x', 'removed', true, false],
    ]);
  });

  it('① と ③ は片側の呼び出しだけを辿った木', () => {
    const symbols = [S('a'), S('b', false), S('c', false)];
    const flows = build(symbols, [E('a', 'c', [1])], [E('a', 'b', [1])], [H('a', '-+')]);
    const names = (c: FlowCall | undefined): string[] => (c === undefined ? [] : [c.to, ...c.kids.flatMap(names)]);
    expect(names(stageOf(flows[0]!.root, 'before'))).toEqual(['a', 'b']);
    expect(names(stageOf(flows[0]!.root, 'after'))).toEqual(['a', 'c']);
  });
});
