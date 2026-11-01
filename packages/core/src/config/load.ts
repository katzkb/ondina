// ondina.config.yaml（設計書 11 章）の parse と検証。文字列 → 正規化済み OndinaConfig の純粋関数。
// ファイルを開くのは cli（analyze / serve）。ここは Node の API を使わない。
//
// 検証の方針（2026-09-17 決定）: 使うキーだけ型を検査し、違えばキー名と直し方を 1 行で投げる。知らないキーは無視する。
// allowedDependencies が layers に無い層名を指すのは typo なので失敗にする。theme / ide.scheme は既知の値だけ受ける。
import { flavors } from '@catppuccin/palette';
import { parse as parseYaml } from 'yaml';
import type { AnalysisConfig, DisplayConfig, OndinaConfig, ThemeMode } from '@ondina/model';
import { FLAVORS } from '../highlight/tokenizer.js';

/** 3.5 のアクセント色。web の theme.ts と同じ列（yaml の値の検査はここだけで行う） */
export const ACCENTS: readonly string[] = ['mauve', 'blue', 'lavender', 'teal', 'peach', 'pink'];

const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
const LIGHT_FLAVORS = FLAVORS.filter((f) => !flavors[f].dark);
const DARK_FLAVORS = FLAVORS.filter((f) => flavors[f].dark);

const DEFAULT_LSP = { args: [] as string[], readyTimeoutSec: 600 };

/**
 * yaml に lsp.<language> が無いときの起こし方（9.1）。コマンドは空で、cli が環境変数 ONDINA_LSP_COMMAND か kotlin-lsp の置き場で埋める。
 * kotlin-lsp は既定が socket なので --stdio が要り、{cacheDir} にインデックスを置く（fixture の yaml と同じ）
 */
const LANGUAGE_LSP: Readonly<Record<string, OndinaConfig['lsp'][string]>> = {
  kotlin: { command: '', args: ['--stdio', '--system-path', '{cacheDir}'], readyTimeoutSec: DEFAULT_LSP.readyTimeoutSec },
};

export function defaultLspConfig(language: string): OndinaConfig['lsp'][string] | undefined {
  const c = LANGUAGE_LSP[language];
  return c === undefined ? undefined : { ...c, args: [...c.args] };
}

export function defaultConfig(): OndinaConfig {
  return {
    sourceRoots: [],
    layers: [],
    allowedDependencies: {},
    normalize: {},
    lsp: {},
    theme: { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' },
    ide: { scheme: 'jetbrains', product: 'idea' },
  };
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

function fail(msg: string): never {
  throw new Error(msg);
}

function optString(v: unknown, key: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  return typeof v === 'string' ? v : fail(`${key} は文字列にしてください`);
}

function stringArray(v: unknown, key: string, dflt: string[]): string[] {
  if (v === undefined || v === null) return dflt;
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : fail(`${key} は文字列の配列にしてください`);
}

function stringArrayTable(v: unknown, key: string, hint: string): Record<string, string[]> {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) fail(`${key} は ${hint} の形にしてください`);
  const out: Record<string, string[]> = {};
  for (const [k, val] of Object.entries(v)) out[k] = stringArray(val, `${key}.${k}`, []);
  return out;
}

function layers(v: unknown): OndinaConfig['layers'] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail('layers は { name, match } の配列にしてください');
  return v.map((l, i) => {
    if (!isObj(l)) fail(`layers[${i}] は { name, match } にしてください`);
    const name = optString(l['name'], `layers[${i}].name`) ?? fail(`layers[${i}].name は文字列にしてください`);
    return { name, match: stringArray(l['match'], `layers[${i}].match`, []) };
  });
}

function lsp(v: unknown): OndinaConfig['lsp'] {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) fail('lsp は 言語: { command, args, readyTimeoutSec } の形にしてください');
  const out: OndinaConfig['lsp'] = {};
  for (const [lang, val] of Object.entries(v)) {
    if (!isObj(val)) fail(`lsp.${lang} は { command, args, readyTimeoutSec } にしてください`);
    const command = optString(val['command'], `lsp.${lang}.command`) ?? fail(`lsp.${lang}.command は文字列にしてください`);
    const t = val['readyTimeoutSec'];
    const readyTimeoutSec = t === undefined || t === null ? DEFAULT_LSP.readyTimeoutSec : typeof t === 'number' ? t : fail(`lsp.${lang}.readyTimeoutSec は数値にしてください`);
    const importNotification = importNote(val['importNotification'], lang);
    out[lang] = {
      command,
      args: stringArray(val['args'], `lsp.${lang}.args`, DEFAULT_LSP.args),
      readyTimeoutSec,
      ...(importNotification === undefined ? {} : { importNotification }),
    };
  }
  return out;
}

