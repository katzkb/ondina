// 起動したままの言語サーバーが読み直さないファイル（設計書 9.1）。差分にこれがあれば、言語サーバーを起動し直す。
//
// 2026-10-15 の実測（fixture、kotlin-lsp 263.6379.0）: 起動したまま base / head の中身を切り替えると、
// 次の PR の呼び出し関係は 0.2 秒で取れ、色も新しく起動した場合と完全に一致した。
// ただし Gradle の取り込みはやり直さない。依存を足した PR では、足した gson の 5 か所に色が付かなかった。
// 変わったことを知らせても（workspace/didChangeWatchedFiles）同じで、やり直させる命令も無い。起動し直すと正しくなる。
//
// 規則は Gradle そのものの決まり（設定ファイルの名前と buildSrc）だけ。リポジトリごとの置き方の決まりは持たない。

type Rule = (path: string) => boolean;

const GRADLE: Rule = (p) => {
  const name = p.slice(p.lastIndexOf('/') + 1);
  return (
    name.endsWith('.gradle') ||
    name.endsWith('.gradle.kts') ||
    name === 'gradle.properties' ||
    name.endsWith('.versions.toml') ||
    p.startsWith('gradle/') ||
    p.split('/').includes('buildSrc')
  );
};

const RULES: Readonly<Record<string, Rule>> = { kotlin: GRADLE };

/**
 * ビルドの設定ファイル（リポジトリ相対）だけを元の並びのまま返す。保存したプロジェクト構造の key に使う（project-model.ts）。
 * 規則の無い言語では undefined（Gradle の形かどうかを決められないので、構造を保存しない）
 */
export function buildConfigPaths(language: string, paths: readonly string[]): string[] | undefined {
  const rule = RULES[language];
  return rule === undefined ? undefined : paths.filter(rule);
}

/** 差分のパス（リポジトリ相対）のうち、言語サーバーを起動し直すべき最初の 1 つ。規則の無い言語では起動し直さない */
export function firstRestartPath(language: string, paths: readonly string[]): string | undefined {
  const rule = RULES[language];
  return rule === undefined ? undefined : paths.find(rule);
}
