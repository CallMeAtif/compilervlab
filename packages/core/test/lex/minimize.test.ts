/**
 * Golden test: minimizing the DFA of Fig 3.36 (Algorithm 3.39, §3.9.6) must
 * merge A and C and yield the 4-state DFA of Fig 3.65, via initial partition
 * {A,B,C,D}{E} and the splits of Example 3.41.
 */
import { describe, expect, it } from 'vitest';
import { cat, lit, oneOf, resetRegexIds, star } from '../../src/csubset/regex.js';
import { runMinimize } from '../../src/lex/minimize.js';
import { runSubsetConstruction } from '../../src/lex/subset-construction.js';
import { runThompson } from '../../src/lex/thompson.js';
import { toMultiNfa } from '../../src/lex/types.js';

function fig336Dfa() {
  resetRegexIds();
  const nfa = runThompson(cat(star(oneOf('ab')), lit('abb'))).result;
  return runSubsetConstruction(toMultiNfa(nfa)).result;
}

describe('DFA minimization (Algorithm 3.39, §3.9.6)', () => {
  const { trace, result: min } = runMinimize(fig336Dfa());

  it('starts from the initial partition {A,B,C,D} {E}', () => {
    const init = trace.steps.find((s) => s.event.kind === 'initPartition')!.event as {
      groups: Array<{ states: string[] }>;
    };
    expect(init.groups.map((g) => g.states)).toEqual([['A', 'B', 'C', 'D'], ['E']]);
  });

  it('splits {A,B,C,D} on b into {A,B,C}{D}, then {A,B,C} on b into {A,C}{B}', () => {
    const splits = trace.steps
      .filter((s) => s.event.kind === 'split')
      .map((s) => s.event as { round: number; from: string[]; into: string[][]; symbol: string });
    expect(splits).toEqual([
      { kind: 'split', round: 1, from: ['A', 'B', 'C', 'D'], into: [['A', 'B', 'C'], ['D']], symbol: 'b' },
      { kind: 'split', round: 2, from: ['A', 'B', 'C'], into: [['A', 'C'], ['B']], symbol: 'b' },
    ]);
  });

  it('reaches the fixpoint {A,C}{B}{D}{E} in round 3', () => {
    const fix = trace.steps.find((s) => s.event.kind === 'fixpoint')!.event as { rounds: number };
    expect(fix.rounds).toBe(3);
    expect(min.rounds).toBe(3);
    expect(min.states.map((s) => s.members)).toEqual([['A', 'C'], ['B'], ['D'], ['E']]);
  });

  it('merges A and C: representatives A, B, D, E', () => {
    expect(min.states.map((s) => s.id)).toEqual(['A', 'B', 'D', 'E']);
    expect(min.start).toBe('A');
    expect(min.states.map((s) => s.accept !== null)).toEqual([false, false, false, true]);
  });

  it('yields exactly the 4-state transition table of Fig 3.65', () => {
    expect(min.trans).toEqual([
      { from: 'A', symbol: 'a', to: 'B' },
      { from: 'A', symbol: 'b', to: 'A' },
      { from: 'B', symbol: 'a', to: 'B' },
      { from: 'B', symbol: 'b', to: 'D' },
      { from: 'D', symbol: 'a', to: 'B' },
      { from: 'D', symbol: 'b', to: 'E' },
      { from: 'E', symbol: 'a', to: 'B' },
      { from: 'E', symbol: 'b', to: 'A' },
    ]);
  });

  it('does not need a dead state on this total DFA', () => {
    expect(trace.findIndex((s) => s.event.kind === 'deadStateAdded')).toBe(-1);
  });
});
