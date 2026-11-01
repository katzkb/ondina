// 元になった変更の候補（設計書 8 章 1）: 宣言の追加・削除・シグネチャ変更を含む hunk と、その R / A。
import { describe, expect, it } from 'vitest';
import { extractHunks } from '../src/hunks/extract.js';
import { parseKotlin } from '../src/hunks/kotlin-parser.js';
import { coreCandidate } from '../src/ripple/candidates.js';
import { fixtureFile } from './fixture.js';

const MAIN = 'src/main/kotlin/com/example';

async function candidateOf(relPath: string, fqName: string) {
  const file = fixtureFile(relPath);
  const hunk = (await extractHunks(file)).find((h) => h.symbolFqName === fqName);
  if (hunk === undefined) throw new Error(`hunk が無い: ${fqName}`);
  return coreCandidate(hunk, await parseKotlin(file.before ?? ''), await parseKotlin(file.after ?? ''));
}

describe('coreCandidate', () => {
  it('Order: 主コンストラクタの val 引数も宣言として数え、R = {promo, getDiscount}、A = {discount, applyDiscount}', async () => {
    const c = await candidateOf(`${MAIN}/order/domain/Order.kt`, 'com.example.order.domain.Order');
    expect(c).toEqual({
      removed: [
        { name: 'promo', kind: 'parameter' },
        { name: 'getDiscount', kind: 'function' },
      ],
      added: [
        { name: 'discount', kind: 'parameter' },
        { name: 'applyDiscount', kind: 'function' },
      ],
    });
  });

  it('execute(): 引数を足したシグネチャ変更は R と A の両方に入る', async () => {
    const c = await candidateOf(`${MAIN}/order/application/ApplyDiscountUseCase.kt`, 'com.example.order.application.ApplyDiscountUseCase.execute');
    expect(c).toEqual({ removed: [{ name: 'execute', kind: 'function' }], added: [{ name: 'execute', kind: 'function' }] });
  });

  it('OrderResponse: DTO の val 引数追加は A だけ', async () => {
    const c = await candidateOf(`${MAIN}/order/api/OrderResponse.kt`, 'com.example.order.api.OrderResponse');
    expect(c).toEqual({ removed: [], added: [{ name: 'discount', kind: 'parameter' }] });
  });

  it('DiscountCommand: 新規クラスは A にクラス名と val 引数', async () => {
    const c = await candidateOf(`${MAIN}/order/domain/DiscountCommand.kt`, 'com.example.order.domain.DiscountCommand');
    expect(c).toEqual({
      removed: [],
      added: [
        { name: 'DiscountCommand', kind: 'class' },
        { name: 'code', kind: 'parameter' },
      ],
    });
  });

  it('本体だけ変わった関数（CartSummary.total / OrderRepositoryImpl.save）は候補でない', async () => {
    expect(await candidateOf(`${MAIN}/cart/CartSummary.kt`, 'com.example.cart.CartSummary.total')).toBeUndefined();
    expect(await candidateOf(`${MAIN}/order/infra/OrderRepositoryImpl.kt`, 'com.example.order.infra.OrderRepositoryImpl.save')).toBeUndefined();
  });

  it('ファイル hunk（import の変更）は候補でない', async () => {
    expect(await candidateOf(`${MAIN}/order/api/OrderController.kt`, `${MAIN}/order/api/OrderController.kt`)).toBeUndefined();
  });
});
