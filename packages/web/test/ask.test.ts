// 案内人に聞く（設計書 3.10）の純粋関数: 画面 → 何について（選んだ行も）、場所の鍵と見出し、決まった形の候補、行の場所の文字
import { describe, expect, it } from 'vitest';
import { askKey, askLinesOf, askLinesPlace, askPlace, askSuggestions, askTitle, askWebRefs, canMemo, citeLabel } from '../src/ask.js';
import { fixtureAnalysis } from './fixture.js';

const analysis = fixtureAnalysis();
const ORDER_ID = '98dcd7c9d8d6e0ed59854b2fff454f5bf805bae7';
const RATE_FOR = '2d34cf1c445b513eec0e31ad87b68bdaf5ab9cc8';
const ORDER_KT = 'src/main/kotlin/com/example/order/domain/Order.kt';
const apply = analysis.hunks.find((h) => h.symbolFqName === 'com.example.promo.PromoService.apply')!;
const logger = analysis.hunks.find((h) => h.hows.length === 0)!;
const base = { view: 'home' as const, course: null, selectedHunk: null, selectedFile: null };

describe('askPlace（画面 → 何について）', () => {
  it('入口・締めは PR 全体', () => {
    expect(askPlace(analysis, base)).toEqual({ kind: 'pr' });
    expect(askPlace(analysis, { ...base, view: 'closing' })).toEqual({ kind: 'pr' });
  });

  it('総括はそのコース', () => {
    expect(askPlace(analysis, { ...base, view: 'course', course: { id: 3, i: 4, screen: 'summary' } })).toEqual({ kind: 'course', courseId: 3 });
  });

  // 2026-10-20: 停留所の画面の右の列は今の停留所に付いていく（覗いている間も停留所のまま）
  it('停留所の画面はその停留所のシンボル。コース外は差分 1 つ', () => {
    expect(askPlace(analysis, { ...base, view: 'course', course: { id: 3, i: 0, screen: 'stop' } })).toEqual({ kind: 'symbol', symbolId: ORDER_ID, courseId: 3 });
    expect(askPlace(analysis, { ...base, view: 'course', course: { id: 0, i: 0, screen: 'stop' } })).toEqual({ kind: 'hunk', hunkId: logger.id });
  });

  it('差分一覧は選んだ差分（無ければファイル）。目的ごとは選んだ差分（無ければ PR 全体）', () => {
    expect(askPlace(analysis, { ...base, view: 'diff', selectedHunk: apply.id, selectedFile: apply.path })).toEqual({ kind: 'hunk', hunkId: apply.id });
    expect(askPlace(analysis, { ...base, view: 'diff', selectedFile: apply.path })).toEqual({ kind: 'file', path: apply.path });
    expect(askPlace(analysis, { ...base, view: 'hows', selectedHunk: apply.id })).toEqual({ kind: 'hunk', hunkId: apply.id });
    expect(askPlace(analysis, { ...base, view: 'hows' })).toEqual({ kind: 'pr' });
  });
});

describe('askKey / askTitle', () => {
  it('場所の鍵。コースの有無にかかわらず同じシンボルは同じ会話', () => {
    expect(askKey({ kind: 'pr' })).toBe('pr');
    expect(askKey({ kind: 'course', courseId: 0 })).toBe('course:0');
    expect(askKey({ kind: 'symbol', symbolId: 'x', courseId: 3 })).toBe('symbol:x');
    expect(askKey({ kind: 'symbol', symbolId: 'x' })).toBe('symbol:x');
    expect(askKey({ kind: 'hunk', hunkId: 'h' })).toBe('hunk:h');
    expect(askKey({ kind: 'file', path: 'a/B.kt' })).toBe('file:a/B.kt');
  });

  it('見出し: PR 全体 / コース / 停留所の何か所目 / 差分とファイル名 / ファイル名', () => {
    expect(askTitle(analysis, { kind: 'pr' })).toBe('PR 全体');
    expect(askTitle(analysis, { kind: 'course', courseId: 3 })).toBe('コース 3 · Order に discount と applyDiscount を持たせる');
    expect(askTitle(analysis, { kind: 'course', courseId: 0 })).toBe('コースに入っていない場所');
    expect(askTitle(analysis, { kind: 'symbol', symbolId: ORDER_ID, courseId: 3 })).toBe('domain.Order（コース 3 の 1 か所目）');
    expect(askTitle(analysis, { kind: 'symbol', symbolId: RATE_FOR })).toBe('DiscountPolicy.rateFor');
    expect(askTitle(analysis, { kind: 'hunk', hunkId: apply.id })).toBe('PromoService.apply（PromoService.kt）');
    expect(askTitle(analysis, { kind: 'file', path: ORDER_KT })).toBe('Order.kt');
  });
});

