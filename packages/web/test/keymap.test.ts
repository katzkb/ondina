// 既定キーマップ（設計書 18.2）。2 キー（gi）は pending で持つ。設定で変えたキー（ui.json の keymap）は bindingsOf で既定に重ねる。
import { describe, expect, it } from 'vitest';
import { bindingsOf, conflictOf, DEFAULT_BINDINGS, KEY_ACTIONS, keymapWith, keyOfEvent, placeKey, resolveKey, showKey, type KeyActionId } from '../src/commands/keymap.js';

describe('resolveKey', () => {
  it.each([
    ['j', 'hunk.next'],
    ['ArrowDown', 'hunk.next'],
    ['k', 'hunk.prev'],
    ['ArrowUp', 'hunk.prev'],
    ['v', 'hunk.markViewed'],
    ['[', 'file.prev'],
    [']', 'file.next'],
    ['s', 'diff.mode.sbs'],
    ['u', 'diff.mode.unified'],
    ['?', 'help.keymap'],
    ['Escape', 'escape'],
    ['Enter', 'enter'],
    ['ArrowRight', 'course.forward'],
    ['ArrowLeft', 'course.prev'],
    ['m', 'course.map'],
    ['M', 'course.mapBig'],
    ['r', 'rel.toggle'],
    ['R', 'rel.big'],
    ['f', 'file.full'],
    ['b', 'course.fold'],
    ['o', 'jump.callee'],
    ['d', 'view.diff'],
  ])('%s → %s', (key, id) => {
    expect(resolveKey(key, null)).toEqual({ command: { id }, pending: null });
  });

  it('1 / 2 は入口のタブ（説明 / 地図）。3 / 4 は何もしない', () => {
    expect(resolveKey('1', null)).toEqual({ command: { id: 'home.tab', tab: 'text' }, pending: null });
    expect(resolveKey('2', null)).toEqual({ command: { id: 'home.tab', tab: 'map' }, pending: null });
    expect(resolveKey('3', null)).toEqual({ command: null, pending: null });
    expect(resolveKey('4', null)).toEqual({ command: null, pending: null });
  });

  it('g は pending になり、続く i で jump.ide', () => {
    expect(resolveKey('g', null)).toEqual({ command: null, pending: 'g' });
    expect(resolveKey('i', 'g')).toEqual({ command: { id: 'jump.ide' }, pending: null });
  });

  it('g の後に知らないキーが来たら pending を捨てて何もしない', () => {
    expect(resolveKey('x', 'g')).toEqual({ command: null, pending: null });
  });

  it('割り当てのないキーは何もしない', () => {
    expect(resolveKey('z', null)).toEqual({ command: null, pending: null });
  });

  it('⌘K / Ctrl+K でコマンドパレット', () => {
    expect(resolveKey('k', null, { meta: true })).toEqual({ command: { id: 'palette.open' }, pending: null });
    expect(resolveKey('k', null, { ctrl: true })).toEqual({ command: { id: 'palette.open' }, pending: null });
    expect(resolveKey('K', null, { meta: true })).toEqual({ command: { id: 'palette.open' }, pending: null });
  });

  it('⌘[ で定義から戻る。[ だけなら前のファイル（3.6）', () => {
    expect(resolveKey('[', null, { meta: true })).toEqual({ command: { id: 'def.back' }, pending: null });
    expect(resolveKey('[', null)).toEqual({ command: { id: 'file.prev' }, pending: null });
  });

  it('修飾キー付きに割り当てが無ければ何もしない（単独キーの表は見ない）', () => {
    expect(resolveKey('j', null, { meta: true })).toEqual({ command: null, pending: null });
    expect(resolveKey('k', null, { alt: true })).toEqual({ command: null, pending: null });
  });

  it('修飾キー付きが来たら 2 キー目待ちは打ち切る', () => {
    expect(resolveKey('k', 'g', { meta: true })).toEqual({ command: { id: 'palette.open' }, pending: null });
  });
});

