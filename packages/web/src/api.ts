// serve の API（設計書 5.5）への薄い層。App には Api を注入するので、テストではメモリ上の実装に差し替える。
import type { Analysis, AnalysisSummary, AnalyzeJob, AskEntry, AskLog, AskPlace, DisplayConfig, LatestHead, PrDetail, PrList, ReviewJob, ReviewState, UiSettings } from '@ondina/model';

export interface Api {
  /** 開いている PR の一覧（3.11。serve が gh で GitHub に聞く）。失敗は Error（message は serve が返した理由） */
  listPrs(): Promise<PrList>;
  /** PR の詳細（3.11。一覧のカードを押すと出す引き出し）。失敗は Error（message は serve が返した理由） */
  getPrDetail(number: number): Promise<PrDetail>;
  listAnalyses(): Promise<AnalysisSummary[]>;
  getAnalysis(key: string, headSha: string): Promise<Analysis>;
  getState(key: string, headSha: string): Promise<ReviewState>;
  putState(key: string, headSha: string, state: ReviewState): Promise<void>;
  getUi(): Promise<UiSettings>;
  putUi(ui: UiSettings): Promise<void>;
  /** ondina.config.yaml の表示だけの部分（11 章）。serve が毎回読む */
  getConfig(): Promise<DisplayConfig>;
  /** 採用した下書きを GitHub に送る（12 章）。失敗は Error（message は serve が返した理由） */
  sendComments(key: string, headSha: string): Promise<SendResult>;
  /** 案内人に聞くの会話の記録（3.10） */
  getAsk(key: string, headSha: string): Promise<AskLog>;
  /** 案内人に聞く。signal で止める（serve が LLM をプロセスごと止める）。失敗は Error（message は serve が返した理由） */
  ask(key: string, headSha: string, req: { key: string; place: AskPlace; question: string }, signal: AbortSignal): Promise<AskEntry>;
  /** そのバージョンより新しい head があるか（3.0。PR は serve が gh で聞く）。聞けなければ Error */
  latest(key: string, headSha: string): Promise<LatestHead>;
  /** 解析を頼む。from があればそのバージョンの引数で解析し直し、無ければ PR 番号で解析する。その key が順番待ちか解析中なら今の状態（409）を返す。失敗は Error（message は serve が返した理由） */
  startAnalyze(key: string, from?: string): Promise<AnalyzeJob>;
  /** serve の解析の列（key ごとの最新） */
  analyzeStatus(): Promise<AnalyzeJob[]>;
  /** AI にレビューを頼む（3.11）。その PR が解析待ちかレビュー中なら今の状態（409）を返す。失敗は Error（message は serve が返した理由） */
  startReview(key: string, headSha: string): Promise<ReviewJob>;
  /** serve の AI レビュー（key ごとの最新） */
  reviewStatus(): Promise<ReviewJob[]>;
  /** 解析待ちかレビュー中の AI レビューを止める。動いていなければ何もしない */
  stopReview(key: string): Promise<void>;
  /** GitHub の PR で Viewed のファイル（12.1）。失敗は Error（message は serve が返した理由） */
  getGithubViewed(key: string, headSha: string): Promise<{ viewed: string[] }>;
  /** GitHub の Viewed を付ける・外す。PR の head が解析と違って送らなかったときは ConflictError、それ以外の失敗は Error */
  setGithubViewed(key: string, headSha: string, change: { mark: string[]; unmark: string[] }): Promise<void>;
}

/** serve が 409 を返した（GitHub の PR の head が解析と違うので、Viewed を変えなかった）。message は serve の理由 */
export class ConflictError extends Error {}

/** 送った結果。PR は GitHub のレビューの url、local（AI に返した）は待っている AI がいたか（12 章） */
export type SendResult = { sent: string[]; url: string } | { sent: string[]; waiting: boolean };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** getJson と同じだが、失敗は serve が返した理由の文で */
async function getJsonWithReason<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.text()) || `${url}: ${res.status}`);
  return (await res.json()) as T;
}

async function putJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
}

async function postJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error((await res.text()) || `${url}: ${res.status}`);
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const httpApi: Api = {
  listPrs: () => getJsonWithReason('/api/prs'),
  getPrDetail: (n) => getJsonWithReason(`/api/prs/${n}`),
  listAnalyses: () => getJson('/api/analyses'),
  getAnalysis: (key, sha) => getJson(`/api/analyses/${enc(key)}/${enc(sha)}`),
  getState: (key, sha) => getJson(`/api/state/${enc(key)}/${enc(sha)}`),
  putState: (key, sha, state) => putJson(`/api/state/${enc(key)}/${enc(sha)}`, state),
  getUi: () => getJson('/api/ui'),
  putUi: (ui) => putJson('/api/ui', ui),
  getConfig: () => getJson('/api/config'),
  sendComments: (key, sha) => postJson(`/api/comments/send/${enc(key)}/${enc(sha)}`),
  getAsk: (key, sha) => getJson(`/api/ask/${enc(key)}/${enc(sha)}`),
  ask: async (key, sha, req, signal) => {
    const url = `/api/ask/${enc(key)}/${enc(sha)}`;
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal });
    if (!res.ok) throw new Error((await res.text()) || `${url}: ${res.status}`);
    return (await res.json()) as AskEntry;
  },
  latest: (key, sha) => getJson(`/api/latest/${enc(key)}/${enc(sha)}`),
  startAnalyze: async (key, from) => {
    const url = from === undefined ? `/api/analyze/${enc(key)}` : `/api/analyze/${enc(key)}/${enc(from)}`;
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok && res.status !== 409) throw new Error((await res.text()) || `${url}: ${res.status}`);
    return (await res.json()) as AnalyzeJob;
  },
  analyzeStatus: () => getJson('/api/analyze'),
  startReview: async (key, headSha) => {
    const url = `/api/review/${enc(key)}`;
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ headSha }) });
    if (!res.ok && res.status !== 409) throw new Error((await res.text()) || `${url}: ${res.status}`);
    return (await res.json()) as ReviewJob;
  },
  reviewStatus: () => getJson('/api/review'),
  stopReview: async (key) => {
    const url = `/api/review/${enc(key)}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error((await res.text()) || `${url}: ${res.status}`);
  },
  getGithubViewed: (key, sha) => getJsonWithReason(`/api/github/viewed/${enc(key)}/${enc(sha)}`),
  setGithubViewed: async (key, sha, change) => {
    const url = `/api/github/viewed/${enc(key)}/${enc(sha)}`;
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
    if (res.status === 409) throw new ConflictError(await res.text());
    if (!res.ok) throw new Error((await res.text()) || `${url}: ${res.status}`);
  },
};