/** 取り込みの成否を伝える独自通知の読み方（9.1）。書かなければ欄ごと無し（既定は core の KOTLIN_IMPORT_NOTIFICATION） */
function importNote(v: unknown, lang: string): { method: string; succeededField: string; failedField: string } | undefined {
  if (v === undefined || v === null) return undefined;
  const where = `lsp.${lang}.importNotification`;
  const shape = `${where} は { method, succeededField, failedField } にしてください`;
  if (!isObj(v)) fail(shape);
  const method = optString(v['method'], `${where}.method`);
  const succeededField = optString(v['succeededField'], `${where}.succeededField`);
  const failedField = optString(v['failedField'], `${where}.failedField`);
  if (method === undefined || succeededField === undefined || failedField === undefined) fail(shape);
  return { method, succeededField, failedField };
}

/** LLM コマンド（5.3）。sh -c で起動する 1 本の文字列。無ければキーごと無し（既定は cli が決める） */
function llm(v: unknown): AnalysisConfig['llm'] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) fail('llm は { command } にしてください');
  const command = optString(v['command'], 'llm.command') ?? fail('llm.command は文字列にしてください');
  return { command };
}

function oneOf<T extends string>(v: unknown, key: string, choices: readonly T[], dflt: T): T {
  if (v === undefined || v === null) return dflt;
  return choices.find((c) => c === v) ?? fail(`${key} は ${choices.join(' / ')} のどれかにしてください（'${String(v)}'）`);
}

function theme(v: unknown): OndinaConfig['theme'] {
  const d = defaultConfig().theme;
  if (v === undefined || v === null) return d;
  if (!isObj(v)) fail('theme は { mode, light, dark, accent } にしてください');
  const accent = oneOf(v['accent'], 'theme.accent', ACCENTS, d.accent);
  // 2026-10-22 より前の 1 つのフレーバー（theme.flavor）は、そのフレーバーの明暗に固定する
  if (v['flavor'] !== undefined && v['flavor'] !== null) {
    const flavor = oneOf(v['flavor'], 'theme.flavor', FLAVORS, 'mocha');
    return flavors[flavor].dark ? { ...d, mode: 'dark', dark: flavor, accent } : { ...d, mode: 'light', light: flavor, accent };
  }
  return {
    mode: oneOf(v['mode'], 'theme.mode', MODES, d.mode),
    light: oneOf(v['light'], 'theme.light', LIGHT_FLAVORS, d.light),
    dark: oneOf(v['dark'], 'theme.dark', DARK_FLAVORS, d.dark),
    accent,
  };
}

function ide(v: unknown): OndinaConfig['ide'] {
  const d = defaultConfig().ide;
  if (v === undefined || v === null) return d;
  if (!isObj(v)) fail('ide は { scheme, product, project } にしてください');
  const scheme = v['scheme'];
  if (scheme !== undefined && scheme !== null && scheme !== 'jetbrains') fail(`ide.scheme は jetbrains にしてください（'${String(scheme)}'）`);
  const project = optString(v['project'], 'ide.project');
  return { scheme: 'jetbrains', product: optString(v['product'], 'ide.product') ?? d.product, ...(project === undefined ? {} : { project }) };
}

/** yaml の文字列を読み、検証して既定値で埋める。形が違えば Error（メッセージはキー名と直し方） */
export function parseConfig(text: string): OndinaConfig {
  let doc: unknown;
  try {
    doc = parseYaml(text) as unknown;
  } catch (e) {
    fail(`YAML として読めません: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (doc === undefined || doc === null) doc = {};
  if (!isObj(doc)) fail('ondina.config.yaml の最上位は「キー: 値」の形にしてください');
  const d = defaultConfig();
  const project = optString(doc['project'], 'project');
  const language = optString(doc['language'], 'language');
  const packagePrefix = optString(doc['packagePrefix'], 'packagePrefix');
  const llmConfig = llm(doc['llm']);
  const config: OndinaConfig = {
    ...(project === undefined ? {} : { project }),
    ...(language === undefined ? {} : { language }),
    sourceRoots: stringArray(doc['sourceRoots'], 'sourceRoots', d.sourceRoots),
    ...(packagePrefix === undefined ? {} : { packagePrefix }),
    layers: layers(doc['layers']),
    allowedDependencies: stringArrayTable(doc['allowedDependencies'], 'allowedDependencies', '層名: [層名]'),
    normalize: stringArrayTable(doc['normalize'], 'normalize', '言語: [ルール名]'),
    lsp: lsp(doc['lsp']),
    ...(llmConfig === undefined ? {} : { llm: llmConfig }),
    theme: theme(doc['theme']),
    ide: ide(doc['ide']),
  };
  const known = new Set<string>();
  for (const l of config.layers) {
    if (known.has(l.name)) fail(`layers の '${l.name}' が 2 回あります`);
    known.add(l.name);
  }
  for (const [from, tos] of Object.entries(config.allowedDependencies)) {
    for (const name of [from, ...tos]) if (!known.has(name)) fail(`allowedDependencies の '${name}' は layers にありません`);
  }
  return config;
}

/** 解析に効く部分（Analysis.config）と表示だけの部分（GET /api/config）に分ける */
export function splitConfig(c: OndinaConfig): { analysis: AnalysisConfig; display: DisplayConfig } {
  const { packagePrefix, theme, ide, ...analysis } = c;
  return { analysis, display: { ...(packagePrefix === undefined ? {} : { packagePrefix }), theme, ide } };
}
