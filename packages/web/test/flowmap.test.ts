// 流れの地図（見本 flow5）の純粋関数: 段ごとのステップ・止まるステップ・箱・配置・ステップのコード・流れの外の変更。fixture の apply の流れで見る
import ELK from 'elkjs/lib/elk.bundled.js';
import { describe, expect, it } from 'vitest';
import { flowFacts } from '../src/map/flowmap/boxes.js';
import { stepCode } from '../src/map/flowmap/code.js';
import { flowLayout, returnPath } from '../src/map/flowmap/layout.js';
import { outsideOf } from '../src/map/flowmap/outside.js';
import { carryStep, curStep, inCourse, flowSteps, nextStop, pickFlow, statusCounts, stopsOf } from '../src/map/flowmap/steps.js';
import { fixtureAnalysis } from './fixture.js';

const a = fixtureAnalysis();
const flow = a.flows![0]!;
const name = (id: string) => a.symbols.find((s) => s.id === id)!.fqName.split('.').slice(-2).join('.');
const line = (s: { dir: string; calls: Array<{ to: string }> }) => `${s.dir === 'call' ? '→' : '↩'} ${name(s.calls[0]!.to)}`;

describe('flowSteps', () => {
  it('① は変わる前の呼び出しだけ。呼ぶ → 中の呼び出し → 戻る の順', () => {
    expect(flowSteps(flow, 1).map(line)).toEqual([
      '→ OrderController.apply',
      '→ ApplyDiscountUseCase.execute',
      '→ OrderRepositoryImpl.find',
      '↩ OrderRepositoryImpl.find',
      '↩ ApplyDiscountUseCase.execute',
      '→ api.OrderResponse',
      '↩ api.OrderResponse',
      '↩ OrderController.apply',
    ]);
  });

  it('② は全部の呼び出し（save が 2 回）。③ は変わった後の呼び出しで、この流れでは ② と同じ', () => {
    const two = flowSteps(flow, 2);
    expect(two.filter((s) => s.dir === 'call').map((s) => name(s.calls[0]!.to))).toEqual([
      'OrderController.apply',
      'ApplyDiscountUseCase.execute',
      'OrderRepositoryImpl.find',
      'domain.Order',
      'DiscountPolicy.rateFor',
      'OrderRepositoryImpl.save',
      'OrderRepositoryImpl.save',
      'api.OrderResponse',
    ]);
    expect(flowSteps(flow, 3).map((s) => s.calls[0]!.key)).toEqual(two.map((s) => s.calls[0]!.key));
    expect(statusCounts(flow)).toEqual({ same: 2, changed: 1, added: 4, removed: 0 });
  });

  it('段を替えても同じ呼び出しの同じ向きに留まる。新しい段に無い呼び出しは親の呼び出しへ', () => {
    const one = flowSteps(flow, 1);
    const two = flowSteps(flow, 2);
    const find = one.findIndex((s) => s.dir === 'ret' && name(s.calls[0]!.to) === 'OrderRepositoryImpl.find') + 1;
    const to = carryStep(one, two, find);
    expect(line(two[to - 1]!)).toBe('↩ OrderRepositoryImpl.find');
    const rate = two.findIndex((s) => name(s.calls[0]!.to) === 'DiscountPolicy.rateFor') + 1;
    expect(line(one[carryStep(two, one, rate) - 1]!)).toBe('→ ApplyDiscountUseCase.execute');
  });
});

describe('止まるステップ', () => {
  it('コースの範囲は ② だけ。そのコースの呼び出しとその戻りだけで止まり、次・前はそこを渡る', () => {
    const two = flowSteps(flow, 2);
    const stops = stopsOf(two, 2, 5);
    expect(stops.map((i) => line(two[i - 1]!))).toEqual(['→ domain.Order', '↩ domain.Order', '→ OrderRepositoryImpl.save', '↩ OrderRepositoryImpl.save']);
    expect(stopsOf(two, 1, 5)).toHaveLength(two.length);
    expect(curStep(stops, 0)).toBe(stops[0]);
    expect(nextStop(stops, stops[0]!, 1)).toBe(stops[1]);
    expect(nextStop(stops, stops[3]!, 1)).toBe(stops[3]);
    expect(nextStop(stops, stops[0]!, -1)).toBe(stops[0]);
  });

  it('流れを選んでいなければ、選んだコースが通る最初の流れ', () => {
    expect(pickFlow(a, null, null)?.id).toBe('f1');
    expect(pickFlow(a, 'nope', 5)?.id).toBe('f1');
    expect(pickFlow({ flows: [] }, null, null)).toBeNull();
  });
});

