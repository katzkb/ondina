// 設計書 4章「データモデル」を TypeScript の型として写したもの。
// 単一のモデルを A〜D の各ビューに投影する。UI（packages/web）はこの型の JSON を読んで描くだけ。
// このパッケージは型だけを持つ。実行時コードを置かない（web からも core からも import できるように）。

/** 設定ファイルで定義した層の名前。"API" | "Application" | "Domain" | "Infrastructure" | "Tests" など */
export type Layer = string;

/** 核 / 追従 / テスト / 未帰属 */
export type Kind = 'core' | 'ripple' | 'test' | 'none';

/** 事実か推測かを表示で分けるために必ず持つ（原則2） */
export type Provenance = 'ast' | 'config' | 'lsp' | 'llm';

/** 宣言の種別（5.2 の 1）。Hunk.symbolKind と Symbol.kind で同じものを使う */
export type SymbolKind = 'class' | 'object' | 'companion' | 'function' | 'property' | 'constructor' | 'init' | 'typealias' | 'enumEntry' | 'file';

/** ハイライト済みトークン1行分。role が null なら継承色（7.2） */
export type TokenLine = Array<[text: string, role: string | null, fontStyle: number]>;

/** 作者の説明（3.1）のコードブロック 1 つ。画面は「言語 + 中身」で描いたブロックと対応させる。tokens は中身の 1 行が 1 要素 */
export interface BodyCode {
  lang: string;
  /** フェンスの中身。末尾の改行は含まない */
  code: string;
  tokens: TokenLine[];
}

export interface Hunk {
  /** sha1(path + '#' + symbolFqName)。push 後も安定。閲覧状態のキー */
  id: string;
  /** repo 相対 */
  path: string;
  lang: 'kotlin' | 'sql' | string;
  /** 表示用。"applyDiscount()" / "OrderResponse" */
  symbol: string;
  /** com.example.order.domain.Order.applyDiscount。ファイル hunk なら path */
  symbolFqName: string;
  symbolKind: SymbolKind;
  kind: Kind;
  kindProvenance: Provenance;
  /** 所属 How。2つ以上なら絡み、0なら未帰属 */
  hows: number[];
  /** メーター上の重み。今は全 hunk で 1。追従グループの閲覧規則（3.7: 代表と全逸脱を見たらメンバー全部）はメーター側で扱う */
  n: number;
  lnOld: number;
  lnNew: number;
  /** 1文字目が ' ' | '+' | '-' の統合形式 */
  lines: string[];
  tokens?: TokenLine[];
  /** kind === 'ripple' のときのみ */
  group?: RippleGroup;
}

export interface RippleGroup {
  /** 核から導出。"getDiscount() → discount" */
  pattern: string;
  derivedFrom: { coreHunkId: string; removed: string[]; added: string[] };
  /** 表示: 一様（AST判定）/ たぶん一様（LLM判定） */
  uniform: 'ast' | 'llm';
  /** メンバー hunk id */
  representative: string;
  /** 同型と判定した hunk id */
  members: string[];
  /** パターン外の hunk id */
  deviations: string[];
  /** 逸脱ごとの、代表の形との距離（単語単位の編集距離。8 章） */
  distance: Record<string, number>;
  /** deviations のうち距離が閾値（2）以下のもの。単語列の比較では決めきれない場所 */
  near: string[];
}

export interface How {
  /** 依存順 = 表示順。再実行時は前回の id を維持 */
  id: number;
  /** 命令形・短く */
  title: string;
  /** A のどれに効くか1行 */
  why: string;
  /** この How が対応する要求（Spec.id）。specs から逆に引く（10.8）。要求が無ければ空 */
  specIds: string[];
}

export interface Symbol {
  /** sha1(path + '#' + fqName)。hunk を持つシンボルは Hunk.id と同じ式・同じ値 */
  id: string;
  fqName: string;
  path: string;
  /** 設定の layers の glob で決める（5.2 の 4）。どの glob にも当たらなければ欄ごと無い。当たらないファイルの推定は M2 */
  layer?: Layer;
  /** layer があるときだけ。glob 由来なので今は常に 'config' */
  layerProvenance?: Provenance;
  kind: SymbolKind;
  /** false なら経路上のベースライン */
  changed: boolean;
  hunkId?: string;
  /** そのシンボルを対象にするテストの数（5.2 の 7）。欄が無ければ未計測。テストファイルからの参照を、囲っているテスト関数に丸めて数える */
  testCount?: number;
  /**
   * 呼び出し関係を測れたか（9 章）。true = callHierarchy が答えた / false = 答えなかった / 欄なし = LSP を動かしていない。
   * kotlin-lsp は戻り型が value class の関数を呼び出し関係に出さないので、「呼ばれていない」と「測れていない」を分ける（原則 2）
   */
  edgesMeasured?: boolean;
  /**
   * 未変更シンボルだけ: 自身のファイル（head）から切り出した行（設計書 3.3）。中心 = 宣言の行 + その中で変更シンボルを呼んでいる行、その前後 2 行。
   * 欄が無い = 位置が取れなかった（LSP なし / 位置の無い記録 / 言語サーバーが返さなかった / ファイルが読めなかった）
   * 出どころは常に lsp（未変更シンボルは LSP の辺からしか生まれない）なので provenance の欄は持たない
   */
  excerpt?: ExcerptBlock[];
}

