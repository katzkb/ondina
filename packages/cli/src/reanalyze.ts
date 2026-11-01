// 画面から解析する（設計書 5.5 / 3.0。2026-10-13。PR 一覧から解析する 3.11 は 2026-10-22）。
//
// - 新しい head を聞く: PR は gh（非同期。2 分おきに聞くので、同期の runGh で serve を止めない）、local は head の ref を git で読む
//   （作業ツリーの解析は、今の作業ツリーを analyze と同じ除外で tree にする。同じ中身なら同じ sha）
// - 解析する: serve が `ondina analyze` を子プロセスで起こす。serve の中で呼ぶと、同期の git や tree-sitter の間 保存などの要求が止まるため。
//   走るのは同時に 1 本で、あとは順番待ちの列（言語サーバー用の worktree は全 PR で 1 組で、git fetch の FETCH_HEAD も取り合うため）。
//   進みは子の標準エラーの最後の 1 行（`ondina analyze: …`）、終わったら標準出力の最後の行（書いた Analysis.json）から headSha
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { changedHunks } from '@ondina/core';
import type { Analysis, AnalyzeJob, LatestHead } from '@ondina/model';
import { git, workingTreeHead } from './git.js';
import { runGhAsync } from './pr.js';
import { readAnalysis, readUi } from './store.js';

/** 起こした子プロセスのうち使う部分（テストで差し替える） */
export interface AnalyzeChild {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  once(event: 'close', listener: (code: number | null) => void): unknown;
  once(event: 'error', listener: (err: Error) => void): unknown;
}

export interface ReanalyzeDeps {
  /** `ondina <args>` を repo で起こす */
  spawn: (repo: string, args: string[]) => AnalyzeChild;
  /** PR の今の head と、PR のコミット（古い順） */
  prHead: (repo: string, number: number) => Promise<{ headSha: string; commits: string[] }>;
  now: () => number;
}

