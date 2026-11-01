// 差分の無い相手の引き出し（設計書 3.3。2026-10-11）の中身を引く純粋関数。開く・閉じる・↑↓ は reducer.rel.test
import { describe, expect, it } from 'vitest';
import { relAt, relHostLabel, relItems, relLayers } from '../src/rel.js';
import { GROUP_PREFIX } from '../src/map/graph.js';
import { fixtureAnalysis, fixtureWithNeighbors } from './fixture.js';

const a = fixtureAnalysis();
const idOf = (tail: string) => a.symbols.find((s) => s.fqName.endsWith(tail))!.id;
const REPO = 'src/main/kotlin/com/example/order/domain/OrderRepository.kt';
const POLICY = 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt';

describe('relItems / relLayers', () => {
  it('向きごとの相手。地図の帯の順、同じ層は名前順', () => {
    const b = fixtureWithNeighbors();
    const exec = b.symbols.find((s) => s.fqName.endsWith('ApplyDiscountUseCase.execute'))!.id;
    expect(relItems(b, exec, 'out').map((x) => x.name)).toEqual(['Clock.now', 'Money.plus', 'OrderId.of', 'OrderRepository.save']);
    expect(relItems(b, exec, 'in')).toEqual([]);
    const order = b.symbols.find((s) => s.fqName.endsWith('domain.Order'))!.id;
    expect(relLayers(b, order, 'in')).toEqual([{ layer: 'Application', n: 4 }]);
  });
});

describe('relAt（差分の無いファイルの行を出す相手）', () => {
  it('その行が中心の行（宣言）の相手を選ぶ。抜粋が重なっても中心の行が先', () => {
    // OrderRepository.kt: find の宣言は 4 行目、save は 5 行目。save の抜粋（3〜6 行目）は 4 行目も含む。
    // fixture の find は変わらない行からしか呼ばれず相手にならない（2026-10-12）ので、2026-10-11 までの解析にあった find を足して見る
    const b = structuredClone(a);
    const exec = idOf('ApplyDiscountUseCase.execute');
    b.symbols.push({ id: 'unchanged:find', fqName: 'com.example.order.domain.OrderRepository.find', path: REPO, layer: 'Domain', layerProvenance: 'config', kind: 'function', changed: false, edgesMeasured: true, excerpt: [{ start: 2, lines: ['', 'interface OrderRepository {', '    fun find(id: OrderId): Order?', '    fun save(order: Order)', '}'], centers: [4] }] });
    b.edges.push({ from: exec, to: 'unchanged:find', kind: 'call', crossesLayers: false, provenance: 'lsp' });
    expect(relAt(b, REPO, 4)).toMatchObject({ dir: 'out', sel: 'unchanged:find' });
    expect(relAt(b, REPO, 5)).toMatchObject({ dir: 'out', sel: idOf('OrderRepository.save') });
    expect(relAt(a, POLICY, 9)).toEqual({ host: idOf('domain.Order'), dir: 'out', sel: idOf('DiscountPolicy.rateFor') });
  });

  it('中心でなくても同じファイルの相手を選ぶ。どの相手にも無いファイルは null', () => {
    expect(relAt(a, POLICY, 2)).toMatchObject({ sel: idOf('DiscountPolicy.rateFor') });
    expect(relAt(a, 'README.md', 1)).toBeNull();
  });
});

describe('relHostLabel', () => {
  it('シンボルは短い名前、束は件数', () => {
    expect(relHostLabel(a, idOf('ApplyDiscountUseCase.execute'))).toBe('ApplyDiscountUseCase.execute');
    const g = a.hunks.find((h) => h.group)!.group!;
    expect(relHostLabel(a, GROUP_PREFIX + g.representative)).toBe(`追従 ${g.members.length} 件`);
  });
});