/** 連続した行のまとまり。まとまりの間は離れている（画面では ⋯ で区切る） */
export interface ExcerptBlock {
  /** lines[0] の行番号（1 始まり） */
  start: number;
  lines: string[];
  /** 中心の行の行番号（1 始まり。昇順） */
  centers: number[];
}

export interface Edge {
  /** Symbol.id */
  from: string;
  to: string;
  /** call = 呼び出し（callHierarchy）。test = テストからの呼び出し。reference = 名前を書いた・値を読んだ（references。両端が変更シンボルのものだけ）。schema は未実装 */
  kind: 'call' | 'schema' | 'test' | 'reference';
  /** reference だけ: 参照した箇所の数（地図の ×22） */
  n?: number;
  /**
   * call / test だけ: 呼んでいる行（呼ぶ側のファイルの head。1 始まり。昇順・重複なし）。読む順（呼ぶ行の順）と「16 行で呼ぶ」の材料（2026-10-22）。
   * 欄が無い = 位置の無い記録か言語サーバーが返さなかった、または古い解析
   */
  lines?: number[];
  /** 辺ラベル。取れた側だけ入る（引数なし・戻り型なしの側は欄ごと無い） */
  types?: { in?: string; out?: string };
  /** 設定の allowedDependencies に反する。事実として描くだけ */
  crossesLayers: boolean;
  provenance: 'lsp' | 'llm';
}

/**
 * How ごとの読む順番（3.3 のコース）。経路はプログラムが組む（10.3）。
 * change / checks / role は 2 回目の LLM（文を書く。5.3）の文（2026-10-22 から。読む前の案内と停留所の右の列）。出どころは常に llm なので provenance の欄は持たない。
 * 欄が無い = LLM の文が無い（2 回目が動かなかった・その場所を書き漏らした・古い解析）。画面は事実から組んだ「自動」の文を出す。
 * intro / guide / say は 2026-10-22 より前の解析だけにある（コースの紹介・なぜここか・何を変えたか）
 */
export interface Tour {
  howId: number;
  /** 古い解析だけ: コースの紹介 */
  intro?: string;
  /** 変わること（読む前の案内）。このコースの範囲のマージ前とマージ後。片方だけのこともある */
  change?: { before?: string; after?: string };
  /** 確かめること（読む前の案内と停留所の右の列）。番号は並びの順（1 始まり）。場所はプログラムが確かめた物だけ（5.4） */
  checks?: TourCheck[];
  /** role = この場所（停留所の右の列）の 1〜2 文。guide / say は古い解析だけ（なぜここかの 1 行と何を変えたかの 1 行） */
  steps: Array<{ symbolId: string; hunkId?: string; call: string; role?: string; guide?: string; say?: string }>;
}

/** 確かめることの 1 文と根拠の場所 */
export interface TourCheck {
  text: string;
  /** 根拠の場所。読む順（steps の順）。lines はその停留所の hunk の head 側の行番号（文脈か追加の行。1 始まり。昇順）。say はその場所で見るもの */
  at: Array<{ symbolId: string; lines: number[]; say?: string }>;
}

/** --ticket で指定したか、題・ブランチ名・本文から LLM が選んだチケット（3.1 / 5.1。2026-10-12）。中身は原文のまま。LLM を通さない */
export interface Ticket {
  /** --ticket に渡した値（番号・URL・ファイル） */
  ref: string;
  /** 取り方 */
  source: 'jira' | 'command' | 'file';
  /** 取った（取ろうとした）時刻。ISO 8601 */
  at: string;
  /** 番号（SHOP-421）。ファイルには無い */
  key?: string;
  /** チケットのページ。相対のリンクと画像の基準にもする */
  url?: string;
  title?: string;
  /** 種類（ストーリーなど） */
  kind?: string;
  /** 状態（進行中など） */
  status?: string;
  body?: string;
  /** html = Jira が直した HTML、markdown = コマンドとファイル、text = 改行を保った文字（Jira が HTML を返さなかったとき） */
  format?: 'html' | 'markdown' | 'text';
  /** 取れなかった理由。あれば ref / source / at / key / url 以外は無い */
  error?: string;
}

/**
 * --ticket が無いときに、PR の題・ブランチ名・本文からチケットを探した記録（3.1 / 5.1。2026-10-12）。
 * 候補はプログラムが拾い（番号の形と URL）、どれがこの PR のチケットかは LLM が選ぶ（原則 3）
 */
export interface TicketSearch {
  /** プログラムが拾った候補。出てきた順（題 → ブランチ名 → 本文） */
  candidates: TicketCandidate[];
  /** LLM が選んだ候補の ref（pr.ticket.ref と同じ）。出どころは常に llm（推定）なので provenance の欄は持たない。無い = 選んでいない */
  chosen?: string;
  /** 選ぶ LLM の記録。無い = 候補が無くて呼ばなかった。ok で chosen が無い = どれもこの PR のチケットではないと答えた */
  llm?: LlmRun;
}

export interface TicketCandidate {
  /** 取りに行く値。同じ番号の URL があれば URL（Jira の場所の設定が要らない）、無ければ番号 */
  ref: string;
  /** 画面の名前。番号（SHOP-421）。番号の無い URL は URL */
  label: string;
  /** 見つけた場所。出てきた順 */
  places: TicketPlace[];
}

export interface TicketPlace {
  in: 'title' | 'branch' | 'body';
  /** 本文の行番号（1 始まり）。題とブランチ名には無い */
  line?: number;
  /** その行（題とブランチ名はそのもの） */
  text: string;
  /** 拾った文字列の位置（text の中。UTF-16 の添字。end は含まない） */
  start: number;
  end: number;
}

