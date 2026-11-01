// 上の帯の下の 1 行（設計書 3.0。2026-10-13）。新しいコミットを見つけた・順番待ち・解析し直している・できた・切り替えた・失敗した を知らせる。
// 知らせることが無ければ出さない。置き場所と出し方は動く見本を比べて決めた（帯の下に 1 行・知らせて待つ）。
import { useEffect, useReducer } from 'react';
import type { Command } from '../commands/commands.js';
import { clock, type Strip } from '../reanalyze.js';

const short = (sha: string) => sha.slice(0, 7);

export function ReanalyzeStrip({ strip, dispatch }: { strip: Strip | null; dispatch: (c: Command) => void }) {
  // 解析し直している間は経過を 1 秒ごとに進める
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const running = strip?.kind === 'running';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [running]);
  if (strip === null) return null;
  const start = () => dispatch({ id: 'reanalyze.start', now: Date.now() });
  switch (strip.kind) {
    case 'noticed':
      return (
        <div className="reanalyze new" role="status" aria-label="新しいコミット">
          <span>
            {strip.workingTree ? '作業ツリーに新しい変更があります' : `新しいコミットが${strip.newCommits === undefined ? '' : ` ${strip.newCommits} 件`}あります`}（{short(strip.from)} → {short(strip.to)}）
          </span>
          <span className="sp">
            <button type="button" className="btn sm primary" onClick={start}>
              解析し直す
            </button>
          </span>
        </div>
      );
    case 'queued':
      return (
        <div className="reanalyze" role="status" aria-label="順番待ち">
          <span>
            {strip.key === 'local' ? 'local' : `PR #${strip.key}`} の解析は順番待ちです（前に {strip.ahead} 件）
          </span>
          <span className="sp">前のバージョンはこのまま使えます</span>
        </div>
      );
    case 'running':
      return (
        <div className="reanalyze" role="status" aria-label="解析し直しています">
          <span className="spin" aria-hidden="true" />
          <span>
            解析中 <b>{clock(Date.now() - strip.startedAt)}</b>
          </span>
          {strip.line !== undefined && (
            <span className="lg" title={strip.line}>
              {strip.line}
            </span>
          )}
          <span className="sp">前のバージョンはこのまま使えます</span>
        </div>
      );
    case 'ready':
      return (
        <div className="reanalyze new" role="status" aria-label="新しいバージョン">
          <span>
            新しいバージョン <b>{short(strip.to)}</b> の解析ができました。{strip.changed === undefined ? '' : `変わった差分は ${strip.changed} か所です`}
          </span>
          <span className="sp">
            <button type="button" className="btn sm primary" onClick={() => dispatch({ id: 'reanalyze.switch' })}>
              切り替える
            </button>
          </span>
        </div>
      );
    case 'switched':
      return (
        <div className="reanalyze ok" role="status" aria-label="切り替えました">
          <span>
            新しいバージョン <b>{short(strip.to)}</b> に切り替えました。
            {strip.reset > 0
              ? `変わった差分 ${strip.reset} か所を未確認に戻しました${strip.courses.length > 0 ? `（コース ${strip.courses.join('・')} も未完了に戻しました）` : ''}。`
              : '「問題なし」の印はすべて引き継ぎました。'}
            {strip.left > 0 && `前のバージョンに残したメモが ${strip.left} 件あります（左上で前のバージョンを選ぶと表示できます）。`}
          </span>
          <span className="sp">
            <button type="button" className="x" aria-label="閉じる" onClick={() => dispatch({ id: 'reanalyze.dismiss' })}>
              ×
            </button>
          </span>
        </div>
      );
    case 'failed':
      return (
        <div className="reanalyze bad" role="alert">
          <span className="lg" title={strip.reason}>
            解析できませんでした: {strip.reason}
          </span>
          <span className="sp">
            前のバージョンのまま使えます
            <button type="button" className="btn sm" onClick={start}>
              もう一度
            </button>
          </span>
        </div>
      );
  }
}
