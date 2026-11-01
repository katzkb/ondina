// 層の割当（設計書 5.2 の 4）。設定の layers を上から順に見て、最初に当たった層を返す。
// 当たらないファイルは層なし（M1 では推定しない。推定は M2）。
import { describe, expect, it } from 'vitest';
import { assignLayer, createLayerAssigner, testPathsFor } from '../src/layers/assign.js';

const API = { name: 'API', match: ['**/api/**'] };
const APPLICATION = { name: 'Application', match: ['**/application/**', '**/usecase/**'] };
const DOMAIN = { name: 'Domain', match: ['**/domain/**'] };
const INFRA = { name: 'Infrastructure', match: ['**/infra/**', 'src/main/resources/db/**'] };
const TESTS = { name: 'Tests', match: ['src/test/**'] };

describe('assignLayer', () => {
  it('glob に当たったファイルにその層を付ける', () => {
    expect(assignLayer('src/main/kotlin/com/example/order/api/OrderController.kt', [API, DOMAIN])).toBe('API');
    expect(assignLayer('src/main/kotlin/com/example/order/domain/Order.kt', [API, DOMAIN])).toBe('Domain');
  });

  it('層の 2 つ目以降の glob にも当たる', () => {
    expect(assignLayer('src/main/kotlin/com/example/order/usecase/Foo.kt', [APPLICATION])).toBe('Application');
    expect(assignLayer('src/main/resources/db/migration/V421__discount.sql', [INFRA])).toBe('Infrastructure');
  });

  it('どの glob にも当たらなければ層なし', () => {
    expect(assignLayer('src/main/kotlin/com/example/admin/OrderAdminView.kt', [API, APPLICATION, DOMAIN, INFRA, TESTS])).toBeUndefined();
  });

  it('複数の層に当たったら、上から順で最初に当たった層が勝つ', () => {
    // src/test/kotlin/com/example/order/domain/OrderTest.kt は Tests にも Domain にも当たる
    const p = 'src/test/kotlin/com/example/order/domain/OrderTest.kt';
    expect(assignLayer(p, [TESTS, DOMAIN])).toBe('Tests');
    expect(assignLayer(p, [DOMAIN, TESTS])).toBe('Domain');
  });

  it('**/ は 0 段でも当たる', () => {
    expect(assignLayer('api/OrderController.kt', [API])).toBe('API');
  });

  it('* はディレクトリの区切りを越えない', () => {
    expect(assignLayer('src/main/kotlin/Foo.kt', [{ name: 'X', match: ['src/*/Foo.kt'] }])).toBeUndefined();
    expect(assignLayer('src/main/Foo.kt', [{ name: 'X', match: ['src/*/Foo.kt'] }])).toBe('X');
  });

  it('layers が空、または match が空の層しかなければ層なし', () => {
    expect(assignLayer('src/main/kotlin/com/example/order/api/OrderController.kt', [])).toBeUndefined();
    expect(assignLayer('src/main/kotlin/com/example/order/api/OrderController.kt', [{ name: 'API', match: [] }])).toBeUndefined();
  });
});

describe('createLayerAssigner', () => {
  const layers = [TESTS, API, APPLICATION, DOMAIN, INFRA];

  it('組み立てた関数は assignLayer と同じ結果を返し、何度でも使える', () => {
    const layerOf = createLayerAssigner(layers);
    for (const p of [
      'src/main/kotlin/com/example/order/api/OrderController.kt',
      'src/main/kotlin/com/example/order/domain/Order.kt',
      'src/test/kotlin/com/example/order/domain/OrderTest.kt',
      'src/main/resources/db/migration/V421__discount.sql',
      'src/main/kotlin/com/example/admin/OrderAdminView.kt',
    ]) {
      expect(layerOf(p), p).toBe(assignLayer(p, layers));
      expect(layerOf(p), `${p}（2 回目）`).toBe(assignLayer(p, layers));
    }
  });

  it('match が空の層は組み立ての時点で外れる', () => {
    const layerOf = createLayerAssigner([{ name: 'Empty', match: [] }, API]);
    expect(layerOf('src/main/kotlin/com/example/order/api/OrderController.kt')).toBe('API');
  });
});

describe('testPathsFor', () => {
  const none = { sourceRoots: [], layers: [] };

  it('設定の layers の Tests の glob でテストかどうかを決める（config）', () => {
    const tests = testPathsFor({ sourceRoots: [], layers: [{ name: 'Tests', match: ['src/test/**'] }, { name: 'Domain', match: ['**/domain/**'] }] });
    expect(tests.provenance).toBe('config');
    expect(tests.isTest('src/test/kotlin/com/example/order/domain/OrderTest.kt')).toBe(true);
    expect(tests.isTest('src/main/kotlin/com/example/order/domain/Order.kt')).toBe(false);
  });

  it('層の名前は大文字小文字を見ない', () => {
    expect(testPathsFor({ sourceRoots: [], layers: [{ name: 'tests', match: ['spec/**'] }] }).isTest('spec/a.kt')).toBe(true);
  });

  it('設定の sourceRoots のうち test というディレクトリ名を含むものもテストの置き場（config）', () => {
    const tests = testPathsFor({ sourceRoots: ['src/main/kotlin', 'src/test/kotlin'], layers: [] });
    expect(tests.provenance).toBe('config');
    expect(tests.isTest('src/test/kotlin/a/OrderTest.kt')).toBe(true);
    expect(tests.isTest('src/main/kotlin/a/Order.kt')).toBe(false);
  });

  it('設定にテストの置き場があれば、構成の推定は使わない', () => {
    const tests = testPathsFor({ sourceRoots: ['src/test/kotlin'], layers: [] }, ['api/src/test']);
    expect(tests.provenance).toBe('config');
    expect(tests.isTest('api/src/test/kotlin/a/OrderTest.kt')).toBe(false);
  });

  it('設定に無ければ構成の推定のディレクトリ（下も含む）とファイルを使う（llm）', () => {
    const tests = testPathsFor(none, ['api/src/test', 'src/app/OrderServiceTest.kt']);
    expect(tests.provenance).toBe('llm');
    expect(tests.isTest('api/src/test/kotlin/a/OrderControllerTest.kt')).toBe(true);
    expect(tests.isTest('api/src/testing/a/Helper.kt')).toBe(false);
    expect(tests.isTest('src/app/OrderServiceTest.kt')).toBe(true);
    expect(tests.isTest('src/app/OrderService.kt')).toBe(false);
  });

  it('推定したテストの置き場が空でも推定は推定（llm。何もテストにしない）', () => {
    const tests = testPathsFor(none, []);
    expect(tests.provenance).toBe('llm');
    expect(tests.isTest('src/test/kotlin/a/OrderTest.kt')).toBe(false);
  });

  it('設定も推定も無ければ何もテストにしない（名前の決まりを持たない）', () => {
    const tests = testPathsFor(none);
    expect(tests.provenance).toBeUndefined();
    expect(tests.isTest('src/test/kotlin/a/OrderTest.kt')).toBe(false);
  });
});
