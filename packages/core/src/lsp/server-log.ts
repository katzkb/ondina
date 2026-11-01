// kotlin-lsp（IntelliJ）が自分のログ（initialize の直後に window/logMessage の「Log file: …」で場所を言う）に書く行から、
// 待っている間と時間切れのときに出す 1 行を選ぶ（設計書 9.1）。
//
// 2026-10-10 の実測: Gradle の細かい進み（ビルドの開始・依存の解決・取得など）は `[IMPORT PROGRESS]: …` の行として
// このログにだけ書かれ、知らせ（$/progress・intellij/importLog）には来ない。Gradle の設定の段階はコンソールにも何も出さない。
// 実際のプロジェクトでは画面が「Importing（Gradle）」のまま 6 分以上動かず、進んでいるのか止まっているのか分からなかった。

/** 1 行の上限。長い URL で理由の文が埋まらないように（ready.ts の取り込みの記録と同じ） */
const LINE_MAX = 160;

const IMPORT_PROGRESS = /\[IMPORT PROGRESS\]: (.*)$/;
/** `2026-10-10 00:47:00,000 [  31000]   WARN - #o.g.Logger - 本文` */
const WARN_OR_ERROR = /^\S+ \S+ \[\s*\d+\]\s+(?:WARN|ERROR) - \S+ - (.*)$/;

/** ログの末尾の文字列から、最後の `[IMPORT PROGRESS]` か WARN / ERROR の行の本文。無ければ undefined */
export function lastServerLogLine(text: string): string | undefined {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trimEnd();
    const m = IMPORT_PROGRESS.exec(line) ?? WARN_OR_ERROR.exec(line);
    if (m === null) continue;
    const body = m[1]!.trim();
    if (body === '') continue;
    return body.length > LINE_MAX ? `${body.slice(0, LINE_MAX)}…` : body;
  }
  return undefined;
}
