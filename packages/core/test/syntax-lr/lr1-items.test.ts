/**
 * Golden: canonical LR(1) collection for Grammar 4.55 must reproduce the ten
 * item sets I0–I9 of Fig 4.41 with exact lookaheads, and the canonical LR(1)
 * table must match Fig 4.42. Also checks the educational maxStates cap.
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { cGrammar, grammar455 } from '../../src/csubset/grammar-def.js';
import { augment } from '../../src/grammar/grammar.js';
import {
  Lr1StateCapError,
  lr1Items,
  lr1ItemsRun,
  lr1Reducer,
  lr1Table,
  lr1TableReducer,
  lr1TableRun,
} from '../../src/grammar/lr1-items.js';
import { lalrSteps } from '../../src/grammar/lalr.js';
import { drain } from '../../src/grammar/lr-events.js';
import { fmtActionTable, fmtLr1StateMerged } from './helpers.js';

const ag = augment(grammar455());

describe('canonical LR(1) collection for Grammar 4.55 (Fig 4.41)', () => {
  const rec = lr1ItemsRun(grammar455());
  const coll = rec.result;

  it('produces exactly the ten item sets with the book lookaheads', () => {
    expect(coll.truncated).toBe(false);
    expect(coll.states.length).toBe(10);
    const fmt = coll.states.map((s) => fmtLr1StateMerged(ag, s));
    expect(fmt[0]).toEqual([
      "K S' → · S, $",
      '  S → · C C, $',
      '  C → · c C, c/d',
      '  C → · d, c/d',
    ]);
    expect(fmt[1]).toEqual(["K S' → S ·, $"]);
    expect(fmt[2]).toEqual(['K S → C · C, $', '  C → · c C, $', '  C → · d, $']);
    expect(fmt[3]).toEqual([
      'K C → c · C, c/d',
      '  C → · c C, c/d',
      '  C → · d, c/d',
    ]);
    expect(fmt[4]).toEqual(['K C → d ·, c/d']);
    expect(fmt[5]).toEqual(['K S → C C ·, $']);
    expect(fmt[6]).toEqual(['K C → c · C, $', '  C → · c C, $', '  C → · d, $']);
    expect(fmt[7]).toEqual(['K C → d ·, $']);
    expect(fmt[8]).toEqual(['K C → c C ·, c/d']);
    expect(fmt[9]).toEqual(['K C → c C ·, $']);
  });

  it('records the GOTO graph of Fig 4.41', () => {
    expect(coll.transitions).toEqual([
      { from: 0, symbol: 'S', to: 1 },
      { from: 0, symbol: 'C', to: 2 },
      { from: 0, symbol: 'c', to: 3 },
      { from: 0, symbol: 'd', to: 4 },
      { from: 2, symbol: 'C', to: 5 },
      { from: 2, symbol: 'c', to: 6 },
      { from: 2, symbol: 'd', to: 7 },
      { from: 3, symbol: 'C', to: 8 },
      { from: 3, symbol: 'c', to: 3 },
      { from: 3, symbol: 'd', to: 4 },
      { from: 6, symbol: 'C', to: 9 },
      { from: 6, symbol: 'c', to: 6 },
      { from: 6, symbol: 'd', to: 7 },
    ]);
  });

  it('cites FIRST(βa) as the lookahead provenance on closure micro-steps', () => {
    const step = rec.trace.steps.find((s) => s.event.kind === 'lr1/closureItem')!;
    expect(step.meta.level).toBe('micro');
    expect(step.meta.prose).toContain('FIRST');
    expect(step.meta.prose).toContain('∈ FIRST(βa)');
    if (step.event.kind === 'lr1/closureItem') {
      expect(step.event.firstOf.length).toBeGreaterThan(0);
    }
  });

  it('satisfies the trace invariants', () => {
    expect(checkTraceInvariants(rec, lr1Reducer, (r) => r)).toEqual([]);
  });

  it('is deterministic', () => {
    const rec2 = lr1ItemsRun(grammar455());
    expect(JSON.stringify(rec2.trace.steps)).toBe(JSON.stringify(rec.trace.steps));
  });
});

describe('canonical LR(1) table for Grammar 4.55 (Fig 4.42)', () => {
  const rec = lr1TableRun(grammar455());
  const t = rec.result;

  it('matches the ACTION table cell-for-cell', () => {
    expect(fmtActionTable(t.action)).toEqual([
      { c: 's3', d: 's4' }, // 0
      { $: 'acc' }, // 1
      { c: 's6', d: 's7' }, // 2
      { c: 's3', d: 's4' }, // 3
      { c: 'r3', d: 'r3' }, // 4
      { $: 'r1' }, // 5
      { c: 's6', d: 's7' }, // 6
      { $: 'r3' }, // 7
      { c: 'r2', d: 'r2' }, // 8
      { $: 'r2' }, // 9
    ]);
  });

  it('matches the GOTO table and has no conflicts', () => {
    expect(t.goto).toEqual([
      { S: 1, C: 2 },
      {},
      { C: 5 },
      { C: 8 },
      {},
      {},
      { C: 9 },
      {},
      {},
      {},
    ]);
    expect(t.conflicts).toEqual([]);
  });

  it('satisfies the trace invariants', () => {
    expect(checkTraceInvariants(rec, lr1TableReducer, (r) => r)).toEqual([]);
  });
});

describe('educational state cap', () => {
  it('stops the C grammar at maxStates with a truncation event citing LALR', () => {
    const rec = lr1ItemsRun(cGrammar(), { maxStates: 50 });
    expect(rec.result.truncated).toBe(true);
    expect(rec.result.states.length).toBe(50);
    const last = rec.trace.steps[rec.trace.steps.length - 1]!;
    expect(last.event.kind).toBe('lr1/truncated');
    expect(last.meta.prose).toContain('why LALR exists');
    expect(checkTraceInvariants(rec, lr1Reducer, (r) => r)).toEqual([]);
  });

  it('counts the initial state against the cap (maxStates: 0 builds nothing)', () => {
    const coll = drain(lr1Items(cGrammar(), { maxStates: 0 }));
    expect(coll.truncated).toBe(true);
    expect(coll.states).toEqual([]);
    expect(coll.transitions).toEqual([]);
  });

  it('reports the cap as truncation, not as an internal fault, when a table needs the whole collection', () => {
    for (const build of [
      () => drain(lr1Table(cGrammar(), { maxStates: 50 })),
      () => drain(lalrSteps(cGrammar(), { maxLr1States: 50 })),
    ]) {
      let thrown: unknown;
      try {
        build();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Lr1StateCapError);
      const err = thrown as Lr1StateCapError;
      expect(err.statesBuilt).toBe(50);
      expect(err.maxStates).toBe(50);
      expect(err.grammarName).toBe(cGrammar().name);
      // The §4.7.4 lesson, not a bug report.
      expect(err.hint).toContain('why LALR exists');
      expect(err.rule).toContain('canonical LR');
    }
  });
});
