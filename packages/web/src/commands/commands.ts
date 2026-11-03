// すべての操作はコマンド ID 経由（設計書 18.2、原則 6）。マウスもキーボードも同じコマンドを dispatch する。
import type { Analysis, AnalysisSummary, AnalyzeJob, AskCite, AskEntry, CommentDraft, DisplayConfig, LatestHead, PaneId, PrDetail, PrList, ReviewJob, ReviewState, ThemeMode, TicketSettings, UiSettings } from '@ondina/model';
import type { TreeName } from '../fileTree.js';
import type { DetailTab } from '../prs.js';
import type { KeyChange } from './keymap.js';
import type { PaletteTarget } from '../palette.js';
import type { RelDir } from '../rel.js';

export type Command =
  /** PR 一覧（3.11）へ。開くたびに GitHub から取り直す。解析が無くても開ける */
  | { id: 'view.prs' }
  /** PR 一覧の「更新」「もう一度」と、PR 一覧を開いている間に窓へ戻ったとき */
  | { id: 'prs.refresh' }
  | { id: 'prs.loaded'; list: PrList }
  | { id: 'prs.failed'; reason: string }
  /** 「すべて / あなたに依頼」と「Draft も出す」。渡した方だけ変える */
  | { id: 'prs.filter'; mine?: boolean; drafts?: boolean }
  /** カードの「解析する」「解析し直す」「もう一度」。from は解析し直す元の版（無ければ PR 番号で解析する）。now は経過の起点（reducer は時計を読まない） */
  | { id: 'pr.analyze'; key: string; from?: string; now: number }
  /** カードの「開く」: その解析の全体図へ */
  | { id: 'pr.open'; key: string; headSha: string }
  /** カードを押す（クリック・Enter）: 右に PR の詳細を出す。開いているカードならもう一度で閉じる */
  | { id: 'pr.detail'; number: number }
  | { id: 'pr.detail.tab'; tab: DetailTab }
  /** 引き出しの「もう一度」 */
  | { id: 'pr.detail.refresh' }
  /** 引き出しの「GitHub で開く」: PR のページを新しいタブで */
  | { id: 'pr.github'; number: number }
  /** カードと引き出しの「AI にレビューを頼む」「頼み直す」「もう一度」。headSha は PR の今の head（3.11） */
  | { id: 'pr.review'; key: string; headSha: string }
  /** AI レビューの「止める」 */
  | { id: 'pr.review.stop'; key: string }
  /** AI レビューの「見る」: レビューした解析を開き、締めに着く */
  | { id: 'pr.drafts'; key: string; headSha: string }
  /** serve の AI レビュー（GET /api/review）が届いた（起動時・頼んだ後・PR 一覧を取るときと、解析か AI レビューが動いている間 1 秒おき） */
  | { id: 'review.jobs'; jobs: ReviewJob[] }
  /** serve に AI レビューを頼めなかった（POST /api/review の失敗）。その PR を失敗にする */
  | { id: 'review.startFailed'; key: string; headSha: string; reason: string }
  | { id: 'prDetail.loaded'; number: number; detail: PrDetail }
  | { id: 'prDetail.failed'; number: number; reason: string }
  /** 入口（全体図。3.1）へ。コースに入っていれば出る */
  | { id: 'view.home' }
  /** 目的ごとに分けた画面（How 分解。3.2）へ。いたコースの場所は残す */
  | { id: 'view.hows' }
  /** 差分一覧の画面（3.4）へ。いたコースの場所は残す */
  | { id: 'view.diff' }
  /** いたコースの場所へ戻る（コースに入っていなければ何もしない） */
  | { id: 'view.course' }
  /** 締め（3.9）へ。いたコースの場所は残す */
  | { id: 'view.closing' }
  /** 差分一覧の画面でその hunk を選ぶ（締めの「見ていない差分」の「開く」） */
  | { id: 'diff.open'; hunkId: string }
  /**
   * 差分一覧のスクロールの知らせ（DiffList が出す。キーには割り当てない。2026-10-20）。file = 一番上のファイル、hunks = 見えている差分（上から）、
   * n = 行き先を画面に出し終えた diffJump の番号（古ければ選びを動かさない）
   */
  | { id: 'diff.viewport'; file: string; hunks: readonly string[]; n: number }
  /** 下書きの行が見える所へ（締めの「開く」）: 差分一覧の hunk → その行が見えるコースの停留所 → 同じファイルの停留所をファイル全体で。courseId（総括の「このコースのメモ」）があればそのコースの停留所へ */
  | { id: 'comment.open'; commentId: string; courseId?: number }
  /** GitHub で承認: PR ページを新しいタブで開くだけ（12 章）。ゲートしない */
  | { id: 'closing.approve' }
  /** 入口のタブ（1 地図 / 2 説明）。入口でだけ効く */
  | { id: 'home.tab'; tab: 'map' | 'text' }
  /** 入口でコースを選ぶ（地図に道順を出す）。同じコースでもう一度押すと解除。コース外は 0 */
  | { id: 'home.select'; courseId: number }
  /** 入口の説明タブで、チケットの原文を開く / 畳む（要求を抜き出したときは畳んである。3.1） */
  | { id: 'home.ticket' }
  /** 説明タブの段（3.1。1 = 背景、2 = この PR）。stage が無ければもう一方の段へ。地図タブなら説明タブにする */
  | { id: 'home.stage'; stage?: 1 | 2 }
  | { id: 'hunk.next' }
  | { id: 'hunk.prev' }
  | { id: 'hunk.select'; hunkId: string }
  | { id: 'hunk.markViewed'; hunkId?: string }
  /** How 分解の画面（3.2）: How で絞り込む（同じ id をもう一度で解除）/ 解除 */
  | { id: 'how.select'; howId: number }
  | { id: 'how.clear' }
  /** 追従グループ（同じ書き換えの束）の展開を切り替える。hunkId は束の中のどの hunk でもよい。省略時は選択中の hunk */
  | { id: 'group.toggle'; hunkId?: string }
  /** How 分解の画面へ移り、束を開いてその hunk を選ぶ（地図の束の箱から。地図の中で開くのは後） */
  | { id: 'group.reveal'; hunkId: string }
  /** コース（3.3）: コースに入る。at を省くと読む前の案内（コース外は最初の未確認の停留所。2026-10-22）、at を渡すとその停留所 */
  | { id: 'course.enter'; courseId: number; at?: number }
  /** 問題なし · 次へ（今の停留所に問題なしを付けて次の停留所へ。最後なら総括へ）。トグルしない。読む前の案内では最初の未確認の停留所へ（付けない） */
  | { id: 'course.ok' }
  /** 進む（→ / Enter）: 停留所なら問題なし · 次へ、総括なら完了 */
  | { id: 'course.forward' }
  /** 戻る（←）: 前の停留所へ（先頭では読む前の案内へ）。総括なら最後の停留所へ */
  | { id: 'course.prev' }
  /** 停留所へ移る（行程表・上の丸・左をたたんだ帯の丸・地図の箱・総括の「戻る」） */
  | { id: 'course.jump'; i: number }
  /** 総括で完了にし、次の未完了のコースへ（無ければ締めへ）。コース外は完了の数に入れない */
  | { id: 'course.complete' }
  | { id: 'course.again' }
  /** 読む前の案内へ（上の帯の「読む前の案内」。2026-10-22）。いた停留所は i に残す */
  | { id: 'course.brief' }
  /** 確かめること n を選ぶ（その文の根拠の行だけ光らせる）。選んでいれば外す。停留所を移ると外れる */
  | { id: 'course.check'; n: number }
  /** コースを出て入口へ */
  | { id: 'course.leave' }
  /** 停留所の画面の地図の引き出し（M）。開いていれば（大きくても）閉じる */
  | { id: 'course.map' }
  /** 地図を大きく（Shift+M）。閉じていれば大きく開き、開いていれば引き出しと大きくを入れ替える（2026-10-11） */
  | { id: 'course.mapBig' }
  /** すべて表示 / 変更の近くだけ（F。2026-10-13）。停留所はファイル全体 / 前後だけ、差分一覧・目的ごとの画面は畳んだ帯を全部開く / 畳み直す */
  | { id: 'file.full' }
  /** 差分の列の中を検索する（⌘F。2026-10-27）。差分一覧と目的ごとの画面のプレビューでだけ効き、ほかの画面ではブラウザのページ内検索に任せる。開いていれば検索欄へ戻る */
  | { id: 'find.open' }
  /** 検索欄の文字。今の 1 件は先頭に戻る */
  | { id: 'find.query'; text: string }
  /** 次へ（Enter）/ 前へ（Shift+Enter）。最後の次は先頭へ回る */
  | { id: 'find.next' }
  | { id: 'find.prev' }
  /** 検索欄を閉じる（Esc・×）。入れた文字は残す */
  | { id: 'find.close' }
  /** 変わった行から離れた行の帯の ↓ ↑ ↕ で開いた行（2026-10-13）。keys は開く行の key（diff/fold.ts） */
  | { id: 'fold.open'; path: string; keys: string[] }
  /** 停留所の画面の案内の列をたたむ / 出す（B。2026-10-12。2026-10-20 から右の列）。たたむと案内の文はコードの上、ボタンはコードの下に移る */
  | { id: 'course.fold' }
  /** Enter。画面ごとに意味が違う（How 分解では束の開閉、コースでは進む、入口では選んだコース（無ければ次のコース、全部完了なら締め）に入る、締めでは承認） */
  | { id: 'enter' }
  /** 地図の倍率（0.5 / 0.7 / 1）。倍率は動きの途中で変えない（2026-09-24: 倍率が動くと相対運動が読めない） */
  | { id: 'map.zoom'; zoom: number }
  /** 入口の地図で、そのまとまり（MapGroup.id）の中を見る。'root' は全景。札から押すと、そのまとまりへ移る（2026-11-04） */
  | { id: 'map.enter'; group: string }
  /**
   * 地図の関連の箱（停留所に無い箱）を停留所の画面で覗く。今の停留所はそのまま。map.unpeek（戻る）で読んでいた停留所に戻る（2026-09-26）。
   * 読む前の案内の知っておくことからも覗く（2026-10-22。読む前の案内のまま）。line（から endLine まで）を光らせる（head の行番号）
   */
  | { id: 'map.peek'; symbolId: string; line?: number; endLine?: number }
  /** 停留所の画面の左のツリーで、ほかのコースのファイルを覗く（2026-10-20）。戻り方は map.peek と同じ */
  | { id: 'course.peekFile'; path: string }
  | { id: 'map.unpeek' }
  /**
   * 差分の無い相手の引き出しを開く（2026-10-11）。host = 地図の箱の id。地図の「差分なし n か所」の箱から開く。
   * 向き・層・相手を省けば、層は全部、呼び出し元（いなければ呼び出し先）の最初の相手。開いていれば大きさは保つ
   */
  | { id: 'rel.open'; host: string; dir?: RelDir; layer?: string | null; sel?: string }
  /** R: コースの今の停留所の箱で引き出しを開く / 閉じる */
  | { id: 'rel.toggle' }
  /** Shift+R: 引き出しを大きく / 元の大きさ。閉じていれば今の停留所の箱でいきなり大きく開く */
  | { id: 'rel.big' }
  | { id: 'rel.close' }
  /** 引き出しの中で相手を選ぶ（↑↓・j / k は開いている間 次 / 前の相手） */
  | { id: 'rel.select'; symbolId: string }
  | { id: 'file.next' }
  | { id: 'file.prev' }
  | { id: 'file.select'; path: string }
  /** ファイルツリーのフォルダを開く / 閉じる（差分一覧 = diff、コースの左 = course。key はつなげた中で一番深いフォルダのパス） */
  | { id: 'tree.toggle'; tree: TreeName; key: string }
  /** ツリーのフォルダを全部開く / 全部閉じる（差分一覧 = diff、コースの左 = course） */
  | { id: 'tree.openAll'; tree: TreeName }
  | { id: 'tree.closeAll'; tree: TreeName }
  | { id: 'diff.mode.sbs' }
  | { id: 'diff.mode.unified' }
  | { id: 'jump.ide' }
  /** コース（3.6）: 今の停留所のシンボルが呼んでいる相手をパレットに並べる。選ぶと palette.pick で飛ぶ */
  | { id: 'jump.callee' }
  /**
   * 名前から定義へ（3.6。差分一覧・目的ごと・コースのコード欄の ⌘+クリック）。side・path・line（1 始まり）・col（0 始まり）は押した名前の場所で、行き先は Analysis.defs から引く。
   * name はその文字（引き出しの見出しと知らせ）。back はコード欄で押したときのその行（戻り先）。引き出しの中で押したときは無い
   */
  | { id: 'def.go'; side: 'head' | 'base'; path: string; line: number; col: number; name: string; back?: { path: string; side: 'LEFT' | 'RIGHT'; line: number } }
  /** ⌘[: 定義の引き出しでは前の定義（無ければ閉じる）、コード欄では定義へ移る前の場所へ */
  | { id: 'def.back' }
  /** 定義の引き出しを閉じる（読んでいた差分に戻る） */
  | { id: 'def.close' }
  /**
   * メモ（3.3）: 行を選ぶ（行番号の「+」を押す）。その 1 行から、押したままなぞって範囲にできる（離すまで書く枠を出さない）。
   * order は画面の上からの並び（LEFT と RIGHT の行番号は比べられないので、範囲の始まりと終わりをこれで決める）
   */
  | {
      id: 'memo.pick';
      path: string;
      side: 'LEFT' | 'RIGHT';
      line: number;
      order: number;
      /** 押したとき開いていた書く枠・直す枠の高さ（px）。離すまでその場所に同じ高さの空きを残す（MemoUi.hold） */
      hold?: number;
    }
  /** 「+」を押したままなぞって入った行まで範囲を伸ばす（2026-10-15。GitHub と同じ）。なぞっていない・別のファイルなら何もしない */
  | { id: 'memo.drag'; path: string; side: 'LEFT' | 'RIGHT'; line: number; order: number }
  /** なぞるのを終える（マウスを離した）。選んだ範囲の最後の行の下に書く枠を出す */
  | { id: 'memo.drop' }
  /** 新しく書いている途中の文。範囲を伸ばしても・選び直しても残す（書く枠が別の行の下に移っても消さない） */
  | { id: 'memo.draft'; body: string }
  /** 選んでいる行を外す・直す枠を閉じる（書く枠の「やめる」と Esc）。書いている途中の文も捨てる */
  | { id: 'memo.cancel' }
  /** 選んでいる行にメモを足す。保存した時点で採用済み。GitHub の差分に出ない行には足さない（12 章） */
  | { id: 'memo.save'; body: string }
  | { id: 'memo.edit'; commentId: string }
  | { id: 'memo.update'; commentId: string; body: string }
  | { id: 'memo.delete'; commentId: string }
  | { id: 'comment.adopt'; commentId: string }
  | { id: 'comment.edit'; commentId: string }
  | { id: 'comment.discard'; commentId: string }
  /** AI の下書きを直している途中の文（AppState.draftText。保存しない） */
  | { id: 'comment.text'; commentId: string; body: string }
  | { id: 'comment.save'; commentId: string; body: string }
  | { id: 'comment.reset'; commentId: string }
  /**
   * 採用済みを GitHub に送る（12 章）。local（PR が無い）は AI に返す。結果は comment.sent / comment.sendFailed で戻る。key / headSha は送った解析（違う解析が選ばれていたら無視する）。
   * url は GitHub のレビュー、waiting は AI に返したときに待っている AI がいたか
   */
  | { id: 'comment.send' }
  | ({ id: 'comment.sent'; key: string; headSha: string; ids: string[] } & ({ url: string } | { waiting: boolean }))
  | { id: 'comment.sendFailed'; key: string; headSha: string; message: string }
  /** 画面が読んだ後に外から（`ondina comments add`）足した AI の下書きが届いた。タブに戻ったときに読み直す（12 章） */
  | { id: 'comments.arrived'; key: string; headSha: string; comments: CommentDraft[] }
  /**
   * GitHub の Viewed（12.1）。読んだ結果は github.loaded / github.loadFailed（quiet はタブに戻ったときの読み直しで、失敗しても通知しない）、
   * 付ける・外すの結果は github.set / github.setFailed（conflict は PR の head が解析と違って送らなかった）で戻る。key / headSha は送った解析
   */
  | { id: 'github.loaded'; key: string; headSha: string; viewed: string[] }
  | { id: 'github.loadFailed'; key: string; headSha: string; reason: string; quiet: boolean }
  | { id: 'github.set'; key: string; headSha: string; mark: string[]; unmark: string[]; retried: boolean }
  | { id: 'github.setFailed'; key: string; headSha: string; mark: string[]; unmark: string[]; reason: string; conflict: boolean }
  /** 通知の「再試行」。同じ中身を送り直す（読み込みなら読み直す） */
  | { id: 'github.retry' }
  /** 通知を閉じる（6 秒のタイマー）。n は出した通知の番号で、後から出た通知は閉じない */
  | { id: 'github.toast.close'; n: number }
  /** テーマ（3.5）: 選び方（システムに合わせる / ライト / ダーク）と、ライト・ダークのときのフレーバー */
  | { id: 'theme.mode'; mode: ThemeMode }
  | { id: 'theme.light'; flavor: string }
  | { id: 'theme.dark'; flavor: string }
  | { id: 'theme.accent'; accent: string }
  | { id: 'analysis.select'; key: string; headSha: string }
  /** 解析し直す（3.0 の帯の下の 1 行。2026-10-13）。check = 今のバージョンより新しい head を聞く（読み込んだとき・画面に戻ったとき・2 分おき） */
  | { id: 'reanalyze.check' }
  /** 聞いた答え。key / headSha は聞いたバージョン（違うバージョンを開いていたら捨てる）。聞けなければ latest は null */
  | { id: 'reanalyze.checked'; key: string; headSha: string; latest: LatestHead | null }
  /** 「解析し直す」「もう一度」。now は経過の起点（reducer は時計を読まない） */
  | { id: 'reanalyze.start'; now: number }
  /** serve の解析の列（GET /api/analyze）が届いた（起動時・頼んだ後と、順番待ちか解析中がある間 1 秒おき） */
  | { id: 'reanalyze.job'; jobs: AnalyzeJob[] }
  /** serve に解析を頼めなかった（POST /api/analyze の失敗）。その key を失敗にする */
  | { id: 'reanalyze.startFailed'; key: string; from?: string; reason: string }
  /** 「切り替える」: 新しいバージョンを開く */
  | { id: 'reanalyze.switch' }
  /** 切り替えた知らせの × */
  | { id: 'reanalyze.dismiss' }
  | { id: 'analyses.loaded'; analyses: AnalysisSummary[] }
  /** view は着く画面（AI レビューの「見る」は締め）。無ければ全体図（同じ PR の別のバージョンなら今の画面） */
  | { id: 'data.loaded'; summary: AnalysisSummary; analysis: Analysis; review: ReviewState; view?: 'closing' }
  | { id: 'ui.loaded'; ui: UiSettings }
  /** ondina.config.yaml の表示だけの部分（11 章）が届いた */
  | { id: 'config.loaded'; config: DisplayConfig }
  | { id: 'ui.worktreeRoot'; value: string }
  /** LLM コマンド（設計書 5.3）。空なら消して yaml / 既定に戻る。次の analyze から効く */
  | { id: 'ui.llmCommand'; value: string }
  /** AI レビューのコマンド（3.11）。空なら消して、PR 一覧に「AI にレビューを頼む」を出さない。次に頼んだときから効く */
  | { id: 'ui.reviewCommand'; value: string }
  /** チケットの取り方の 1 項目（設計書 5.1）。空なら消す。次の analyze から効く */
  | { id: 'ui.ticket'; field: keyof TicketSettings; value: string }
  /** 設定のモーダル（上の帯の歯車）。tab なしは開閉（開くと全般）、tab ありはそのタブで開く（キーの一覧の「設定で変える」） */
  | { id: 'settings.open'; tab?: 'keys' }
  | { id: 'settings.tab'; tab: SettingsTab }
  | { id: 'settings.close' }
  /** ショートカットキーを変える（設定のタブ。2026-10-20）。入れ替える・移すは 2 つの操作を 1 回で変える */
  | { id: 'ui.keymap'; changes: KeyChange[] }
  /** ショートカットキーをすべて既定に戻す */
  | { id: 'ui.keymap.reset' }
  /** 列の幅（2026-10-20）。境目のドラッグを離したときの幅（px）。境目のダブルクリックは null で、既定の幅に戻す */
  | { id: 'ui.pane'; pane: PaneId; px: number | null }
  /** palette: open toggles, pick jumps (18.2) */
  | { id: 'palette.open' }
  | { id: 'palette.close' }
  | { id: 'palette.pick'; target: PaletteTarget }
  /**
   * 案内人に聞く（3.10）。toggle（q・各画面の「聞く」）は開くときに今の画面の場所を留める。閉じて開き直すと今の場所。
   * 停留所の画面では引き出しを開かず、右の列の入力欄へ（たたんでいれば開く。2026-10-20）
   */
  | { id: 'ask.toggle' }
  | { id: 'ask.close' }
  /** 入力欄の書きかけ（閉じても残す） */
  | { id: 'ask.draft'; text: string }
  /** 送る（⌘⏎・「送る」・候補）。now は経過秒の起点（reducer は時計を読まない） */
  | { id: 'ask.send'; question: string; now: number }
  /** 失敗した問いを送り直す */
  | { id: 'ask.retry'; now: number }
  /** 待っている問いを止める（serve が LLM をプロセスごと止める） */
  | { id: 'ask.stop' }
  | { id: 'ask.done'; entry: AskEntry }
  | { id: 'ask.failed'; key: string; question: string; reason: string }
  /** 会話の記録（GET /api/ask）が届いた */
  | { id: 'ask.loaded'; key: string; headSha: string; entries: AskEntry[] }
  /** 答えの行の場所を押す: その行が見える所へ移り、その行を光らせる */
  | { id: 'ask.cite'; cite: AskCite }
  /** 書く枠の「聞く」: 「+」で選んでいる行について開く（開いていれば何についてをその行に替える） */
  | { id: 'ask.lines' }
  /** 「× 場所全体にする」: 何についてから行を外す */
  | { id: 'ask.whole' }
  /** 答えの「メモにする」: 聞いた行の書く枠に質問の文を入れる。行の無い問いは行を選ぶ案内を出す */
  | { id: 'ask.memo'; entryId: string }
  /** 行を選ぶ案内の「やめる」 */
  | { id: 'ask.memoCancel' }
  /** 停留所の画面の右の列の会話を、一番上へ / 一番下へ（2026-10-20） */
  | { id: 'ask.top' }
  | { id: 'ask.bottom' }
  | { id: 'help.keymap' }
  | { id: 'escape' };

export type CommandId = Command['id'];

/** 設定のモーダルのタブ */
export type SettingsTab = 'general' | 'keys';
