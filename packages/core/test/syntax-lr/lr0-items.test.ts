/**
 * Golden: canonical LR(0) collection for augmented Grammar 4.1 must reproduce
 * Fig 4.31 (I0–I11, kernel vs closure items) with the book's numbering.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { grammar41 } from '../../src/csubset/grammar-def.js';
import { augment } from '../../src/grammar/grammar.js';
import { lr0ItemsRun, lr0Reducer } from '../../src/grammar/lr0-items.js';
import { fmtLr0State } from './helpers.js';

const ag = augment(grammar41());

describe('LR(0) canonical collection (Fig 4.31)', () => {
  const rec = lr0ItemsRun(grammar41());
  const coll = rec.result;

  it('produces exactly the twelve states I0–I11', () => {
    expect(coll.states.length).toBe(12);
    const fmt = coll.states.map((s) => fmtLr0State(ag, s));
    expect(fmt[0]).toEqual([
      "K E' → · E",
      '  E → · E + T',
      '  E → · T',
      '  T → · T * F',
      '  T → · F',
      '  F → · ( E )',
      '  F → · id',
    ]);
    expect(fmt[1]).toEqual(["K E' → E ·", 'K E → E · + T']);
    expect(fmt[2]).toEqual(['K E → T ·', 'K T → T · * F']);
    expect(fmt[3]).toEqual(['K T → F ·']);
    expect(fmt[4]).toEqual([
      'K F → ( · E )',
      '  E → · E + T',
      '  E → · T',
      '  T → · T * F',
      '  T → · F',
      '  F → · ( E )',
      '  F → · id',
    ]);
    expect(fmt[5]).toEqual(['K F → id ·']);
    expect(fmt[6]).toEqual([
      'K E → E + · T',
      '  T → · T * F',
      '  T → · F',
      '  F → · ( E )',
      '  F → · id',
    ]);
    expect(fmt[7]).toEqual(['K T → T * · F', '  F → · ( E )', '  F → · id']);
    expect(fmt[8]).toEqual(['K F → ( E · )', 'K E → E · + T']);
    expect(fmt[9]).toEqual(['K E → E + T ·', 'K T → T · * F']);
    expect(fmt[10]).toEqual(['K T → T * F ·']);
    expect(fmt[11]).toEqual(['K F → ( E ) ·']);
  });

  it('records the GOTO transitions of Fig 4.31 in deterministic order', () => {
    expect(coll.transitions).toEqual([
      { from: 0, symbol: 'E', to: 1 },
      { from: 0, symbol: 'T', to: 2 },
      { from: 0, symbol: 'F', to: 3 },
      { from: 0, symbol: '(', to: 4 },
      { from: 0, symbol: 'id', to: 5 },
      { from: 1, symbol: '+', to: 6 },
      { from: 2, symbol: '*', to: 7 },
      { from: 4, symbol: 'E', to: 8 },
      { from: 4, symbol: 'T', to: 2 },
      { from: 4, symbol: 'F', to: 3 },
      { from: 4, symbol: '(', to: 4 },
      { from: 4, symbol: 'id', to: 5 },
      { from: 6, symbol: 'T', to: 9 },
      { from: 6, symbol: 'F', to: 3 },
      { from: 6, symbol: '(', to: 4 },
      { from: 6, symbol: 'id', to: 5 },
      { from: 7, symbol: 'F', to: 10 },
      { from: 7, symbol: '(', to: 4 },
      { from: 7, symbol: 'id', to: 5 },
      { from: 8, symbol: '+', to: 6 },
      { from: 8, symbol: ')', to: 11 },
      { from: 9, symbol: '*', to: 7 },
    ]);
  });

  it('emits closure micro-events naming the justifying item and production', () => {
    const first = rec.trace.steps.find((s) => s.event.kind === 'lr0/closureItem')!;
    expect(first.meta.level).toBe('micro');
    expect(first.meta.cite.section).toBe('4.6.2');
    expect(first.meta.prose).toContain('dot');
    if (first.event.kind === 'lr0/closureItem') {
      expect(first.event.state).toBe(0);
      expect(first.event.fromProd).toBe(ag.productions.length - 1); // from [E' → · E]
    }
  });

  it('satisfies the trace invariants', () => {
    expect(checkTraceInvariants(rec, lr0Reducer, (r) => r)).toEqual([]);
  });

  it('is deterministic (two recordings are event-identical)', () => {
    const rec2 = lr0ItemsRun(grammar41());
    expect(JSON.stringify(rec2.trace.steps)).toBe(JSON.stringify(rec.trace.steps));
  });
});
