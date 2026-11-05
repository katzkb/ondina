// analyze: base / head を取り、変更ファイルを core に渡して Analysis.json を書く。設計書 5.1 / 5.5。
//
// - PR モード: gh で PR のメタ情報 → origin から fetch → merge-base
// - ローカルモード: 2 ref から merge-base（gh を呼ばない）。<pr> の代わりに `local` を鍵にする
// - 変更ファイルの中身は git から読む（解析のための worktree は作らない）。worktreeRoot は言語サーバー用の worktree の置き場所
// - キャッシュは <repo>/.ondina/<key>/<headSha>.json
// hunk には Shiki の字句トークンを付ける（設計書 7 章）。
// ondina.config.yaml（11 章）は対象リポジトリ直下から読み、解析に効く部分を Analysis.config に入れる（表示だけの部分は serve が読む）。
// 追従検出（8 章）で hunk の kind / group を埋める（core の detectRipples）。
// LLM（10 章）: 入力 JSON とプロンプトは core が組み、ここが LLM コマンドを起動して（llm.ts）、出力の検証も core に任せる。PR の呼び出しは 2 回（5.3）:
// 1 回目（目的ごとに分ける）で hows / hunk.hows / kind（How に入った none → core）/ claims を埋め、読む順番（tours）を組んだ後、
// 2 回目（文を書く）で summary（入口の説明）と tours の変わること・確かめること・この場所を埋める。2 回目は 1 回目が ok のときだけ。
// チケットが取れていれば、2 回目と同時に要求の抜き出し（10.8）で specs と How の specIds を埋める（これも 1 回目が ok のときだけ）。
// チケットを Jira から取れたら、どんな案件の一部か（親チケット・同じ案件の PR。project.ts）を層の推定・LSP・1 回目と同時に調べる。
// symbols（5.2 の 4）は hunk と 1 対 1 で、層は設定の glob で付く。設定に layers が無ければ、リポジトリ全体から推定した構成（10.6）で付く。
// 構成の推定はそのリポジトリで初めて analyze するとき（.ondina/structure.json が無いとき）に 1 回だけ走り、以後は保存を使い回す（structure.ts）。
// LSP（9 章）: 既定で（--no-lsp でなければ）base / head の 2 つを workspaceFolder に入れた言語サーバーで意味トークンと辺を取り、
// Analysis.lsp に記録する。serve が動いていれば、serve が起動したまま持つ言語サーバーに頼む（lsp-remote.ts）。
// 動いていなければ自分で起動して閉じる（lsp-session.ts）。どちらも言語サーバー用の worktree を 1 組に固定して中身だけ切り替える。
// 取った意味トークンは字句トークンに重ねてから hunk に付ける（7.2）ので、LSP は attachTokens より先に走る。
// 失敗しても解析は止めず、理由を残す（9.5）。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyLayerGuesses, applyLlmOutput, applySpecs, buildSpecInput, defaultLspConfig, parseSpecOutput, renderSpecPrompt, type CallGraphSource, type DefinitionSource, type LayerRule, type LlmInput, type SpecInput, type StructureRun, applyFlowTitles, applyNarration, attachCalls, attachFlowCalls, buildFlows, copyFlowTitles, attachTokens, buildBaseCallEdges, buildBehaviors, buildCallGraph, buildMapGroups, buildDefinitions, buildLlmInput, buildNarrationInput, buildSymbols, bodyCodeTokens, buildTicketInput, buildTours, chooseProbeTargets, detectRipples, drawerFiles, extractAllHunks, findTicketCandidates, removedDeclarations, headFileSources, headFileTokens, KOTLIN_IMPORT_NOTIFICATION, parseLlmOutput, parseNarrationOutput, parseTicketOutput, previousFrom, renderNarrationPrompt, renderPrompt, renderTicketPrompt, splitConfig, testPathsFor, TICKET_CANDIDATE_LIMIT, toHunk, verifyLayerGuesses, verifyTicketChoice, type Analysis, type ChangedFile, type LlmRun, type LspRun, type SavedStructure, type SemanticSource, type TicketSource } from '@ondina/core';
import type { How, Hunk, ParentTicket, Project, Spec, Ticket, TicketSearch, TicketSettings } from '@ondina/model';
import { readConfigFile } from './config.js';
import { changedFiles, git, githubDiff, readBlobs, resolveLocalRefs, resolveWorkingTree, type RefPair } from './git.js';
import { findPrevious, readLlmCache, resolveLlmCommand, runLlmCommand, writeLlmCache, type LlmCall } from './llm.js';
import { installedLspCommand, lspCacheDir, lspInstallPath, lspWorktreeRoot, resolveLspCommand } from './lsp.js';
import { findServe, requestServeLsp, toJobArgs, type LspJobRequest } from './lsp-remote.js';
import { createLspHolder } from './lsp-session.js';
import { fetchPr, resolvePrRefs, runGhAsync, type RunGh, type RunGhAsync } from './pr.js';
import { fetchProject } from './project.js';
import { keyDir } from './store.js';
import { applyStructure, inferredDate, inferStructure, listTrackedFiles, readStructure, STRUCTURE_FILE } from './structure.js';
import { fetchTicket } from './ticket.js';

