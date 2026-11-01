#!/usr/bin/env node
// テスト用の偽 LSP。本物の kotlin-lsp はテストで一切起動しない（展開後 1.1 GB・冷えた起動は 59 秒なので）。
// 実機で採った通知の順番をそのまま真似る: begin(Importing) → importLog → begin(Indexing) → end ×2。
//
// FAKE_LSP_MODE:
//   ok      (既定) 取り込み成功 → 辺を 1 本返す
//   failed  importLog で failed: true。$/progress は正常に end する（実機と同じ）
//   empty   取り込みは成功するが callHierarchy が空のまま（時間切れの道を通す）
//   silent  何も通知せず、何にも答えない（initialize の時間切れ）
//   crash   initialize に答えてすぐ死ぬ
//   expired 何も読まずに stderr へ期限切れの文を出して exit 7（2026-10-09 に kotlin-lsp 263.4702.0 で実際に出た文）
//   stuck   Importing を始めて取り込みの記録を 1 行出したきり、何も知らせない（Gradle が止まった）
//   slow    Indexing の割合を FAKE_LSP_STEPS 回（既定 12）知らせてから終わる（大きなリポジトリの冷えた起動）。そのあとは ok と同じ
//   quietlog Importing を始めたあと知らせは送らず、FAKE_LSP_LOG に [IMPORT PROGRESS] の行を FAKE_LSP_STEPS 回書いてから終わる
//           （Gradle の設定の段階。本物は細かい進みをログにだけ書く。2026-10-10 実測）。そのあとは ok と同じ
// FAKE_LSP_DELAY_MS: 通知と通知のあいだ（既定 10）
// FAKE_LSP_LOG: 自分のログの場所。あれば initialize の直後に window/logMessage で「Log file: <場所>」を言う（本物と同じ）
// FAKE_LSP_SPAWNS: 言語サーバーの本体として起動するたびに pid を 1 行足すファイル（起動したまま使い回したかを数える。設計書 9.1）。
//   プロジェクト構造を書き出すための起動（--system-path が …/lsp/export）は数えない。それは FAKE_LSP_IMPORTS で見る
// FAKE_LSP_IMPORTS: 取り込むたびにフォルダごとに「gradle <フォルダ>」か「json <フォルダ>」、書き出すたびに「export <フォルダ>」を 1 行足すファイル。
//   本物と同じく、workspace.json があり Gradle のファイルが無いフォルダは JSON で取り込む（2026-10-19 実測）
// FAKE_LSP_NO_EXPORT: exportWorkspace を持たない（古い kotlin-lsp）
// FAKE_LSP_JSON_FAIL: JSON での取り込みを失敗させる
// FAKE_LSP_LIB: 書き出すプロジェクト構造に入れるライブラリの jar の絶対パス
// FAKE_LSP_NOTES: 受け取った通知を 1 行ずつ足すファイル（didChangeWatchedFiles は変わったファイルの数も）
// FAKE_LSP_EXIT_ON: この通知を受け取ったら exit 3（起動したままの言語サーバーが途中で死ぬ）
// FAKE_LSP_DEF_DIR: definition がファイルでなくフォルダを指す（パッケージの名前）
// FAKE_LSP_CALLER: incomingCalls で、差分の無いファイル domain/OrderRepository.kt からの呼び出しを 1 本返す
import { Buffer } from 'node:buffer';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mode = process.env.FAKE_LSP_MODE ?? 'ok';
const exporting = process.argv.some((a) => a.endsWith('/lsp/export'));
if (process.env.FAKE_LSP_SPAWNS && !exporting) appendFileSync(process.env.FAKE_LSP_SPAWNS, `${process.pid}\n`);
const imports = (line) => {
  if (process.env.FAKE_LSP_IMPORTS) appendFileSync(process.env.FAKE_LSP_IMPORTS, `${line}\n`);
};
/** JSON で取り込んだフォルダがあるか（initialize で決まる） */
let jsonMode = false;
if (mode === 'expired') {
  process.stderr.write('IJ_JAVA_OPTIONS=\nidea.config.path=/tmp/x/config\nLog file: /tmp/x/log/intellij-server.log\nThis build of kotlin-server has expired.\nThe IDE will now close.\nPlease download a new build from https://github.com/kotlin/kotlin-lsp\n');
  process.exit(7);
}
const delay = Number(process.env.FAKE_LSP_DELAY_MS ?? '10');
const sleep = (n) => new Promise((r) => setTimeout(r, n));

