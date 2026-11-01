// 入口の説明タブ（設計書 3.1）。左に背景 / この PR の 2 段の説明（ExplainStages）、右に仕様 / 作者の説明。Analysis を読んで描くだけ。
// 仕様の箱は --ticket で指定したチケット（pr.ticket）を原文のまま出す（2026-10-12。取れなければ理由）。
// --ticket が無いときは題・ブランチ名・本文から LLM が選んだチケット（pr.ticketSearch）。選んだことは推定なので、見つけた場所を点線の枠で添える。
// チケットから抜き出した要求（specs。10.8）があれば点線の枠と「AI」で並べ、行の右に対応するコースの丸（下のカード・地図と同じ色と番号。
// 押すとそのコースを選ぶ = home.select）、無ければ赤の「対応するコースなし」。原文はその下に畳む（home.ticket で開く。見本を比べて決めた形）。
// 作者の説明は原文（pr.body）を Markdown として描き（GitHub と同じ規則。2026-10-10）、裏付けのない文（claims の backed: false）と完全一致する箇所にマーカー（2026-09-19 決定）。
// リンクは新しいタブ。画像は読めなければ（GitHub Enterprise Server の画像はログインが要る）リンクに替える。mermaid は図にする。
import type { Analysis, BodyCode, Claim, How, LlmRun, Spec, Ticket, TicketCandidate, TicketPlace, TicketSearch } from '@ondina/model';
import { toJsxRuntime, type Components } from 'hast-util-to-jsx-runtime';
import { useMemo, useState, type ComponentProps } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { authorBody } from '../authorBody.js';
import type { Command } from '../commands/commands.js';
import { ticketBody } from '../ticketBody.js';
import { placeName, quoteOf } from '../ticketPlace.js';
import { ExplainStages } from './ExplainStages.js';
import { Mermaid } from './Mermaid.js';
import { courseBg } from '../course.js';

export interface ExplainViewProps {
  analysis: Analysis;
  flavor: string;
  /** 入口で選んでいるコース（home.sel）。要求の行の丸を押された形にする */
  sel: number | null;
  /** チケットの原文を開いているか（home.ticket） */
  ticketOpen: boolean;
  /** 左の箱の段（home.stage。1 = 背景、2 = この PR） */
  stage: 1 | 2;
  dispatch: (c: Command) => void;
}

export function ExplainView({ analysis, flavor, sel, ticketOpen, stage, dispatch }: ExplainViewProps) {
  const { claims } = analysis;
  const search = analysis.pr.ticketSearch;
  return (
    <section className="view va">
      <ExplainStages analysis={analysis} stage={stage} sel={sel} dispatch={dispatch} />

      <div className="box" style={{ gridColumn: 2 }}>
        <SpecHead ticket={analysis.pr.ticket} guessed={search?.chosen !== undefined} />
        <div className="bd">
          <TicketSection analysis={analysis} sel={sel} ticketOpen={ticketOpen} dispatch={dispatch} flavor={flavor} />
        </div>
      </div>

      <div className="box" style={{ gridColumn: 2 }}>
        <h3>
          作者の説明 <span className="chip">主張として表示</span>
        </h3>
        <div className="bd">
          <AuthorText body={analysis.pr.body} claims={claims} code={analysis.pr.bodyCode ?? NO_CODE} flavor={flavor} />
        </div>
      </div>
    </section>
  );
}

function Flag({ claim }: { claim: Claim }) {
  return (
    <div className="flag">
      <span className="chip w">差分なし</span>
      <span>
        {claim.reason || claim.text}
      </span>
    </div>
  );
}

/** 古い解析（bodyCode が無い）。描き直すたびに本文を解析し直さないよう、同じ配列を渡す */
const NO_CODE: readonly BodyCode[] = [];

/** 原文があれば Markdown として描いてマーカー付きで、無ければ（古い解析）claims を 1 文 1 行で */
function AuthorText({ body, claims, code, flavor }: { body: string | undefined; claims: readonly Claim[]; code: readonly BodyCode[]; flavor: string }) {
  if (body === undefined) {
    if (claims.length === 0) return <p className="muted">PR 本文なし</p>;
    return (
      <>
        <p className="muted">この解析には本文の原文がありません（古い解析結果）。LLM が文ごとに分けたものを並べています</p>
        <ul className="claims">
          {claims.map((c, i) => (
            <li key={i} className={c.backed ? '' : 'unbacked'}>
              {c.text}
              {!c.backed && <span className="chip w">差分なし</span>}
            </li>
          ))}
        </ul>
        {claims.filter((c) => !c.backed).map((c, i) => (
          <Flag key={i} claim={c} />
        ))}
      </>
    );
  }
  if (body === '') return <p className="muted">PR 本文なし</p>;
  return <AuthorMarkdown body={body} claims={claims} code={code} flavor={flavor} />;
}

