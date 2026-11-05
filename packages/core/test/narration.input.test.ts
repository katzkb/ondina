// 2 回目の LLM（文を書く。設計書 5.3 / 10 章）への入力を、1 回目の入力と How の割当とコースの読む順番から組む。決定的。
// ゴールデンは expected/llm-text-input.json（record-llm-text.mjs がこれを LLM コマンドに渡す）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Edge, CallFlow, How, Hunk, Symbol, Tour } from '@ondina/model';
import type { LlmInput } from '../src/label/types.js';
import { removedDeclarations } from '../src/hunks/removed.js';
import { buildNarrationInput } from '../src/narration/input.js';
import { changedFixtureFiles, FIXTURE_ROOT } from './fixture.js';

const base: LlmInput = {
  pr: { title: 'T', body: 'B' },
  hunks: [
    { id: 'h1', path: 'a/Order.kt', symbol: 'Order', kindHint: 'core', lines: ['-x', '+y'] },
    { id: 'h2', path: 'test/OrderTest.kt', symbol: 'test', kindHint: 'test', lines: ['+t'] },
    { id: 'h3', path: 'a/Logger.kt', symbol: 'format', lines: ['-l', '+m'] },
  ],
  rippleGroups: [
    {
      id: 'g1',
      pattern: 'a → b',
      coreHunkId: 'h1',
      members: 3,
      representative: { hunkId: 'r1', path: 'b/View.kt', symbol: 'field', lines: ['-a', '+b'] },
      deviations: [{ hunkId: 'd1', path: 'b/Promo.kt', symbol: 'apply', lines: ['-a', '+c'] }],
    },
  ],
  edges: [{ from: 'h2', to: 'h1', kind: 'test' }],
  unlayeredPaths: ['a/Logger.kt'],
  previous: { hows: [{ id: 1, title: 'A', why: 'W' }], assignment: {} },
};
const hows: How[] = [{ id: 1, title: 'A', why: 'W', specIds: [] }];
const hunk = (id: string, kind: Hunk['kind'], hs: number[], lnNew = 1) => ({ id, kind, hows: hs, lnNew });
const hunks = [hunk('h1', 'core', [1], 9), hunk('h2', 'test', [1]), hunk('h3', 'none', []), hunk('r1', 'ripple', [1], 20), hunk('d1', 'ripple', [1], 5), hunk('m1', 'ripple', [1])];
const sym = (id: string, fqName: string, p: string, extra: Partial<Symbol> = {}): Symbol => ({ id, fqName, path: p, kind: 'function', changed: true, hunkId: id, ...extra });
const symbols: Symbol[] = [
  sym('h1', 'a.Order', 'a/Order.kt', { kind: 'class' }),
  sym('u1', 'a.Policy.rateFor', 'a/Policy.kt', {
    changed: false,
    hunkId: undefined,
    excerpt: [
      { start: 9, lines: ['fun rateFor(code: String): Rate =', '    TABLE[code]'], centers: [9] },
      { start: 20, lines: ['val y = 1'], centers: [20] },
    ],
  }),
  sym('u2', 'c.Cart.total', 'c/Cart.kt', { changed: false, hunkId: undefined }),
  sym('r1', 'b.View.field', 'b/View.kt'),
  sym('h2', 'test.OrderTest.applies', 'test/OrderTest.kt'),
];
// u1（差分の無い Policy.rateFor）は Order が呼ぶ相手。u2（差分の無い Cart.total）は Order を呼ぶ相手。どちらも停留所ではない（2026-10-11）
const edges: Pick<Edge, 'from' | 'to' | 'kind'>[] = [
  { from: 'h2', to: 'h1', kind: 'test' },
  { from: 'h1', to: 'u1', kind: 'call' },
  { from: 'u2', to: 'h1', kind: 'call' },
  { from: 'h1', to: 'u1', kind: 'reference' },
];
const tours: Tour[] = [
  {
    howId: 1,
    steps: [
      { symbolId: 'h1', hunkId: 'h1', call: '' },
      { symbolId: 'r1', hunkId: 'r1', call: '' },
      { symbolId: 'h2', hunkId: 'h2', call: '' },
    ],
  },
];

