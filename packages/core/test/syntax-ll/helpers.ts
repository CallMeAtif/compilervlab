import { expect } from 'vitest';
import { checkTraceInvariants, type Recorded, type Reducer } from '@lab/trace';

/** Sort a symbol set the same way the algorithms do (code-unit order, ε last). */
export function sorted(syms: string[]): string[] {
  return [...syms].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Assert the three core replay invariants hold for a recorded trace. */
export function expectInvariants<S, E extends { kind: string }, R>(
  recorded: Recorded<S, E, R>,
  reducer: Reducer<S, E>,
  project: (r: R) => S,
): void {
  const violations = checkTraceInvariants(recorded, reducer, project);
  expect(violations).toEqual([]);
}

/** Assert two recordings produced identical event/meta sequences. */
export function expectSameTrace<S, E extends { kind: string }, R>(
  a: Recorded<S, E, R>,
  b: Recorded<S, E, R>,
): void {
  expect(a.trace.length).toBe(b.trace.length);
  expect(JSON.stringify(a.trace.steps)).toBe(JSON.stringify(b.trace.steps));
  expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
}
