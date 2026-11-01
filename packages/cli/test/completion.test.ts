// ondina completion zsh（Tab 補完のスクリプト）。サブコマンドの一覧が使い方の記述と揃っているかも見る。
import { describe, expect, it } from 'vitest';
import { SUBCOMMANDS, zshCompletion, zshQuote } from '../src/completion.js';
import { run, usage } from '../src/main.js';

function io(cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  return { cwd, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), out, err };
}

describe('ondina completion zsh（Tab 補完）', () => {
  it('zsh の補完スクリプトを標準出力に出して exit 0', async () => {
    const o = io(process.cwd());
    expect(await run(['completion', 'zsh'], o)).toBe(0);
    expect(o.out.join('')).toBe(zshCompletion());
    expect(o.err).toEqual([]);
  });

  it('#compdef ondina で始まり、fpath から読まれても source されても動く形になっている', () => {
    const s = zshCompletion();
    expect(s.startsWith('#compdef ondina\n')).toBe(true);
    expect(s).toContain('if [[ $funcstack[1] == _ondina ]]; then');
    expect(s).toContain('_ondina "$@"');
    expect(s).toContain('compdef _ondina ondina');
  });

  it('サブコマンドを説明つきで全部候補に出す', () => {
    const s = zshCompletion();
    for (const c of SUBCOMMANDS) expect(s).toContain(`'${c.name}:${c.summary}'`);
  });

  it('説明文の単一引用符は、zsh の引用の中で壊れないようにエスケープする', () => {
    expect(zshQuote("it's")).toBe("it'\\''s");
    expect(zshQuote('plain')).toBe('plain');
  });

  it('analyze も serve と同じく PR 番号の位置引数を持つ（フラグだけだと位置の補完が無い）', () => {
    const s = zshCompletion();
    const analyze = s.slice(s.indexOf('        analyze)'), s.indexOf('        serve)'));
    expect(analyze).toContain("'1:PR 番号:'");
    expect(s.slice(s.indexOf('        serve)'), s.indexOf('        structure)'))).toContain("'1:操作か PR 番号:");
  });

  it('serve は list / stop / restart を候補に出し、stop と restart には --all を出す', () => {
    const s = zshCompletion();
    const serve = s.slice(s.indexOf('        serve)'), s.indexOf('        structure)'));
    expect(serve).toContain('list:');
    expect(serve).toContain('stop:');
    expect(serve).toContain('restart:');
    expect(serve).toContain("'--all[");
    for (const sub of ['list', 'stop', 'restart']) expect(usage).toContain(`ondina serve ${sub}`);
  });

  it('analyze は --no-lsp を出し、structure は ref の位置引数を持つ', () => {
    const s = zshCompletion();
    const analyze = s.slice(s.indexOf('        analyze)'), s.indexOf('        serve)'));
    expect(analyze).toContain("'--no-lsp[");
    expect(analyze).not.toContain("'--lsp[");
    expect(analyze).toContain("'--ticket[");
    expect(s.slice(s.indexOf('        structure)'), s.indexOf('        comments)'))).toContain("'1:ref:'");
  });

  it('トップレベルのフラグ --version と --help も候補に出す', () => {
    const s = zshCompletion();
    expect(s).toContain("'--version:");
    expect(s).toContain("'--help:");
  });

  it('SUBCOMMANDS は使い方の記述（ondina <名前>）と揃っている。増やしたら両方直す', () => {
    for (const c of SUBCOMMANDS) expect(usage).toContain(`ondina ${c.name}`);
  });

  it('使い方に completion が載っている', () => {
    expect(usage).toContain('ondina completion zsh');
  });

  it('completion の引数は zsh だけ。無い・ほかの名前は exit 1', async () => {
    for (const args of [['completion'], ['completion', 'fish']]) {
      const o = io(process.cwd());
      expect(await run(args, o)).toBe(1);
      expect(o.err.join('')).toContain('ondina completion: 対応しているのは zsh だけです');
    }
  });
});