describe('buildNarrationInput', () => {
  const removed = [{ fqName: 'a.Order.legacy', path: 'a/Order.kt', kind: 'function' as const, line: 4 }];
  const input = buildNarrationInput({ base, hows, hunks, symbols, edges, tours, removed });

  it('pr は題だけ（作者の説明は渡さない）。hunks と rippleGroups は 1 回目の入力の行に番号を付けたもので、previous / edges / unlayeredPaths は渡さない', () => {
    expect(input.pr).toEqual({ title: 'T' });
    const noLines = <T extends { lines: string[] }>(x: T) => ({ ...x, lines: [] });
    expect(input.hunks.map(noLines)).toEqual(base.hunks.map(noLines));
    expect(input.rippleGroups.map((g) => ({ ...g, representative: { ...g.representative, lines: [] }, deviations: g.deviations.map((d) => ({ ...d, lines: [] })) }))).toEqual(
      base.rippleGroups.map((g) => ({ ...g, representative: { ...g.representative, lines: [] }, deviations: g.deviations.map((d) => ({ ...d, lines: [] })) })),
    );
    expect(Object.keys(input).sort()).toEqual(['courses', 'existing', 'hunks', 'pr', 'rippleGroups', 'unassigned']);
  });

  // 2026-10-22: 確かめることの根拠の行を LLM が番号で選ぶ（読む前の案内。見本を比べて案 1 にした）
  it('差分の行の頭に head（マージ後）の行番号と「|」。削除の行は番号の代わりに空白。束の代表と差異ありも同じ', () => {
    expect(input.hunks[0]!.lines).toEqual([' |-x', '9|+y']);
    expect(input.rippleGroups[0]!.representative.lines).toEqual(['  |-a', '20|+b']);
    expect(input.rippleGroups[0]!.deviations[0]!.lines).toEqual([' |-a', '5|+c']);
  });

  it('番号の桁は hunk の中でいちばん大きい番号に揃え、文脈の行（" "）も番号を進める', () => {
    const long = { ...base, hunks: [{ id: 'h1', path: 'a/Order.kt', symbol: 'Order', lines: [' a', '-b', '+c', ' d'] }] };
    const r = buildNarrationInput({ base: long, hows, hunks: [hunk('h1', 'core', [1], 99)], symbols, edges, tours });
    expect(r.hunks[0]!.lines).toEqual([' 99| a', '   |-b', '100|+c', '101| d']);
  });

  it('コースは How の順で、題と「なぜ」と停留所を持つ。停留所は tours の順', () => {
    expect(input.courses.map((c) => [c.howId, c.title, c.why])).toEqual([[1, 'A', 'W']]);
    expect(input.courses[0]!.stops.map((s) => s.symbolId)).toEqual(['h1', 'r1', 'h2']);
  });

  it('停留所は差分の hunkId と、あれば呼ばれ方', () => {
    const [order] = input.courses[0]!.stops;
    expect(order).toEqual({ symbolId: 'h1', symbol: 'a.Order', path: 'a/Order.kt', test: false, hunkId: 'h1' });
  });

  // 2026-10-11: 停留所は差分だけ。差分の無い相手は停留所の related（触らないものの材料。文は書かせない）
  it('差分の無い相手は related（停留所の順、呼び出し元 in → 呼び出し先 out、名前順）。参照の辺は数えない', () => {
    expect(input.courses[0]!.related).toEqual([
      { of: 'h1', dir: 'in', symbol: 'c.Cart.total', path: 'c/Cart.kt' },
      { of: 'h1', dir: 'out', symbol: 'a.Policy.rateFor', path: 'a/Policy.kt' },
    ]);
  });

  // 2026-10-29: 説明タブの背景の「この PR の前からあるものは？」の候補。LLM はここから選ぶ（原則 3）
  it('前からあるものの候補は、停留所が呼んでいる差分の無い相手（related の out。呼んでいる側の in は入れない）と、この PR で消える宣言', () => {
    expect(input.existing).toEqual([
      { symbol: 'a.Policy.rateFor', path: 'a/Policy.kt', kind: 'function', removed: false },
      { symbol: 'a.Order.legacy', path: 'a/Order.kt', kind: 'function', removed: true },
    ]);
  });

  it('消える宣言を渡さなければ、前からあるものの候補は呼んでいる相手だけ', () => {
    const r = buildNarrationInput({ base, hows, hunks, symbols, edges, tours });
    expect(r.existing.map((e) => e.symbol)).toEqual(['a.Policy.rateFor']);
  });

  it('古い経路に差分の無い停留所が残っていても、停留所には入れない', () => {
    const old: Tour[] = [{ howId: 1, steps: [tours[0]!.steps[0]!, { symbolId: 'u1', call: 'Order → Policy.rateFor(String)' }, ...tours[0]!.steps.slice(1)] }];
    const r = buildNarrationInput({ base, hows, hunks, symbols, edges, tours: old });
    expect(r.courses[0]!.stops.map((s) => s.symbolId)).toEqual(['h1', 'r1', 'h2']);
  });

  it('追従の束の代表には束の id、テストの停留所には test: true', () => {
    const [, view, test] = input.courses[0]!.stops;
    expect(view).toMatchObject({ hunkId: 'r1', groupId: 'g1' });
    expect(test).toMatchObject({ hunkId: 'h2', test: true });
  });

  it('どの How にも入らなかった hunk の id を unassigned に入れる', () => {
    expect(input.unassigned).toEqual(['h3']);
  });

  it('How の無い tour は入れない', () => {
    const r = buildNarrationInput({ base, hows, hunks, symbols, edges, tours: [...tours, { howId: 9, steps: [] }] });
    expect(r.courses.map((c) => c.howId)).toEqual([1]);
  });
});

const fixtureRemoved = await removedDeclarations(changedFixtureFiles());