export interface AnalyzeOptions {
  /** 言語サーバー用の worktree（<worktreeRoot>/lsp/{base,head}）を置く親ディレクトリ。既定は <repo>/.ondina/lsp */
  worktreeRoot?: string;
  runGh?: RunGh;
  /** 同じ案件の PR の検索（project.ts）に使う gh。テストで差し替える */
  runGhAsync?: RunGhAsync;
  /** auto = 保存した出力があれば使う（既定）、off = 起動しない（--no-llm）、relabel = 保存を無視して起動し直す（--relabel） */
  llm?: 'auto' | 'off' | 'relabel';
  /** LLM コマンド（UI の .ondina/ui.json）。無ければ ONDINA_LLM_COMMAND > yaml の llm.command > 既定 */
  llmCommand?: string;
  /** 作者の説明原文（ローカルモードの --body <file>）。PR モードは gh から取る */
  body?: string;
  /** 題（ローカルモードの --title）。無ければ `<base>..<head>`。PR モードは gh から取る */
  title?: string;
  /**
   * チケット（5.1）。ref = --ticket に渡した値（無ければ題・ブランチ名・本文から探す。10.7）、settings = UI の .ondina/ui.json の ticket、
   * cwd = ファイルの値を解決する場所。この欄が無ければ取り方は既定（Jira）、cwd はリポジトリ
   */
  ticket?: { ref?: string; settings?: TicketSettings; cwd: string; env?: NodeJS.ProcessEnv };
  /** LSP を起こして意味情報と辺を取る。cli は既定で true（--no-lsp で false）。この関数を直接呼ぶテストでは既定 false（偽 LSP を毎回起こさない） */
  lsp?: boolean;
  /** テスト用。LSP の子に足す環境変数（偽 LSP の挙動の切り替え）。本番では指定しない */
  lspEnv?: Record<string, string>;
  /** テスト用。言語サーバーの準備を待っている間に progress を呼ぶ間隔（既定 30 秒） */
  lspWaitReportMs?: number;
  /**
   * 途中経過の 1 行（段の始まりと、言語サーバーの準備を待っている間）。main がその場で stderr に出す。
   * 画面から解析し直すとき、serve はこの最後の 1 行を進みとして出す（reanalyze.ts）
   */
  progress?: (line: string) => void;
}

export interface AnalyzeResult {
  analysis: Analysis;
  /** 書いた Analysis.json のパス */
  cachePath: string;
  /** 止めるほどではない注意（yaml が無い、など）。main が stderr に出す */
  warnings: string[];
  /** 解析の要約（追従グループの件数など）と、未対応の設定の知らせ。main が stderr に出す */
  info: string[];
}

/** `ondina analyze <pr>` */
export async function analyzePr(repo: string, number: number, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  opts.progress?.(`PR #${number} の情報を取得しています`);
  const pr = fetchPr(repo, number, opts.runGh);
  const refs = resolvePrRefs(repo, pr);
  return runAnalysis(repo, String(number), { number: pr.number, title: pr.title, base: pr.base, head: pr.head }, refs, { ...opts, body: opts.body ?? pr.body });
}

/**
 * `ondina analyze --base <ref> --head <ref>`（gh 無し）。head が無ければ、このブランチのコミットとコミットしていない変更を解析する（5.1）:
 * base は merge-base(base, HEAD)、head は作業ツリーの tree（コミットは作らない。.ondina と worktree の置き場（リポジトリの中なら）は入れない）
 */
export async function analyzeLocal(repo: string, base: string, head: string | undefined, opts: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  if (head !== undefined) {
    const refs = resolveLocalRefs(repo, base, head);
    return runAnalysis(repo, 'local', { number: 0, title: opts.title ?? `${base}..${head}`, base, head }, refs, opts);
  }
  const refs = resolveWorkingTree(repo, base, opts.worktreeRoot);
  // ブランチに乗っていなければ（detached HEAD）、HEAD の短い sha を名前にする（`HEAD` では何か分からない）
  const abbrev = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
  const branch = abbrev === 'HEAD' ? git(repo, 'rev-parse', '--short', 'HEAD') : abbrev;
  return runAnalysis(repo, 'local', { number: 0, title: opts.title ?? `${base}..${branch}（作業中）`, base, head: branch, workingTree: true }, refs, opts);
}

