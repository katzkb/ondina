// Shiki 字句ハイライト。設計書 7.2 パイプラインの 1 行目。
//
// トークンには色ではなく役割名（Catppuccin パレットの色名。mauve / blue / yellow …）を持たせる（7.1）。
// 4 フレーバーで役割が一致することは 7.1 で確認済みなので、実行時は 1 フレーバー（既定 mocha）で
// トークン化し、hex をそのフレーバーのパレットから逆引きして役割名にする。
// テーマ既定の前景色（パレットの text）は null にする（継承色。model.ts の TokenLine）。
// Shiki が知らない言語は undefined を返す（Hunk.tokens を付けない）。
import { flavors, type FlavorName } from '@catppuccin/palette';
import { bundledLanguages, createHighlighter, type BundledLanguage, type BundledTheme, type HighlighterGeneric } from 'shiki';
import type { TokenLine } from '../model.js';

export type Flavor = FlavorName;
export const FLAVORS: readonly Flavor[] = ['latte', 'frappe', 'macchiato', 'mocha'];

export interface Tokenizer {
  /** 1 行が 1 要素。lang が Shiki に無ければ undefined */
  tokenize(text: string, lang: string, flavor?: Flavor): Promise<TokenLine[] | undefined>;
  /** Shiki（wasm）を解放する。次に tokenize すれば作り直す。長時間稼働する serve で積み上げないため */
  dispose(): void;
}

const themeOf = (flavor: Flavor) => `catppuccin-${flavor}` as const;

/** hex（小文字）→ パレットの色名。フレーバーごと */
function roleTable(flavor: Flavor): Map<string, string> {
  return new Map(Object.entries(flavors[flavor].colors).map(([name, c]) => [c.hex.toLowerCase(), name]));
}

/**
 * lang と、その文法が「後から読む」埋め込み言語（embeddedLangsLazy）のうち Shiki に同梱のもの。
 * 例: vue の <style lang="scss"> / <template lang="pug">、markdown のフェンス。
 * Shiki はこれを親と一緒に読まないので、そのままだと先に同じ言語のファイルを処理したかどうかで
 * 色の有無が変わる（同じ headSha に同じ結果を出せない）。親を読むときに必ず一緒に読む。
 * 埋め込み言語がさらに後から読む言語もあるので（markdown → pug → stylus）、辿り切る
 */
async function withLazyEmbedded(lang: BundledLanguage): Promise<BundledLanguage[]> {
  const seen = new Set<BundledLanguage>([lang]);
  for (const current of seen) {
    for (const r of (await bundledLanguages[current]()).default) {
      for (const l of r.embeddedLangsLazy ?? []) if (l in bundledLanguages) seen.add(l as BundledLanguage);
    }
  }
  return [...seen];
}

export function createTokenizer(): Tokenizer {
  let highlighter: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | undefined;
  const tables = new Map<Flavor, Map<string, string>>();

  const get = () => (highlighter ??= createHighlighter({ themes: FLAVORS.map(themeOf), langs: [] }));

  return {
    async tokenize(text, lang, flavor = 'mocha') {
      if (!(lang in bundledLanguages)) return undefined;
      // 待っている間に dispose されたら（別の呼び出しが作り直した後でも）古いインスタンスを使わず、最初からやり直す
      const started = get();
      let hl: Awaited<typeof started>;
      try {
        hl = await started;
        if (!hl.getLoadedLanguages().includes(lang)) await hl.loadLanguage(...(await withLazyEmbedded(lang as BundledLanguage)));
      } catch (e) {
        if (highlighter !== started) return this.tokenize(text, lang, flavor);
        throw e;
      }
      if (highlighter !== started) return this.tokenize(text, lang, flavor);
      const theme = themeOf(flavor);
      const fg = hl.getTheme(theme).fg.toLowerCase();
      let table = tables.get(flavor);
      if (!table) tables.set(flavor, (table = roleTable(flavor)));
      return hl.codeToTokensBase(text, { lang: lang as BundledLanguage, theme }).map((line) =>
        line.map((t) => {
          const hex = (t.color ?? fg).toLowerCase();
          const role = hex === fg ? null : (table.get(hex) ?? null);
          return [t.content, role, Math.max(0, t.fontStyle ?? 0)];
        }),
      );
    },
    dispose() {
      const current = highlighter;
      highlighter = undefined;
      void current?.then((hl) => hl.dispose());
    },
  };
}
