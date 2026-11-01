// 保存したプロジェクト構造（設計書 9.1）。kotlin-lsp の exportWorkspace が書く workspace.json を、ビルドの設定ファイルの中身ごとに残し、
// 次からは Gradle を走らせずに JSON で取り込ませる。ファイルとプロセスは cli（lsp-model.ts）。ここは中身の読み書きだけ。
//
// 2026-10-19 の実測（fixture と Spring Boot のリポジトリ、kotlin-lsp 263.6379.0 / 263.7084.0）:
// - workspace.json だけがあり Gradle のファイルが無いフォルダを workspaceFolder に渡すと「Importing with Json」になり、Gradle は走らない。
//   意味トークンも呼び出し関係も Gradle の形と完全に一致した
// - 中のパスは <WORKSPACE>/（書き出したディレクトリ）・<HOME>/・<MAVEN_REPO>/ に置き換わっている。<WORKSPACE> だけは ondina が解く
//   （JSON を置くフォルダと worktree が別なので）。ほかは kotlin-lsp が解く
// - 構造には、書き出した時点に在るソースのフォルダしか入らない（src/main/java が無ければ入らない）。後から増えたフォルダのファイルは色が欠ける
import { createHash } from 'node:crypto';

/** kotlin-lsp が読み書きするファイルの名前 */
export const PROJECT_MODEL_FILE = 'workspace.json';

/** プロジェクト構造を書き出す workspace/executeCommand の命令。initialize の executeCommandProvider.commands に出る */
export const EXPORT_PROJECT_MODEL_COMMAND = 'exportWorkspace';

const WORKSPACE = '<WORKSPACE>';
const HOME = '<HOME>';

export interface BuildConfigFile {
  /** リポジトリ相対 */
  path: string;
  /** git の blob。中身が同じなら同じ */
  blob: string;
}

/** 言語サーバーの実体（realpath）とビルドの設定ファイルの中身から決まる保存の名前。並びに依らない */
export function projectModelKey(server: string, files: readonly BuildConfigFile[]): string {
  const lines = files.map((f) => `${f.path}\0${f.blob}`).sort();
  return createHash('sha256').update([server, ...lines].join('\n')).digest('hex');
}

/** <WORKSPACE> を worktree の絶対パスにした JSON の文字列。パスに " や $ があっても壊れない */
export function placeProjectModel(model: unknown, workspace: string): string {
  const escaped = JSON.stringify(workspace).slice(1, -1);
  return JSON.stringify(model).replaceAll(WORKSPACE, () => escaped);
}

/** 文字列の値を、その鍵とともに全部たどる */
function walk(x: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(x)) {
    for (const v of x) walk(v, visit);
    return;
  }
  if (typeof x !== 'object' || x === null) return;
  for (const [k, v] of Object.entries(x)) {
    visit(k, v);
    walk(v, visit);
  }
}

/**
 * 在るはずのファイル（ライブラリの jar・JDK）の絶対パス。<HOME> は home に解く。
 * worktree の中（<WORKSPACE>。ビルドの出力は無くてよい）と、ほかの置き換え（<MAVEN_REPO> など。場所を知らない）は見ない。
 * 1 つでも無ければ、その保存は使えない（Gradle のキャッシュを消した、kotlin-lsp のバージョンを入れ替えた）
 */
export function projectModelFiles(model: unknown, home: string): string[] {
  const out: string[] = [];
  walk(model, (key, value) => {
    if ((key !== 'path' && key !== 'homePath') || typeof value !== 'string') return;
    if (value.startsWith(`${HOME}/`)) out.push(home + value.slice(HOME.length));
    else if (value.startsWith('/')) out.push(value);
  });
  return out;
}

/** ソースのフォルダ（リポジトリ相対。最上位は ''）。モジュールの sourceRoots の path。kotlinSettings の重複は 1 つにする */
export function projectModelSourceDirs(model: unknown): string[] {
  const out: string[] = [];
  walk(model, (key, value) => {
    if (key !== 'sourceRoots' || !Array.isArray(value)) return;
    for (const r of value) {
      const p = typeof r === 'string' ? r : typeof r === 'object' && r !== null ? (r as Record<string, unknown>)['path'] : undefined;
      if (typeof p !== 'string' || !p.startsWith(WORKSPACE)) continue;
      const dir = p.slice(WORKSPACE.length).replace(/^\/+/, '').replace(/\/+$/, '');
      if (!out.includes(dir)) out.push(dir);
    }
  });
  return out;
}

/** 変更ファイル（リポジトリ相対）のうち、どのソースのフォルダの下にもないもの */
export function outsideSourceDirs(dirs: readonly string[], files: readonly string[]): string[] {
  return files.filter((f) => !dirs.some((d) => d === '' || f.startsWith(`${d}/`)));
}
