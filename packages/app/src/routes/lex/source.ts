/** Source-offset helpers (the trace carries spans; in-progress lexemes do not). */
import type { SourceSpan } from '@lab/trace';

/** Build a SourceSpan for [start, end) with its 1-based line/column. */
export function spanAt(source: string, start: number, end: number): SourceSpan {
  const from = Math.max(0, Math.min(start, source.length));
  const to = Math.max(from, Math.min(end, source.length));
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < from; i++) {
    if (source[i] === '\n') {
      line++;
      lastBreak = i;
    }
  }
  return { start: from, end: to, line, col: from - lastBreak };
}

/** The whole source line containing `span`, for error cards. */
export function lineTextAt(source: string, offset: number): string {
  const at = Math.max(0, Math.min(offset, source.length));
  let start = at;
  while (start > 0 && source[start - 1] !== '\n') start--;
  let end = at;
  while (end < source.length && source[end] !== '\n') end++;
  return source.slice(start, end);
}

/** Column of `offset` within its line, 1-based. */
export function columnAt(source: string, offset: number): number {
  const at = Math.max(0, Math.min(offset, source.length));
  let start = at;
  while (start > 0 && source[start - 1] !== '\n') start--;
  return at - start + 1;
}
