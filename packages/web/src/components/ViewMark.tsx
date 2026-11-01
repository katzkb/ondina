// 差分一覧の行の印（設計書 3.4 / 12.1。2026-10-13。見本を比べて決めた形）。
// 問題なし = まる（全部は緑、一部は半分、無しは灰色）、GitHub で Viewed = チェック、両方 = まるにチェック。
// 未確認で GitHub だけ Viewed なら灰色のまるは消してチェックだけ。チェックを乗せるため、まるは 14px。
export interface ViewMarkProps {
  /** ファイルの差分の数と、そのうち問題なしの数 */
  total: number;
  viewed: number;
  /** GitHub で Viewed か */
  github: boolean;
}

const CHECK = 'M3.9 7.3 6.1 9.5 10.3 4.7';
const CHECK_ALONE = 'M2.6 7.6 5.6 10.6 11.6 3.6';

export function viewMarkLabel({ total, viewed, github }: ViewMarkProps): string {
  return `${viewed === 0 ? '未確認' : `問題なし ${viewed} / ${total}`}${github ? ' · GitHub で Viewed' : ''}`;
}

export function ViewMark(props: ViewMarkProps) {
  const { total, viewed, github } = props;
  const state = viewed === 0 ? 'none' : viewed >= total ? 'all' : 'part';
  const label = viewMarkLabel(props);
  return (
    <span className={`vm ${state}${github ? ' gh' : ''}`} role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 14 14" aria-hidden="true">
        {state === 'all' && <circle className="c-ok" cx="7" cy="7" r="6" />}
        {state === 'part' && (
          <>
            <circle className="c-no" cx="7" cy="7" r="6" />
            <path className="c-ok" d="M7 1a6 6 0 0 0 0 12Z" />
          </>
        )}
        {state === 'none' && !github && <circle className="c-no" cx="7" cy="7" r="6" />}
        {github && state === 'part' && <path className="ck halo" d={CHECK} />}
        {github && <path className={`ck ${state === 'none' ? 'alone' : ''}`} d={state === 'none' ? CHECK_ALONE : CHECK} />}
      </svg>
    </span>
  );
}
