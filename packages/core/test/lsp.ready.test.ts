// 待機の判定（設計書 9.1）。2026-09-21 に実機で採った通知列 3 本をゴールデンにして状態機械を回す。
//
// 一番大事なのは failed の列で settled にならないこと。壊れたインポートでも $/progress は正常に end するので、
// 標準の合図だけを見ると「準備完了・辺 0 本」を事実として書いてしまう（原則 1 / 2 に反する）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReadyWatcher, describePending, KOTLIN_IMPORT_NOTIFICATION, READY_GRACE_MS, type ReadyState } from '../src/lsp/ready.js';

interface Recorded {
  atMs: number;
  method: string;
  params: unknown;
}

const load = (name: string): Recorded[] =>
  JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../../../fixtures/order-service/lsp/notifications-${name}.json`), 'utf8')) as Recorded[];

/** 記録を頭から食わせ、最初に waiting でなくなった時点の状態とその時刻を返す */
function replay(name: string): { at: number; state: ReadyState } {
  const notes = load(name);
  const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
  let i = 0;
  const last = notes[notes.length - 1]!.atMs;
  for (let t = 0; t <= last + 1000; t += 100) {
    while (i < notes.length && notes[i]!.atMs <= t) {
      w.observe(notes[i]!.method, notes[i]!.params);
      i += 1;
    }
    const s = w.state(t);
    if (s.phase !== 'waiting') return { at: t, state: s };
  }
  return { at: -1, state: w.state(last + 1000) };
}

describe('createReadyWatcher', () => {
  it('冷えた起動: $/progress が全部 end してから settled（実測 10.6 秒）', () => {
    const { at, state } = replay('cold');
    expect(state).toEqual({ phase: 'settled', imported: true });
    expect(at).toBeGreaterThanOrEqual(10600);
    expect(at).toBeLessThan(11000);
  });

  it('succeeded が来ただけでは settled にしない（実測 3.2 秒時点の答えはまだ間違っている）', () => {
    expect(replay('cold').at).toBeGreaterThan(3238);
  });

  it('温まった起動: 実測 6.8 秒で settled', () => {
    const { at, state } = replay('warm');
    expect(state).toEqual({ phase: 'settled', imported: true });
    expect(at).toBeGreaterThanOrEqual(6800);
    expect(at).toBeLessThan(7300);
  });

  it('インポートに失敗した回は、$/progress が正常に end しても failed のまま', () => {
    const { state } = replay('failed');
    expect(state.phase).toBe('failed');
    if (state.phase !== 'failed') throw new Error('unreachable');
    expect(state.reason).toContain('Unable to import a Gradle project');
  });

  it('最初の begin が来る前は猶予のあいだ waiting（0 本を準備完了と読まない）', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    expect(w.state(0)).toEqual({ phase: 'waiting', openProgress: 0 });
    expect(w.state(READY_GRACE_MS - 1)).toEqual({ phase: 'waiting', openProgress: 0 });
    expect(w.state(READY_GRACE_MS)).toEqual({ phase: 'settled', imported: false });
  });

  it('結末を言わない importLog（ビルドログの行）は無視する', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    w.observe('intellij/importLog', { type: 2, message: '\tat org.gradle.Foo.bar(Foo.java:1)\n', failed: false, succeeded: false });
    expect(w.state(READY_GRACE_MS)).toEqual({ phase: 'settled', imported: false });
  });

  it('通知のメソッド名と欄の名前は設定で差し替えられる', () => {
    const w = createReadyWatcher({ method: 'custom/import', succeededField: 'done', failedField: 'broken' });
    w.observe('custom/import', { broken: true, message: 'だめでした' });
    expect(w.state(0)).toEqual({ phase: 'failed', reason: 'インポートに失敗しました: だめでした' });
  });

  it('message が無い失敗でも理由の欄を空にしない', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    w.observe('intellij/importLog', { failed: true });
    expect(w.state(0)).toEqual({ phase: 'failed', reason: 'インポートに失敗しました: 理由は受け取っていません' });
  });

  it('$/progress の report は開いている本数を変えない', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    w.observe('$/progress', { token: 't', value: { kind: 'begin', title: 'Importing' } });
    w.observe('$/progress', { token: 't', value: { kind: 'report', message: 'Gradle' } });
    expect(w.state(READY_GRACE_MS)).toEqual({ phase: 'waiting', openProgress: 1 });
    w.observe('$/progress', { token: 't', value: { kind: 'end' } });
    expect(w.state(READY_GRACE_MS)).toEqual({ phase: 'settled', imported: false });
  });
});

describe('pending（待っている間・時間切れのときに出す「終わっていない作業」）', () => {
  const progress = (token: string, value: Record<string, unknown>) => ['$/progress', { token, value }] as const;

  it('開いている作業を、題と最後の知らせ（無ければ割合）で返す。end したものは消える', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    w.observe(...progress('imp', { kind: 'begin', title: 'Importing' }));
    w.observe(...progress('imp', { kind: 'report', message: 'Gradle' }));
    w.observe(...progress('idx', { kind: 'begin', title: 'Indexing' }));
    w.observe(...progress('idx', { kind: 'report', message: '42%', percentage: 42 }));
    expect(w.pending().tasks).toEqual(['Importing（Gradle）', 'Indexing（42%）']);
    w.observe(...progress('idx', { kind: 'report', percentage: 57 }));
    expect(w.pending().tasks).toEqual(['Importing（Gradle）', 'Indexing（57%）']);
    w.observe(...progress('idx', { kind: 'end' }));
    expect(w.pending().tasks).toEqual(['Importing（Gradle）']);
  });

  it('題の無い作業は「（題なし）」。知らせも割合も無ければ題だけ', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    w.observe(...progress('a', { kind: 'begin' }));
    w.observe(...progress('b', { kind: 'begin', title: 'Indexing' }));
    expect(w.pending().tasks).toEqual(['（題なし）', 'Indexing']);
  });

  it('取り込みの記録（importLog）の最後の 1 行を返す。中身のある 1 行目だけ、長ければ切る', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    expect(w.pending().log).toBeUndefined();
    w.observe('intellij/importLog', { type: 4, message: '\n  Download https://repo.example.com/a/b/1.0/b-1.0.jar\nmore\n', failed: false, succeeded: false });
    expect(w.pending().log).toBe('Download https://repo.example.com/a/b/1.0/b-1.0.jar');
    w.observe('intellij/importLog', { type: 4, message: 'x'.repeat(300), failed: false, succeeded: false });
    expect(w.pending().log).toBe(`${'x'.repeat(160)}…`);
  });

  it('observe は、待ちの判定に使う通知（$/progress と importLog）のときだけ true', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    expect(w.observe(...progress('a', { kind: 'begin', title: 'Importing' }))).toBe(true);
    expect(w.observe('intellij/importLog', { message: 'x', failed: false, succeeded: false })).toBe(true);
    expect(w.observe('textDocument/publishDiagnostics', { uri: 'file:///x', diagnostics: [] })).toBe(false);
    expect(w.observe('$/progress', 'not an object')).toBe(false);
  });

  it('describePending は作業と記録を 1 文にする。どちらも無ければ空', () => {
    expect(describePending({ tasks: ['Importing（Gradle）', 'Indexing（42%）'], log: 'Download x.jar' })).toBe('終わっていない作業: Importing（Gradle）、Indexing（42%）。最後のインポートのログ: Download x.jar');
    expect(describePending({ tasks: ['Importing（Gradle）'] })).toBe('終わっていない作業: Importing（Gradle）');
    expect(describePending({ tasks: [], log: 'Download x.jar' })).toBe('最後のインポートのログ: Download x.jar');
    expect(describePending({ tasks: [] })).toBe('');
  });
});

describe('describePending（サーバーのログ）', () => {
  it('サーバーのログの最後の行があれば後ろに足す', () => {
    expect(describePending({ tasks: ['Importing（Gradle）'], log: 'Importing with Gradle: /w/head', serverLog: 'Resolve dependencies of :app:compileClasspath started' })).toBe(
      '終わっていない作業: Importing（Gradle）。最後のインポートのログ: Importing with Gradle: /w/head。サーバーのログの最後: Resolve dependencies of :app:compileClasspath started',
    );
  });
});

// プロジェクト構造の書き出しは、取り込みが終わったらすぐ行い、索引を待たない（設計書 9.1。2026-10-19 実測）
describe('imported', () => {
  it('取り込みの成功を言われたら true。索引の $/progress が開いていても', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    w.observe('$/progress', { token: 'imp', value: { kind: 'begin', title: 'Importing' } });
    expect(w.imported()).toBe(false);
    w.observe('intellij/importLog', { message: 'Workspace imported successfully', failed: false, succeeded: true });
    w.observe('$/progress', { token: 'idx', value: { kind: 'begin', title: 'Indexing' } });
    expect(w.imported()).toBe(true);
    expect(w.state(10_000).phase).toBe('waiting');
  });

  it('失敗を言われたら false', () => {
    const w = createReadyWatcher(KOTLIN_IMPORT_NOTIFICATION);
    w.observe('intellij/importLog', { message: 'Unable to import', failed: true, succeeded: false });
    expect(w.imported()).toBe(false);
  });
});