/** 本文（作者の説明・チケット）の要素の描き方: リンクは新しいタブ、画像は読めなければリンク、mermaid は図 */
function useBodyComponents(flavor: string): Partial<Components> {
  return useMemo<Partial<Components>>(
    () => ({
      a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
      img: (props) => <Img {...props} />,
      pre: (props: ComponentProps<'pre'>) => {
        const source = (props as { 'data-mermaid'?: string })['data-mermaid'];
        if (source === undefined) return <pre {...props} />;
        return (
          <Mermaid source={source} flavor={flavor}>
            <pre {...props} />
          </Mermaid>
        );
      },
    }),
    [flavor],
  );
}

const TICKET_FROM: Record<Ticket['source'], string> = { jira: 'Jira から', command: 'コマンドから', file: 'ファイルから' };

/** 「10/12 14:03」（手元の時刻） */
function when(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 仕様の箱の見出し。チケットがあれば「チケット」のチップと番号（ページがあればリンク）。題と本文から LLM が選んだものは「推定」 */
function SpecHead({ ticket, guessed }: { ticket: Ticket | undefined; guessed: boolean }) {
  if (ticket === undefined) return <h3>仕様</h3>;
  const name = `${ticket.key ?? ticket.ref}`;
  return (
    <h3>
      仕様 <span className="chip">チケット</span>
      {guessed && <span className="chip ai">推定</span>}
      {ticket.url === undefined ? (
        <span className="tk">{name}</span>
      ) : (
        <a className="tk" href={ticket.url} target="_blank" rel="noreferrer">
          {name} ↗
        </a>
      )}
    </h3>
  );
}

/**
 * 仕様の箱の中身。search が無い = --ticket で指定したか古い解析。LLM が選んだら見つけた場所の枠を頭に、選んでいなければ見つからなかった理由だけ。
 * 取れたチケットから要求を抜き出していれば（llmSpecs が ok で 1 件以上）要求の行と畳んだ原文。抜き出せなかった・0 件なら理由と開いた原文。
 * 抜き出していない（llmSpecs が無い: 古い解析・1 回目の LLM が動かなかった）なら原文だけ
 */
function TicketSection({ analysis, sel, ticketOpen, dispatch, flavor }: Omit<ExplainViewProps, 'analysis' | 'stage'> & { analysis: Analysis }) {
  const { ticket, ticketSearch: search } = analysis.pr;
  if (search !== undefined && search.chosen === undefined) return <TicketNotFound search={search} />;
  const lead = search === undefined ? null : <TicketGuess search={search} />;
  const original = <TicketView ticket={ticket} flavor={flavor} />;
  const run = analysis.llmSpecs;
  if (ticket === undefined || ticket.error !== undefined || run === undefined) {
    return (
      <>
        {lead}
        {original}
      </>
    );
  }
  if (run.status !== 'ok' || analysis.specs.length === 0) {
    return (
      <>
        {lead}
        <SpecNotice run={run} />
        {original}
      </>
    );
  }
  return (
    <>
      {lead}
      <Requirements specs={analysis.specs} hows={analysis.hows} sel={sel} dispatch={dispatch} />
      <button type="button" className="tkt-toggle" aria-expanded={ticketOpen} onClick={() => dispatch({ id: 'home.ticket' })}>
        <span aria-hidden="true">{ticketOpen ? '▾' : '▸'}</span>
        <b>チケットの原文</b>
        {ticket.title !== undefined && <span>{ticket.title}</span>}
      </button>
      {ticketOpen && <div className="tkt-orig">{original}</div>}
    </>
  );
}

/** チケットから抜き出した要求（10.8）。LLM の推定なので点線の枠と「AI」。行の右は対応するコースの丸（押すとそのコースを選ぶ）、無ければ赤 */
function Requirements({ specs, hows, sel, dispatch }: { specs: readonly Spec[]; hows: readonly How[]; sel: number | null; dispatch: (c: Command) => void }) {
  const title = new Map(hows.map((h) => [h.id, h.title]));
  return (
    <div className="spec-ai">
      <div className="cap">
        <span className="chip ai">AI</span>チケットから抜き出した要求<span className="muted">· 右 = 対応するコース（LLM が選び、ないものは赤）</span>
      </div>
      {specs.map((s, i) => (
        <div className="spec" key={s.id}>
          <span className="i">{i + 1}</span>
          <span className="t">{s.text}</span>
          <span className="hs">
            {s.hows.length === 0 ? (
              <span className="chip d">対応するコースなし</span>
            ) : (
              s.hows.map((n) => (
                <button key={n} type="button" className={`cb cc${n} cpick`} style={courseBg(n)} aria-pressed={sel === n} title={`コース ${n}: ${title.get(n) ?? ''}（押すと下のコースを選ぶ）`} onClick={() => dispatch({ id: 'home.select', courseId: n })}>
                  {n}
                </button>
              ))
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** 抜き出せなかった（LLM の失敗）か、LLM が 0 件と答えた。原文は開いたまま出す */
function SpecNotice({ run }: { run: LlmRun }) {
  const failed = run.status !== 'ok';
  return (
    <div className="spec-fail">
      <b>{failed ? '要求を抜き出せませんでした' : 'チケットに要求を見つけませんでした'}</b>
      <span>{failed ? (run.reason ?? '理由は受け取っていません') : 'LLM が 0 件と答えました'}</span>
      <span className="muted">チケットの原文をそのまま表示しています</span>
      <span className="muted">{failed ? 'もう一度 analyze すると抜き出し直します' : 'analyze に --relabel を付けると抜き出し直します'}</span>
    </div>
  );
}

/** --ticket で指定したチケット（3.1 / 5.1）。LLM を通さない原文なので実線の枠のまま。取れなければ理由 */
function TicketView({ ticket, flavor }: { ticket: Ticket | undefined; flavor: string }) {
  const tree = useMemo(() => (ticket === undefined ? undefined : ticketBody(ticket)), [ticket]);
  const components = useBodyComponents(flavor);
  const content = useMemo(() => (tree === undefined ? null : toJsxRuntime(tree, { Fragment, jsx, jsxs, components })), [tree, components]);
  if (ticket === undefined) {
    return (
      <>
        <p className="muted">チケット未指定</p>
        <p className="muted tkt-hint">analyze に --ticket（番号・URL・ファイル）を付けると、ここに表示されます</p>
      </>
    );
  }
  if (ticket.error !== undefined) {
    return (
      <div className="tkt-fail">
        <b>{ticket.key ?? ticket.ref} を取得できませんでした</b>
        <span>{ticket.error}</span>
        <span className="muted tkt-hint">直したら、もう一度 analyze すると取得し直します（解析はチケットなしで続けています）</span>
      </div>
    );
  }
  return (
    <>
      {ticket.title !== undefined && <div className="tkt-title">{ticket.title}</div>}
      <div className="tkt-meta">
        {ticket.kind !== undefined && <span className="chip">{ticket.kind}</span>}
        {ticket.status !== undefined && <span className="chip">{ticket.status}</span>}
        <span className="chip">{`${TICKET_FROM[ticket.source]} ${when(ticket.at)} に取得`}</span>
      </div>
      {content === null || tree?.children.length === 0 ? <p className="muted">本文なし</p> : <div className="tkt-body">{content}</div>}
    </>
  );
}

/** 題・ブランチ名・本文から LLM が選んだチケット（5.1 / 10.7）。選んだことは推定なので点線の枠。見つけた場所と、選ばなかった候補を添える */
function TicketGuess({ search }: { search: TicketSearch }) {
  const chosen = search.candidates.find((c) => c.ref === search.chosen);
  const others = search.candidates.filter((c) => c !== chosen);
  return (
    <div className="tkt-guess">
      <div className="cap">
        <span className="chip ai">推定</span>たぶん、この PR のチケット
      </div>
      {chosen !== undefined && (
        <div className="tkt-where">
          <span className="lbl">見つけた場所（題・ブランチ名・本文の候補から LLM が選びました）</span>
          {chosen.places.map((p, i) => (
            <Quote key={i} place={p} />
          ))}
        </div>
      )}
      {others.length > 0 && <Candidates label="選ばなかった候補" candidates={others} />}
      <p className="muted tkt-hint">違うときは analyze に --ticket（番号・URL・ファイル）を付けると、そのチケットを取得します</p>
    </div>
  );
}

/** 探したが選んでいない（候補なし / LLM がどれでもないと答えた / LLM を使わなかった・失敗した） */
function TicketNotFound({ search }: { search: TicketSearch }) {
  const { candidates, llm } = search;
  const answered = llm === undefined || llm.status === 'ok';
  const reason =
    candidates.length === 0
      ? 'PR の題・ブランチ名・本文に、チケットの番号や URL がありませんでした'
      : llm?.status === 'ok'
        ? '番号や URL の形の文字列はありましたが、LLM がこの PR のチケットではないと判断しました'
        : llm?.status === 'skipped'
          ? `LLM を使わずに解析したので（${llm.reason ?? '理由は受け取っていません'}）、候補を並べるだけにしています`
          : `LLM が失敗したので、候補を並べるだけにしています: ${llm?.reason ?? '理由は受け取っていません'}`;
  return (
    <div className="tkt-none">
      <b>{answered ? 'チケットは見つかりませんでした' : 'チケットを選んでいません'}</b>
      <span className="muted">{reason}</span>
      {candidates.length > 0 && <Candidates label="見つけた候補" candidates={candidates} />}
      <p className="muted tkt-hint">analyze に --ticket（番号・URL・ファイル）を付けると、ここに表示されます</p>
    </div>
  );
}

function Candidates({ label, candidates }: { label: string; candidates: readonly TicketCandidate[] }) {
  return (
    <div className="tkt-cands">
      <span className="lbl">{label}</span>
      {candidates.map((c) => (
        <div key={c.ref} className="tkt-cand">
          <code>{c.label}</code>
          <div>
            {c.places.map((p, i) => (
              <Quote key={i} place={p} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 見つけた場所の行。拾った文字列を強調する */
function Quote({ place }: { place: TicketPlace }) {
  const q = quoteOf(place);
  return (
    <div className="tkt-q">
      <span className="at">{placeName(place)}</span>「{q.before}
      <b className="hit">{q.hit}</b>
      {q.after}」
    </div>
  );
}

function AuthorMarkdown({ body, claims, code, flavor }: { body: string; claims: readonly Claim[]; code: readonly BodyCode[]; flavor: string }) {
  const { tree, marked, unmatched } = useMemo(() => authorBody(body, claims, code), [body, claims, code]);
  const components = useBodyComponents(flavor);
  const content = useMemo(() => toJsxRuntime(tree, { Fragment, jsx, jsxs, components }), [tree, components]);
  return (
    <>
      <div className="author">{content}</div>
      {marked.map((c, i) => (
        <Flag key={i} claim={c} />
      ))}
      {unmatched.length > 0 && (
        <div className="unmatched">
          <p className="muted">本文中に該当箇所を特定できなかった文（完全一致で探しています。コメントなど画面に出ない所にある文もここに表示します）</p>
          {unmatched.map((c, i) => (
            <div key={i} className="flag">
              <span className="chip w">差分なし</span>
              <span>
                <b>{c.text}</b>
                {c.reason ? ` — ${c.reason}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const NO_CLAIMS: readonly Claim[] = [];

/** PR 一覧の PR の詳細（3.11）の本文とコメント。作者の説明と同じ描き方で、マーカーとコードの色は無い */
export function BodyMarkdown({ body, flavor }: { body: string; flavor: string }) {
  const tree = useMemo(() => authorBody(body, NO_CLAIMS, NO_CODE).tree, [body]);
  const components = useBodyComponents(flavor);
  const content = useMemo(() => toJsxRuntime(tree, { Fragment, jsx, jsxs, components }), [tree, components]);
  return <div className="author">{content}</div>;
}

/** 画像。読めなければ「画像: 代替テキスト」のリンクにする（GitHub Enterprise Server の画像はログインが要り、この画面からは読めないことがある） */
function Img({ src, alt, ...rest }: ComponentProps<'img'>) {
  const [broken, setBroken] = useState(false);
  if (broken || !src) {
    return (
      <a href={src} target="_blank" rel="noreferrer">
        画像: {alt || src}
      </a>
    );
  }
  return <img {...rest} src={src} alt={alt} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}