const send = (msg) => {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
};

const SEP = Buffer.from('\r\n\r\n');
let buf = Buffer.alloc(0);
process.stdin.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  for (;;) {
    const sep = buf.indexOf(SEP);
    if (sep === -1) return;
    const len = Number(/Content-Length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString('ascii'))[1]);
    if (buf.length < sep + 4 + len) return;
    const msg = JSON.parse(buf.subarray(sep + 4, sep + 4 + len).toString('utf8'));
    buf = buf.subarray(sep + 4 + len);
    handle(msg);
  }
});

/** 本物の kotlin-lsp 263.4702.0 が initialize の応答で返す legend（2026-09-21 実測） */
const LEGEND = {
  tokenTypes: [
    'namespace', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'type', 'parameter',
    'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword',
    'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator',
  ],
  tokenModifiers: [
    'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async',
    'modification', 'documentation', 'defaultLibrary',
  ],
};

function handle(msg) {
  if (mode === 'silent') return;
  if (msg.id === undefined && msg.method !== undefined) {
    const notes = process.env.FAKE_LSP_NOTES;
    const n = msg.method === 'workspace/didChangeWatchedFiles' ? ` ${msg.params.changes.length}` : '';
    if (notes) appendFileSync(notes, `${msg.method}${n}\n`);
    if (msg.method === process.env.FAKE_LSP_EXIT_ON) process.exit(3);
  }
  if (msg.method === 'initialize') {
    const GRADLE_FILES = ['build.gradle.kts', 'build.gradle', 'settings.gradle.kts', 'settings.gradle'];
    for (const f of msg.params.workspaceFolders ?? []) {
      const dir = fileURLToPath(f.uri);
      const json = existsSync(path.join(dir, 'workspace.json')) && !GRADLE_FILES.some((n) => existsSync(path.join(dir, n)));
      if (json) jsonMode = true;
      imports(`${json ? 'json' : 'gradle'} ${dir}`);
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        capabilities: {
          callHierarchyProvider: true,
          documentSymbolProvider: true,
          // 本物の kotlin-lsp 263.4702.0 が返す legend（2026-09-21 実測）
          semanticTokensProvider: { legend: LEGEND, range: true, full: true },
          executeCommandProvider: { commands: process.env.FAKE_LSP_NO_EXPORT ? ['decompile'] : ['decompile', 'exportWorkspace'] },
        },
      },
    });
    if (mode === 'crash') process.exit(1);
    const logFile = process.env.FAKE_LSP_LOG;
    if (logFile) send({ jsonrpc: '2.0', method: 'window/logMessage', params: { type: 3, message: `Log file: ${logFile}` } });
    void progress();
    return;
  }
  if (msg.method === 'textDocument/semanticTokens/full') {
    // fixture の Order.kt に合わせた 2 組。3 行目の Order（class 宣言）と 4 行目の id（引数）
    const decl = 1 << LEGEND.tokenModifiers.indexOf('declaration');
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: { data: [2, 6, 5, LEGEND.tokenTypes.indexOf('class'), decl, 1, 8, 2, LEGEND.tokenTypes.indexOf('parameter'), decl] },
    });
    return;
  }
  if (msg.method === 'textDocument/documentSymbol') {
    send({ jsonrpc: '2.0', id: msg.id, result: documentSymbols(msg.params.textDocument.uri) });
    return;
  }
  if (msg.method === 'textDocument/prepareCallHierarchy') {
    const uri = msg.params.textDocument.uri;
    const at = declarationAt(uri, msg.params.position.line);
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result:
        mode === 'empty' || at === undefined
          ? []
          : [
              {
                // 本物は "Class.method(ArgTypes)"、detail はパッケージ（2026-09-22 実測）
                name: `${at.owner}.${at.name}(Order)`,
                detail: 'com.example.order.domain',
                kind: 6,
                uri,
                range: at.range,
                selectionRange: at.selectionRange,
              },
            ],
    });
    return;
  }
  if (msg.method === 'callHierarchy/outgoingCalls') {
    const to = {
      name: 'DiscountPolicy.rateFor(String)',
      detail: 'com.example.order.domain',
      kind: 6,
      uri: sibling(msg.params.item.uri, 'DiscountPolicy.kt'),
      range: { start: { line: 3, character: 4 }, end: { line: 5, character: 5 } },
      selectionRange: { start: { line: 3, character: 8 }, end: { line: 3, character: 15 } },
    };
    send({ jsonrpc: '2.0', id: msg.id, result: mode === 'empty' ? [] : [{ to, fromRanges: [] }] });
    return;
  }
  if (msg.method === 'callHierarchy/incomingCalls') {
    // FAKE_LSP_CALLER: 差分の無いファイル domain/OrderRepository.kt から呼ばれている
    const file = fileURLToPath(msg.params.item.uri);
    const caller = {
      name: 'OrderRepository.find(OrderId)',
      detail: 'com.example.order.domain',
      kind: 6,
      uri: pathToFileURL(`${file.slice(0, file.indexOf('/src/'))}/src/main/kotlin/com/example/order/domain/OrderRepository.kt`).href,
      range: { start: { line: 3, character: 4 }, end: { line: 3, character: 30 } },
      selectionRange: { start: { line: 3, character: 8 }, end: { line: 3, character: 12 } },
    };
    send({ jsonrpc: '2.0', id: msg.id, result: process.env.FAKE_LSP_CALLER && mode !== 'empty' ? [{ from: caller, fromRanges: [] }] : [] });
    return;
  }
  if (msg.method === 'textDocument/hover') {
    // 本物はコードフェンスの中にシグネチャを 1 行で返す（戻り型つき。2026-09-22 実測）
    send({ jsonrpc: '2.0', id: msg.id, result: { contents: { kind: 'markdown', value: '````kotlin\nfun rateFor(code: String): Rate\n````\n' } } });
    return;
  }
  if (msg.method === 'textDocument/definition') {
    // 意味トークンの 2 組に合わせる: 3 行目（0 始まり 2）はライブラリ、4 行目（3）は head なら domain/DiscountPolicy.kt の rateFor（差分の無いファイル）、
    // base なら domain/Order.kt の 1 行目の package の名前（PR で変わったファイルの、差分の列に無い行）
    const file = fileURLToPath(msg.params.textDocument.uri);
    const root = `${file.slice(0, file.indexOf('/src/'))}/src/main/kotlin/com/example/order/domain/`;
    const base = file.includes('/base/src/');
    const at = base ? { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } } : { start: { line: 8, character: 8 }, end: { line: 8, character: 15 } };
    // FAKE_LSP_DEF_DIR: 4 行目の名前はフォルダ（本物ではパッケージの名前がそうなる）
    const to = pathToFileURL(process.env.FAKE_LSP_DEF_DIR ? root.slice(0, -1) : root + (base ? 'Order.kt' : 'DiscountPolicy.kt')).href;
    const result =
      msg.params.position.line === 2 ? [{ uri: 'jar:///fake/caches/kotlin-stdlib-2.2.0.jar!/kotlin/Any.class', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } }] : [{ targetUri: to, targetRange: at, targetSelectionRange: at }];
    send({ jsonrpc: '2.0', id: msg.id, result });
    return;
  }
  if (msg.method === 'textDocument/references') {
    send({ jsonrpc: '2.0', id: msg.id, result: testReference(msg.params.textDocument.uri) });
    return;
  }
  if (msg.method === 'workspace/executeCommand') {
    if (msg.params.command !== 'exportWorkspace' || process.env.FAKE_LSP_NO_EXPORT) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Unknown command: ${msg.params.command}` } });
      return;
    }
    const dir = msg.params.arguments[0];
    imports(`export ${dir}`);
    writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify(exportedModel(dir), null, 4));
    send({ jsonrpc: '2.0', id: msg.id, result: null });
    return;
  }
  if (msg.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: msg.id, result: null });
    return;
  }
  if (msg.method === 'exit') process.exit(0);
}

/**
 * 実際のファイルを読んで宣言一覧を組む。本物の kotlin-lsp と同じ形
 * （階層形・name は識別子だけ・クラスは kind 5・関数は kind 6・selectionRange.start が宣言名の位置）。
 * 固定の名前を返すと、fixture のどの宣言が基準シンボルに選ばれるかで結果が変わってしまう。
 * 核 hunk はクラス全体になることがある（5.2 の 1 の格上げ）ので、クラスとその中の関数の親子関係まで真似る。
 */
function documentSymbols(uri) {
  let text;
  try {
    text = readFileSync(fileURLToPath(uri), 'utf8');
  } catch {
    return [];
  }
  const lines = text.split('\n');
  const out = [];
  let parent;
  lines.forEach((line, i) => {
    const node = (name, kind) => {
      const character = Math.max(line.indexOf(name), 0);
      return {
        name,
        kind,
        // 範囲は次の宣言の手前まで（本物は宣言の本体全体。中の行を含まないと参照を囲えない）
        range: { start: { line: i, character: 0 }, end: { line: lines.length - 1, character: 0 } },
        selectionRange: { start: { line: i, character }, end: { line: i, character: character + name.length } },
      };
    };
    const decl = /\b(?:class|object|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
    if (decl !== null) {
      parent = { ...node(decl[1], 5), children: [] };
      out.push(parent);
      return;
    }
    // 本物の documentSymbol はバッククォートを外した名前を返す（2026-09-22 実測）
    const fn = /\bfun\s+(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*))/.exec(line);
    if (fn === null) return;
    const f = node(fn[1] ?? fn[2], 6);
    if (parent === undefined) out.push(f);
    else parent.children.push(f);
  });
  // 関数の範囲は次の関数の手前で切る
  const fns = out.flatMap((s) => (s.kind === 6 ? [s] : (s.children ?? [])));
  fns.forEach((f, i) => {
    const next = fns[i + 1];
    if (next !== undefined) f.range.end = { line: Math.max(next.range.start.line - 1, f.range.start.line), character: 0 };
  });
  return out;
}

/** その行を含むいちばん内側の関数（prepareCallHierarchy が返すアイテムの素） */
function declarationAt(uri, line) {
  const symbols = documentSymbols(uri);
  for (const s of symbols) {
    for (const f of s.kind === 6 ? [s] : (s.children ?? [])) {
      if (line >= f.range.start.line && line <= f.range.end.line) return { owner: s.kind === 6 ? 'Top' : s.name, name: f.name, range: f.range, selectionRange: f.selectionRange };
    }
  }
  return undefined;
}

/** 同じディレクトリの別ファイルの uri */
function sibling(uri, name) {
  const file = fileURLToPath(uri);
  return pathToFileURL(file.slice(0, file.lastIndexOf('/') + 1) + name).href;
}

/**
 * src/main の宣言には、対応するテストファイルの最初のテスト関数の中から参照が 1 件あることにする。
 * 本物の references はテストからの参照を返す（2026-09-22 実測）。ファイルが無ければ 0 件
 */
function testReference(uri) {
  const file = fileURLToPath(uri);
  if (!file.includes('/src/main/kotlin/')) return [];
  const testFile = file.replace('/src/main/kotlin/', '/src/test/kotlin/').replace(/\.kt$/, 'Test.kt');
  let lines;
  try {
    lines = readFileSync(testFile, 'utf8').split('\n');
  } catch {
    return [];
  }
  const i = lines.findIndex((l) => /\bfun\s+`/.test(l));
  if (i === -1) return [];
  return [{ uri: pathToFileURL(testFile).href, range: { start: { line: i + 1, character: 8 }, end: { line: i + 1, character: 20 } } }];
}

