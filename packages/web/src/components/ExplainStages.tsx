// 説明タブの左の箱（設計書 3.1。2026-10-29。見本の新案「背景を 1 段目に分ける」にした）。Analysis を読んで描くだけ。
// 1 背景: 何のための PR？ = 要点（2 回目の LLM が差分から書く）と、チケットの原文から写した「なぜ」（background.why。原文にある文だけ）。
//   どんな案件の一部？ = background.project（親チケットと同じ案件の PR はプログラムが Jira と GitHub から取った事実。親の目的の文は親の本文から写した物だけ）。
//   この PR の前からあるものは？ = background.existing（名前と「削除 / 変更なし」はプログラムの事実、文は LLM）と、図の箱の層の行（Symbol.layer から組む）。
//   出てくる言葉は？ = background.terms（コードの名前は差分の行の識別子。言葉と意味は LLM なので「意味は推定」）。
// 2 この PR: 使うと何が変わる？ = テストの値で書いた例と根拠の場所。どこを変えた？ = 流れの図（箱 = コース。丸を押すとそのコースを選ぶ = home.select）。
// LLM の文なので箱は点線と「AI」（原則 2）。チケットの原文の引用は実線の引用枠。どの箱にも入らなかったコースは図の下に丸で並べる（隠さない）。
// 段は入口の一時状態（home.stage。保存しない）。古い形の説明（問題・方針・触らないもの・前後表）の解析は、解析し直しを案内する。
import type { Analysis, ExistingItem, Flow, FlowNode, How, Project, ProjectPr, Summary } from '@ondina/model';
import type { Command } from '../commands/commands.js';
import { shortName } from '../map/graph.js';
import { Key } from './Key.js';
import { Lines } from './Lines.js';
import { courseBg } from '../course.js';

export interface ExplainStagesProps {
  analysis: Analysis;
  stage: 1 | 2;
  sel: number | null;
  dispatch: (c: Command) => void;
}

export function ExplainStages({ analysis, stage, sel, dispatch }: ExplainStagesProps) {
  const { summary } = analysis;
  const written = summary.headline !== undefined || summary.example !== undefined || summary.flows !== undefined;
  const old = !written && isOld(summary);
  return (
    <div className={written ? 'box ai' : 'box'} style={{ gridRow: '1 / 3', gridColumn: 1 }}>
      <h3>
        この PR の説明 {written && <span className="chip ai">AI</span>}
        <span className="chip">PR 説明は使っていません</span>
      </h3>
      <div className="bd">
        {old && <p className="muted">この解析は前の形の説明です。解析し直すと、背景とこの PR の 2 段の説明になります。</p>}
        {!old && !written && analysis.background === undefined && <p className="muted">説明はありません（LLM が書いていない解析）</p>}
        {!old && (written || analysis.background !== undefined) && (
          <>
            <div className="ex-stages" role="tablist" aria-label="説明の段">
              <StageTab n={1} title="背景" sub="案件と前提" stage={stage} dispatch={dispatch} />
              <span className="ex-sep" aria-hidden="true">
                →
              </span>
              <StageTab n={2} title="この PR" sub="何が変わり、どこを変えたか" stage={stage} dispatch={dispatch} />
            </div>
            {stage === 1 ? <Background analysis={analysis} dispatch={dispatch} /> : <ThisPr analysis={analysis} sel={sel} dispatch={dispatch} />}
          </>
        )}
      </div>
    </div>
  );
}

function StageTab({ n, title, sub, stage, dispatch }: { n: 1 | 2; title: string; sub: string; stage: 1 | 2; dispatch: (c: Command) => void }) {
  return (
    <button type="button" role="tab" aria-selected={stage === n} className={stage === n ? 'ex-stage on' : stage > n ? 'ex-stage done' : 'ex-stage'} onClick={() => dispatch({ id: 'home.stage', stage: n })}>
      <b>{n}</b>
      <em>{title}</em>
      <small>{sub}</small>
    </button>
  );
}

