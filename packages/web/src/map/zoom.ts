// 地図の倍率の範囲と、つまんだときの次の倍率（設計書 3.3）。ボタンの 50 / 70 / 100% もこの範囲の中

/** 倍率を 25%〜200% に収める */
export function clampZoom(zoom: number): number {
  return Math.min(2, Math.max(0.25, zoom));
}

/**
 * Ctrl 付きの wheel 1 回で次の倍率。Chrome のピンチは deltaY = -100 * ln(つまんだ比) で来るので、指の動きと合う。
 * マウスのホイール 1 目盛り（deltaY 100 前後）で跳ねないよう、1 回の deltaY は ±25 で頭打ち
 */
export function wheelZoom(zoom: number, deltaY: number): number {
  return clampZoom(zoom * Math.exp(-Math.min(25, Math.max(-25, deltaY)) / 100));
}