/**
 * 本物の exportWorkspace が書く workspace.json の形（2026-10-19 に kotlin-lsp 263.6379.0 で採ったものを縮めた）。
 * 本物と同じく、ソースのフォルダは書き出す時点に在るものだけを入れる
 */
function exportedModel(dir) {
  const roots = (set, names, type) => names.filter((n) => existsSync(path.join(dir, 'src', set, n))).map((n) => ({ path: `<WORKSPACE>/src/${set}/${n}`, type }));
  const lib = process.env.FAKE_LSP_LIB;
  return {
    modules: [
      { name: 'order-service', dependencies: [{ type: 'moduleSource' }], contentRoots: [{ path: '<WORKSPACE>/' }], externalProjectPath: '<WORKSPACE>/' },
      { name: 'order-service.main', contentRoots: [{ path: '<WORKSPACE>/src/main', sourceRoots: roots('main', ['kotlin', 'java'], 'java-source') }] },
      { name: 'order-service.test', contentRoots: [{ path: '<WORKSPACE>/src/test', sourceRoots: roots('test', ['kotlin', 'java'], 'java-test') }] },
    ],
    libraries: lib === undefined ? [] : [{ name: 'Gradle: fake:lib:1.0', type: 'COMPILE', roots: [{ path: lib }] }],
    sdks: [],
    kotlinSettings: [],
    javaSettings: [],
    externalSystem: 'GRADLE',
  };
}

