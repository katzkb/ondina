// GitHub の Viewed の通知（設計書 12.1。2026-10-13。見本を比べて「右下に数秒」にした）。
// 右下に 6 秒。マウスが乗っている間は消さない。閉じるのもコマンド（原則 6）で、出した通知の番号を付ける（後から出た通知は閉じない）。
import { useEffect, useState } from 'react';
import type { Command } from '../commands/commands.js';
import type { GithubToast as Toast } from '../state/reducer.js';

export const TOAST_MS = 6000;

export function GithubToast({ toast, dispatch }: { toast: Toast | null; dispatch: (c: Command) => void }) {
  // 乗っている通知の番号。通知が置き換わったら（マウスが乗ったままでも）新しい通知は 6 秒を数える
  const [hoverN, setHoverN] = useState<number | null>(null);
  const n = toast?.n;
  const hover = hoverN !== null && hoverN === n;
  useEffect(() => {
    if (n === undefined || hover) return;
    const t = setTimeout(() => dispatch({ id: 'github.toast.close', n }), TOAST_MS);
    return () => clearTimeout(t);
  }, [n, hover, dispatch]);
  if (!toast) return null;
  return (
    <div className={`ghtoast ${toast.tone}`} role="status" onMouseEnter={() => setHoverN(toast.n)} onMouseLeave={() => setHoverN(null)}>
      <b>{toast.message}</b>
      {toast.reason && <span className="why">{toast.reason}</span>}
      {toast.retry && (
        <span className="ghtoast-acts">
          <button type="button" className="btn sm primary" onClick={() => dispatch({ id: 'github.retry' })}>
            再試行
          </button>
        </span>
      )}
    </div>
  );
}
