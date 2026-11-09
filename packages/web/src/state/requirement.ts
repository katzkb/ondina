import type { Analysis, ReviewState } from '@ondina/model';
import type { Command } from '../commands/commands.js';
import { newMemo } from '../memo.js';
import { intentOf, NO_REQUIREMENT, requirementFiles, requirementPick, type RequirementChapter } from '../requirement.js';
import { NO_MEMO, type AppState, type Reduced } from './reducer.js';

type Loaded = AppState & { analysis: Analysis; review: ReviewState };
const none = (state: AppState): Reduced => ({ state, effects: [] });
export function requirementGo(state: Loaded, chapter: RequirementChapter): Reduced {
  const chapters = state.analysis.chapters;
  if (!chapters || (typeof chapter === 'number' && (!Number.isInteger(chapter) || !chapters[chapter]))) return none(state);
  const id = typeof chapter === 'number' ? chapters[chapter]!.hunkIds[0] ?? null : null;
  const hunk = state.analysis.hunks.find((h) => h.id === id);
  return none({ ...state, view: 'req', requirement: { ...NO_REQUIREMENT, chapter, narrow: state.requirement.narrow, focusN: state.requirement.focusN + 1 }, course: null, courseMap: null, selectedHunk: id, selectedFile: hunk?.path ?? null, memo: NO_MEMO, peek: null });
}

/** 済んだ場所の次から読む順に探す。先に飛ばした未確認の場所があれば先頭へ戻り、全部済みならその場に残る。 */
function afterReviewed(state: Loaded, hunkId: string, viewed: readonly string[]): Loaded {
  const chapter = typeof state.requirement.chapter === 'number' ? state.analysis.chapters?.[state.requirement.chapter] : undefined;
  if (!chapter) return state;
  const at = chapter.hunkIds.indexOf(hunkId);
  const ids = [...chapter.hunkIds.slice(at + 1), ...chapter.hunkIds.slice(0, at + 1)];
  const done = new Set(viewed);
  const next = ids.find((id) => !done.has(id)) ?? hunkId;
  const hunk = state.analysis.hunks.find((h) => h.id === next);
  return {
    ...state, selectedHunk: next, selectedFile: hunk?.path ?? null, memo: NO_MEMO,
    requirement: { ...state.requirement, editor: null, focusN: state.requirement.focusN + 1, files: hunk ? { ...state.requirement.files, [hunk.path]: true } : state.requirement.files },
  };
}

