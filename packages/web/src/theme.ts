// テーマ（設計書 3.5。2026-10-22）。フレーバーの明暗はこの表だけに置き、設定のプルダウン・Mermaid の明暗・ui.json の古い形の読み替えはここから引く。
// 画面のフレーバーはモードと OS の外観で決まる。OS の外観は購読するので、時間帯で自動で切り替わっても読み直さずに変わる。
import type { ThemeMode, ThemeSettings } from '@ondina/model';
import { useSyncExternalStore } from 'react';

export type Scheme = 'light' | 'dark';

/** id は styles.css の [data-flavor] と同じ */
const THEMES: ReadonlyArray<{ id: string; name: string; scheme: Scheme }> = [
  { id: 'latte', name: 'Latte', scheme: 'light' },
  { id: 'frappe', name: 'Frappé', scheme: 'dark' },
  { id: 'macchiato', name: 'Macchiato', scheme: 'dark' },
  { id: 'mocha', name: 'Mocha', scheme: 'dark' },
];

/** core の ACCENTS と同じ列（web は core を読まない。原則 5） */
export const ACCENTS: readonly string[] = ['mauve', 'blue', 'lavender', 'teal', 'peach', 'pink'];

const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export const DEFAULT_THEME: ThemeSettings = { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' };

export const themesOf = (scheme: Scheme) => THEMES.filter((t) => t.scheme === scheme);

export const schemeOf = (flavor: string): Scheme | undefined => THEMES.find((t) => t.id === flavor)?.scheme;

/** 画面のフレーバー。system は OS の外観で light / dark のどちらかを使う */
export function flavorOf(theme: ThemeSettings, osDark: boolean): string {
  const dark = theme.mode === 'dark' || (theme.mode === 'system' && osDark);
  return dark ? theme.dark : theme.light;
}

const pick = <T extends string>(v: unknown, choices: readonly T[], dflt: T): T => choices.find((c) => c === v) ?? dflt;
const idsOf = (scheme: Scheme) => themesOf(scheme).map((t) => t.id);

/**
 * ui.json の theme を読む。表に無い値はその項目だけ既定に戻す。
 * 2026-10-22 より前の形 { flavor, accent } は、そのフレーバーの明暗に固定する（次の保存で新しい形になる）
 */
export function parseTheme(raw: unknown): ThemeSettings | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const x = raw as Record<string, unknown>;
  const accent = pick(x['accent'], ACCENTS, DEFAULT_THEME.accent);
  if ('flavor' in x) {
    const flavor = String(x['flavor']);
    const scheme = schemeOf(flavor);
    if (scheme === undefined) return { ...DEFAULT_THEME, accent };
    return scheme === 'light' ? { ...DEFAULT_THEME, mode: 'light', light: flavor, accent } : { ...DEFAULT_THEME, mode: 'dark', dark: flavor, accent };
  }
  return {
    mode: pick(x['mode'], MODES, DEFAULT_THEME.mode),
    light: pick(x['light'], idsOf('light'), DEFAULT_THEME.light),
    dark: pick(x['dark'], idsOf('dark'), DEFAULT_THEME.dark),
    accent,
  };
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribeOs(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** OS の外観がダークか。OS が切り替わると再描画する */
export const useOsDark = (): boolean => useSyncExternalStore(subscribeOs, () => window.matchMedia(DARK_QUERY).matches);
