import { describe, expect, it } from 'vitest';
import type { Command } from '../src/commands/commands.js';
import { initialState, reduce, type AppState } from '../src/state/reducer.js';
import { emptyReview } from './fixture.js';
import { requirementAnalysis } from './requirementFixture.js';

function loaded(): AppState {
  const analysis = requirementAnalysis();
  analysis.pr.number = 42;
  return reduce(initialState(), { id: 'data.loaded', analysis, review: emptyReview(), summary: { key: '42', headSha: analysis.pr.headSha, pr: analysis.pr, mtime: 1, repoName: 'order-service' } }).state;
}
const run = (s: AppState, ...cs: Command[]) => cs.reduce((s, c) => reduce(s, c).state, s);
const enter = () => run(loaded(), { id: 'req.go', chapter: 0 });

describe('requirement course commands', () => {
  it.each([{ id: 'enter' }, { id: 'view.course' }, { id: 'course.enter', courseId: 1 }] as Command[])('course entry %j opens requirement start', (command) => {
    expect(reduce(loaded(), command).state).toMatchObject({ view: 'req', requirement: { chapter: 'start' } });
  });
  it('moves current hunk in chapter reading order, then next chapter, and back to start', () => {
    let s = enter();
    expect(s.selectedHunk).toBe('130e7d62f211839eec7c68582ae3565629d8c673');
    s = run(s, { id: 'hunk.next' });
    expect(s.selectedHunk).toBe('a135ba90941c193b82bb22bc319e52347521ee99');
    s = run(s, ...Array.from({ length: 9 }, (): Command => ({ id: 'hunk.next' })));
    expect(s.requirement.chapter).toBe(1);
    expect(s.selectedHunk).toBe('98dcd7c9d8d6e0ed59854b2fff454f5bf805bae7');
    expect(run(enter(), { id: 'hunk.prev' }).requirement.chapter).toBe('start');
    expect(run(enter(), { id: 'course.forward' }).requirement.chapter).toBe(1);
    expect(run(enter(), { id: 'course.prev' }).requirement.chapter).toBe('start');
  });
  it('Enter marks current hunk, advances focus, and undo unviews through Github sync', () => {
    const s = enter();
    const h = s.analysis!.hunks.find((h) => h.id === s.selectedHunk)!;
    const others = s.analysis!.hunks.filter((x) => x.path === h.path && x.id !== h.id).map((x) => x.id);
    const ready = { ...s, review: { ...s.review!, viewed: others } };
    const r = reduce(ready, { id: 'enter' });
    expect(r.state.selectedHunk).toBe(s.analysis!.chapters![0]!.hunkIds[1]);
    expect(r.state.review!.viewed).toContain(h.id);
    expect(r.effects).toContainEqual(expect.objectContaining({ type: 'githubSet', mark: [h.path], unmark: [] }));
    const undo = reduce(r.state, { id: 'req.undo', hunkId: h.id });
    expect(undo.state.review!.viewed).not.toContain(h.id);
    expect(undo.effects).toContainEqual(expect.objectContaining({ type: 'githubSet', mark: [], unmark: [h.path] }));
  });
  it.each(['ask', 'imo'] as const)('saves %s only at reviewer selected lines; ask views the hunk', (label) => {
    const s = enter();
    const h = s.analysis!.hunks.find((h) => h.id === s.selectedHunk)!;
    let e = run(s, { id: 'req.edit', hunkId: h.id, label });
    expect(run(e, { id: 'req.save', body: '質問です' }).review!.comments).toEqual([]);
    const line = h.lnNew;
    e = run(e, { id: 'memo.pick', path: h.path, side: 'RIGHT', line, order: 0 }, { id: 'memo.drop' });
    const saved = run(e, { id: 'req.save', body: '質問です' });
    expect(saved.review!.comments).toEqual([expect.objectContaining({ source: 'reviewer', label, path: h.path, line, side: 'RIGHT', body: '質問です' })]);
    expect(saved.review!.viewed.includes(h.id)).toBe(label === 'ask');
  });
  it('prefills ask from intent but leaves opinion empty and never picks lines', () => {
    const s = loaded();
    const h = s.analysis!.intents!.find((i) => i.ask)!;
    const ask = run(s, { id: 'req.edit', hunkId: h.hunkId, label: 'ask' });
    expect(ask.memo.draft).toBe(h.ask);
    expect(ask.memo.pick).toBeNull();
    expect(run(ask, { id: 'req.edit', hunkId: h.hunkId, label: 'imo' }).memo.draft).toBe('');
  });
  it('rejects other hunk lines, non-Github lines, and missing Github diff', () => {
    const s = enter();
    const h = s.analysis!.hunks.find((h) => h.id === s.selectedHunk)!;
    const e = run(s, { id: 'req.edit', hunkId: h.id, label: 'ask' }, { id: 'memo.pick', path: h.path, side: 'RIGHT', line: 99999, order: 0 }, { id: 'memo.drop' });
    expect(run(e, { id: 'req.save', body: '質問' }).review!.comments).toEqual([]);
    const missing = { ...e, analysis: { ...e.analysis! } };
    delete missing.analysis.githubDiff;
    expect(run(missing, { id: 'req.save', body: '質問' }).review!.comments).toEqual([]);
  });
  it('file Viewed removes all file hunk marks; file scroll preserves chapter current hunk', () => {
    const s = enter();
    const f = s.analysis!.githubDiff!.at(-1)!;
    const all = { ...s, review: { ...s.review!, viewed: s.analysis!.hunks.map((h) => h.id) } };
    const r = reduce(all, { id: 'req.file.unview', path: f.path });
    expect(r.state.review!.viewed.some((id) => s.analysis!.hunks.find((h) => h.id === id)?.path === f.path)).toBe(false);
    const scroll = run(s, { id: 'req.file', path: f.path });
    expect(scroll.selectedHunk).toBe(s.selectedHunk);
    expect(scroll.requirement.scroll?.path).toBe(f.path);
  });
});