async function runAnalysis(
  repo: string,
  key: string,
  pr: Omit<Analysis['pr'], 'baseSha' | 'headSha'>,
  refs: RefPair,
  opts: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const { config, warning } = readConfigFile(repo);
  const dir = keyDir(repo, key);
  opts.progress?.('base と head のコードを用意しています');
  const files = changedFiles(repo, refs);
  const analysisConfig = splitConfig(config).analysis;
  const command = resolveLlmCommand({ override: opts.llmCommand, env: process.env['ONDINA_LLM_COMMAND'], yaml: analysisConfig.llm?.command });
  const mode = opts.llm ?? 'auto';
  // チケット（5.1 / 10.7）。--ticket が無ければ題・ブランチ名・本文から探す。層の推定・LSP と同時に進め、Analysis を組む前に待つ。
  // ローカルモードの既定の題（main..feature/x）は人が書いたものでないので見ない（--title で付けた題は見る）
  const source: TicketSource = { ...(key === 'local' && opts.title === undefined ? {} : { title: pr.title }), branch: pr.head, body: opts.body ?? '' };
  const ticketing = ticketFor(repo, key, source, opts.ticket, command, mode).catch((e: unknown) => ({ info: [], warnings: [`チケットを探せませんでした: ${e instanceof Error ? e.message : String(e)}`] }) as Ticketing);
  const projecting = ticketing.then((t) => (t.ticket === undefined ? undefined : projectFor(repo, pr, t.ticket, opts)));

  // 層の規則（5.2 の 4 / 10.6）。設定の layers があればそれ、無ければ保存した構成（初回は推定して保存）。
  // テストの見分け（5.2 の 7）は、設定にテストの置き場が無ければ構成の推定のテストの置き場を使うので、追従検出より先に決める
  const needTests = testPathsFor(analysisConfig).provenance === undefined;
  const layering = await layeringFor(repo, analysisConfig.layers, refs.headSha, command, mode, needTests, opts.progress);
  const tests = testPathsFor(analysisConfig, layering.tests);
  opts.progress?.('差分を切り出しています');
  const ripples = await detectRipples(files, (await extractAllHunks(files)).map(toHunk), analysisConfig, tests);
  const info = [...ripples.info, ...layering.info];
  // 設定の layers があると構成の推定は走らない。テストの置き場も書いていなければ、黙ってテストが箱に並ぶので知らせる
  if (tests.provenance === undefined && analysisConfig.layers.length > 0) {
    info.push('テストを見分けていません: ondina.config.yaml の layers に Tests がなく、sourceRoots にも test を含むディレクトリがありません（layers を書くと構成の推定は走りません）');
  }

  // LSP（9 章）。--lsp のときだけ。失敗しても解析は止めず、事実として Analysis.lsp に残す（9.5）。
  // 意味トークンを字句トークンに重ねる（7.2）ので attachTokens より先に走らせる
  const testInputs = { layers: analysisConfig.layers, sourceRoots: analysisConfig.sourceRoots, ...(layering.tests === undefined ? {} : { inferred: layering.tests }) };
  const { run: lsp, result: lspResult, reused } =
    opts.lsp === true
      ? await lspRun(repo, analysisConfig, ripples.hunks, files, refs, testInputs, opts)
      : { run: undefined, result: undefined, reused: false };
  const semantic = lspResult?.semantic;
  if (lsp !== undefined) {
    const counted = semantic === undefined ? '' : `、意味の色分け head ${semantic.head.size} 件 / base ${semantic.base.size} 件`;
    info.push(
      lsp.status === 'ok'
        ? `LSP: ${lsp.command}（${reused ? '起動済み。' : ''}準備完了まで ${((lsp.waitedMs ?? 0) / 1000).toFixed(1)} 秒${counted}）`
        : `LSP を使いませんでした: ${lsp.reason ?? '理由は受け取っていません'}`,
    );
  }
  const tokenized = await attachTokens(ripples.hunks, files, semantic === undefined ? {} : { semantic });
  // 経路上の未変更シンボルのファイル（辺の抜き出しと実物の画面の全文）。初めて聞かれたときに、言語サーバーが返したファイルをまとめて読む
  // （1 つずつ git を起こすと、偽の言語サーバーの 63 ファイルで 0.55 秒。2026-10-23 実測）
  const headTexts = new Map<string, string | undefined>();
  const readHead = (rel: string): string | undefined => {
    if (!headTexts.has(rel)) {
      const want = [...new Set([rel, ...callGraphPaths(lspResult?.callGraph)])].filter((p) => !headTexts.has(p));
      readBlobs(repo, refs.headSha, want).forEach((text, i) => headTexts.set(want[i]!, text ?? undefined));
    }
    return headTexts.get(rel);
  };

  // 辺と経路上の未変更シンボル（9 章）。LLM 入力に辺を入れるので LLM より先に組む
  const symbolsBase = buildSymbols(tokenized, layering.rules, layering.provenance);
  const graph =
    lspResult?.callGraph === undefined
      ? { edges: [], symbols: symbolsBase, unmeasured: 0 }
      : buildCallGraph(lspResult.callGraph, { hunks: tokenized, symbols: symbolsBase, layers: layering.rules, layerProvenance: layering.provenance, allowedDependencies: analysisConfig.allowedDependencies, readHead });
  if (lspResult?.callGraph !== undefined) {
    const crossing = graph.edges.filter((e) => e.crossesLayers).length;
    const baseline = graph.symbols.filter((s) => !s.changed).length;
    info.push(`関連の線 ${graph.edges.length} 本（層を飛び越える ${crossing} 本）、経路上の未変更シンボル ${baseline} 件、呼び出し関係を取得できなかったシンボル ${graph.unmeasured} 件`);
  }
  // 変わる前の呼び出し辺（流れの地図の ① 背景。2026-11-05）。base にだけある未変更シンボルは symbols に足す。
  // base の本文も head と同じく、初めて聞かれたときに答えに出たファイルをまとめて読む
  const baseTexts = new Map<string, string | undefined>();
  const readBase = (rel: string): string | undefined => {
    if (!baseTexts.has(rel)) {
      const want = [...new Set([rel, ...callGraphPaths(lspResult?.callGraphBase)])].filter((p) => !baseTexts.has(p));
      readBlobs(repo, refs.baseSha, want).forEach((text, i) => baseTexts.set(want[i]!, text ?? undefined));
    }
    return baseTexts.get(rel);
  };
  const baseGraph =
    lspResult?.callGraphBase === undefined
      ? undefined
      : buildBaseCallEdges(lspResult.callGraphBase, { hunks: tokenized, symbols: symbolsBase, layers: layering.rules, layerProvenance: layering.provenance, allowedDependencies: analysisConfig.allowedDependencies, readHead: readBase });
  if (baseGraph !== undefined) {
    const known = new Set(graph.symbols.map((s) => s.id));
    graph.symbols.push(...baseGraph.symbols.filter((s) => !known.has(s.id)));
    info.push(`変わる前の呼び出しの線 ${baseGraph.edges.length} 本`);
  }

  // 名前から定義へ（3.6）。行き先のうち差分の列に無いファイルは引き出しに全文を出すので、head は files に、base（PR で変わったファイル）は baseFiles に入れる
  // 変わったファイルは言語サーバーの仕事に渡したもの（LspJobArgs.changed）と同じ集合
  const defs = lspResult?.definitions === undefined ? undefined : buildDefinitions(lspResult.definitions, tokenized, new Set(files.map((f) => f.path)));
  const drawer = defs === undefined ? [] : drawerFiles(defs.targets);
  if (defs !== undefined) {
    const names = defs.files.reduce((n, f) => n + f.names.length, 0);
    info.push(`定義へ移れる名前 ${names} 個（名前を聞いたファイル ${defs.files.length} 本、引き出しに出すファイル ${drawer.length} 本）`);
  }

  // 実物の画面（3.3）の全文。差分のあるファイルと、経路上の未変更シンボルのファイルと、定義の引き出しに出す head のファイル
  const fileTexts = await headFileTokens(
    headFileSources(files, [...graph.symbols, ...drawer.filter((f) => f.side === 'head')], readHead),
    semantic === undefined ? {} : { semantic },
  );
  const baseSources = drawer.flatMap((f) => {
    const before = f.side === 'base' ? files.find((c) => c.path === f.path)?.before : undefined;
    return typeof before === 'string' ? [{ path: f.path, text: before }] : [];
  });
  // headFileTokens は semantic.head を見るので、base の意味トークンを head の欄に置いて渡す
  const baseFiles = baseSources.length === 0 ? [] : await headFileTokens(baseSources, semantic === undefined ? {} : { semantic: { ...semantic, head: semantic.base } });

  // 作者の説明（3.1）のコードブロックの色。web は Shiki を持たないのでここで付ける
  const bodyCode = await bodyCodeTokens(opts.body ?? '');

  // チケット（5.1）。取れなくても止めず、理由を残して知らせる。取れたら 2 回目と同時に要求を抜き出す（10.8）
  const { ticket, search, info: ticketInfo, warnings: ticketWarnings } = await ticketing;
  const warnings = [...(warning === undefined ? [] : [warning]), ...ticketWarnings];
  info.push(...ticketInfo);

  // Stage 2 / 3（10 章）
  const prev = findPrevious(repo, key, refs.headSha, pr.head);
  const previous = prev === undefined ? undefined : previousFrom(prev, tokenized);
  const input = buildLlmInput({
    hunks: tokenized,
    groups: ripples.groups,
    candidateIds: ripples.candidateIds,
    pr: { title: pr.title, body: opts.body ?? '' },
    layers: layering.rules,
    ...(lspResult?.callGraph === undefined ? {} : { edges: graph.edges }),
    ...(previous === undefined ? {} : { previous }),
  });
  if (mode !== 'off') opts.progress?.('AI が変更を目的ごとに分けています');
  const labeled = await runLlm({ repo, key, headSha: refs.headSha, call: 'label' }, command, renderPrompt(input), mode, parseLlmOutput);
  const llm = runOf(labeled);
  let hunks = tokenized;
  let symbols = graph.symbols;
  let hows: Analysis['hows'] = [];
  let claims: Analysis['claims'] = [];
  let summary: Analysis['summary'] = {};
  if (labeled.status === 'ok') {
    info.push(labeled.reused ? `LLM: ${labeled.command}（.ondina/${key}/llm/${refs.headSha}.json を再利用）` : `LLM: ${labeled.command}`);
    const verified = applyLlmOutput(tokenized, ripples.groups, input, labeled.output);
    ({ hunks, hows, claims } = verified);
    info.push(...verified.info);
    // 層の推定（10.2）。実在する層で、glob に当たらなかったパスのものだけ採る
    const guesses = verifyLayerGuesses(labeled.output.layerGuesses, { layers: layering.rules, unlayeredPaths: input.unlayeredPaths ?? [] });
    info.push(...guesses.info);
    if (guesses.kept.length > 0) {
      symbols = applyLayerGuesses(symbols, guesses.kept);
      info.push(`層の推定を ${guesses.kept.length} 件使います（地図では点線で表示します）`);
    }
  } else {
    info.push(`LLM で目的ごとに分けませんでした: ${labeled.reason}`);
  }

  // 読む順番（3.3 のコース）はプログラムが組む（10.3）。2 回目の LLM はその後で、コースの変わること・確かめること・この場所と入口の説明を書く。
  // 要求の抜き出し（10.8）は How が決まれば呼べるので、2 回目と同時に走らせる（待ち時間を足さない）
  // 案件（親チケット・同じ案件の PR）は 1 回目の間に調べ終えている。親の本文は要求の抜き出しに渡す
  const { project, info: projectInfo, warnings: projectWarnings } = (await projecting) ?? { info: [], warnings: [] };
  info.push(...projectInfo);
  warnings.push(...projectWarnings);
  let tours = buildTours({ hows, hunks, symbols, edges: graph.edges, layers: layering.bands });
  // 動き（3.3）。呼ぶ順と呼び出しの式はプログラムが組み、2 回目の LLM が題を付けて見せる順に並べる
  let behaviors = await attachCalls(buildBehaviors({ symbols, edges: graph.edges, hunks, layers: layering.bands }), {
    symbols,
    readHead: (rel) => files.find((f) => f.path === rel)?.after ?? readHead(rel),
  });
  // 処理の流れ（3.3。2026-11-05）。変わる前と後の呼び出しの線を合わせた木。題は 2 回目の LLM が付ける（動きの代わりに入力に入れる）
  let flows = await attachFlowCalls(buildFlows({ symbols, edges: graph.edges, edgesBase: baseGraph?.edges ?? [], hunks, layers: layering.bands }), {
    symbols,
    readHead: (rel) => files.find((f) => f.path === rel)?.after ?? readHead(rel),
    readBase: (rel) => files.find((f) => f.path === rel)?.before ?? readBase(rel),
  });
  let llmText: LlmRun | undefined;
  let specs: Spec[] = [];
  let why: string[] = [];
  let parentWhy: string[] = [];
  let background: NonNullable<Analysis['background']> = {};
  let llmSpecs: LlmRun | undefined;
  if (labeled.status === 'ok') {
    opts.progress?.('AI が案内文を書いています');
    const narrationInput = buildNarrationInput({ base: input, hows, hunks, symbols, edges: graph.edges, tours, removed: await removedDeclarations(files), flows });
    const prompt = renderNarrationPrompt(narrationInput);
    const extracting = ticket === undefined || ticket.error !== undefined ? undefined : specsFor({ repo, key, command, mode, base: input, hows, hunks, ticket, parent: project?.parent, prev });
    const [narrated, extracted] = await Promise.all([runLlm({ repo, key, headSha: refs.headSha, call: 'text' }, command, prompt, mode, parseNarrationOutput), extracting]);
    llmText = runOf(narrated);
    if (narrated.status === 'ok') {
      info.push(narrated.reused ? `LLM（案内文）: ${narrated.command}（.ondina/${key}/llm/${refs.headSha}.text.json を再利用）` : `LLM（案内文）: ${narrated.command}`);
      const applied = applyNarration(tours, narrated.output, hunks, narrationInput.existing);
      ({ tours, summary } = applied);
      background = applied.background;
      info.push(...applied.info);
      const titled = applyFlowTitles(flows, narrated.output.behaviors);
      flows = titled.flows;
      info.push(...titled.info);
      behaviors = copyFlowTitles(behaviors, flows);
    } else {
      info.push(`案内文を書けませんでした: ${narrated.reason}`);
    }
    if (extracted !== undefined) {
      ({ specs, hows, why, parentWhy } = extracted);
      llmSpecs = extracted.run;
      info.push(...extracted.info);
    }
  }

  // 入口の地図のまとまり（3.3）。箱をコースで分ける。コースが 8 つ以上なら 1 回目の LLM の題でまとめる
  const grouped = buildMapGroups({ hunks, hows, tours, ...(labeled.status === 'ok' ? { themes: labeled.output.themes } : {}) });
  info.push(...grouped.info);

  const analysis: Analysis = {
    pr: { ...pr, baseSha: refs.baseSha, headSha: refs.headSha, body: opts.body ?? '', ...(bodyCode.length === 0 ? {} : { bodyCode }), ...(ticket === undefined ? {} : { ticket }), ...(search === undefined ? {} : { ticketSearch: search }) },
    hunks,
    hows,
    symbols,
    edges: graph.edges,
    ...(baseGraph === undefined ? {} : { edgesBase: baseGraph.edges }),
    tours,
    specs,
    claims,
    summary,
    ...(why.length === 0 && project === undefined && Object.keys(background).length === 0
      ? {}
      : { background: { ...(why.length === 0 ? {} : { why }), ...(project === undefined ? {} : { project: withWhy(project, parentWhy) }), ...background } }),
    config: analysisConfig,
    llm,
    ...(llmText === undefined ? {} : { llmText }),
    ...(llmSpecs === undefined ? {} : { llmSpecs }),
    ...(lsp === undefined ? {} : { lsp }),
    ...(layering.structure === undefined ? {} : { structure: tests.provenance === 'llm' && layering.tests !== undefined ? { ...layering.structure, tests: [...layering.tests] } : layering.structure }),
    files: fileTexts,
    ...(baseFiles.length === 0 ? {} : { baseFiles }),
    ...(defs === undefined ? {} : { defs }),
    // local は GitHub に送らず AI に返す（12 章）。GitHub の行の決まりが無いので塊を持たない（画面はどの行にもメモを書ける）
    ...(key === 'local' ? {} : { githubDiff: githubDiff(repo, refs) }),
    mapGroups: grouped.mapGroups,
    behaviors,
    flows,
  };
  mkdirSync(dir, { recursive: true });
  const cachePath = path.join(dir, `${refs.headSha}.json`);
  writeFileSync(cachePath, JSON.stringify(analysis, null, 2) + '\n');
  return { analysis, cachePath, warnings, info };
}

