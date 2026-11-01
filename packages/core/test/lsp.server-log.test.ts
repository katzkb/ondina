// kotlin-lsp（IntelliJ）が自分のログに書く行から、待っている間に出す 1 行を選ぶ（設計書 9.1）。
// Gradle の細かい進み（依存の解決・取得など）は知らせ（$/progress・importLog）に来ず、このログにだけ書かれる（2026-10-10 実測）。
import { describe, expect, it } from 'vitest';
import { lastServerLogLine } from '../src/lsp/server-log.js';

const info = (msg: string) => `2026-10-10 00:46:30,370 [   1901]   INFO - #c.i.l.s.i.ImportExecutionKt - ${msg}`;

describe('lastServerLogLine', () => {
  it('最後の [IMPORT PROGRESS] の中身を返す', () => {
    const text = [
      info('[IMPORT PROGRESS]: Run build started'),
      '2026-10-10 00:46:30,022 [   1553]   INFO - #c.i.l.s.w.LsWorkspaceKt - Updated 8 files',
      info('[IMPORT PROGRESS]: Resolve dependencies of :app:compileClasspath started'),
      '2026-10-10 00:46:31,000 [   2000]   INFO - #c.i.l.s.w.LsWorkspaceKt - Updated 3 files',
      '',
    ].join('\n');
    expect(lastServerLogLine(text)).toBe('Resolve dependencies of :app:compileClasspath started');
  });

  it('WARN と ERROR の行も拾う。後に書かれた方を返す', () => {
    const text = [
      info('[IMPORT PROGRESS]: Run build started'),
      '2026-10-10 00:47:00,000 [  31000]   WARN - #o.g.t.i.c.DefaultConnection - Connection to the Gradle daemon timed out',
    ].join('\n');
    expect(lastServerLogLine(text)).toBe('Connection to the Gradle daemon timed out');
    expect(lastServerLogLine(`${text}\n2026-10-10 00:47:01,000 [  32000]  ERROR - #c.j.l.i.g.GradleWorkspaceImporter - Could not resolve com.example:lib:1.0`)).toBe('Could not resolve com.example:lib:1.0');
  });

  it('ほかの INFO の行しか無ければ undefined', () => {
    expect(lastServerLogLine('2026-10-10 00:46:30,022 [   1553]   INFO - #c.i.l.s.w.LsWorkspaceKt - Updated 8 files\n')).toBeUndefined();
    expect(lastServerLogLine('')).toBeUndefined();
  });

  it('長ければ 160 文字で切る', () => {
    expect(lastServerLogLine(info(`[IMPORT PROGRESS]: Download ${'x'.repeat(300)}`))).toBe(`Download ${'x'.repeat(151)}…`);
  });
});