/** 本物の intellij-server.log の 1 行の形 */
const logLine = (msg) => `2026-10-10 00:46:30,370 [   1901]   INFO - #c.i.l.s.i.ImportExecutionKt - ${msg}\n`;

async function progress() {
  await sleep(delay);
  if (mode === 'stuck') {
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'imp', value: { kind: 'begin', title: 'Importing' } } });
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'imp', value: { kind: 'report', message: 'Gradle' } } });
    send({ jsonrpc: '2.0', method: 'intellij/importLog', params: { type: 4, message: 'Download https://repo.example.com/b/1.0/b-1.0.jar\n', failed: false, succeeded: false } });
    if (process.env.FAKE_LSP_LOG) appendFileSync(process.env.FAKE_LSP_LOG, logLine('[IMPORT PROGRESS]: Run build started'));
    return;
  }
  if (mode === 'quietlog') {
    const steps = Number(process.env.FAKE_LSP_STEPS ?? '8');
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'imp', value: { kind: 'begin', title: 'Importing' } } });
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'imp', value: { kind: 'report', message: 'Gradle' } } });
    for (let i = 1; i <= steps; i++) {
      await sleep(delay);
      appendFileSync(process.env.FAKE_LSP_LOG, logLine(`[IMPORT PROGRESS]: Resolve dependencies of :m${i}:compileClasspath started`));
    }
    send({ jsonrpc: '2.0', method: 'intellij/importLog', params: { type: 3, message: 'Workspace imported successfully', failed: false, succeeded: true } });
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'imp', value: { kind: 'end' } } });
    return;
  }
  if (mode === 'slow') {
    const steps = Number(process.env.FAKE_LSP_STEPS ?? '12');
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'imp', value: { kind: 'begin', title: 'Importing' } } });
    send({ jsonrpc: '2.0', method: 'intellij/importLog', params: { type: 3, message: 'Workspace imported successfully', failed: false, succeeded: true } });
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'idx', value: { kind: 'begin', title: 'Indexing' } } });
    for (let i = 1; i <= steps; i++) {
      await sleep(delay);
      const p = Math.round((i * 100) / steps);
      send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'idx', value: { kind: 'report', message: `${p}%`, percentage: p } } });
    }
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'idx', value: { kind: 'end' } } });
    send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'imp', value: { kind: 'end' } } });
    return;
  }
  send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'imp', value: { kind: 'begin', title: 'Importing' } } });
  await sleep(delay);
  // 実機と同じく、結末を言わないビルドログの行が先に流れる（無視されるはず）
  send({ jsonrpc: '2.0', method: 'intellij/importLog', params: { type: 2, message: '\tat org.gradle.Foo.bar(Foo.java:1)\n', failed: false, succeeded: false } });
  await sleep(delay);
  send(
    jsonMode && process.env.FAKE_LSP_JSON_FAIL
      ? { jsonrpc: '2.0', method: 'intellij/importLog', params: { type: 1, message: 'Error parsing workspace.json: boom', tool: 'Json', failed: true, succeeded: false } }
      : mode === 'failed'
        ? { jsonrpc: '2.0', method: 'intellij/importLog', params: { type: 1, message: 'Unable to import a Gradle project: boom', tool: 'Gradle', failed: true, succeeded: false } }
        : { jsonrpc: '2.0', method: 'intellij/importLog', params: { type: 3, message: 'Workspace imported successfully', failed: false, succeeded: true } },
  );
  await sleep(delay);
  send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'idx', value: { kind: 'begin', title: 'Indexing' } } });
  await sleep(delay);
  send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'idx', value: { kind: 'end' } } });
  send({ jsonrpc: '2.0', method: '$/progress', params: { token: 'imp', value: { kind: 'end' } } });
}
