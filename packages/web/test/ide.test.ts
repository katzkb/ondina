// IDEA で開く（設計書 3.6）。path は repo 相対（17 章: 解釈は未確認のまま）。product は ondina.config.yaml の ide.product。
import { describe, expect, it } from 'vitest';
import { ideaUrl } from '../src/ide.js';

describe('ideaUrl', () => {
  it('jetbrains://<product>/ スキームに project と path:line を入れる', () => {
    expect(ideaUrl('idea', 'order-service', 'src/main/kotlin/com/example/order/domain/Order.kt', 12)).toBe(
      'jetbrains://idea/navigate/reference?project=order-service&path=src%2Fmain%2Fkotlin%2Fcom%2Fexample%2Forder%2Fdomain%2FOrder.kt%3A12',
    );
    expect(ideaUrl('idea-ce', 'p', 'a.kt', 1)).toBe('jetbrains://idea-ce/navigate/reference?project=p&path=a.kt%3A1');
  });
});
