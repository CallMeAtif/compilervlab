/**
 * Regressions for the SLR conflict handling (§4.6.4 / §4.8.2):
 *
 *  - an UNRESOLVED conflict must leave ACTION[i, a] blank instead of silently
 *    keeping whichever action item-discovery order happened to register first;
 *  - the dangling-else shift/reduce conflict must be resolved in favour of the
 *    SHIFT (§4.8.2) so a legal if/else program parses on the SLR table;
 *  - the educational note attached to a conflict must depend on the kind of
 *    conflict (no shift/reduce Example 4.48 citation on a reduce/reduce clash);
 *  - the FOLLOW prose must not emit "an T-production".
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { cGrammar, grammar41 } from '../../src/csubset/grammar-def.js';
import { grammarFromRules } from '../../src/grammar/grammar.js';
import { drain } from '../../src/grammar/lr-events.js';
import { slrReducer, slrTable, slrTableRun } from '../../src/grammar/slr-table.js';
import { lrParseRun, type ParseInputSym } from '../../src/grammar/lr-parse.js';

/** Ambiguous dangling-else abstraction of Grammar 4.14 (terminal 'e' = else). */
const danglingElseToy = () =>
  grammarFromRules('dangling else (toy)', ['S -> i S e S | i S | a'], ['i', 'e', 'a']);

/** Dragon 4.55/4.58 shape: A → c and B → c force a reduce/reduce clash. */
const reduceReduce = () =>
  grammarFromRules(
    'reduce/reduce',
    ['S -> a A d | a B e | b A e | b B d', 'A -> c', 'B -> c'],
    ['a', 'b', 'c', 'd', 'e'],
  );

const input = (terms: string[]): ParseInputSym[] => terms.map((term) => ({ term }));

describe('unresolved SLR conflicts leave the cell blank (not first-wins)', () => {
  it('blanks the shift/reduce cell of the ambiguous dangling-else grammar', () => {
    const rec = slrTableRun(danglingElseToy());
    const t = rec.result;
    const c = t.conflicts.find((x) => x.symbol === 'e')!;
    expect(c).toBeDefined();
    expect(c.kind).toBe('shift/reduce');
    expect(c.resolution).toBeNull();
    // The cell must not silently hold the action that was registered first.
    expect(t.action[c.state]!['e']).toBeUndefined();
    expect(checkTraceInvariants(rec, slrReducer, (r) => r)).toEqual([]);
  });

  it('decides the same way however the alternatives are ordered', () => {
    // Item order inside the state follows the order of the alternatives, so
    // first-wins made this grammar shift and its mirror image reduce.
    const shapes = [
      ['S -> i S e S | i S | a'], // [S → i S · e S] listed first
      ['S -> i S | i S e S | a'], // [S → i S ·] listed first
    ].map((rules) => {
      const t = drain(slrTable(grammarFromRules('de', rules, ['i', 'e', 'a'])));
      const c = t.conflicts.find((x) => x.symbol === 'e')!;
      return {
        n: t.conflicts.length,
        kind: c.kind,
        resolution: c.resolution,
        cell: t.action[c.state]!['e'],
        actions: c.actions.map((a) => a.type).sort(),
      };
    });
    expect(shapes[0]).toEqual(shapes[1]);
    expect(shapes[0]!.cell).toBeUndefined();
    expect(shapes[0]!.actions).toEqual(['reduce', 'shift']);
  });

  it('blanks both reduce/reduce cells instead of keeping the first reduction', () => {
    const rec = slrTableRun(reduceReduce());
    const t = rec.result;
    expect(t.conflicts.length).toBeGreaterThan(0);
    for (const c of t.conflicts) {
      expect(c.kind).toBe('reduce/reduce');
      expect(t.action[c.state]![c.symbol]).toBeUndefined();
    }
    expect(checkTraceInvariants(rec, slrReducer, (r) => r)).toEqual([]);
  });

  it('reports a blanked cell as a conflict, not as a plain syntax error', () => {
    const g = reduceReduce();
    const table = drain(slrTable(g));
    const rec = lrParseRun(g, table, input(['a', 'c', 'e']));
    expect(rec.result.accepted).toBe(false);
    const last = rec.trace.steps[rec.trace.steps.length - 1]!;
    expect(last.event.kind).toBe('parse/error');
    expect(last.meta.prose).toContain('reduce/reduce conflict');
  });
});

describe('dangling else is resolved by shifting (§4.8.2)', () => {
  const g = cGrammar();
  const rec = slrTableRun(g);
  const t = rec.result;

  it("keeps ACTION[i, 'else'] = shift and records the resolution", () => {
    expect(t.conflicts.length).toBeGreaterThan(0);
    for (const c of t.conflicts) {
      expect(c.kind).toBe('shift/reduce');
      expect(c.symbol).toBe('else');
      expect(c.resolution).not.toBeNull();
      expect(c.resolution!.action.type).toBe('shift');
      expect(t.action[c.state]!['else']).toEqual(c.resolution!.action);
    }
  });

  it('parses a legal if/else program on the SLR table', () => {
    const run = lrParseRun(
      g,
      t,
      input(['int', 'id', '(', ')', '{', 'if', '(', 'id', ')', ';', 'else', ';', '}']),
    );
    expect(run.result.error).toBeNull();
    expect(run.result.accepted).toBe(true);
  });

  it('satisfies the trace invariants', () => {
    expect(checkTraceInvariants(rec, slrReducer, (r) => r)).toEqual([]);
  });
});

describe('the conflict note depends on the kind of conflict', () => {
  it('does not cite the shift/reduce Example 4.48 on a reduce/reduce clash', () => {
    const rec = slrTableRun(reduceReduce());
    const steps = rec.trace.steps.filter((s) => s.event.kind === 'table/conflict');
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      expect(s.meta.prose).toContain('not SLR(1)');
      expect(s.meta.prose).not.toContain('4.48');
      expect(s.meta.prose).not.toContain('L = R');
    }
  });

  it('blames ambiguity, not FOLLOW coarseness, on the dangling-else shape', () => {
    const rec = slrTableRun(danglingElseToy());
    const s = rec.trace.steps.find((x) => x.event.kind === 'table/conflict')!;
    expect(s.meta.prose).toContain('4.8.2');
    expect(s.meta.prose).toContain('ambigu');
    expect(s.meta.prose).not.toContain('4.48');
    expect(s.meta.cite.section).toBe('4.8.2');
  });

  it('keeps the FOLLOW-too-coarse explanation for the L = R grammar', () => {
    const rec = slrTableRun(
      grammarFromRules('L = R', ['S -> L = R | R', 'L -> * R | id', 'R -> L'], ['=', '*', 'id']),
    );
    const s = rec.trace.steps.find((x) => x.event.kind === 'table/conflict')!;
    expect(s.meta.prose).toContain('FOLLOW');
    expect(s.meta.prose).toContain('4.48');
  });
});

describe('FOLLOW prose is grammatical for every nonterminal name', () => {
  it('never writes "an T-production"', () => {
    const rec = slrTableRun(grammar41());
    const follows = rec.trace.steps.filter((s) => s.event.kind === 'table/follow');
    expect(follows.length).toBe(3);
    for (const s of follows) {
      expect(s.meta.prose).not.toMatch(/\ban [BCDGJKPQTUVWYZ]-production\b/);
    }
  });
});