describe('変えたキー（bindingsOf と resolveKey）', () => {
  it('変えた操作は新しいキーで動き、元のキーでは動かない。変えていない操作は既定のまま', () => {
    const b = bindingsOf({ 'view.diff': ['x'] });
    expect(resolveKey('x', null, {}, b)).toEqual({ command: { id: 'view.diff' }, pending: null });
    expect(resolveKey('d', null, {}, b)).toEqual({ command: null, pending: null });
    expect(resolveKey('j', null, {}, b)).toEqual({ command: { id: 'hunk.next' }, pending: null });
  });

  it('空の配列はキーなし', () => {
    const b = bindingsOf({ 'course.fold': [] });
    expect(b['course.fold']).toEqual([]);
    expect(resolveKey('b', null, {}, b)).toEqual({ command: null, pending: null });
  });

  it('2 つ続けても、⌘ 付きも変えられる', () => {
    const b = bindingsOf({ 'jump.ide': ['g o'], 'palette.open': ['Mod+p'] });
    expect(resolveKey('g', null, {}, b)).toEqual({ command: null, pending: 'g' });
    expect(resolveKey('o', 'g', {}, b)).toEqual({ command: { id: 'jump.ide' }, pending: null });
    expect(resolveKey('i', 'g', {}, b)).toEqual({ command: null, pending: null });
    expect(resolveKey('p', null, { meta: true }, b)).toEqual({ command: { id: 'palette.open' }, pending: null });
    expect(resolveKey('k', null, { meta: true }, b)).toEqual({ command: null, pending: null });
  });

  it('入口のタブも 1 つずつ変えられる', () => {
    const b = bindingsOf({ 'home.tab.text': ['t'] });
    expect(resolveKey('t', null, {}, b)).toEqual({ command: { id: 'home.tab', tab: 'text' }, pending: null });
    expect(resolveKey('2', null, {}, b)).toEqual({ command: { id: 'home.tab', tab: 'map' }, pending: null });
  });

  it('スペースは Space と書く', () => {
    const b = bindingsOf({ 'hunk.markViewed': ['Space'] });
    expect(resolveKey(' ', null, {}, b)).toEqual({ command: { id: 'hunk.markViewed' }, pending: null });
  });

  it('知らない名前・変えられないキー（Enter / Esc）・壊れた値（ui.json を手で直したとき）は既定のまま', () => {
    const b = bindingsOf({ 'no.such': ['x'], enter: ['x'], escape: [], 'view.diff': 'x' as unknown as string[], 'hunk.next': [1 as unknown as string] });
    expect(b).toEqual(DEFAULT_BINDINGS);
  });
});

describe('既定のキー', () => {
  it('どの既定のキーも 1 つの操作にしか無い（2 つ続けての 1 つ目とも重ならない）', () => {
    for (const id of Object.keys(KEY_ACTIONS) as KeyActionId[]) {
      for (const key of DEFAULT_BINDINGS[id]) expect(conflictOf(DEFAULT_BINDINGS, id, key), `${id} の ${key}`).toBeNull();
    }
  });
});

describe('keyOfEvent（設定で押したキーを表の書き方に）', () => {
  const ev = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

  it.each([
    ['x', ev('x'), 'x'],
    ['Shift+M（大文字で来る）', ev('M'), 'M'],
    ['↓', ev('ArrowDown'), 'ArrowDown'],
    ['⌘K', ev('k', { metaKey: true }), 'Mod+k'],
    ['Ctrl+Shift+K', ev('K', { ctrlKey: true }), 'Mod+k'],
    ['スペース', ev(' '), 'Space'],
  ])('%s → %s', (_name, e, key) => {
    expect(keyOfEvent(e)).toBe(key);
  });

  it.each([
    ['Shift だけ', ev('Shift')],
    ['⌘ だけ', ev('Meta', { metaKey: true })],
    ['Alt 付き', ev('x', { altKey: true })],
    ['日本語入力の途中', ev('Process')],
  ])('%s は null', (_name, e) => {
    expect(keyOfEvent(e)).toBeNull();
  });
});

