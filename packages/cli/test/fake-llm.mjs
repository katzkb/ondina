// テスト用の偽 LLM コマンド。stdin のプロンプトから入力 JSON を取り出して返す。
// 1 回目（目的ごとに分ける）: 全部の hunk と束を 1 つの How に入れる。2 回目（文を書く。入力に courses がある）: 全部のコースと停留所と背景に文を書く。
// 本物の LLM コマンドはテストで一切起動しない（test/setup.ts が ONDINA_LLM_COMMAND をこれに向ける）。
// FAKE_LLM_MODE は 1 回目、FAKE_LLM_TEXT_MODE は 2 回目に効く: ok（既定）| fail（exit 2 と stderr）| garbage（JSON でない stdout）。
// FAKE_LLM_LOG: 起動のたびに 1 行追記する（1 回目は "label"、2 回目は "text"、案内人に聞くは "ask"、構成の推定は "structure"、チケット選びは "ticket"、要求の抜き出しは "spec"）
// 案内人に聞く（入力に question がある。設計書 10.5）は FAKE_LLM_ASK_MODE: ok（既定）| fail | garbage | slow（FAKE_LLM_PID に pid を書いて 10 秒待つ）
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const prompt = readFileSync(0, 'utf8');
const input = JSON.parse(prompt.slice(prompt.lastIndexOf('入力:\n') + '入力:\n'.length));
if (typeof input.question === 'string') {
  if (process.env.FAKE_LLM_LOG) appendFileSync(process.env.FAKE_LLM_LOG, 'ask\n');
  const mode = process.env.FAKE_LLM_ASK_MODE ?? 'ok';
  if (mode === 'fail') {
    process.stderr.write('boom: the guide is on strike\n');
    process.exit(2);
  }
  if (mode === 'garbage') {
    process.stdout.write('sorry, no json today\n');
    process.exit(0);
  }
  if (mode === 'slow') {
    if (process.env.FAKE_LLM_PID) writeFileSync(process.env.FAKE_LLM_PID, String(process.pid));
    await new Promise((r) => setTimeout(r, 10_000));
    process.exit(0);
  }
  // 材料の最初の番号付きの行（選んだ行があればその最初の行）を場所にした項目と、材料に無い場所の項目（検証で外れる）
  const p = input.place;
  const blocks = p.kind === 'pr' ? p.hunks : p.kind === 'course' ? p.stops : [...(p.selected ? [p.selected] : []), ...(p.file ? [{ path: p.path, lines: p.file }] : []), ...p.hunks];
  const hit = blocks.flatMap((b) => b.lines.map((l) => [b.path, /^([hb])(\d+) /.exec(l)])).find(([, m]) => m);
  const cite = hit ? { path: hit[0], side: hit[1][1] === 'h' ? 'head' : 'base', line: Number(hit[1][2]) } : undefined;
  const items = [{ text: '材料にある行', ...(cite ? { cite } : {}) }, { text: '材料に無い行', cite: { path: 'x/Nope.kt', side: 'head', line: 1 } }];
  process.stdout.write(JSON.stringify({ lead: `答え: ${input.question}`, items, tail: `前の問い ${input.history.length}` }) + '\n');
  process.exit(0);
}
// チケット選び（入力に candidates がある。設計書 10.7）は FAKE_LLM_TICKET_MODE: ok（既定。最初の候補）| none（null）| bogus（候補に無い id）| fail
if (Array.isArray(input.candidates)) {
  if (process.env.FAKE_LLM_LOG) appendFileSync(process.env.FAKE_LLM_LOG, 'ticket\n');
  const mode = process.env.FAKE_LLM_TICKET_MODE ?? 'ok';
  if (mode === 'fail') {
    process.stderr.write('boom: the ticket clerk is on strike\n');
    process.exit(2);
  }
  const choice = mode === 'none' ? null : mode === 'bogus' ? 'c9' : (input.candidates[0]?.id ?? null);
  process.stdout.write(JSON.stringify({ choice }) + '\n');
  process.exit(0);
}
// 要求の抜き出し（入力に ticket と hows がある。設計書 10.8）は FAKE_LLM_SPEC_MODE: ok（既定。要求 2 つ: 最初の How に対応する物と、対応の無い物。なぜの文 2 つ。親があれば親の文 2 つ）
// | fail | garbage | bogus（知らない How の番号 99 を足す）。FAKE_LLM_SPEC_INPUT: 受け取った入力 JSON をそのファイルに書く（previous を見る）
if (input.ticket !== undefined && Array.isArray(input.hows)) {
  if (process.env.FAKE_LLM_LOG) appendFileSync(process.env.FAKE_LLM_LOG, 'spec\n');
  if (process.env.FAKE_LLM_SPEC_INPUT) writeFileSync(process.env.FAKE_LLM_SPEC_INPUT, JSON.stringify(input));
  const mode = process.env.FAKE_LLM_SPEC_MODE ?? 'ok';
  if (mode === 'fail') {
    process.stderr.write('boom: the spec reader is on strike\n');
    process.exit(2);
  }
  if (mode === 'garbage') {
    process.stdout.write('sorry, no json today\n');
    process.exit(0);
  }
  const first = input.hows[0]?.id;
  const hows = [...(first === undefined ? [] : [first]), ...(mode === 'bogus' ? [99] : [])];
  // なぜ: チケットの背景の 1 文と、チケットに無い 1 文（検証で捨てる）。親チケットがあれば、親の目的の 1 文と親に無い 1 文
  const parentWhy = input.parent === undefined ? [] : ['4 月の 1 か月、割引コードを配って初めての注文を増やす。', '親に無い文。'];
  process.stdout.write(JSON.stringify({ specs: [{ text: '要求 1', hows }, { text: '要求 2', hows: [] }], why: ['春のキャンペーン（SHOP-400）で割引コードを配る。', 'チケットに無い文。'], parentWhy }) + '\n');
  process.exit(0);
}
// 構成の推定（入力に dirs がある。設計書 10.6）は FAKE_LLM_STRUCTURE_MODE: ok（既定）| fail | empty（層が 1 つも無い）。
// ok は src/main → Main、src/test → Test の 2 層にし（あるものだけ）、src/test をテストの置き場にする
if (Array.isArray(input.dirs)) {
  if (process.env.FAKE_LLM_LOG) appendFileSync(process.env.FAKE_LLM_LOG, 'structure\n');
  // FAKE_LLM_INPUT: 受け取った入力 JSON をそのファイルに書く（previous を渡したかを見る）
  if (process.env.FAKE_LLM_INPUT) writeFileSync(process.env.FAKE_LLM_INPUT, JSON.stringify(input));
  const mode = process.env.FAKE_LLM_STRUCTURE_MODE ?? 'ok';
  if (mode === 'fail') {
    process.stderr.write('boom: the cartographer is on strike\n');
    process.exit(2);
  }
  const has = (root) => input.dirs.some((d) => d.dir === root || d.dir.startsWith(`${root}/`));
  const pairs = mode === 'empty' ? [] : [['src/main', 'Main'], ['src/test', 'Test']].filter(([root]) => has(root));
  const tests = mode === 'empty' || !has('src/test') ? [] : ['src/test'];
  const out = { layers: pairs.map(([, name]) => ({ name, why: `${name} の層` })), dirs: pairs.map(([dir, layer]) => ({ dir, layer })), files: [], outside: [], tests };
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}
const text = Array.isArray(input.courses);
if (process.env.FAKE_LLM_LOG) appendFileSync(process.env.FAKE_LLM_LOG, `${text ? 'text' : 'label'}\n`);
const mode = (text ? process.env.FAKE_LLM_TEXT_MODE : process.env.FAKE_LLM_MODE) ?? 'ok';
if (mode === 'fail') {
  process.stderr.write('boom: the model is on strike\n');
  process.exit(2);
}
if (mode === 'garbage') {
  process.stdout.write('sorry, no json today\n');
  process.exit(0);
}
if (text) {
  // 入口の説明: 要点と、全部のコースを 1 つの箱に入れた図（例は書かない）
  const summary = { headline: '要点。', example: { text: '', at: [] }, flows: [{ nodes: [{ title: '箱', howIds: input.courses.map((c) => c.howId), symbolId: '', before: 'b。', after: 'c。', untouched: ['u'], pass: '' }] }] };
  // 確かめることは、行番号の付いた最初の停留所の最初の行を根拠にした 1 つ
  const firstLine = (id) => input.hunks.find((h) => h.id === id)?.lines.map((l) => /^\s*(\d+)\|/.exec(l)).find(Boolean)?.[1];
  const courses = input.courses.map((c) => {
    const at = c.stops.flatMap((st) => (firstLine(st.hunkId) === undefined ? [] : [{ symbolId: st.symbolId, lines: [Number(firstLine(st.hunkId))], say: '見る。' }])).slice(0, 1);
    return {
      howId: c.howId,
      change: { before: `前 ${c.howId}。`, after: `後 ${c.howId}。` },
      checks: at.length === 0 ? [] : [{ text: `確かめること ${c.howId}`, at }],
      stops: c.stops.map((st) => ({ symbolId: st.symbolId, role: `この場所 ${st.symbol}。` })),
    };
  });
  // 背景（2026-10-29）: 前からあるものは最初の候補と候補に無い名前（検証で捨てる）、言葉は差分の行の最初の識別子
  const code = input.hunks.flatMap((h) => h.lines).map((l) => /^\s*\d*\|.\W*([A-Za-z_]\w*)/.exec(l)?.[1]).find(Boolean) ?? '';
  const background = { existing: input.existing.slice(0, 1).map((e) => ({ symbols: [e.symbol, 'x.Nope'], text: '前からあるもの。' })), terms: [{ word: '言葉', code, meaning: '意味。' }] };
  process.stdout.write(JSON.stringify({ summary, background, courses }) + '\n');
  process.exit(0);
}
const prev = input.previous?.hows?.[0];
const hows = [{ id: prev?.id ?? 1, title: prev?.title ?? '全部を 1 つに', why: 'テスト用', hunkIds: input.hunks.map((h) => h.id), groupIds: input.rippleGroups.map((g) => g.id) }];
const first = input.pr.body.split('\n').find((l) => l.trim() !== '') ?? '';
const claims = input.pr.body === '' ? [] : [{ text: first, backed: true, reason: '' }, { text: '本文に無い文', backed: false, reason: '差分に無い' }];
const out = { hows, claims };
process.stdout.write('```json\n' + JSON.stringify(out) + '\n```\n');
