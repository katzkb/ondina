// 差分の無い箱の右列（設計書 3.3）。解析が切り出した Symbol.excerpt を描くだけ（web は切り出さない。原則 5）。
import type { Symbol } from '@ondina/model';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Excerpt } from '../src/diff/Excerpt.js';

const sym = (over: Partial<Symbol> = {}): Symbol => ({
  id: 's',
  fqName: 'com.example.common.Logger.log',
  path: 'src/main/kotlin/com/example/common/Logger.kt',
  kind: 'function',
  changed: false,
  ...over,
});

describe('Excerpt', () => {
  it('ファイルの位置と「差分なし（未変更）」を見出しに出し、行番号つきで行を並べる。中心の行に印', () => {
    const { container } = render(<Excerpt symbol={sym({ excerpt: [{ start: 8, lines: ['a', '', 'b', '}'], centers: [10] }] })} />);
    expect(container.querySelector('.hh')!.textContent).toContain('src/main/kotlin/com/example/common/Logger.kt');
    expect(container.querySelector('.hh')!.textContent).toContain('差分なし（未変更）');
    expect([...container.querySelectorAll('.ln')].map((e) => e.textContent)).toEqual(['8', '9', '10', '11']);
    expect([...container.querySelectorAll('.cd')].map((e) => e.textContent)).toEqual(['a', '', 'b', '}']);
    expect([...container.querySelectorAll('.cd.ctr')].map((e) => e.textContent)).toEqual(['b']);
  });

  it('離れた塊の間は ⋯ で区切る', () => {
    const { container } = render(
      <Excerpt
        symbol={sym({
          excerpt: [
            { start: 1, lines: ['x'], centers: [1] },
            { start: 20, lines: ['y'], centers: [20] },
          ],
        })}
      />,
    );
    expect([...container.querySelectorAll('.ln')].map((e) => e.textContent)).toEqual(['1', '⋯', '20']);
    expect(container.querySelectorAll('.gap')).toHaveLength(2); // 行番号の列と本文の列
  });

  it('excerpt が無ければ「位置なし」と出す（黙って「差分なし」にしない）', () => {
    render(<Excerpt symbol={sym()} />);
    expect(screen.getByText('位置なし（言語サーバーが位置を返しませんでした）')).toBeInTheDocument();
  });

  it('シンボルが解析に無ければ「差分なし（未変更）」だけ', () => {
    render(<Excerpt symbol={undefined} />);
    expect(screen.getByText('差分なし（未変更）')).toBeInTheDocument();
  });
});
