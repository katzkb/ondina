// 差分ごとの意図の検証。ID・引用・件数はプログラムが決める（原則 3）。
import type { Hunk, HunkIntent, IntentNote } from '../model.js';
import { quoteInSource } from '../spec/verify.js';
import type { IntentOutput, IntentSources } from './types.js';

export interface IntentResult {
  intents: HunkIntent[];
  info: string[];
}

export function applyIntents(hunks: readonly Hunk[], output: IntentOutput, sources: IntentSources): IntentResult {
  const info: string[] = [];
  const known = hunks.filter((h) => h.group === undefined || h.group.representative === h.id || h.group.deviations.includes(h.id));
  const ids = new Set(known.map((h) => h.id));
  const seen = new Set<string>();
  const byId = new Map<string, HunkIntent>();
  for (const entry of output.intents) {
    const id = entry.hunkId;
    if (!ids.has(id)) {
      info.push(`意図に不明な差分の ID（${id}）があったので除外しました`);
      continue;
    }
    if (seen.has(id)) {
      info.push(`差分 ${id} の意図が 2 回来たので最初だけ使いました`);
      continue;
    }
    seen.add(id);
    const notes: IntentNote[] = [];
    for (const note of entry.notes) {
      const text = note.text.trim();
      if (text === '') continue;
      if (note.kind !== 'written') {
        notes.push({ kind: note.kind, text });
        continue;
      }
      const quote = note.quote?.trim() ?? '';
      const from = note.from;
      // 空の本文にも当たる引用は、空白や Markdown の記号しかない。
      const hasQuote = !quoteInSource(quote, '');
      if (hasQuote && from === 'commit') {
        const candidates = note.commit === undefined ? sources.commits : sources.commits.filter((c) => note.commit !== '' && c.sha.startsWith(note.commit!));
        const found = note.commit !== undefined && candidates.length !== 1 ? undefined : candidates.find((c) => quoteInSource(quote, `${c.title}\n\n${c.body}`));
        if (found !== undefined) {
          notes.push({ kind: 'written', text, from, quote, commit: found.sha });
          continue;
        }
      } else if (hasQuote && (from === 'pr-body' || from === 'ticket' || from === 'parent')) {
        const source = from === 'pr-body' ? sources.prBody : sources[from]?.body ?? '';
        if (quoteInSource(quote, source)) {
          notes.push({ kind: 'written', text, from, quote });
          continue;
        }
      }
      notes.push({ kind: 'guess', text });
      info.push(`差分 ${id} の意図の引用を出典で確認できないので推定に変えました`);
    }
    if (notes.length === 0) continue;
    const ask = entry.ask?.trim();
    byId.set(id, { hunkId: id, notes, ...(ask && !notes.some((n) => n.kind === 'written') ? { ask } : {}) });
  }
  const intents = known.flatMap((h) => byId.has(h.id) ? [byId.get(h.id)!] : []);
  const counts = { written: 0, guess: 0, none: 0 };
  for (const i of intents) counts[i.notes.some((n) => n.kind === 'written') ? 'written' : i.notes.some((n) => n.kind === 'guess') ? 'guess' : 'none']++;
  info.push(`意図: 差分 ${intents.length} 件（書いてある ${counts.written} 件、推定 ${counts.guess} 件、書いていない ${counts.none} 件）`);
  return { intents, info };
}