describe('requirement course shared controls', () => {
  it.each([{ id: 'help.keymap' }, { id: 'palette.open' }, { id: 'settings.open' }, { id: 'ask.toggle' }] as Command[])('Escape closes overlay before leaving chapter: %j', (command) => {
    const opened = run(enter(), command);
    const closed = run(opened, { id: 'escape' });
    expect(closed.view).toBe('req');
    expect(closed.requirement.chapter).toBe(0);
    expect(closed.showKeymap).toBe(false);
    expect(closed.showPalette).toBe(false);
    expect(closed.settings).toBeNull();
    expect(closed.ask.open).toBe(false);
  });
  it('file keys scroll through Github order and preserve current chapter hunk', () => {
    const s = enter();
    const firstPath = s.analysis!.hunks.find((h) => h.id === s.selectedHunk)!.path;
    const order = s.analysis!.githubDiff!.map((f) => f.path);
    const expected = order[(order.indexOf(firstPath) + 1) % order.length]!;
    const next = run(s, { id: 'file.next' });
    expect(next.selectedHunk).toBe(s.selectedHunk);
    expect(next.requirement.scroll?.path).toBe(expected);
    expect(next.requirement.files[expected]).toBe(true);
    expect(run(next, { id: 'file.prev' }).requirement.scroll?.path).toBe(firstPath);
  });
  it('editing existing draft replaces the new question editor', () => {
    const s = enter();
    const h = s.analysis!.hunks.find((h) => h.id === s.selectedHunk)!;
    const saved = run(s, { id: 'req.edit', hunkId: h.id, label: 'ask' }, { id: 'memo.pick', path: h.path, side: 'RIGHT', line: h.lnNew, order: 0 }, { id: 'memo.drop' }, { id: 'req.save', body: '質問' });
    const open = run(saved, { id: 'req.edit', hunkId: h.id, label: 'imo' });
    const edit = run(open, { id: 'memo.edit', commentId: saved.review!.comments[0]!.id });
    expect(edit.requirement.editor).toBeNull();
    expect(edit.memo.draft).toBe('質問');
    expect(run(edit, { id: 'memo.update', commentId: edit.memo.editing!, body: '直した質問' }).requirement.editor).toBeNull();
  });
  it('Escape cancels question editor after overlays and preserves current chapter', () => {
    const s = enter();
    const opened = run(s, { id: 'req.edit', hunkId: s.selectedHunk!, label: 'ask' }, { id: 'help.keymap' });
    const first = run(opened, { id: 'escape' });
    expect(first.showKeymap).toBe(false);
    expect(first.requirement.editor).not.toBeNull();
    const second = run(first, { id: 'escape' });
    expect(second.requirement.editor).toBeNull();
    expect(second.view).toBe('req');
  });
  it('a new analysis without chapters returns from requirement course to explain', () => {
    const s = enter();
    const a = { ...s.analysis! };
    delete a.chapters;
    expect(run(s, { id: 'data.loaded', analysis: a, summary: s.current!, review: emptyReview() }).view).toBe('home');
  });
});