function Background({ analysis, dispatch }: { analysis: Analysis; dispatch: (c: Command) => void }) {
  const terms = analysis.background?.terms ?? [];
  return (
    <div className="ex-qa">
      <div className="ex-q">
        <h4>何のための PR？</h4>
        <WhyQ analysis={analysis} />
      </div>
      {analysis.background?.project !== undefined && <ProjectQ project={analysis.background.project} />}
      <Existing analysis={analysis} />
      {terms.length > 0 && (
        <div className="ex-q">
          <h4>
            出てくる言葉は？ <span className="chip ai">意味は推定</span>
          </h4>
          <div className="ex-terms">
            {terms.map((t) => (
              <div key={t.code}>
                <b>{t.word}</b>
                <code>{t.code}</code>
                {t.meaning !== undefined && <span>{t.meaning}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      <button type="button" className="btn ex-next" onClick={() => dispatch({ id: 'home.stage', stage: 2 })}>
        2 この PR へ → <Key action="home.stage" />
      </button>
    </div>
  );
}

/** 要点とチケットの「なぜ」。見出しと AI 表示は呼び出す画面が付ける。 */
export function WhyQ({ analysis }: { analysis: Analysis }) {
  const { headline } = analysis.summary;
  const ticket = analysis.pr.ticket;
  const why = analysis.background?.why ?? [];
  return <>
    {headline !== undefined && <p className="ex-headline">{headline}</p>}
    {why.length > 0 && ticket !== undefined && (
      <p className="ex-quote">
        <span className="chip">{`チケット ${ticket.key ?? ticket.ref.split('/').pop()} の原文`}</span>
        {why.join('')}
      </p>
    )}
    {why.length === 0 && <p className="muted">{ticket === undefined || ticket.error !== undefined ? 'チケットがないので、なぜこの変更をするかは出していません。analyze に --ticket を付けると、チケットの背景をここに出します。' : 'チケットに、なぜこの変更をするかの文が見つかりませんでした。'}</p>}
  </>;
}

const PR_STATE: Record<ProjectPr['state'], string> = { merged: 'マージ済み', open: 'レビュー中', draft: 'Draft', closed: 'クローズ' };

/**
 * どんな案件の一部？ 親チケットの原文の引用（題は Jira へのリンク、写した目的の文）と、同じ案件の PR の行（状態のチップと番号・題。この PR は太字）。
 * 別のリポジトリの PR は「名前#番号」。見つからない・探さなかった・取れなかったことは灰色の 1 行ずつ（黙って消さない）
 */
export function ProjectQ({ project }: { project: Project }) {
  const { parent, why = [], repo, prs, searched = [], skipped, errors = [] } = project;
  return (
    <div className="ex-q ex-project">
      <h4>どんな案件の一部？</h4>
      {parent !== undefined && (
        <p className="ex-quote">
          <span className="chip">{`親チケット ${parent.key} の原文`}</span>
          {parent.title !== undefined && (
            <a className="ex-parent" href={parent.url} target="_blank" rel="noreferrer">
              {parent.title}
            </a>
          )}
          {why.join('')}
        </p>
      )}
      {prs !== undefined && prs.length > 0 && (
        <div className="ex-rel">
          <span className="ex-rl">同じ案件の PR</span>
          {prs.map((p) => (
            <span key={p.url} className={p.self ? 'ex-pr ex-me' : 'ex-pr'}>
              <span className={p.self ? 'chip ex-me' : 'chip'}>{p.self ? 'この PR' : PR_STATE[p.state]}</span>
              <a href={p.url} target="_blank" rel="noreferrer" title={`${p.repo}#${p.number}`}>
                {`${p.repo === repo ? '' : p.repo.split('/').pop()}#${p.number} ${p.title}`}
              </a>
            </span>
          ))}
        </div>
      )}
      {prs !== undefined && prs.length === 0 && <p className="muted">{`同じ案件の PR は見つかりませんでした。親と子のチケットの番号 ${searched.length} 個で、PR の題と本文を探しました。`}</p>}
      {skipped !== undefined && <p className="muted">{`同じ親の下のチケットが多いので、番号 ${searched.length} 個だけで探しました（残り ${skipped} 個）。`}</p>}
      {errors.map((e, i) => (
        <p key={i} className="muted">
          {e}
        </p>
      ))}
    </div>
  );
}

/** この PR の前からあるものは？ 行 = 名前 / 1 文 / 事実のチップ。最後に図の箱の層の行（2 つ以上の層があるとき） */
function Existing({ analysis }: { analysis: Analysis }) {
  const items = analysis.background?.existing ?? [];
  const layers = flowLayers(analysis);
  if (items.length === 0 && layers === undefined) return null;
  return (
    <div className="ex-q">
      <h4>この PR の前からあるものは？</h4>
      <div className="ex-pre">
        {items.map((e, i) => (
          <div key={i} className="ex-row">
            <code>{namesOf(e.names)}</code>
            <span className="ex-pre-text">{e.text}</span>
            <span className={e.removed ? 'chip ex-gone' : 'chip'}>{e.removed ? 'この PR で削除' : 'この PR で変更なし'}</span>
          </div>
        ))}
        {layers !== undefined && (
          <div className="ex-row">
            <code>{`層 ${layers.names.length} つ`}</code>
            <span className="ex-pre-text">{`${layers.names.join(' · ')}。「この PR」の図の箱に付く層の名前。`}</span>
            <span className={layers.guessed ? 'chip ex-guess' : 'chip'}>{layers.guessed ? '分け方は推定' : '設定ファイルの分け方'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** 図の箱の下の名前の層（出た順・重複なし）。2 つ以上のときだけ。1 つでも推定（llm）なら guessed */
function flowLayers(analysis: Analysis): { names: string[]; guessed: boolean } | undefined {
  const symbols = (analysis.summary.flows ?? []).flatMap((f) => f.nodes.flatMap((n) => analysis.symbols.find((s) => s.id === n.symbol) ?? []));
  const names = [...new Set(symbols.flatMap((s) => s.layer ?? []))];
  return names.length < 2 ? undefined : { names, guessed: symbols.some((s) => s.layer !== undefined && s.layerProvenance === 'llm') };
}

/** 「Order.promo · getDiscount()」の形。持ち主（大文字で始まる 1 つ上の名前。Companion は飛ばす）と名前、関数は ()。同じ持ち主が続けば名前だけ */
function namesOf(names: ExistingItem['names']): string {
  let prev: string | undefined;
  return names
    .map((n) => {
      const parts = n.fqName.replace(/#\d+$/, '').split('.').filter((p) => p !== 'Companion');
      const name = `${parts.at(-1)}${n.kind === 'function' ? '()' : ''}`;
      const owner = parts.length >= 2 && /^[A-Z]/.test(parts.at(-2)!) ? parts.at(-2) : undefined;
      const shown = owner === undefined || owner === prev ? name : `${owner}.${name}`;
      prev = owner;
      return shown;
    })
    .join(' · ');
}

function ThisPr({ analysis, sel, dispatch }: { analysis: Analysis; sel: number | null; dispatch: (c: Command) => void }) {
  const { example, flows = [] } = analysis.summary;
  const placed = new Set(flows.flatMap((f) => f.nodes.flatMap((n) => n.howIds)));
  const missing = analysis.tours.map((t) => t.howId).filter((id) => !placed.has(id));
  return (
    <div className="ex-qa">
      {example !== undefined && (
        <div className="ex-q">
          <h4>
            使うと何が変わる？ {example.at.length > 0 && <span className="chip">{`値は ${whereOf(analysis, example.at)}`}</span>}
          </h4>
          <Lines text={example.text} />
        </div>
      )}
      <div className="ex-q">
        <h4>どこを変えた？ {example !== undefined && flows.some((f) => f.nodes.some((n) => n.pass !== undefined)) && <span className="chip">矢印の値は上の例</span>}</h4>
        {flows.length === 0 && <p className="muted">流れの図はありません（LLM が書いていない解析）</p>}
        {flows.map((f, i) => (
          <FlowFigure key={i} flow={f} analysis={analysis} sel={sel} dispatch={dispatch} />
        ))}
        {missing.length > 0 && (
          <div className="flow-miss">
            <span className="muted">図にないコース</span>
            {missing.map((id) => (
              <CourseDot key={id} id={id} hows={analysis.hows} sel={sel} dispatch={dispatch} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FlowFigure({ flow, analysis, sel, dispatch }: { flow: Flow; analysis: Analysis; sel: number | null; dispatch: (c: Command) => void }) {
  return (
    <div className="flow">
      {flow.nodes.map((n, k) => (
        <div key={k} className="flow-step">
          <FlowBox node={n} analysis={analysis} sel={sel} dispatch={dispatch} />
          {k < flow.nodes.length - 1 && (
            <div className="flow-arrow">
              <i aria-hidden="true" />
              {n.pass !== undefined && <code>{n.pass}</code>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FlowBox({ node, analysis, sel, dispatch }: { node: FlowNode; analysis: Analysis; sel: number | null; dispatch: (c: Command) => void }) {
  const s = node.symbol === undefined ? undefined : analysis.symbols.find((x) => x.id === node.symbol);
  return (
    <div className="flow-node">
      <div className="flow-box">
        <span className="flow-title">
          {node.title}
          {s?.layer !== undefined && <span className={s.layerProvenance === 'llm' ? 'chip ex-guess' : 'chip'} title={s.layerProvenance === 'llm' ? '層は推定' : undefined}>{s.layer}</span>}
          <span className="flow-dots">
            {node.howIds.map((id) => (
              <CourseDot key={id} id={id} hows={analysis.hows} sel={sel} dispatch={dispatch} />
            ))}
          </span>
        </span>
        {s !== undefined && <code className="flow-sym">{shortName(s.fqName, s.path, s.kind)}</code>}
      </div>
      <div className="flow-ba">
        <span className="flow-l">前</span>
        <span className="flow-b">{node.before}</span>
        <span className="flow-l">後</span>
        <span className="flow-a">{node.after}</span>
      </div>
      {node.untouched.length > 0 && (
        <div className="flow-keep">
          {node.untouched.map((u, i) => (
            <span key={i} className="chip">{`変えていない: ${u}`}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** コースの丸。押すとそのコースを選ぶ（下のカードを押すのと同じ home.select。要求の行の丸と同じ） */
function CourseDot({ id, hows, sel, dispatch }: { id: number; hows: readonly How[]; sel: number | null; dispatch: (c: Command) => void }) {
  const title = hows.find((h) => h.id === id)?.title ?? '';
  return (
    <button type="button" className={`cb sm cc${id} cpick`} style={courseBg(id)} aria-pressed={sel === id} title={`コース ${id}: ${title}（押すと下のコースを選ぶ）`} onClick={() => dispatch({ id: 'home.select', courseId: id })}>
      {id}
    </button>
  );
}

/** 例の根拠の場所を「OrderTest.kt 15〜17 行」の形で。停留所のファイル名と行の範囲 */
function whereOf(analysis: Analysis, at: NonNullable<Summary['example']>['at']): string {
  return at
    .map((a) => {
      const s = analysis.symbols.find((x) => x.id === a.symbolId);
      const file = s?.path.split('/').pop() ?? a.symbolId;
      const lo = a.lines[0]!;
      const hi = a.lines.at(-1)!;
      return `${file} ${lo === hi ? lo : `${lo}〜${hi}`} 行`;
    })
    .join('、');
}

const isOld = (s: Summary): boolean => (s.problem ?? '') !== '' || (s.beforeAfter ?? []).length > 0 || (s.approach ?? []).length > 0;
