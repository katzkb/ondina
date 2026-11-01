// この PR で消える宣言（説明タブの背景の「この PR の前からあるものは？」の候補。設計書 3.1）。base にだけある宣言を拾う。
import { describe, expect, it } from 'vitest';
import { removedDeclarations } from '../src/hunks/removed.js';
import { changedFixtureFiles } from './fixture.js';

const kt = (before: string[] | null, after: string[] | null, path = 'src/main/kotlin/p/A.kt') => ({
  path,
  before: before === null ? null : before.join('\n') + '\n',
  after: after === null ? null : after.join('\n') + '\n',
});

describe('removedDeclarations', () => {
  it('fixture: Order の主コンストラクタの promo と getDiscount() が消える', async () => {
    expect(await removedDeclarations(changedFixtureFiles())).toEqual([
      { fqName: 'com.example.order.domain.Order.promo', path: 'src/main/kotlin/com/example/order/domain/Order.kt', kind: 'property', line: 6 },
      { fqName: 'com.example.order.domain.Order.getDiscount', path: 'src/main/kotlin/com/example/order/domain/Order.kt', kind: 'function', line: 8 },
    ]);
  });

  it('クラスごと消えたら、メンバーは並べずクラスだけ', async () => {
    const files = [kt(['package p', 'class A {', '    fun f() = 1', '    val x = 2', '}', 'class B'], ['package p', 'class B'])];
    expect(await removedDeclarations(files)).toEqual([{ fqName: 'p.A', path: 'src/main/kotlin/p/A.kt', kind: 'class', line: 2 }]);
  });

  it('消えたファイルはトップレベルの宣言を全部。足したファイルと Kotlin 以外は見ない', async () => {
    const files = [
      kt(['package p', 'class A', 'fun b() = 1'], null),
      kt(null, ['package p', 'class C'], 'src/main/kotlin/p/C.kt'),
      { path: 'src/main/resources/db/V1.sql', before: 'create table a;\n', after: null },
    ];
    expect((await removedDeclarations(files)).map((d) => [d.fqName, d.kind])).toEqual([
      ['p.A', 'class'],
      ['p.b', 'function'],
    ]);
  });

  it('主コンストラクタは val / var の引数だけをプロパティとして見る。名前を変えた物は消える物になる', async () => {
    const files = [kt(['class A(val x: Int, var y: Int, z: Int) {', '    fun f() = 1', '}'], ['class A(val x: Int, w: Int) {', '    fun g() = 1', '}'])];
    expect((await removedDeclarations(files)).map((d) => [d.fqName, d.kind, d.line])).toEqual([
      ['A.y', 'property', 1],
      ['A.f', 'function', 2],
    ]);
  });

  it('名前の無い init は拾わない', async () => {
    const files = [kt(['class A {', '    init { println(1) }', '}'], ['class A'])];
    expect(await removedDeclarations(files)).toEqual([]);
  });
});
