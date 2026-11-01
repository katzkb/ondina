// コマンドパレット（設計書 18.2）の候補作りとあいまい一致。決定的（点数の合成をしない）。
import { describe, expect, it } from 'vitest';
import { calleeDest, calleeItems, matchQuery, paletteItems, searchPalette, type PaletteItem } from '../src/palette.js';
import { fixtureAnalysis } from './fixture.js';

const item = (kind: PaletteItem['kind'], label: string, sub = ''): PaletteItem =>
  kind === 'how'
    ? { kind, target: { kind: 'how', howId: 1 }, label, sub }
    : kind === 'hunk'
      ? { kind, target: { kind: 'hunk', hunkId: label }, label, sub }
      : { kind, target: { kind: 'file', path: label }, label, sub };

describe('paletteItems', () => {
  it('How → シンボル → ファイルの順に、全部の候補を作る', () => {
    const items = paletteItems(fixtureAnalysis());
    expect(items.filter((i) => i.kind === 'how')).toHaveLength(7);
    expect(items.filter((i) => i.kind === 'hunk')).toHaveLength(48);
    expect(items.filter((i) => i.kind === 'file')).toHaveLength(37);
    expect(items).toHaveLength(92);
    // 種別ごとにまとまって並ぶ
    expect(items.map((i) => i.kind).indexOf('hunk')).toBe(7);
    expect(items.map((i) => i.kind).indexOf('file')).toBe(55);
  });

  it('How は title と why、飛び先は howId', () => {
    const first = paletteItems(fixtureAnalysis())[0]!;
    expect(first).toEqual({
      kind: 'how',
      target: { kind: 'how', howId: 1 },
      label: 'orders テーブルに discount 列を足す',
      sub: '割引額を行として保存できる置き場を作るため',
    });
  });

  it('シンボルは symbol とパス。追従グループのメンバーも 1 件ずつ出す', () => {
    const items = paletteItems(fixtureAnalysis());
    const admin = items.find((i) => i.kind === 'hunk' && i.label === 'discountField()');
    expect(admin?.sub).toBe('src/main/kotlin/com/example/admin/OrderAdminView.kt');
    expect(admin?.target).toEqual({ kind: 'hunk', hunkId: '64b251772fa1ec50d3343c65710a0f6634aad62c' });
  });

  it('packagePrefix があればシンボルのパスを短くする', () => {
    const items = paletteItems(fixtureAnalysis(), 'com.example');
    const admin = items.find((i) => i.kind === 'hunk' && i.label === 'discountField()');
    expect(admin?.sub).toBe('admin/OrderAdminView.kt');
  });

  it('ファイルはファイル名とディレクトリ', () => {
    const items = paletteItems(fixtureAnalysis(), 'com.example');
    const file = items.find((i) => i.kind === 'file' && i.label === 'OrderAdminView.kt');
    expect(file?.sub).toBe('admin/');
    expect(file?.target).toEqual({ kind: 'file', path: 'src/main/kotlin/com/example/admin/OrderAdminView.kt' });
  });
});

