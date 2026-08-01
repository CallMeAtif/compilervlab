/**
 * Scope tree + symbol table construction (Dragon Book §2.7, chained tables):
 * scope nesting, declaration, redeclaration, shadowing, and the traced
 * innermost-outward lookup chain.
 */
import { describe, expect, it } from 'vitest';
import { RULE } from '../../src/sem/sem-events.js';
import { AstBuilder, INT, analyzeFixture } from './ast-builder.js';
import type { IdentExprNode } from '../../src/ast/types.js';

describe('scope tree construction', () => {
  it('builds global / function / block scopes with correct parents and symbols', () => {
    // int g; int f(int p) { int a; { int b; } return 0; }
    const { info, errors } = analyzeFixture((b) =>
      b.program([
        b.varDecl('int', [b.initDecl(b.dcl('g'))]),
        b.func(
          'int',
          'f',
          [b.param('int', b.dcl('p'))],
          b.block([
            b.varDecl('int', [b.initDecl(b.dcl('a'))]),
            b.block([b.varDecl('int', [b.initDecl(b.dcl('b'))])]),
            b.ret(b.intc(0)),
          ]),
        ),
      ]),
    );
    expect(errors).toEqual([]);
    expect(info.scopes.map((s) => ({ id: s.id, parentId: s.parentId, kind: s.kind }))).toEqual([
      { id: 0, parentId: null, kind: 'global' },
      { id: 1, parentId: 0, kind: 'function' },
      { id: 2, parentId: 1, kind: 'block' },
    ]);
    expect(info.scopes[1]!.label).toBe('f');
    expect(info.symbols.map((s) => [s.name, s.kind, s.scopeId])).toEqual([
      ['g', 'var', 0],
      ['f', 'func', 0],
      ['p', 'param', 1],
      ['a', 'var', 1],
      ['b', 'var', 2],
    ]);
    expect(info.scopes[0]!.symbolIds).toEqual([0, 1]);
    expect(info.scopes[1]!.symbolIds).toEqual([2, 3]);
    expect(info.scopes[2]!.symbolIds).toEqual([4]);
  });

  it('emits balanced scopeEnter/scopeExit macro events with kind and span', () => {
    const { rec } = analyzeFixture((b) =>
      b.program([b.func('int', 'main', [], b.block([b.block([]), b.ret(b.intc(0))]))]),
    );
    const enters = rec.trace.steps.filter((s) => s.event.kind === 'scopeEnter');
    const exits = rec.trace.steps.filter((s) => s.event.kind === 'scopeExit');
    expect(enters.map((s) => (s.event.kind === 'scopeEnter' ? s.event.scopeKind : ''))).toEqual([
      'global',
      'function',
      'block',
    ]);
    expect(exits).toHaveLength(3);
    for (const s of [...enters, ...exits]) {
      expect(s.meta.level).toBe('macro');
      expect(s.meta.cite.section).toBe('2.7');
    }
    for (const s of enters) {
      expect(s.meta.srcSpans?.length).toBe(1);
    }
  });
});

