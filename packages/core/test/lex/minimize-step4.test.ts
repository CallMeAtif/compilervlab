/**
 * Regression tests for the parts of Algorithm 3.39 the Fig 3.36 golden never
 * exercises: Π held fixed for a whole round (step 2/3), step 4's removal of
 * unreachable and dead states, and the §3.9.7 citation of the lexical-analyzer
 * initial partition.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { runMinimize } from '../../src/lex/minimize.js';
import { minimizeReducer, projectMinDfa } from '../../src/lex/reducers.js';
import type { Dfa, DtranEntry } from '../../src/lex/types.js';

const t = (from: string, symbol: string, to: string): DtranEntry => ({ from, symbol, to });
const acc = { token: 't', priority: 0 };

/**
 * Two groups split in the same round: Π = {A,B}{C,D}; on 'a' the nonaccepting
 * group splits into {A}{B}, and only afterwards are the signatures of the
 * accepting group {C,D} computed — against the *start-of-round* Π, in which
 * group 1 is still {C,D}.
 */
const twoGroupDfa: Dfa = {
  states: [
    { id: 'A', nfaStates: [0], accept: null },
    { id: 'B', nfaStates: [1], accept: null },
    { id: 'C', nfaStates: [2], accept: acc },
    { id: 'D', nfaStates: [3], accept: acc },
  ],
  start: 'A',
  alphabet: ['a', 'b'],
  trans: [
    t('A', 'a', 'C'),
    t('A', 'b', 'B'),
    t('B', 'a', 'B'),
    t('B', 'b', 'B'),
    t('C', 'a', 'C'),
    t('C', 'b', 'D'),
    t('D', 'a', 'D'),
    t('D', 'b', 'C'),
  ],
};

describe('Algorithm 3.39 keeps Π fixed for a whole round', () => {
  const { trace, result } = runMinimize(twoGroupDfa);

  it('every SignatureCell group index names a group of the partition it was computed against', () => {
    const sigs = trace.steps.filter((s) => s.event.kind === 'signature');
    expect(sigs.length).toBeGreaterThan(0);
    for (const s of sigs) {
      const e = s.event as {
        state: string;
        group: number;
        round: number;
        row: Array<{ symbol: string; to: string; group: number }>;
      };
      const { partition } = trace.stateAt(s.index + 1);
      expect(partition[e.group], `round ${e.round}: group of ${e.state}`).toContain(e.state);
      for (const c of e.row) {
        expect(partition[c.group], `round ${e.round}: ${e.state} -${c.symbol}-> ${c.to}`).toContain(
          c.to,
        );
      }
    }
  });

  it('shows Π = {A,B}{C,D} while round 1 computes the signatures of {C,D}', () => {
    const sigC = trace.steps.find(
      (s) => s.event.kind === 'signature' && (s.event as { state: string }).state === 'C',
    )!;
    expect(sigC.event).toMatchObject({
      state: 'C',
      round: 1,
      group: 1,
      row: [
        { symbol: 'a', to: 'C', group: 1 },
        { symbol: 'b', to: 'D', group: 1 },
      ],
    });
    // The split of {A,B} happened earlier in this same round; Πnew is pending,
    // Π is not replaced until the round ends (step 3).
    const st = trace.stateAt(sigC.index + 1);
    expect(st.partition).toEqual([
      ['A', 'B'],
      ['C', 'D'],
    ]);
    expect(st.pendingPartition).toEqual([['A'], ['B'], ['C', 'D']]);
  });

  it('replaces Π by Πnew when the next round starts', () => {
    const round2 = trace.steps.find(
      (s) => s.event.kind === 'signature' && (s.event as { round: number }).round === 2,
    )!;
    expect(trace.stateAt(round2.index + 1).partition).toEqual([['A'], ['B'], ['C', 'D']]);
  });

  it('still minimizes correctly (C and D merge) and satisfies the trace invariants', () => {
    expect(result.states.map((s) => s.members)).toEqual([['A'], ['B'], ['C', 'D']]);
    expect(result.start).toBe('A');
    expect(checkTraceInvariants({ trace, result }, minimizeReducer, projectMinDfa)).toEqual([]);
  });
});