describe('askSuggestions（決まった形の候補。場所の事実から選ぶ）', () => {
  it('変わったシンボル: 変更前・呼んでいる所（呼ぶ側の辺があるとき）・テスト（あるとき）・次の場所（コースで次があるとき）', () => {
    expect(askSuggestions(analysis, { kind: 'symbol', symbolId: ORDER_ID, courseId: 3 })).toEqual(['変更前はどう動いていた？', 'ここを呼んでいる所は？', 'どのテストが確かめている？', '次の場所とどうつながる？']);
  });

  it('変わっていないシンボル: 何をしている所か', () => {
    expect(askSuggestions(analysis, { kind: 'symbol', symbolId: RATE_FOR, courseId: 3 })[0]).toBe('ここは何をしている？');
  });

  it('コースの最後の停留所には「次の場所」を出さない。テストの停留所は何を確かめているか', () => {
    const last = analysis.tours.find((t) => t.howId === 3)!.steps.at(-1)!;
    const s = askSuggestions(analysis, { kind: 'symbol', symbolId: last.symbolId, courseId: 3 });
    expect(s[0]).toBe('何を確かめている？');
    expect(s).not.toContain('次の場所とどうつながる？');
    expect(s).not.toContain('どのテストが確かめている？');
  });

  it('束の逸脱: ほかの場所と何が違うか', () => {
    expect(askSuggestions(analysis, { kind: 'hunk', hunkId: apply.id })).toContain('同じ書き換えのほかの場所と何が違う？');
  });

  it('ファイル・コース・PR 全体', () => {
    expect(askSuggestions(analysis, { kind: 'file', path: ORDER_KT })).toEqual(['このファイルで変わったことは？']);
    expect(askSuggestions(analysis, { kind: 'course', courseId: 3 })).toEqual(['このコースで振る舞いが変わる所は？', 'このコースはどこから始まる？']);
    expect(askSuggestions(analysis, { kind: 'pr' })).toEqual(['振る舞いが変わる所は？', '振る舞いが変わらない所は？', 'コースに入っていない 3 か所は何？']);
  });
});

describe('citeLabel', () => {
  it('ファイル名と行。base 側は「base 側」、範囲は「〜」', () => {
    expect(citeLabel({ path: ORDER_KT, side: 'head', line: 13 })).toBe('Order.kt 13');
    expect(citeLabel({ path: ORDER_KT, side: 'base', line: 6 })).toBe('base 側 Order.kt 6');
    expect(citeLabel({ path: ORDER_KT, side: 'head', line: 8, endLine: 11 })).toBe('Order.kt 8〜11');
  });
});

describe('askWebRefs（答えの下の「調べたページ」。2026-10-15）', () => {
  const ELVIS = 'https://kotlinlang.org/docs/null-safety.html#elvis-operator';
  const JOB = 'https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/-job.html';

  it('URL が初めて出た順に 1 から番号。同じ URL は 1 回だけ。場所は URL から', () => {
    const refs = askWebRefs({
      lead: 'L',
      items: [
        { text: 'a', cite: { path: ORDER_KT, side: 'head', line: 13 } },
        { text: 'b', web: { url: ELVIS, title: 'Null safety | Kotlin Documentation' } },
        { text: 'c', web: { url: JOB, title: 'Job' } },
        { text: 'd', web: { url: ELVIS, title: 'Null safety' } },
        { text: 'e', known: true },
      ],
    });
    expect(refs).toEqual([
      { n: 1, url: ELVIS, title: 'Null safety | Kotlin Documentation', host: 'kotlinlang.org' },
      { n: 2, url: JOB, title: 'Job', host: 'kotlinlang.org' },
    ]);
  });

  it('題が空なら、同じ URL の後の項目の題を使う。どれも空なら空', () => {
    const refs = askWebRefs({ lead: 'L', items: [{ text: 'a', web: { url: ELVIS, title: '' } }, { text: 'b', web: { url: ELVIS, title: 'Null safety' } }, { text: 'c', web: { url: JOB, title: ' ' } }] });
    expect(refs.map((r) => r.title)).toEqual(['Null safety', '']);
  });

  it('ネットのページが無ければ空', () => {
    expect(askWebRefs({ lead: 'L', items: [{ text: 'a' }, { text: 'b', known: true }] })).toEqual([]);
  });
});

