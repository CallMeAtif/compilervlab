import { describe, expect, it } from 'vitest';
import { grammar428 } from '../../src/csubset/grammar-def.js';
import { grammarFromRules } from '../../src/grammar/grammar.js';
import {
  ll1Resolve,
  ll1Table,
  ll1TableReducer,
  runLL1Table,
  type LL1Table,
} from '../../src/grammar/ll1-table.js';
import { expectInvariants, expectSameTrace } from './helpers.js';

/** Cell productions of M[nt, t] as ids (empty array = blank cell). */
function cell(table: LL1Table, nt: string, t: string): number[] {
  return (table[nt]?.[t] ?? []).map((e) => e.prod);
}

describe('LL(1) table — Fig 4.17 for Grammar 4.28, cell for cell', () => {
  // Production ids in grammar428():
  // 0: E → T E'   1: E' → + T E'   2: E' → ε
  // 3: T → F T'   4: T' → * F T'   5: T' → ε
  // 6: F → ( E )  7: F → id
  const { table, conflicts } = ll1Table(grammar428());
  const terminals = ['id', '+', '*', '(', ')', '$'];

  const fig417: Record<string, Record<string, number[]>> = {
    E: { id: [0], '(': [0], '+': [], '*': [], ')': [], $: [] },
    "E'": { id: [], '(': [], '+': [1], '*': [], ')': [2], $: [2] },
    T: { id: [3], '(': [3], '+': [], '*': [], ')': [], $: [] },
    "T'": { id: [], '(': [], '+': [5], '*': [4], ')': [5], $: [5] },
    F: { id: [7], '(': [6], '+': [], '*': [], ')': [], $: [] },
  };

  for (const nt of ['E', "E'", 'T', "T'", 'F']) {
    it(`row ${nt}`, () => {
      for (const t of terminals) {
        expect(cell(table, nt, t), `M[${nt}, ${t}]`).toEqual(fig417[nt]![t]!);
      }
    });
  }

  it('Grammar 4.28 is LL(1): no conflicts', () => {
    expect(conflicts).toEqual([]);
  });
});

describe('LL(1) table — conflicts', () => {
  // Grammar 4.14-style dangling else, already left-factored (Example 4.33):
  // S → i E t S S' | a ; S' → e S | ε ; E → b
  const danglingElse = () =>
    grammarFromRules('dangling else (4.33)', [
      "S -> i E t S S' | a",
      "S' -> e S | ε",
      'E -> b',
    ], ['i', 't', 'e', 'a', 'b']);

  it("reports the M[S', e] conflict with both productions and an explanation", () => {
    const { table, conflicts } = ll1Table(danglingElse());
    expect(cell(table, "S'", 'e').length).toBe(2);
    expect(conflicts.length).toBe(1);
    const c = conflicts[0]!;
    expect(c.nonterminal).toBe("S'");
    expect(c.terminal).toBe('e');
    expect(c.entries.map((e) => e.via).sort()).toEqual(['first', 'follow']);
    expect(c.explanation).toMatch(/not LL\(1\)/);
    expect(c.explanation).toMatch(/prediction sets overlap/);
  });

  it('emits a conflict event citing §4.4.3', () => {
    const rec = runLL1Table(danglingElse());
    const i = rec.trace.findIndex((s) => s.event.kind === 'll1.conflict');
    expect(i).toBeGreaterThanOrEqual(0);
    const step = rec.trace.steps[i]!;
    expect(step.meta.cite.section).toBe('4.4.3');
    expect(step.meta.level).toBe('macro');
  });
});

