// fixtures/order-service の差分に対する Analysis.defs（設計書 3.6 / 9.2）。
// 実機で採った答え（lsp/definitions.json）だけで回る。kotlin-lsp は起動しない。ゴールデンは expected/definitions.json
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DefTarget } from '@ondina/model';
import { extractAllHunks } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import { buildDefinitions, drawerFiles } from '../src/lsp/definitions.js';
import { changedFixtureFiles, FIXTURE_ROOT, readFixtureDefinitions, readFixtureHead } from './fixture.js';

const D = 'src/main/kotlin/com/example/order/';

async function run() {
  const files = changedFixtureFiles();
  const hunks = (await extractAllHunks(files)).map(toHunk);
  return buildDefinitions(readFixtureDefinitions(), hunks, new Set(files.map((f) => f.path)));
}

/** head のその行で、その名前の行き先 */
async function targetOf(rel: string, line: number, name: string): Promise<DefTarget | undefined> {
  const defs = await run();
  const text = readFixtureHead(D + rel)!.split('\n')[line - 1]!;
  const n = defs.files.find((f) => f.side === 'head' && f.path === D + rel)?.names.find(([l, c, len]) => l === line && text.slice(c, c + len) === name);
  return n === undefined ? undefined : defs.targets[n[3]];
}

describe('buildDefinitions（fixture・実機の記録）', () => {
  it('差分の中の定義は、差分の列の行の見え方つき（OrderController の execute → ApplyDiscountUseCase.execute）', async () => {
    expect(await targetOf('api/OrderController.kt', 18, 'execute')).toEqual({ side: 'head', path: D + 'application/ApplyDiscountUseCase.kt', line: 15, col: 8, shown: { hunkId: expect.any(String), side: 'RIGHT', line: 15 } });
  });

  it('差分の無いファイルの定義は見え方なし（save → OrderRepository.kt）', async () => {
    expect(await targetOf('api/OrderController.kt', 19, 'save')).toEqual({ side: 'head', path: D + 'domain/OrderRepository.kt', line: 5, col: 8 });
  });

  it('変わったファイルの差分の外の行の名前も聞いている（コースと目的ごとの画面はファイル全体を出す。OrderTest の 9 行目の OrderId）', async () => {
    const defs = await run();
    const test = 'src/test/kotlin/com/example/order/domain/OrderTest.kt';
    const text = readFixtureHead(test)!.split('\n')[8]!;
    const n = defs.files.find((f) => f.side === 'head' && f.path === test)?.names.find(([l, c, len]) => l === 9 && text.slice(c, c + len) === 'OrderId');
    expect(n).toBeDefined();
    expect(defs.targets[n![3]]).toEqual({ side: 'head', path: D + 'domain/OrderId.kt', line: 3, col: 11 });
    // head のファイルはどれも全部の行を聞いた。差分の行だけ聞いた（part）のは base だけ
    expect(defs.files.filter((f) => f.part === true).every((f) => f.side === 'base')).toBe(true);
  });

  it('ライブラリは jar の名前（PostMapping → spring-web）', async () => {
    expect(await targetOf('api/OrderController.kt', 16, 'PostMapping')).toEqual({ lib: 'spring-web-6.2.0.jar' });
  });

  it('宣言の名前（自分自身）は入れない（apply の宣言）', async () => {
    expect(await targetOf('api/OrderController.kt', 17, 'apply')).toBeUndefined();
  });

  it('引き出しに出すファイルは、変わっていないファイルも、変わったファイルの差分の外の行も。全部の名前を聞いたか、その先（名前を聞いていない）', async () => {
    const defs = await run();
    const drawer = drawerFiles(defs.targets).map((f) => `${f.side}:${f.path.slice(D.length)}`);
    expect(drawer).toEqual(expect.arrayContaining(['head:domain/OrderRepository.kt', 'head:domain/OrderId.kt', 'head:api/OrderController.kt']));
    const asked = new Map(defs.files.map((f) => [`${f.side}:${f.path.slice(D.length)}`, f]));
    expect(asked.get('head:domain/OrderRepository.kt')).not.toHaveProperty('part');
    // 変わったファイルは、引き出しに出すなら全部の名前を聞いている（差分の行だけではない）
    expect(asked.get('head:api/OrderController.kt')).not.toHaveProperty('part');
  });

  it('名前の行き先の添字はどれも targets にある。行・列の順に並ぶ', async () => {
    const defs = await run();
    for (const f of defs.files) {
      expect(f.names.every(([, , , t]) => defs.targets[t] !== undefined)).toBe(true);
      const keys = f.names.map(([l, c]) => l * 10000 + c);
      expect(keys).toEqual([...keys].sort((a, b) => a - b));
    }
  });

  it('ゴールデン', async () => {
    await expect(JSON.stringify(await run(), null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/definitions.json'));
  });
});
