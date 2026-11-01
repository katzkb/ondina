// 構成の推定の出力の読み取り。形が違う所は場所を言って失敗する（label/schema.ts と同じ方針）。
import { describe, expect, it } from 'vitest';
import { parseStructureOutput } from '../src/structure/schema.js';

describe('parseStructureOutput', () => {
  it('前後の文やコードフェンスを無視して読む', () => {
    const out = { layers: [{ name: 'API', why: '入口' }], dirs: [{ dir: 'src/api', layer: 'API' }], files: [{ path: 'src/App.kt', layer: 'API' }], outside: ['docs'], tests: ['src/test'] };
    expect(parseStructureOutput('はい\n```json\n' + JSON.stringify(out) + '\n```\n')).toEqual({ output: out });
  });

  it('欠けた配列は空で埋める', () => {
    expect(parseStructureOutput('{"layers":[{"name":"API"}]}')).toEqual({ output: { layers: [{ name: 'API', why: '' }], dirs: [], files: [], outside: [], tests: [] } });
  });

  it('JSON が無ければ失敗する', () => {
    expect(parseStructureOutput('sorry')).toEqual({ error: 'stdout に JSON オブジェクトがありません' });
  });

  it('形が違えば場所を言って失敗する', () => {
    expect(parseStructureOutput('{"layers":[{"name":1}]}')).toEqual({ error: 'layers[0].name が文字列ではありません' });
    expect(parseStructureOutput('{"layers":[],"dirs":[{"dir":"a"}]}')).toEqual({ error: 'dirs[0].layer が文字列ではありません' });
    expect(parseStructureOutput('{"layers":[],"tests":[1]}')).toEqual({ error: 'tests が文字列の配列ではありません' });
  });
});
