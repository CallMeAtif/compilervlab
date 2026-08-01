/**
 * Golden: SLR table for Grammar 4.1 must reproduce Fig 4.37 cell-for-cell
 * (s5/r4 notation, r-numbers matching the book's 1-based production numbers),
 * FOLLOW sets included. Conflict behaviour is checked on the non-SLR
 * L = R grammar of Example 4.48 (Grammar 4.49).
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { grammar41 } from '../../src/csubset/grammar-def.js';
import { grammarFromRules } from '../../src/grammar/grammar.js';
import { slrReducer, slrTableRun } from '../../src/grammar/slr-table.js';
import { fmtActionTable } from './helpers.js';

describe('SLR table for Grammar 4.1 (Fig 4.37)', () => {
  const rec = slrTableRun(grammar41());
  const t = rec.result;

  it('computes the FOLLOW sets of the running example', () => {
    expect(t.follow).toEqual({
      E: ['+', ')', '$'],
      T: ['+', '*', ')', '$'],
      F: ['+', '*', ')', '$'],
    });
  });

  it('matches the ACTION table cell-for-cell', () => {
    expect(fmtActionTable(t.action)).toEqual([
      { id: 's5', '(': 's4' }, // 0
      { '+': 's6', $: 'acc' }, // 1
      { '+': 'r2', '*': 's7', ')': 'r2', $: 'r2' }, // 2
      { '+': 'r4', '*': 'r4', ')': 'r4', $: 'r4' }, // 3
      { id: 's5', '(': 's4' }, // 4
      { '+': 'r6', '*': 'r6', ')': 'r6', $: 'r6' }, // 5
      { id: 's5', '(': 's4' }, // 6
      { id: 's5', '(': 's4' }, // 7
      { '+': 's6', ')': 's11' }, // 8
      { '+': 'r1', '*': 's7', ')': 'r1', $: 'r1' }, // 9
      { '+': 'r3', '*': 'r3', ')': 'r3', $: 'r3' }, // 10
      { '+': 'r5', '*': 'r5', ')': 'r5', $: 'r5' }, // 11
    ]);
  });

  it('matches the GOTO table cell-for-cell', () => {
    expect(t.goto).toEqual([
      { E: 1, T: 2, F: 3 },
      {},
      {},
      {},
      { E: 8, T: 2, F: 3 },
      {},
      { T: 9, F: 3 },
      { F: 10 },
      {},
      {},
      {},
      {},
    ]);
  });

  it('has no conflicts (Grammar 4.1 is SLR(1))', () => {
    expect(t.conflicts).toEqual([]);
  });

  it('justifies entries per Algorithm 4.46 in the step prose', () => {
    const shiftStep = rec.trace.steps.find(
      (s) => s.event.kind === 'table/action' && s.event.action.type === 'shift',
    )!;
    expect(shiftStep.meta.prose).toContain('GOTO');
    const reduceStep = rec.trace.steps.find(
      (s) => s.event.kind === 'table/action' && s.event.action.type === 'reduce',
    )!;
    expect(reduceStep.meta.prose).toContain('FOLLOW');
    const acceptStep = rec.trace.steps.find(
      (s) => s.event.kind === 'table/action' && s.event.action.type === 'accept',
    )!;
    expect(acceptStep.meta.prose).toContain('augmented');
  });

  it('satisfies the trace invariants', () => {
    expect(checkTraceInvariants(rec, slrReducer, (r) => r)).toEqual([]);
  });

  it('is deterministic', () => {
    const rec2 = slrTableRun(grammar41());
    expect(JSON.stringify(rec2.trace.steps)).toBe(JSON.stringify(rec.trace.steps));
  });
});

describe('SLR conflicts on the L = R grammar (Example 4.48)', () => {
  const g449 = grammarFromRules(
    'Dragon 4.49 (L = R)',
    ['S -> L = R | R', 'L -> * R | id', 'R -> L'],
    ['=', '*', 'id'],
  );
  const rec = slrTableRun(g449);

  it('detects the shift/reduce conflict on = and names both actions', () => {
    expect(rec.result.conflicts.length).toBe(1);
    const c = rec.result.conflicts[0]!;
    expect(c.kind).toBe('shift/reduce');
    expect(c.symbol).toBe('=');
    expect(c.resolution).toBeNull();
    expect(c.actions.map((a) => a.type).sort()).toEqual(['reduce', 'shift']);
    expect(c.items.join(' ')).toContain('R → L ·');
    expect(c.items.join(' ')).toContain('S → L · = R');
  });

  it('explains the conflict educationally in the step prose', () => {
    const step = rec.trace.steps.find((s) => s.event.kind === 'table/conflict')!;
    expect(step.meta.level).toBe('macro');
    expect(step.meta.prose).toContain('not SLR(1)');
  });

  it('still satisfies the trace invariants', () => {
    expect(checkTraceInvariants(rec, slrReducer, (r) => r)).toEqual([]);
  });
});
