// 保存した構成を層の規則に組み直す・推定の後に増えた未分類のファイルを数える（設計書 10.6）。
import { describe, expect, it } from 'vitest';
import { createLayerAssigner } from '../src/layers/assign.js';
import { structureRules, unclassifiedSince, isStructureWarn } from '../src/structure/assign.js';

const structure = {
  layers: [{ name: 'API', why: '' }, { name: 'Application', why: '' }, { name: 'Infrastructure', why: '' }],
  dirs: [{ dir: 'src', layer: 'Application' }, { dir: 'src/api', layer: 'API' }],
  files: [{ path: 'src/app/OrderRepository.kt', layer: 'Infrastructure' }],
  outside: ['docs'],
};

describe('structureRules', () => {
  it('ファイルの完全一致 > 深いディレクトリ > 浅いディレクトリの順に当たる', () => {
    const layerOf = createLayerAssigner(structureRules(structure));
    expect(layerOf('src/app/OrderRepository.kt')).toBe('Infrastructure');
    expect(layerOf('src/api/v1/OrderController.kt')).toBe('API');
    expect(layerOf('src/app/OrderService.kt')).toBe('Application');
    expect(layerOf('docs/README.md')).toBeUndefined();
    expect(layerOf('build.gradle.kts')).toBeUndefined();
  });

  it('パスの glob の特殊文字はそのままの文字として当てる', () => {
    const layerOf = createLayerAssigner(structureRules({ ...structure, dirs: [{ dir: 'web/[id]', layer: 'API' }], files: [{ path: 'web/a+b(1).kt', layer: 'Application' }] }));
    expect(layerOf('web/[id]/page.kt')).toBe('API');
    expect(layerOf('web/i/page.kt')).toBeUndefined();
    expect(layerOf('web/a+b(1).kt')).toBe('Application');
  });

  it('"." はリポジトリ直下のファイルだけ（入力で直下のファイルを "." にまとめているので。下のディレクトリは含まない）', () => {
    const layerOf = createLayerAssigner(structureRules({ ...structure, dirs: [{ dir: '.', layer: 'API' }], files: [] }));
    expect(layerOf('build.gradle.kts')).toBe('API');
    expect(layerOf('src/app/OrderService.kt')).toBeUndefined();
  });
});

describe('unclassifiedSince', () => {
  const known = ['src/app/OrderService.kt', 'docs/README.md', 'build.gradle.kts', 'tools/gen.sh'];
  it('推定の後に増えたファイルのうち、どの層にも対象外にも入らないものだけ数える', () => {
    const now = [...known, 'src/api/New.kt', 'docs/new.md', 'tools/new.sh', 'scripts/a.sh', 'scripts/b.sh'];
    expect(unclassifiedSince({ ...structure, known }, now)).toEqual(['scripts/a.sh', 'scripts/b.sh', 'tools/new.sh']);
  });

  it('対象外の "." は直下のファイルだけ。下のディレクトリに増えたファイルは数える（2026-10-09 に本物の LLM が "." を対象外にした）', () => {
    const now = [...known, 'settings.gradle.kts', 'scripts/a.sh'];
    expect(unclassifiedSince({ ...structure, outside: ['.'], known }, now)).toEqual(['scripts/a.sh']);
  });

  it('推定のときからあった未分類のファイルは数えない', () => {
    expect(unclassifiedSince({ ...structure, known }, known)).toEqual([]);
  });
});

describe('isStructureWarn', () => {
  it('推定時のファイル数の 5% 以上（最低 5 件）で警告する', () => {
    expect(isStructureWarn(4, 10)).toBe(false);
    expect(isStructureWarn(5, 10)).toBe(true);
    expect(isStructureWarn(49, 1000)).toBe(false);
    expect(isStructureWarn(50, 1000)).toBe(true);
  });
});
