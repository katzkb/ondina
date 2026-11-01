// 層の割当（設計書 5.2 の 4）。ondina.config.yaml の layers の glob を repo 相対パスに当てる。
//
// - 上から順に見て、最初に当たった層を返す（1 つのファイルが 2 つの層に当たることがある。
//   例: src/test/kotlin/com/example/order/domain/OrderTest.kt は Tests にも Domain にも当たる）。
//   設定を書く人が並び順で決められるようにしてある
// - どの glob にも当たらなければ層なし（undefined）。当たらないファイルの推定は M2（10 章の layerGuesses）
import picomatch from 'picomatch';
import type { AnalysisConfig, Layer, Provenance } from '../model.js';

export type LayerRule = AnalysisConfig['layers'][number];

/**
 * layers の glob を先に組み立てて、パスを層に割り当てる関数を返す。
 * picomatch.isMatch は呼ぶたびに glob をコンパイルし直すので、1 回の解析で何度も当てるときはこちらを使う。
 */
export function createLayerAssigner(layers: readonly LayerRule[]): (path: string) => Layer | undefined {
  const compiled = layers.filter((l) => l.match.length > 0).map((l) => ({ name: l.name, isMatch: picomatch(l.match) }));
  return (path) => compiled.find((c) => c.isMatch(path))?.name;
}

/** repo 相対パスの層。どの層にも当たらなければ undefined。1 件だけ当てるとき用 */
export function assignLayer(path: string, layers: readonly LayerRule[]): Layer | undefined {
  return createLayerAssigner(layers)(path);
}

/** テストの見分け（設計書 5.2 の 7）。provenance はどこから決めたか（無い = 決める材料が無く、何もテストにしない） */
export interface TestPaths {
  isTest: (path: string) => boolean;
  provenance?: Extract<Provenance, 'config' | 'llm'>;
}

/**
 * どのパスがテストか。hunk の kind（地図から外す・束に入れない）と、言語サーバーのテストの辺・testCount の両方がこれを使う。
 * 1. 設定: layers の "Tests"（大文字小文字は見ない）の glob と、sourceRoots のうち test というディレクトリ名を含むもの（config）
 * 2. 設定に無ければ構成の推定（10.6）のテストの置き場。ディレクトリは下も含む、ファイルは完全一致（llm）
 * 3. どちらも無ければ何もテストにしない。名前の決まり（src/test など）は持たない（ondina はリポジトリの形を仮定しない）
 */
export function testPathsFor(config: Pick<AnalysisConfig, 'layers' | 'sourceRoots'>, inferred?: readonly string[]): TestPaths {
  const globs = [
    ...config.layers.filter((l) => l.name.toLowerCase() === 'tests').flatMap((l) => l.match),
    ...config.sourceRoots.filter((r) => r.split('/').includes('test')).map((r) => `${r}/**`),
  ];
  if (globs.length > 0) return { isTest: picomatch(globs), provenance: 'config' };
  if (inferred === undefined) return { isTest: () => false };
  const at = [...inferred];
  return { isTest: (path) => at.some((t) => path === t || path.startsWith(`${t}/`)), provenance: 'llm' };
}
