// IDEA で開く（設計書 3.6）。JetBrains Toolbox の URL スキーム。product は ondina.config.yaml の ide.product（既定 idea）。
// TODO(設計書 17 章): path を repo 相対で渡して IDEA が解決するかは未確認。

export function ideaUrl(product: string, project: string, path: string, line: number): string {
  return `jetbrains://${encodeURIComponent(product)}/navigate/reference?project=${encodeURIComponent(project)}&path=${encodeURIComponent(`${path}:${line}`)}`;
}
