// 共通シェルのトップバー（設計書 3.0）。PR 切替、解析し直す（2026-11-04）、完了メーター、画面の行き先（PR 一覧 / 全体図 / 目的ごと / 差分一覧 / 締め。2026-09-30 に左の列から移した）、
// ⌘K、動いている処理（解析と AI レビュー。2026-10-22）、設定（歯車 → モーダル）。「GitHub で承認」は 2026-10-03 に締め（3.9）の中へ移した。
import type { AnalysisSummary, AnalyzeJob, ReviewJob } from '@ondina/model';
import type { Command } from '../commands/commands.js';
import type { Meter, Ratio } from '../meter.js';
import type { CourseAt, View } from '../state/reducer.js';
import { isActive, jobOf } from '../reanalyze.js';
import { Key, useKey } from './Key.js';

export interface TopBarProps {
  analyses: AnalysisSummary[];
  current: AnalysisSummary | null;
  meter: Meter | null;
  view: View;
  /** いたコースの場所（目的ごと・差分一覧の画面から戻るボタンに使う） */
  course: CourseAt | null;
  /** 解析を読めているか。読めていなければ画面の行き先は押せない（PR 一覧と設定は押せる） */
  loaded: boolean;
  requirement?: boolean;
  /** serve の解析の列。順番待ちか解析中があれば歯車の左に出す */
  jobs: AnalyzeJob[];
  /** serve の AI レビュー。レビュー中があれば同じ所に数を出す */
  reviews: ReviewJob[];
  dispatch: (c: Command) => void;
}

export function TopBar({ analyses, current, meter, view, course, requirement = false, loaded, jobs, reviews, dispatch }: TopBarProps) {
  const paletteKey = useKey('palette.open');
  const label = (a: AnalysisSummary) => `${a.key === 'local' ? 'local' : `#${a.key}`} ${a.headSha.slice(0, 7)}`;
  return (
    <header className="top">
      {/* 何も開いていない（PR 一覧から始めた）ときは選択を出さない。value が無い select は先頭の解析を開いているように見える */}
      {analyses.length > 1 && current ? (
        <select
          aria-label="解析を切り替える"
          value={current ? `${current.key}/${current.headSha}` : ''}
          onChange={(e) => {
            const [key, headSha] = e.target.value.split('/') as [string, string];
            dispatch({ id: 'analysis.select', key, headSha });
          }}
        >
          {analyses.map((a) => (
            <option key={`${a.key}/${a.headSha}`} value={`${a.key}/${a.headSha}`}>
              {label(a)}
            </option>
          ))}
        </select>
      ) : (
        <span className="num">{current ? label(current) : 'ondina'}</span>
      )}
      {current && view !== 'prs' && <ReanalyzeButton busy={isActive(jobOf(jobs, current.key))} dispatch={dispatch} />}
      {/* PR 一覧は開いている解析の画面ではないので、その題名・ブランチ・メーターを出さない */}
      {current && view !== 'prs' && (
        <>
          <span className="ttl">{current.pr.title}</span>
          <span className="br">
            {current.pr.head} → {current.pr.base}
          </span>
        </>
      )}
      {meter && view !== 'prs' && <MeterBar m={meter} view={view} dispatch={dispatch} />}
      {/* メーターの無い PR 一覧でも、行き先を他の画面と同じ右寄せの位置に置く */}
      {view === 'prs' && <span className="fill" />}
      <nav className="go" aria-label="画面">
        <button type="button" className={`btn quiet${view === 'prs' ? ' on' : ''}`} aria-current={view === 'prs' ? 'page' : undefined} onClick={() => dispatch({ id: 'view.prs' })}>
          PR 一覧 <Key action="view.prs" />
        </button>
        <button type="button" className={`btn quiet${view === 'home' ? ' on' : ''}`} aria-current={view === 'home' ? 'page' : undefined} disabled={!loaded} onClick={() => dispatch({ id: 'view.home' })}>
          全体図{view === 'course' && <kbd>Esc</kbd>}
        </button>
        {requirement ? (
          <button type="button" className={`btn quiet${view === 'req' ? ' on' : ''}`} aria-current={view === 'req' ? 'page' : undefined} onClick={() => dispatch({ id: 'view.course' })}>要求コース</button>
        ) : course !== null && view !== 'course' && (
          <button type="button" className="btn quiet" onClick={() => dispatch({ id: 'view.course' })}>
            {course.id === 0 ? 'コース外に戻る' : `コース ${course.id} に戻る`}
          </button>
        )}
        {/* チケットのある PR は目的ごとの画面を持たない（要求コースが代わる） */}
        {!requirement && (
          <button type="button" className={`btn quiet${view === 'hows' ? ' on' : ''}`} aria-current={view === 'hows' ? 'page' : undefined} disabled={!loaded} onClick={() => dispatch({ id: 'view.hows' })}>
            目的ごと
          </button>
        )}
        <button type="button" className={`btn quiet${view === 'diff' ? ' on' : ''}`} aria-current={view === 'diff' ? 'page' : undefined} disabled={!loaded} onClick={() => dispatch({ id: 'view.diff' })}>
          差分一覧 <Key action="view.diff" />
        </button>
        <button type="button" className={`btn quiet${view === 'closing' ? ' on' : ''}`} aria-current={view === 'closing' ? 'page' : undefined} disabled={!loaded} onClick={() => dispatch({ id: 'view.closing' })}>
          締め
        </button>
      </nav>
      {current && (
        <button type="button" className="btn" onClick={() => dispatch({ id: 'palette.open' })} aria-label="コマンドパレット">
          {paletteKey ?? 'パレット'}
        </button>
      )}
      <JobsChip jobs={jobs} reviews={reviews} dispatch={dispatch} />
      <button type="button" className="btn gear" onClick={() => dispatch({ id: 'settings.open' })} aria-label="設定" title="設定">
        ⚙
      </button>
    </header>
  );
}