/** チケットの取り方（.ondina/ui.json の ticket。5.1）。トークンは書かない（環境変数 ONDINA_TICKET_TOKEN、無ければ Mac のキーチェーンの ondina-jira） */
export interface TicketSettings {
  /** 無ければ jira */
  source?: 'jira' | 'command';
  /** Jira の場所（https://example.atlassian.net）。番号で指定したときに使う */
  jiraUrl?: string;
  /** Jira Cloud のメール。あれば Basic（メール + API トークン）、無ければ Bearer（Jira Server / Data Center の個人用アクセストークン） */
  email?: string;
  /** source が command のとき。sh -c で起動し、環境変数 ONDINA_TICKET に値を渡す */
  command?: string;
}

/**
 * チケットから抜き出した要求（3.1 / 10.8。2026-10-12）。文と対応は LLM が書いた推定（画面は点線の枠と「AI」）。
 * hows は LLM が今ある How から選び、プログラムが実在するものだけ残した番号。空 = 対応するコースなし。id は並び順の s1, s2 …
 */
export interface Spec {
  id: string;
  text: string;
  hows: number[];
}

/** 作者説明の各文 */
export interface Claim {
  text: string;
  backed: boolean;
  reason?: string;
}

/**
 * 入口の説明（3.1）。2 回目の LLM（5.3）が差分から書く。2026-10-29 から「何のための PR」の要点・使うと何が変わるかの例・流れの図。
 * problem / approach / untouched / beforeAfter はそれまでの形（古い Analysis.json が持つ。画面は解析し直しを案内する）
 */
export interface Summary {
  headline?: string;
  example?: SummaryExample;
  flows?: Flow[];
  problem?: string;
  approach?: string[] | string;
  untouched?: string[] | string;
  beforeAfter?: Array<{ target: string; before: string; after: string }>;
}

/** 使うと何が変わるか。値はテストから取る。at は値の根拠の場所（停留所と、その hunk の head 側の行。確かめることと同じ規則） */
export interface SummaryExample {
  text: string;
  at: Array<{ symbolId: string; lines: number[] }>;
}

/** 流れの図 1 本（目的ごとに 1 本）。箱は上から通る順 */
export interface Flow {
  nodes: FlowNode[];
}

/**
 * 図の箱 1 つ。どのコースの箱かを howIds に持つ（コースの丸。実在するコースだけ、1 つのコースは全部の図で 1 回だけ。コースの無い箱は無い）。
 * symbol は箱の下に出す名前で、その箱のコースの停留所の symbolId。untouched は箱の横の「変えていない」の札（領域の名前）。pass は次の箱へ渡る値（矢印の横）
 */
export interface FlowNode {
  title: string;
  howIds: number[];
  symbol?: string;
  before: string;
  after: string;
  untouched: string[];
  pass?: string;
}

/**
 * 説明タブの「背景」（3.1。2026-10-29）。why はチケットの原文から写した「なぜ」の文で、原文に含まれる物だけ（10.8）。
 * project は「どんな案件の一部？」（親チケットと同じ案件の PR）。
 * existing は「この PR の前からあるものは？」、terms は「出てくる言葉は？」。どちらも 2 回目の LLM（5.3）がプログラムの候補から選んで書く（5.4 の 9）
 */
export interface Background {
  why?: string[];
  project?: Project;
  existing?: ExistingItem[];
  terms?: Term[];
}

/**
 * どんな案件の一部か（3.1 / 5.1。2026-10-29）。チケットを Jira から取れたときだけ。親チケットは Jira の親の欄（parent）か、無ければエピックの欄（Epic Link）。
 * 同じ案件の PR は、親と同じ親の下のチケットの番号を、この PR の GitHub で題・本文から探した物。why だけが LLM（要求の抜き出しが親の本文から写した文で、本文にある物だけ）。
 * 親が無ければ project ごと無い。親を調べられなければ parent が無く errors に理由
 */
export interface Project {
  parent?: ParentTicket;
  /** 親チケットの本文から写した「この案件の目的」の文（10.8） */
  why?: string[];
  /** 同じ親の下のチケットの番号（このチケットを含む。番号順） */
  children?: string[];
  /** 探した番号（親・このチケット・残りの子の番号順。MAX 30） */
  searched?: string[];
  /** 子のチケットが多くて探さなかった番号の数 */
  skipped?: number;
  /** この PR のリポジトリ（owner/name。PR を探せたときだけ。画面はこれと違うリポジトリの PR に名前を付ける） */
  repo?: string;
  /** 同じ案件の PR。この PR のリポジトリが先、あとはリポジトリの名前順、その中は番号順。探せなければ無い */
  prs?: ProjectPr[];
  /** 途中で取れなかった物の理由（親の中身・子のチケット・PR の検索）。画面にそのまま出す */
  errors?: string[];
}

/** 親チケット。中身は Jira の原文のまま（LLM を通さない） */
export interface ParentTicket {
  key: string;
  url: string;
  /** どの欄から辿ったか */
  via: 'parent' | 'epic';
  title?: string;
  kind?: string;
  status?: string;
  body?: string;
  format?: 'html' | 'text';
}

/** 同じ案件の PR 1 つ（この PR の GitHub の検索の答え。題・本文・ブランチ名に探した番号があるとプログラムが確かめた物） */
export interface ProjectPr {
  /** owner/name */
  repo: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'draft' | 'merged' | 'closed';
  /** 含んでいた番号（searched の順） */
  keys: string[];
  /** この PR（同じリポジトリで、同じ番号か同じブランチ名） */
  self?: true;
}