/** entry は ondina の入口（既定は今動いている自分。tsx で動かしているときはその読み込みの指定ごと。background.ts と同じ） */
export function spawnAnalyze(entry: string[] = [...process.execArgv, process.argv[1]!]): ReanalyzeDeps['spawn'] {
  return (repo, args) => spawn(process.execPath, [...entry, ...args], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** `gh pr view <n> --json headRefOid,commits`（非同期。pr.ts の runGhAsync） */
export const ghPrHead: ReanalyzeDeps['prHead'] = async (repo, number) => {
  const stdout = await runGhAsync(['pr', 'view', String(number), '--json', 'headRefOid,commits'], repo);
  try {
    const v = JSON.parse(stdout) as { headRefOid?: unknown; commits?: Array<{ oid?: unknown }> };
    if (typeof v.headRefOid !== 'string') throw new Error('headRefOid がありません');
    return { headSha: v.headRefOid, commits: (v.commits ?? []).map((c) => c.oid).filter((o): o is string => typeof o === 'string') };
  } catch (e) {
    throw new Error(`gh pr view ${number} の出力を読めません: ${e instanceof Error ? e.message : String(e)}`);
  }
};

export function defaultReanalyzeDeps(): ReanalyzeDeps {
  return { spawn: spawnAnalyze(), prHead: ghPrHead, now: () => Date.now() };
}

/** local の解析し直しに渡す作者の説明（保存した本文）の置き場 */
export function localBodyFile(repo: string): string {
  return path.join(repo, '.ondina', 'local', 'reanalyze-body.md');
}

/**
 * 解析し直す `ondina` の引数。PR は番号、local は同じ 2 つの ref と題と保存した本文（作業ツリーの解析は --head 無しで今の作業ツリー）。
 * `--ticket` で指定したチケット（題と本文から探したものでなく、ファイルでもないもの）は同じ値を渡す
 */
export function reanalyzeArgs(key: string, pr: Analysis['pr'], bodyFile: string): string[] {
  if (key === 'local') return ['analyze', '--base', pr.base, ...(pr.workingTree ? [] : ['--head', pr.head]), '--title', pr.title, '--body', bodyFile];
  const ticket = pr.ticket !== undefined && pr.ticketSearch === undefined && pr.ticket.source !== 'file' ? ['--ticket', pr.ticket.ref] : [];
  return ['analyze', key, ...ticket];
}

/** 新しい head があるか。PR は gh、local は git（作業ツリーの解析は今の作業ツリーの tree。コミットの数は数えない）。解析があれば、今の版から変わった差分の数も */
export async function latestHead(repo: string, key: string, current: Analysis, deps: Pick<ReanalyzeDeps, 'prHead'> = defaultReanalyzeDeps()): Promise<LatestHead> {
  const now = current.pr.headSha;
  let headSha: string;
  let newCommits: number | undefined;
  if (key === 'local' && current.pr.workingTree) {
    headSha = workingTreeHead(repo, readUi(repo).worktreeRoot);
  } else if (key === 'local') {
    headSha = git(repo, 'rev-parse', '--verify', `${current.pr.head}^{commit}`);
    newCommits = isAncestor(repo, now, headSha) ? Number(git(repo, 'rev-list', '--count', `${now}..${headSha}`)) : undefined;
  } else {
    const pr = await deps.prHead(repo, Number(key));
    headSha = pr.headSha;
    const at = pr.commits.indexOf(now);
    newCommits = at < 0 ? undefined : pr.commits.length - 1 - at;
  }
  const next = headSha === now ? current : readAnalysis(repo, key, headSha);
  return {
    headSha,
    ...(newCommits === undefined ? {} : { newCommits }),
    analyzed: next !== undefined,
    ...(next === undefined ? {} : { changed: changedHunks(current, next).length }),
  };
}

function isAncestor(repo: string, a: string, b: string): boolean {
  try {
    git(repo, 'merge-base', '--is-ancestor', a, b);
    return true;
  } catch {
    return false;
  }
}

const PREFIX = 'ondina analyze: ';

export interface AnalyzeRunner {
  /**
   * key の解析を列に入れる。from があればその版の引数で解析し直し（その版の解析が無ければ missing）、無ければ PR 番号で解析する（local は missing）。
   * 同じ key が順番待ちか解析中なら busy。何も走っていなければすぐ起動する
   */
  start(key: string, from?: string): AnalyzeJob | { error: 'busy' | 'missing' };
  /** key ごとの最新のジョブ。順番待ち（並んだ順）→ 解析中 → 終わったもの */
  jobs(): AnalyzeJob[];
  /** key の解析が順番待ちか解析中なら、終わったときのジョブ（done か failed）。動いていなければ今のジョブ（無ければ undefined） */
  finished(key: string): Promise<AnalyzeJob | undefined>;
}

interface Waiting {
  key: string;
  from?: string;
  args: string[];
}

const PR_KEY = /^[1-9][0-9]*$/;

export function createAnalyzeRunner(repo: string, deps: Partial<ReanalyzeDeps> = {}): AnalyzeRunner {
  const d = { ...defaultReanalyzeDeps(), ...deps };
  const latest = new Map<string, AnalyzeJob>();
  /** 順番待ちの列。先頭が次に走る。引数は列に入れたときに組む */
  const waiting: Waiting[] = [];
  let running: string | null = null;
  /** 解析が終わるのを待っている人（AI レビュー。review.ts） */
  const waiters = new Map<string, Array<(job: AnalyzeJob) => void>>();
  const who = (w: Waiting) => (w.from === undefined ? { key: w.key } : { key: w.key, from: w.from });

  const launch = (w: Waiting): void => {
    running = w.key;
    const job: AnalyzeJob = { status: 'running', ...who(w), startedAt: d.now() };
    latest.set(w.key, job);
    // error の後に close が来ることがある。終わりは 1 回だけ数え、終わった子の遅れた知らせで次の解析の状態を書き換えない
    let over = false;
    const finish = (next: AnalyzeJob): void => {
      if (over) return;
      over = true;
      latest.set(w.key, next);
      running = null;
      for (const resolve of waiters.get(w.key) ?? []) resolve(next);
      waiters.delete(w.key);
      const n = waiting.shift();
      if (n !== undefined) launch(n);
    };
    let child: AnalyzeChild;
    try {
      child = d.spawn(repo, w.args);
    } catch (e) {
      finish({ status: 'failed', ...who(w), reason: `解析を起動できませんでした: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    let lastErr: string | undefined;
    let out = '';
    let errBuf = '';
    child.stdout.on('data', (c: Buffer | string) => {
      out += c.toString();
    });
    child.stderr.on('data', (c: Buffer | string) => {
      errBuf += c.toString();
      const lines = errBuf.split('\n');
      errBuf = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw;
        if (line.trim() === '') continue;
        lastErr = line;
        if (!over) latest.set(w.key, { ...job, line });
      }
    });
    child.once('error', (e) => finish({ status: 'failed', ...who(w), reason: `解析を起動できませんでした: ${e.message}` }));
    child.once('close', (code) => {
      const tail = errBuf.trim();
      if (tail !== '') lastErr = tail.startsWith(PREFIX) ? tail.slice(PREFIX.length) : tail;
      const written = out.trim().split('\n').pop() ?? '';
      const headSha = path.basename(written, '.json');
      if (code === 0 && /^[0-9a-f]{40}$/.test(headSha)) finish({ status: 'done', ...who(w), headSha });
      else finish({ status: 'failed', ...who(w), reason: code === 0 ? `保存した解析ファイルを特定できませんでした（${written || '出力なし'}）` : (lastErr ?? `終了コード ${code ?? 'なし'} で終了しました`) });
    });
  };

  return {
    jobs: () => {
      const all = [...latest.values()];
      return [...waiting.map((w) => latest.get(w.key)!), ...all.filter((j) => j.status === 'running'), ...all.filter((j) => j.status === 'done' || j.status === 'failed')];
    },
    finished(key) {
      const cur = latest.get(key);
      if (cur?.status !== 'queued' && cur?.status !== 'running') return Promise.resolve(cur);
      return new Promise((resolve) => waiters.set(key, [...(waiters.get(key) ?? []), resolve]));
    },
    start(key, from) {
      const cur = latest.get(key);
      if (cur?.status === 'queued' || cur?.status === 'running') return { error: 'busy' };
      let args: string[];
      if (from === undefined) {
        if (!PR_KEY.test(key)) return { error: 'missing' };
        args = ['analyze', key];
      } else {
        const analysis = readAnalysis(repo, key, from);
        if (analysis === undefined) return { error: 'missing' };
        const bodyFile = localBodyFile(repo);
        if (key === 'local') {
          mkdirSync(path.dirname(bodyFile), { recursive: true });
          writeFileSync(bodyFile, analysis.pr.body ?? '');
        }
        args = reanalyzeArgs(key, analysis.pr, bodyFile);
      }
      const w: Waiting = { ...(from === undefined ? { key } : { key, from }), args };
      if (running === null) launch(w);
      else {
        waiting.push(w);
        latest.set(key, { status: 'queued', ...who(w), queuedAt: d.now() });
      }
      return latest.get(key)!;
    },
  };
}
