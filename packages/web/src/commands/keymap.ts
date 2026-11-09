// ショートカットキー（設計書 18.2）。操作の表 KEY_ACTIONS が 1 つの正で、キーの解決・? の一覧・設定のタブ・画面の中のキーの表示はここから出す。
// 設定で変えたキーは .ondina/ui.json の keymap（既定から変えた操作だけ）に入り、bindingsOf で既定に重ねる（2026-10-20）。
import type { UiSettings } from '@ondina/model';
import type { Command } from './commands.js';

/** 設定と ? の一覧の見出し。fixed（Enter / Esc）は変えられない */
export type KeyGroup = 'all' | 'course' | 'home' | 'fixed';

interface KeyAction {
  command: Command;
  /** 既定のキー。KeyboardEvent.key の書き方（Shift の文字は大文字）、⌘ / Ctrl 付きは Mod+k、2 つ続けては空白区切り */
  keys: readonly string[];
  /** 設定の行の名前 */
  label: string;
  /** ? の一覧の説明。無ければ label */
  help?: string;
  group: KeyGroup;
}

/** 操作の名前はコマンド ID と同じ（引数のある home.tab だけ home.tab.map / home.tab.text）。並びが設定と ? の一覧の並び */
export const KEY_ACTIONS = {
  'hunk.next': { command: { id: 'hunk.next' }, keys: ['j', 'ArrowDown'], group: 'all', label: '次の場所', help: '次の hunk（コースでは次の停留所。差分のない相手の引き出しでは次の相手）' },
  'hunk.prev': { command: { id: 'hunk.prev' }, keys: ['k', 'ArrowUp'], group: 'all', label: '前の場所', help: '前の hunk（コースでは前の停留所。差分のない相手の引き出しでは前の相手）' },
  'hunk.markViewed': { command: { id: 'hunk.markViewed' }, keys: ['v'], group: 'all', label: '見た印を付ける / 外す' },
  'view.prs': { command: { id: 'view.prs' }, keys: ['p'], group: 'all', label: 'PR 一覧へ' },
  'view.diff': { command: { id: 'view.diff' }, keys: ['d'], group: 'all', label: '差分一覧へ' },
  'ask.toggle': { command: { id: 'ask.toggle' }, keys: ['q'], group: 'all', label: '案内人に聞く', help: '案内人に聞く（停留所の画面では右の入力欄へ。ほかの画面では引き出しの開閉）' },
  'file.next': { command: { id: 'file.next' }, keys: [']'], group: 'all', label: '次のファイル' },
  'file.prev': { command: { id: 'file.prev' }, keys: ['['], group: 'all', label: '前のファイル' },
  'diff.mode.sbs': { command: { id: 'diff.mode.sbs' }, keys: ['s'], group: 'all', label: '左右に並べる', help: '差分を左右に並べる' },
  'diff.mode.unified': { command: { id: 'diff.mode.unified' }, keys: ['u'], group: 'all', label: '1 列にまとめる', help: '差分を統合して 1 列にまとめる' },
  'file.full': { command: { id: 'file.full' }, keys: ['f'], group: 'all', label: 'すべて表示 / 変更の近くだけ', help: 'すべて表示 / 変更の近くだけ（差分一覧・目的ごと。コースではファイル全体 / 前後だけ。要求コースでは、この要求の差分だけ / 全部のファイル）' },
  'find.open': { command: { id: 'find.open' }, keys: ['Mod+f'], group: 'all', label: '差分の中を検索', help: '差分の中を検索（差分一覧・目的ごと。画面の外の行と畳んだ行も探します。Enter で次、⇧Enter で前）' },
  'def.back': { command: { id: 'def.back' }, keys: ['Mod+['], group: 'all', label: '定義から戻る', help: '名前を ⌘+クリックして定義へ移る前の場所に戻る（差分一覧・目的ごと・コース。定義の引き出しでは前の定義）' },
  'jump.ide': { command: { id: 'jump.ide' }, keys: ['g i'], group: 'all', label: 'IDEA で開く' },
  'palette.open': { command: { id: 'palette.open' }, keys: ['Mod+k'], group: 'all', label: 'コマンドパレット' },
  'help.keymap': { command: { id: 'help.keymap' }, keys: ['?'], group: 'all', label: 'キーの一覧を開く / 閉じる', help: 'この一覧を開く / 閉じる' },
  'course.forward': { command: { id: 'course.forward' }, keys: ['ArrowRight'], group: 'course', label: '進む', help: 'How コースでは進む · 要求コースでは次の章へ' },
  'course.prev': { command: { id: 'course.prev' }, keys: ['ArrowLeft'], group: 'course', label: '戻る', help: 'How コースでは戻る · 要求コースでは前の章へ' },
  'course.map': { command: { id: 'course.map' }, keys: ['m'], group: 'course', label: '地図を出す / しまう', help: '地図を右から出す / しまう' },
  'course.mapBig': { command: { id: 'course.mapBig' }, keys: ['M'], group: 'course', label: '地図を大きく / 元の大きさ' },
  'rel.toggle': { command: { id: 'rel.toggle' }, keys: ['r'], group: 'course', label: '差分のない相手を出す / しまう', help: '差分のない相手を右から出す / しまう（地図では「差分なし」の箱を押す）' },
  'rel.big': { command: { id: 'rel.big' }, keys: ['R'], group: 'course', label: '差分のない相手を大きく / 元の大きさ', help: '差分のない相手の引き出し・定義の引き出しを大きく / 元の大きさ' },
  'course.fold': { command: { id: 'course.fold' }, keys: ['b'], group: 'course', label: '右の水先案内をたたむ / 出す' },
  'jump.callee': { command: { id: 'jump.callee' }, keys: ['o'], group: 'course', label: '呼んでいる相手へ飛ぶ' },
  'home.tab.text': { command: { id: 'home.tab', tab: 'text' }, keys: ['1'], group: 'home', label: '説明のタブ' },
  'home.tab.map': { command: { id: 'home.tab', tab: 'map' }, keys: ['2'], group: 'home', label: '地図のタブ' },
  'home.stage': { command: { id: 'home.stage' }, keys: ['n'], group: 'home', label: '段を切り替える', help: '説明タブは「1 背景」と「2 この PR」を、地図タブは「① 背景」「② この PR」「③ マージ後」を順に切り替える' },
  enter: { command: { id: 'enter' }, keys: ['Enter'], group: 'fixed', label: '決める・次へ', help: '入口: 選んだコースに入る（なければ次のコース、全部完了なら締め） · 目的ごと: 追従グループを展開 / 畳む · 要求コース: わかったを付けて次の未確認の場所へ（章が済んだらその場に残る） · How コース: 問題なし · 次へ（読む前の案内では最初の未確認の場所へ、総括では完了） · 締め: GitHub で承認' },
  escape: { command: { id: 'escape' }, keys: ['Escape'], group: 'fixed', label: '閉じる', help: '閉じる・絞り込み解除。最後は入口へ' },
} satisfies Record<string, KeyAction>;

