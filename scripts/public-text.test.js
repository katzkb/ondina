// @ts-check
// 公開するリポジトリに書かないもの（作者の勤め先の環境、作者の発言と選択の記録、作者の手元のパス、非公開だった頃の入れ方）。
// 追跡しているファイルを全部見る。設計の経緯は、誰が言ったかではなく、何をなぜ決めたかで書く。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'scripts/public-text.test.js';

const BANNED = [
  { re: /業務 ?PC/, say: '勤め先の PC は書かない。「コピー&ペーストできない環境」のように、設計の理由になった制約で書く' },
  { re: /社内/, say: '「社内」は書かない。「GitHub Enterprise Server」「Jira Server / Data Center」のように製品名で書く' },
  { re: /ユーザー「/, say: '発言を引用しない。決めた理由を書く' },
  { re: /ユーザーが(?:見本|動く見本|モック|選|決め|比べ)/, say: '誰が選んだかは書かない。何をなぜ選んだかを書く' },
  { re: /ユーザー(?:の指針|の指摘|の判断|と決め|の依頼|要求|の要求)/, say: '誰が決めたかは書かない。何をなぜ決めたかを書く' },
  { re: /裁定/, say: '「裁定」は書かない。「決めた」と書き、何をなぜ決めたかを書く' },
  { re: /\/Users\/[a-z][\w.-]+|-Users-[a-z]|\/private\/tmp\/claude-/, say: '手元のパス（ホームのフォルダや一時フォルダ）を書かない' },
  { re: /\.agent\//, say: '追跡しないファイル（.agent/）を指さない。公開するリポジトリには無い' },
  { re: /本人用|作者本人/, say: '本人用の配布ではなく、clone して入れる手順として書く' },
  { re: /katzkb\/order-service/, say: 'テストの見本のリポジトリは example/order-service と書く' },
];

it('追跡しているファイルに、公開するリポジトリに書かないものがない', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && f !== SELF && existsSync(join(ROOT, f)));
  const hits = [];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      for (const b of BANNED) if (b.re.test(line)) hits.push(`${file}:${i + 1}: ${b.say}`);
    });
  }
  expect(hits).toEqual([]);
});