describe('matchQuery', () => {
  it('続けて当たれば 1 かたまり', () => {
    expect(matchQuery('disc', 'DiscountCommand')).toEqual({ positions: [0, 1, 2, 3], chunks: 1, first: 0 });
  });

  it('飛び飛びでも順番が合えば当たる。切れ目の数がかたまりの数', () => {
    expect(matchQuery('oad', 'OrderAdminView')).toEqual({ positions: [0, 5, 6], chunks: 2, first: 0 });
  });

  it('大文字小文字は無視する', () => {
    expect(matchQuery('DISC', 'discountCommand')).toEqual({ positions: [0, 1, 2, 3], chunks: 1, first: 0 });
  });

  it('クエリの空白は取り除く', () => {
    expect(matchQuery('or der', 'Order')).toEqual({ positions: [0, 1, 2, 3, 4], chunks: 1, first: 0 });
  });

  it('開始位置を変えて、いちばんかたまりが少ない当て方を採る', () => {
    // 左から貪欲だと a(0) b(2) の 2 かたまりになるが、a(4) b(5) の 1 かたまりが最良
    expect(matchQuery('ab', 'a b ab')).toEqual({ positions: [4, 5], chunks: 1, first: 4 });
  });

  it('空クエリは全部に当たる（下線なし）', () => {
    expect(matchQuery('', 'whatever')).toEqual({ positions: [], chunks: 0, first: 0 });
    expect(matchQuery('   ', 'whatever')).toEqual({ positions: [], chunks: 0, first: 0 });
  });

  it('順番が合わなければ当たらない', () => {
    expect(matchQuery('cba', 'abc')).toBeNull();
    expect(matchQuery('xyz', 'abc')).toBeNull();
  });

  it('当てる先は label とその後ろの sub をつないだ 1 本の文字列', () => {
    // "Order" (label) + " " + "domain/Order.kt" (sub)
    const hit = matchQuery('orderdom', 'Order domain/Order.kt');
    expect(hit).toEqual({ positions: [0, 1, 2, 3, 4, 6, 7, 8], chunks: 2, first: 0 });
  });
});

describe('searchPalette', () => {
  it('かたまりの少ない順に並べる', () => {
    const items = [item('hunk', 'Order.applyDiscount()'), item('hunk', 'OrderAdminView')];
    const { hits } = searchPalette(items, 'oad');
    expect(hits.map((h) => h.item.label)).toEqual(['OrderAdminView', 'Order.applyDiscount()']);
  });

  it('かたまりが同じなら、最初に当たった位置が早い順', () => {
    const items = [item('hunk', 'applyDiscount()'), item('hunk', 'DiscountCommand')];
    const { hits } = searchPalette(items, 'disc');
    expect(hits.map((h) => h.item.label)).toEqual(['DiscountCommand', 'applyDiscount()']);
  });

  it('そこまで同じなら How → シンボル → ファイルの順', () => {
    const items = [item('file', 'disc'), item('hunk', 'disc'), item('how', 'disc')];
    const { hits } = searchPalette(items, 'disc');
    expect(hits.map((h) => h.item.kind)).toEqual(['how', 'hunk', 'file']);
  });

  it('そこまで同じなら元の並びを保つ', () => {
    const items = [item('hunk', 'disc', 'b'), item('hunk', 'disc', 'a')];
    const { hits } = searchPalette(items, 'disc');
    expect(hits.map((h) => h.item.sub)).toEqual(['b', 'a']);
  });

  it('当たった文字の位置を返す（下線に使う）', () => {
    const { hits } = searchPalette([item('hunk', 'DiscountCommand')], 'dc');
    expect(hits[0]!.positions).toEqual([0, 3]);
  });

  it('当たらないものは落とし、あふれなければ more は 0', () => {
    const items = [item('hunk', 'DiscountCommand'), item('hunk', 'Logger')];
    const { hits, more } = searchPalette(items, 'disc');
    expect(hits).toHaveLength(1);
    expect(more).toBe(0);
  });

  it('上限 20 件。あふれた数を返す', () => {
    const items = paletteItems(fixtureAnalysis());
    const { hits, more } = searchPalette(items, '');
    expect(hits).toHaveLength(20);
    expect(more).toBe(72);
    // 空クエリは元の並びのまま = How 7 件が先頭
    expect(hits.slice(0, 7).every((h) => h.item.kind === 'how')).toBe(true);
  });

});

