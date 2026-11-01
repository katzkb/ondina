// 要求の抜き出し（設計書 10.8）の出力の検証（Stage 3。5.4 の 7）。全部プログラムで決める（原則 3）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { How } from '@ondina/model';
import { parseSpecOutput } from '../src/spec/schema.js';
import { applySpecs, MAX_SPECS } from '../src/spec/verify.js';
import { FIXTURE_ROOT } from './fixture.js';

const hows: How[] = [
  { id: 1, title: 'A', why: 'W', specIds: [] },
  { id: 3, title: 'B', why: 'W', specIds: [] },
];

describe('applySpecs', () => {
  it('並び順に s1, s2 … を振り、How の specIds を逆に引いて埋める', () => {
    const r = applySpecs(hows, { why: [], parentWhy: [], specs: [{ text: '割引できる', hows: [3, 1] }, { text: '保存する', hows: [1] }, { text: '400 を返す', hows: [] }] }, '');
    expect(r.specs).toEqual([
      { id: 's1', text: '割引できる', hows: [1, 3] },
      { id: 's2', text: '保存する', hows: [1] },
      { id: 's3', text: '400 を返す', hows: [] },
    ]);
    expect(r.hows).toEqual([
      { id: 1, title: 'A', why: 'W', specIds: ['s1', 's2'] },
      { id: 3, title: 'B', why: 'W', specIds: ['s1'] },
    ]);
    expect(r.info).toEqual(['要求: 3 件（対応するコースがあるもの 2 件）']);
  });

  it('知らない How の番号は捨てて知らせる。同じ番号は 1 つにして昇順', () => {
    const r = applySpecs(hows, { why: [], parentWhy: [], specs: [{ text: 'a', hows: [9, 3, 3, 1] }] }, '');
    expect(r.specs[0]!.hows).toEqual([1, 3]);
    expect(r.info).toContain('要求 1 の対応に不明な How の番号（9）があったので除外しました');
  });

  it('文の前後の空白と末尾の句点を落とす。空の文は捨て、同じ文は最初だけ', () => {
    const r = applySpecs(hows, { why: [], parentWhy: [], specs: [{ text: '  割引できる。 ', hows: [1] }, { text: ' ', hows: [3] }, { text: '割引できる', hows: [3] }] }, '');
    expect(r.specs).toEqual([{ id: 's1', text: '割引できる', hows: [1] }]);
    expect(r.info).toEqual(expect.arrayContaining(['空の要求を除外しました', '同じ要求が 2 回来たので最初だけ使いました: 割引できる']));
  });

  it(`${MAX_SPECS + 1} 個目からは捨てて知らせる`, () => {
    const many = Array.from({ length: MAX_SPECS + 2 }, (_, i) => ({ text: `要求 ${i + 1}`, hows: [] }));
    const r = applySpecs(hows, { why: [], parentWhy: [], specs: many }, '');
    expect(r.specs).toHaveLength(MAX_SPECS);
    expect(r.info).toContain(`要求が ${MAX_SPECS} 個を超えたので、${MAX_SPECS + 1} 個目から除外しました（2 個）`);
  });

  it('要求が無ければ空で、How の specIds も空', () => {
    const r = applySpecs([{ ...hows[0]!, specIds: ['s9'] }], { why: [], parentWhy: [], specs: [] }, '');
    expect(r.specs).toEqual([]);
    expect(r.hows[0]!.specIds).toEqual([]);
    expect(r.info).toEqual(['要求: 0 件（対応するコースがあるもの 0 件）']);
  });
});

describe('applySpecs の「なぜ」（規則 5。2026-10-29）', () => {
  const body = '## 背景\n\n月末の棚卸しで、倉庫ごとの在庫が合わない。\n今は `Stock` が全倉庫の合計しか持たない。';
  const whyOf = (why: string[]) => applySpecs(hows, { specs: [], why, parentWhy: [] }, body);

  it('本文に含まれる文だけ残す。空白と Markdown の強調・コードの記号は無視して比べる', () => {
    const r = whyOf([' 月末の棚卸しで、倉庫ごとの在庫が合わない。 ', '今は Stock が全倉庫の合計しか持たない。', '倉庫ごとの在庫を持ちたい。']);
    expect(r.why).toEqual(['月末の棚卸しで、倉庫ごとの在庫が合わない。', '今は Stock が全倉庫の合計しか持たない。']);
    expect(r.info).toContain('チケットの本文にない「なぜ」の文を除外しました: 倉庫ごとの在庫を持ちたい。');
  });

  it('空の文・同じ文（空白と記号だけ違う物も）は捨て、3 個まで', () => {
    expect(whyOf(['', '月末の棚卸しで、', '月末の棚卸しで、']).why).toEqual(['月末の棚卸しで、']);
    expect(whyOf(['今は `Stock` が全倉庫の合計しか持たない。', '今は Stock が全倉庫の合計しか持たない。']).why).toEqual(['今は `Stock` が全倉庫の合計しか持たない。']);
    expect(whyOf(['月末', '棚卸し', '倉庫ごと', '在庫']).why).toEqual(['月末', '棚卸し', '倉庫ごと']);
  });
});

