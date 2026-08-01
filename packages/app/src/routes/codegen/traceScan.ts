/**
 * Cursor-indexed scans over a recorded trace.
 *
 * These derive nothing about the ALGORITHM — they answer purely presentational
 * questions ("which tile is the cursor inside?", "which function does this
 * step belong to?") by looking at the events the trace already recorded. The
 * artifact itself always comes from `stepper.state`.
 */
import type { StepRecord, Trace } from '@lab/trace';

/**
 * `out[cursor]` = the most recent non-null `pick(step)` among steps applied so
 * far (cursor semantics match `Trace.stateAt`: cursor i has applied steps
 * 0..i-1). Computed once per trace.
 */
export function prefixLatest<E extends { kind: string }, T>(
  trace: Trace<unknown, E>,
  pick: (step: StepRecord<E>) => T | null,
): Array<T | null> {
  const out: Array<T | null> = new Array<T | null>(trace.length + 1);
  let current: T | null = null;
  out[0] = null;
  for (let i = 0; i < trace.length; i++) {
    const step = trace.steps[i];
    if (step) {
      const v = pick(step);
      if (v !== null) current = v;
    }
    out[i + 1] = current;
  }
  return out;
}

/** Running count of `pick` matches, indexed by cursor. */
export function prefixCount<E extends { kind: string }>(
  trace: Trace<unknown, E>,
  pick: (step: StepRecord<E>) => boolean,
): number[] {
  const out = new Array<number>(trace.length + 1);
  let n = 0;
  out[0] = 0;
  for (let i = 0; i < trace.length; i++) {
    const step = trace.steps[i];
    if (step && pick(step)) n++;
    out[i + 1] = n;
  }
  return out;
}
