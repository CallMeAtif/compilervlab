/**
 * Regression guards for the conflict reporting of the shared ACTION/GOTO
 * builder (lr-events.ts), which SLR, canonical LR(1) and LALR all go through:
 *
 *  1. a cell claimed by three demands must report EVERY distinct clash — a
 *     merge-introduced reduce/reduce must not be hidden because a shift
 *     happened to be scanned first (§4.7.4 is the whole point of the phase);
 *  2. exactly one record per (conflicted cell, kind) — the lookahead-split
 *     copies of one shift item in LR(1)/LALR all demand the same shift and
 *     must not multiply the conflict count relative to SLR;
 *  3. accept vs reduce is an accept/reduce conflict (the reduce/reduce-family
 *     clash against [S' → S ·]), never 'shift/reduce', and its prose must not
 *     talk about a shift that does not exist.
 */
import { describe, expect, it } from 'vitest';
import { cGrammar } from '../../src/csubset/grammar-def.js';
import { grammarFromRules } from '../../src/grammar/grammar.js';
import { drain, type LrConflictJson } from '../../src/grammar/lr-events.js';
import { lalrRun, lalrSteps } from '../../src/grammar/lalr.js';
import { lr1Table, lr1TableRun } from '../../src/grammar/lr1-items.js';
import { slrTable } from '../../src/grammar/slr-table.js';

const MASK_TERMINALS = ['a', 'b', 'c', 'd', 'e'];
/** Example 4.58's A/B-vs-c core, plus X → c d so that a SHIFT on 'd' also
 *  claims the cell the merged reduce/reduce lands on. */
const MASK_CORE = 'S -> a X | b X | a A d | b B d | a B e | b A e';

const shape = (cs: LrConflictJson[]) => cs.map((c) => `${c.symbol} ${c.kind}`).sort();

describe('a shift on the same cell must not mask a merge-introduced reduce/reduce', () => {
  const gMask = grammarFromRules(
    'masked 4.58',
    [MASK_CORE, 'X -> c d', 'A -> c', 'B -> c'],
    MASK_TERMINALS,
  );

  it('canonical LR(1) has no reduce/reduce at all (the clash is merge-introduced)', () => {
    const conflicts = drain(lr1Table(gMask)).conflicts;
    expect(conflicts.map((c) => c.kind)).toEqual(['shift/reduce', 'shift/reduce']);
  });

  it('LALR reports the A-vs-B reduce/reduce on d alongside the shift/reduce', () => {
    const conflicts = drain(lalrSteps(gMask)).conflicts;
    expect(shape(conflicts)).toEqual(['d reduce/reduce', 'd shift/reduce', 'e reduce/reduce']);
    const rr = conflicts.find((c) => c.symbol === 'd' && c.kind === 'reduce/reduce')!;
    expect(rr.items).toEqual(['[A → c ·, d]', '[B → c ·, d]']);
    expect(rr.actions.every((a) => a.type === 'reduce')).toBe(true);
    // The two reductions are by different productions — a real r/r clash.
    const prods = rr.actions.map((a) => (a.type === 'reduce' ? a.prod : -1));
    expect(new Set(prods).size).toBe(2);
  });

  it('reports the same three conflicts however the items happen to be ordered', () => {
    const orders = [
      ['X -> c d', 'A -> c', 'B -> c'],
      ['A -> c', 'B -> c', 'X -> c d'],
      ['A -> c', 'X -> c d', 'B -> c'],
    ];
    for (const tail of orders) {
      const g = grammarFromRules('masked 4.58 variant', [MASK_CORE, ...tail], MASK_TERMINALS);
      expect(shape(drain(lalrSteps(g)).conflicts)).toEqual([
        'd reduce/reduce',
        'd shift/reduce',
        'e reduce/reduce',
      ]);
    }
  });
});

describe('one conflict record per conflicted ACTION cell', () => {
  const cellsOf = (cs: LrConflictJson[]) => cs.map((c) => `${c.state},${c.symbol},${c.kind}`);

  it('the dangling else of the C subset is a single shift/reduce, as in SLR', () => {
    const slr = drain(slrTable(cGrammar())).conflicts;
    const lalr = drain(lalrSteps(cGrammar())).conflicts;
    expect(cellsOf(slr).length).toBe(1);
    expect(slr[0]!.symbol).toBe('else');
    // One record, not one per lookahead-split copy of the shift item.
    expect(lalr.length).toBe(1);
    expect(lalr[0]!.symbol).toBe('else');
    expect(lalr[0]!.kind).toBe('shift/reduce');
    expect(new Set(cellsOf(lalr)).size).toBe(cellsOf(lalr).length);
  });

  it('the ambiguous expression grammar has 4 conflicted cells in SLR, LR(1) and LALR', () => {
    const g = grammarFromRules('ambiguous E', ['E -> E + E | E * E | id'], ['+', '*', 'id']);
    for (const conflicts of [
      drain(slrTable(g)).conflicts,
      drain(lr1Table(g)).conflicts,
      drain(lalrSteps(g)).conflicts,
    ]) {
      expect(conflicts.length).toBe(4);
      expect(new Set(cellsOf(conflicts)).size).toBe(4);
      expect(conflicts.every((c) => c.kind === 'shift/reduce')).toBe(true);
    }
  });

  it('emits exactly one table/conflict step per record', () => {
    const rec = lalrRun(cGrammar());
    const steps = rec.trace.steps.filter((s) => s.event.kind === 'table/conflict');
    expect(steps.length).toBe(1);
    expect(rec.result.conflicts.length).toBe(1);
  });
});

describe("accept vs reduce on '$'", () => {
  const gCyclic = grammarFromRules('cyclic', ['S -> S | a'], ['a']);

  it('is an accept/reduce conflict, not a shift/reduce one', () => {
    const conflicts = drain(lr1Table(gCyclic)).conflicts;
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.kind).toBe('accept/reduce');
    expect(conflicts[0]!.symbol).toBe('$');
    expect(conflicts[0]!.actions.map((a) => a.type)).toEqual(['accept', 'reduce']);
  });

  it('never claims a shift exists in the conflict prose', () => {
    for (const rec of [lr1TableRun(gCyclic), lalrRun(gCyclic)]) {
      const step = rec.trace.steps.find((s) => s.event.kind === 'table/conflict')!;
      expect(step.meta.prose).toContain('accept/reduce conflict');
      expect(step.meta.prose).not.toContain('shift/reduce');
      expect(step.meta.prose).not.toContain('shift and go to state');
    }
  });
});