it('saved question marks Github Viewed when it is the final unseen hunk of its file', () => {
  const s = enter();
  const h = s.analysis!.hunks.find((h) => h.id === s.selectedHunk)!;
  const ready = { ...s, review: { ...s.review!, viewed: s.analysis!.hunks.filter((x) => x.path === h.path && x.id !== h.id).map((x) => x.id) } };
  const edit = run(ready, { id: 'req.edit', hunkId: h.id, label: 'ask' }, { id: 'memo.pick', path: h.path, side: 'RIGHT', line: h.lnNew, order: 0 }, { id: 'memo.drop' });
  const saved = reduce(edit, { id: 'req.save', body: '理由を教えてください' });
  expect(saved.effects).toContainEqual(expect.objectContaining({ type: 'githubSet', mark: [h.path], unmark: [] }));
  const off = reduce(saved.state, { id: 'req.file.unview', path: h.path });
  expect(off.effects).toContainEqual(expect.objectContaining({ type: 'githubSet', mark: [], unmark: [h.path] }));
  expect(off.state.review!.comments[0]?.label).toBe('ask');
});

it('definition jumps reuse the drawer; Escape closes it before a question editor', () => {
  const s = enter();
  const edited = run(s, { id: 'req.edit', hunkId: s.selectedHunk!, label: 'ask' });
  const open = run(edited, { id: 'def.go', side: 'head', path: 'src/main/kotlin/com/example/order/api/OrderController.kt', line: 18, col: 28, name: 'execute' });
  expect(open.def?.stack[0]?.target).toMatchObject({ path: 'src/main/kotlin/com/example/order/application/ApplyDiscountUseCase.kt', line: 15 });
  const back = run(open, { id: 'escape' });
  expect(back.def).toBeNull();
  expect(back.view).toBe('req');
  expect(back.selectedHunk).toBe(s.selectedHunk);
  expect(back.requirement.editor).toEqual(edited.requirement.editor);
});


