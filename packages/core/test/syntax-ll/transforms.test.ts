import { describe, expect, it } from 'vitest';
import { grammar41, grammar428 } from '../../src/csubset/grammar-def.js';
import { grammarFromRules } from '../../src/grammar/grammar.js';
import {
  eliminateLeftRecursion,
  leftFactor,
  projectTransformResult,
  runEliminateLeftRecursion,
  runLeftFactor,
  transformReducer,
} from '../../src/grammar/transforms.js';
import { expectInvariants, expectSameTrace } from './helpers.js';

describe('left-recursion elimination — Algorithm 4.19', () => {
  it('Grammar 4.1 becomes exactly Grammar 4.28 (book naming and ordering)', () => {
    const out = eliminateLeftRecursion(grammar41());
    const book = grammar428();
    expect(out.start).toBe(book.start);
    expect(out.terminals).toEqual(book.terminals);
    expect(out.nonterminals).toEqual(book.nonterminals); // E, E', T, T', F
    expect(out.productions).toEqual(book.productions); // ids, lhs and rhs all match
  });

  it('handles indirect left recursion via substitution (Example 4.20 shape)', () => {
    // S → A a | b ; A → A c | S d | ε  (the book's Example 4.20)
    const g = grammarFromRules('Example 4.20', ['S -> A a | b', 'A -> A c | S d | ε'], [
      'a', 'b', 'c', 'd',
    ]);
    const out = eliminateLeftRecursion(g);
    // Book result: S → A a | b ; A → b d A' | A' ; A' → c A' | a d A' | ε
    expect(out.productions.map((p) => `${p.lhs} -> ${p.rhs.join(' ') || 'ε'}`)).toEqual([
      'S -> A a',
      'S -> b',
      "A -> b d A'",
      "A -> A'",
      "A' -> c A'",
      "A' -> a d A'",
      "A' -> ε",
    ]);
    const subst = runEliminateLeftRecursion(g).trace.steps.filter(
      (s) => s.event.kind === 'lr.subst',
    );
    expect(subst.length).toBe(1); // A → S d had S's bodies substituted
  });

  it('emits process/substitute/immediate events citing Algorithm 4.19', () => {
    const rec = runEliminateLeftRecursion(grammar41());
    const kinds = rec.trace.steps.map((s) => s.event.kind);
    expect(kinds.filter((k) => k === 'lr.process').length).toBe(3); // E, T, F
    expect(kinds.filter((k) => k === 'lr.immediate').length).toBe(2); // E and T
    for (const s of rec.trace.steps) {
      expect(s.meta.cite.figureOrAlgo).toBe('Algorithm 4.19');
    }
    const imm = rec.trace.steps.find((s) => s.event.kind === 'lr.immediate')!;
    expect(imm.event.kind === 'lr.immediate' && imm.event.prime).toBe("E'");
  });
});

describe('left factoring — Algorithm 4.21', () => {
  it('reproduces Example 4.33 (dangling-else grammar 4.32)', () => {
    // S → i E t S | i E t S e S | a ; E → b
    const g = grammarFromRules('Grammar 4.32', ['S -> i E t S | i E t S e S | a', 'E -> b'], [
      'i', 't', 'e', 'a', 'b',
    ]);
    const out = leftFactor(g);
    expect(out.productions.map((p) => `${p.lhs} -> ${p.rhs.join(' ') || 'ε'}`)).toEqual([
      "S -> i E t S S'",
      'S -> a',
      "S' -> e S",
      "S' -> ε",
      'E -> b',
    ]);
    expect(out.nonterminals).toEqual(['S', "S'", 'E']);
  });

  it('factors the longest common prefix first, then repeats', () => {
    // DirectDecl-style: A → id | id [ n ] | id [ ]  needs two rounds
    const g = grammarFromRules('brackets', ['A -> id | id [ n ] | id [ ]'], ['id', '[', ']', 'n']);
    const out = leftFactor(g);
    expect(out.productions.map((p) => `${p.lhs} -> ${p.rhs.join(' ') || 'ε'}`)).toEqual([
      "A -> id A''",
      "A'' -> [ A'",
      "A'' -> ε",
      "A' -> n ]",
      "A' -> ]",
    ]);
  });

  it('a grammar with nothing to factor is unchanged', () => {
    const g = grammar428();
    const out = leftFactor(g);
    expect(out.productions).toEqual(g.productions);
    expect(out.nonterminals).toEqual(g.nonterminals);
  });
});

describe('transforms — trace quality', () => {
  it('elimination satisfies the trace invariants', () => {
    expectInvariants(
      runEliminateLeftRecursion(grammar41()),
      transformReducer,
      projectTransformResult,
    );
  });

  it('left factoring satisfies the trace invariants', () => {
    const g = grammarFromRules('Grammar 4.32', ['S -> i E t S | i E t S e S | a', 'E -> b'], [
      'i', 't', 'e', 'a', 'b',
    ]);
    expectInvariants(runLeftFactor(g), transformReducer, projectTransformResult);
  });

  it('both transforms are deterministic', () => {
    expectSameTrace(runEliminateLeftRecursion(grammar41()), runEliminateLeftRecursion(grammar41()));
    const g = () =>
      grammarFromRules('Grammar 4.32', ['S -> i E t S | i E t S e S | a', 'E -> b'], [
        'i', 't', 'e', 'a', 'b',
      ]);
    expectSameTrace(runLeftFactor(g()), runLeftFactor(g()));
  });
});