describe('箱と配置', () => {
  const facts = flowFacts(a, flow);

  it('箱はクラス。帯は設定の層の順、状態は hunk から', () => {
    expect(facts.boxes.map((b) => [b.name, b.band, b.diff])).toEqual([
      ['OrderController', 'API', 'changed'],
      ['ApplyDiscountUseCase', 'Application', 'changed'],
      ['OrderRepositoryImpl', 'Infrastructure', 'changed'],
      ['Order', 'Domain', 'changed'],
      ['DiscountPolicy', 'Domain', 'none'],
      ['OrderResponse', 'API', 'changed'],
    ]);
    expect(facts.bands).toEqual(['API', 'Application', 'Domain', 'Infrastructure']);
    const repo = facts.boxes.find((b) => b.name === 'OrderRepositoryImpl')!;
    expect(repo.members.map((m) => [m.name, m.stages[1]])).toEqual([
      ['find', true],
      ['save', false],
    ]);
    expect(facts.boxes.find((b) => b.name === 'DiscountPolicy')!.used[1]).toBe(false);
  });

  it('elkjs で組むと、帯の順に上から並び、箱の間は 100px 以上。呼び出しごとに線が 1 本（save の 2 本は別の線）', async () => {
    const L = await flowLayout(flow, facts, new ELK());
    const y = (n: string) => L.boxes.get(facts.boxes.find((b) => b.name === n)!.id)!.y;
    expect(y('OrderController')).toBeLessThan(y('ApplyDiscountUseCase'));
    expect(y('ApplyDiscountUseCase')).toBeLessThan(y('Order'));
    expect(y('Order')).toBeLessThan(y('OrderRepositoryImpl'));
    expect(L.bands.map((b) => b.name)).toEqual(facts.bands);
    expect(L.edges.size).toBe(7);
    const saves = flowSteps(flow, 2).filter((s) => s.dir === 'call' && name(s.calls[0]!.to) === 'OrderRepositoryImpl.save');
    expect(L.edges.get(saves[0]!.calls[0]!.key)).not.toEqual(L.edges.get(saves[1]!.calls[0]!.key));
    const rects = [...L.boxes.values()];
    for (const p of rects) for (const q of rects) if (p !== q && Math.abs(p.y - q.y) < 1) expect(Math.abs(p.x - q.x)).toBeGreaterThanOrEqual(Math.min(p.w, q.w) + 100 - 1);
    expect(L.entry).toHaveLength(2);
  });

  it('戻りは同じ道を逆に、9px ずらす', () => {
    expect(
      returnPath([
        [0, 0],
        [0, 50],
        [80, 50],
      ]),
    ).toEqual([
      [80, 59],
      [9, 59],
      [9, 0],
    ]);
  });
});

describe('stepCode', () => {
  const two = flowSteps(flow, 2);
  const exec = two.find((s) => name(s.calls[0]!.to) === 'ApplyDiscountUseCase.execute')!.calls[0]!;

  it('② の変わった呼び出しは hunk の消した行と足した行を光らせる', () => {
    const c = stepCode(a, exec, 2)!;
    expect(c.path).toBe('src/main/kotlin/com/example/order/api/OrderController.kt');
    expect(c.rows.filter((r) => r.hot).map((r) => `${r.k}${r.text.trim()}`)).toEqual(['-val order = useCase.execute(OrderId(id))', '+val order = useCase.execute(OrderId(id), body.discountCode)']);
  });

  it('① は変わる前の行、③ は変わった後の行だけ', () => {
    expect(stepCode(a, exec, 1)!.rows.find((r) => r.hot)!.text.trim()).toBe('val order = useCase.execute(OrderId(id))');
    expect(stepCode(a, exec, 3)!.rows.find((r) => r.hot)!.text.trim()).toBe('val order = useCase.execute(OrderId(id), body.discountCode)');
    expect(stepCode(a, exec, 3)!.rows.every((r) => r.k === ' ')).toBe(true);
  });

  it('差分の無い行（find）は変わった後のファイルの行。根は入口の hunk の頭', () => {
    const find = two.find((s) => name(s.calls[0]!.to) === 'OrderRepositoryImpl.find')!.calls[0]!;
    expect(stepCode(a, find, 2)!.rows.find((r) => r.hot)!.text.trim()).toBe('val order = repository.find(id) ?: throw OrderNotFound(id)');
    expect(stepCode(a, flow.root, 1)!.rows.map((r) => r.text.trim())).toEqual(['@PostMapping("/orders/{id}/discount")', 'fun apply(@PathVariable id: String): OrderResponse {', 'val order = useCase.execute(OrderId(id))', 'return OrderResponse.from(order)']);
  });
});