describe('redeclaration (same scope) — c-subset scoping / §2.7', () => {
  it('rejects redeclaring a name in the same scope, citing the exact rule', () => {
    // int main() { int y; float y; return 0; }
    const { info, errors } = analyzeFixture((b) =>
      b.program([
        b.func(
          'int',
          'main',
          [],
          b.block([
            b.varDecl('int', [b.initDecl(b.dcl('y'))]),
            b.varDecl('float', [b.initDecl(b.dcl('y'))]),
            b.ret(b.intc(0)),
          ]),
        ),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.redeclaration);
    expect(errors[0]!.hint).toBeTruthy();
    // the second declaration was NOT entered into the table
    expect(info.symbols.filter((s) => s.name === 'y')).toHaveLength(1);
    expect(info.symbols.find((s) => s.name === 'y')!.type).toEqual(INT);
  });

  it('rejects a parameter clashing with another parameter', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([
        b.func(
          'int',
          'f',
          [b.param('int', b.dcl('x')), b.param('float', b.dcl('x'))],
          b.block([b.ret(b.intc(0))]),
        ),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.redeclaration);
  });

  it('rejects a local redeclaring a parameter (body shares the function scope)', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([
        b.func(
          'int',
          'f',
          [b.param('int', b.dcl('x'))],
          b.block([b.varDecl('int', [b.initDecl(b.dcl('x'))]), b.ret(b.intc(0))]),
        ),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.redeclaration);
  });
});

describe('shadowing (inner scope) is legal and lookup finds the innermost', () => {
  it('resolves uses to the innermost visible declaration', () => {
    // int f(int x) { { int x; x = 1; } x = 2; return 0; }
    let inner!: IdentExprNode;
    let outer!: IdentExprNode;
    const { info, errors } = analyzeFixture((b) => {
      inner = b.ident('x');
      const innerBlock = b.block([
        b.varDecl('int', [b.initDecl(b.dcl('x'))]),
        b.exprStmt(b.assign(inner, b.intc(1))),
      ]);
      outer = b.ident('x');
      return b.program([
        b.func(
          'int',
          'f',
          [b.param('int', b.dcl('x'))],
          b.block([innerBlock, b.exprStmt(b.assign(outer, b.intc(2))), b.ret(b.intc(0))]),
        ),
      ]);
    });
    expect(errors).toEqual([]);
    const paramSym = info.symbols.find((s) => s.name === 'x' && s.kind === 'param')!;
    const blockSym = info.symbols.find((s) => s.name === 'x' && s.kind === 'var')!;
    expect(info.resolved[inner.id]).toBe(blockSym.id);
    expect(info.resolved[outer.id]).toBe(paramSym.id);
  });

  it('traces the chain walk: micro lookupSteps from innermost scope outward, ending in a hit', () => {
    // global g used inside a block inside main → 3 scopes consulted
    let use!: IdentExprNode;
    const { rec, info } = analyzeFixture((b) => {
      use = b.ident('g');
      return b.program([
        b.varDecl('int', [b.initDecl(b.dcl('g'))]),
        b.func(
          'int',
          'main',
          [],
          b.block([b.block([b.exprStmt(b.assign(use, b.intc(1)))]), b.ret(b.intc(0))]),
        ),
      ]);
    });
    const walk = rec.trace.steps.filter(
      (s) => s.event.kind === 'lookupStep' && s.event.name === 'g',
    );
    expect(
      walk.map((s) => (s.event.kind === 'lookupStep' ? [s.event.scopeId, s.event.found] : [])),
    ).toEqual([
      [2, false], // block
      [1, false], // function main
      [0, true], // global — hit
    ]);
    for (const s of walk) {
      expect(s.meta.level).toBe('micro');
      expect(s.meta.groupId).toBe(`lookup:${use.id}`);
    }
    const resolve = rec.trace.steps.find(
      (s) => s.event.kind === 'resolve' && s.event.nodeId === use.id,
    )!;
    expect(resolve.event.kind === 'resolve' && resolve.event.symbolId).toBe(
      info.symbols.find((s) => s.name === 'g')!.id,
    );
  });
});

describe('use before declaration', () => {
  it('rejects a use of an undeclared name, ending the lookup chain in a miss', () => {
    let use!: IdentExprNode;
    const { rec, errors, info } = analyzeFixture((b) => {
      use = b.ident('x');
      return b.program([
        b.func('int', 'main', [], b.block([b.exprStmt(b.assign(use, b.intc(1))), b.ret(b.intc(0))])),
      ]);
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.declBeforeUse);
    // chain consulted function scope then global scope, both misses
    const walk = rec.trace.steps.filter(
      (s) => s.event.kind === 'lookupStep' && s.event.name === 'x',
    );
    expect(walk.map((s) => (s.event.kind === 'lookupStep' ? s.event.found : true))).toEqual([
      false,
      false,
    ]);
    const resolve = rec.trace.steps.find(
      (s) => s.event.kind === 'resolve' && s.event.nodeId === use.id,
    )!;
    expect(resolve.event.kind === 'resolve' && resolve.event.symbolId).toBeNull();
    expect(info.resolved[use.id]).toBeUndefined();
  });

  it('rejects a use that appears textually before its declaration in the same scope', () => {
    // int main() { x = 1; int x; return 0; }
    const { errors } = analyzeFixture((b) =>
      b.program([
        b.func(
          'int',
          'main',
          [],
          b.block([
            b.exprStmt(b.assign(b.ident('x'), b.intc(1))),
            b.varDecl('int', [b.initDecl(b.dcl('x'))]),
            b.ret(b.intc(0)),
          ]),
        ),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.declBeforeUse);
  });
});