const TICKET_SOURCE: Record<Ticket['source'], string> = { jira: 'Jira', command: 'コマンド', file: 'ファイル' };

interface Specing {
  specs: Spec[];
  /** チケットの原文にある「なぜ」の文（説明タブの背景。失敗したら空） */
  why: string[];
  /** 親チケットの原文にある「この案件の目的」の文（失敗したら空） */
  parentWhy: string[];
  /** specIds を埋めた How（失敗したら元のまま） */
  hows: How[];
  run: LlmRun;
  info: string[];
}

/**
 * 要求の抜き出し（10.8）。取れたチケットと 1 回目の How から。前回の解析が同じチケットなら、その要求を previous に渡す（原則 7）。
 * 保存の鍵は previous を除いたプロンプトの sha1。同じ差分・同じ How・同じチケットなら、前回の解析が変わっても同じ答えを使う
 * （古い headSha を解析し直しても同じ要求。headSha でなく鍵で引くのは、チケットが headSha と関係なく変わるから）
 */
async function specsFor(a: { repo: string; key: string; command: string; mode: 'auto' | 'off' | 'relabel'; base: LlmInput; hows: How[]; hunks: readonly Hunk[]; ticket: Ticket; parent: ParentTicket | undefined; prev: Analysis | undefined }): Promise<Specing> {
  const same = a.prev?.pr.ticket !== undefined && ticketName(a.prev.pr.ticket) === ticketName(a.ticket);
  const input = buildSpecInput({ base: a.base, hows: a.hows, hunks: a.hunks, ticket: a.ticket, ...(a.parent === undefined ? {} : { parent: a.parent }), ...(same ? { previous: a.prev!.specs } : {}) });
  const identity = renderSpecPrompt(withoutPrevious(input));
  const sha = createHash('sha1').update(identity).digest('hex');
  const ran = await runLlm({ repo: a.repo, key: a.key, headSha: sha, call: 'spec' }, a.command, renderSpecPrompt(input), a.mode, parseSpecOutput, identity);
  const cut = [
    ...(input.ticket.truncated ? [`チケットの本文が長いので、先頭の ${input.ticket.body.length} 字だけを LLM に渡しました`] : []),
    ...(input.parent?.truncated ? [`親チケットの本文が長いので、先頭の ${input.parent.body.length} 字だけを LLM に渡しました`] : []),
  ];
  if (ran.status !== 'ok') return { specs: [], why: [], parentWhy: [], hows: a.hows, run: runOf(ran), info: [...cut, `要求を抜き出せませんでした: ${ran.reason}`] };
  const head = ran.reused ? `LLM（要求の抜き出し）: ${ran.command}（.ondina/${a.key}/llm/${sha}.spec.json を再利用）` : `LLM（要求の抜き出し）: ${ran.command}`;
  const applied = applySpecs(a.hows, ran.output, input.ticket.body, input.parent?.body);
  return { specs: applied.specs, why: applied.why, parentWhy: applied.parentWhy, hows: applied.hows, run: runOf(ran), info: [head, ...cut, ...applied.info] };
}