export function requirementCommand(state: Loaded, command: Command): Reduced | null {
  if (command.id === 'req.goHunk') {
    const index = state.analysis.chapters?.findIndex((c) => c.hunkIds.includes(command.hunkId)) ?? -1;
    const hunk = state.analysis.hunks.find((h) => h.id === command.hunkId);
    if (index < 0 || !hunk) return none(state);
    const moved = requirementGo(state, index);
    return none({ ...moved.state, selectedHunk: hunk.id, selectedFile: hunk.path, requirement: { ...moved.state.requirement, files: { [hunk.path]: true } } });
  }
  if (command.id === 'req.go') return requirementGo(state, command.chapter);
  if (state.analysis.chapters && (command.id === 'course.enter' || command.id === 'view.course' || (command.id === 'enter' && state.view === 'home'))) {
    return requirementGo(state, 'start');
  }
  if (!state.analysis.chapters || (state.view !== 'req' && !command.id.startsWith('req.'))) return null;
  const req = state.requirement;
  const chapter = typeof req.chapter === 'number' ? state.analysis.chapters[req.chapter] : undefined;
  const save = (s: Loaded, review: ReviewState): Reduced => ({ state: { ...s, review }, effects: [{ type: 'saveState' }] });
  const moveChapter = (dir: 1 | -1) => {
    const at = req.chapter === 'start' ? -1 : req.chapter === 'end' ? state.analysis.chapters!.length : req.chapter;
    const next = Math.max(-1, Math.min(state.analysis.chapters!.length, at + dir));
    return requirementGo(state, next < 0 ? 'start' : next === state.analysis.chapters!.length ? 'end' : next);
  };
  switch (command.id) {
    case 'req.narrow':
    case 'file.full':
      return state.view === 'req' && chapter && chapter.hunkIds.length > 0 ? none({ ...state, requirement: { ...req, narrow: !req.narrow } }) : none(state);
    case 'req.nextChapter':
    case 'course.forward': return moveChapter(1);
    case 'req.prevChapter':
    case 'course.prev': return moveChapter(-1);
    case 'hunk.next':
    case 'hunk.prev': {
      const dir = command.id === 'hunk.next' ? 1 : -1;
      const ids = chapter?.hunkIds ?? [];
      const at = ids.indexOf(state.selectedHunk ?? '');
      const id = ids[at + dir];
      if (id === undefined) return moveChapter(dir);
      const h = state.analysis.hunks.find((h) => h.id === id);
      return none({ ...state, selectedHunk: id, selectedFile: h?.path ?? null, memo: NO_MEMO, requirement: { ...req, editor: null, focusN: req.focusN + 1, files: h ? { ...req.files, [h.path]: true } : req.files } });
    }
    case 'req.focus': {
      if (!chapter?.hunkIds.includes(command.hunkId)) return none(state);
      const h = state.analysis.hunks.find((h) => h.id === command.hunkId);
      return none({ ...state, selectedHunk: command.hunkId, selectedFile: h?.path ?? null, memo: NO_MEMO, requirement: { ...req, editor: null, focusN: req.focusN + 1, files: h ? { ...req.files, [h.path]: true } : req.files } });
    }
    case 'enter':
    case 'req.ok': {
      const id = command.id === 'req.ok' ? command.hunkId : state.selectedHunk;
      if (id === null) return command.id === 'enter' && req.chapter === 'start' ? moveChapter(1) : none(state);
      if (!chapter?.hunkIds.includes(id)) return none(state);
      const viewed = state.review.viewed.includes(id) ? state.review.viewed : [...state.review.viewed, id];
      const next = afterReviewed(state, id, viewed);
      return viewed === state.review.viewed ? none(next) : save(next, { ...state.review, viewed });
    }
    case 'req.undo':
      return save(state, { ...state.review, viewed: state.review.viewed.filter((id) => id !== command.hunkId) });
    case 'req.file.unview': {
      const ids = new Set(state.analysis.hunks.filter((h) => h.path === command.path).map((h) => h.id));
      return save(state, { ...state.review, viewed: state.review.viewed.filter((id) => !ids.has(id)) });
    }
    case 'file.next':
    case 'file.prev': {
      const files = requirementFiles(state.analysis);
      if (files.length === 0) return req.narrow ? none({ ...state, requirement: { ...req, narrow: false } }) : none(state);
      const at = files.findIndex((f) => f.path === (req.scroll?.path ?? state.selectedFile));
      const dir = command.id === 'file.next' ? 1 : -1;
      const path = files[(at + dir + files.length) % files.length]!.path;
      return none({ ...state, requirement: { ...req, narrow: false, files: { ...req.files, [path]: true }, scroll: { path, n: (req.scroll?.n ?? 0) + 1 } } });
    }
    case 'req.file':
      return none({ ...state, requirement: { ...req, narrow: false, files: { ...req.files, [command.path]: true }, scroll: { path: command.path, n: (req.scroll?.n ?? 0) + 1 } } });
    case 'req.toggleFile':
      return none({ ...state, memo: NO_MEMO, requirement: { ...req, editor: null, files: { ...req.files, [command.path]: !command.open } } });
    case 'req.toggleHunk':
      return none({ ...state, memo: NO_MEMO, requirement: { ...req, editor: null, openHunks: req.openHunks.includes(command.hunkId) ? req.openHunks.filter((id) => id !== command.hunkId) : [...req.openHunks, command.hunkId] } });
    case 'req.edit': {
      const h = state.analysis.hunks.find((h) => h.id === command.hunkId);
      if (!h) return none(state);
      const pick = requirementPick(state.analysis, h.id, state.memo.pick) ? state.memo.pick : null;
      return none({ ...state, requirement: { ...req, editor: { hunkId: h.id, label: command.label } }, memo: { ...NO_MEMO, pick, draft: command.label === 'ask' ? intentOf(state.analysis, h)?.ask ?? '' : '' } });
    }
    case 'memo.cancel':
      return none({ ...state, memo: NO_MEMO, requirement: { ...req, editor: null } });
    case 'req.save': {
      const e = req.editor;
      if (!e || !state.memo.pick || !requirementPick(state.analysis, e.hunkId, state.memo.pick) || !command.body.trim()) return none(state);
      const draft = { ...newMemo(state.review.comments, state.memo.pick, command.body), label: e.label };
      const viewed = e.label === 'ask' && !state.review.viewed.includes(e.hunkId) ? [...state.review.viewed, e.hunkId] : state.review.viewed;
      const closed = { ...state, requirement: { ...req, editor: null }, memo: NO_MEMO };
      const next = e.label === 'ask' ? afterReviewed(closed, e.hunkId, viewed) : closed;
      return save(next, { ...state.review, comments: [...state.review.comments, draft], viewed });
    }
    default: return null;
  }
}
