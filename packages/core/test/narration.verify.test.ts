// 2 回目の LLM（文を書く）の出力の検証と、tours への重ね合わせ（設計書 5.4）。全部プログラムで決める。捨てたものは info に 1 行ずつ。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Hunk, Tour } from '@ondina/model';
import { parseNarrationOutput } from '../src/narration/schema.js';
import { applyNarration, type NarrationHunk } from '../src/narration/verify.js';
import type { NarrationInputExisting, NarrationOutput } from '../src/narration/types.js';
import { FIXTURE_ROOT } from './fixture.js';

const tours: Tour[] = [
  { howId: 1, steps: [{ symbolId: 'a', hunkId: 'a', call: '' }, { symbolId: 'b', call: 'A → B(String)' }, { symbolId: 't', hunkId: 't', call: '' }] },
  { howId: 2, steps: [{ symbolId: 'c', hunkId: 'c', call: '' }] },
];
// a の head 側の行は 10（文脈）・11（追加）・12（文脈）。削除の行は head に無い。t は 30・31、c は 1
const hunks: Array<Pick<Hunk, 'id' | 'lnNew' | 'lines'>> = [
  { id: 'a', lnNew: 10, lines: [' x', '-y', '+z', ' w'] },
  { id: 't', lnNew: 30, lines: ['+t1', '+t2'] },
  { id: 'c', lnNew: 1, lines: ['+c'] },
];
const summary: NarrationOutput['summary'] = { headline: '', example: { text: '', at: [] }, flows: [] };
type Node = NarrationOutput['summary']['flows'][number]['nodes'][number];
const node = (title: string, howIds: number[], over: Partial<Node> = {}): Node => ({ title, howIds, symbolId: '', before: '', after: '', untouched: [], pass: '', ...over });
const summaryOf = (s: Partial<NarrationOutput['summary']>) => applyNarration(tours, out([], { ...summary, ...s }), hunks);
const out = (courses: NarrationOutput['courses'], s: NarrationOutput['summary'] = summary, b: NarrationOutput['background'] = { existing: [], terms: [] }): NarrationOutput => ({ summary: s, background: b, courses });
// 前からあるものの候補（入力の existing）。差分の行の識別子は x / y / z / w / t1 / t2 / c
const existing: NarrationInputExisting[] = [
  { symbol: 'p.Policy.rateFor', path: 'p/Policy.kt', kind: 'function', removed: false },
  { symbol: 'p.Money.ZERO', path: 'p/Money.kt', kind: 'property', removed: false },
  { symbol: 'p.Order.promo', path: 'p/Order.kt', kind: 'property', removed: true },
];
const backgroundOf = (b: Partial<NarrationOutput['background']>) => applyNarration(tours, out([], summary, { existing: [], terms: [], ...b }), hunks, existing);
type Course = NarrationOutput['courses'][number];
const course = (howId: number, over: Partial<Course> = {}): Course => ({ howId, change: { before: '', after: '' }, checks: [], stops: [], ...over });
const check = (text: string, ...at: Array<[string, number[], string?]>) => ({ text, at: at.map(([symbolId, lines, say]) => ({ symbolId, lines, say: say ?? '' })) });
const checksOf = (howId: number, cs: NarrationOutput['courses'][number]['checks']) => applyNarration(tours, out([course(howId, { checks: cs })]), hunks);