/**
 * どんな案件の一部か（project.ts）。知らせは 1 行の要約（stderr）、取れなかった物は警告。
 * 思いがけない失敗も解析を止めず、画面に出す理由にする
 */
async function projectFor(repo: string, pr: Pick<Analysis['pr'], 'number' | 'head'>, ticket: Ticket, opts: AnalyzeOptions): Promise<{ project?: Project; info: string[]; warnings: string[] }> {
  const deps = { cwd: opts.ticket?.cwd ?? repo, env: opts.ticket?.env ?? process.env };
  const project = await fetchProject(ticket, { repo, pr: { number: pr.number, head: pr.head }, settings: opts.ticket?.settings, deps, run: opts.runGhAsync ?? runGhAsync }).catch(
    (e: unknown): Project => ({ errors: [`どんな案件の一部かを調べられませんでした: ${e instanceof Error ? e.message : String(e)}`] }),
  );
  if (project === undefined) return { info: [], warnings: [] };
  const p = project.parent;
  const head = p === undefined ? [] : [`案件: 親チケット ${p.key}${p.title === undefined ? '' : ` ${p.title}`}${project.prs === undefined ? '' : `、同じ案件の PR ${project.prs.length} 件（番号 ${project.searched?.length ?? 0} 個で検索）`}`];
  const skipped = project.skipped === undefined ? [] : [`同じ親の下のチケットが多いので、${project.searched?.length ?? 0} 個の番号だけで PR を探しました（残り ${project.skipped} 個）`];
  return { project, info: [...head, ...skipped], warnings: project.errors ?? [] };
}