describe('LL(1) table — a multiply-defined cell is ONE conflict (§4.4.3)', () => {
  // Three alternatives of S share the prefix a, so M[S, a] ends up 3-way.
  const threeWay = () =>
    grammarFromRules(
      'three-way',
      ['S -> a X | a Y | a Z', 'X -> x', 'Y -> y', 'Z -> z'],
      ['a', 'x', 'y', 'z'],
    );

  it('reports M[S, a] once, with the finished contents of the cell', () => {
    const { table, conflicts } = ll1Table(threeWay());
    expect(cell(table, 'S', 'a')).toEqual([0, 1, 2]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.nonterminal).toBe('S');
    expect(conflicts[0]!.terminal).toBe('a');
    expect(conflicts[0]!.entries.map((e) => e.prod)).toEqual([0, 1, 2]);
    expect(conflicts[0]!.explanation).toMatch(/holds 3 productions/);
  });

  it('narrates each escalation but never lists a cell twice', () => {
    const rec = runLL1Table(threeWay());
    const events = rec.trace.steps.filter((s) => s.event.kind === 'll1.conflict');
    expect(events.length).toBe(2); // the 2nd and the 3rd insertion each re-report the cell
    const keys = rec.result.conflicts.map((c) => `${c.nonterminal}|${c.terminal}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rec.result.conflicts.length).toBe(1);
  });

  it('the reducer agrees with the generator (replay invariants)', () => {
    expectInvariants(runLL1Table(threeWay()), ll1TableReducer, (r) => r);
  });
});

describe('ll1Resolve — which entry a conflict cell resolves to, and why', () => {
  it('single-valued cell: sole-entry', () => {
    const { table } = ll1Table(grammar428());
    const r = ll1Resolve(table, 'E', 'id')!;
    expect(r.rule).toBe('sole-entry');
    expect(r.entry.prod).toBe(0);
  });

  it('FIRST + FOLLOW cell: takes the FIRST-case entry even when it is listed second', () => {
    // M[A, a] = [A → ε (FOLLOW case), A → a (FIRST case)]
    const g = grammarFromRules('first-after-follow', ['S -> A a', 'A -> ε | a'], ['a']);
    const { table } = ll1Table(g);
    expect(table['A']!['a']!.map((e) => e.via)).toEqual(['follow', 'first']);
    const r = ll1Resolve(table, 'A', 'a')!;
    expect(r.rule).toBe('consumes-lookahead');
    expect(r.index).toBe(1); // NOT the first-listed entry
    expect(r.entry.prod).toBe(2);
  });

  it('two FOLLOW-case entries: first-listed, since neither consumes the lookahead', () => {
    const g = grammarFromRules('two-eps', ['S -> A c', 'A -> B | C', 'B -> ε', 'C -> ε'], ['c']);
    const { table } = ll1Table(g);
    const r = ll1Resolve(table, 'A', 'c')!;
    expect(r.cell.map((e) => e.via)).toEqual(['follow', 'follow']);
    expect(r.rule).toBe('first-listed');
    expect(r.index).toBe(0);
  });

  it('two FIRST-case entries: first-listed', () => {
    const g = grammarFromRules('common-prefix', ['S -> a X | a Y', 'X -> x', 'Y -> y'], [
      'a',
      'x',
      'y',
    ]);
    const r = ll1Resolve(ll1Table(g).table, 'S', 'a')!;
    expect(r.rule).toBe('first-listed');
    expect(r.index).toBe(0);
  });

  it('empty cell: null', () => {
    expect(ll1Resolve(ll1Table(grammar428()).table, 'E', '+')).toBeNull();
  });
});

describe('LL(1) table — trace quality', () => {
  it('every insertion cites Algorithm 4.31 and names the case that fired', () => {
    const rec = runLL1Table(grammar428());
    const inserts = rec.trace.steps.filter((s) => s.event.kind === 'll1.insert');
    expect(inserts.length).toBe(13); // 13 filled cells in Fig 4.17
    for (const s of inserts) {
      expect(s.meta.cite.figureOrAlgo).toBe('Algorithm 4.31');
      const ev = s.event as { justification: string; via: string };
      expect(ev.justification).toMatch(ev.via === 'first' ? /FIRST case/ : /FOLLOW case/);
    }
  });

  it('satisfies the trace invariants', () => {
    expectInvariants(runLL1Table(grammar428()), ll1TableReducer, (r) => r);
  });

  it('is deterministic', () => {
    expectSameTrace(runLL1Table(grammar428()), runLL1Table(grammar428()));
  });
});