/**
 * この PR の前からあるものの 1 行。names は LLM が候補（停留所が呼んでいる差分の無い相手と、この PR で消える宣言）から選んだ宣言で、全部同じ removed。
 * removed はプログラムが決めた事実（画面のチップ「この PR で消える」/「この PR で変えていない」）。text は LLM の 1 文
 */
export interface ExistingItem {
  names: Array<{ fqName: string; path: string; kind: SymbolKind }>;
  text: string;
  removed: boolean;
}

/** 出てくる言葉 1 つ。word（日本語の言葉）と meaning は LLM（意味は推定）。code は差分の行に出る識別子だけ（プログラムが確かめる） */
export interface Term {
  word: string;
  code: string;
  meaning?: string;
}

export interface CommentDraft {
  id: string;
  path: string;
  /** 範囲なら最後の行（GitHub の `line`） */
  line: number;
  side: 'LEFT' | 'RIGHT';
  /** 範囲の始まり（GitHub の `start_line` / `start_side`）。1 行なら無い */
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  body: string;
  /** "reviewer"（レビュアー自身のメモ。3.3）| "claude-code" | "coderabbit" | … */
  source: string;
  /** sent は GitHub に送った後（12 章）。再送しない */
  state: 'draft' | 'edit' | 'adopted' | 'discarded' | 'sent';
}

/**
 * レビュアーのローカル状態。PR 番号 + headSha をキーに永続化（serve が .ondina/<key>/state/<headSha>.json に書く）。
 * その PR のレビューの進み具合だけを持つ。画面の設定（テーマ・左右 / 統合）は PR をまたぐ UiSettings（2026-10-11）
 */
export interface ReviewState {
  /** Hunk.id。JSON に書くので配列 */
  viewed: string[];
  comments: CommentDraft[];
  /**
   * コースの進み具合（3.3）。古い state には無い（UI が空で補う）。
   * done は差分の無い停留所に付けた「問題なし」（`<コース id>:<Symbol.id>`）。差分のある停留所は viewed を使う。
   * completed は完了にしたコースの id（コース外は 0）
   */
  course?: { done: string[]; completed: number[] };
  /** 前の版から引き継いで作った state なら、その記録（3.0 の帯の下の 1 行。2026-10-13）。新しい版を初めて開いたときに serve が書く */
  carried?: CarriedFrom;
}

/** 前の版の state から引き継いだ記録。前の版の state は書き換えない */
export interface CarriedFrom {
  /** 前の版の headSha */
  from: string;
  /** 前の版で「問題なし」だったが、差分が変わったので未確認に戻した Hunk.id */
  reset: string[];
  /** 前の版で完了だったが、差分が変わったので未完了に戻したコースの id */
  coursesReset: number[];
  /** 行が変わったか全文が無いので移せず、前の版に残したメモ・下書きの id */
  left: string[];
  /** 帯の下の 1 行を閉じた（×） */
  dismissed?: true;
}

/** `GET /api/latest/:key/:sha` の答え。今の版より新しい head があるか（2026-10-13） */
export interface LatestHead {
  /** PR（local は head の ref）の今の head */
  headSha: string;
  /** 今の版より後に積まれたコミットの数。履歴が書き換えられて数えられなければ無い */
  newCommits?: number;
  /** その head の解析が .ondina にあるか */
  analyzed: boolean;
  /** 解析があれば、今の版から変わった差分の数（id か lines が違う hunk と、新しい hunk） */
  changed?: number;
}

/** PR 一覧のレビューした人（2026-10-22）。人ごとの最後の意見。コメントだけの人も commented。requested は依頼中でまだレビューしていない */
export type PrReviewerState = 'approved' | 'changes' | 'commented' | 'requested';

export interface PrReviewer {
  /** チームへの依頼はチームの名前 */
  login: string;
  state: PrReviewerState;
  team?: true;
}

export interface PrLabel {
  name: string;
  /** GitHub の 16 進の色（# なし） */
  color: string;
}

export type PrChecks = 'pass' | 'fail' | 'pending' | 'none';

/** PR 一覧の 1 件（`GET /api/prs`。GitHub の GraphQL から作る） */
export interface OpenPr {
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  head: string;
  base: string;
  headSha: string;
  labels: PrLabel[];
  reviewers: PrReviewer[];
  additions: number;
  deletions: number;
  changedFiles: number;
  /** 会話のコメントとレビューのスレッドの数 */
  comments: number;
  updatedAt: string;
  checks: PrChecks;
}

/** `GET /api/prs` の答え。truncated = 更新が新しい 100 件より先がある */
export interface PrList {
  fetchedAt: number;
  /** gh でログインしている人。取れなければ null */
  viewer: string | null;
  prs: OpenPr[];
  truncated: boolean;
}

/** PR の詳細（`GET /api/prs/:n`。PR 一覧のカードを押すと出す。3.11）の時系列のレビューの種類。dismissed は後から取り下げたレビュー */
export type PrReviewKind = 'approved' | 'changes' | 'commented' | 'dismissed';

/** レビューの行へのコメント。line は今の差分の行。差分から外れた（古くなった）ら書いたときの行、ファイルへのコメントは null */
export interface PrLineComment {
  path: string;
  line: number | null;
  body: string;
}

