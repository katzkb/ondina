## 概要

注文に割引コードを適用できるようにする。`Order` が割引額を自分で持ち、計算をドメインに閉じる。

## 変更点

- `Order.getDiscount()` と `promo` を消し、`discount` プロパティと `applyDiscount(cmd)` を足した
- `ApplyDiscountUseCase.execute(id, code)` で割引を適用して保存する
- `POST /orders/{id}/discount` でコードを受け取る
- `orders` テーブルに `discount` 列を足した（V421）
- キャッシュ層を横断的に更新し、割引後の合計が古い値で返らないようにした
- `getDiscount()` を読んでいた箇所を `discount` に置き換えた