describe('applyNarration', () => {
  it('コースの変わること・確かめること・停留所のこの場所を tours に重ねる。経路（並び・呼ばれ方）は変えない', () => {
    const r = applyNarration(
      tours,
      out([
        course(1, {
          change: { before: '前。', after: '後。' },
          checks: [check('z を足す', ['a', [11], '足すのはここ。'], ['t', [30, 31], 'テストで確かめる。'])],
          stops: [
            { symbolId: 'a', role: '入口。' },
            { symbolId: 'b', role: '率を返す。' },
            { symbolId: 't', role: 'テスト。' },
          ],
        }),
        course(2, { change: { before: '', after: '二。' }, stops: [{ symbolId: 'c', role: 'c。' }] }),
      ]),
      hunks,
    );
    expect(r.tours).toEqual([
      {
        howId: 1,
        change: { before: '前。', after: '後。' },
        checks: [{ text: 'z を足す', at: [{ symbolId: 'a', lines: [11], say: '足すのはここ。' }, { symbolId: 't', lines: [30, 31], say: 'テストで確かめる。' }] }],
        steps: [
          { symbolId: 'a', hunkId: 'a', call: '', role: '入口。' },
          { symbolId: 'b', call: 'A → B(String)', role: '率を返す。' },
          { symbolId: 't', hunkId: 't', call: '', role: 'テスト。' },
        ],
      },
      { howId: 2, change: { after: '二。' }, steps: [{ symbolId: 'c', hunkId: 'c', call: '', role: 'c。' }] },
    ]);
    expect(r.info).toEqual(['案内文: 変わること 2 / 2、この場所 4 / 4、確かめること 1（場所 2）']);
  });

  it('書き漏らした場所は欄を付けない（画面は自動の文）。最後の行で数が分かる', () => {
    const r = applyNarration(tours, out([course(1, { stops: [{ symbolId: 'a', role: '入口。' }] })]), hunks);
    expect(r.tours[0]!.steps[1]).toEqual({ symbolId: 'b', call: 'A → B(String)' });
    expect(r.tours[0]).not.toHaveProperty('change');
    expect(r.tours[0]).not.toHaveProperty('checks');
    expect(r.tours[1]).toEqual(tours[1]);
    expect(r.info.at(-1)).toBe('案内文: 変わること 0 / 2、この場所 1 / 4、確かめること 0（場所 0）');
  });

  it('空・空白だけの文は無いものとして扱い、前後の空白は落とす', () => {
    const r = applyNarration(tours, out([course(1, { change: { before: ' 前。 ', after: '  ' }, stops: [{ symbolId: 'a', role: ' 入口。 ' }, { symbolId: 'b', role: '' }] })]), hunks);
    expect(r.tours[0]).toEqual({ howId: 1, change: { before: '前。' }, steps: [{ symbolId: 'a', hunkId: 'a', call: '', role: '入口。' }, tours[0]!.steps[1], tours[0]!.steps[2]] });
  });

  it('知らないコースと、そのコースに無い停留所の文は捨てて 1 行ずつ知らせる', () => {
    const r = applyNarration(tours, out([course(9, { change: { before: 'x。', after: 'y。' } }), course(2, { change: { before: '', after: '二。' }, stops: [{ symbolId: 'a', role: 'r。' }] })]), hunks);
    expect(r.info.slice(0, 2)).toEqual(['不明なコースの文を除外しました: howId 9', 'コース 2 にない停留所の文を除外しました: a']);
    expect(r.tours[1]).toEqual({ howId: 2, change: { after: '二。' }, steps: tours[1]!.steps });
  });

  it('同じコース・同じ停留所が 2 回来たら最初だけ使う', () => {
    const r = applyNarration(
      tours,
      out([
        course(2, { change: { before: '', after: '一回目。' }, stops: [{ symbolId: 'c', role: 'r1。' }, { symbolId: 'c', role: 'r2。' }] }),
        course(2, { change: { before: '', after: '二回目。' } }),
      ]),
      hunks,
    );
    expect(r.tours[1]).toMatchObject({ change: { after: '一回目。' }, steps: [{ role: 'r1。' }] });
    expect(r.info.slice(0, 2)).toEqual(['コース 2 の同じ停留所の文が 2 回来たので最初だけ使いました: c', 'コース 2 の文が 2 回来たので最初だけ使いました']);
  });

  it('最初の文が空でも、2 回目のコースは変わることも確かめることも停留所も丸ごと捨てる（後の分で埋めない）', () => {
    const r = applyNarration(tours, out([course(2), course(2, { change: { before: '', after: '二回目。' }, checks: [check('c', ['c', [1]])], stops: [{ symbolId: 'c', role: 'r。' }] })]), hunks);
    expect(r.tours[1]).toEqual(tours[1]);
    expect(r.info).toEqual(['コース 2 の文が 2 回来たので最初だけ使いました', '案内文: 変わること 0 / 2、この場所 0 / 4、確かめること 0（場所 0）']);
  });

  describe('確かめること', () => {
    it('行はその停留所の差分の head 側（文脈か追加の行）にあるものだけ残す。削除の行の位置や範囲の外の行は捨てて知らせる', () => {
      const r = checksOf(1, [check('z を足す', ['a', [9, 10, 11, 12, 13]])]);
      expect(r.tours[0]!.checks).toEqual([{ text: 'z を足す', at: [{ symbolId: 'a', lines: [10, 11, 12] }] }]);
      expect(r.info[0]).toBe('コース 1 の確かめること 1 の場所 a から差分にない行を除外しました: 9, 13');
    });

    it('行が残らない場所と、コースに無い停留所・差分の無い停留所の場所は捨てる。場所が残らない文も捨てる', () => {
      const r = checksOf(1, [check('一', ['a', [99]], ['c', [1]], ['t', [30]]), check('二', ['b', [1]])]);
      expect(r.tours[0]!.checks).toEqual([{ text: '一', at: [{ symbolId: 't', lines: [30] }] }]);
      expect(r.info.slice(0, -1)).toEqual([
        'コース 1 の確かめること 1 の場所 a から差分にない行を除外しました: 99',
        'コース 1 の確かめること 1 の場所 a は行が残らないので除外しました',
        'コース 1 の確かめること 1 の場所を除外しました（コースにない停留所）: c',
        'コース 1 の確かめること 2 の場所 b から差分にない行を除外しました: 1',
        'コース 1 の確かめること 2 の場所 b は行が残らないので除外しました',
        'コース 1 の確かめること 2 は場所が残らないので除外しました',
      ]);
    });

    it('場所は読む順に並べ直し、行は昇順・重複なしにする。同じ文で同じ場所が 2 回来たら最初だけ使う', () => {
      const r = checksOf(1, [check('一', ['t', [31, 30, 31]], ['a', [12, 11]], ['a', [10]])]);
      expect(r.tours[0]!.checks).toEqual([{ text: '一', at: [{ symbolId: 'a', lines: [11, 12] }, { symbolId: 't', lines: [30, 31] }] }]);
      expect(r.info[0]).toBe('コース 1 の確かめること 1 の同じ場所が 2 回来たので最初だけ使いました: a');
    });

    it('文が空の確かめることは捨てる。6 個目からは捨てる（並びは LLM の順のまま）', () => {
      const r = checksOf(1, [check(' ', ['a', [11]]), ...['一', '二', '三', '四', '五', '六'].map((t) => check(t, ['a', [11]]))]);
      expect(r.tours[0]!.checks!.map((c) => c.text)).toEqual(['一', '二', '三', '四', '五']);
      expect(r.info.slice(0, -1)).toEqual(['コース 1 の確かめること 1 は文が空なので除外しました', 'コース 1 の確かめることが 6 個あったので最初の 5 個だけ使いました']);
    });

    it('場所の説明が空なら欄を付けない。前後の空白は落とす', () => {
      const r = checksOf(1, [check(' 一 ', ['a', [11], ' 見る。 '], ['t', [30], ' '])]);
      expect(r.tours[0]!.checks).toEqual([{ text: '一', at: [{ symbolId: 'a', lines: [11], say: '見る。' }, { symbolId: 't', lines: [30] }] }]);
    });
  });

  describe('入口の説明（規則 5。2026-10-29）', () => {
    it('要点と例の文は前後の空白を落とし、空なら欄を付けない', () => {
      expect(summaryOf({ headline: ' 要点。 ', example: { text: ' 例。 ', at: [] } }).summary).toEqual({ headline: '要点。', example: { text: '例。', at: [] } });
      expect(summaryOf({ headline: ' ', example: { text: '', at: [{ symbolId: 't', lines: [30] }] } }).summary).toEqual({});
    });

    it('例の根拠の場所は停留所の hunk の head 側の行だけ（どのコースの停留所でもよい）。行が残らない場所は捨てる', () => {
      const r = summaryOf({ example: { text: '例。', at: [{ symbolId: 't', lines: [31, 30, 99] }, { symbolId: 'c', lines: [1] }, { symbolId: 'a', lines: [5] }, { symbolId: 'x', lines: [1] }] } });
      expect(r.summary.example).toEqual({ text: '例。', at: [{ symbolId: 't', lines: [30, 31] }, { symbolId: 'c', lines: [1] }] });
      expect(r.info).toContain('例の根拠の場所を除外しました（停留所の差分にない）: a 5');
      expect(r.info).toContain('例の根拠の場所を除外しました（停留所の差分にない）: x 1');
    });

    it('図の箱のコースは実在するものだけ、1 つのコースは最初の箱だけ。コースが残らない箱・題が空の箱・箱が残らない図は捨てる', () => {
      const r = summaryOf({ flows: [{ nodes: [node('受け付け', [1, 9]), node('計算', [1]), node(' ', [2])] }, { nodes: [node('保存', [2, 2])] }, { nodes: [node('応答', [1])] }] });
      expect(r.summary.flows).toEqual([{ nodes: [{ title: '受け付け', howIds: [1], before: '', after: '', untouched: [] }] }, { nodes: [{ title: '保存', howIds: [2], before: '', after: '', untouched: [] }] }]);
      expect(r.info).toEqual(
        expect.arrayContaining([
          '図 1 の箱 1 から不明なコースを除外しました: howId 9',
          '図 1 の箱 2 のコース 1 は前の箱にあるので除外しました',
          '図 1 の箱 2 はコースが残らないので除外しました',
          '図 1 の箱 3 は題が空なので除外しました',
          '図 3 の箱 1 のコース 1 は前の箱にあるので除外しました',
        ]),
      );
      expect(r.info.at(-1)).toBe('入口の説明: 要点 なし、例 なし、図 2 本（箱 2）');
    });

    it('箱の下の名前はその箱のコースの停留所だけ。文は前後の空白を落とし、札の空の項目と空の渡す値は捨てる', () => {
      const r = summaryOf({ flows: [{ nodes: [node('計算', [1], { symbolId: 'b', before: ' 前。 ', after: ' 後。 ', untouched: ['', ' 率の表 '], pass: ' 100 ' }), node('保存', [2], { symbolId: 'a', pass: ' ' })] }] });
      expect(r.summary.flows![0]!.nodes).toEqual([
        { title: '計算', howIds: [1], symbol: 'b', before: '前。', after: '後。', untouched: ['率の表'], pass: '100' },
        { title: '保存', howIds: [2], before: '', after: '', untouched: [] },
      ]);
      expect(r.info).toContain('図 1 の箱 2 の名前を除外しました（箱のコースの停留所にない）: a');
    });

    it('どの箱にも入らなかったコースを最後の行に出す', () => {
      expect(summaryOf({ headline: '要点。', flows: [{ nodes: [node('計算', [2])] }] }).info.at(-1)).toBe('入口の説明: 要点 あり、例 なし、図 1 本（箱 1、図にないコース 1）');
    });
  });

  describe('背景（規則 7。2026-10-29）', () => {
    it('前からあるものは候補の名前だけ残し、名前・パス・種類と、消えるか（事実）をプログラムが付ける。文は前後の空白を落とす', () => {
      const r = backgroundOf({ existing: [{ symbols: ['p.Policy.rateFor', 'p.Nope'], text: ' 率を引く。 ' }, { symbols: ['p.Order.promo'], text: '前の持ち方。' }] });
      expect(r.background.existing).toEqual([
        { names: [{ fqName: 'p.Policy.rateFor', path: 'p/Policy.kt', kind: 'function' }], text: '率を引く。', removed: false },
        { names: [{ fqName: 'p.Order.promo', path: 'p/Order.kt', kind: 'property' }], text: '前の持ち方。', removed: true },
      ]);
      expect(r.info).toContain('前からあるもの 1 から候補にない名前を除外しました: p.Nope');
    });

    it('1 つの候補は最初の行だけ。消える物と変えていない物が混ざったら最初の物と同じ方だけ。名前が残らない行・文が空の行は捨てる', () => {
      const r = backgroundOf({
        existing: [
          { symbols: ['p.Policy.rateFor', 'p.Order.promo', 'p.Money.ZERO'], text: '一。' },
          { symbols: ['p.Policy.rateFor'], text: '二。' },
          { symbols: ['p.Order.promo'], text: ' ' },
        ],
      });
      expect(r.background.existing).toEqual([
        {
          names: [
            { fqName: 'p.Policy.rateFor', path: 'p/Policy.kt', kind: 'function' },
            { fqName: 'p.Money.ZERO', path: 'p/Money.kt', kind: 'property' },
          ],
          text: '一。',
          removed: false,
        },
      ]);
      expect(r.info).toEqual(
        expect.arrayContaining([
          '前からあるもの 1 の p.Order.promo は、削除と変更なしが混ざるので除外しました',
          '前からあるもの 2 の p.Policy.rateFor は前の行にあるので除外しました',
          '前からあるもの 2 は名前が残らないので除外しました',
          '前からあるもの 3 は文が空なので除外しました',
        ]),
      );
    });

    it('1 つの行で同じ名前が 2 回来たら最初だけ使う', () => {
      const r = backgroundOf({ existing: [{ symbols: ['p.Policy.rateFor', 'p.Policy.rateFor'], text: '一。' }] });
      expect(r.background.existing![0]!.names.map((n) => n.fqName)).toEqual(['p.Policy.rateFor']);
      expect(r.info).toContain('前からあるもの 1 の同じ名前が 2 回来たので最初だけ使いました: p.Policy.rateFor');
    });

    it('前からあるものは 3 行まで（4 行目からは捨てる）', () => {
      const r = backgroundOf({ existing: [['p.Policy.rateFor'], ['p.Money.ZERO'], ['p.Order.promo']].map((symbols, i) => ({ symbols, text: `${i}。` })) });
      expect(r.background.existing).toHaveLength(3);
      const r2 = applyNarration(tours, out([], summary, { existing: [1, 2, 3, 4].map((i) => ({ symbols: [`p.S${i}`], text: `${i}。` })), terms: [] }), hunks, [1, 2, 3, 4].map((i) => ({ symbol: `p.S${i}`, path: 'p/S.kt', kind: 'class' as const, removed: false })));
      expect(r2.background.existing!.map((e) => e.text)).toEqual(['1。', '2。', '3。']);
      expect(r2.info).toContain('前からあるものが 4 行あったので最初の 3 行だけ使いました');
    });

    it('言葉のコードの名前は差分の行に出る識別子だけ（後ろの () と、識別子を . で繋いだ物は認める）。意味は空なら欄を付けない', () => {
      const r = backgroundOf({
        terms: [
          { word: ' 小計 ', code: ' z ', meaning: ' 割引の前の額。 ' },
          { word: '合計', code: 'w()', meaning: '' },
          { word: '金額', code: 'x.y', meaning: '' },
          { word: '割引', code: 'discount', meaning: '無い名前。' },
          { word: '式', code: 'z + w', meaning: '' },
        ],
      });
      expect(r.background.terms).toEqual([
        { word: '小計', code: 'z', meaning: '割引の前の額。' },
        { word: '合計', code: 'w()' },
        { word: '金額', code: 'x.y' },
      ]);
      expect(r.info).toContain('言葉 4 を除外しました（差分の行にない名前）: discount');
      expect(r.info).toContain('言葉 5 を除外しました（差分の行にない名前）: z + w');
    });

    it('言葉が空の物は捨てる。同じ識別子は最初だけ。4 個まで', () => {
      const r = backgroundOf({
        terms: [
          { word: ' ', code: 'x', meaning: '' },
          { word: 'A', code: 'x', meaning: '' },
          { word: 'B', code: 'x()', meaning: '' },
          { word: 'C', code: 'y', meaning: '' },
          { word: 'D', code: 'z', meaning: '' },
          { word: 'E', code: 'w', meaning: '' },
          { word: 'F', code: 't1', meaning: '' },
        ],
      });
      expect(r.background.terms!.map((t) => t.word)).toEqual(['A', 'C', 'D', 'E']);
      expect(r.info).toEqual(expect.arrayContaining(['言葉 1 は言葉が空なので除外しました', '言葉 3 の x は前の言葉にあるので除外しました', '言葉が 5 個あったので最初の 4 個だけ使いました']));
    });

    it('背景を 1 つでも書いていれば最後の行に数を出す。書いていなければ欄を付けない', () => {
      const r = backgroundOf({ existing: [{ symbols: ['p.Order.promo'], text: '一。' }], terms: [{ word: '小計', code: 'z', meaning: '' }] });
      expect(r.info.at(-1)).toBe('背景: 前からあるもの 1 行（候補 3）、言葉 1 個');
      expect(backgroundOf({}).background).toEqual({});
      expect(backgroundOf({}).info.some((l) => l.startsWith('背景:'))).toBe(false);
    });
  });

  it('入力の tours は書き換えない', () => {
    const before = structuredClone(tours);
    applyNarration(tours, out([course(1, { change: { before: '前。', after: '後。' }, checks: [check('一', ['a', [11]])], stops: [{ symbolId: 'a', role: 'r。' }] })]), hunks);
    expect(tours).toEqual(before);
  });
});