describe('requirement reading progress', () => {
  it('repeated Enter skips viewed hunks, follows chapter order, and stays on its last hunk when done', () => {
    const s = enter();
    const ids = s.analysis!.chapters![0]!.hunkIds;
    let at: AppState = { ...s, review: { ...s.review!, viewed: [ids[1]!] } };
    at = run(at, { id: 'enter' });
    expect(at.selectedHunk).toBe(ids[2]);
    expect(at.memo.pick).toBeNull();
    for (const id of ids.slice(2)) {
      expect(at.selectedHunk).toBe(id);
      at = run(at, { id: 'enter' });
    }
    expect(at.requirement.chapter).toBe(0);
    expect(at.selectedHunk).toBe(ids.at(-1));
    expect(ids.every((id) => at.review!.viewed.includes(id))).toBe(true);
    expect(run(at, { id: 'enter' }).requirement.chapter).toBe(0);
    expect(run(at, { id: 'course.forward' }).requirement.chapter).toBe(1);
  });
  it('a viewed first hunk still focuses as #1 on entry; Enter continues to the next unseen hunk', () => {
    const s = loaded();
    const ids = s.analysis!.chapters![0]!.hunkIds;
    const at = run({ ...s, review: { ...s.review!, viewed: [ids[0]!] } }, { id: 'req.go', chapter: 0 });
    expect(at.selectedHunk).toBe(ids[0]);
    expect(run(at, { id: 'enter' }).selectedHunk).toBe(ids[1]);
  });
  it('saving ask advances to next unseen hunk and opens its previously collapsed file; opinions stay', () => {
    const s = enter();
    const ids = s.analysis!.chapters![0]!.hunkIds;
    const h = s.analysis!.hunks.find((h) => h.id === ids[0])!;
    const next = s.analysis!.hunks.find((h) => h.id === ids[2])!;
    const ready = { ...s, review: { ...s.review!, viewed: [ids[1]!] }, requirement: { ...s.requirement, files: { [next.path]: false } } };
    for (const label of ['ask', 'imo'] as const) {
      const edit = run(ready, { id: 'req.edit', hunkId: h.id, label }, { id: 'memo.pick', path: h.path, side: 'RIGHT', line: h.lnNew, order: 0 }, { id: 'memo.drop' });
      const saved = run(edit, { id: 'req.save', body: '本文' });
      expect(saved.selectedHunk).toBe(label === 'ask' ? ids[2] : ids[0]);
      if (label === 'ask') expect(saved.requirement.files[next.path]).toBe(true);
      expect(saved.requirement.editor).toBeNull();
    }
  });
  it('finishing out of order returns to an earlier unseen hunk instead of reporting completion', () => {
    const s = enter();
    const ids = s.analysis!.chapters![0]!.hunkIds;
    const at = run({ ...s, review: { ...s.review!, viewed: ids.slice(1, -1) } }, { id: 'req.focus', hunkId: ids.at(-1)! }, { id: 'enter' });
    expect(at.selectedHunk).toBe(ids[0]);
    expect(at.requirement.chapter).toBe(0);
  });
});

describe('all course entry paths', () => {
  const commands: Command[] = [
    { id: 'course.forward' },
    { id: 'course.enter', courseId: 1, at: 0 },
    { id: 'route.go', page: { kind: 'course', course: 1, at: { kind: 'brief' } } },
    { id: 'route.go', page: { kind: 'course', course: 1, at: { kind: 'stop', i: 0 } } },
    { id: 'route.go', page: { kind: 'course', course: 1, at: { kind: 'summary' } } },
  ];
  it.each(commands)('%j opens requirements when chapters exist', (command) => {
    expect(run(loaded(), command)).toMatchObject({ view: 'req', requirement: { chapter: 'start' } });
  });
  it('palette callee and closing memo links cannot enter the old course', () => {
    const s = loaded();
    const symbol = s.analysis!.symbols.find((s) => s.fqName.endsWith('ApplyDiscountUseCase.execute'))!;
    expect(run(s, { id: 'palette.pick', target: { kind: 'callee', symbolId: symbol.id } }).view).toBe('req');
    const h = s.analysis!.hunks.find((h) => h.path.endsWith('OrderController.kt') && h.lnNew > 1)!;
    const c = { id: 'm1', path: h.path, line: h.lnNew, side: 'RIGHT' as const, body: 'メモ', source: 'reviewer', state: 'adopted' as const };
    const closing = { ...s, view: 'closing' as const, review: { ...s.review!, comments: [c] } };
    expect(run(closing, { id: 'comment.open', commentId: c.id, courseId: h.hows[0]! }).view).toBe('req');
  });
  it('Escape back to a remembered How course also opens requirements', () => {
    const closing = { ...loaded(), view: 'closing' as const, course: { id: 1, i: 0, screen: 'brief' as const } };
    expect(run(closing, { id: 'escape' }).view).toBe('req');
  });
});

it('explain next opens requirements even when no diffs or How courses were produced', () => {
  const s = loaded();
  const withoutHows = { ...s, analysis: { ...s.analysis!, hows: [], tours: [], hunks: [], chapters: s.analysis!.chapters!.map((c) => ({ ...c, hunkIds: [] })) } };
  expect(run(withoutHows, { id: 'course.forward' }).view).toBe('req');
});
