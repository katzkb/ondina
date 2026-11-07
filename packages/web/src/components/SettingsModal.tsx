// 設定のモーダル（上の帯の歯車。2026-09-30 決定: 画面中央・幅広め。項目が増えても同じ形の行を足す）。
// テーマ（システムに合わせる / ライト / ダークと、ライト・ダークそれぞれのフレーバー）はすぐ変わる。
// worktree の置き場所と LLM コマンドとチケットの取り方は .ondina/ui.json に入り、次の analyze から効く（設計書 3.5 / 5.3 / 5.1）。
// AI レビューのコマンドも ui.json に入り、次に PR 一覧から頼んだときから効く（3.11）。
// import だけの差分を自動でチェック済みにする設定もここ（autoCheckImports。押した時点で効く）。
// タブは 全般 / ショートカットキー（2026-10-20）。ショートカットキーも ui.json に入り、押した時点で効く（KeysSettings）。
import type { ThemeMode, ThemeSettings, TicketSettings, WorkspaceSettings, WorkspaceTools } from '@ondina/model';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { fillWorkspacePrompt } from '../prs.js';
import type { Command, SettingsTab } from '../commands/commands.js';
import { composingKey } from '../commands/keymap.js';
import { ACCENTS, themesOf } from '../theme.js';
import { KeysSettings } from './KeysSettings.js';

const MODES: Array<[ThemeMode, string]> = [
  ['system', 'システムに合わせる'],
  ['light', 'ライト'],
  ['dark', 'ダーク'],
];
const TABS: Array<[SettingsTab, string]> = [
  ['general', '全般'],
  ['keys', 'ショートカットキー'],
];

export interface SettingsModalProps {
  tab: SettingsTab;
  theme: ThemeSettings;
  worktreeRoot: string;
  /** LLM コマンド（.ondina/ui.json）。空なら yaml / 既定 */
  llmCommand: string;
  /** AI レビューのコマンド（.ondina/ui.json）。空なら PR 一覧に「AI にレビューを頼む」を出さない */
  reviewCommand: string;
  workspace?: WorkspaceSettings;
  workspaceTools?: WorkspaceTools | null;
  /** チケットの取り方（.ondina/ui.json の ticket。5.1） */
  ticket: TicketSettings;
  /** import だけの差分を自動で問題なしにする（.ondina/ui.json の autoCheckImports。3.8） */
  autoCheckImports?: boolean;
  dispatch: (c: Command) => void;
}

export function SettingsModal({ tab, dispatch, ...general }: SettingsModalProps) {
  return (
    <div className="overlay" onClick={() => dispatch({ id: 'settings.close' })}>
      <div className={`dialog settings${tab === 'keys' ? ' wide' : ''}`} role="dialog" aria-label="設定" onClick={(e) => e.stopPropagation()}>
        <div className="sh">
          <h2>設定</h2>
          <span className="seg" role="tablist" aria-label="設定のタブ">
            {TABS.map(([t, name]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => dispatch({ id: 'settings.tab', tab: t })}>
                {name}
              </button>
            ))}
          </span>
          <button type="button" className="btn sm" onClick={() => dispatch({ id: 'settings.close' })}>
            閉じる <kbd>Esc</kbd>
          </button>
        </div>
        {tab === 'keys' ? <KeysSettings dispatch={dispatch} /> : <General {...general} dispatch={dispatch} />}
      </div>
    </div>
  );
}

