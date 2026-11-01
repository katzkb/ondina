// 製品の日本語の決まり（docs/wording.md）を守らせる lint ルールのテスト。止める例と通す例を並べる。
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { rules } from './wording.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } } });

tester.run('wording-words', rules['wording-words'], {
  valid: [
    "const s = '不明な hunk id を除外しました';",
    "const s = 'LLM による目的ごとの分け方をスキップしました';",
    "const s = '採用した下書きだけ送る';",
    "const s = '差分のない相手';",
    "const s = '無効な値です';",
    "const s = '建物';",
    "const s = '送信済み';",
    "const s = 'サンプル';",
    "const s = '差異あり';",
    "const s = '層を飛び越える呼び出し';",
    // コメントは見ない
    '// 知らない hunk id を捨てる\nconst s = 1;',
    // 正規表現は文言ではない
    'const re = /版/;',
  ],
  invalid: [
    { code: "const s = '知らないコマンド';", errors: [{ messageId: 'word', data: { word: '知らな', say: '「知らない」は「不明な」か「〜はありません」にする' } }] },
    { code: "const s = 'LLM ラベリングを飛ばしました';", errors: [{ messageId: 'word' }, { messageId: 'word' }] },
    { code: "const s = '知らない hunk id を捨てました';", errors: [{ messageId: 'word' }, { messageId: 'word' }] },
    { code: "const s = '言語サーバーを起こさない';", errors: [{ messageId: 'word' }] },
    { code: "const s = `Jira が ${n} 秒で答えませんでした`;", errors: [{ messageId: 'word' }] },
    { code: "const s = 'analyze を打ち直すと出る';", errors: [{ messageId: 'word' }] },
    { code: "const s = 'で採り直せます';", errors: [{ messageId: 'word' }] },
    { code: "const s = '地図を組めなかった';", errors: [{ messageId: 'word' }] },
    { code: "const s = '呼び出し関係を測れていない';", errors: [{ messageId: 'word' }] },
    { code: "const s = '入っている版を出す';", errors: [{ messageId: 'word' }] },
    { code: "const s = `${b}  ／ 辺なし ${n}`;", errors: [{ messageId: 'word' }] },
    { code: "const s = '解析に無い';", errors: [{ messageId: 'word' }] },
    { code: "const s = '採用した物だけ送る';", errors: [{ messageId: 'word' }] },
    { code: "const s = '送信済';", errors: [{ messageId: 'word' }] },
    { code: "const s = '見たとしてマーク';", errors: [{ messageId: 'word' }] },
    { code: "const s = 'ReviewState の形ではありません';", errors: [{ messageId: 'word' }] },
    { code: "const s = '引数は取りません';", errors: [{ messageId: 'word' }] },
    { code: "const s = '代表と同じ形';", errors: [{ messageId: 'word' }] },
    { code: "const s = `逸脱 · 代表と ${d} 語差`;", errors: [{ messageId: 'word' }, { messageId: 'word' }, { messageId: 'word' }] },
    { code: "const s = 'title は命令形で短く（10 語以内）';", errors: [{ messageId: 'word' }, { messageId: 'word' }] },
    { code: "const s = '意味トークン';", errors: [{ messageId: 'word' }] },
    { code: "const s = '裏で起動しました';", errors: [{ messageId: 'word' }] },
    // JSX の文と属性も見る
    { code: 'const e = <small>代表</small>;', errors: [{ messageId: 'word' }] },
    { code: 'const e = <button aria-label="見たとしてマーク" />;', errors: [{ messageId: 'word' }] },
  ],
});

tester.run('wording-endings', rules['wording-endings'], {
  valid: [
    // ボタン・見出し・ラベル（「。」なし）は「〜する」や体言止めのまま
    "const s = '閉じる';",
    "const s = '見た';",
    "const s = '自分のメモと、採用した下書きを送る';",
    "const s = '差分なし';",
    // お知らせ・エラーは「です・ます」
    "const s = '解析がまだありません。';",
    "const s = '送るコメントはまだありません';",
    "const s = 'LLM で答えを書けませんでした。';",
    "const s = '差分は全部見ました。承認はいつでも押せます。';",
    "const s = 'メモを付ける行を、行番号の「+」で選んでください。';",
    // 体言止めや括弧で終わる文
    "const s = '起点。';",
    "const s = `${n} か所。`;",
    "const s = '（テスト。地図には出ません）';",
    // 「。」の直前が式なら見ない（式の中身は分からない）
    'const s = `${why}。`;',
  ],
  invalid: [
    { code: "const s = '送るコメントはまだない';", errors: [{ messageId: 'plain' }] },
    { code: "const s = '送った。';", errors: [{ messageId: 'plain' }] },
    { code: "const s = '差分は全部見た。承認はいつでも押せる。';", errors: [{ messageId: 'plain' }, { messageId: 'plain' }] },
    { code: "const s = `見ていない差分 ${n}。承認はいつでも押せる。`;", errors: [{ messageId: 'plain' }] },
    { code: "const s = 'ファイル全体は解析にない';", errors: [{ messageId: 'plain' }] },
    { code: "const s = '（テスト。地図に出ない）';", errors: [{ messageId: 'plain' }] },
    { code: "const s = '答えは差分と解析の事実から書く。';", errors: [{ messageId: 'plain' }] },
    { code: "const s = '見た印は付かない';", errors: [{ messageId: 'plain' }] },
    { code: "const s = 'LLM で答えを書けなかった';", errors: [{ messageId: 'plain' }] },
    { code: 'const e = <p>分からないことを聞く。</p>;', errors: [{ messageId: 'plain' }] },
    // 複数行の文字列では、止めた文の行だけを出す（どこを直すかが分かるように）
    { code: 'const s = `一行目\n二行目は書く。`;', errors: [{ messageId: 'plain', data: { sentence: '二行目は書く。' } }] },
  ],
});
