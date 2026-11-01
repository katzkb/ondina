// 層の推定（設計書 10.2 の layerGuesses）。LLM が出した推定のうち、通すものをプログラムが決める。
import { describe, expect, it } from 'vitest';
import type { Symbol as OndinaSymbol } from '@ondina/model';
import { applyLayerGuesses, verifyLayerGuesses } from '../src/layers/guesses.js';

const LAYERS = [
  { name: 'Domain', match: ['**/domain/**'] },
  { name: 'Infrastructure', match: ['**/infra/**'] },
];
const LOGGER = 'src/main/kotlin/com/example/common/Logger.kt';
const MAILER = 'src/main/kotlin/com/example/notification/OrderMailer.kt';
const ctx = { layers: LAYERS, unlayeredPaths: [LOGGER, MAILER] };

const sym = (path: string, over: Partial<OndinaSymbol> = {}): OndinaSymbol => ({ id: `id-${path}-${over.fqName ?? ''}`, fqName: 'x.y', path, kind: 'function', changed: true, ...over });

describe('verifyLayerGuesses', () => {
  it('実在する層で、層が付いていないパスの推定だけ通す', () => {
    const { kept, info } = verifyLayerGuesses([{ path: LOGGER, layer: 'Infrastructure' }], ctx);
    expect(kept).toEqual([{ path: LOGGER, layer: 'Infrastructure' }]);
    expect(info).toEqual([]);
  });

  it('設定に無い層の名前は捨てて、理由を残す', () => {
    const { kept, info } = verifyLayerGuesses([{ path: LOGGER, layer: 'Utility' }], ctx);
    expect(kept).toEqual([]);
    expect(info[0]).toContain('設定にない層 Utility');
  });

  it('層が決まっているパス（unlayeredPaths に無い）は捨てる', () => {
    const { kept, info } = verifyLayerGuesses([{ path: 'src/main/kotlin/com/example/order/domain/Order.kt', layer: 'Infrastructure' }], ctx);
    expect(kept).toEqual([]);
    expect(info[0]).toContain('glob で層が決まっている');
  });

  it('同じパスが 2 回来たら最初だけ採る', () => {
    const { kept, info } = verifyLayerGuesses(
      [
        { path: LOGGER, layer: 'Domain' },
        { path: LOGGER, layer: 'Infrastructure' },
      ],
      ctx,
    );
    expect(kept).toEqual([{ path: LOGGER, layer: 'Domain' }]);
    expect(info[0]).toContain('重複');
  });

  it('空なら何も起きない', () => {
    expect(verifyLayerGuesses([], ctx)).toEqual({ kept: [], info: [] });
  });
});

describe('applyLayerGuesses', () => {
  it('通った推定を当てて layerProvenance: llm を付ける', () => {
    const out = applyLayerGuesses([sym(LOGGER)], [{ path: LOGGER, layer: 'Infrastructure' }]);
    expect(out[0]).toMatchObject({ layer: 'Infrastructure', layerProvenance: 'llm' });
  });

  it('glob で層が付いているシンボルは触らない（事実が推測に上書きされない）', () => {
    const fixed = sym('src/main/kotlin/com/example/order/domain/Order.kt', { layer: 'Domain', layerProvenance: 'config' });
    const out = applyLayerGuesses([fixed], [{ path: fixed.path, layer: 'Infrastructure' }]);
    expect(out[0]).toEqual(fixed);
  });

  it('同じパスのシンボルが複数あれば全部に付く', () => {
    const out = applyLayerGuesses([sym(LOGGER, { fqName: 'a' }), sym(LOGGER, { fqName: 'b' }), sym(MAILER)], [{ path: LOGGER, layer: 'Domain' }]);
    expect(out.filter((s) => s.layer === 'Domain')).toHaveLength(2);
    expect(out[2]).not.toHaveProperty('layer');
  });

  it('推定が無ければそのまま返す', () => {
    const symbols = [sym(LOGGER)];
    expect(applyLayerGuesses(symbols, [])).toEqual(symbols);
  });
});
