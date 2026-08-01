import type { Recorded, Reducer } from './trace.js';

/** Structural deep-equality over JSON-shaped values (order-sensitive arrays,
 *  order-insensitive object keys). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    if (Array.isArray(b) || typeof b !== 'object') return false;
    const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

export interface InvariantViolation {
  invariant: string;
  detail: string;
}

/**
 * Core replay invariants every recorded trace must satisfy:
 *  (a) folding all events from `initial` through the reducer deep-equals a
 *      caller-supplied projection of the returned artifact (catches "mutated
 *      without emitting");
 *  (b) stateAt(i) via keyframes ≡ full replay to i, for sampled i;
 *  (c) every step has a non-empty citation section and prose.
 *
 * `project` maps the algorithm's return value R to the reduced-state shape S
 * (identity when S === R).
 */
export function checkTraceInvariants<S, E extends { kind: string }, R>(
  recorded: Recorded<S, E, R>,
  reducer: Reducer<S, E>,
  project: (result: R) => S,
  sampleEvery = 17,
): InvariantViolation[] {
  const { trace, result } = recorded;
  const out: InvariantViolation[] = [];

  // (a) full replay equals projected artifact — only meaningful when not truncated
  let replayed = trace.initial;
  for (const s of trace.steps) replayed = reducer(replayed, s.event);
  if (!trace.truncated && !deepEqual(replayed, project(result))) {
    out.push({
      invariant: 'replay-equals-artifact',
      detail: `trace ${trace.id}: reduced final state !== projected result`,
    });
  }

  // (b) keyframe stateAt agrees with direct replay at sampled indices
  let direct = trace.initial;
  for (let i = 0; i <= trace.length; i++) {
    if (i > 0) direct = reducer(direct, trace.steps[i - 1]!.event);
    if (i % sampleEvery === 0 || i === trace.length) {
      if (!deepEqual(trace.stateAt(i), direct)) {
        out.push({
          invariant: 'keyframe-consistency',
          detail: `trace ${trace.id}: stateAt(${i}) diverges from direct replay`,
        });
        break;
      }
    }
  }

  // (c) citations and prose present
  for (const s of trace.steps) {
    if (!s.meta.cite?.section) {
      out.push({
        invariant: 'citation-required',
        detail: `trace ${trace.id}: step ${s.index} (${s.event.kind}) has no citation`,
      });
      break;
    }
    if (!s.meta.prose) {
      out.push({
        invariant: 'prose-required',
        detail: `trace ${trace.id}: step ${s.index} (${s.event.kind}) has no prose`,
      });
      break;
    }
  }

  return out;
}