/** 時系列の 1 件。at は GitHub の時刻（ISO 8601）。続いたコミットは 1 件にまとめる（at は最後のコミット、author は最初のコミット） */
export type PrTimelineItem =
  | { kind: 'comment'; author: string; at: string; body: string }
  /** moreComments = 取っていない行へのコメントの数（最初の 10 件だけを取る） */
  | { kind: 'review'; author: string; at: string; state: PrReviewKind; body: string; comments: PrLineComment[]; moreComments: number }
  | { kind: 'commits'; author: string; at: string; count: number };

export interface PrFileChange {
  path: string;
  additions: number;
  deletions: number;
}

/** チェックの結果。GitHub の CheckRun と StatusContext をまとめる（TIMED_OUT・STARTUP_FAILURE・ERROR は fail） */
export type PrCheckResult = 'pass' | 'fail' | 'pending' | 'skipped' | 'cancelled' | 'neutral' | 'action' | 'stale';

export interface PrCheck {
  name: string;
  result: PrCheckResult;
  /** CheckRun の実行にかかった秒数。終わっていなければ無い */
  seconds?: number;
  /** StatusContext の説明 */
  description?: string;
}

export interface PrDetail {
  number: number;
  /** PR 本文（Markdown）。空なら '' */
  body: string;
  /** 会話のコメント・レビュー・コミットの追加の古い順 */
  timeline: PrTimelineItem[];
  /** 取っていない古い時系列の数（新しい 100 件だけを取る。コミットはまとめる前の数） */
  olderItems: number;
  /** GitHub の changedFiles の順。最初の 100 件 */
  files: PrFileChange[];
  filesTotal: number;
  /** 最後のコミットのチェック。最初の 50 件 */
  checks: PrCheck[];
  checksTotal: number;
}

/**
 * serve が子プロセスで走らせる解析（`GET /api/analyze` は key ごとの最新）。走るのは同時に 1 本で、あとは順番待ち。
 * from は解析し直したときの元の版（PR 一覧から初めて解析するときは無い）
 */
export type AnalyzeJob =
  | { status: 'queued'; key: string; from?: string; queuedAt: number }
  | { status: 'running'; key: string; from?: string; startedAt: number; line?: string }
  | { status: 'done'; key: string; from?: string; headSha: string }
  | { status: 'failed'; key: string; from?: string; reason: string };

/**
 * serve が走らせる AI レビュー（3.11。`GET /api/review` は key ごとの最新）。解析の列とは別で、いくつでも同時に走る。
 * waiting = その PR の解析が順番待ちか解析中で、終わるのを待っている（headSha は頼んだ head。解析が終わると解析した head をレビューする）。
 * done の drafts はその head の state の AI の下書き（draft / edit / adopted）の数で、聞くたびに数え直す。skipped は GitHub の差分に出ない行なので入れなかった数
 */
export type ReviewJob =
  | { status: 'waiting'; key: string; headSha: string }
  | { status: 'running'; key: string; headSha: string; startedAt: number }
  | { status: 'done'; key: string; headSha: string; drafts: number; skipped: number }
  | { status: 'failed'; key: string; headSha: string; reason: string }
  | { status: 'stopped'; key: string; headSha: string };

/**
 * 案内人に聞く（3.10）で「+」で選んだ行。side は head（足した行・変わらない行）か base（消した行）。
 * start / end は画面の上からの順（消した行から足した行へまたぐこともある）。1 行なら同じ
 */
export interface AskLines {
  path: string;
  start: { side: 'head' | 'base'; line: number };
  end: { side: 'head' | 'base'; line: number };
}

/**
 * 案内人に聞く（3.10）の「何について」。画面で決まる: 入口・締め = pr、総括 = course（コース外は 0）、
 * 停留所の画面 = symbol（覗いている間は覗いている箱で courseId 無し）、差分一覧・目的ごと = 選んだ hunk（無ければ file / pr）。
 * 行を選んで聞いたときは lines（停留所の画面と差分一覧だけ。差分一覧で差分をまたぐ行は file）
 */
export type AskPlace =
  | { kind: 'pr' }
  | { kind: 'course'; courseId: number }
  | { kind: 'symbol'; symbolId: string; courseId?: number; lines?: AskLines }
  | { kind: 'hunk'; hunkId: string; lines?: AskLines }
  | { kind: 'file'; path: string; lines?: AskLines };

/** 答えの行の場所。side は head（足した行・変わらない行）か base（消した行）。範囲なら endLine */
export interface AskCite {
  path: string;
  side: 'head' | 'base';
  line: number;
  endLine?: number;
}

/** 案内人がネットで調べたページ（10.5）。url は http / https だけ（検証済み）。title は LLM が書いた題（空のこともある） */
export interface AskWeb {
  url: string;
  title: string;
}

/**
 * 案内人の答え（10.5）。lead / tail は文、items は事実 1 つずつ。unverified = LLM が付けた行の場所が材料に無かった（場所を外した）。
 * web = ネットで調べたページ。known = 行の場所もページも無い、LLM が元から知っている事実（画面は「出典なし」）。どれも無い項目は材料の事実（件数など行を付けられないもの）
 */
export interface AskAnswer {
  lead: string;
  items: Array<{ text: string; cite?: AskCite; unverified?: true; web?: AskWeb; known?: true }>;
  tail?: string;
}

