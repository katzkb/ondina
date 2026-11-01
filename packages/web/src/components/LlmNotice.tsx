// LLM が動かなかった解析の知らせ。入口の題の下と、目的ごとに分けた画面の最上部に出す。
// 1 回目（目的ごとに分ける。Analysis.llm）が skipped / failed ならそれを、1 回目が ok で 2 回目（文を書く。Analysis.llmText）が
// skipped / failed ならそれを知らせる（2 回目の帯は入口だけ。text を渡したときだけ見る）。2 回目の欄が無い古い解析は知らせない。
// 文はですます調（2026-09-30 決定）。ボタンで設定のモーダルを開き、LLM コマンドを設定できる。
import type { LlmRun } from '@ondina/model';
import type { Command } from '../commands/commands.js';

export function LlmNotice({ llm, text, dispatch }: { llm: LlmRun | undefined; text?: LlmRun | undefined; dispatch: (c: Command) => void }) {
  const failed = llm !== undefined && llm.status !== 'ok' ? { run: llm, what: '目的ごとに分けられませんでした' } : text !== undefined && text.status !== 'ok' ? { run: text, what: '案内文を書けませんでした' } : null;
  if (!failed) return null;
  const { run, what } = failed;
  return (
    <div className="notice" role="status">
      <span>
        LLM で{what}。理由: {run.reason ?? run.status}（コマンド: <code>{run.command}</code>）
      </span>
      <span className="sp" />
      <button type="button" className="btn sm" onClick={() => dispatch({ id: 'settings.open' })}>
        LLM コマンドを設定する
      </button>
      <span className="hint">
        直したら <code>ondina analyze --relabel</code> でやり直せます
      </span>
    </div>
  );
}
