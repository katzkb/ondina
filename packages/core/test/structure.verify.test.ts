// 構成の推定の検査（設計書 10.6）。LLM が書いた層・振り分けのうち、実在するパスと実在する層名のものだけ通す（原則 3）。
import { describe, expect, it } from 'vitest';
import { verifyStructure, MAX_LAYERS } from '../src/structure/verify.js';

const PATHS = ['src/api/OrderController.kt', 'src/app/OrderService.kt', 'src/app/OrderRepository.kt', 'docs/README.md', 'build.gradle.kts', 'api/src/test/kotlin/OrderControllerTest.kt', 'src/app/OrderServiceTest.kt'];
const base = { layers: [{ name: 'API', why: '' }, { name: 'Application', why: '' }, { name: 'Infrastructure', why: '' }], dirs: [], files: [], outside: [], tests: [] };

describe('verifyStructure', () => {
  it('実在するディレクトリ・ファイルと、層にある名前のものを通す', () => {
    const { structure, info } = verifyStructure(
      { ...base, dirs: [{ dir: 'src/api', layer: 'API' }, { dir: 'src/app', layer: 'Application' }], files: [{ path: 'src/app/OrderRepository.kt', layer: 'Infrastructure' }], outside: ['docs'] },
      PATHS,
    );
    expect(structure).toEqual({
      layers: base.layers,
      dirs: [{ dir: 'src/api', layer: 'API' }, { dir: 'src/app', layer: 'Application' }],
      files: [{ path: 'src/app/OrderRepository.kt', layer: 'Infrastructure' }],
      outside: ['docs'],
      tests: [],
    });
    expect(info).toEqual([]);
  });

  it('末尾の / と ./ は落として比べる。"." はリポジトリ直下（直下にファイルがあれば実在）', () => {
    const { structure } = verifyStructure({ ...base, dirs: [{ dir: './src/api/', layer: 'API' }, { dir: '.', layer: 'Application' }] }, PATHS);
    expect(structure.dirs).toEqual([{ dir: 'src/api', layer: 'API' }, { dir: '.', layer: 'Application' }]);
  });

  it('実在しないパス・層に無い名前・重複は捨てて理由を残す', () => {
    const { structure, info } = verifyStructure(
      {
        ...base,
        dirs: [{ dir: 'src/nope', layer: 'API' }, { dir: 'src/api', layer: 'Web' }, { dir: 'src/app', layer: 'Application' }, { dir: 'src/app', layer: 'API' }],
        files: [{ path: 'src/app/Nope.kt', layer: 'API' }, { path: 'src/api/OrderController.kt', layer: 'API' }],
      },
      PATHS,
    );
    expect(structure.dirs).toEqual([{ dir: 'src/app', layer: 'Application' }]);
    expect(structure.files).toEqual([{ path: 'src/api/OrderController.kt', layer: 'API' }]);
    expect(info).toEqual([
      '構成の推定を除外しました（ないディレクトリ）: src/nope',
      '構成の推定を除外しました（層にない名前 Web）: src/api',
      '構成の推定が重複していたので後のほうを除外しました: src/app',
      '構成の推定を除外しました（ないファイル）: src/app/Nope.kt',
      '構成の推定を除外しました（振り分けのない層）: Infrastructure',
    ]);
  });

  it('層の名前は前後の空白を落とし、空と重複を捨てる。9 個目からは捨てる', () => {
    const names = ['A', ' B ', '', 'B', ...Array.from({ length: MAX_LAYERS }, (_, i) => `L${i}`)];
    const { structure, info } = verifyStructure({ layers: names.map((name) => ({ name, why: '' })), dirs: [{ dir: '.', layer: 'A' }, { dir: 'src', layer: 'B' }, ...Array.from({ length: MAX_LAYERS }, (_, i) => ({ dir: 'src/api', layer: `L${i}` }))], files: [], outside: [], tests: [] }, PATHS);
    expect(structure.layers.map((l) => l.name)).toEqual(['A', 'B', 'L0']);
    expect(info).toContain('構成の推定の層が多すぎるので 9 個目から除外しました: L6, L7');
  });

  it('直下にファイルが無ければ "." は無いディレクトリとして捨てる', () => {
    const { structure, info } = verifyStructure({ ...base, dirs: [{ dir: 'src/api', layer: 'API' }], outside: ['.'] }, PATHS.filter((p) => p.includes('/')));
    expect(structure.outside).toEqual([]);
    expect(info).toContain('構成の推定を除外しました（ないディレクトリ）: .');
  });

  it('同じディレクトリが dirs と outside の両方にあれば dirs を採る', () => {
    const { structure, info } = verifyStructure({ ...base, dirs: [{ dir: 'src/api', layer: 'API' }], outside: ['src/api', 'docs/'] }, PATHS);
    expect(structure.outside).toEqual(['docs']);
    expect(info).toContain('構成の推定を除外しました（層に振ったディレクトリ）: src/api');
  });

  it('テストの置き場は、実在するディレクトリ（"." は不可）かファイルだけ通す。重複は最初だけ（5.2 の 7）', () => {
    const { structure, info } = verifyStructure(
      { ...base, dirs: [{ dir: 'src/api', layer: 'API' }], tests: ['./api/src/test/', 'src/app/OrderServiceTest.kt', 'api/src/test', 'src/nope', 'src/app/Nope.kt', '.'] },
      PATHS,
    );
    expect(structure.tests).toEqual(['api/src/test', 'src/app/OrderServiceTest.kt']);
    expect(info).toEqual([
      '構成の推定のテストの置き場が重複していたので後のほうを除外しました: api/src/test',
      '構成の推定のテストの置き場を除外しました（ないディレクトリかファイル）: src/nope',
      '構成の推定のテストの置き場を除外しました（ないディレクトリかファイル）: src/app/Nope.kt',
      '構成の推定のテストの置き場を除外しました（リポジトリ全体は指せない）: .',
      '構成の推定を除外しました（振り分けのない層）: Application',
      '構成の推定を除外しました（振り分けのない層）: Infrastructure',
    ]);
  });
});