describe('buildNarrationInput（fixture）', () => {
  const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8')) as T;
  const labeled = read<{ hows: How[]; hunks: Array<Pick<Hunk, 'id' | 'kind' | 'hows'>> }>('expected/hows.json');
  const lnNew = new Map(read<Array<Pick<Hunk, 'id' | 'lnNew'>>>('expected/hunks.json').map((h) => [h.id, h.lnNew]));
  const input = buildNarrationInput({
    base: read<LlmInput>('expected/llm-input.json'),
    hows: labeled.hows,
    hunks: labeled.hunks.map((h) => ({ ...h, lnNew: lnNew.get(h.id)! })),
    symbols: read<Symbol[]>('expected/symbols-lsp.json'),
    edges: read<Edge[]>('expected/edges.json'),
    tours: read<Tour[]>('expected/tours.json'),
    removed: fixtureRemoved,
    flows: read<CallFlow[]>('expected/flows.json'),
  });

  it('流れ: 変わった後の呼び出しを呼ぶ順に「呼ぶ側: 呼び出しの式」で渡す', () => {
    expect(input.behaviors).toEqual([
      {
        id: 'f1',
        start: 'com.example.order.api.OrderController.apply',
        calls: [
          'OrderController.apply: useCase.execute(OrderId(id), body.discountCode)',
          'ApplyDiscountUseCase.execute: repository.find(id)',
          'ApplyDiscountUseCase.execute: order.applyDiscount(DiscountCommand(code))',
          'domain.Order: DiscountPolicy.rateFor(cmd.code)',
          'ApplyDiscountUseCase.execute: repository.save(order)',
          'OrderController.apply: repository.save(order)',
          'OrderController.apply: OrderResponse.from(order)',
        ],
      },
    ]);
  });

  it('前からあるものの候補: 呼んでいる相手はコースの順に 1 回ずつ（rateFor・Money.ZERO・save）、その後に消える Order.promo と getDiscount', () => {
    expect(input.existing.map((e) => [e.symbol.split('.').slice(-2).join('.'), e.kind, e.removed])).toEqual([
      ['DiscountPolicy.rateFor', 'function', false],
      ['Companion.ZERO', 'property', false],
      ['OrderRepository.save', 'function', false],
      ['Order.promo', 'property', true],
      ['Order.getDiscount', 'function', true],
    ]);
  });

  it('コース 7 本・停留所 29（差分の無い 4 か所は停留所にしない）、未帰属は Logger の 2 hunk と DISCOUNT_V2', () => {
    expect(input.courses).toHaveLength(7);
    expect(input.courses.flatMap((c) => c.stops)).toHaveLength(29);
    expect(input.unassigned).toHaveLength(3);
  });

  it('コース 3: Order → 束の代表 → テスト 2 本。差分の無い DiscountPolicy.rateFor は related', () => {
    const c3 = input.courses.find((c) => c.howId === 3)!;
    expect(c3.stops.map((s) => s.symbol.split('.').slice(-2).join('.'))).toEqual([
      'domain.Order',
      'OrderAdminView.discountField',
      'OrderTest.`applies the policy rate to subtotal`',
      'OrderTest.`keeps total when code is unknown`',
    ]);
    expect(c3.related.map((r) => [r.dir, r.symbol.split('.').slice(-2).join('.')])).toEqual([['out', 'DiscountPolicy.rateFor']]);
    expect(c3.stops[1]).toMatchObject({ groupId: 'g1' });
    expect(c3.stops.slice(2).every((s) => s.test)).toBe(true);
  });

  it('コース 5: execute が足した行で呼ぶ差分の無い OrderRepository.save と、通り道の Order が呼ぶ rateFor は related（find は変わらない行から呼ぶので入らない）。コース 4 はテストが呼ぶ Money.ZERO', () => {
    const c5 = input.courses.find((c) => c.howId === 5)!;
    expect(c5.related.map((r) => r.symbol.split('.').slice(-2).join('.'))).toEqual(['OrderRepository.save', 'DiscountPolicy.rateFor']);
    const c4 = input.courses.find((c) => c.howId === 4)!;
    expect(c4.related.map((r) => r.symbol.split('.').slice(-2).join('.'))).toEqual(['Companion.ZERO']);
  });

  it('execute の行は head の 15 行から（16 行が find、17 行が applyDiscount、18 行が save の呼び出し）', () => {
    const c5 = input.courses.find((c) => c.howId === 5)!;
    const execute = input.hunks.find((h) => h.id === c5.stops[0]!.hunkId)!;
    expect(execute.lines.map((l) => l.slice(0, 4))).toEqual(['  |-', '15|+', '16| ', '17|+', '18|+', '19| ', '20| ']);
    expect(execute.lines.slice(2, 5).map((l) => l.match(/(find|applyDiscount|save)\(/)?.[1])).toEqual(['find', 'applyDiscount', 'save']);
  });

  it('ゴールデン expected/llm-text-input.json と一致する', async () => {
    await expect(JSON.stringify(input, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/llm-text-input.json'));
  });
});
