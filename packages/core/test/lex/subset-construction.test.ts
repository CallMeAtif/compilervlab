/**
 * Golden test: the subset construction (Algorithm 3.20, ε-closure per
 * Fig 3.33) on the NFA of Fig 3.34 must reproduce Fig 3.36 (the five
 * D-states A–E and their NFA-state sets) and Fig 3.37 (the Dtran table).
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { cat, lit, oneOf, resetRegexIds, star } from '../../src/csubset/regex.js';
import { projectDfa, subsetReducer } from '../../src/lex/reducers.js';
import { runSubsetConstruction } from '../../src/lex/subset-construction.js';
import { runThompson } from '../../src/lex/thompson.js';
import { toMultiNfa } from '../../src/lex/types.js';

function fig334Nfa() {
  resetRegexIds();
  return runThompson(cat(star(oneOf('ab')), lit('abb'))).result;
}

describe('Subset construction (Algorithm 3.20, §3.7.1)', () => {
  const { trace, result: dfa } = runSubsetConstruction(toMultiNfa(fig334Nfa()));

  it('reproduces the D-states of Fig 3.36 in creation order', () => {
    expect(dfa.states.map((s) => [s.id, s.nfaStates])).toEqual([
      ['A', [0, 1, 2, 4, 7]],
      ['B', [1, 2, 3, 4, 6, 7, 8]],
      ['C', [1, 2, 4, 5, 6, 7]],
      ['D', [1, 2, 4, 5, 6, 7, 9]],
      ['E', [1, 2, 4, 5, 6, 7, 10]],
    ]);
    expect(dfa.start).toBe('A');
    expect(dfa.alphabet).toEqual(['a', 'b']);
  });

  it('marks only E accepting (it contains NFA state 10)', () => {
    expect(dfa.states.map((s) => [s.id, s.accept !== null])).toEqual([
      ['A', false],
      ['B', false],
      ['C', false],
      ['D', false],
      ['E', true],
    ]);
  });

  it('reproduces the Dtran table of Fig 3.37, row by row', () => {
    expect(dfa.trans).toEqual([
      { from: 'A', symbol: 'a', to: 'B' },
      { from: 'A', symbol: 'b', to: 'C' },
      { from: 'B', symbol: 'a', to: 'B' },
      { from: 'B', symbol: 'b', to: 'D' },
      { from: 'C', symbol: 'a', to: 'B' },
      { from: 'C', symbol: 'b', to: 'C' },
      { from: 'D', symbol: 'a', to: 'B' },
      { from: 'D', symbol: 'b', to: 'E' },
      { from: 'E', symbol: 'a', to: 'B' },
      { from: 'E', symbol: 'b', to: 'C' },
    ]);
  });

  it('computes ε-closure({0}) = {0,1,2,4,7} with the stack algorithm of Fig 3.33', () => {
    const init = trace.steps.find((s) => s.event.kind === 'eclosureInit')!;
    expect(init.event).toMatchObject({ input: [0], closure: [0] });
    const startCreated = trace.steps.find((s) => s.event.kind === 'dstateCreated')!;
    expect(startCreated.event).toMatchObject({ id: 'A', nfaStates: [0, 1, 2, 4, 7], isStart: true });
    // ε-closure micro steps are grouped and cite Fig 3.33
    const micros = trace.steps.filter((s) => s.event.kind.startsWith('eclosure'));
    for (const s of micros) {
      expect(s.meta.level).toBe('micro');
      expect(s.meta.groupId).toBeTruthy();
      expect(s.meta.cite.figureOrAlgo).toBe('Fig 3.33');
    }
  });

  it('marks D-states in FIFO creation order A, B, C, D, E', () => {
    const marked = trace.steps.filter((s) => s.event.kind === 'dstateMarked').map((s) => (s.event as { id: string }).id);
    expect(marked).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('needs no ∅ move: the DFA of Fig 3.37 is total, so no step is skipped', () => {
    expect(trace.steps.filter((s) => s.event.kind === 'emptyMove')).toEqual([]);
  });
});

/**
 * Fig 3.32's loop is unconditional: it computes U = ε-closure(move(T, a)) for
 * every symbol, and when move(T, a) = ∅ that U is the empty set — the dead
 * state. The lab keeps Dtran partial (§3.9.6 eliminates the dead state again
 * anyway, and §3.8.3's simulation needs "no next state"), but the step the book
 * performs must not vanish from the trace.
 */
describe('Algorithm 3.20 on a partial DFA: the ∅ move is recorded, not skipped', () => {
  function abbDfa() {
    resetRegexIds();
    return runSubsetConstruction(toMultiNfa(runThompson(lit('abb')).result));
  }

  it('records one step for every cell of Dtran the empty move leaves undefined', () => {
    const { trace, result: dfa } = abbDfa();
    // 4 D-states × 2 symbols = 8 cells, only 3 of which have a move.
    expect(dfa.states.map((s) => s.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(dfa.trans).toEqual([
      { from: 'A', symbol: 'a', to: 'B' },
      { from: 'B', symbol: 'b', to: 'C' },
      { from: 'C', symbol: 'b', to: 'D' },
    ]);
    const empties = trace.steps
      .filter((s) => s.event.kind === 'emptyMove')
      .map((s) => s.event as { from: string; symbol: string });
    expect(empties).toEqual([
      { kind: 'emptyMove', from: 'A', symbol: 'b' },
      { kind: 'emptyMove', from: 'B', symbol: 'a' },
      { kind: 'emptyMove', from: 'C', symbol: 'a' },
      { kind: 'emptyMove', from: 'D', symbol: 'a' },
      { kind: 'emptyMove', from: 'D', symbol: 'b' },
    ]);
    // Every (state, symbol) pair is accounted for by exactly one of the two.
    expect(empties.length + dfa.trans.length).toBe(dfa.states.length * dfa.alphabet.length);
  });

  it('explains the ∅ state and cites Algorithm 3.20, without adding a D-state for it', () => {
    const { trace, result: dfa } = abbDfa();
    const first = trace.steps.find((s) => s.event.kind === 'emptyMove')!;
    expect(first.meta.cite.figureOrAlgo).toBe('Algorithm 3.20');
    expect(first.meta.prose).toContain('move(A, b) = ∅');
    expect(first.meta.prose).toContain('dead state');
    expect(first.meta.level).toBe('macro');
    expect(dfa.states.map((s) => s.nfaStates)).not.toContainEqual([]);
  });

  it('leaves the reduced state and the replay invariant untouched', () => {
    const rec = abbDfa();
    const empty = rec.trace.steps.find((s) => s.event.kind === 'emptyMove')!;
    // The step is informational: no D-state, no Dtran entry is added by it.
    expect(rec.trace.stateAt(empty.index + 1).trans).toEqual(
      rec.trace.stateAt(empty.index).trans,
    );
    expect(checkTraceInvariants(rec, subsetReducer, projectDfa)).toEqual([]);
  });
});