export type KeyActionId = keyof typeof KEY_ACTIONS;
/** 操作ごとの今のキー（既定 + 設定で変えたキー） */
export type Bindings = Readonly<Record<KeyActionId, readonly string[]>>;
type Keymap = NonNullable<UiSettings['keymap']>;
export interface KeyChange {
  action: KeyActionId;
  keys: readonly string[];
}

export const KEY_IDS = Object.keys(KEY_ACTIONS) as KeyActionId[];
const defaults = {} as Record<KeyActionId, readonly string[]>;
for (const id of KEY_IDS) defaults[id] = KEY_ACTIONS[id].keys;
export const DEFAULT_BINDINGS: Bindings = defaults;

const isActionId = (id: string): id is KeyActionId => Object.hasOwn(KEY_ACTIONS, id);
const isKeys = (x: unknown): x is string[] => Array.isArray(x) && x.every((k) => typeof k === 'string');

export function bindingsOf(keymap: Keymap | undefined): Bindings {
  if (!keymap) return DEFAULT_BINDINGS;
  const out: Record<KeyActionId, readonly string[]> = { ...DEFAULT_BINDINGS };
  // 知らない名前・変えられない操作・壊れた値（ui.json を手で直したとき）は既定のまま
  for (const [id, keys] of Object.entries(keymap)) if (isActionId(id) && KEY_ACTIONS[id].group !== 'fixed' && isKeys(keys)) out[id] = keys;
  return out;
}

export interface KeyMods {
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
}

export interface KeyResult {
  command: Command | null;
  /** 次のキーを待っている 1 キー目 */
  pending: string | null;
}

const MODIFIERS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'CapsLock', 'Process', 'Dead', 'Unidentified']);