/** 親の目的の文を parent の次に入れる（Project の欄の順） */
function withWhy(project: Project, why: string[]): Project {
  const { parent, ...rest } = project;
  return { ...(parent === undefined ? {} : { parent }), ...(why.length === 0 ? {} : { why }), ...rest };
}

const ticketName = (t: Ticket): string => t.key ?? t.ref;

/** 保存の鍵にする入力（previous を除く） */
function withoutPrevious(input: SpecInput): SpecInput {
  const rest = { ...input };
  delete rest.previous;
  return rest;
}

interface Ticketing {
  ticket?: Ticket;
  /** --ticket が無いときに探した記録 */
  search?: TicketSearch;
  info: string[];
  warnings: string[];
}

/**
 * --ticket があればそれを取る。無ければ題・ブランチ名・本文から候補を拾い（core）、LLM に選ばせて取る（10.7）。
 * 選ぶ答えはプロンプトの sha1 で保存し、題・ブランチ名・本文が同じなら headSha が変わっても使い回す（原則 7）
 */
async function ticketFor(repo: string, key: string, src: TicketSource, opts: AnalyzeOptions['ticket'], command: string, mode: 'auto' | 'off' | 'relabel'): Promise<Ticketing> {
  const deps = { cwd: opts?.cwd ?? repo, env: opts?.env ?? process.env };
  if (opts?.ref !== undefined) return fetched(await fetchTicket(opts.ref, opts.settings, deps));
  const { candidates, more } = findTicketCandidates(src);
  const search: TicketSearch = { candidates };
  // 候補が無ければ LLM を呼ばない。標準エラーにも出さない（画面の「仕様」欄で分かる）
  if (candidates.length === 0) return { search, info: [], warnings: [] };
  const info = more === 0 ? [] : [`チケットの候補が多いので、先頭の ${TICKET_CANDIDATE_LIMIT} 件だけを LLM に渡しました（残り ${more} 件）`];
  const n = `候補 ${candidates.length} 件`;
  const prompt = renderTicketPrompt(buildTicketInput(src, candidates));
  const sha = createHash('sha1').update(prompt).digest('hex');
  const ran = await runLlm({ repo, key, headSha: sha, call: 'ticket' }, command, prompt, mode, parseTicketOutput);
  search.llm = runOf(ran);
  if (ran.status !== 'ok') return { search, info: [...info, `チケットを選んでいません（${n}）: ${ran.reason}`], warnings: [] };
  info.push(ran.reused ? `LLM（チケット選び）: ${ran.command}（.ondina/${key}/llm/${sha}.ticket.json を再利用）` : `LLM（チケット選び）: ${ran.command}`);
  const { chosen, info: dropped } = verifyTicketChoice(ran.output, candidates);
  if (chosen === undefined) {
    info.push(dropped ?? `チケットは見つかりませんでした（${n}のどれも、LLM がこの PR のチケットではないと答えました）`);
    return { search, info, warnings: [] };
  }
  search.chosen = chosen.ref;
  const got = fetched(await fetchTicket(chosen.ref, opts?.settings, deps), `${n}から LLM が選んだ推定`);
  return { ...got, search, info: [...info, ...got.info] };
}

