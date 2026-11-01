// 差分の無い箱の右列（設計書 3.3）。解析が head から切り出した行（Symbol.excerpt）を描くだけ（原則 5）。
// 中心の行（宣言・変更シンボルを呼んでいる行）は背景で目立たせ、離れた塊の間は ⋯ で区切る。色付けはしない（材料が解析に無い）。
import type { Symbol } from '@ondina/model';
import { Fragment } from 'react';

export function Excerpt({ symbol, note = '差分なし（未変更）' }: { symbol: Symbol | undefined; note?: string }) {
  if (symbol === undefined) return <div className="empty">{note}</div>;
  return (
    <div className="exc">
      <div className="hh">
        {symbol.path}
        <span className="sp">
          <span className="chip">{note}</span>
        </span>
      </div>
      {symbol.excerpt === undefined ? (
        <div className="empty">位置なし（言語サーバーが位置を返しませんでした）</div>
      ) : (
        <div className="diff exc-body">
          {symbol.excerpt.map((block, b) => (
            <Fragment key={block.start}>
              {b > 0 && (
                <>
                  <div className="ln gap">⋯</div>
                  <div className="cd gap" />
                </>
              )}
              {block.lines.map((text, i) => {
                const ln = block.start + i;
                const c = block.centers.includes(ln) ? ' ctr' : '';
                return (
                  <Fragment key={ln}>
                    <div className={`ln${c}`}>{ln}</div>
                    <div className={`cd${c}`}>{text}</div>
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
