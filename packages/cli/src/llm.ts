// LLM コマンドの起動と、出力の保存・再利用、前回結果の検索（設計書 5.3 / 5.5）。
// 呼び出しは label = 目的ごとに分ける（<headSha>.json）、text = 文を書く（<headSha>.text.json）、
// ticket = チケット選び（<プロンプトの sha1>.ticket.json）、spec = 要求の抜き出し（<previous を除いたプロンプトの sha1>.spec.json）、intent = 差分ごとの意図（同じ鍵の .intent.json）。
// LLM は Claude とは限らない。約束は「sh -c で起動し、stdin にプロンプト全文、stdout に JSON 1 個」だけで、CLI 固有のフラグは足さない
// （既定コマンドの文字列の中にあるだけ）。生の stdout は .ondina/<key>/llm/<headSha>.json に残し、同じ headSha では起動しない（原則 7）。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Analysis } from '@ondina/model';
import { isKey, isSha, keyDir, listAnalyses, readAnalysis } from './store.js';

/** 既定。Claude Code の一発実行（サブスクのログインで動く。ANTHROPIC_API_KEY があれば API 課金）。確認した版は 2.1.274 */
export const DEFAULT_LLM_COMMAND = 'claude -p --tools "" --max-turns 1 --model opus';

/** 10 分。大きな PR でも打ち切られない程度 */
export const LLM_TIMEOUT_MS = 10 * 60 * 1000;

/** 案内人に聞く（3.10）の打ち切り。5 分（2026-10-08 に既定のコマンドで測った最長 56 秒の 5 倍強。人が待つので解析より短く）。need で読んで聞き直す回も合わせた 1 問の時間（2026-11-04） */
export const ASK_TIMEOUT_MS = 5 * 60 * 1000;

/** 解決順: 引数（UI の .ondina/ui.json）> 環境変数 ONDINA_LLM_COMMAND > yaml の llm.command > 既定。空文字は無いものとして扱う */
export function resolveLlmCommand(src: { override?: string | undefined; env?: string | undefined; yaml?: string | undefined }): string {
  return [src.override, src.env, src.yaml].find((s) => s !== undefined && s !== '') ?? DEFAULT_LLM_COMMAND;
}

export interface LlmRunResult {
  stdout: string;
  stderr: string;
  /** シグナルで終わったときは null */
  exitCode: number | null;
  timedOut: boolean;
  /** signal で止めたとき（案内人に聞くの「止める」）だけ true */
  aborted?: true;
}

/**
 * sh -c <command> を cwd で起動し、stdin にプロンプトを書いて閉じる。例外にせず結果で返す。
 * 子は自分のプロセスグループ（detached）にして、打ち切りと Ctrl-C ではグループごと殺す。
 * sh が exec せずに子を fork する環境（Linux の dash）では sh だけ殺しても孫がパイプを握って close が来ないため。
 * signal で止めたときも同じくグループごと殺し、aborted を付けて返す（始める前に止めてあれば起動しない）。
 * env は子の環境変数（無ければ自分のものをそのまま。チケットを取るコマンドが ONDINA_TICKET を渡すのに使う）。
 */
export function runLlmCommand(command: string, prompt: string, cwd: string, timeoutMs = LLM_TIMEOUT_MS, signal?: AbortSignal, env?: NodeJS.ProcessEnv): Promise<LlmRunResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ stdout: '', stderr: '', exitCode: null, timedOut: false, aborted: true });
    const child = spawn('sh', ['-c', command], { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: true, ...(env === undefined ? {} : { env }) });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    // Ctrl-C / kill: LLM をグループごと殺したうえで、同じシグナルを自分に送り直して Node の既定どおり終わる
    // （リスナーを付けたままだと既定の終了が抑止され、解析が最後まで走ってしまう）
    const onSignal = (sig: NodeJS.Signals) => {
      killGroup();
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      process.kill(process.pid, sig);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    child.stdout.setEncoding('utf8').on('data', (s: string) => (stdout += s));
    child.stderr.setEncoding('utf8').on('data', (s: string) => (stderr += s));
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      killGroup();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const done = (exitCode: number | null, extraErr = '') => {
      clearTimeout(timer);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      signal?.removeEventListener('abort', onAbort);
      resolve({ stdout, stderr: stderr + extraErr, exitCode, timedOut, ...(aborted ? { aborted: true as const } : {}) });
    };
    child.on('error', (e) => done(null, e.message));
    child.on('close', (code) => done(code));
    child.stdin.on('error', () => undefined); // 読まずに終わるコマンド（EPIPE）でも落とさない
    child.stdin.end(prompt);
  });
}

/**
 * どの呼び出しか。label = 1 回目（目的ごとに分ける）、text = 2 回目（文を書く）、ticket = チケット選び（10.7。headSha の代わりにプロンプトの sha1 で保存する）、
 * spec = 要求の抜き出し（10.8）、intent = 差分ごとの意図（10.9。どちらも previous を除いたプロンプトの sha1 で保存する）
 */
export type LlmCall = 'label' | 'text' | 'ticket' | 'spec' | 'intent';

/** .ondina/<key>/llm/<headSha>.json（text は <headSha>.text.json、ticket は <プロンプトの sha1>.ticket.json、spec / intent は <鍵>.spec.json / <鍵>.intent.json）の中身。stdout は生のまま（検証は core が毎回やり直す） */
export interface LlmRecord {
  command: string;
  stdout: string;
  stderr: string;
  recordedAt: string;
  /** text / ticket / spec / intent: プロンプトの sha1（spec / intent は previous を除いたもの）。今のプロンプトと違えば保存を使わない（1 回目の結果が変わると 2 回目の入力も変わる） */
  promptSha1?: string;
}

export function llmCachePath(repo: string, key: string, headSha: string, call: LlmCall = 'label'): string {
  return path.join(keyDir(repo, key), 'llm', `${headSha}${call === 'label' ? '' : `.${call}`}.json`);
}

export function readLlmCache(repo: string, key: string, headSha: string, call: LlmCall = 'label'): LlmRecord | undefined {
  const file = llmCachePath(repo, key, headSha, call);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as LlmRecord) : undefined;
}

export function writeLlmCache(repo: string, key: string, headSha: string, rec: LlmRecord, call: LlmCall = 'label'): void {
  if (!isKey(key) || !isSha(headSha)) throw new Error(`不正な key / sha: ${key} / ${headSha}`);
  const file = llmCachePath(repo, key, headSha, call);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2) + '\n');
  renameSync(tmp, file);
}

/**
 * 同じ key・同じブランチ（pr.head）の直近の解析（headSha が違うもの。更新時刻が最新）。previous（5.3）の元。
 * ローカル解析は key がどれも local なので、ブランチで同じ変更かを見分ける（別の変更の How の番号を引き継ぐと、コースが 50 などから始まる）
 */
export function findPrevious(repo: string, key: string, headSha: string, head: string): Analysis | undefined {
  const hit = listAnalyses(repo).find((a) => a.key === key && a.pr.head === head && a.headSha !== headSha);
  return hit === undefined ? undefined : readAnalysis(repo, hit.key, hit.headSha);
}
