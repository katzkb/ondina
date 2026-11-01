// 構成の推定（設計書 10.6）の入力。追跡ファイルのパスをディレクトリごとにまとめ、.kt には最上位の宣言を添える。
import { describe, expect, it } from 'vitest';
import { buildStructureInput } from '../src/structure/input.js';

describe('buildStructureInput', () => {
  it('ディレクトリごとにまとめ、ディレクトリもファイルも昇順にする（同じ一覧に同じ入力。原則 7）', () => {
    const r = buildStructureInput([
      { path: 'src/b/Z.kt', decls: ['class Z'] },
      { path: 'README.md' },
      { path: 'src/b/A.kt' },
      { path: 'src/a/M.kt', decls: ['object M', 'fun main'] },
    ]);
    expect(r).toEqual({
      input: {
        files: 4,
        dirs: [
          { dir: '.', files: [{ name: 'README.md' }] },
          { dir: 'src/a', files: [{ name: 'M.kt', decls: ['object M', 'fun main'] }] },
          { dir: 'src/b', files: [{ name: 'A.kt' }, { name: 'Z.kt', decls: ['class Z'] }] },
        ],
      },
      declsDropped: false,
    });
  });

  it('上限を超えたら宣言を落とし、落としたことを返す', () => {
    const files = Array.from({ length: 50 }, (_, i) => ({ path: `src/F${i}.kt`, decls: [`class LongDeclarationName${i}`] }));
    const r = buildStructureInput(files, { limit: 2000 });
    if ('error' in r) throw new Error(r.error);
    expect(r.declsDropped).toBe(true);
    expect(r.input.dirs[0]!.files.every((f) => f.decls === undefined)).toBe(true);
  });

  it('宣言を落としても上限を超えるなら、件数を言って失敗する', () => {
    const files = Array.from({ length: 200 }, (_, i) => ({ path: `src/deep/dir/File${i}.kt` }));
    expect(buildStructureInput(files, { limit: 500 })).toEqual({ error: expect.stringContaining('200 件') });
  });
});

describe('buildStructureInput の previous（推定し直し。原則 7）', () => {
  it('前回の層の名前を previous に入れる（無ければ欄ごと無い）', () => {
    const r = buildStructureInput([{ path: 'a.kt' }], { previous: ['API', 'Core'] });
    if ('error' in r) throw new Error(r.error);
    expect(r.input.previous).toEqual({ layers: ['API', 'Core'] });
    const none = buildStructureInput([{ path: 'a.kt' }]);
    if ('error' in none) throw new Error(none.error);
    expect(none.input).not.toHaveProperty('previous');
  });
});