/** 1 問 1 答。key は場所の鍵（web が場所から作る。同じ鍵の直前の問いを続けて聞く材料にする） */
export interface AskEntry {
  id: string;
  key: string;
  place: AskPlace;
  question: string;
  answer: AskAnswer;
  /** 答えた LLM コマンドと、かかった時間 */
  command: string;
  ms: number;
  /** ISO 8601 */
  at: string;
}

/** .ondina/<key>/ask/<headSha>.json。古い順。失敗と止めた問いは入らない */
export interface AskLog {
  entries: AskEntry[];
}

/** head 側のファイル 1 本の全文（3.3 の停留所の画面）。行の文字列は tokens の連結 */
export interface FileText {
  /** repo 相対 */
  path: string;
  tokens: TokenLine[];
}

/**
 * 名前から定義へ移る（3.6。2026-10-29）。解析のときに言語サーバーの textDocument/definition で聞いた答え（provenance は lsp）。
 * 聞いた名前は、画面に出る行の名前（head はファイル全体、base は差分の行）と、そこから移る先のうち差分の列に無いファイル全体の名前。その先のファイルは全文だけ持ち、名前は聞かない
 */
export interface Definitions {
  /** 定義の場所。DefFile.names の 4 つ目がこの添字 */
  targets: DefTarget[];
  /** 名前を聞いたファイル（名前が 1 つも無くても置く）。side・path の順 */
  files: DefFile[];
}

/**
 * 定義の場所。行は 1 始まり、列は 0 始まり（UTF-16）。base の定義が PR で変わっていないファイルにあれば head の同じ場所にする。
 * shown は差分の列に出る行（hunk の行）のとき、その行の見え方（消した行は LEFT と base の行番号、ほかは RIGHT と head の行番号）。
 * lib はリポジトリの外（ライブラリ・JDK）。中身は jar などの名前
 */
export type DefTarget = { side: 'head' | 'base'; path: string; line: number; col: number; shown?: { hunkId: string; side: 'LEFT' | 'RIGHT'; line: number } } | { lib: string };

/** 1 ファイルの名前。[行（1 始まり）, 列（0 始まり）, 長さ, targets の添字]。行・列の順。part = 差分の行だけ聞いた（残りの行の名前は聞いていない。base の変わったファイルだけ） */
export interface DefFile {
  side: 'head' | 'base';
  path: string;
  names: Array<[number, number, number, number]>;
  part?: true;
}

/** パイプラインの成果物。JSON 1ファイル。headSha をキーにキャッシュ */
export interface Analysis {
  /**
   * body は作者の説明の原文（PR 本文か --body）。説明の画面（3.1）が Markdown として描き、裏付けのない文にマーカーを打つ。古い Analysis.json には無い。
   * bodyCode は本文のコードブロックの色（Shiki が知っている言語だけ）。古い Analysis.json には無い（画面は色なしで出す）。
   * ticket は --ticket で指定したチケットか、--ticket が無いときに題・ブランチ名・本文から LLM が選んだチケット（5.1。2026-10-12）。無い = 指定も選んだものも無い。
   * ticketSearch は --ticket が無いときに探した記録。無い = --ticket で指定した解析か、古い解析
   * workingTree は `analyze --base <ref>`（--head 無し）で、ブランチのコミットとコミットしていない変更を解析したとき。headSha は作業ツリーの tree
   * （コミットではない。作業ツリーに変更が無ければ HEAD のコミット）、head は解析したときのブランチ名（5.1。2026-10-15）。無い = ref どうしか PR の解析
   */
  pr: { number: number; title: string; base: string; head: string; headSha: string; baseSha: string; body?: string; bodyCode?: BodyCode[]; ticket?: Ticket; ticketSearch?: TicketSearch; workingTree?: true };
  hunks: Hunk[];
  hows: How[];
  symbols: Symbol[];
  edges: Edge[];
  tours: Tour[];
  specs: Spec[];
  claims: Claim[];
  summary: Summary;
  /** 説明タブの背景（3.1）。無い = チケットの「なぜ」も 2 回目の LLM の前からあるもの・言葉も無い（LLM が動かなかった・古い解析など） */
  background?: Background;
  /** ondina.config.yaml のうち解析に効く部分（11 章）。analyze 時に読んで埋める。無ければ既定値 */
  config: AnalysisConfig;
  /** Stage 2（LLM。5.3）の 1 回目（目的ごとに分ける）の記録。どのコマンドで出したか。skipped / failed のとき hows / claims は空 */
  llm?: LlmRun;
  /** 2 回目（文を書く。5.3）の記録。欄が無い = 走らせていない（--no-llm、1 回目が ok でない、古い解析）。skipped / failed のとき summary は空で tours に文が無い */
  llmText?: LlmRun;
  /** 要求の抜き出し（10.8）の記録。欄が無い = 走らせていない（チケットが無い・取れなかった、1 回目が ok でない、古い解析）。failed のとき specs は空 */
  llmSpecs?: LlmRun;
  /** LSP（9.1 / 9.5）の記録。欄が無い = 動かしていない（analyze に --no-lsp を付けた） */
  lsp?: LspRun;
  /** 構成の推定（10.6）の記録。層を推定した構成から付けたか。欄が無い = ondina.config.yaml の layers を使った解析か、古い解析 */
  structure?: StructureRun;
  /** head 側の全文。差分のあるファイル（削除を除く）と Symbol.path のファイル。path 順。古い Analysis.json には無い */
  files?: FileText[];
  /** base 側の全文。定義の行き先（defs）が base で、差分の列に無いファイル。path 順。無い = 言語サーバーを使っていない解析か、古い解析 */
  baseFiles?: FileText[];
  /** 名前から定義へ（3.6）。無い = 言語サーバーを使っていない解析か、古い解析（名前から移れない） */
  defs?: Definitions;
  /** GitHub の PR の差分の塊（12 章）。ファイルごと、path 順。行コメントを付けられるのはこの塊に入る行だけ。古い Analysis.json には無い */
  githubDiff?: GithubDiffFile[];
  /** 入口の地図のまとまり（3.3）。全景に 7 つまで並べ、押すと中に入る。無い = 古い解析 */
  mapGroups?: MapGroups;
}