describe('選んだ行で聞く（3.10 の決めごと 2）', () => {
  const at = (side: 'LEFT' | 'RIGHT', line: number, order: number) => ({ side, line, order });
  const L = (start: ['head' | 'base', number], end: ['head' | 'base', number], path = ORDER_KT) => ({ path, start: { side: start[0], line: start[1] }, end: { side: end[0], line: end[1] } });
  const code = { ...base, view: 'course' as const, course: { id: 3, i: 0, screen: 'stop' as const } };
  const INVOICE = 'src/main/kotlin/com/example/invoice/InvoiceBuilder.kt';
  const discountLine = analysis.hunks.find((h) => h.path === INVOICE && h.symbol === 'discountLine()')!;

  it('askLinesOf: 画面の上からの順で、LEFT（消した行）は base、RIGHT は head', () => {
    expect(askLinesOf({ path: ORDER_KT, anchor: at('RIGHT', 11, 12), head: at('RIGHT', 8, 9) })).toEqual(L(['head', 8], ['head', 11]));
    expect(askLinesOf({ path: ORDER_KT, anchor: at('LEFT', 6, 5), head: at('RIGHT', 6, 6) })).toEqual(L(['base', 6], ['head', 6]));
  });

  it('askLinesPlace: 停留所の画面は今の場所に行を足す', () => {
    const pick = { path: ORDER_KT, anchor: at('RIGHT', 8, 9), head: at('RIGHT', 11, 12) };
    expect(askLinesPlace(analysis, code, pick)).toEqual({ kind: 'symbol', symbolId: ORDER_ID, courseId: 3, lines: L(['head', 8], ['head', 11]) });
  });

  it('askLinesPlace: 停留所の画面で覗いているほかのファイルの行は、差分一覧と同じくその差分かファイル', () => {
    const one = { path: INVOICE, anchor: at('RIGHT', 8, 1), head: at('RIGHT', 9, 2) };
    expect(askLinesPlace(analysis, code, one)).toEqual({ kind: 'hunk', hunkId: discountLine.id, lines: L(['head', 8], ['head', 9], INVOICE) });
  });

  it('askLinesPlace: 差分一覧は両端が同じ差分ならその差分、差分をまたぐならファイル', () => {
    const diff = { ...base, view: 'diff' as const, selectedFile: INVOICE, selectedHunk: discountLine.id };
    const one = { path: INVOICE, anchor: at('RIGHT', 8, 1), head: at('RIGHT', 9, 2) };
    expect(askLinesPlace(analysis, diff, one)).toEqual({ kind: 'hunk', hunkId: discountLine.id, lines: L(['head', 8], ['head', 9], INVOICE) });
    const across = { path: INVOICE, anchor: at('RIGHT', 8, 1), head: at('RIGHT', 12, 5) };
    expect(askLinesPlace(analysis, diff, across)).toEqual({ kind: 'file', path: INVOICE, lines: L(['head', 8], ['head', 12], INVOICE) });
  });

  it('askLinesPlace: 行を選べない画面（入口・総括・目的ごと）は null', () => {
    const pick = { path: ORDER_KT, anchor: at('RIGHT', 8, 9), head: at('RIGHT', 8, 9) };
    expect(askLinesPlace(analysis, base, pick)).toBeNull();
    expect(askLinesPlace(analysis, { ...code, course: { id: 3, i: 4, screen: 'summary' } }, pick)).toBeNull();
    expect(askLinesPlace(analysis, { ...base, view: 'hows', selectedHunk: apply.id }, pick)).toBeNull();
  });

  it('askKey: 行の範囲ごとに別の会話（場所の鍵 + #h8-h11）', () => {
    expect(askKey({ kind: 'symbol', symbolId: ORDER_ID, courseId: 3, lines: L(['head', 8], ['head', 11]) })).toBe(`symbol:${ORDER_ID}#h8-h11`);
    expect(askKey({ kind: 'hunk', hunkId: 'x', lines: L(['base', 6], ['head', 6]) })).toBe('hunk:x#b6-h6');
  });

  it('askTitle: ファイル名と行（シンボルの短い名前）。ファイルは括弧なし', () => {
    expect(askTitle(analysis, { kind: 'symbol', symbolId: ORDER_ID, courseId: 3, lines: L(['head', 8], ['head', 11]) })).toBe('Order.kt 8〜11 行目（domain.Order）');
    expect(askTitle(analysis, { kind: 'hunk', hunkId: ORDER_ID, lines: L(['head', 13], ['head', 13]) })).toBe('Order.kt 13 行目（domain.Order）');
    expect(askTitle(analysis, { kind: 'file', path: ORDER_KT, lines: L(['base', 6], ['head', 6]) })).toBe('Order.kt base 6 行目〜head 6 行目');
  });

  it('askSuggestions: 足した行・消した行を含めば変更前のこと、変わらない行だけなら何をしているか', () => {
    const place = (lines: ReturnType<typeof L>) => ({ kind: 'symbol' as const, symbolId: ORDER_ID, courseId: 3, lines });
    expect(askSuggestions(analysis, place(L(['head', 8], ['head', 11])))).toEqual(['変更前はどう動いていた？', 'ここは何をしている？']);
    expect(askSuggestions(analysis, place(L(['base', 6], ['base', 6])))).toEqual(['変更前はどう動いていた？', 'ここは何をしている？']);
    expect(askSuggestions(analysis, place(L(['head', 1], ['head', 2])))).toEqual(['ここは何をしている？']);
    // 変わらない行 12 と 13 の間に消した行（base 10）がある
    expect(askSuggestions(analysis, place(L(['head', 12], ['head', 12])))).toEqual(['ここは何をしている？']);
    expect(askSuggestions(analysis, place(L(['head', 14], ['head', 14])))).toEqual(['ここは何をしている？']);
  });

  it('canMemo: コードの場所（シンボル・差分・ファイル）の答えだけ「メモにする」', () => {
    const diff = analysis.githubDiff;
    expect(canMemo({ kind: 'symbol', symbolId: ORDER_ID }, diff)).toBe(true);
    expect(canMemo({ kind: 'hunk', hunkId: 'x' }, diff)).toBe(true);
    expect(canMemo({ kind: 'file', path: ORDER_KT }, diff)).toBe(true);
    expect(canMemo({ kind: 'pr' }, diff)).toBe(false);
    expect(canMemo({ kind: 'course', courseId: 3 }, diff)).toBe(false);
  });

  it('canMemo: 行について聞いた問いは、その行が GitHub の差分に出るときだけ（Order.kt の塊は head 側 3〜14 行目）。差分の範囲が無い解析ならどの行も', () => {
    const diff = analysis.githubDiff;
    const symbol = (lines: ReturnType<typeof L>) => ({ kind: 'symbol' as const, symbolId: ORDER_ID, courseId: 3, lines });
    expect(canMemo(symbol(L(['head', 8], ['head', 11])), diff)).toBe(true);
    expect(canMemo(symbol(L(['head', 1], ['head', 2])), diff)).toBe(false);
    expect(canMemo(symbol(L(['head', 2], ['head', 8])), diff)).toBe(false);
    expect(canMemo({ kind: 'file', path: 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt', lines: { path: 'src/main/kotlin/com/example/order/domain/DiscountPolicy.kt', start: { side: 'head', line: 10 }, end: { side: 'head', line: 10 } } }, diff)).toBe(false);
    expect(canMemo(symbol(L(['head', 1], ['head', 2])), undefined)).toBe(true);
  });
});