/** 開いている版をいつでも解析し直す（設定を変えた・前の ondina で作った解析を作り直すとき）。順番待ちか解析中の間は押せない */
function ReanalyzeButton({ busy, dispatch }: { busy: boolean; dispatch: (c: Command) => void }) {
  return (
    <button type="button" className="btn sm" disabled={busy} title={busy ? 'この PR を解析しています' : '開いているバージョンを解析し直します'} onClick={() => dispatch({ id: 'reanalyze.start', now: Date.now() })}>
      解析し直す
    </button>
  );
}

const keyLabel = (key: string) => (key === 'local' ? 'local' : `#${key}`);

/** 動いている処理（「解析中 #415 · 順番待ち 2 · AI レビュー中 1」）。押すと PR 一覧。何も動いていなければ出さない */
function JobsChip({ jobs, reviews, dispatch }: { jobs: AnalyzeJob[]; reviews: ReviewJob[]; dispatch: (c: Command) => void }) {
  const running = jobs.find((j) => j.status === 'running');
  const queued = jobs.filter((j) => j.status === 'queued').length;
  // 解析待ちの AI レビューは数えない（その解析が「解析中」「順番待ち」に出ている）
  const reviewing = reviews.filter((j) => j.status === 'running').length;
  const parts = [...(running ? [`解析中 ${keyLabel(running.key)}`] : []), ...(queued > 0 ? [`順番待ち ${queued}`] : []), ...(reviewing > 0 ? [`AI レビュー中 ${reviewing}`] : [])];
  if (parts.length === 0) return null;
  return (
    <button type="button" className="btn jobs" aria-label="動いている処理" onClick={() => dispatch({ id: 'view.prs' })}>
      <span className="spin" aria-hidden="true" />
      {parts.join(' · ')}
    </button>
  );
}

function cls(r: Ratio, strict: boolean): string {
  if (r.total === 0) return 'm';
  if (r.n >= r.total) return 'm done';
  return strict ? 'm bad' : 'm';
}

function MeterBar({ m, view, dispatch }: { m: Meter; view: View; dispatch: (c: Command) => void }) {
  const req = m.requirements;
  return (
    <div className="meter" aria-label="完了メーター">
      <span className={cls(m.assigned, true)}>
        帰属 <b>{m.assigned.n}/{m.assigned.total}</b>
      </span>
      <span className={cls(m.viewed, false)}>
        閲覧 <b>{m.viewed.n}/{m.viewed.total}</b>
      </span>
      <span className="m">
        絡み <b>{m.tangled}</b>
      </span>
      {req ? (
        // チケットのある PR: コースと仕様の代わりに、要求の進み具合 1 つ。押すと要求コース
        <button type="button" className={cls(req, false)} aria-current={view === 'req' ? 'page' : undefined} title="要求コースを開く" onClick={() => dispatch({ id: 'view.course' })}>
          要求 <b>{req.n}/{req.total}</b>
        </button>
      ) : (
        <>
          <span className={cls(m.tours, false)}>
            コース <b>{m.tours.n}/{m.tours.total}</b>
          </span>
          <span className={cls(m.specs, true)}>
            仕様 <b>{m.specs.n}/{m.specs.total}</b>
          </span>
        </>
      )}
    </div>
  );
}