describe('conflictOf（同じキーが別の操作にあるか）', () => {
  it('同じキーを持つ操作を返す。自分のキーは重ならない', () => {
    expect(conflictOf(DEFAULT_BINDINGS, 'view.diff', 'j')).toBe('hunk.next');
    expect(conflictOf(DEFAULT_BINDINGS, 'hunk.next', 'ArrowDown')).toBeNull();
    expect(conflictOf(DEFAULT_BINDINGS, 'view.diff', 'x')).toBeNull();
  });

  it('2 つ続けての 1 つ目とも重なる', () => {
    expect(conflictOf(DEFAULT_BINDINGS, 'view.diff', 'g')).toBe('jump.ide');
    expect(conflictOf(DEFAULT_BINDINGS, 'jump.ide', 'd i')).toBe('view.diff');
  });

  it('変えられないキーも返す', () => {
    expect(conflictOf(DEFAULT_BINDINGS, 'view.diff', 'Enter')).toBe('enter');
    expect(conflictOf(DEFAULT_BINDINGS, 'view.diff', 'Escape')).toBe('escape');
  });

  it('⌘ 付きは同じ文字のキーと重ならない', () => {
    expect(conflictOf(DEFAULT_BINDINGS, 'view.diff', 'Mod+j')).toBeNull();
  });
});

describe('showKey（画面に出すキー）', () => {
  it.each([
    ['d', 'D'],
    ['M', '⇧M'],
    ['Mod+k', '⌘K'],
    ['ArrowDown', '↓'],
    ['ArrowLeft', '←'],
    ['Escape', 'Esc'],
    ['Enter', 'Enter'],
    ['g i', 'G → I'],
    ['[', '['],
    ['?', '?'],
    ['1', '1'],
    ['Space', 'Space'],
  ])('%s → %s', (key, shown) => {
    expect(showKey(key)).toBe(shown);
  });
});

describe('keymapWith（ui.json に入れる変更）', () => {
  it('変えた操作だけを持つ', () => {
    expect(keymapWith(undefined, [{ action: 'view.diff', keys: ['x'] }])).toEqual({ 'view.diff': ['x'] });
    expect(keymapWith({ 'view.diff': ['x'] }, [{ action: 'course.fold', keys: [] }])).toEqual({ 'view.diff': ['x'], 'course.fold': [] });
  });

  it('既定と同じになった操作は消し、全部消えたら undefined', () => {
    expect(keymapWith({ 'view.diff': ['x'], 'course.fold': [] }, [{ action: 'view.diff', keys: ['d'] }])).toEqual({ 'course.fold': [] });
    expect(keymapWith({ 'view.diff': ['x'] }, [{ action: 'view.diff', keys: ['d'] }])).toBeUndefined();
  });

  it('並びが違えば既定と違う（画面に出すのは最初のキー）', () => {
    expect(keymapWith(undefined, [{ action: 'hunk.next', keys: ['ArrowDown', 'j'] }])).toEqual({ 'hunk.next': ['ArrowDown', 'j'] });
  });
});

describe('placeKey（押したキーを置く変更）', () => {
  it('重ならなければ、その欄だけを替える・足す', () => {
    expect(placeKey(DEFAULT_BINDINGS, 'view.diff', 0, 'x')).toEqual([{ action: 'view.diff', keys: ['x'] }]);
    expect(placeKey(DEFAULT_BINDINGS, 'view.diff', null, 'x')).toEqual([{ action: 'view.diff', keys: ['d', 'x'] }]);
  });

  it('同じキーが自分の別の欄にあれば 1 つにまとめる', () => {
    expect(placeKey(DEFAULT_BINDINGS, 'hunk.next', 0, 'ArrowDown')).toEqual([{ action: 'hunk.next', keys: ['ArrowDown'] }]);
  });

  it('こちらに移す: 重なった操作からそのキーを外す', () => {
    expect(placeKey(DEFAULT_BINDINGS, 'view.diff', 0, 'j', 'move')).toEqual([
      { action: 'view.diff', keys: ['j'] },
      { action: 'hunk.next', keys: ['ArrowDown'] },
    ]);
    expect(placeKey(DEFAULT_BINDINGS, 'view.diff', null, 'g', 'move')).toEqual([
      { action: 'view.diff', keys: ['d', 'g'] },
      { action: 'jump.ide', keys: [] },
    ]);
  });

  it('入れ替える: 替えた欄の元のキーを、重なった操作に渡す', () => {
    expect(placeKey(DEFAULT_BINDINGS, 'view.diff', 0, 'j', 'swap')).toEqual([
      { action: 'view.diff', keys: ['j'] },
      { action: 'hunk.next', keys: ['d', 'ArrowDown'] },
    ]);
  });
});