describe('呼んでいる相手（3.6）', () => {
  const a = fixtureAnalysis();
  const id = (tail: string) => a.symbols.find((s) => s.fqName.endsWith(tail))!.id;

  it('飛び先は 今の How の読む順番 → 別の How の読む順番 → 差分 → 差分の無い相手 → なし の順に探す', () => {
    // OrderRepositoryImpl.save は How 4・5・6 の読む順番にある。今の How を優先する
    expect(calleeDest(a, id('OrderRepositoryImpl.save'), 5)).toEqual({ kind: 'step', howId: 5 });
    expect(calleeDest(a, id('OrderRepositoryImpl.save'), 6)).toEqual({ kind: 'step', howId: 6 });
    // OrderAdminView.discountField（束の代表）は How 3 の読む順番にだけある
    expect(calleeDest(a, id('OrderAdminView.discountField'), 5)).toEqual({ kind: 'step', howId: 3 });
    // DiscountPolicy.rateFor は差分が無く、停留所にならない（2026-10-11）。差分の無い相手の引き出しで出す
    expect(calleeDest(a, id('DiscountPolicy.rateFor'), 5)).toEqual({ kind: 'rel' });
    // Logger.format は変更があるが、どの読む順番にも無い
    const format = a.symbols.find((s) => s.fqName.endsWith('Logger.format'))!;
    expect(calleeDest(a, format.id, 5)).toEqual({ kind: 'hunk', hunkId: format.hunkId });
    // シンボルの情報が無い相手は飛び先なし
    expect(calleeDest(a, 'f'.repeat(40), 5)).toEqual({ kind: 'none' });
  });

  it('call の辺の相手を辺の並びで出す。名前は地図と同じ短い名前、薄字は層と飛び先', () => {
    const items = calleeItems(a, id('ApplyDiscountUseCase.execute'), 5);
    // 差分の無い OrderRepository.find は変わらない行から呼ぶので辺が無い（2026-10-12）
    expect(items.map((i) => i.label)).toEqual(['OrderRepositoryImpl.find', 'OrderRepositoryImpl.save', 'OrderRepository.save', 'domain.Order']);
    expect(items.every((i) => i.kind === 'callee')).toBe(true);
    expect(items[0]!.target).toEqual({ kind: 'callee', symbolId: id('OrderRepositoryImpl.find') });
    expect(items[0]!.sub).toBe('Infrastructure · このコース');
    expect(calleeItems(a, id('.domain.Order'), 5).map((i) => i.sub)).toEqual(['Domain · 差分なし（右に出す）']);
  });

  it('LLM が推定した層は薄字に（推定）を付ける', () => {
    const b = structuredClone(a);
    b.symbols = b.symbols.map((s) => (s.layer === undefined ? s : { ...s, layerProvenance: 'llm' as const }));
    expect(calleeItems(b, id('.domain.Order'), 5).map((i) => i.sub)).toEqual(['Domain（推定） · 差分なし（右に出す）']);
  });

  it('層が無い相手は「層なし」、飛び先が無い相手はそう書く（候補からは消さない）', () => {
    expect(calleeItems(a, id('Logger.log'), null).map((i) => i.sub)).toEqual(['層なし · 差分（How 分解の画面）']);
    const noDest = fixtureAnalysis();
    const format = noDest.symbols.find((s) => s.fqName.endsWith('Logger.format'))!;
    format.changed = false;
    delete format.hunkId;
    expect(calleeItems(noDest, id('Logger.log'), null).map((i) => i.sub)).toEqual(['層なし · 差分なし（右に出す）']);
  });

  it('呼び出し以外の辺（参照・テスト）は出さない。同じ相手は 1 件にまとめる', () => {
    const from = id('ApplyDiscountUseCase.execute');
    const to = id('OrderRepositoryImpl.find');
    const extra = { ...a, edges: [...a.edges, { from, to, kind: 'call' as const, crossesLayers: false, provenance: 'lsp' as const }, { from, to: id('Logger.format'), kind: 'reference' as const, crossesLayers: false, provenance: 'lsp' as const }] };
    expect(calleeItems(extra, from, 5)).toHaveLength(4);
  });

  it('辺の相手が symbols に無くても消さず、id の頭と「? シンボルの情報なし」で出す', () => {
    const from = id('ApplyDiscountUseCase.execute');
    const ghost = 'f'.repeat(40);
    const extra = { ...a, edges: [...a.edges, { from, to: ghost, kind: 'call' as const, crossesLayers: false, provenance: 'lsp' as const }] };
    expect(calleeItems(extra, from, 5).at(-1)).toMatchObject({ label: 'ffffffff', sub: '? シンボルの情報なし · 飛び先なし（シンボルの情報がありません）' });
  });
});
