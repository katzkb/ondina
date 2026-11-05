// App に注入する偽の API。メモリ上の .ondina 相当。put は実際に中身を書き換える（モックの呼び出し回数ではなく状態で検証する）。
import type { Analysis, AnalysisSummary, AnalyzeJob, AskEntry, AskPlace, DisplayConfig, LatestHead, PrDetail, PrList, ReviewJob, ReviewState, UiSettings } from '@ondina/model';
import type { Api, SendResult } from '../src/api.js';
import { onGithubDiff } from '../src/memo.js';
import { emptyReview, fixtureAnalysis } from './fixture.js';

export interface FakeApiOptions {
  /** 'local' か PR 番号。既定は local */
  key?: string;
  /**
   * sendComments の振る舞い。省略時は serve と同じく、採用済みのうち GitHub の差分に出ない行の物を除いて送り、固定の url を返す
   * （local なら採用済みを全部 AI に返して、待っている AI はいない）。throw すれば失敗
   */
  send?: (state: ReviewState) => SendResult;
  /** GET /api/config の返り。既定は yaml が無いときの値 */
  config?: DisplayConfig;
  /** PR ページの URL（締めの「GitHub で承認」が開く）。既定は無し */
  prUrl?: string;
  /**
   * 案内人に聞く（POST /api/ask）の振る舞い。既定は「答え: <質問>」と、Order.kt 13 行目（head）の場所の項目・場所を確かめられない項目を返す。
   * Promise を返せば答えを遅らせられる（signal で止まる）。throw / reject すれば失敗
   */
  ask?: (req: { key: string; place: AskPlace; question: string }, signal: AbortSignal) => Promise<AskEntry> | AskEntry;
  /** GET /api/ask の記録 */
  askLog?: AskEntry[];
  /** 解析が一つも無い（一度も analyze していない）リポジトリ。addVersion で足したものだけが一覧に出る */
  noAnalyses?: boolean;
  /** GET /api/prs（PR 一覧。3.11）の答え。既定は開いている PR が無い。throw / reject すれば取れない（理由はその message） */
  prs?: () => PrList | Promise<PrList>;
  /** GET /api/prs/:n（PR の詳細）の答え。既定は本文だけ。throw / reject すれば取れない */
  prDetail?: (n: number) => PrDetail | Promise<PrDetail>;
  /** .ondina/ui.json の最初の中身。既定は {} */
  ui?: UiSettings;
  /** GET /api/latest の答え（3.0）。既定は今のバージョンが最新。throw / reject すれば聞けない */
  latest?: (key: string, headSha: string) => LatestHead | Promise<LatestHead>;
  /**
   * GitHub の Viewed（12.1）。viewed は最初から Viewed のファイル。read / set が throw すれば失敗（ConflictError なら PR の head 違い）。
   * set は既定で viewed を書き換える
   */
  github?: { viewed?: string[]; read?: () => void; set?: (change: { mark: string[]; unmark: string[] }) => void };
}

export const ORDER_KT = 'src/main/kotlin/com/example/order/domain/Order.kt';

export function askAnswer(req: { key: string; place: AskPlace; question: string }): AskEntry {
  return {
    id: `a-${req.question}`,
    key: req.key,
    place: req.place,
    question: req.question,
    answer: { lead: `答え: ${req.question}。2 文目。`, items: [{ text: '合計は小計から割引を引く', cite: { path: ORDER_KT, side: 'head', line: 13 } }, { text: '場所の外れた事実', unverified: true }], tail: '補足。' },
    command: 'fake',
    ms: 1,
    at: '2026-10-08T00:00:00.000Z',
  };
}

export const defaultDisplayConfig = (): DisplayConfig => ({ theme: { mode: 'system', light: 'latte', dark: 'mocha', accent: 'mauve' }, ide: { scheme: 'jetbrains', product: 'idea' } });

