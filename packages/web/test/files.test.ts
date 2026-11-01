// D のファイル列（設計書 3.4）: path 順、閲覧済みの点、未帰属チップ。
import { describe, expect, it } from 'vitest';
import { compareTreeOrder } from '../src/fileTree.js';
import { groupFiles, hunkAt, shortPath, viewedChange, viewedFiles } from '../src/files.js';
import { fixtureHunks } from './fixture.js';

describe('groupFiles', () => {
  it('path ごとにまとめ、ファイルツリーの並び（フォルダが先、名前順）に並ぶ', () => {
    const files = groupFiles(fixtureHunks(), []);
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([...paths].sort(compareTreeOrder));
    expect(new Set(paths).size).toBe(paths.length);
    expect(files.reduce((a, f) => a + f.hunks.length, 0)).toBe(48);
  });

  it('同じフォルダにファイルとフォルダがあれば、フォルダの中のファイルが先（`[` `]` がツリーの上から順に進む）', () => {
    const [a, b] = fixtureHunks();
    const files = groupFiles([{ ...a!, path: 'x/a.kt' }, { ...b!, path: 'x/y/w.kt' }], []);
    expect(files.map((f) => f.path)).toEqual(['x/y/w.kt', 'x/a.kt']);
  });

  it('dir と base に分け、全 hunk が閲覧済みのときだけ viewed', () => {
    const hunks = fixtureHunks();
    const multi = groupFiles(hunks, []).find((f) => f.hunks.length > 1)!;
    const order = multi.hunks;
    const partial = groupFiles(hunks, [order[0]!.id]).find((f) => f.path === multi.path)!;
    expect(partial.dir + partial.base).toBe(multi.path);
    expect(partial.dir.endsWith('/')).toBe(true);
    expect(partial.base).not.toContain('/');
    expect(partial.viewed).toBe(false);
    const all = groupFiles(hunks, order.map((h) => h.id)).find((f) => f.path === multi.path)!;
    expect(all.viewed).toBe(true);
  });

  it('viewedCount はファイルの中で問題なしを付けた hunk の数', () => {
    const hunks = fixtureHunks();
    const multi = groupFiles(hunks, []).find((f) => f.hunks.length > 1)!;
    expect(multi.viewedCount).toBe(0);
    expect(groupFiles(hunks, [multi.hunks[0]!.id]).find((f) => f.path === multi.path)!.viewedCount).toBe(1);
  });

  it('hows が空の hunk を含むファイルは unassigned', () => {
    const hunks = fixtureHunks();
    for (const h of hunks) h.hows = [];
    expect(groupFiles(hunks, []).every((f) => f.unassigned)).toBe(true);
    for (const h of hunks) h.hows = [1];
    expect(groupFiles(hunks, []).some((f) => f.unassigned)).toBe(false);
  });

  it('packagePrefix を渡すと dir はその下からになり、含まないパスはそのまま（11 章）', () => {
    const files = groupFiles(fixtureHunks(), [], 'com.example');
    const order = files.find((f) => f.path === 'src/main/kotlin/com/example/order/domain/Order.kt')!;
    expect(order.dir).toBe('order/domain/');
    expect(order.base).toBe('Order.kt');
    const sql = files.find((f) => f.path.endsWith('.sql'))!;
    expect(sql.dir).toBe('src/main/resources/db/migration/');
    expect(files.map((f) => f.path)).toEqual(groupFiles(fixtureHunks(), []).map((f) => f.path));
  });

  it('packagePrefix はディレクトリ境界でだけ一致する（mycom/example/ は com.example ではない）', () => {
    const hunks = fixtureHunks().slice(0, 2);
    hunks[0]!.path = 'src/main/kotlin/mycom/example/File.kt';
    hunks[1]!.path = 'com/example/Top.kt';
    const files = groupFiles(hunks, [], 'com.example');
    expect(files.find((f) => f.path.includes('mycom'))!.dir).toBe('src/main/kotlin/mycom/example/');
    expect(files.find((f) => f.path.startsWith('com/'))!.dir).toBe('');
  });

  it('packagePrefix が無ければ dir は path の全部', () => {
    const order = groupFiles(fixtureHunks(), []).find((f) => f.path === 'src/main/kotlin/com/example/order/domain/Order.kt')!;
    expect(order.dir).toBe('src/main/kotlin/com/example/order/domain/');
  });
});