/**
 * 入口の地図のまとまりの木（3.3。2026-11-04）。箱はコースで分ける（箱の最初のコース。地図の丸と同じ決め方）。
 * コースが 7 つ以下なら全景はコースとコース外。8 つ以上なら、1 回目の LLM がコースを 7 つ以下の題にまとめ、全景は題とコース外になる。
 * 題の中は、箱が 8 つ以上ならコース、7 つ以下なら箱を並べる
 */
export interface MapGroups {
  /** 全景に並べるまとまりの id（並び順） */
  root: string[];
  groups: MapGroup[];
  boxes: MapBox[];
}

export interface MapGroup {
  /** 'theme:<n>' / 'course:<How の id>' / 'outside' */
  id: string;
  kind: 'theme' | 'course' | 'outside';
  /** course だけ */
  howId?: number;
  /** theme だけ: LLM が付けた名前 */
  title?: string;
  /** theme は llm（画面は点線）。course と outside はプログラムが分けたので ast */
  provenance: Provenance;
  /** 中に並ぶもの（並び順）。theme はコースのまとまりか箱、course と outside は箱。MapGroup.id か MapBox.id */
  children: string[];
}

/** 地図の箱 1 つ。差分のあるファイル 1 つ（テストを除く）か、畳んだ束 1 つ */
export interface MapBox {
  /** 'file:<path>' / 'group:<代表の hunk id>' */
  id: string;
  /** ファイルは拡張子を除いたファイル名、束は書き換えのパターン */
  label: string;
  /** ファイルの箱だけ */
  path?: string;
  /** 箱に入る hunk（束はメンバー全部） */
  hunkIds: string[];
  /** 箱の最初のコース（hunk の How の id のうち一番小さいもの）。0 = コース外 */
  course: number;
}

/**
 * 1 ファイルの GitHub の差分の塊。`git diff -U3 <baseSha> <headSha>` の `@@ -oldStart,oldLines +newStart,newLines @@`。
 * 2026-10-06 に本物の PR で、GitHub の Files changed の塊と全部一致することを確かめた
 */
export interface GithubDiffFile {
  path: string;
  hunks: Array<{ oldStart: number; oldLines: number; newStart: number; newLines: number }>;
}

/** LLM コマンドの実行記録（5.3）。コマンドは sh -c で起動し、stdin にプロンプト、stdout に JSON */
export interface LlmRun {
  command: string;
  status: 'ok' | 'skipped' | 'failed';
  /** skipped / failed の理由（1 行） */
  reason?: string;
}

/**
 * LSP の実行記録（9.1 / 9.5）。status が unavailable なら意味ハイライトも辺も信用しない。
 * 取り込みが失敗した状態でも LSP は答えを返すが、その答えは間違っている
 * （2026-09-21 実測: 意味トークン 18 個 / 正解 30 個、呼び出し 0 件 / 正解 1 件）。
 * だから「辺だけダメ」のような中間の状態を作らない。
 */
/**
 * 構成の推定（設計書 10.6）の記録。推定はそのリポジトリで初めて analyze するときに 1 回だけ走り、.ondina/structure.json に残る。
 * ok = 保存した構成から層を付けた。skipped = LLM を飛ばした（--no-llm）。failed = 推定できなかった（理由は reason）
 */
export interface StructureRun {
  status: 'ok' | 'skipped' | 'failed';
  reason?: string;
  /** 推定に使った LLM コマンド */
  command?: string;
  /** ok のとき: 推定した時点 */
  inferred?: { headSha: string; at: string };
  /** ok のとき: 帯の並び（上から。呼ぶ側 → 呼ばれる側） */
  layers?: string[];
  /** ok のとき: 推定の後に増えたファイルのうち、どの層にも対象外にも入らないもの */
  unclassified?: {
    count: number;
    /** 推定したときの追跡ファイル数（警告の閾値の元） */
    total: number;
    /** 推定し直しを促すか（total の 5% 以上、最低 5 件） */
    warn: boolean;
    /** 先頭 20 件（昇順） */
    paths: string[];
  };
  /**
   * テストの見分けに推定を使ったときだけ（設定にテストの置き場が無いとき。5.2 の 7）: 推定したテストの置き場（ディレクトリかファイル）。
   * このときテストの hunk は kindProvenance: 'llm'、画面は「テスト（推定）」と出す
   */
  tests?: string[];
}

export interface LspRun {
  command: string;
  status: 'ok' | 'unavailable';
  /** unavailable の理由（1 行） */
  reason?: string;
  /**
   * 準備完了までの実測（ms）。準備完了に到達した回だけ入る。
   * つまり ok のときと、「準備完了はしたが取り出し（9.1 の work）で失敗した」unavailable のとき。
   * それ以外の unavailable は準備完了に到達していないので欄ごと無い。
   */
  waitedMs?: number;
}

