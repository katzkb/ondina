// 作者の説明（設計書 3.1）の mermaid のコードブロックを図にする。mermaid は大きいので、図のある本文を開いたときだけ読み込む。
// securityLevel: 'strict'（ラベルの HTML を落とし、クリックの処理を付けない）。テーマはフレーバーの明暗で決める（ライト = default、ダーク = dark）。
// 描けるまでと、描けなかったときは原文のコードブロック（children）を出す。描けなければ理由を上に出す（黙って消さない）。
import { useEffect, useId, useState, type ReactNode } from 'react';
import { schemeOf } from '../theme.js';

type Drawn = { svg: string } | { error: string };

export function Mermaid({ source, flavor, children }: { source: string; flavor: string; children: ReactNode }) {
  const id = `mmd-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [drawn, setDrawn] = useState<Drawn | undefined>();
  useEffect(() => {
    let alive = true;
    setDrawn(undefined);
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: schemeOf(flavor) === 'light' ? 'default' : 'dark' });
        // 先に構文だけ確かめる（render は失敗すると描きかけの要素を body に残すことがある）
        await mermaid.parse(source);
        const { svg } = await mermaid.render(id, source);
        if (alive) setDrawn({ svg });
      } catch (e) {
        if (alive) setDrawn({ error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, source, flavor]);

  if (drawn && 'svg' in drawn) return <div className="mermaid" dangerouslySetInnerHTML={{ __html: drawn.svg }} />;
  return (
    <>
      {drawn && 'error' in drawn && (
        <div className="flag">
          <span className="chip w">図</span>
          <span>図を描けませんでした: {drawn.error}</span>
        </div>
      )}
      {children}
    </>
  );
}
