// AI エージェント（Codex・OpenCode）が読むスキル（設計書 12 章）。install.sh が skills/ を ~/.agents/skills/ に置く。
// 見出し（frontmatter）が読まれる形になっているかを見る。決まりは OpenCode のドキュメント（Codex も name と description が要る）
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMMENT_WRITING_RULES } from '@ondina/core';
import { SUBCOMMANDS } from '../src/completion.js';

const SKILLS = path.resolve(import.meta.dirname, '../../../skills');

function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  return Object.fromEntries(m[1]!.split('\n').map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
}

describe('skills/', () => {
  const names = readdirSync(SKILLS);

  it('ondina（開く）と ondina-comments（コメントを入れる）がある', () => {
    expect(names).toContain('ondina');
    expect(names).toContain('ondina-comments');
  });

  it('ondina-preview は作業ツリーを --head 無しで解析し、comments wait で返したコメントを待つ（12 章）', () => {
    expect(names).toContain('ondina-preview');
    const text = readFileSync(path.join(SKILLS, 'ondina-preview', 'SKILL.md'), 'utf8');
    expect(text).toContain('ondina analyze --base <base> --title');
    expect(text).not.toContain('--head <');
    expect(text).toContain('ondina comments wait');
    expect(text).toContain('ondina serve --background local');
    expect(readFileSync(path.join(SKILLS, 'ondina', 'SKILL.md'), 'utf8')).toContain('`ondina-preview`');
  });

  it('ondina-comments は解析しない（解析して開くのは ondina）', () => {
    const text = readFileSync(path.join(SKILLS, 'ondina-comments', 'SKILL.md'), 'utf8');
    expect(text).not.toContain('ondina analyze');
  });

  it('ondina-comments の本文と説明の書き方は、PR 一覧の AI レビューの指示文と同じ文', () => {
    const text = readFileSync(path.join(SKILLS, 'ondina-comments', 'SKILL.md'), 'utf8');
    expect(text).toContain(COMMENT_WRITING_RULES);
  });

  it.each(['ondina', 'ondina-comments'])('%s: PR 番号を言われなければ、今いるブランチの PR を番号なしの gh pr view で探し、無ければ止まる', (name) => {
    const text = readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
    expect(text).toContain('gh pr view --json number,title,state');
    expect(text).toContain('no pull requests found');
  });

  it.each(names)('%s: name はディレクトリ名と同じで小文字・数字・ハイフン、description は 1〜1024 文字', (name) => {
    const fm = frontmatter(readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8'));
    expect(fm['name']).toBe(name);
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(fm['description']?.length).toBeGreaterThan(0);
    expect(fm['description']!.length).toBeLessThanOrEqual(1024);
  });

  it.each(names)('%s: 本文に出る ondina のサブコマンドは実在する', (name) => {
    const text = readFileSync(path.join(SKILLS, name, 'SKILL.md'), 'utf8');
    const used = [...text.matchAll(/`ondina ([a-z]+)/g)].map((m) => m[1]);
    const known = new Set(SUBCOMMANDS.map((c) => c.name));
    expect(used.length).toBeGreaterThan(0);
    for (const u of used) expect(known).toContain(u);
  });
});
