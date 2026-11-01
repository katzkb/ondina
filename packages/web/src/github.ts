// GitHub の Viewed（設計書 12.1）の通知の文。文末は「です・ます」（docs/wording.md: お知らせ・エラーは です・ます）。
// 1 ファイルならファイル名、複数なら数で言う。

export interface GithubChange {
  mark: string[];
  unmark: string[];
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** 付ける・外すが通らなかったとき */
export function setFailedMessage(c: GithubChange): string {
  const n = c.mark.length + c.unmark.length;
  if (c.unmark.length === 0) return c.mark.length === 1 ? `${base(c.mark[0]!)} を GitHub で Viewed にできませんでした` : `${n} ファイルを GitHub で Viewed にできませんでした`;
  if (c.mark.length === 0) return c.unmark.length === 1 ? `${base(c.unmark[0]!)} の GitHub の Viewed を外せませんでした` : `${n} ファイルの GitHub の Viewed を外せませんでした`;
  return `GitHub の Viewed を変更できませんでした（${n} ファイル）`;
}

/** 再試行が通ったとき */
export function setDoneMessage(c: GithubChange): string {
  const n = c.mark.length + c.unmark.length;
  if (c.unmark.length === 0) return c.mark.length === 1 ? `${base(c.mark[0]!)} を GitHub で Viewed にしました` : `${n} ファイルを GitHub で Viewed にしました`;
  if (c.mark.length === 0) return c.unmark.length === 1 ? `${base(c.unmark[0]!)} の GitHub の Viewed を外しました` : `${n} ファイルの GitHub の Viewed を外しました`;
  return `GitHub の Viewed を変更しました（${n} ファイル）`;
}

export const READ_FAILED = 'GitHub の Viewed を読み込めませんでした';
