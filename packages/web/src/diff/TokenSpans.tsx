// 1 行分の役割トークンを span にする（prototype の tokHtml）。差分行でもハイライトを維持し、背景だけ行側で変える（設計書 3.4）。
// role が null ならクラスを付けない（テーマ既定の前景色）。tokens が無い言語はプレーンテキスト。
// marks を渡すと、差分の列の検索（diff/find.ts）で見つけた所を mark で囲む（今の 1 件は cur）。
// chg（行の中の変わった所。diff/wordDiff.ts）を渡すと、その所の span に wd を付けて濃く塗る（検索の印の中は印の色が勝つ）。
// at（行の場所）を渡すと、定義へ移れる名前（3.6。DefLinks で包んだ所だけ）を切り出し、⌘+クリックで定義へ移る。
import type { TokenLine } from '@ondina/model';
import type { MouseEvent } from 'react';
import type { DefName } from '../defs.js';
import { useDefNames, type DefAt } from './DefLinks.js';
import { splitMarks, type FindMark } from './find.js';
import type { ChangeSpan } from './wordDiff.js';

const classOf = (role: string | null, style: number) => [role ? `c-${role}` : '', style & 1 ? 'it' : '', style & 2 ? 'bd' : ''].filter(Boolean).join(' ');

export function TokenSpans({ line, tokens, marks, chg, at }: { line: string; tokens?: TokenLine | undefined; marks?: readonly FindMark[] | undefined; chg?: readonly ChangeSpan[] | undefined; at?: DefAt | undefined }) {
  const defs = useDefNames(at);
  if ((marks && marks.length > 0) || (chg && chg.length > 0) || defs) return <Marked pieces={tokens ?? [[line.slice(1), null, 0]]} marks={marks ?? []} chg={chg} defs={defs ?? undefined} />;
  if (!tokens) return <>{line.slice(1) || ' '}</>;
  return (
    <>
      {tokens.map(([text, role, style], i) => (
        <span key={i} className={classOf(role, style)}>
          {text}
        </span>
      ))}
    </>
  );
}

/** 印の付いた文字（見出しのパスとシンボルにも使う）。defs を渡すと、名前の span に dj を付けて押せるようにする */
export function Marked({ pieces, marks, chg, defs }: { pieces: TokenLine; marks: readonly FindMark[]; chg?: readonly ChangeSpan[] | undefined; defs?: { names: readonly DefName[]; go: (e: MouseEvent, col: number, name: string) => void } | undefined }) {
  const text = defs ? pieces.map(([t]) => t).join('') : '';
  return (
    <>
      {splitMarks(pieces, marks, defs?.names, chg).map((p, i) => {
        const def = p.def;
        const cls = [classOf(p.role, p.style), p.chg && !p.mark ? 'wd' : ''].filter(Boolean).join(' ');
        const span = def ? (
          <span key={i} className={`${cls} dj`} onClick={(e) => defs!.go(e, def[0], text.slice(def[0], def[0] + def[1]))}>
            {p.text}
          </span>
        ) : (
          <span key={i} className={cls}>
            {p.text}
          </span>
        );
        return p.mark ? (
          <mark key={i} className={p.mark.cur ? 'fhit cur' : 'fhit'}>
            {span}
          </mark>
        ) : (
          span
        );
      })}
    </>
  );
}
