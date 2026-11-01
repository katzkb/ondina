// 役割トークンの描画（設計書 7 章、prototype の tokHtml）。role が null ならクラス無し、tokens が無ければプレーン。
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TokenSpans } from '../src/diff/TokenSpans.js';

describe('TokenSpans', () => {
  it('role ごとに c-<role>、fontStyle の italic / bold を it / bd にする', () => {
    const { container } = render(<TokenSpans line="+fun x" tokens={[['fun', 'mauve', 0], [' ', null, 0], ['x', 'blue', 3]]} />);
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(3);
    expect(spans[0]!.className).toBe('c-mauve');
    expect(spans[0]!.textContent).toBe('fun');
    expect(spans[1]!.className).toBe('');
    expect(spans[2]!.className).toBe('c-blue it bd');
  });

  it('tokens が無ければ接頭辞を除いたプレーンテキスト', () => {
    const { container } = render(<TokenSpans line="-    return x" />);
    expect(container.querySelector('span')).toBeNull();
    expect(container.textContent).toBe('    return x');
  });

  it('空行は 1 文字の空白で高さを保つ', () => {
    const { container } = render(<TokenSpans line="+" />);
    expect(container.textContent).toBe(' ');
  });
});
