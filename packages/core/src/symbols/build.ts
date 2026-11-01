// Analysis.symbols を組み立てる（設計書 4 章 / 5.2 の 4）。
//
// M1 の範囲: 変更された hunk と 1 対 1。id は hunk と同じ式なので、hunk を持つシンボルは id === hunkId になる。
// M2 で足すもの: 経路上の未変更シンボル（changed: false。LSP の callHierarchy から）、
// testCount（LSP の参照検索。5.2 の 7）、当たらないファイルの層の推定（10 章の layerGuesses）。
// 層は設定の glob（provenance: config）か、構成の推定から組んだ規則（provenance: llm。10.6）で付く。
import type { Hunk, Provenance, Symbol as OndinaSymbol } from '../model.js';
import { hunkId } from '../hunks/stable-id.js';
import { createLayerAssigner, type LayerRule } from '../layers/assign.js';

export function buildSymbols(hunks: readonly Hunk[], layers: readonly LayerRule[], provenance: Extract<Provenance, 'config' | 'llm'> = 'config'): OndinaSymbol[] {
  const layerOf = createLayerAssigner(layers);
  return hunks.map((h) => {
    const layer = layerOf(h.path);
    return {
      id: hunkId(h.path, h.symbolFqName),
      fqName: h.symbolFqName,
      path: h.path,
      ...(layer === undefined ? {} : { layer, layerProvenance: provenance }),
      kind: h.symbolKind,
      changed: true,
      hunkId: h.id,
    };
  });
}
