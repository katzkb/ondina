// 文は句点で改行して 1 文 1 行（2026-09-28 に決めた。括弧の中の句点では切らない。text.ts）。
import { sentences } from '../text.js';

/** className は各行の <p> に付ける（停留所のなぜここかの薄字 = why） */
export function Lines({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {sentences(text).map((l, i) => (
        <p key={i} className={className}>
          {l}
        </p>
      ))}
    </>
  );
}
