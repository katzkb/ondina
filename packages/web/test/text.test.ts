// 説明タブの文の見せ方（設計書 3.1）。長い段落を句点で切り、1 文 1 行にする。
import { describe, expect, it } from 'vitest';
import { sentences } from '../src/text.js';

describe('sentences', () => {
  it('句点で切り、句点は文の側に残す', () => {
    expect(sentences('一つ目。二つ目。')).toEqual(['一つ目。', '二つ目。']);
  });

  it('句点の無い最後の文も 1 文。前後の空白は落とし、空の文は出さない', () => {
    expect(sentences(' 一つ目。 二つ目')).toEqual(['一つ目。', '二つ目']);
    expect(sentences('')).toEqual([]);
  });

  it('括弧の中の句点では切らない', () => {
    expect(sentences('置き換えた（うち 1 か所は別。残りは同じ）。次の文。')).toEqual(['置き換えた（うち 1 か所は別。残りは同じ）。', '次の文。']);
    expect(sentences('「a。b」と書く。次。')).toEqual(['「a。b」と書く。', '次。']);
  });

  it('fixture の方針は 5 文', () => {
    const approach =
      'Order のコンストラクタ引数を promo から var discount に替え、DiscountCommand を受ける applyDiscount() を足して total() を subtotal - discount にした。orders に discount 列を足し、OrderRepositoryImpl の save/find の SQL と Order 生成に discount を通した。ApplyDiscountUseCase.execute() に code 引数を足して applyDiscount() 呼び出しと repository.save() を入れ、OrderController.apply() は @RequestBody ApplyDiscountRequest からコードを取って execute() に渡し、さらに repository.save() も直接呼んでいる。3 つのレスポンス DTO に discount を足し、getDiscount() の呼び出し 22 箇所を discount 参照に置き換えた（うち PromoService.apply() は discount が Money.ZERO 超のときだけ使い、それ以外は legacyPromo(order) にする形）。Order / UseCase / Repository にテストを足した。';
    expect(sentences(approach)).toHaveLength(5);
  });
});
