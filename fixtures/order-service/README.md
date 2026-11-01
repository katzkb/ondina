# fixtures/order-service

設計書 17 章のサンプル PR「`Order.getDiscount()` と `promo` を消して `discount` プロパティと `applyDiscount()` に置き換える」を、
`base/`（マージ前）と `head/`（マージ後）の 2 ツリーで再現したもの。`docs/prototype.html` の `H` 配列に対応する。

- パスは `ondina.config.yaml`（設計書 11 章）の `sourceRoots` に従う: `src/main/kotlin/com/example/...`、`src/test/kotlin/...`、`src/main/resources/db/migration/`。この yaml は `base/` の外に 1 つだけ置き、`build-repo.sh` がリポジトリ直下にコピーする（両ブランチに入る）。`packages/core/test/config.test.ts` の入力でもある
- Gradle でビルドできる形（`build.gradle.kts`）にしてあるが、ビルドは前提にしない。M2 で kotlin-lsp を起動するときに使う
- `expected/hunks.json` は `@ondina/core` の `extractAllHunks` の出力のゴールデン。`packages/core/test/extract.fixture.test.ts` で比較する。意図して出力を変えたときは `pnpm vitest run -u` で更新する
- `expected/tokens.json` は Shiki 字句トークン（hunk id → `TokenLine[]`）のゴールデン。`packages/core/test/highlight.fixture.test.ts` で比較する。更新方法は同じ。prototype の `TOK` との一致は目視で確認したもので（2026-09-16。既定色が `"text"` ではなく `null` である以外は一致）、自動テストにはしていない
- `expected/ripples.json` は追従検出（設計書 8 章）のゴールデン（hunk id → kind / kindProvenance と `RippleGroup[]`）。`packages/core/test/ripple.fixture.test.ts` で比較する。更新方法は同じ。核 1（`Order`）/ 追従 23 / テスト 7 / 未帰属 17。束は 1 つ: members 22、逸脱 1（`PromoService.apply`、代表の形と 13 語差）、近い逸脱 0、代表は path 順で最初の `admin/OrderAdminView.discountField`
- `pr-body.md` は作者説明（PR 本文）の見本。裏付けの無い一文（キャッシュ層）を 1 つ含み、`claims` の `backed: false` を確かめる
- `expected/llm-input.json` は LLM への入力 JSON（設計書 10.1 の今回の範囲。`buildLlmInput`）のゴールデン。`packages/core/test/label.input.test.ts` で比較する。更新方法は同じ
- `llm/output.json` / `llm/input-previous.json` / `llm/output-previous.json` は既定の LLM コマンド（`claude -p …`）で記録した生の入出力。**テストは LLM を起動せず、これを読む**。採り直しは `pnpm build` のあと `sh fixtures/order-service/scripts/record-llm.sh <dir>`（`LLM_COMMAND` で別のコマンドも可）。2 回目は 1 回目の How の id を回転させた「前回の解析」を渡し、id が維持されるかを見る
- `llm/text-output.json` は 2 回目の LLM（文を書く。入口の説明とコースの案内文。design 10.4）の記録。採り直しは `pnpm build` のあと `node fixtures/order-service/scripts/record-llm-text.mjs`（`LLM_COMMAND` で別のコマンドも可）。入力はゴールデン `expected/llm-text-input.json`（core の `narration.input.test.ts` が 1 回目の検証結果と経路のゴールデンから組む）なので、言語サーバーも git リポジトリも要らない。検証後のゴールデンは `expected/text.json`（web のテスト用 fixture が `tours` と `summary` に使う）
- `expected/hows.json` は記録した出力を検証（設計書 5.4）に通した結果のゴールデン（`hows`、hunk id → kind / kindProvenance / hows、`summary`、`claims`、`info`）。`packages/core/test/label.verify.test.ts` で比較する
- `scripts/build-repo.sh <dir>` で `main` / `feature/discount` の 2 ブランチを持つ git リポジトリを作れる（CLI の worktree 連携の確認用）
  ```sh
  sh fixtures/order-service/scripts/build-repo.sh /tmp/order-service
  pnpm build
  (cd /tmp/order-service && node <ondina>/packages/cli/dist/index.js analyze --base main --head feature/discount)
  # → /tmp/order-service/.ondina/local/<headSha>.json（各 hunk に tokens 入り）。worktree は .ondina/local/worktrees/{base,head}
  (cd /tmp/order-service && node <ondina>/packages/cli/dist/index.js serve)
  # → http://127.0.0.1:4177/ で D ビュー。閲覧状態は .ondina/local/state/<headSha>.json に残る
  # 下書きを流し込む: (cd /tmp/order-service && node <ondina>/packages/cli/dist/index.js comments add --from comments.json)
  ```

