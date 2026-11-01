// 水先案内の 1 行（コースの停留所・総括と締め）。設計書 3.3。
// ai = 2 回目の LLM が書いた文: 点線の枠と「AI」のチップ（原則 2: 推測は点線）。それ以外は事実から組んだ文: 実線の枠と「自動」のチップ。
// lead = 同じ出どころの前置きの文（停留所のなぜここか）。先頭に薄く出す。label = 枠の見出し（既定は「水先案内」。停留所の「この場所」。2026-10-22）
import { Lines } from './Lines.js';

export function Narr({ text, ai = false, lead, label = '水先案内' }: { text: string; ai?: boolean; lead?: string; label?: string }) {
  return (
    <div className={ai ? 'narr ai' : 'narr'}>
      <span className="who">
        {label}
        <span className={ai ? 'chip ai' : 'chip'}>{ai ? 'AI' : '自動'}</span>
      </span>
      {lead !== undefined && <Lines text={lead} className="why" />}
      <Lines text={text} />
    </div>
  );
}
