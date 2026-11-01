// @ts-check
// 製品の日本語の決まり（docs/wording.md）を lint で守らせる。画面・CLI・LLM への指示文の文字列を見る（コメントとテストは見ない）。
// 直訳調の語の表はこのファイルが正。語を足すときは、置き換え先を書き、wording.test.js に止める例を足す。

/** @typedef {import('eslint').Rule.RuleModule} RuleModule */
/** @typedef {import('eslint').Rule.Node} Node */

/** 直訳調の語と置き換え先（docs/wording.md） */
export const WORDS = [
  { re: /知らな/, say: '「知らない」は「不明な」か「〜はありません」にする' },
  { re: /飛ば/, say: '「飛ばす」は「スキップする」か「〜しない」にする' },
  { re: /捨て/, say: '「捨てる」は「除外する」にする' },
  { re: /起こ[さすし]/, say: '「（サーバーを）起こす」は「起動する」にする' },
  { re: /で答えませんでした|が答えなかった/, say: '「答えない」は「応答がない」にする' },
  { re: /打ち直/, say: '「打ち直す」は「実行し直す」にする' },
  { re: /採[りっ]/, say: '「採る・採り直す」は「取得する」「やり直す」にする' },
  { re: /組み立て直|組め|組んで/, say: '「組み立て直す」は「ビルドし直す」、「（地図を）組む」は「作る」にする' },
  { re: /測[れっらりる]/, say: '「測れない」は文なら「取得できない」、ラベル・チップなら「未取得」にする' },
  { re: /版/, say: '「版」は「バージョン」にする' },
  { re: /辺/, say: '「辺」は「線」か「関連」にする' },
  { re: /無(?:い|く|け|し|さ|かっ)/, say: '「無い」はひらがなで「ない」と書く' },
  { re: /(?<![一-鿿])物(?![一-鿿])/, say: '「物」はひらがなで「もの」と書く' },
  { re: /送信済(?!み)/, say: '「送信済」は「送信済み」と書く' },
  { re: /としてマーク|をマーク/, say: '「マークする」は「印を付ける」にする' },
  { re: /形ではありません|形が違います/, say: '「〜の形ではありません」は「〜の形式ではありません」にする' },
  { re: /は取りません/, say: '「引数は取りません」は「引数は指定できません」にする' },
  { re: /代表/, say: '同じ書き換えの束の「代表」は、画面では「サンプル」と呼ぶ' },
  { re: /逸脱/, say: '同じ書き換えの束の「逸脱」は、画面では「差異あり」（近いものは「わずかな差異」）と呼ぶ' },
  { re: /語差/, say: '「n 語差」の語の数は画面に出さない' },
  { re: /命令形/, say: 'LLM に「命令形」と指示しない（日本語では「〜せよ」になる）。「〜する」の形で、と書く' },
  { re: /語以内/, say: '日本語の長さは「語」で数えない。「字」で書く' },
  { re: /ラベリング/, say: '「ラベリング」は「目的ごとの分け方」にする' },
  { re: /意味トークン/, say: '「意味トークン」は「意味の色分け」にする' },
  { re: /裏で/, say: '「裏で」は「バックグラウンドで」にする' },
];

/** 「です・ます」の文末 */
const POLITE = /(?:ます|ません|ました|ましょう|でした|です|ください|でしょう)$/;
/** 常体の文末（動詞・形容詞・助動詞の終わり）。体言止め・括弧・記号は通す */
const PLAIN = /(?:[うくぐすつぬぶむるいた]|だ)$/;
/** 「。」の無い文字列でも、これで終われば文（ボタン名ではない） */
const PLAIN_TAIL = /(?:ない|なかった)$/;
const CLOSERS = /[）)」』\s]+$/;

/**
 * 文言を持つ節の、本文の切れ端を返す。テンプレートは式の間の切れ端ごと（式の中身は分からないので見ない）。
 * @param {Node} node
 * @returns {string[]}
 */
function pieces(node) {
  if (node.type === 'Literal') return typeof node.value === 'string' ? [node.value] : [];
  if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked ?? q.value.raw);
  // @ts-expect-error JSXText は estree の型に無い
  if (node.type === 'JSXText') return [String(node.value)];
  return [];
}

/**
 * @param {(context: import('eslint').Rule.RuleContext, node: Node, text: string, last: boolean) => void} check
 * @returns {RuleModule['create']}
 */
function visit(check) {
  return (context) => {
    /** @param {Node} node */
    const run = (node) => {
      const ps = pieces(node);
      ps.forEach((p, i) => check(context, node, p, i === ps.length - 1));
    };
    return { Literal: run, TemplateLiteral: run, JSXText: run };
  };
}

/** @type {Record<'wording-words' | 'wording-endings', RuleModule>} */
export const rules = {
  'wording-words': {
    meta: {
      type: 'suggestion',
      docs: { description: '直訳調の語を使わない（docs/wording.md）' },
      messages: { word: '直訳調の「{{word}}」: {{say}}（docs/wording.md）' },
      schema: [],
    },
    create: visit((context, node, text) => {
      for (const w of WORDS) {
        const m = w.re.exec(text);
        if (m) context.report({ node, messageId: 'word', data: { word: m[0], say: w.say } });
      }
    }),
  },
  'wording-endings': {
    meta: {
      type: 'suggestion',
      docs: { description: 'お知らせ・エラー・説明の文は「です・ます」で終える（docs/wording.md）' },
      messages: {
        plain: '常体の文「{{sentence}}」: お知らせ・空のときの表示・エラー・説明の文は「です・ます」で終える。ボタン・見出しなら「。」を付けない（docs/wording.md）',
      },
      schema: [],
    },
    create: visit((context, node, text, last) => {
      const parts = text.split('。');
      const tail = parts.pop() ?? '';
      // 「。」で終わる文。直前が式なら（空の切れ端）見ない
      for (const raw of parts) {
        const s = raw.replace(CLOSERS, '').replace(/^.*[（(「『]/, '');
        if (s === '' || POLITE.test(s) || !PLAIN.test(s)) continue;
        context.report({ node, messageId: 'plain', data: { sentence: `${raw.split('\n').pop()?.trim()}。` } });
      }
      // 「。」の無い最後の文（テンプレートなら最後の切れ端だけ）
      if (!last) return;
      const s = tail.replace(CLOSERS, '');
      if (s !== '' && !POLITE.test(s) && PLAIN_TAIL.test(s)) context.report({ node, messageId: 'plain', data: { sentence: tail.trim() } });
    }),
  },
};

export default { rules };
