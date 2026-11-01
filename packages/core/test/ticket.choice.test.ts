// チケット選び（設計書 10.7。2026-10-12）。プログラムが拾った候補から、この PR のチケットを LLM に 1 つ選ばせる。
// 入力を組む・プロンプトの本文・出力の検査・候補に無い答えを捨てる、の 4 つ
import { describe, expect, it } from 'vitest';
import type { TicketCandidate } from '@ondina/model';
import { buildTicketInput, parseTicketOutput, renderTicketPrompt, TICKET_OUTPUT_SCHEMA, verifyTicketChoice } from '../src/ticket/choice.js';

const JIRA = 'https://example.atlassian.net/browse/SHOP-421';
const candidates: TicketCandidate[] = [
  { ref: JIRA, label: 'SHOP-421', places: [{ in: 'title', text: '[SHOP-421] 割引', start: 1, end: 9 }] },
  { ref: 'SHOP-399', label: 'SHOP-399', places: [{ in: 'body', line: 2, text: '関連: SHOP-399', start: 4, end: 12 }] },
];
const src = { title: '[SHOP-421] 割引', branch: 'feature/discount', body: '割引を足す\n関連: SHOP-399' };

describe('buildTicketInput', () => {
  it('候補に c1, c2 … の id を振り、見つけた場所は拾った文字列と行だけにする', () => {
    expect(buildTicketInput(src, candidates)).toEqual({
      pr: src,
      candidates: [
        { id: 'c1', label: 'SHOP-421', places: [{ in: 'title', match: '[SHOP-421] 割引'.slice(1, 9), text: '[SHOP-421] 割引' }] },
        { id: 'c2', label: 'SHOP-399', places: [{ in: 'body', line: 2, match: 'SHOP-399', text: '関連: SHOP-399' }] },
      ],
    });
  });

  it('題が無ければ pr に title を入れない（ローカルモード）', () => {
    expect(buildTicketInput({ branch: 'b', body: '' }, []).pr).toEqual({ branch: 'b', body: '' });
  });
});

describe('renderTicketPrompt', () => {
  const input = buildTicketInput(src, candidates);

  it('入力 JSON と出力の形を本文に含み、同じ入力には同じ本文（原則 7）', () => {
    const p = renderTicketPrompt(input);
    expect(p).toContain(`入力:\n${JSON.stringify(input, null, 2)}`);
    expect(p).toContain(JSON.stringify(TICKET_OUTPUT_SCHEMA, null, 2));
    expect(renderTicketPrompt(input)).toBe(p);
  });

  it('関連・参考として触れただけのものと、番号の形でもチケットでないものは選ばず、無ければ null と指示する', () => {
    const p = renderTicketPrompt(input);
    for (const s of ['関連', '参考', '文字コード', 'null', 'candidates', 'ツールを使', 'JSON オブジェクト 1 つだけ']) expect(p, s).toContain(s);
  });
});

describe('parseTicketOutput', () => {
  it('choice の id か null を読む。フェンスと前後の文は剥がす', () => {
    expect(parseTicketOutput('{"choice":"c1"}')).toEqual({ output: { choice: 'c1' } });
    expect(parseTicketOutput('結果\n```json\n{"choice": null}\n```')).toEqual({ output: { choice: null } });
  });

  it('choice が無ければ null として読む', () => {
    expect(parseTicketOutput('{}')).toEqual({ output: { choice: null } });
  });

  it('形が違えば場所を言って失敗する', () => {
    expect(parseTicketOutput('{"choice": 3}')).toEqual({ error: 'choice が文字列でも null でもありません' });
    expect(parseTicketOutput('わかりません')).toEqual({ error: 'stdout に JSON オブジェクトがありません' });
  });
});

describe('verifyTicketChoice', () => {
  it('id の候補を返す', () => {
    expect(verifyTicketChoice({ choice: 'c2' }, candidates)).toEqual({ chosen: candidates[1] });
  });

  it('null は選ばなかった', () => {
    expect(verifyTicketChoice({ choice: null }, candidates)).toEqual({});
  });

  it('候補に無い id は捨て、知らせる', () => {
    expect(verifyTicketChoice({ choice: 'c9' }, candidates)).toEqual({ info: 'LLM が候補にないチケット（c9）を選んだので除外しました' });
  });
});