describe('Algorithm 3.39 step 4: states unreachable from the start state', () => {
  it('removes an unreachable twin instead of electing it as the representative', () => {
    const dfa: Dfa = {
      states: [
        { id: 'Z', nfaStates: [9], accept: null },
        { id: 'A', nfaStates: [0], accept: null },
        { id: 'B', nfaStates: [1], accept: acc },
      ],
      start: 'A',
      alphabet: ['a'],
      trans: [t('Z', 'a', 'B'), t('A', 'a', 'B'), t('B', 'a', 'B')],
    };
    const { trace, result } = runMinimize(dfa);
    expect(result.states).toEqual([
      { id: 'A', members: ['A'], accept: null },
      { id: 'B', members: ['B'], accept: acc },
    ]);
    expect(result.start).toBe('A');
    const pruned = trace.steps.find((s) => s.event.kind === 'unreachableRemoved')!;
    expect(pruned.event).toEqual({ kind: 'unreachableRemoved', states: ['Z'] });
    expect(checkTraceInvariants({ trace, result }, minimizeReducer, projectMinDfa)).toEqual([]);
  });

  it('keeps an unreachable state out of the minimum-state DFA even when nothing merges', () => {
    const dfa: Dfa = {
      states: [
        { id: 'A', nfaStates: [0], accept: null },
        { id: 'B', nfaStates: [1], accept: acc },
        { id: 'Z', nfaStates: [9], accept: { token: 'u', priority: 1 } },
      ],
      start: 'A',
      alphabet: ['a'],
      trans: [t('A', 'a', 'B'), t('B', 'a', 'B'), t('Z', 'a', 'Z')],
    };
    const { result } = runMinimize(dfa);
    expect(result.states.map((s) => s.id)).toEqual(['A', 'B']);
    expect(result.trans).toEqual([t('A', 'a', 'B'), t('B', 'a', 'B')]);
  });

  it('does not emit the step when every state is reachable', () => {
    const { trace } = runMinimize(twoGroupDfa);
    expect(trace.findIndex((s) => s.event.kind === 'unreachableRemoved')).toBe(-1);
  });
});

describe('Algorithm 3.39 on a DFA with no reachable accepting state', () => {
  const noAccept: Dfa = {
    states: [
      { id: 'A', nfaStates: [0], accept: null },
      { id: 'B', nfaStates: [1], accept: null },
    ],
    start: 'A',
    alphabet: ['a'],
    trans: [t('A', 'a', 'B')],
  };

  it('rejects the input with a clear error instead of crashing on an invariant', () => {
    expect(() => runMinimize(noAccept)).toThrow(/no accepting state is reachable/);
    expect(() => runMinimize(noAccept)).not.toThrow(TypeError);
  });

  it('rejects a DFA whose only accepting state is unreachable', () => {
    const unreachableAccept: Dfa = {
      states: [
        { id: 'A', nfaStates: [0], accept: null },
        { id: 'B', nfaStates: [1], accept: acc },
      ],
      start: 'A',
      alphabet: ['a'],
      trans: [t('A', 'a', 'A'), t('B', 'a', 'B')],
    };
    expect(() => runMinimize(unreachableAccept)).toThrow(/no accepting state is reachable/);
  });
});

describe('citations and prose of the minimization trace', () => {
  it('cites §3.9.7 for the lexical-analyzer initial partition and §3.9.6 elsewhere', () => {
    const { trace } = runMinimize(twoGroupDfa);
    const init = trace.steps.find((s) => s.event.kind === 'initPartition')!;
    expect(init.meta.cite.section).toBe('3.9.7');
    expect(init.meta.cite.rule).toMatch(/one group per token/);
    for (const s of trace.steps) {
      if (s.event.kind === 'initPartition') continue;
      expect(s.meta.cite.section, s.event.kind).toBe('3.9.6');
    }
  });

  it('agrees with itself about number when a group merges one or several states', () => {
    const { trace } = runMinimize(twoGroupDfa);
    const two = trace.steps.find(
      (s) => s.event.kind === 'representative' && (s.event as { members: string[] }).members.length === 2,
    )!;
    expect(two.meta.prose).toContain('state D is merged into it');

    // {A, C, D} all move to E on 'a' and stay inside the group on 'b'.
    const threeWay: Dfa = {
      states: [
        { id: 'A', nfaStates: [0], accept: null },
        { id: 'C', nfaStates: [1], accept: null },
        { id: 'D', nfaStates: [2], accept: null },
        { id: 'E', nfaStates: [3], accept: acc },
      ],
      start: 'A',
      alphabet: ['a', 'b'],
      trans: [
        t('A', 'a', 'E'),
        t('A', 'b', 'C'),
        t('C', 'a', 'E'),
        t('C', 'b', 'D'),
        t('D', 'a', 'E'),
        t('D', 'b', 'D'),
        t('E', 'a', 'E'),
        t('E', 'b', 'E'),
      ],
    };
    const rec = runMinimize(threeWay);
    expect(rec.result.states.map((s) => s.members)).toEqual([['A', 'C', 'D'], ['E']]);
    const three = rec.trace.steps.find(
      (s) => s.event.kind === 'representative' && (s.event as { members: string[] }).members.length === 3,
    )!;
    expect(three.meta.prose).toContain('states C, D are merged into it');
  });
});
