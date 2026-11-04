// 案内人に聞く（設計書 3.10 / 10.5）で、案内人が need で頼んだファイルと文字列を head から読む（2026-11-04）。
// - 読むのは解析した版（Analysis.pr.headSha）。作業ツリーの解析では tree の sha だが、git cat-file も git grep も tree で読める。
//   作業ツリーの今の中身は読まない（解析した後に書き換わっていても、材料の行番号と食い違わないように）
// - ファイルは先頭から MAX_FILE_LINES 行、文字列は 1 つにつき MAX_HITS か所まで。切った所は ⋯
// - 無いパス・当たらない文字列も lines が空の 1 件にする（案内人が「無かった」と分かるように）
import { execFile } from 'node:child_process';
import type { AskInputRead, AskNeed } from '@ondina/core';
import { readBlobs } from './git.js';

/** need で読んで聞き直す回数の上限（LLM を呼ぶのは 1 問で最大この数 + 1 回） */
export const ASK_READ_ROUNDS = 2;
export const MAX_FILE_LINES = 800;
export const MAX_HITS = 40;

/** files を頼んだ順に、続けて search を頼んだ順に。git が失敗した分は無かったものとして扱う */
export async function readForAsk(repo: string, sha: string, need: AskNeed, signal?: AbortSignal): Promise<AskInputRead[]> {
  const paths = need.files.map((p) => p.replace(/^\.?\/+/, ''));
  let blobs: (string | null)[];
  try {
    blobs = readBlobs(repo, sha, paths);
  } catch {
    blobs = paths.map(() => null);
  }
  const files = need.files.map((request, i): AskInputRead => {
    const text = blobs[i] ?? null;
    return { kind: 'file', request, path: paths[i]!, lines: text === null || text.includes('\0') ? [] : numbered(text) };
  });
  const searches: AskInputRead[] = [];
  for (const term of need.search) searches.push(...(await search(repo, sha, term, signal)));
  return [...files, ...searches];
}

function numbered(text: string): string[] {
  const all = text.replace(/\n$/, '').split('\n');
  const lines = all.slice(0, MAX_FILE_LINES).map((l, i) => `h${i + 1}   ${l}`);
  return all.length > MAX_FILE_LINES ? [...lines, '⋯'] : lines;
}

/** 当たった行をファイルごとに 1 件にする（git grep はパス順に出す）。-z の出力は「<sha>:<path>\0<行番号>\0<行>」 */
async function search(repo: string, sha: string, term: string, signal?: AbortSignal): Promise<AskInputRead[]> {
  const out = await gitGrep(repo, ['grep', '-n', '-z', '-I', '--no-color', '-F', '-e', term, sha], signal);
  const hits = out.split('\n').filter((l) => l !== '');
  const reads: AskInputRead[] = [];
  for (const hit of hits.slice(0, MAX_HITS)) {
    const [where = '', line = '', text = ''] = hit.split('\0');
    const path = where.slice(sha.length + 1);
    if (reads.at(-1)?.path !== path) reads.push({ kind: 'search', request: term, path, lines: [] });
    reads.at(-1)!.lines.push(`h${line}   ${text}`);
  }
  if (hits.length > MAX_HITS) reads.at(-1)!.lines.push('⋯');
  return reads.length > 0 ? reads : [{ kind: 'search', request: term, path: '', lines: [] }];
}

/** 当たらない（終了コード 1）と失敗は空。大きなリポジトリでよく出る語でも溢れないよう、出力の上限は大きく取る */
function gitGrep(repo: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...(signal ? { signal } : {}) }, (e, stdout) => resolve(e ? '' : stdout));
  });
}
