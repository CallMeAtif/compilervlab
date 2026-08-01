import { describe, expect, it } from 'vitest';
import { EPSILON, isNonterminal } from '../../src/grammar/grammar.js';
import { runLL1Table } from '../../src/grammar/ll1-table.js';
import { runLL1Parse } from '../../src/grammar/ll1-parse.js';
import { runRecursiveDescent } from '../../src/grammar/recursive-descent.js';
import {
  llReadyCGrammar,
  projectTransformResult,
  transformReducer,
} from '../../src/grammar/transforms.js';
import { ll1ParseReducer } from '../../src/grammar/ll1-parse.js';
import { rdReducer } from '../../src/grammar/recursive-descent.js';
import { expectInvariants, expectSameTrace } from './helpers.js';

/** Token-type sequence for the acceptance sample:
 *    void main ( ) { int x ; { ; } return ; }
 *  (identifiers lex as `id`; see csubset/tokens.ts). */
const SAMPLE = [
  'void', 'id', '(', ')', '{',
  'int', 'id', ';',
  '{', ';', '}',
  'return', ';',
  '}',
];

describe('LL(1)-ready C grammar (leftFactor ∘ eliminateLeftRecursion)', () => {
  const ready = llReadyCGrammar();

  it('produces a well-formed grammar with no left recursion and no common prefixes', () => {
    const g = ready.grammar;
    expect(g.start).toBe('Program');
    // no immediate left recursion anywhere
    for (const p of g.productions) {
      expect(p.rhs[0], `${p.lhs} is still immediately left recursive`).not.toBe(p.lhs);
    }
    // left-factored: no two alternatives of a nonterminal share a first symbol
    // *when both are the same symbol* unless one derives via distinct nonterminals
    for (const nt of g.nonterminals) {
      const firsts = g.productions
        .filter((p) => p.lhs === nt && p.rhs.length > 0)
        .map((p) => p.rhs[0]!);
      expect(new Set(firsts).size, `alternatives of ${nt} share a literal prefix`).toBe(
        firsts.length,
      );
    }
    // every referenced symbol is declared
    for (const p of g.productions) {
      for (const s of p.rhs) {
        expect(
          isNonterminal(g, s) || g.terminals.includes(s),
          `undeclared symbol ${s} in ${p.lhs}`,
        ).toBe(true);
      }
    }
    // dangling-else was left-factored into an IfStmt′ chooser
    expect(g.nonterminals).toContain("IfStmt'");
  });

  it('both transform traces satisfy the replay invariants', () => {
    expectInvariants(ready.elim, transformReducer, projectTransformResult);
    expectInvariants(ready.factor, transformReducer, projectTransformResult);
  });

  it('the transform pipeline is deterministic', () => {
    const again = llReadyCGrammar();
    expectSameTrace(ready.elim, again.elim);
    expectSameTrace(ready.factor, again.factor);
    expect(again.grammar).toEqual(ready.grammar);
  });

  describe('LL(1) table on the transformed C grammar', () => {
    const rec = runLL1Table(ready.grammar);

    it('still has genuine conflicts, reported as educational conflict events', () => {
      const { conflicts } = rec.result;
      expect(conflicts.length).toBeGreaterThan(0);
      // dangling else: IfStmt' → else Stmt vs IfStmt' → ε on lookahead `else`
      const dangling = conflicts.find(
        (c) => c.nonterminal === "IfStmt'" && c.terminal === 'else',
      );
      expect(dangling).toBeDefined();
      expect(dangling!.entries.map((e) => e.via).sort()).toEqual(['first', 'follow']);
      expect(dangling!.explanation).toMatch(/not LL\(1\)/);
      // FuncDef vs VarDecl: both start with a type specifier
      for (const t of ['int', 'float', 'char', 'void']) {
        expect(
          conflicts.some((c) => c.nonterminal === 'ExternalDecl' && c.terminal === t),
          `expected ExternalDecl conflict at ${t}`,
        ).toBe(true);
      }
    });

    it('emits one ll1.conflict trace event per recorded conflict', () => {
      const events = rec.trace.steps.filter((s) => s.event.kind === 'll1.conflict');
      expect(events.length).toBe(rec.result.conflicts.length);
    });
  });

  describe('parsing the acceptance sample token sequence', () => {
    it('table-driven predictive parse accepts it (conflicts resolved with a note)', () => {
      const rec = runLL1Parse(ready.grammar, SAMPLE);
      const final = rec.trace.final();
      expect(final.status).toBe('accepted');
      expect(final.pos).toBe(SAMPLE.length);
      // the ExternalDecl conflict cell was consulted at `void` → a note explains the choice
      expect(final.notes.length).toBeGreaterThan(0);
      expect(final.notes[0]).toMatch(/conflict/);
      // parse tree rooted at Program whose frontier, left to right, is the input
      expect(final.nodes[0]!.symbol).toBe('Program');
      const frontier: string[] = [];
      const walk = (id: number): void => {
        const n = final.nodes[id]!;
        if (n.children.length === 0) {
          if (n.symbol !== EPSILON) frontier.push(n.symbol);
          return;
        }
        n.children.forEach(walk);
      };
      walk(0);
      expect(frontier).toEqual(SAMPLE);
    });

    it('recursive descent accepts it too', () => {
      const rec = runRecursiveDescent(ready.grammar, SAMPLE);
      const final = rec.trace.final();
      expect(final.status).toBe('accepted');
      expect(final.pos).toBe(SAMPLE.length);
      expect(final.notes.length).toBeGreaterThan(0);
      const leaves = final.nodes
        .filter((n) => n.status === 'leaf' && n.symbol !== EPSILON)
        .map((n) => n.symbol);
      expect(leaves).toEqual(SAMPLE);
    });

    it('both parses satisfy the trace invariants and are deterministic', () => {
      const p1 = runLL1Parse(ready.grammar, SAMPLE);
      expectInvariants(p1, ll1ParseReducer, (r) => r);
      expectSameTrace(p1, runLL1Parse(ready.grammar, SAMPLE));
      const r1 = runRecursiveDescent(ready.grammar, SAMPLE);
      expectInvariants(r1, rdReducer, (r) => r);
      expectSameTrace(r1, runRecursiveDescent(ready.grammar, SAMPLE));
    });
  });
});