describe('applySpecs の親チケットの文（規則 6。2026-10-29）', () => {
  const ticket = '倉庫ごとに引き当てる。';
  const parent = '## 目的\n\n月末の棚卸しを 1 日で終える。\n\n## やること\n\n- 倉庫ごとの在庫（INV-12）';
  const of = (parentWhy: string[]) => applySpecs(hows, { specs: [], why: [], parentWhy }, ticket, parent);

  it('親チケットの本文に含まれる文だけ残す（このチケットの本文の文は残さない）', () => {
    const r = of([' 月末の棚卸しを 1 日で終える。 ', '倉庫ごとに引き当てる。']);
    expect(r.parentWhy).toEqual(['月末の棚卸しを 1 日で終える。']);
    expect(r.info).toContain('親チケットの本文にない文を除外しました: 倉庫ごとに引き当てる。');
  });

  it('同じ文は 1 つにして 3 個まで。親の本文が無ければ全部捨てる', () => {
    expect(of(['月末', '月末', '棚卸し', '1 日', '終える']).parentWhy).toEqual(['月末', '棚卸し', '1 日']);
    expect(applySpecs(hows, { specs: [], why: [], parentWhy: ['月末'] }, ticket).parentWhy).toEqual([]);
  });
});

// fixture の記録（fixtures/order-service/llm/spec-output.json。record-llm-spec.mjs が既定の LLM コマンドで採った）を検証に通す。
// テストは LLM を起動しない。入力はゴールデン expected/llm-spec-input.json（SHOP-421 と 1 回目の記録の 7 つの How）
describe('applySpecs（fixture の記録）', () => {
  const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8')) as T;
  const parsed = parseSpecOutput(read<{ stdout: string }>('llm/spec-output.json').stdout);
  if ('error' in parsed) throw new Error(parsed.error);
  const specInput = read<{ ticket: { body: string }; parent: { body: string } }>('expected/llm-spec-input.json');
  const body = specInput.ticket.body;
  const r = applySpecs(read<{ hows: How[] }>('expected/hows.json').hows, parsed.output, body, specInput.parent.body);

  it('捨てたものは無く、件数の 1 行だけ', () => {
    expect(r.info).toHaveLength(1);
    expect(r.info[0]).toMatch(/^要求: \d+ 件（対応するコースがあるもの \d+ 件）$/);
  });

  it('「なぜ」はチケットの背景の文をそのまま写した物（2026-10-29）', () => {
    expect(r.why.length).toBeGreaterThanOrEqual(1);
    expect(r.why.join('')).toContain('春のキャンペーン');
    for (const w of r.why) expect(body).toContain(w);
  });

  it('親チケットの文は、親の本文の「目的」の文をそのまま写した物（2026-10-29）', () => {
    expect(r.parentWhy.length).toBeGreaterThanOrEqual(1);
    expect(r.parentWhy.join('')).toContain('4 月');
    for (const w of r.parentWhy) expect(specInput.parent.body).toContain(w);
  });

  it('チケットの「期限切れのコードは 400 を返す」は、対応するコースが無い', () => {
    const expired = r.specs.find((s) => s.text.includes('期限切れ'));
    expect(expired?.hows).toEqual([]);
  });

  it('文は句点で終わらない（画面はリスト）', () => {
    for (const s of r.specs) expect(s.text).not.toMatch(/。$/);
  });

  it('ゴールデン expected/specs.json と一致する', async () => {
    await expect(JSON.stringify({ specs: r.specs, why: r.why, parentWhy: r.parentWhy, specIds: r.hows.map((h) => ({ id: h.id, specIds: h.specIds })), info: r.info }, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/specs.json'));
  });
});