/** ondina.config.yaml（設計書 11 章）のうち解析に効く部分。Analysis.config に入る。変えたら analyze の打ち直しが要る */
export interface AnalysisConfig {
  project?: string;
  language?: string;
  sourceRoots: string[];
  layers: Array<{ name: string; match: string[] }>;
  /** 層名 → 依存してよい層名。無い方向の辺は「層を飛び越える呼び出し」（9.4） */
  allowedDependencies: Record<string, string[]>;
  /** 言語 → 追従検出で有効にする正規化ルール名（8 章） */
  normalize: Record<string, string[]>;
  /**
   * 言語 → LSP の起動（9.1）。args の {cacheDir} は cli がインデックスの置き場に置換する。
   * importNotification は取り込みの成否を伝える独自通知の読み方。書かなければ core の既定（kotlin は intellij/importLog）
   */
  lsp: Record<string, { command: string; args: string[]; readyTimeoutSec: number; importNotification?: { method: string; succeededField: string; failedField: string } }>;
  /** LLM コマンド（11 章 / 5.3）。UI の UiSettings.llmCommand が優先。無ければ既定（claude -p …） */
  llm?: { command: string };
}

/** テーマの選び方（3.5。2026-10-22）。system は OS の外観（prefers-color-scheme）に合わせ、OS が切り替わると一緒に変わる */
export type ThemeMode = 'system' | 'light' | 'dark';

/** テーマ（3.5）。light / dark は Catppuccin のフレーバー（ライトは latte、ダークは frappe / macchiato / mocha） */
export interface ThemeSettings {
  mode: ThemeMode;
  /** ライトのときのフレーバー */
  light: string;
  /** ダークのときのフレーバー */
  dark: string;
  accent: string;
}

/** ondina.config.yaml のうち表示だけに効く部分。serve が毎回読んで `GET /api/config` で UI に渡す（再解析不要） */
export interface DisplayConfig {
  /** UI でのパス短縮表示に使う（3.4）。無ければ短縮しない */
  packagePrefix?: string;
  /** テーマの既定（3.5）。UiSettings.theme が無いときに使う */
  theme: ThemeSettings;
  /** `IDEAで開く`（3.6）。project が無ければ対象リポジトリのディレクトリ名 */
  ide: { scheme: 'jetbrains'; product: string; project?: string };
}

/** ondina.config.yaml 全体（正規化済み。既定値で埋めてある） */
export type OndinaConfig = AnalysisConfig & DisplayConfig;

/** 外部の AI エージェントから受け取るコメント（設計書 12 章）。`POST /api/comments` と `ondina comments add` の入力 */
export interface CommentsInput {
  source: string;
  headSha: string;
  comments: Array<{ path: string; line: number; side: 'LEFT' | 'RIGHT'; body: string }>;
}

/** `GET /api/analyses` の 1 件。.ondina/<key>/<headSha>.json のメタ情報 */
export interface AnalysisSummary {
  /** PR 番号の文字列か 'local' */
  key: string;
  headSha: string;
  pr: Analysis['pr'];
  /** ファイルの更新時刻（epoch ms）。新しい順に並べる */
  mtime: number;
  /** 対象リポジトリのディレクトリ名。`IDEAで開く` の project に使う */
  repoName: string;
  /** PR ページの URL。origin が GitHub でないか local のときは無い */
  prUrl?: string;
}

/** 差分の見せ方。sbs = 左右、uni = 統合 */
export type DiffMode = 'sbs' | 'uni';

/** 幅を変えられる横の列。stopTree / stopGuide = コースの停留所の画面の左のツリー / 右の水先案内、diffTree = 差分一覧のファイル列 */
export type PaneId = 'stopTree' | 'stopGuide' | 'diffTree';

/** .ondina/ui.json。PR をまたぐ UI 設定（設計書 3.8）。画面の設定はすべてここ（2026-10-11） */
export interface UiSettings {
  /** base / head の worktree を置く親ディレクトリ。無ければ analyze の既定 */
  worktreeRoot?: string;
  /** LLM コマンド（5.3）。yaml の llm.command より優先。空なら消す */
  llmCommand?: string;
  /** AI レビューのコマンド（3.11。2026-10-22）。PR ごとに sh -c で起動する。無ければ PR 一覧に「AI にレビューを頼む」を出さない */
  reviewCommand?: string;
  /** チケットの取り方（5.1。2026-10-12） */
  ticket?: TicketSettings;
  /** テーマ（3.5）。無ければ yaml の theme */
  theme?: ThemeSettings;
  /** 左右 / 統合。b = 目的ごとの画面、c = コースの停留所の画面、d = 差分一覧。無い画面は左右 */
  diffMode?: { b?: DiffMode; c?: DiffMode; d?: DiffMode };
  /**
   * ショートカットキーの変更（2026-10-20）。既定から変えた操作だけを持つ（操作の名前 → キー）。
   * キーは KeyboardEvent.key の書き方（Shift の文字は大文字 `M`）、⌘ / Ctrl 付きは `Mod+k`、2 つ続けては空白区切り `g i`。空の配列はキーなし
   */
  keymap?: Record<string, string[]>;
  /** 列の幅（2026-10-20）。境目をドラッグした列だけを持つ（列 → px の整数）。無い列は既定の幅 */
  panes?: Partial<Record<PaneId, number>>;
  /** 入口の地図でコースの道順を再生する速さ（2026-11-04。0.25〜3 倍）。無ければ 1 倍 */
  mapSpeed?: number;
}
