// UI の入口。Analysis.json と ReviewState を API から取り、描くだけ（設計書 18.1）。画面は view で切り替える（PR 一覧 / 入口 / 目的ごと / コース / 差分一覧 / 締め）。
// 状態遷移は reducer、副作用（保存・読込・URL）はここで実行する。キーボードもマウスも同じコマンドを dispatch する（18.2）。
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { ConflictError, httpApi, type Api } from './api.js';
import type { Command } from './commands/commands.js';
import { bindingsOf, OVERLAY_COMMANDS, resolveKey } from './commands/keymap.js';
import { ClosingView } from './components/ClosingView.js';
import { DiffPane } from './components/DiffPane.js';
import { FileList } from './components/FileList.js';
import { GithubToast } from './components/GithubToast.js';
import { DefDrawer } from './components/DefDrawer.js';
import { DefLinks, useHeldModifier } from './diff/DefLinks.js';
import { HomeView } from './components/HomeView.js';
import { HowView } from './components/HowView.js';
import { KeysContext } from './components/Key.js';
import { KeymapHelp } from './components/KeymapHelp.js';
import { Palette } from './components/Palette.js';
import { SettingsModal } from './components/SettingsModal.js';
import { TopBar } from './components/TopBar.js';
import { CourseView } from './components/CourseView.js';
import { PaneHandle } from './components/PaneHandle.js';
import { PrListView } from './components/PrListView.js';
import { ReanalyzeStrip } from './components/ReanalyzeStrip.js';
import { AskContext } from './components/AskButton.js';
import { AskDrawer } from './components/AskDrawer.js';
import { RelDrawer } from './components/RelDrawer.js';
import { courseColorVars } from './course.js';
import { groupFiles } from './files.js';
import { meter } from './meter.js';
import { paneStyle } from './panes.js';
import { reviewActive } from './prs.js';
import { isActive, stripOf } from './reanalyze.js';
import { formatRoute, parseRoute, routeOf, routeTarget, sameEntry, type Route } from './route.js';
import { canSend, diffModeOf, findable, initialState, overlayOpen, reduce, themeOf, type AppState, type Effect } from './state/reducer.js';
import { flavorOf, useOsDark } from './theme.js';

/** 新しい head を聞く間隔（画面を開いている間。画面に戻ったときにも聞く）。見本を比べて 2 分おきにした */
const CHECK_MS = 2 * 60 * 1000;
/** 解析の順番待ちか解析中、AI レビューの解析待ちかレビュー中がある間、serve に聞く間隔 */
const POLL_MS = 1000;

/** 今の URL の画面 */
const here = (): Route => parseRoute(window.location.pathname, window.location.search);

/**
 * URL を今の画面のものにする。解析・バージョン・画面の種類が替わったら履歴を足し、同じ画面の中の動き（停留所・ファイル・絞り込み）は書き換える。
 * replace = URL の画面を出している間（起動・戻る・進む）。そこで足すと、戻るたびに同じ画面の履歴が増える
 */