describe('shortPath', () => {
  it('packagePrefix の下からにする。無ければ・含まなければそのまま', () => {
    expect(shortPath('src/main/kotlin/com/example/order/domain/Order.kt', 'com.example')).toBe('order/domain/Order.kt');
    expect(shortPath('src/main/resources/db/migration/V421__discount.sql', 'com.example')).toBe('src/main/resources/db/migration/V421__discount.sql');
    expect(shortPath('src/main/kotlin/com/example/order/domain/Order.kt')).toBe('src/main/kotlin/com/example/order/domain/Order.kt');
  });
});

describe('hunkAt（下書きの行から差分を引く）', () => {
  const hunks = fixtureHunks();
  const h = hunks.find((x) => x.path.endsWith('OrderRepositoryImpl.kt') && x.lines.some((l) => l.startsWith('-')))!;
  const newCount = h.lines.filter((l) => !l.startsWith('-')).length;
  const oldCount = h.lines.filter((l) => !l.startsWith('+')).length;

  it('RIGHT は head 側の行番号（lnNew から）で探す。範囲の外は別の hunk か undefined', () => {
    expect(hunkAt(hunks, h.path, h.lnNew, 'RIGHT')).toBe(h);
    expect(hunkAt(hunks, h.path, h.lnNew + newCount - 1, 'RIGHT')).toBe(h);
    expect(hunkAt(hunks, h.path, h.lnNew + newCount, 'RIGHT')).not.toBe(h);
    expect(hunkAt(hunks, h.path, h.lnNew - 1, 'RIGHT')).not.toBe(h);
  });

  it('LEFT は base 側の行番号（lnOld から）で探す', () => {
    expect(hunkAt(hunks, h.path, h.lnOld + oldCount - 1, 'LEFT')).toBe(h);
    expect(hunkAt(hunks, h.path, h.lnOld + oldCount, 'LEFT')).not.toBe(h);
  });

  it('ファイルが違えば undefined', () => {
    expect(hunkAt(hunks, 'no/such/File.kt', h.lnNew, 'RIGHT')).toBeUndefined();
  });
});

describe('viewedFiles / viewedChange（GitHub の Viewed に付ける・外すファイル。設計書 12.1）', () => {
  const hunks = fixtureHunks();
  const multi = groupFiles(hunks, []).find((f) => f.hunks.length > 1)!;
  const single = groupFiles(hunks, []).find((f) => f.hunks.length === 1)!;
  const [a, b] = multi.hunks.map((h) => h.id) as [string, string];
  const one = single.hunks[0]!.id;

  it('viewedFiles は差分が全部問題なしのファイルだけ', () => {
    expect(viewedFiles(hunks, [a])).toEqual(new Set());
    expect(viewedFiles(hunks, [a, b, one])).toEqual(new Set([multi.path, single.path]));
  });

  it('最後の 1 か所で全部になったファイルを付ける。途中の 1 か所では何もしない', () => {
    expect(viewedChange(hunks, [], [a])).toEqual({ mark: [], unmark: [] });
    expect(viewedChange(hunks, [a], [a, b])).toEqual({ mark: [multi.path], unmark: [] });
    expect(viewedChange(hunks, [], [one])).toEqual({ mark: [single.path], unmark: [] });
  });

  it('全部でなくなったファイルを外す。もともと一部なら何もしない', () => {
    expect(viewedChange(hunks, [a, b], [b])).toEqual({ mark: [], unmark: [multi.path] });
    expect(viewedChange(hunks, [a], [])).toEqual({ mark: [], unmark: [] });
  });

  it('同時に付ける・外すがあれば両方', () => {
    expect(viewedChange(hunks, [a, b], [a, one])).toEqual({ mark: [single.path], unmark: [multi.path] });
  });
});
