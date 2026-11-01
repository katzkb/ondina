// fixtures/order-service の差分に対する Analysis.symbols（設計書 4 章 / 5.2 の 4）。ゴールデンは expected/symbols.json。
// 層は ondina.config.yaml の glob で決まる。当たらないファイルの推定は M2 なので、ここでは層なしのまま残る。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Symbol as OndinaSymbol } from '@ondina/model';
import { parseConfig, splitConfig } from '../src/config/load.js';
import { extractAllHunks } from '../src/hunks/extract.js';
import { toHunk } from '../src/hunks/to-hunk.js';
import { buildSymbols } from '../src/symbols/build.js';
import { changedFixtureFiles, FIXTURE_ROOT } from './fixture.js';

let cached: Promise<OndinaSymbol[]> | undefined;
function run() {
  cached ??= (async () => {
    const hunks = (await extractAllHunks(changedFixtureFiles())).map(toHunk);
    const config = splitConfig(parseConfig(readFileSync(path.join(FIXTURE_ROOT, 'ondina.config.yaml'), 'utf8'))).analysis;
    return buildSymbols(hunks, config.layers);
  })();
  return cached;
}

describe('buildSymbols（fixture）', () => {
  it('hunk と 1 対 1 で 48 件、全部 changed で hunkId を持つ', async () => {
    const symbols = await run();
    expect(symbols).toHaveLength(48);
    expect(symbols.every((s) => s.changed && s.hunkId === s.id)).toBe(true);
  });

  it('層が付くのは 48 件中 22 件で、残りは層なし（推定は M2）', async () => {
    const symbols = await run();
    const layered = symbols.filter((s) => s.layer !== undefined);
    expect(layered).toHaveLength(22);
    expect(layered.every((s) => s.layerProvenance === 'config')).toBe(true);
    const byLayer = (name: string) => layered.filter((s) => s.layer === name).length;
    expect({ Tests: byLayer('Tests'), API: byLayer('API'), Application: byLayer('Application'), Domain: byLayer('Domain'), Infrastructure: byLayer('Infrastructure') }).toEqual({
      Tests: 7,
      API: 7,
      Application: 2,
      Domain: 3,
      Infrastructure: 3,
    });
  });

  it('テストは domain/ や infra/ の下にあっても Tests になる（上から順で最初に当たった層）', async () => {
    const symbols = await run();
    const tests = symbols.filter((s) => s.path.startsWith('src/test/'));
    expect(new Set(tests.map((s) => s.path)).size).toBe(3);
    expect(tests.every((s) => s.layer === 'Tests')).toBe(true);
  });

  it('追従グループのファイル（admin / cart など）は層なしのまま', async () => {
    const symbols = await run();
    const admin = symbols.find((s) => s.path.includes('/admin/'))!;
    expect(admin.layer).toBeUndefined();
    expect(admin).not.toHaveProperty('layerProvenance');
  });

  it('testCount はどのシンボルにも入っていない（未計測。M2 で LSP から）', async () => {
    const symbols = await run();
    expect(symbols.some((s) => 'testCount' in s)).toBe(false);
  });

  it('ゴールデン expected/symbols.json と一致する', async () => {
    const symbols = await run();
    await expect(JSON.stringify(symbols, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/symbols.json'));
  });
});