// fixture の記録（fixtures/order-service/llm/text-output.json。record-llm-text.mjs が既定の LLM コマンドで採った）を検証に通す。
// テストは LLM を起動しない。ゴールデンは expected/text.json（web のテスト用 fixture が tours と summary に使う）
describe('applyNarration（fixture の記録）', () => {
  const read = <T,>(rel: string): T => JSON.parse(readFileSync(path.join(FIXTURE_ROOT, rel), 'utf8')) as T;
  const parsed = parseNarrationOutput(read<{ stdout: string }>('llm/text-output.json').stdout);
  if ('error' in parsed) throw new Error(parsed.error);
  const r = applyNarration(read<Tour[]>('expected/tours.json'), parsed.output, read<NarrationHunk[]>('expected/hunks.json'), read<{ existing: NarrationInputExisting[] }>('expected/llm-text-input.json').existing);

  it('捨てた文は無く、全部のコースに変わること、全部の停留所にこの場所が付く', () => {
    expect(r.info).toEqual([
      expect.stringMatching(/^案内文: 変わること 7 \/ 7、この場所 29 \/ 29、確かめること \d+（場所 \d+）$/),
      '入口の説明: 要点 あり、例 あり（場所 2）、図 1 本（箱 5）',
      expect.stringMatching(/^背景: 前からあるもの [1-3] 行（候補 5）、言葉 [2-4] 個$/),
    ]);
  });

  it('確かめることはどのコースも 2〜5 個で、場所は読む順', () => {
    for (const t of r.tours) {
      expect(t.checks!.length, `コース ${t.howId}`).toBeGreaterThanOrEqual(2);
      expect(t.checks!.length, `コース ${t.howId}`).toBeLessThanOrEqual(5);
      const order = t.steps.map((s) => s.symbolId);
      for (const c of t.checks!) expect(c.at.map((x) => order.indexOf(x.symbolId))).toEqual(c.at.map((x) => order.indexOf(x.symbolId)).sort((x, y) => x - y));
    }
  });

  it('コース 5 の 2 つ目は execute の 16 行（find の呼び出し）とテストの行', () => {
    const t5 = r.tours.find((t) => t.howId === 5)!;
    const [execute] = t5.steps;
    expect(t5.checks![1]!.at[0]).toMatchObject({ symbolId: execute!.symbolId, lines: [16] });
    expect(t5.checks![1]!.at).toHaveLength(2);
  });

  it('経路（停留所の並び・呼ばれ方）はゴールデン expected/tours.json のまま', () => {
    const strip = (ts: Tour[]) => ts.map((t) => ({ howId: t.howId, steps: t.steps.map(({ symbolId, hunkId, call }) => ({ symbolId, hunkId, call })) }));
    expect(strip(r.tours)).toEqual(strip(read<Tour[]>('expected/tours.json')));
  });

  it('入口の説明: 要点は 1 文、例はテストの値（1000 → 900）、図は全部のコースを 1 回ずつ通る順に並べる。札は領域の名前だけ', () => {
    expect(r.summary.headline).toMatch(/^[^。]+。$/);
    expect(r.summary.example!.text).toMatch(/1,?000/);
    expect(r.summary.example!.text).toMatch(/900/);
    const nodes = r.summary.flows!.flatMap((f) => f.nodes);
    expect(nodes.flatMap((n) => n.howIds).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const n of nodes) for (const x of n.untouched) expect(x).not.toMatch(/[。（(]|[a-z][A-Z]|\w\(\)/);
    // どのコースにも入らなかった変更（ログの書式・機能フラグ）は札に入れない
    expect(nodes.flatMap((n) => n.untouched).join('、')).not.toMatch(/ログ|フラグ/);
  });

  it('背景: 前からあるものは候補から 1〜3 行（消える Order.promo / getDiscount を含む）、言葉は 2〜4 個で差分の行の識別子', () => {
    const existing = r.background.existing!;
    expect(existing.length).toBeGreaterThanOrEqual(1);
    expect(existing.length).toBeLessThanOrEqual(3);
    expect(existing.some((e) => e.removed && e.names.some((n) => n.fqName.endsWith('Order.getDiscount')))).toBe(true);
    // 何をするものかの 1 文に、差分での使われ方の 1 文を添えてよい（指示文の existing[].text）
    for (const e of existing) expect(e.text).toMatch(/^[^。]+。([^。]+。)?$/);
    const terms = r.background.terms!;
    expect(terms.length).toBeGreaterThanOrEqual(2);
    expect(terms.length).toBeLessThanOrEqual(4);
    expect(terms.map((t) => t.code)).toContain('discount');
  });

  it('ゴールデン expected/text.json と一致する', async () => {
    await expect(JSON.stringify({ summary: r.summary, background: r.background, tours: r.tours, info: r.info }, null, 2) + '\n').toMatchFileSnapshot(path.join(FIXTURE_ROOT, 'expected/text.json'));
  });
});