/** 取ったチケットを知らせる 1 行。取れなければ warnings に理由 */
function fetched(ticket: Ticket, note?: string): Ticketing {
  if (ticket.error !== undefined) return { ticket, info: [], warnings: [`チケット ${ticket.key ?? ticket.ref} を取得できませんでした: ${ticket.error}`] };
  return { ticket, info: [`チケット: ${ticket.key ?? ticket.ref}${ticket.title === undefined ? '' : ` ${ticket.title}`}（${TICKET_SOURCE[ticket.source]}${note === undefined ? '' : `。${note}`}）`], warnings: [] };
}

type Ran<T> = { command: string; status: 'ok'; reused: boolean; output: T } | { command: string; status: 'skipped' | 'failed'; reason: string };
type Parse<T> = (stdout: string) => { output: T } | { error: string };

const runOf = (r: Ran<unknown>): LlmRun => (r.status === 'ok' ? { command: r.command, status: 'ok' } : { command: r.command, status: r.status, reason: r.reason });

/**
 * 保存した出力があればそれを、無ければコマンドを起動して stdout を読む。成功したときだけ保存する（失敗は次回やり直す）。
 * 2 回目（text）・チケット選び（ticket）・要求の抜き出し（spec）はプロンプトの sha1 を保存に残し、今のプロンプトと違えば保存を使わない
 * （1 回目の結果が変わると 2 回目の入力も変わる）。identity は照合に使う文字列（既定はプロンプト。spec は previous を除いたプロンプト）
 */
async function runLlm<T>(at: { repo: string; key: string; headSha: string; call: LlmCall }, command: string, prompt: string, mode: 'auto' | 'off' | 'relabel', parse: Parse<T>, identity = prompt): Promise<Ran<T>> {
  if (mode === 'off') return { command, status: 'skipped', reason: '--no-llm' };
  const promptSha1 = at.call === 'label' ? undefined : createHash('sha1').update(identity).digest('hex');
  const cached = mode === 'auto' ? readLlmCache(at.repo, at.key, at.headSha, at.call) : undefined;
  if (cached !== undefined && cached.promptSha1 === promptSha1) {
    const parsed = parse(cached.stdout);
    if ('output' in parsed) return { command: cached.command, status: 'ok', reused: true, output: parsed.output };
    // 保存した出力が読めない（形が変わった等）ときは起動し直す
  }
  const run = await runLlmCommand(command, prompt, at.repo);
  if (run.timedOut) return { command, status: 'failed', reason: `時間切れ（${Math.round(run.stdout.length / 1024)} KB 受信）` };
  if (run.exitCode !== 0) return { command, status: 'failed', reason: `終了コード ${run.exitCode ?? 'なし'}: ${run.stderr.trim().slice(0, 200) || '（stderr なし）'}` };
  const parsed = parse(run.stdout);
  if ('error' in parsed) return { command, status: 'failed', reason: parsed.error };
  writeLlmCache(at.repo, at.key, at.headSha, { command, stdout: run.stdout, stderr: run.stderr, recordedAt: new Date().toISOString(), ...(promptSha1 === undefined ? {} : { promptSha1 }) }, at.call);
  return { command, status: 'ok', reused: false, output: parsed.output };
}

interface Layering {
  /** 層の割当の規則（上から最初に当たったもの） */
  rules: LayerRule[];
  provenance: 'config' | 'llm';
  /** 帯の並び（コースの始点と枝の順に使う） */
  bands: Array<{ name: string }>;
  /** 構成の推定の記録。設定の layers を使ったときは無い */
  structure?: StructureRun;
  /** 構成の推定のテストの置き場（5.2 の 7）。設定の layers を使ったとき・推定が無いとき・古い保存では無い */
  tests?: string[];
  info: string[];
}

/**
 * 層の規則を決める（5.2 の 4 / 10.6）。設定の layers があればそれ（推定しない）。
 * 無ければ保存した構成を使い、保存が無ければ（そのリポジトリで初めての analyze）推定して保存する。
 * 推定は LLM を呼ぶので --no-llm では走らせない。失敗したら保存せず、次の analyze でやり直す
 */
