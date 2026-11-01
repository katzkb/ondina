[日本語](ja/wording.md)

# Japanese wording rules for the product

These rules apply to Japanese text in ondina's screens, CLI, and LLM instructions. AI agents and people must read this document before adding or changing wording.

Lint (`pnpm lint`) reports errors for some of these rules. The rules are in `eslint-rules/wording.js`. Lint also runs in CI. Even if lint passes, change sentences that do not follow this document.

## Scope

- Buttons, headings, guidance, errors, and the keyboard shortcut list on screens (`packages/web/src`)
- CLI (`packages/cli/src`) messages and help
- Messages from core (`packages/core/src`) and LLM instructions (`*/prompt.ts`)

Tests and comments are outside the scope.

## Use sentence endings by text type

| Type | Ending | Example |
|---|---|---|
| Buttons, headings, labels, chips | A noun phrase or 「〜する」 | 閉じる、問題なし |
| Notices, empty states, errors | です・ます | 解析がまだありません。 |
| Explanations, hints | です・ます | 承認はいつでも押せます。 |
| CLI messages | です・ます | 引数は指定できません |
| CLI help descriptions | 「〜する」 | ローカル UI を起動する |
| Text written by the LLM | Plain form | 在庫が足りなければ引かない。 |

Do not add 「。」 to buttons or labels. Lint treats sentences with 「。」 or ending in 「〜ない」 as notices.

Use plain form for text written by the LLM (guidance and the guide's answers). Write instructions and examples in plain form too.

## Use established expressions

Avoid replacing English words one by one with Japanese. Use established expressions from Japanese software.

| Do not use | Use |
|---|---|
| 知らないコマンド | 'foo' というコマンドはありません |
| 捨てました | 除外しました |
| 飛ばしました | スキップしました |
| 起こさない（サーバー） | 起動しない |
| 答えませんでした | 応答がありませんでした |
| 版 | バージョン |
| 打ち直す | 実行し直す |
| 測れていない | 取得できていない（ラベルは「未取得」） |
| 見たとしてマーク | 見た印を付ける |
| 〜の形ではありません | 〜の形式ではありません |

`WORDS` in `eslint-rules/wording.js` is the source of truth for words that lint reports as errors. Include the replacement in the error message.

For words outside the table, consider the following in order.

1. Do not start from the original English word. Think about what Japanese software calls the same operation
2. Do not follow English sentence structure. Rephrase, for example, 「〜を判断する場所」 as 「〜を考えるときに見ます」
3. Write 「ない」「もの」「こと」 in hiragana
4. Use the same word for the same operation. Use 「編集」 for editing and 「削除」 for deletion

## What to call follow-on groups (bundles of the same rewrite) on screen

Design doc terms differ from on-screen wording. Keep code identifiers in the design doc's terminology.

| Design doc term | On-screen wording |
|---|---|
| 代表（representative） | サンプル |
| 逸脱（deviation） | 差異あり |
| 近い逸脱（near） | わずかな差異 |

Do not show the distance from the representative (word count) on screen. Show slight differences in red.

## On-screen wording kept for now

The following words are used as-is on screen. Whether to rephrase them will be decided separately.

- 核、追従、未帰属、絡み、How
- 帰属、閲覧 in the top bar
- 停留所、入口、締め、差分のない相手

## How to add exceptions

For a line that cannot follow the rules, disable lint for that line and state the reason. Do not disable the entire rule.

```ts
// eslint-disable-next-line ondina/wording-endings -- コマンドとオプションの説明は「〜する」の形が決まり
export const usage = `...`;
```

The sentence-ending rule is disabled for LLM instructions in `eslint.config.js`. This covers `packages/core/src/*/prompt.ts` and `packages/core/src/ticket/choice.ts`. The rule for literal translations remains enabled.

## When adding words

When you find a new expression that reads like a literal translation, fix it as follows.

1. Add the word and its replacement to `WORDS` in `eslint-rules/wording.js`
2. Add failing and passing examples to `eslint-rules/wording.test.js`
3. Fix existing wording flagged by `pnpm lint`
4. Decide whether to include it in this document's table. Include only frequently used words
