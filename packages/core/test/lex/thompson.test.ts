/**
 * Golden test: Thompson's construction (Algorithm 3.23) on (a|b)*abb must
 * reproduce the 11-state NFA of Fig 3.34 exactly — same state numbers, same
 * edge structure, start 0, accepting 10.
 */
import { describe, expect, it } from 'vitest';
import { cat, lit, oneOf, resetRegexIds, star } from '../../src/csubset/regex.js';
import { runThompson } from '../../src/lex/thompson.js';
import type { NfaEdge } from '../../src/lex/types.js';

const EPS = null;

/** Fig 3.34, transcribed edge-for-edge. */
const FIG_3_34_EDGES: NfaEdge[] = [
  { from: 0, to: 1, label: EPS },
  { from: 0, to: 7, label: EPS },
  { from: 1, to: 2, label: EPS },
  { from: 1, to: 4, label: EPS },
  { from: 2, to: 3, label: 'a' },
  { from: 3, to: 6, label: EPS },
  { from: 4, to: 5, label: 'b' },
  { from: 5, to: 6, label: EPS },
  { from: 6, to: 1, label: EPS },
  { from: 6, to: 7, label: EPS },
  { from: 7, to: 8, label: 'a' },
  { from: 8, to: 9, label: 'b' },
  { from: 9, to: 10, label: 'b' },
];

const edgeSort = (a: NfaEdge, b: NfaEdge): number =>
  a.from - b.from || a.to - b.to || String(a.label).localeCompare(String(b.label));

function fig334Regex() {
  resetRegexIds();
  return cat(star(oneOf('ab')), lit('abb'));
}

describe('Thompson construction (Algorithm 3.23, §3.7.4)', () => {
  it('builds exactly the 11-state NFA of Fig 3.34 for (a|b)*abb', () => {
    const { result } = runThompson(fig334Regex());
    expect(result.states).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.start).toBe(0);
    expect(result.accept).toBe(10);
    expect([...result.edges].sort(edgeSort)).toEqual([...FIG_3_34_EDGES].sort(edgeSort));
  });

  it('emits one event per basis/induction case, bottom-up', () => {
    const { trace } = runThompson(fig334Regex());
    expect(trace.steps.map((s) => s.event.kind)).toEqual([
      'leafChar', // a  (states 2,3)
      'leafChar', // b  (states 4,5)
      'union', // a|b (states 1,6)
      'star', // (a|b)* (states 0,7)
      'leafChar', // a  (state 8, start merged into 7)
      'leafChar', // b  (state 9)
      'concat', // ab
      'leafChar', // b  (state 10)
      'concat', // abb  (nested lit('abb'))
      'concat', // (a|b)* · abb
      'complete',
    ]);
    const star = trace.steps.find((s) => s.event.kind === 'star')!.event;
    expect(star).toMatchObject({ start: 0, end: 7, innerStart: 1, innerEnd: 6 });
    const union = trace.steps.find((s) => s.event.kind === 'union')!.event;
    expect(union).toMatchObject({ start: 1, end: 6, leftStart: 2, leftEnd: 3, rightStart: 4, rightEnd: 5 });
  });

  it('merges the accepting state of N(s) with the start of N(t) for concatenation', () => {
    const { trace } = runThompson(fig334Regex());
    const firstLeafAfterStar = trace.steps[4]!.event;
    // The 'a' of abb starts at the star's accepting state 7 and creates only state 8.
    expect(firstLeafAfterStar).toMatchObject({ kind: 'leafChar', ch: 'a', start: 7, end: 8, createdStates: [8] });
  });
});