function syncUrl(state: AppState, replace: boolean): void {
  const route = routeOf(state);
  if (route === null) return;
  const url = formatRoute(route);
  if (url === window.location.pathname + window.location.search) return;
  if (replace || sameEntry(here(), route)) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

export function App({ api = httpApi, initialKey }: { api?: Api; initialKey?: string | undefined }) {
  const stateRef = useRef<AppState>(initialState());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const dispatchRef = useRef<(c: Command) => void>(() => {});
  /** 待っている問い（案内人に聞く。3.10）。止める・別の解析を読むと abort する */
  const askAbort = useRef<AbortController | null>(null);
  /** GitHub の Viewed の付ける・外すは、押した順に 1 つずつ送る（付けてすぐ外したときに入れ替わらない。12.1） */
  const githubQueue = useRef<Promise<void>>(Promise.resolve());
  /** URL の画面を出している間（起動・戻る・進む）は 1 以上。その間は URL を書き換えるだけで履歴を足さない */
  const applying = useRef(0);
  /** URL の画面を出すたびに進む。解析を読んでいる間に次の戻る・進むが来たら、前の画面は出さない */
  const showing = useRef(0);

  const load = useCallback(
    async (key: string, headSha: string, view?: 'closing') => {
      const summary = stateRef.current.analyses.find((a) => a.key === key && a.headSha === headSha);
      if (!summary) return;
      const [analysis, review] = await Promise.all([api.getAnalysis(key, headSha), api.getState(key, headSha)]);
      dispatch({ id: 'data.loaded', summary, analysis, review, ...(view === undefined ? {} : { view }) });
    },
    [api],
  );
  // 解析の列と AI レビューを serve に聞く（AI レビューが解析を列に入れることがあるので、いつも両方）
  const pollJobs = useCallback(() => {
    api.analyzeStatus().then(
      (jobs) => dispatchRef.current({ id: 'reanalyze.job', jobs }),
      () => undefined, // 次のポーリングで届く
    );
    api.reviewStatus().then(
      (jobs) => dispatchRef.current({ id: 'review.jobs', jobs }),
      () => undefined,
    );
  }, [api]);

  const run = useCallback(
    (effect: Effect, state: AppState) => {
      switch (effect.type) {
        case 'fetchPrs':
          api.listPrs().then(
            (list) => dispatchRef.current({ id: 'prs.loaded', list }),
            (e: unknown) => dispatchRef.current({ id: 'prs.failed', reason: e instanceof Error ? e.message : String(e) }),
          );
          // AI の下書きの数は serve が今の state から数えるので、締めで採用・破棄してから戻ったときに合わせる
          pollJobs();
          break;
        case 'fetchPrDetail': {
          const { number } = effect;
          api.getPrDetail(number).then(
            (detail) => dispatchRef.current({ id: 'prDetail.loaded', number, detail }),
            (e: unknown) => dispatchRef.current({ id: 'prDetail.failed', number, reason: e instanceof Error ? e.message : String(e) }),
          );
          break;
        }
        case 'saveState':
          if (state.current && state.review) void api.putState(state.current.key, state.current.headSha, state.review);
          break;
        case 'saveUi':
          void api.putUi(state.ui);
          break;
        case 'loadAnalysis':
          void load(effect.key, effect.headSha, effect.view);
          break;
        case 'startReview': {
          const { key, headSha } = effect;
          api.startReview(key, headSha).then(pollJobs, (e: unknown) => dispatchRef.current({ id: 'review.startFailed', key, headSha, reason: e instanceof Error ? e.message : String(e) }));
          break;
        }
        case 'stopReview':
          api.stopReview(effect.key).then(pollJobs, pollJobs);
          break;
        case 'loadComments': {
          const { key, headSha } = effect;
          api.getState(key, headSha).then(
            (review) => dispatchRef.current({ id: 'comments.arrived', key, headSha, comments: review.comments }),
            () => undefined, // 読めなければ、タブに戻ったときに読み直す
          );
          break;
        }
        case 'openUrl':
          window.location.assign(effect.url);
          break;
        case 'openTab':
          window.open(effect.url, '_blank', 'noopener,noreferrer');
          break;
        case 'ask':
          if (state.current) {
            const { key, headSha } = state.current;
            const stop = new AbortController();
            askAbort.current = stop;
            api.ask(key, headSha, { key: effect.key, place: effect.place, question: effect.question }, stop.signal).then(
              (entry) => {
                if (askAbort.current === stop) askAbort.current = null;
                if (!stop.signal.aborted) dispatchRef.current({ id: 'ask.done', entry });
              },
              (e: unknown) => {
                if (askAbort.current === stop) askAbort.current = null;
                if (!stop.signal.aborted) dispatchRef.current({ id: 'ask.failed', key: effect.key, question: effect.question, reason: e instanceof Error ? e.message : String(e) });
              },
            );
          }
          break;
        case 'askStop':
          askAbort.current?.abort();
          askAbort.current = null;
          break;
        case 'loadAsk':
          api.getAsk(effect.key, effect.headSha).then(
            (log) => dispatchRef.current({ id: 'ask.loaded', key: effect.key, headSha: effect.headSha, entries: log.entries }),
            () => undefined, // 記録が読めなくても聞ける（会話が空に見えるだけ）
          );
          break;
        case 'checkLatest':
          // 聞けなければ（gh が使えないなど）前の答えのまま
          api.latest(effect.key, effect.headSha).then(
            (latest) => dispatchRef.current({ id: 'reanalyze.checked', key: effect.key, headSha: effect.headSha, latest }),
            () => undefined,
          );
          break;
        case 'startAnalyze': {
          const { key, from } = effect;
          api.startAnalyze(key, from).then(
            () =>
              api.analyzeStatus().then(
                (jobs) => dispatchRef.current({ id: 'reanalyze.job', jobs }),
                () => undefined, // 次のポーリングで届く
              ),
            (e: unknown) => dispatchRef.current({ id: 'reanalyze.startFailed', key, ...(from === undefined ? {} : { from }), reason: e instanceof Error ? e.message : String(e) }),
          );
          break;
        }
        case 'refreshAnalyses':
          api.listAnalyses().then(
            (analyses) => dispatchRef.current({ id: 'analyses.loaded', analyses }),
            () => undefined,
          );
          break;
        case 'switchTo':
          void api.listAnalyses().then(async (analyses) => {
            dispatchRef.current({ id: 'analyses.loaded', analyses });
            await load(effect.key, effect.headSha);
          });
          break;
        case 'githubRead': {
          const { key, headSha, quiet } = effect;
          api.getGithubViewed(key, headSha).then(
            (r) => dispatchRef.current({ id: 'github.loaded', key, headSha, viewed: r.viewed }),
            (e: unknown) => dispatchRef.current({ id: 'github.loadFailed', key, headSha, reason: e instanceof Error ? e.message : String(e), quiet }),
          );
          break;
        }
        case 'githubSet': {
          const { key, headSha, mark, unmark, retried } = effect;
          githubQueue.current = githubQueue.current.then(() =>
            api.setGithubViewed(key, headSha, { mark, unmark }).then(
              () => dispatchRef.current({ id: 'github.set', key, headSha, mark, unmark, retried }),
              (e: unknown) => dispatchRef.current({ id: 'github.setFailed', key, headSha, mark, unmark, reason: e instanceof Error ? e.message : String(e), conflict: e instanceof ConflictError }),
            ),
          );
          break;
        }
        case 'sendComments':
          if (state.current) {
            const { key, headSha } = state.current;
            api.sendComments(key, headSha).then(
              (r) => dispatchRef.current({ id: 'comment.sent', key, headSha, ids: r.sent, ...('url' in r ? { url: r.url } : { waiting: r.waiting }) }),
              (e: unknown) => dispatchRef.current({ id: 'comment.sendFailed', key, headSha, message: e instanceof Error ? e.message : String(e) }),
            );
          }
          break;
      }
    },
    [api, load, pollJobs],
  );

  const dispatch = useCallback(
    (command: Command) => {
      const { state, effects } = reduce(stateRef.current, command);
      // 何も変わらなければ描き直さない（差分一覧のスクロールの知らせは、境目をまたぐたびに来る）
      if (state !== stateRef.current) {
        stateRef.current = state;
        rerender();
        syncUrl(state, applying.current > 0);
      }
      for (const e of effects) run(e, state);
    },
    [run],
  );
  dispatchRef.current = dispatch;

  /** URL の画面を出す。別の解析・バージョンなら読んでから。呼ぶ側が applying を上げておく */
  const show = useCallback(
    async (route: Route) => {
      const n = ++showing.current;
      const s = stateRef.current;
      if (route.kind === 'prs') {
        // PR 一覧の後ろでも最新の解析を開いておく（上の帯の全体図などを押せるように。起動したときだけ）
        const latest = s.analyses[0];
        if (s.current === null && latest) await load(latest.key, latest.headSha);
        if (n === showing.current) dispatch({ id: 'view.prs' });
        return;
      }
      const t = routeTarget(s.analyses, route);
      if (t === null) return;
      if (s.current?.key !== t.summary.key || s.current.headSha !== t.summary.headSha) await load(t.summary.key, t.summary.headSha);
      if (n === showing.current) dispatch({ id: 'route.go', page: t.page });
    },
    [dispatch, load],
  );

  // 起動: 解析の一覧・UI 設定・表示設定（ondina.config.yaml）を取り、URL の画面を出す（initialKey はその key の最新の説明タブ）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [analyses, ui, config] = await Promise.all([api.listAnalyses(), api.getUi(), api.getConfig()]);
      if (cancelled) return;
      applying.current++;
      try {
        dispatch({ id: 'analyses.loaded', analyses });
        dispatch({ id: 'ui.loaded', ui });
        dispatch({ id: 'config.loaded', config });
        // 画面を読み直したとき、serve で解析・AI レビューをしていればその進みに戻る
        pollJobs();
        await show(initialKey === undefined ? here() : { kind: 'analysis', key: initialKey, sha: null, page: { kind: 'explain' } });
      } finally {
        applying.current--;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, dispatch, pollJobs, show, initialKey]);

  // ブラウザの戻る・進む: その URL の画面へ
  useEffect(() => {
    const onPop = () => {
      applying.current++;
      void show(here()).finally(() => {
        applying.current--;
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [show]);

  // タブに戻ったら state を読み直し、開いている間に外から（ondina comments add）足した AI の下書きを並べる（12 章）。
  // 解析の一覧も読み直す（開いている間にターミナルの ondina analyze が足した解析を左上に出す）。
  // 新しいコミットがあるかも聞く（3.0）。開いている間は 2 分おきにも聞く
  // GitHub の Viewed も読み直す（GitHub の画面で付け外ししたのを差分一覧に出す。12.1。失敗しても通知しない）
  // PR 一覧を開いていれば、一覧も取り直す（GitHub の画面でレビューした後に戻ってきたとき。3.11）
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      run({ type: 'refreshAnalyses' }, stateRef.current);
      if (stateRef.current.view === 'prs') dispatch({ id: 'prs.refresh' });
      const cur = stateRef.current.current;
      if (!cur) return;
      api.getState(cur.key, cur.headSha).then(
        (review) => dispatch({ id: 'comments.arrived', key: cur.key, headSha: cur.headSha, comments: review.comments }),
        () => undefined, // 読めなければ今の画面のまま
      );
      dispatch({ id: 'reanalyze.check' });
      if (cur.key !== 'local') run({ type: 'githubRead', key: cur.key, headSha: cur.headSha, quiet: true }, stateRef.current);
    };
    const check = () => {
      if (document.visibilityState !== 'hidden') dispatch({ id: 'reanalyze.check' });
    };
    const timer = window.setInterval(check, CHECK_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [api, dispatch, run]);

  // キーボード: 入力欄の中では効かせない。重なった画面（設定・? の一覧・パレット）の間は、閉じるか替えるコマンドだけ通し、後ろの画面に届けない（Enter は重なった画面のボタンに効く）。
  // キーは既定 + 設定で変えたキー（ui.json の keymap）
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const { command, pending: next } = resolveKey(e.key, pending.current, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey }, bindingsOf(stateRef.current.ui.keymap));
      pending.current = next;
      if (command && overlayOpen(stateRef.current) && !OVERLAY_COMMANDS.has(command.id)) return;
      // 差分の列を出していない画面の ⌘F は、ブラウザのページ内検索に任せる
      if (command?.id === 'find.open' && !findable(stateRef.current)) return;
      if (command) {
        e.preventDefault();
        dispatch(command);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  const s = stateRef.current;
  // メモの範囲をなぞっている間（「+」を押したまま）は、どこで離しても終える（行の外・窓の外で離したとき、別の窓に移ったときも）
  const dragging = s.memo.drag;
  useEffect(() => {
    if (!dragging) return;
    const drop = () => dispatch({ id: 'memo.drop' });
    window.addEventListener('mouseup', drop);
    window.addEventListener('blur', drop);
    return () => {
      window.removeEventListener('mouseup', drop);
      window.removeEventListener('blur', drop);
    };
  }, [dragging, dispatch]);
  // 解析か AI レビューが動いている間は 1 秒おきに serve に聞く（進みの 1 行と、終わり・失敗）
  const jobsActive = s.reanalyze.jobs.some(isActive) || s.reviews.some(reviewActive);
  useEffect(() => {
    if (!jobsActive) return;
    const t = window.setInterval(pollJobs, POLL_MS);
    return () => window.clearInterval(t);
  }, [pollJobs, jobsActive]);
  // 画面の設定は ui.json（PR をまたぐ）。解析が無くても効く
  const osDark = useOsDark();
  const theme = themeOf(s);
  const flavor = flavorOf(theme, osDark);
  const { accent } = theme;
  const diffMode = diffModeOf(s);
  useEffect(() => {
    document.documentElement.dataset['flavor'] = flavor;
    document.documentElement.dataset['accent'] = accent;
  }, [flavor, accent]);

  const packagePrefix = s.config?.packagePrefix;
  const files = useMemo(() => (s.analysis && s.review ? groupFiles(s.analysis.hunks, s.review.viewed, packagePrefix) : []), [s.analysis, s.review, packagePrefix]);
  const m = s.analysis && s.review ? meter(s.analysis, s.review.viewed) : null;
  // 差分一覧の列は全部のファイル（ツリーの順。2026-10-20）。解析だけから作る（問題なしを付けるたびに行列を作り直さない = スクロールの効果も走らない）
  const listHunks = useMemo(() => (s.analysis ? groupFiles(s.analysis.hunks, [], packagePrefix).flatMap((f) => f.hunks) : []), [s.analysis, packagePrefix]);
  // 帯で開いた行は全部のファイルの分を合わせて渡す（差分の行の key は hunk の id を含むので、ファイルをまたいで重ならない）
  const listOpen = useMemo(() => Object.values(s.fold).flat(), [s.fold]);

  const bindings = useMemo(() => bindingsOf(s.ui.keymap), [s.ui.keymap]);
  // 名前から定義へ（3.6）: コードを出す画面（差分一覧・目的ごと・コース）で ⌘ を押している間、移れる名前に下線
  useHeldModifier((s.view === 'diff' || s.view === 'hows' || s.view === 'course') && s.analysis?.defs !== undefined);
  const defBack = s.analysis?.defs ? { defBack: s.defBack.length } : {};
  const unread = s.ask.unread.length > 0;
  const askStatus = useMemo(() => ({ open: s.ask.open, pending: s.ask.pending !== null, unread, dispatch }), [s.ask.open, s.ask.pending, unread, dispatch]);

  return (
    <AskContext.Provider value={askStatus}>
    <KeysContext.Provider value={bindings}>
    {/* コースの丸の色（並び順に 7 色）。番号ごとの --c<番号> は解析のコースで決まる */}
    <div className={`app${s.ask.open ? ' asking' : ''}${s.view === 'prs' ? ' prs' : ''}`} style={s.analysis ? courseColorVars(s.analysis.hows.map((w) => w.id)) : undefined}>
      <TopBar analyses={s.analyses} current={s.current} meter={m} view={s.view} course={s.course} loaded={s.analysis !== null} jobs={s.reanalyze.jobs} reviews={s.reviews} dispatch={dispatch} />
      {/* PR 一覧は開いている解析を出さないので、その解析の知らせも出さない（解析の状態はカードの中） */}
      {s.view !== 'prs' && <ReanalyzeStrip strip={stripOf(s)} dispatch={dispatch} />}
      <main className="stage">
        {s.view === 'prs' && <PrListView prs={s.prs} analyses={s.analyses} jobs={s.reanalyze.jobs} reviews={s.reviews} reviewEnabled={(s.ui.reviewCommand ?? '').trim() !== ''} flavor={flavor} dispatch={dispatch} />}
        {s.view === 'home' && s.analysis && s.review && <HomeView analysis={s.analysis} review={s.review} flavor={flavor} home={s.home} zoom={s.mapZoom} speed={s.ui.mapSpeed ?? 1} dispatch={dispatch} />}
        {s.view === 'hows' && s.analysis && s.review && (
          <HowView
            analysis={s.analysis}
            viewed={s.review.viewed}
            mode={diffMode.b}
            selectedHunk={s.selectedHunk}
            selectedHow={s.selectedHow}
            openGroups={s.openGroups}
            packagePrefix={packagePrefix}
            repoName={s.current?.repoName ?? null}
            fold={s.fold}
            full={s.fullFile}
            find={s.find}
            focusLine={s.focusLine}
            {...defBack}
            dispatch={dispatch}
          />
        )}
        {s.view === 'course' && s.analysis && s.review && (
          <CourseView analysis={s.analysis} review={s.review} diffMode={diffMode.c} course={s.course} courseMap={s.courseMap} fullFile={s.fullFile} fold={s.fold} folded={s.courseFolded} panes={s.ui.panes} peek={s.peek} zoom={s.mapZoom} repoName={s.current?.repoName ?? null} memo={s.memo} draftText={s.draftText} focusLine={s.focusLine} {...defBack} treeShut={s.treeShut.course} ask={s.ask} dispatch={dispatch} />
        )}
        {s.view === 'diff' && (
          <section className="view vd" style={paneStyle(s.ui.panes, ['diffTree'])}>
            {/* ツリーの明るい行は一番上のファイル（選んだ差分は見えている間は動かさないので、別のファイルのことがある） */}
            <FileList files={files} selected={s.diffFile ?? s.selectedFile} shut={s.treeShut.diff} github={s.github.viewed} dispatch={dispatch} />
            <PaneHandle pane="diffTree" dispatch={dispatch} />
            <DefLinks defs={s.analysis?.defs} dispatch={dispatch}>
              <DiffPane
                hunks={listHunks}
                jump={s.diffJump}
                mode={diffMode.d}
                viewed={s.review?.viewed ?? []}
                selectedHunk={s.selectedHunk}
                repoName={s.current?.repoName ?? null}
                {...(s.analysis && s.review ? { memo: { comments: s.review.comments, ui: s.memo, githubDiff: s.analysis.githubDiff, draftText: s.draftText } } : {})}
                focusLine={s.focusLine}
                open={listOpen}
                full={s.fullFile}
                find={s.find}
                {...defBack}
                dispatch={dispatch}
              />
            </DefLinks>
          </section>
        )}
        {s.view === 'closing' && s.analysis && s.review && (
          <ClosingView analysis={s.analysis} review={s.review} current={s.current} packagePrefix={packagePrefix} send={s.send} canSend={canSend(s)} memo={s.memo} draftText={s.draftText} dispatch={dispatch} />
        )}
        {s.view !== 'diff' && s.view !== 'prs' && !s.analysis && (
          <section className="view">
            <div className="empty">解析がまだありません。<code>ondina analyze</code> で解析すると、ここに表示されます</div>
          </section>
        )}
      </main>
      {s.rel && s.analysis && s.review && <RelDrawer analysis={s.analysis} rel={s.rel} viewed={s.review.viewed} memo={{ comments: s.review.comments, ui: s.memo, githubDiff: s.analysis.githubDiff, draftText: s.draftText }} focusLine={s.focusLine} dispatch={dispatch} />}
      {s.def && s.analysis && (
        <DefLinks defs={s.analysis.defs} dispatch={dispatch}>
          <DefDrawer analysis={s.analysis} def={s.def} viewed={s.review?.viewed ?? []} dispatch={dispatch} />
        </DefLinks>
      )}
      {s.ask.open && s.analysis && <AskDrawer analysis={s.analysis} ask={s.ask} dispatch={dispatch} />}
      {s.showKeymap && <KeymapHelp dispatch={dispatch} />}
      {s.settings !== null && <SettingsModal tab={s.settings} theme={theme} worktreeRoot={s.ui.worktreeRoot ?? ''} llmCommand={s.ui.llmCommand ?? ''} reviewCommand={s.ui.reviewCommand ?? ''} ticket={s.ui.ticket ?? {}} dispatch={dispatch} />}
      <GithubToast toast={s.github.toast} dispatch={dispatch} />
      {s.showPalette && s.analysis && <Palette analysis={s.analysis} packagePrefix={packagePrefix} from={s.paletteFrom} selectedHow={s.view === 'course' ? (s.course?.id ?? null) : s.selectedHow} dispatch={dispatch} />}
    </div>
    </KeysContext.Provider>
    </AskContext.Provider>
  );
}
