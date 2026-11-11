// ondina.config.yaml の parse と検証（設計書 11 章）。文字列 → 正規化済み OndinaConfig の純粋関数。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig, splitConfig, defaultLspConfig } from '../src/config/load.js';
import { FIXTURE_ROOT } from './fixture.js';

const fixtureYaml = () => readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8');

describe('parseConfig', () => {
  it('fixture の yaml を 11 章の形に読む', () => {
    expect(parseConfig(fixtureYaml())).toEqual({
      project: 'order-service',
      language: 'kotlin',
      sourceRoots: ['src/main/kotlin', 'src/test/kotlin', 'src/main/resources'],
      packagePrefix: 'com.example',
      // 並び順は層の割当で意味を持つ（上から順に最初に当たった層。5.2 の 4）。Tests が先頭なのはそのため
      layers: [
        { name: 'Tests', match: ['src/test/**'] },
        { name: 'API', match: ['**/api/**'] },
        { name: 'Application', match: ['**/application/**', '**/usecase/**'] },
        { name: 'Domain', match: ['**/domain/**'] },
        { name: 'Infrastructure', match: ['**/infra/**', 'src/main/resources/db/**'] },
      ],
      allowedDependencies: {
        API: ['Application'],
        Application: ['Domain', 'Infrastructure'],
        Infrastructure: ['Domain'],
        Tests: ['API', 'Application', 'Domain', 'Infrastructure'],
      },
      normalize: { kotlin: ['safeCall', 'lambdaIt', 'trailingComma', 'namedArgOrder'] },
      lsp: { kotlin: { command: 'kotlin-lsp', args: ['--stdio', '--system-path', '{cacheDir}'], readyTimeoutSec: 600 } },
      theme: { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' },
      ide: { scheme: 'jetbrains', product: 'idea', project: 'order-service' },
    });
  });

  it('空の yaml と {} は既定値になる', () => {
    expect(parseConfig('')).toEqual(defaultConfig());
    expect(parseConfig('{}')).toEqual(defaultConfig());
    expect(defaultConfig()).toEqual({
      sourceRoots: [],
      layers: [],
      allowedDependencies: {},
      normalize: {},
      lsp: {},
      theme: { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' },
      ide: { scheme: 'jetbrains', product: 'idea' },
    });
  });

  it('一部だけ書いた yaml は残りを既定値で埋める', () => {
    expect(parseConfig('packagePrefix: com.acme\ntheme: { dark: frappe }\nlsp: { kotlin: { command: kls } }\n')).toEqual({
      ...defaultConfig(),
      packagePrefix: 'com.acme',
      theme: { mode: 'system', light: 'latte', dark: 'frappe', accent: 'mauve' },
      lsp: { kotlin: { command: 'kls', args: [], readyTimeoutSec: 600 } },
    });
  });

  it('llm.command は文字列で読み、analysis 側に入る。無ければキーごと無い（5.3 / 11 章）', () => {
    const c = parseConfig('llm: { command: "codex exec --skip-git-repo-check -s read-only -" }\n');
    expect(c.llm).toEqual({ command: 'codex exec --skip-git-repo-check -s read-only -' });
    expect(splitConfig(c).analysis.llm).toEqual({ command: 'codex exec --skip-git-repo-check -s read-only -' });
    expect('llm' in parseConfig('')).toBe(false);
    expect(() => parseConfig('llm: claude\n')).toThrow('llm は { command } にしてください');
    expect(() => parseConfig('llm: { command: [claude] }\n')).toThrow('llm.command は文字列にしてください');
  });

  it('知らないキーは無視する', () => {
    expect(parseConfig('foo: 1\nlayers: [{ name: A, match: ["a/**"], color: red }]\n')).toEqual({ ...defaultConfig(), layers: [{ name: 'A', match: ['a/**'] }] });
  });

  it('型が違うキーはキー名と直し方を言って失敗する', () => {
    expect(() => parseConfig('sourceRoots: src\n')).toThrow('sourceRoots は文字列の配列にしてください');
    expect(() => parseConfig('layers:\n  - name: A\n    match: "**/a/**"\n')).toThrow('layers[0].match は文字列の配列にしてください');
    expect(() => parseConfig('layers:\n  - match: ["a"]\n')).toThrow('layers[0].name は文字列にしてください');
    expect(() => parseConfig('allowedDependencies: [A]\n')).toThrow('allowedDependencies は 層名: [層名] の形にしてください');
    expect(() => parseConfig('lsp: { kotlin: { command: kls, readyTimeoutSec: soon } }\n')).toThrow('lsp.kotlin.readyTimeoutSec は数値にしてください');
    expect(() => parseConfig('packagePrefix: [a]\n')).toThrow('packagePrefix は文字列にしてください');
    expect(() => parseConfig('- a\n')).toThrow('ondina.config.yaml の最上位は「キー: 値」の形にしてください');
  });

  it('allowedDependencies が layers に無い層名を指したら失敗する', () => {
    const yaml = 'layers: [{ name: A, match: ["a/**"] }]\nallowedDependencies: { A: [B] }\n';
    expect(() => parseConfig(yaml)).toThrow("allowedDependencies の 'B' は layers にありません");
    expect(() => parseConfig('layers: [{ name: A, match: ["a/**"] }]\nallowedDependencies: { C: [A] }\n')).toThrow("allowedDependencies の 'C' は layers にありません");
  });

  it('layers に同じ名前が 2 回あれば失敗する', () => {
    expect(() => parseConfig('layers: [{ name: A, match: ["a/**"] }, { name: A, match: ["b/**"] }]\n')).toThrow("layers の 'A' が 2 回あります");
  });

  it('theme は選び方と、ライト・ダークそれぞれの Catppuccin のフレーバーとアクセントだけ受ける', () => {
    expect(() => parseConfig('theme: { mode: auto }\n')).toThrow("theme.mode は system / light / dark のどれかにしてください（'auto'）");
    expect(() => parseConfig('theme: { light: mocha }\n')).toThrow("theme.light は latte / github-light のどれかにしてください（'mocha'）");
    expect(() => parseConfig('theme: { dark: latte }\n')).toThrow("theme.dark は frappe / macchiato / mocha / github-dark のどれかにしてください（'latte'）");
    expect(() => parseConfig('theme: { accent: red }\n')).toThrow("theme.accent は mauve / blue / lavender / teal / peach / pink のどれかにしてください（'red'）");
  });

  it('theme.light / theme.dark は GitHub のテーマも受ける', () => {
    expect(parseConfig('theme: { light: github-light, dark: github-dark }\n').theme).toEqual({ mode: 'system', light: 'github-light', dark: 'github-dark', accent: 'mauve' });
  });

  it('古い theme.flavor は、そのフレーバーの明暗に固定して読む', () => {
    expect(parseConfig('theme: { flavor: latte, accent: teal }\n').theme).toEqual({ mode: 'light', light: 'latte', dark: 'mocha', accent: 'teal' });
    expect(parseConfig('theme: { flavor: macchiato }\n').theme).toEqual({ mode: 'dark', light: 'latte', dark: 'macchiato', accent: 'mauve' });
    expect(() => parseConfig('theme: { flavor: dark }\n')).toThrow("theme.flavor は latte / frappe / macchiato / mocha のどれかにしてください（'dark'）");
  });

  it('ide.scheme は jetbrains だけ受ける', () => {
    expect(() => parseConfig('ide: { scheme: vscode }\n')).toThrow("ide.scheme は jetbrains にしてください（'vscode'）");
    expect(parseConfig('ide: { product: idea-ce }\n').ide).toEqual({ scheme: 'jetbrains', product: 'idea-ce' });
  });

  it('YAML として読めなければ失敗する', () => {
    expect(() => parseConfig('layers: [\n')).toThrow(/YAML として読めません/);
  });
});

describe('splitConfig', () => {
  it('解析に効く部分と表示だけの部分に分ける', () => {
    const { analysis, display } = splitConfig(parseConfig(fixtureYaml()));
    expect(Object.keys(analysis).sort()).toEqual(['allowedDependencies', 'language', 'layers', 'lsp', 'normalize', 'project', 'sourceRoots']);
    expect(display).toEqual({ packagePrefix: 'com.example', theme: { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' }, ide: { scheme: 'jetbrains', product: 'idea', project: 'order-service' } });
  });

  it('無い項目は出さない（project / language / packagePrefix / ide.project）', () => {
    const { analysis, display } = splitConfig(defaultConfig());
    expect('project' in analysis).toBe(false);
    expect('packagePrefix' in display).toBe(false);
    expect('project' in display.ide).toBe(false);
  });
});

// LSP の起動設定（設計書 9.1 / 11 章）。args はそのまま持つ（{cacheDir} の置換は cli）
describe('lsp', () => {
  it('command / args / readyTimeoutSec を読む', () => {
    const c = parseConfig('lsp:\n  kotlin:\n    command: kotlin-lsp\n    args: ["--stdio", "--system-path", "{cacheDir}"]\n    readyTimeoutSec: 300\n');
    expect(c.lsp['kotlin']).toEqual({ command: 'kotlin-lsp', args: ['--stdio', '--system-path', '{cacheDir}'], readyTimeoutSec: 300 });
  });

  it('importNotification を読む（取り込みの成否を伝える独自通知の読み方）', () => {
    const c = parseConfig('lsp:\n  kotlin:\n    command: kotlin-lsp\n    importNotification:\n      method: custom/import\n      succeededField: done\n      failedField: broken\n');
    expect(c.lsp['kotlin']?.importNotification).toEqual({ method: 'custom/import', succeededField: 'done', failedField: 'broken' });
  });

  it('importNotification を書かなければ欄ごと無い（既定は core が持つ）', () => {
    expect('importNotification' in (parseConfig('lsp:\n  kotlin:\n    command: kotlin-lsp\n').lsp['kotlin'] ?? {})).toBe(false);
  });

  it('importNotification の欄が欠けていたら、キー名と直し方を出して止める', () => {
    expect(() => parseConfig('lsp:\n  kotlin:\n    command: kotlin-lsp\n    importNotification:\n      method: x\n')).toThrow(
      'lsp.kotlin.importNotification は { method, succeededField, failedField } にしてください',
    );
  });
});

describe('defaultLspConfig', () => {
  it('kotlin は yaml に lsp.kotlin が無くても起こせる既定を持つ（コマンドは環境変数 ONDINA_LSP_COMMAND か kotlin-lsp の置き場から。9.1）', () => {
    expect(defaultLspConfig('kotlin')).toEqual({ command: '', args: ['--stdio', '--system-path', '{cacheDir}'], readyTimeoutSec: 600 });
  });

  it('既定を持たない言語は undefined', () => {
    expect(defaultLspConfig('scala')).toBeUndefined();
  });
});