## prototype の hunk との対応

| prototype | ファイル（`src/main/kotlin/com/example/` 以下） | 変更 | 期待 hunk |
|---|---|---|---|
| h1 核 | `order/domain/Order.kt` | `promo` → `discount`、`getDiscount()` → `applyDiscount()`、`total()` | `Order`（class 全体。削除と追加が別宣言にまたがるので格上げ） |
| h2 核 | `order/domain/DiscountCommand.kt` | 新規 | `DiscountCommand.kt`（package 行）、`DiscountCommand` |
| h8 核 | `order/application/ApplyDiscountUseCase.kt` | `execute()` のシグネチャと本体 | `ApplyDiscountUseCase.kt`（import）、`execute()` |
| h3 追従 23 件 | 22 ファイル。prototype の代表は `cart/CartSummary.kt`（実装は path 順で `admin/OrderAdminView.kt`）、逸脱 `promo/PromoService.kt`、`invoice/InvoiceBuilder.kt` は 2 箇所 | `order.getDiscount()` → `order.discount` | 変更された関数ごとに 1 hunk。`ripples.json` で 1 つの束（パターン `getDiscount() → discount`） |
| h11 テスト | `src/test/.../order/domain/OrderTest.kt` | テスト 2 件追加 | 追加された関数ごとに 1 hunk |
| h12 テスト | `src/test/.../order/application/ApplyDiscountUseCaseTest.kt` | 既存テストの `execute(id)` → `execute(id, code)`、テスト 1 件追加 | 2 hunk（prototype は追加分の 1 件のみ） |
| h4 / h14 核 | `order/infra/OrderRepositoryImpl.kt` | `save()` の SQL と `find()` の SQL・マッピング | `save()`、`find()`（find は 2 箇所の変更が 1 hunk） |
| h5 核 | `src/main/resources/db/migration/V421__discount.sql` | 新規 | ファイル単位 1 hunk |
| h13 テスト | `src/test/.../order/infra/OrderRepositoryImplTest.kt` | テスト 2 件と private ヘルパ追加 | 3 hunk |
| h6 核 | `order/api/OrderController.kt` | `apply()` に `@RequestBody`、`repository.save()` | `OrderController.kt`（import）、`apply()`（`@PostMapping` を含む） |
| h7 追従 3 件 | `order/api/OrderResponse.kt`（代表）、`OrderSummaryResponse.kt`、`OrderDetailResponse.kt` | `discount` フィールド追加 | class 全体（コンストラクタと companion の変更が統合される） |
| h9 未帰属 | `common/Logger.kt` | `format()` にタイムスタンプ | `Logger.kt`（import）、`format()` |
| h10 未帰属 | `config/FeatureFlags.kt` | `DISCOUNT_V2` 追加 | `DISCOUNT_V2`（property。prototype は object 全体） |
| 未変更 | `order/domain/DiscountPolicy.kt` | — | ツアーのベースライン（`rateFor()`） |
| （prototype に無い） | `order/api/ApplyDiscountRequest.kt` | 新規。h6 が参照する | `ApplyDiscountRequest.kt`、`ApplyDiscountRequest` |

変更ファイルは 37（追従 22、核 6、追従 DTO 3、テスト 3、未帰属 2、新規リクエスト 1）、hunk は 48。
