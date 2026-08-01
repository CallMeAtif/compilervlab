/**
 * Trace-level guarantees for the semantic pass:
 *  - the replay invariants of @lab/trace hold for every recorded fixture
 *    (reduce(all events) ≡ SemanticInfo, keyframe consistency, citations);
 *  - two recordings of the same input are event-identical (determinism).
 */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import { projectSemanticInfo, semReducer } from '../../src/sem/sem-events.js';
import { runSemanticAnalysis } from '../../src/sem/typecheck.js';
import type { Ast } from '../../src/ast/types.js';
import { AstBuilder, buildGcdMain, mainWith } from './ast-builder.js';

/** Fixture programs exercising clean runs, conversions, shadowing, and errors. */
const fixtures: Array<{ name: string; build: () => Ast }> = [
  {
    name: 'gcd/main acceptance',
    build: () => buildGcdMain(new AstBuilder()).ast,
  },
  {
    name: 'conversions + arrays + calls',
    build: () => {
      const b = new AstBuilder();
      const avg = b.func(
        'float',
        'avg',
        [b.param('float', b.dcl('x')), b.param('float', b.dcl('y'))],
        b.block([b.ret(b.bin('/', b.bin('+', b.ident('x'), b.ident('y')), b.floatc(2.0)))]),
      );
      const main = b.func(
        'int',
        'main',
        [],
        b.block([
          b.varDecl('int', [b.initDecl(b.dcl('a', 0, { length: 4 })), b.initDecl(b.dcl('i'))]),
          b.varDecl('float', [b.initDecl(b.dcl('f'), b.intc(1))]),
          b.exprStmt(b.assign(b.index(b.ident('a'), b.ident('i')), b.intc(7))),
          b.exprStmt(b.assign(b.ident('f'), b.call('avg', [b.intc(1), b.floatc(3.0)]))),
          b.ret(b.intc(0)),
        ]),
      );
      return b.program([avg, main]);
    },
  },
  {
    name: 'shadowing + pointers',
    build: () => {
      const b = new AstBuilder();
      return b.program([
        b.func(
          'int',
          'f',
          [b.param('int', b.dcl('x')), b.param('int', b.dcl('p', 1))],
          b.block([
            b.block([
              b.varDecl('int', [b.initDecl(b.dcl('x'), b.un('*', b.ident('p')))]),
              b.exprStmt(b.assign(b.un('*', b.ident('p')), b.ident('x'))),
            ]),
            b.ret(b.ident('x')),
          ]),
        ),
      ]);
    },
  },
  {
    name: 'error-rich program (redeclaration, narrowing, pointer arithmetic, bad call)',
    build: () => {
      const b = new AstBuilder();
      return mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('x')), b.initDecl(b.dcl('x'))]),
        b.varDecl('int', [b.initDecl(b.dcl('p', 1))]),
        b.exprStmt(b.assign(b.ident('x'), b.floatc(1.5))),
        b.exprStmt(b.bin('+', b.ident('p'), b.intc(1))),
        b.exprStmt(b.call('nope', [])),
        b.exprStmt(b.assign(b.ident('undeclared'), b.intc(1))),
      ]);
    },
  },
];

describe('trace invariants (checkTraceInvariants from @lab/trace)', () => {
  for (const fx of fixtures) {
    it(`holds for: ${fx.name}`, () => {
      const rec = runSemanticAnalysis(fx.build());
      expect(rec.trace.truncated).toBe(false);
      const violations = checkTraceInvariants(rec, semReducer, projectSemanticInfo);
      expect(violations).toEqual([]);
    });
  }
});

describe('determinism', () => {
  for (const fx of fixtures) {
    it(`two recordings are event-identical for: ${fx.name}`, () => {
      const ast = fx.build();
      const a = runSemanticAnalysis(ast);
      const b = runSemanticAnalysis(ast);
      expect(a.trace.length).toBe(b.trace.length);
      expect(JSON.stringify(a.trace.steps)).toBe(JSON.stringify(b.trace.steps));
      expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
    });
  }

  it('an independently rebuilt identical AST yields the identical event sequence', () => {
    const a = runSemanticAnalysis(buildGcdMain(new AstBuilder()).ast);
    const b = runSemanticAnalysis(buildGcdMain(new AstBuilder()).ast);
    expect(JSON.stringify(a.trace.steps)).toBe(JSON.stringify(b.trace.steps));
  });
});