export function fakeApi(analysis: Analysis = fixtureAnalysis(), opts: FakeApiOptions = {}) {
  const key = opts.key ?? 'local';
  const summary: AnalysisSummary = { key, headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service', ...(opts.prUrl ? { prUrl: opts.prUrl } : {}) };
  const states = new Map<string, ReviewState>();
  let ui: UiSettings = opts.ui ?? {};
  /** 送られた問いと、止められたか */
  const asked: Array<{ key: string; place: AskPlace; question: string; signal: AbortSignal }> = [];
  const askLog: AskEntry[] = [...(opts.askLog ?? [])];
  /** PR 一覧を取りに来た回数 */
  let prsCalls = 0;
  /** 解析し直して足したバージョン（新しい順に一覧の先頭へ） */
  const versions: Array<{ summary: AnalysisSummary; analysis: Analysis }> = [];
  /** serve の解析の列。テストが setJobs で進める */
  let jobs: AnalyzeJob[] = [];
  /** 頼まれた解析（from は解析し直す元の版。PR 一覧からは無い） */
  const started: Array<{ key: string; from?: string }> = [];
  /** serve の AI レビュー。頼むと running、止めると stopped。テストが setReviews で進める */
  let reviews: ReviewJob[] = [];
  /** 頼まれた AI レビューと、止めた PR */
  const reviewsStarted: Array<{ key: string; headSha: string }> = [];
  const reviewsStopped: string[] = [];
  /** GitHub で Viewed のファイルと、GitHub への読み書きの記録 */
  const github = { viewed: new Set(opts.github?.viewed ?? []), reads: 0, sets: [] as Array<{ mark: string[]; unmark: string[] }> };
  const api: Api = {
    getGithubViewed: async () => {
      github.reads++;
      opts.github?.read?.();
      return { viewed: [...github.viewed] };
    },
    setGithubViewed: async (_k, _sha, change) => {
      github.sets.push(change);
      opts.github?.set?.(change);
      for (const p of change.unmark) github.viewed.delete(p);
      for (const p of change.mark) github.viewed.add(p);
    },
    listAnalyses: async () => [...versions.map((v) => v.summary), ...(opts.noAnalyses ? [] : [summary])],
    getAnalysis: async (k, sha) => versions.find((v) => v.summary.key === k && v.summary.headSha === sha)?.analysis ?? analysis,
    listPrs: async () => {
      prsCalls++;
      return opts.prs ? opts.prs() : { fetchedAt: 0, viewer: null, prs: [], truncated: false };
    },
    getPrDetail: async (n) => (opts.prDetail ? opts.prDetail(n) : { number: n, body: '', timeline: [], olderItems: 0, files: [], filesTotal: 0, checks: [], checksTotal: 0 }),
    getState: async (key, sha) => states.get(`${key}/${sha}`) ?? emptyReview(),
    putState: async (key, sha, state) => {
      states.set(`${key}/${sha}`, state);
    },
    getUi: async () => ui,
    getConfig: async () => opts.config ?? defaultDisplayConfig(),
    putUi: async (next) => {
      ui = next;
    },
    getAsk: async () => ({ entries: [...askLog] }),
    ask: async (_k, _sha, req, signal) => {
      asked.push({ ...req, signal });
      const entry = await (opts.ask ?? askAnswer)(req, signal);
      askLog.push(entry);
      return entry;
    },
    sendComments: async (k, sha) => {
      const state = states.get(`${k}/${sha}`) ?? emptyReview();
      const adopted = (st: ReviewState) => st.comments.filter((c) => c.state === 'adopted').map((c) => c.id);
      const onDiff = (st: ReviewState) => st.comments.filter((c) => c.state === 'adopted' && onGithubDiff(analysis.githubDiff, c) !== false).map((c) => c.id);
      const send = opts.send ?? ((st: ReviewState): SendResult => (k === 'local' ? { sent: adopted(st), waiting: false } : { sent: onDiff(st), url: 'https://github.com/o/r/pull/42#pullrequestreview-9' }));
      const r = send(state);
      // serve と同じく、送った分はサーバ側でも sent にする
      states.set(`${k}/${sha}`, { ...state, comments: state.comments.map((c) => (r.sent.includes(c.id) ? { ...c, state: 'sent' } : c)) });
      return r;
    },
    latest: async (k, sha) => (opts.latest ? opts.latest(k, sha) : { headSha: sha, newCommits: 0, analyzed: true, changed: 0 }),
    startAnalyze: async (k, from) => {
      const who = from === undefined ? { key: k } : { key: k, from };
      started.push(who);
      const busy = jobs.some((j) => j.status === 'queued' || j.status === 'running');
      const job: AnalyzeJob = busy ? { status: 'queued', ...who, queuedAt: 1 } : { status: 'running', ...who, startedAt: 1 };
      jobs = [...jobs.filter((j) => j.key !== k), job];
      return job;
    },
    analyzeStatus: async () => jobs,
    startReview: async (k, headSha) => {
      reviewsStarted.push({ key: k, headSha });
      if (!ui.reviewCommand) throw new Error('AI レビューのコマンドが設定されていません');
      const job: ReviewJob = { status: 'running', key: k, headSha, startedAt: Date.now() };
      reviews = [...reviews.filter((j) => j.key !== k), job];
      return job;
    },
    reviewStatus: async () => reviews,
    workspaceStatus: async () => [], workspaceTools: async () => ({ gct: false, herdrApp: false, herdr: false, orca: false, defaultPrompt: '' }), startWorkspace: async (key) => ({ key, app: ui.workspace?.app ?? 'orca', status: 'done', steps: [], done: 0, startedAt: new Date().toISOString() }),
    stopReview: async (k) => {
      reviewsStopped.push(k);
      reviews = reviews.map((j) => (j.key === k && (j.status === 'waiting' || j.status === 'running') ? { status: 'stopped', key: k, headSha: j.headSha } : j));
    },
  };
  return {
    api,
    summary,
    states,
    asked,
    started,
    github,
    get ui() {
      return ui;
    },
    get prsCalls() {
      return prsCalls;
    },
    setJobs: (next: AnalyzeJob[]) => {
      jobs = next;
    },
    reviewsStarted,
    reviewsStopped,
    setReviews: (next: ReviewJob[]) => {
      reviews = next;
    },
    /** 解析し直してできたバージョンを足す（state があれば、serve が引き継いで書いたもの） */
    addVersion: (next: Analysis, state?: ReviewState, as = key) => {
      versions.unshift({ summary: { ...summary, key: as, headSha: next.pr.headSha, pr: next.pr, mtime: 2 }, analysis: next });
      if (state) states.set(`${as}/${next.pr.headSha}`, state);
    },
  };
}
