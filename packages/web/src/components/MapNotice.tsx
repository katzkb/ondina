// 地図に層や関連の線が無いときの知らせ。入口の題の下、LLM の知らせ（LlmNotice）の後に出す。
// 層は構成の推定（設計書 10.6。Analysis.structure）、関連の線は言語サーバー（9.5。Analysis.lsp）から来る。
// どちらも、ない理由とやり直し方を出す（地図が「層なし ／ 関連なし」だけで黙らない）。文はですます調（LlmNotice と同じ）。
import type { ReactNode } from 'react';
import type { Analysis } from '@ondina/model';

interface Line {
  key: string;
  text: string;
  hint: ReactNode;
}

const analyze = <code>ondina analyze</code>;

/** 推定の日付（手元の時刻で YYYY-MM-DD） */
const day = (at: string) => new Date(at).toLocaleDateString('sv-SE');

function lines(analysis: Analysis): Line[] {
  const out: Line[] = [];
  const s = analysis.structure;
  if (s?.status === 'failed') out.push({ key: 's', text: `層を推定できませんでした。理由: ${s.reason ?? '理由は受け取っていません'}`, hint: <>直したら {analyze} でやり直せます</> });
  if (s?.status === 'skipped') out.push({ key: 's', text: `層を推定していません（${s.reason ?? '--no-llm'}）。`, hint: <>LLM を使って {analyze} を実行し直すと層に分かれます</> });
  const u = s?.status === 'ok' ? s.unclassified : undefined;
  if (u?.warn && s?.inferred) {
    out.push({
      key: 's',
      text: `構成に分類できないファイルが ${u.count} 件増えました（${day(s.inferred.at)} の推定以降）。`,
      hint: (
        <>
          <code>ondina structure</code> で推定し直せます（そのあと {analyze}）
        </>
      ),
    });
  }
  // 入口の地図のまとまり（2026-11-04）が無い解析は、前の形の地図を出す（web は core の分け方を持たない。原則 5）
  if (analysis.mapGroups === undefined) out.push({ key: 'g', text: '古い ondina で作った解析なので、前の形の地図を出しています。', hint: <>{analyze} で解析し直すと新しい地図になります</> });
  const lsp = analysis.lsp;
  if (lsp === undefined) {
    out.push({ key: 'l', text: '言語サーバーを使わずに解析したので、関連の線がありません。', hint: <>--no-lsp を付けずに {analyze} を実行し直すと表示されます</> });
  } else if (lsp.status === 'unavailable') {
    const expired = /expired/i.test(lsp.reason ?? '');
    out.push({
      key: 'l',
      text: `関連の線がありません。言語サーバーが使えませんでした: ${lsp.reason ?? '理由は受け取っていません'}`,
      // ondina update が kotlin-lsp も最新にする（scripts/install-kotlin-lsp.sh。設計書 5.5）
      hint: expired ? <>kotlin-lsp の期限切れです。<code>ondina update</code> で新しいバージョンに入れ替えてから {analyze} でやり直せます</> : <>直したら {analyze} でやり直せます</>,
    });
  }
  return out;
}

export function MapNotice({ analysis }: { analysis: Analysis }) {
  return (
    <>
      {lines(analysis).map((l) => (
        <div key={l.key} className="notice" role="status">
          <span>{l.text}</span>
          <span className="sp" />
          <span className="hint">{l.hint}</span>
        </div>
      ))}
    </>
  );
}
