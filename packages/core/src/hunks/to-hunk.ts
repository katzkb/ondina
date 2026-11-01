// SemanticHunk（Stage 1 が確定した事実）を設計書 4章の Hunk に写す。
// kind / hows は 8章・10章の後段が埋める。ここでは未帰属（kind 'none'、hows 空）で初期化し、
// 出所は ast にする（原則 3: 未帰属はプログラムが計算する。LLM に書かせない）。
import type { Hunk } from '../model.js';
import type { SemanticHunk } from './extract.js';

export function toHunk(h: SemanticHunk): Hunk {
  return {
    id: h.id,
    path: h.path,
    lang: h.lang,
    symbol: h.symbol,
    symbolFqName: h.symbolFqName,
    symbolKind: h.symbolKind,
    kind: 'none',
    kindProvenance: 'ast',
    hows: [],
    n: 1,
    lnOld: h.lnOld,
    lnNew: h.lnNew,
    lines: h.lines,
  };
}
