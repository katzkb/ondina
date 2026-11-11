// テーマ（設計書 3.5）: モードと OS の外観から画面のフレーバーを決める。ui.json の古い形（1 つのフレーバー）を読み替える。
import type { ThemeSettings } from '@ondina/model';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, flavorOf, parseTheme, schemeOf, themesOf } from '../src/theme.js';

const picked: ThemeSettings = { mode: 'system', light: 'latte', dark: 'frappe', accent: 'teal' };

describe('flavorOf', () => {
  it.each([
    ['system', false, 'latte'],
    ['system', true, 'frappe'],
    ['light', false, 'latte'],
    ['light', true, 'latte'],
    ['dark', false, 'frappe'],
    ['dark', true, 'frappe'],
  ] as const)('%s で OS がダーク %s なら %s', (mode, osDark, flavor) => {
    expect(flavorOf({ ...picked, mode }, osDark)).toBe(flavor);
  });

  it('既定は OS に合わせ、ライトは Latte、ダークは Mocha', () => {
    expect(flavorOf(DEFAULT_THEME, false)).toBe('latte');
    expect(flavorOf(DEFAULT_THEME, true)).toBe('mocha');
  });
});

describe('テーマの表', () => {
  it('プルダウンの中身はライトとダークで分かれる', () => {
    expect(themesOf('light').map((t) => t.name)).toEqual(['Latte', 'GitHub Light']);
    expect(themesOf('dark').map((t) => t.name)).toEqual(['Frappé', 'Macchiato', 'Mocha', 'GitHub Dark']);
  });

  it('フレーバーの明暗', () => {
    expect(schemeOf('latte')).toBe('light');
    expect(schemeOf('macchiato')).toBe('dark');
    expect(schemeOf('github-light')).toBe('light');
    expect(schemeOf('github-dark')).toBe('dark');
  });
});

describe('parseTheme', () => {
  it('新しい形はそのまま', () => {
    expect(parseTheme(picked)).toEqual(picked);
  });

  it('古い形（1 つのフレーバー）は、そのフレーバーの明暗に固定する', () => {
    expect(parseTheme({ flavor: 'latte', accent: 'peach' })).toEqual({ mode: 'light', light: 'latte', dark: 'mocha', accent: 'peach' });
    expect(parseTheme({ flavor: 'macchiato', accent: 'blue' })).toEqual({ mode: 'dark', light: 'latte', dark: 'macchiato', accent: 'blue' });
  });

  it('表に無い値は、その項目だけ既定に戻す', () => {
    expect(parseTheme({ mode: 'dusk', light: 'mocha', dark: 'latte', accent: 'red' })).toEqual(DEFAULT_THEME);
    expect(parseTheme({ mode: 'dark', dark: 'macchiato' })).toEqual({ mode: 'dark', light: 'latte', dark: 'macchiato', accent: 'mauve' });
    expect(parseTheme({ flavor: 'dracula', accent: 'teal' })).toEqual({ ...DEFAULT_THEME, accent: 'teal' });
  });

  it('GitHub のテーマも選べる', () => {
    expect(parseTheme({ light: 'github-light' })?.light).toBe('github-light');
    expect(parseTheme({ dark: 'github-dark' })?.dark).toBe('github-dark');
    expect(parseTheme({ flavor: 'github-dark' })).toEqual({ ...DEFAULT_THEME, mode: 'dark', dark: 'github-dark' });
  });

  it('オブジェクトでなければ読まない', () => {
    expect(parseTheme(undefined)).toBeUndefined();
    expect(parseTheme('latte')).toBeUndefined();
    expect(parseTheme(null)).toBeUndefined();
    expect(parseTheme(['latte'])).toBeUndefined();
  });
});