async function layeringFor(repo: string, layers: readonly LayerRule[], headSha: string, command: string, mode: 'auto' | 'off' | 'relabel', needTests: boolean, progress?: (line: string) => void): Promise<Layering> {
  if (layers.length > 0) return { rules: [...layers], provenance: 'config', bands: [...layers], info: [] };
  const none = (structure: StructureRun, line: string): Layering => ({ rules: [], provenance: 'llm', bands: [], structure, info: [line] });
  const layerNames = (s: SavedStructure) => `層 ${s.layers.length}（${s.layers.map((l) => l.name).join(' / ')}）`;
  // 2026-10-12 より前の保存にはテストの置き場が無い。設定にも無ければテストを見分けられない
  const stale = (s: SavedStructure) => s.tests === undefined && needTests;
  let saved = readStructure(repo);
  const info: string[] = [];
  if (saved === undefined) {
    if (mode === 'off') return none({ status: 'skipped', reason: '--no-llm' }, '構成の推定をスキップしました: --no-llm');
    progress?.('AI がリポジトリの構成を推定しています');
    const inferred = await inferStructure(repo, headSha, command);
    if ('error' in inferred) return none({ status: 'failed', command, reason: inferred.error }, `構成を推定できませんでした: ${inferred.error}`);
    saved = inferred.saved;
    info.push(`構成を推定しました: ${layerNames(saved)}`, ...inferred.info);
  } else if (stale(saved) && mode !== 'off') {
    // 前回の層の名前を引き継いで推定し直す（原則 7）。失敗したら前の推定のまま（層は付く。テストは見分けない）
    progress?.('AI がリポジトリの構成を推定しています');
    const inferred = await inferStructure(repo, headSha, command, undefined, saved.layers.map((l) => l.name));
    if ('error' in inferred) info.push(`構成を推定し直せませんでした: ${inferred.error}。テストの置き場のない前の推定を使います`);
    else {
      saved = inferred.saved;
      info.push(`構成の推定にテストの置き場がないので推定し直しました: ${layerNames(saved)}`, ...inferred.info);
    }
  } else {
    info.push(`構成: ${STRUCTURE_FILE} を使いました（${inferredDate(saved.at)} に推定、層 ${saved.layers.length}）`);
    if (stale(saved)) info.push('構成の推定にテストの置き場がありません。LLM を使って analyze するか ondina structure で推定し直すと、テストを見分けます');
  }
  const { rules, run } = applyStructure(saved, listTrackedFiles(repo, headSha));
  const u = run.unclassified!;
  if (u.warn) info.push(`構成に分類できないファイルが ${u.count} 件増えました（${inferredDate(saved.at)} の推定以降）。ondina structure で推定し直せます`);
  return { rules, provenance: 'llm', bands: saved.layers, structure: run, ...(saved.tests === undefined ? {} : { tests: saved.tests }), info };
}

/** その言語の LSP に見せるファイルか。fixture の .sql のように対象外の拡張子は開かない */
const LSP_EXTENSIONS: Readonly<Record<string, string>> = { kotlin: '.kt' };

/**
 * yaml の lsp.<language> を見て言語サーバーで意味トークンと辺を取る（9.1 / 7.2）。設定が無ければ起こさずに理由を残す。
 * serve が動いていれば serve の起動したままの言語サーバーに頼み、動いていない・古い serve なら自分で起動して閉じる
 */
/** 言語サーバーの答えに出てくるファイル（呼び出しの両端・参照の位置・宣言の範囲） */
function callGraphPaths(src: CallGraphSource | undefined): string[] {
  if (src === undefined) return [];
  return [...src.calls.flatMap((c) => [c.from.path, c.to.path]), ...Object.values(src.refs).flatMap((r) => r.map((x) => x.path)), ...Object.keys(src.ranges)];
}

async function lspRun(
  repo: string,
  config: Analysis['config'],
  hunks: Analysis['hunks'],
  files: readonly ChangedFile[],
  refs: RefPair,
  tests: LspJobRequest['tests'],
  opts: Pick<AnalyzeOptions, 'lspEnv' | 'lspWaitReportMs' | 'progress' | 'worktreeRoot'>,
): Promise<{ run: LspRun; reused: boolean; result?: { semantic: SemanticSource; callGraph: CallGraphSource; callGraphBase?: CallGraphSource; definitions?: DefinitionSource } }> {
  const language = config.language ?? 'kotlin';
  // yaml に無ければ言語ごとの既定の起こし方（kotlin だけ）。コマンドは環境変数か、kotlin-lsp の置き場から取る
  const conf = config.lsp[language] ?? defaultLspConfig(language);
  if (conf === undefined) {
    return { run: { command: '', status: 'unavailable', reason: `ondina.config.yaml に lsp.${language} がありません` }, reused: false };
  }
  const installed = language === 'kotlin' ? installedLspCommand(process.env, os.homedir()) : undefined;
  const command = resolveLspCommand({ env: process.env['ONDINA_LSP_COMMAND'], yaml: conf.command, installed });
  if (command === '') {
    const reason = `kotlin-lsp が見つかりません。ondina update で入れるか、環境変数 ONDINA_LSP_COMMAND に kotlin-lsp の bin/intellij-server を指定してください（探した場所: ${lspInstallPath(process.env, os.homedir())}）`;
    return { run: { command: '', status: 'unavailable', reason }, reused: false };
  }
  const ext = LSP_EXTENSIONS[language] ?? '';
  const req: LspJobRequest = {
    language,
    command,
    args: conf.args,
    readyTimeoutSec: conf.readyTimeoutSec,
    rule: conf.importNotification ?? KOTLIN_IMPORT_NOTIFICATION,
    root: lspWorktreeRoot(repo, opts.worktreeRoot),
    cacheDir: lspCacheDir(repo),
    shas: { base: refs.baseSha, head: refs.headSha },
    sides: {
      head: files.filter((f) => f.path.endsWith(ext) && f.after !== null).map((f) => f.path),
      base: files.filter((f) => f.path.endsWith(ext) && f.before !== null).map((f) => f.path),
    },
    changed: files.map((f) => f.path),
    targets: chooseProbeTargets(hunks),
    hunks: [...hunks],
    tests,
    ...(opts.lspEnv === undefined ? {} : { env: opts.lspEnv }),
    ...(opts.lspWaitReportMs === undefined ? {} : { waitReportMs: opts.lspWaitReportMs }),
  };
  const progress = (line: string): void => opts.progress?.(line);
  const url = await findServe(repo);
  if (url !== undefined) {
    const r = await requestServeLsp(url, req, progress);
    if (!('error' in r)) return r;
    progress(`${r.error}。言語サーバーを自分で起動します`);
  }
  const holder = createLspHolder(repo);
  try {
    return await holder.job(toJobArgs(req, progress));
  } finally {
    await holder.close();
  }
}
