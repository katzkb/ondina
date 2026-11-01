// fixtures/order-service の差分に対する字句トークンの期待値。設計書 7.1（4 フレーバー不変）とゴールデン。
import { describe, expect, it } from 'vitest';
import { attachTokens, hunkTokenLines } from '../src/highlight/attach.js';
import { NON_IDENTIFIER_ROLES } from '../src/highlight/semantic.js';
import { createTokenizer, FLAVORS } from '../src/highlight/tokenizer.js';
import { extractAllHunks } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import type { TokenLine } from '../src/model.js';
import { changedFixtureFiles, readFixtureSemanticTokens } from './fixture.js';

const tokenizer = createTokenizer();
const shape = (lines: TokenLine[]) => lines.map((l) => l.map(([text, role, style]) => `${role}:${style}:${text}`));

describe('fixtures/order-service', () => {
  it('4 フレーバーで全トークンの役割と fontStyle が一致する（7.1 の「不一致ゼロ」）', async () => {
    for (const file of changedFixtureFiles()) {
      const lang = file.path.endsWith('.sql') ? 'sql' : 'kotlin';
      for (const text of [file.before, file.after]) {
        if (text === null) continue;
        const [mocha, ...rest] = await Promise.all(FLAVORS.map((f) => tokenizer.tokenize(text, lang, f)));
        expect(mocha).toBeDefined();
        for (const other of rest) expect(shape(other!), file.path).toEqual(shape(mocha!));
      }
    }
  });

  it('全 hunk に tokens が付き、各行のトークンを結合すると接頭辞抜きの行になる', async () => {
    const files = changedFixtureFiles();
    const hunks = await attachTokens((await extractAllHunks(files)).map(toHunk), files, { tokenizer });
    expect(hunks.length).toBeGreaterThan(0);
    for (const h of hunks) {
      expect(h.tokens?.length, h.path).toBe(h.lines.length);
      expect(h.tokens?.map((l) => l.map(([t]) => t).join(''))).toEqual(h.lines.map((l) => l.slice(1)));
    }
  });

  it('行の対応付けでフォールバック（継承色 1 トークン）した行が 0 件', async () => {
    const files = changedFixtureFiles();
    const hunks = (await extractAllHunks(files)).map(toHunk);
    const fallbacks: string[] = [];
    for (const h of hunks) {
      const file = files.find((f) => f.path === h.path)!;
      const before = file.before === null ? [] : (await tokenizer.tokenize(file.before, h.lang))!;
      const after = file.after === null ? [] : (await tokenizer.tokenize(file.after, h.lang))!;
      for (const i of hunkTokenLines(h, before, after).fallbacks) fallbacks.push(`${h.path}:${i}:${h.lines[i]}`);
    }
    expect(fallbacks).toEqual([]);
  });

  it('ゴールデン fixtures/order-service/expected/tokens.json と一致する', async () => {
    const files = changedFixtureFiles();
    const hunks = await attachTokens((await extractAllHunks(files)).map(toHunk), files, { tokenizer });
    // 1 行 1 TokenLine で書く（diff で読めるように）
    const body = hunks
      .map((h) => `  ${JSON.stringify(h.id)}: [\n${h.tokens!.map((l) => `    ${JSON.stringify(l)}`).join(',\n')}\n  ]`)
      .join(',\n');
    await expect(`{\n${body}\n}\n`).toMatchFileSnapshot('../../../fixtures/order-service/expected/tokens.json');
  });
});

describe('意味トークンの重ね合わせ（設計書 7.2）', () => {
  const semantic = readFixtureSemanticTokens();
  const withLsp = async () => {
    const files = changedFixtureFiles();
    return attachTokens((await extractAllHunks(files)).map(toHunk), files, { tokenizer, semantic });
  };

  it('重ねたあとも各行のトークンを結合すると接頭辞抜きの行になる', async () => {
    for (const h of await withLsp()) {
      expect(h.tokens?.length, h.path).toBe(h.lines.length);
      expect(h.tokens?.map((l) => l.map(([t]) => t).join(''))).toEqual(h.lines.map((l) => l.slice(1)));
    }
  });

  it('字句が識別子の色を塗った所は動かさず、塗っていない所と非識別子の色の所だけ変わる', async () => {
    const files = changedFixtureFiles();
    const hunks = (await extractAllHunks(files)).map(toHunk);
    const lex = await attachTokens(hunks, files, { tokenizer });
    const sem = await attachTokens(hunks, files, { tokenizer, semantic });
    const byId = new Map(lex.map((h) => [h.id, h]));
    let changed = 0;
    for (const h of sem) {
      const before = byId.get(h.id)!;
      for (const [i, line] of (h.tokens ?? []).entries()) {
        // 字句側の各文字の役割を引けるようにする
        const roleAt: (string | null)[] = [];
        for (const [text, role] of before.tokens![i]!) for (let k = 0; k < text.length; k++) roleAt.push(role);
        let col = 0;
        for (const [text, role, style] of line) {
          const was = roleAt[col];
          if (role !== was) {
            changed++;
            // 変わってよいのは「字句が塗っていない」か「非識別子の役割」だけ
            expect(was === null || NON_IDENTIFIER_ROLES.has(was!), `${h.path}:${i} ${JSON.stringify(text)} ${was} → ${role}`).toBe(true);
          }
          expect(style === 0 || style === 1 || style === 2 || style === 3).toBe(true);
          col += text.length;
        }
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('ゴールデン fixtures/order-service/expected/tokens-lsp.json と一致する', async () => {
    const hunks = await withLsp();
    const body = hunks
      .map((h) => `  ${JSON.stringify(h.id)}: [\n${h.tokens!.map((l) => `    ${JSON.stringify(l)}`).join(',\n')}\n  ]`)
      .join(',\n');
    await expect(`{\n${body}\n}\n`).toMatchFileSnapshot('../../../fixtures/order-service/expected/tokens-lsp.json');
  });
});
