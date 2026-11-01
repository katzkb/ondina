// 準備完了の判定（設計書 9.1）。3 段構えのうち 1（$/progress で待つ）と 2（独自通知で事実を取る）。
// 3（基準リクエストで確かめる）は実際に LSP を叩くので cli にある。
//
// 2026-09-21 の実機計測（fixtures/order-service。記録は fixtures/order-service/lsp/）:
// - intellij/importLog の succeeded: true は 3.2 秒に来るが、その 1.5 秒後の答えはまだ間違っている
//   （semanticTokens 18 個 / 正解 30 個、callHierarchy 0 件 / 正解 1 件）。独自通知だけでは早すぎる
// - $/progress が全部 end したのは 10.6 秒。そのあとの答えは正しい
// - Gradle のインポートが失敗した回も $/progress は 5.5 秒に正常終了する。failed: true だけが事実を言う
// だから両方を見る。片方だけでは、壊れた状態を「準備完了・辺 0 本」として書いてしまう（原則 1 / 2）。

/** 独自通知の読み方。言語ごとに差し替えられるよう設定から渡す（11 章 lsp.<lang>.importNotification） */
export interface ImportNotificationRule {
  /** 通知のメソッド名 */
  method: string;
  /** params のこのキーが true なら取り込み成功 */
  succeededField: string;
  /** params のこのキーが true なら取り込み失敗 */
  failedField: string;
}

/** kotlin（JetBrains の intellij-server）の既定。2026-09-21 に実測 */
export const KOTLIN_IMPORT_NOTIFICATION: ImportNotificationRule = {
  method: 'intellij/importLog',
  succeededField: 'succeeded',
  failedField: 'failed',
};

/**
 * initialize の応答から最初の $/progress begin を待つ猶予。
 * これが無いと、まだ何も始まっていない「開いている本数 0」を準備完了と読んでしまう。実測の最速は 1.7 秒。
 */
export const READY_GRACE_MS = 5000;

export type ReadyState =
  /** まだ待つ */
  | { phase: 'waiting'; openProgress: number }
  /** 進捗が止まった。基準リクエストに進んでよい。imported は独自通知が成功を言ったか */
  | { phase: 'settled'; imported: boolean }
  /** 取り込みが失敗した。これ以上待っても変わらない */
  | { phase: 'failed'; reason: string };

/** 終わっていない作業（待っている間と時間切れのときに出す事実） */
export interface Pending {
  /** 開いている $/progress。題と最後の知らせ（無ければ割合）。例: Importing（Gradle）、Indexing（42%） */
  tasks: string[];
  /** 取り込みの記録（importLog）の最後の 1 行。Gradle が何をしていたか */
  log?: string;
  /** サーバーが自分のログに書いた最後の進み（server-log.ts）。cli がログのファイルから読んで足す */
  serverLog?: string;
}

export interface ReadyWatcher {
  /** サーバからの通知を 1 件食わせる。待ちの判定に使う通知（$/progress と取り込みの記録）なら true */
  observe(method: string, params: unknown): boolean;
  /** elapsedMs は initialize の応答からの経過 */
  state(elapsedMs: number): ReadyState;
  /** 独自通知が取り込みの成功を言ったか（最後に言われた結末）。索引の $/progress が開いていても true になる */
  imported(): boolean;
  pending(): Pending;
}

/** 記録の 1 行の上限。長い URL やスタックトレースで理由の文が埋まらないように */
const LOG_LINE_MAX = 160;

/** 「終わっていない作業: …。最後のインポートのログ: …」。どちらも無ければ空 */
export function describePending(p: Pending): string {
  const parts: string[] = [];
  if (p.tasks.length > 0) parts.push(`終わっていない作業: ${p.tasks.join('、')}`);
  if (p.log !== undefined) parts.push(`最後のインポートのログ: ${p.log}`);
  if (p.serverLog !== undefined) parts.push(`サーバーのログの最後: ${p.serverLog}`);
  return parts.join('。');
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

/** 通知の message は複数行のことがあるので、中身のある 1 行目だけを使う（失敗の理由と、最後のインポートのログ） */
function firstLine(params: Record<string, unknown>): string | undefined {
  const m = params['message'];
  return typeof m === 'string' ? m.split('\n').find((l) => l.trim() !== '')?.trim() : undefined;
}

export function createReadyWatcher(rule: ImportNotificationRule, graceMs: number = READY_GRACE_MS): ReadyWatcher {
  /** 開いている作業。token → 題と最後の知らせ（begin の順に並ぶ） */
  const open = new Map<string, { title: string; detail?: string }>();
  let sawBegin = false;
  let outcome: 'none' | 'succeeded' | 'failed' = 'none';
  let reason = '';
  let log: string | undefined;

  return {
    observe(method: string, params: unknown): boolean {
      if (!isObj(params)) return false;
      if (method === '$/progress') {
        const value = params['value'];
        const token = params['token'];
        if (!isObj(value) || (typeof token !== 'string' && typeof token !== 'number')) return false;
        const key = String(token);
        if (value['kind'] === 'begin') {
          const title = value['title'];
          open.set(key, { title: typeof title === 'string' && title !== '' ? title : '（題なし）' });
          sawBegin = true;
        } else if (value['kind'] === 'report') {
          const task = open.get(key);
          const message = value['message'];
          const percentage = value['percentage'];
          if (task !== undefined) {
            if (typeof message === 'string' && message !== '') task.detail = message;
            else if (typeof percentage === 'number') task.detail = `${percentage}%`;
          }
        } else if (value['kind'] === 'end') {
          open.delete(key);
        }
        return true;
      }
      if (method !== rule.method) return false;
      const line = firstLine(params);
      if (line !== undefined) log = line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX)}…` : line;
      // 結末を言わない行（ビルドログの垂れ流し）は無視する。最後に言われた結末が効く
      if (params[rule.failedField] === true) {
        outcome = 'failed';
        reason = `インポートに失敗しました: ${firstLine(params) ?? '理由は受け取っていません'}`;
      } else if (params[rule.succeededField] === true) {
        outcome = 'succeeded';
        reason = '';
      }
      return true;
    },

    state(elapsedMs: number): ReadyState {
      if (outcome === 'failed') return { phase: 'failed', reason };
      if (!sawBegin && elapsedMs < graceMs) return { phase: 'waiting', openProgress: 0 };
      if (open.size > 0) return { phase: 'waiting', openProgress: open.size };
      return { phase: 'settled', imported: outcome === 'succeeded' };
    },

    imported(): boolean {
      return outcome === 'succeeded';
    },

    pending(): Pending {
      const tasks = [...open.values()].map((t) => (t.detail === undefined ? t.title : `${t.title}（${t.detail}）`));
      return log === undefined ? { tasks } : { tasks, log };
    },
  };
}