/** 押したキーを表の書き方に。修飾キーだけ・Alt 付き（何も割り当てない）は null。スペースは 2 つ続けての区切りと紛れるので Space */
function keyName(key: string, mods: KeyMods): string | null {
  if (MODIFIERS.has(key) || mods.alt === true) return null;
  if (mods.meta === true || mods.ctrl === true) return `Mod+${key.length === 1 ? key.toLowerCase() : key}`;
  return key === ' ' ? 'Space' : key;
}

export function keyOfEvent(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): string | null {
  return keyName(e.key, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey });
}

/** Safari は変換を終えてから keydown を出す（isComposing は false）ので keyCode 229 でも見る */
export function composingKey(e: { isComposing: boolean; keyCode: number }): boolean {
  return e.isComposing || e.keyCode === 229;
}

function commandOf(bindings: Bindings, key: string): Command | null {
  const id = KEY_IDS.find((x) => bindings[x].includes(key));
  return id === undefined ? null : KEY_ACTIONS[id].command;
}

export function resolveKey(key: string, pending: string | null, mods: KeyMods = {}, bindings: Bindings = DEFAULT_BINDINGS): KeyResult {
  const k = keyName(key, mods);
  if (k === null) return { command: null, pending: null };
  // ⌘ / Ctrl 付きが来たら 2 キー目待ちは打ち切る
  if (pending !== null && !k.startsWith('Mod+')) return { command: commandOf(bindings, `${pending} ${k}`), pending: null };
  if (KEY_IDS.some((id) => bindings[id].some((x) => x.startsWith(`${k} `)))) return { command: null, pending: k };
  return { command: commandOf(bindings, k), pending: null };
}

/** 重なった画面（設定・? の一覧・パレット）の間も効かせるコマンド。閉じるか、ほかの重なった画面に替えるだけで、後ろの画面には効かない */
export const OVERLAY_COMMANDS: ReadonlySet<Command['id']> = new Set(['escape', 'help.keymap', 'palette.open']);

/** 同じキーか、片方が 2 つ続けての 1 つ目（g と g i） */
const overlaps = (a: string, b: string): boolean => a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);

/** key が action 以外の操作のキーと重なれば、その操作 */
export function conflictOf(bindings: Bindings, action: KeyActionId, key: string): KeyActionId | null {
  return KEY_IDS.find((id) => id !== action && bindings[id].some((k) => overlaps(k, key))) ?? null;
}

const unique = (keys: readonly string[]): string[] => keys.filter((k, i) => keys.indexOf(k) === i);

/**
 * 押したキーを action の欄 slot（null は足す）に置く変更。別の操作と重なれば、move はそこからキーを外し、
 * swap は替えた欄の元のキーをそこへ渡す（設定の「こちらに移す」「入れ替える」）
 */
export function placeKey(bindings: Bindings, action: KeyActionId, slot: number | null, key: string, how: 'move' | 'swap' = 'move'): KeyChange[] {
  const mine = [...bindings[action]];
  const old = slot === null ? undefined : mine[slot];
  if (slot === null) mine.push(key);
  else mine[slot] = key;
  const changes: KeyChange[] = [{ action, keys: unique(mine) }];
  const other = conflictOf(bindings, action, key);
  if (other !== null) {
    const give = how === 'swap' && old !== undefined && !bindings[other].includes(old) ? [old] : [];
    changes.push({ action: other, keys: bindings[other].flatMap((k) => (overlaps(k, key) ? give : [k])) });
  }
  return changes;
}

/** ui.json の keymap に変更を重ねる。既定と同じになった操作は消し、全部消えたら undefined */
export function keymapWith(keymap: Keymap | undefined, changes: readonly KeyChange[]): Keymap | undefined {
  const next: Keymap = { ...keymap };
  for (const { action, keys } of changes) {
    const def = KEY_ACTIONS[action].keys;
    if (keys.length === def.length && keys.every((k, i) => k === def[i])) delete next[action];
    else next[action] = [...keys];
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

const SHOWN: Record<string, string> = { ArrowDown: '↓', ArrowUp: '↑', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backspace: '⌫' };

function showOne(key: string): string {
  if (key.startsWith('Mod+')) return `⌘${showOne(key.slice(4))}`;
  if (/^[A-Z]$/.test(key)) return `⇧${key}`;
  if (/^[a-z]$/.test(key)) return key.toUpperCase();
  return SHOWN[key] ?? key;
}

/** 画面に出すキー: 'Mod+k' → '⌘K'、'M' → '⇧M'、'd' → 'D'、'g i' → 'G → I' */
export function showKey(key: string): string {
  return key.split(' ').map(showOne).join(' → ');
}