/** 全般のタブ: テーマ・レビューの進め方・worktree の置き場所・LLM コマンド・AI レビューのコマンド・チケットの取り方 */
function General({ theme, worktreeRoot, llmCommand, reviewCommand, workspace = {}, workspaceTools = null, ticket, autoCheckImports = false, dispatch }: Omit<SettingsModalProps, 'tab'>) {
  const source = ticket.source ?? 'jira';
  return (
    <>
      <Row label="テーマ" note="すぐ変わります。「システムに合わせる」のときは、OS の外観が変わると一緒に変わります">
        <span className="seg">
          {MODES.map(([mode, name]) => (
            <button key={mode} type="button" className={theme.mode === mode ? 'on' : ''} onClick={() => dispatch({ id: 'theme.mode', mode })}>
              {name}
            </button>
          ))}
        </span>
      </Row>
      <Row label="ライトのテーマ" htmlFor="set-light" note="ライトのときに使います">
        <select id="set-light" value={theme.light} onChange={(e) => dispatch({ id: 'theme.light', flavor: e.target.value })}>
          {themesOf('light').map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="ダークのテーマ" htmlFor="set-dark" note="ダークのときに使います">
        <select id="set-dark" value={theme.dark} onChange={(e) => dispatch({ id: 'theme.dark', flavor: e.target.value })}>
          {themesOf('dark').map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="アクセント" htmlFor="set-accent" note="すぐ変わります">
        <select id="set-accent" value={theme.accent} onChange={(e) => dispatch({ id: 'theme.accent', accent: e.target.value })}>
          {ACCENTS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </Row>
      <Row label="import だけの差分を自動でチェック済みにする" note="ファイルの先頭の差分のうち、package と import の行だけが変わったものです。コースではそこに止まりません。">
        <span className="seg" role="group" aria-label="import だけの差分を自動でチェック済みにする">
          <button type="button" aria-pressed={autoCheckImports} className={autoCheckImports ? 'on' : ''} onClick={() => dispatch({ id: 'ui.autoCheckImports', value: true })}>
            オン
          </button>
          <button type="button" aria-pressed={!autoCheckImports} className={autoCheckImports ? '' : 'on'} onClick={() => dispatch({ id: 'ui.autoCheckImports', value: false })}>
            オフ
          </button>
        </span>
      </Row>
      <Row label="worktree の置き場所" htmlFor="set-worktree" note="言語サーバー用の base と head を置きます。空なら .ondina の下です。次の analyze から使います">
        <SettingInput id="set-worktree" value={worktreeRoot} placeholder="/path/to/worktrees" onCommit={(value) => dispatch({ id: 'ui.worktreeRoot', value })} />
      </Row>
      <Row label="LLM コマンド（解析と案内人に聞く）" htmlFor="set-llm" note="sh -c で起動し、stdin にプロンプト、stdout に JSON。空なら yaml の llm.command か既定。次の analyze から使います">
        <SettingInput id="set-llm" value={llmCommand} placeholder='claude -p --tools "" --max-turns 1 --model opus' onCommit={(value) => dispatch({ id: 'ui.llmCommand', value })} />
      </Row>
      <Row
        label="AI レビューのコマンド"
        htmlFor="set-review"
        note="PR ごとに sh -c で起動します。stdin にレビューの指示、stdout に JSON（ondina comments add と同じ形式）。番号は $ONDINA_PR、base と head は $ONDINA_BASE_SHA と $ONDINA_HEAD_SHA で渡します。空なら「AI にレビューを頼む」は出しません"
      >
        <SettingInput id="set-review" value={reviewCommand} placeholder='claude -p --model opus --allowedTools "Bash(git diff:*),Bash(git show:*),Read,Grep,Glob"' onCommit={(value) => dispatch({ id: 'ui.reviewCommand', value })} />
      </Row>
      <WorkspaceSettingsSection workspace={workspace} tools={workspaceTools} dispatch={dispatch} />
      <Row label="チケットの取得方法" note="analyze --ticket で指定したチケットの取得方法。値がファイルなら、ここに関係なくそのファイルを読みます">
        <span className="seg">
          <button type="button" className={source === 'jira' ? 'on' : ''} onClick={() => dispatch({ id: 'ui.ticket', field: 'source', value: '' })}>
            Jira
          </button>
          <button type="button" className={source === 'command' ? 'on' : ''} onClick={() => dispatch({ id: 'ui.ticket', field: 'source', value: 'command' })}>
            コマンド
          </button>
        </span>
      </Row>
      {source === 'jira' ? (
        <>
          <Row label="Jira の URL" htmlFor="set-jira-url" note="番号（SHOP-421）で指定したときに使います。URL で指定したときは要りません">
            <SettingInput id="set-jira-url" value={ticket.jiraUrl ?? ''} placeholder="https://example.atlassian.net" onCommit={(value) => dispatch({ id: 'ui.ticket', field: 'jiraUrl', value })} />
          </Row>
          <Row label="Jira のメール" htmlFor="set-jira-email" note="Jira Cloud のときだけ。Jira Server / Data Center なら空のまま。トークンはターミナルで ondina token を実行して Mac のキーチェーンに保存します（Mac 以外は環境変数 ONDINA_TICKET_TOKEN）">
            <SettingInput id="set-jira-email" value={ticket.email ?? ''} placeholder="you@example.com" onCommit={(value) => dispatch({ id: 'ui.ticket', field: 'email', value })} />
          </Row>
        </>
      ) : (
        <Row label="チケットを取得するコマンド" htmlFor="set-ticket-command" note="sh -c で起動し、指定した値を環境変数 ONDINA_TICKET で渡します。stdout に JSON（title / body / url）か本文（Markdown）">
          <SettingInput id="set-ticket-command" value={ticket.command ?? ''} placeholder='gh issue view "$ONDINA_TICKET" --json title,body,url' onCommit={(value) => dispatch({ id: 'ui.ticket', field: 'command', value })} />
        </Row>
      )}
    </>
  );
}

/** 全般の「レビュー用の作業場」。保存・挿入・プリセットの操作もコマンド経由 */
function WorkspaceSettingsSection({ workspace, tools, dispatch }: { workspace: WorkspaceSettings; tools: WorkspaceTools | null; dispatch: (c: Command) => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<number | null>(null);
  const prompt = workspace.prompt ?? tools?.defaultPrompt ?? '';
  useLayoutEffect(() => {
    if (caret.current === null || !field.current) return;
    field.current.focus();
    field.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [prompt]);
  const missing = (available: boolean | undefined, name: string) => available === false ? `（${name} が見つかりません）` : '';
  return <section aria-label="レビュー用の作業場" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
    <h3 style={{ margin: 0 }}>レビュー用の作業場</h3>
    <Row label="開く先" htmlFor="set-workspace-app" note="PR のブランチをレビュー用に開きます。「使わない」のときはカードに出しません">
      <select id="set-workspace-app" value={workspace.app ?? ''} onChange={(e) => dispatch({ id: 'ui.workspace', patch: { app: e.target.value as NonNullable<WorkspaceSettings['app']> | '' } })}>
        {/* eslint-disable-next-line ondina/wording-endings -- 選択肢のラベル（ユーザー指定） */}
        <option value="">使わない</option>
        <option value="herdr-app">Herdr アプリ{missing(tools?.herdrApp, 'herdr-app')}</option>
        <option value="herdr">herdr（ターミナル）{missing(tools?.herdr, 'herdr')}</option>
        <option value="orca">orca{missing(tools?.orca, 'orca')}</option>
      </select>
    </Row>
    <Row label="作り方" htmlFor="set-workspace-maker" note="gct は .gct.toml の置き場所・コピー・symlink の設定に従います">
      <select id="set-workspace-maker" value={workspace.maker ?? 'app'} onChange={(e) => dispatch({ id: 'ui.workspace', patch: { maker: e.target.value as NonNullable<WorkspaceSettings['maker']> } })}>
        <option value="gct">gct（.gct.toml の置き場所・コピー・symlink に従う）{missing(tools?.gct, 'gct')}</option>
        <option value="app">開く先のアプリに任せる</option>
      </select>
    </Row>
    <Row label="起動する AI" htmlFor="set-workspace-agent" note="コマンドを編集できます。空なら AI は起動しません">
      {/* eslint-disable-next-line ondina/wording-endings -- AI を起動しないプリセットのボタンラベル */}
      <div style={{ width: '100%' }}><span className="seg">{['claude', 'codex', 'opencode', ''].map((agent) => <button type="button" key={agent} className={(workspace.agent ?? 'claude') === agent ? 'on' : ''} onClick={() => dispatch({ id: 'ui.workspace', patch: { agent } })}>{agent || '起動しない'}</button>)}</span>
      <SettingInput id="set-workspace-agent" value={workspace.agent ?? 'claude'} placeholder="claude" onCommit={(agent) => dispatch({ id: 'ui.workspace', patch: { agent } })} /></div>
    </Row>
    <Row label="最初に送る指示" htmlFor="set-workspace-prompt" note="変数を押すとカーソルの位置に入ります。空なら指示を送りません">
      <div style={{ width: '100%' }}>
        <textarea id="set-workspace-prompt" ref={field} rows={4} style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', padding: '6px 9px', border: '1px solid var(--line-2)', borderRadius: 4, background: 'var(--panel-2)', color: 'var(--ink)' }} value={prompt} disabled={workspace.prompt === undefined && tools === null} onChange={(e) => dispatch({ id: 'ui.workspace', patch: { prompt: e.target.value } })} />
        <span className="seg">{[['{pr}', 'PR 番号'], ['{title}', 'タイトル'], ['{branch}', 'ブランチ'], ['{url}', 'PR の URL']].map(([variable, label]) => <button type="button" key={variable} disabled={workspace.prompt === undefined && tools === null} onMouseDown={(e) => e.preventDefault()} onClick={() => {
          const start = field.current?.selectionStart ?? prompt.length;
          const end = field.current?.selectionEnd ?? start;
          caret.current = start + variable!.length;
          dispatch({ id: 'ui.workspace.insert', variable: variable!, start, end });
        }}>{variable} {label}</button>)}</span>
        <p>#1234 だとこう送ります</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: 'inherit' }}>{fillWorkspacePrompt(prompt, { pr: '1234', title: '注文に割引を適用する', branch: 'feature/discount', url: 'https://github.com/example/order-service/pull/1234' })}</pre>
      </div>
    </Row>
  </section>;
}

/** 設定の 1 行: 見出し・欄・1 行の説明 */
function Row({ label, htmlFor, note, children }: { label: string; htmlFor?: string; note: string; children: ReactNode }) {
  return (
    <div className="srow">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span className="lb">{label}</span>}
      {children}
      <span className="nt">{note}</span>
    </div>
  );
}

/** blur か Enter で確定する設定の欄。値が変わったときだけ onCommit */
function SettingInput({ id, value, placeholder, onCommit }: { id: string; value: string; placeholder: string; onCommit: (v: string) => void }) {
  return (
    <input
      id={id}
      type="text"
      defaultValue={value}
      key={value}
      placeholder={placeholder}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !composingKey(e.nativeEvent)) (e.target as HTMLInputElement).blur();
        e.stopPropagation();
      }}
    />
  );
}
