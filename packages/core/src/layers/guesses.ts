// どの glob にも当たらなかったファイルの層の推定（設計書 10.2 の layerGuesses / 5.2 の 4）。
// 推定は LLM が出すが、採るかどうかはプログラムが決める（原則 3）。採ったものには layerProvenance: 'llm' が付き、
// UI は点線と「たぶん」で出す（原則 2）。
import type { Layer, Symbol as OndinaSymbol } from '../model.js';
import type { LayerRule } from './assign.js';

export interface LayerGuess {
  path: string;
  layer: Layer;
}

export interface VerifiedGuesses {
  kept: LayerGuess[];
  /** 捨てたものの理由。analyze が stderr に 1 行ずつ出す（黙って直さない。5.4） */
  info: string[];
}

/**
 * 通すのは「設定に実在する層の名前」で「本当に層が付いていないパス」のものだけ。
 * 同じパスが 2 回来たら最初だけ採る（決定的。原則 7）。
 */
export function verifyLayerGuesses(guesses: readonly LayerGuess[], ctx: { layers: readonly LayerRule[]; unlayeredPaths: readonly string[] }): VerifiedGuesses {
  const names = new Set(ctx.layers.map((l) => l.name));
  const unlayered = new Set(ctx.unlayeredPaths);
  const seen = new Set<string>();
  const kept: LayerGuess[] = [];
  const info: string[] = [];
  for (const g of guesses) {
    if (!names.has(g.layer)) {
      info.push(`層の推定を除外しました（設定にない層 ${g.layer}）: ${g.path}`);
      continue;
    }
    if (!unlayered.has(g.path)) {
      info.push(`層の推定を除外しました（glob で層が決まっているか、変更ファイルではない）: ${g.path}`);
      continue;
    }
    if (seen.has(g.path)) {
      info.push(`層の推定が重複していたので後のほうを除外しました: ${g.path}`);
      continue;
    }
    seen.add(g.path);
    kept.push(g);
  }
  return { kept, info };
}

/** 通った推定をそのパスのシンボルに当てる。もともと層があるシンボルは触らない */
export function applyLayerGuesses(symbols: readonly OndinaSymbol[], kept: readonly LayerGuess[]): OndinaSymbol[] {
  if (kept.length === 0) return [...symbols];
  const byPath = new Map(kept.map((g) => [g.path, g.layer]));
  return symbols.map((s) => {
    const guess = s.layer === undefined ? byPath.get(s.path) : undefined;
    return guess === undefined ? s : { ...s, layer: guess, layerProvenance: 'llm' as const };
  });
}