describe('outsideOf', () => {
  it('流れに乗らない差分。追従グループは 1 行、テストは数だけ', () => {
    const { items, tests } = outsideOf(a, a.flows!);
    expect(items.some((x) => x.label.includes('→'))).toBe(true);
    expect(items.find((x) => x.label === 'DiscountCommand.kt')).toMatchObject({ sub: 'DiscountCommand', diff: 'added' });
    expect(items.find((x) => x.label === 'OrderController.kt')).toMatchObject({ sub: 'シンボルの外の行（import など）', diff: 'changed' });
    expect(items.map((x) => x.hunkId)).not.toContain(flow.root.to);
    expect(tests.n).toBeGreaterThan(0);
  });
});


// 筋書きのある流れ（fixture の apply の流れに story を手で付ける。木は 根 → execute → [find, Order → rateFor, save]、根 → [save, OrderResponse]）
describe('筋書きのある流れ', () => {
  const calls = [...(function* walk(c: typeof flow.root): Generator<typeof flow.root> {
    yield c;
    for (const k of c.kids) yield* walk(k);
  })(flow.root)];
  const at = (n: string, k = 0) => calls.filter((c) => name(c.to) === n)[k]!.key;
  const story: NonNullable<typeof flow.story> = [
    { title: '入口から注文を取り出す', titleProvenance: 'llm', calls: [at('OrderController.apply'), at('ApplyDiscountUseCase.execute'), at('OrderRepositoryImpl.find')] },
    { title: '注文に割引を当てる', titleProvenance: 'llm', calls: [at('domain.Order'), at('DiscountPolicy.rateFor')] },
    { title: 'まとめに入らなかった呼び出し 2 個', titleProvenance: 'ast', calls: [at('OrderRepositoryImpl.save', 0), at('OrderRepositoryImpl.save', 1)] },
  ];
  const storied = { ...flow, story };
  const names = (s: { calls: Array<{ to: string }> }) => s.calls.map((c) => name(c.to));

  it('② は筋書きのステップ。呼び出しは呼ぶ順で、番号は ② を深さ優先で歩いた呼ばれる順。戻りのステップは無い', () => {
    const two = flowSteps(storied, 2);
    expect(two.map((s) => [s.i, s.dir, s.title?.text, s.title?.provenance, s.nums])).toEqual([
      [1, 'call', '入口から注文を取り出す', 'llm', [1, 2, 3]],
      [2, 'call', '注文に割引を当てる', 'llm', [4, 5]],
      [3, 'call', 'まとめに入らなかった呼び出し 2 個', 'ast', [6, 7]],
    ]);
    expect(names(two[0]!)).toEqual(['OrderController.apply', 'ApplyDiscountUseCase.execute', 'OrderRepositoryImpl.find']);
  });

  it('① は段にある呼び出しだけに絞り、空のステップを落として番号を振り直す。③ は ② と同じ', () => {
    const one = flowSteps(storied, 1);
    expect(one.map((s) => [s.i, s.nums, s.title?.text])).toEqual([[1, [1, 2, 3], '入口から注文を取り出す']]);
    expect(flowSteps(storied, 3).map((s) => s.calls.map((c) => c.key))).toEqual(flowSteps(storied, 2).map((s) => s.calls.map((c) => c.key)));
  });

  it('story の無い流れは今までどおり（呼び出し 1 つ、呼ぶ・戻る）', () => {
    const plain = flowSteps(flow, 2);
    expect(plain.every((s) => s.calls.length === 1 && s.nums.length === 1 && s.title === undefined)).toBe(true);
    expect(plain.map((s) => s.dir).filter((d) => d === 'ret')).toHaveLength(8);
  });

  it('inCourse はどれかの呼び出しが範囲に入れば真。止まるのはそのステップ、鍵の集合でも同じ', () => {
    const two = flowSteps(storied, 2);
    expect(two.map((s) => inCourse(s, 5))).toEqual([false, true, true]);
    expect(stopsOf(two, 2, 5)).toEqual([2, 3]);
    expect(stopsOf(two, 2, new Set([at('OrderRepositoryImpl.find')]))).toEqual([1]);
  });

  it('段を替えるとき、同じ呼び出しを含むステップへ。新しい段に無ければ親の呼び出しのステップへ', () => {
    const one = flowSteps(storied, 1);
    const two = flowSteps(storied, 2);
    expect(carryStep(two, one, 1)).toBe(1);
    expect(carryStep(one, two, 1)).toBe(1);
    // ② の rateFor（ステップ 2 の先頭は Order）は ① に無い → 親の execute を通る ① のステップ 1
    expect(carryStep(two, one, 2)).toBe(1);
    expect(carryStep(two, one, 3)).toBe(1);
  });
});
