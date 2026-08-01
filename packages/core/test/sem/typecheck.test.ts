/**
 * Accept/reject fixtures for every rule in docs/c-subset.md "Types and typing
 * rules", asserting the exact rule text cited on each diagnostic, plus the
 * §6.5.2 conversion insertion and the rule-6 array decay for argument passing.
 */
import { describe, expect, it } from 'vitest';
import { RULE } from '../../src/sem/sem-events.js';
import {
  AstBuilder,
  CHAR,
  FLOAT,
  INT,
  PINT,
  analyzeFixture,
  mainWith,
} from './ast-builder.js';
import type { ConstExprNode, Expr, IdentExprNode } from '../../src/ast/types.js';

describe('rule 1 — arithmetic operators', () => {
  it('accepts int+int as int', () => {
    let e!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      e = b.bin('+', b.intc(1), b.intc(2));
      return mainWith(b, [b.exprStmt(e)]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e.id]).toEqual(INT);
  });

  it('promotes char to int: char+int is int with no conversion node', () => {
    let e!: Expr;
    let c!: ConstExprNode;
    const { info, errors } = analyzeFixture((b) => {
      c = b.charc('a');
      e = b.bin('+', c, b.intc(1));
      return mainWith(b, [b.exprStmt(e)]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e.id]).toEqual(INT);
    expect(info.conversions[c.id]).toBeUndefined();
  });

  it('widens int+float to float via an explicit inttofloat conversion on the int operand', () => {
    let e!: Expr;
    let i!: ConstExprNode;
    const { info, errors, rec } = analyzeFixture((b) => {
      i = b.intc(2);
      e = b.bin('+', i, b.floatc(3.5));
      return mainWith(b, [b.exprStmt(e)]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e.id]).toEqual(FLOAT);
    expect(info.conversions[i.id]).toEqual({ from: INT, to: FLOAT });
    const conv = rec.trace.steps.find((s) => s.event.kind === 'convert')!;
    expect(conv.event.kind === 'convert' && conv.event.op).toBe('inttofloat');
    expect(conv.meta.cite.section).toBe('6.5.2');
  });

  it('accepts float*float as float with no conversion', () => {
    let e!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      e = b.bin('*', b.floatc(1.5), b.floatc(2.5));
      return mainWith(b, [b.exprStmt(e)]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e.id]).toEqual(FLOAT);
    expect(Object.keys(info.conversions)).toEqual([]);
  });

  it('accepts int%int as int and rejects % on float, citing rule 1', () => {
    let ok!: Expr;
    const accept = analyzeFixture((b) => {
      ok = b.bin('%', b.intc(7), b.intc(3));
      return mainWith(b, [b.exprStmt(ok)]);
    });
    expect(accept.errors).toEqual([]);
    expect(accept.info.nodeTypes[ok.id]).toEqual(INT);

    const reject = analyzeFixture((b) =>
      mainWith(b, [b.exprStmt(b.bin('%', b.floatc(7.0), b.intc(3)))]),
    );
    expect(reject.errors).toHaveLength(1);
    expect(reject.errors[0]!.rule).toBe(RULE.modInt);
  });

  it('rejects arithmetic on a non-arithmetic operand (unary - on a pointer)', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1))]),
        b.exprStmt(b.un('-', b.ident('p'))),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.arithOperands);
  });
});

describe('rule 2 — relational and equality', () => {
  it('accepts 1 < 2 as int', () => {
    let e!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      e = b.bin('<', b.intc(1), b.intc(2));
      return mainWith(b, [b.exprStmt(e)]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e.id]).toEqual(INT);
  });

  it('widens a mixed comparison: 1 < 2.0 converts the int side', () => {
    let i!: ConstExprNode;
    let e!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      i = b.intc(1);
      e = b.bin('<', i, b.floatc(2.0));
      return mainWith(b, [b.exprStmt(e)]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e.id]).toEqual(INT);
    expect(info.conversions[i.id]).toEqual({ from: INT, to: FLOAT });
  });

  it('accepts == on two identical pointer types as int', () => {
    let e!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      e = b.bin('==', b.ident('p'), b.ident('q'));
      return mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1)), b.initDecl(b.dcl('q', 1))]),
        b.exprStmt(e),
      ]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e.id]).toEqual(INT);
  });

  it('rejects == on pointers of different types, citing rule 2', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1))]),
        b.varDecl('float', [b.initDecl(b.dcl('q', 1))]),
        b.exprStmt(b.bin('==', b.ident('p'), b.ident('q'))),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.relational);
  });

  it("rejects '<' on pointers (only == and != compare pointers)", () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1)), b.initDecl(b.dcl('q', 1))]),
        b.exprStmt(b.bin('<', b.ident('p'), b.ident('q'))),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.relational);
  });

  it('rejects comparing a pointer with an arithmetic value', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1))]),
        b.exprStmt(b.bin('==', b.ident('p'), b.intc(1))),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.relational);
  });
});

describe('rule 3 — logical operators', () => {
  it('accepts 1 && 0 as int and ! on a pointer (scalars)', () => {
    let andE!: Expr;
    let notE!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      andE = b.bin('&&', b.intc(1), b.intc(0));
      notE = b.un('!', b.ident('p'));
      return mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1))]),
        b.exprStmt(andE),
        b.exprStmt(notE),
      ]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[andE.id]).toEqual(INT);
    expect(info.nodeTypes[notE.id]).toEqual(INT);
  });

  it('rejects a void value as a logical operand (via rule 7)', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([
        b.func('void', 'v', [], b.block([b.ret()])),
        b.func(
          'int',
          'main',
          [],
          b.block([b.exprStmt(b.un('!', b.call('v', []))), b.ret(b.intc(0))]),
        ),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.voidValue);
  });
});

describe('rule 4 — assignment', () => {
  it('accepts x = 1 and yields the target type', () => {
    let e!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      e = b.assign(b.ident('x'), b.intc(1));
      return mainWith(b, [b.varDecl('int', [b.initDecl(b.dcl('x'))]), b.exprStmt(e)]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e.id]).toEqual(INT);
  });

  it('converts int→float on assignment (f = 1 inserts inttofloat)', () => {
    let one!: ConstExprNode;
    const { info, errors } = analyzeFixture((b) => {
      one = b.intc(1);
      return mainWith(b, [
        b.varDecl('float', [b.initDecl(b.dcl('f'))]),
        b.exprStmt(b.assign(b.ident('f'), one)),
      ]);
    });
    expect(errors).toEqual([]);
    expect(info.conversions[one.id]).toEqual({ from: INT, to: FLOAT });
  });

  it('converts int→float in an initialization (float f = 1;)', () => {
    let one!: ConstExprNode;
    const { info, errors } = analyzeFixture((b) => {
      one = b.intc(1);
      return mainWith(b, [b.varDecl('float', [b.initDecl(b.dcl('f'), one)])]);
    });
    expect(errors).toEqual([]);
    expect(info.conversions[one.id]).toEqual({ from: INT, to: FLOAT });
  });

  it('rejects the narrowing i = 1.5 (float→int), citing rule 4', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('i'))]),
        b.exprStmt(b.assign(b.ident('i'), b.floatc(1.5))),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.assignTypes);
    expect(errors[0]!.hint).toContain('narrowing');
  });

  it('rejects a non-l-value target (1 = x), citing rule 4', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('x'))]),
        b.exprStmt(b.assign(b.intc(1), b.ident('x'))),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.assignLValue);
  });

  it('accepts identical pointer assignment and rejects mismatched pointers', () => {
    const accept = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1)), b.initDecl(b.dcl('q', 1))]),
        b.exprStmt(b.assign(b.ident('p'), b.ident('q'))),
      ]),
    );
    expect(accept.errors).toEqual([]);

    const reject = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1))]),
        b.varDecl('float', [b.initDecl(b.dcl('q', 1))]),
        b.exprStmt(b.assign(b.ident('p'), b.ident('q'))),
      ]),
    );
    expect(reject.errors).toHaveLength(1);
    expect(reject.errors[0]!.rule).toBe(RULE.assignTypes);
  });

  it('rejects assigning to an array (arrays are not assignable)', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('a', 0, { length: 3 }))]),
        b.varDecl('int', [b.initDecl(b.dcl('p', 1))]),
        b.exprStmt(b.assign(b.ident('a'), b.ident('p'))),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.arrayNotAssignable);
  });

  it('accepts assignment through *p and a[i]', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1)), b.initDecl(b.dcl('a', 0, { length: 4 }))]),
        b.exprStmt(b.assign(b.un('*', b.ident('p')), b.intc(3))),
        b.exprStmt(b.assign(b.index(b.ident('a'), b.intc(0)), b.intc(5))),
      ]),
    );
    expect(errors).toEqual([]);
  });
});

describe('rule 5 — pointers', () => {
  it('accepts &x : int* and *p : int (l-value)', () => {
    let addr!: Expr;
    let deref!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      addr = b.un('&', b.ident('x'));
      deref = b.un('*', b.ident('p'));
      return mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('x')), b.initDecl(b.dcl('p', 1))]),
        b.exprStmt(addr),
        b.exprStmt(deref),
      ]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[addr.id]).toEqual(PINT);
    expect(info.nodeTypes[deref.id]).toEqual(INT);
  });

  it("rejects '&' on a non-l-value, citing rule 5", () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [b.exprStmt(b.un('&', b.bin('+', b.intc(1), b.intc(2))))]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.addrOf);
  });

  it("rejects '*' on a non-pointer, citing rule 5", () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [b.varDecl('int', [b.initDecl(b.dcl('x'))]), b.exprStmt(b.un('*', b.ident('x')))]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.deref);
  });

  it('rejects pointer arithmetic p + 1 (and array + 1 after decay), citing rule 5 with a hint', () => {
    const ptr = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('p', 1))]),
        b.exprStmt(b.bin('+', b.ident('p'), b.intc(1))),
      ]),
    );
    expect(ptr.errors).toHaveLength(1);
    expect(ptr.errors[0]!.rule).toBe(RULE.noPtrArith);
    expect(ptr.errors[0]!.hint).toContain('a[i]');

    const arr = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('a', 0, { length: 5 }))]),
        b.exprStmt(b.bin('+', b.ident('a'), b.intc(1))),
      ]),
    );
    expect(arr.errors).toHaveLength(1);
    expect(arr.errors[0]!.rule).toBe(RULE.noPtrArith);
  });
});

describe('rule 6 — arrays and decay', () => {
  it('accepts a[i] : element l-value with an int or char index', () => {
    let e1!: Expr;
    let e2!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      e1 = b.index(b.ident('a'), b.intc(2));
      e2 = b.index(b.ident('a'), b.charc('b'));
      return mainWith(b, [
        b.varDecl('float', [b.initDecl(b.dcl('a', 0, { length: 8 }))]),
        b.exprStmt(e1),
        b.exprStmt(e2),
      ]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e1.id]).toEqual(FLOAT);
    expect(info.nodeTypes[e2.id]).toEqual(FLOAT);
  });

  it('accepts indexing a pointer (p[i])', () => {
    let e!: Expr;
    const { info, errors } = analyzeFixture((b) => {
      e = b.index(b.ident('p'), b.intc(0));
      return mainWith(b, [b.varDecl('int', [b.initDecl(b.dcl('p', 1))]), b.exprStmt(e)]);
    });
    expect(errors).toEqual([]);
    expect(info.nodeTypes[e.id]).toEqual(INT);
  });

  it('rejects a float index, citing rule 6', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('a', 0, { length: 3 }))]),
        b.exprStmt(b.index(b.ident('a'), b.floatc(1.0))),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.indexing);
  });

  it('rejects indexing a non-array/non-pointer, citing rule 6', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [b.initDecl(b.dcl('x'))]),
        b.exprStmt(b.index(b.ident('x'), b.intc(0))),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.indexing);
  });

  it('decays T[n] to T* for parameter passing (accepted, traced, not a conversion)', () => {
    // int first(int a[], int n) { return a[0] + n; }
    // int main() { int v[3]; return first(v, 3); }
    let argUse!: IdentExprNode;
    const { info, errors, rec } = analyzeFixture((b) => {
      const first = b.func(
        'int',
        'first',
        [b.param('int', b.dcl('a', 0, { length: null })), b.param('int', b.dcl('n'))],
        b.block([b.ret(b.bin('+', b.index(b.ident('a'), b.intc(0)), b.ident('n')))]),
      );
      argUse = b.ident('v');
      const main = b.func(
        'int',
        'main',
        [],
        b.block([
          b.varDecl('int', [b.initDecl(b.dcl('v', 0, { length: 3 }))]),
          b.ret(b.call('first', [argUse, b.intc(3)])),
        ]),
      );
      return b.program([first, main]);
    });
    expect(errors).toEqual([]);
    // the parameter symbol was adjusted to int*
    const paramSym = info.symbols.find((s) => s.name === 'a' && s.kind === 'param')!;
    expect(paramSym.type).toEqual(PINT);
    // the argument decayed int[3] → int* as a traced micro step, not a conversion
    const decay = rec.trace.steps.find(
      (s) => s.event.kind === 'decay' && s.event.nodeId === argUse.id,
    )!;
    expect(decay).toBeDefined();
    expect(decay.event.kind === 'decay' && decay.event.to).toEqual(PINT);
    expect(decay.meta.level).toBe('micro');
    expect(info.conversions[argUse.id]).toBeUndefined();
  });
});

describe('rule 7 — calls', () => {
  it('rejects a call to an undeclared function (incl. call-before-definition)', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([
        b.func('int', 'main', [], b.block([b.ret(b.call('later', []))])),
        b.func('int', 'later', [], b.block([b.ret(b.intc(1))])),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.callDeclared);
  });

  it('rejects calling a variable', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [b.varDecl('int', [b.initDecl(b.dcl('x'))]), b.exprStmt(b.call('x', []))]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.callDeclared);
  });

  it('rejects an arity mismatch, citing rule 7', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([
        b.func('int', 'f', [b.param('int', b.dcl('x'))], b.block([b.ret(b.ident('x'))])),
        b.func('int', 'main', [], b.block([b.ret(b.call('f', [b.intc(1), b.intc(2)]))])),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.callArity);
  });

  it('rejects a non-assignable argument (float→int), citing rule 7', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([
        b.func('int', 'f', [b.param('int', b.dcl('x'))], b.block([b.ret(b.ident('x'))])),
        b.func('int', 'main', [], b.block([b.ret(b.call('f', [b.floatc(1.5)]))])),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.callArg);
  });

  it('widens an int argument passed to a float parameter', () => {
    let arg!: ConstExprNode;
    const { info, errors } = analyzeFixture((b) => {
      const f = b.func('float', 'f', [b.param('float', b.dcl('x'))], b.block([b.ret(b.ident('x'))]));
      arg = b.intc(2);
      const main = b.func(
        'int',
        'main',
        [],
        b.block([b.exprStmt(b.call('f', [arg])), b.ret(b.intc(0))]),
      );
      return b.program([f, main]);
    });
    expect(errors).toEqual([]);
    expect(info.conversions[arg.id]).toEqual({ from: INT, to: FLOAT });
  });

  it('accepts a bare void call as a statement but rejects its use as a value', () => {
    const accept = analyzeFixture((b) =>
      b.program([
        b.func('void', 'v', [], b.block([b.ret()])),
        b.func('int', 'main', [], b.block([b.exprStmt(b.call('v', [])), b.ret(b.intc(0))])),
      ]),
    );
    expect(accept.errors).toEqual([]);

    const reject = analyzeFixture((b) =>
      b.program([
        b.func('void', 'v', [], b.block([b.ret()])),
        b.func(
          'int',
          'main',
          [],
          b.block([
            b.varDecl('int', [b.initDecl(b.dcl('x'))]),
            b.exprStmt(b.assign(b.ident('x'), b.call('v', []))),
            b.ret(b.intc(0)),
          ]),
        ),
      ]),
    );
    expect(reject.errors).toHaveLength(1);
    expect(reject.errors[0]!.rule).toBe(RULE.voidValue);
  });
});

describe('rule 8 — return', () => {
  it("rejects 'return;' in a non-void function", () => {
    const { errors } = analyzeFixture((b) =>
      b.program([b.func('int', 'f', [], b.block([b.ret()]))]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.returnVoid);
  });

  it('rejects returning a value from a void function', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([b.func('void', 'f', [], b.block([b.ret(b.intc(1))]))]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.returnVoid);
  });

  it('rejects a narrowing return (return 1.5 from an int function)', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([b.func('int', 'f', [], b.block([b.ret(b.floatc(1.5))]))]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.returnAssignable);
  });

  it('accepts a char return from an int function (promotion)', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([b.func('int', 'f', [], b.block([b.ret(b.charc('a'))]))]),
    );
    expect(errors).toEqual([]);
  });

  it('warns (not errors) when a non-void function may miss a return', () => {
    const { errors, warnings } = analyzeFixture((b) =>
      b.program([
        b.func('int', 'f', [], b.block([b.exprStmt(b.bin('+', b.intc(1), b.intc(2)))])),
      ]),
    );
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.severity).toBe('warning');
    expect(warnings[0]!.rule).toBe(RULE.missingReturn);
  });

  it('does not warn when both branches of a trailing if/else return, nor for void functions', () => {
    const branchy = analyzeFixture((b) =>
      b.program([
        b.func(
          'int',
          'f',
          [b.param('int', b.dcl('x'))],
          b.block([b.ifs(b.ident('x'), b.ret(b.intc(1)), b.ret(b.intc(2)))]),
        ),
      ]),
    );
    expect(branchy.warnings).toEqual([]);

    const voidFn = analyzeFixture((b) =>
      b.program([b.func('void', 'f', [], b.block([b.exprStmt(null)]))]),
    );
    expect(voidFn.warnings).toEqual([]);
    expect(voidFn.errors).toEqual([]);
  });
});

describe('rule 9 — conditions are scalars', () => {
  it('accepts arithmetic, pointer, and decayed-array conditions in if/while/for', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [
        b.varDecl('int', [
          b.initDecl(b.dcl('p', 1)),
          b.initDecl(b.dcl('a', 0, { length: 2 })),
          b.initDecl(b.dcl('i')),
        ]),
        b.ifs(b.ident('p'), b.exprStmt(null)),
        b.wh(b.ident('a'), b.exprStmt(null)),
        b.fors(
          b.assign(b.ident('i'), b.intc(0)),
          b.bin('<', b.ident('i'), b.intc(3)),
          b.assign(b.ident('i'), b.bin('+', b.ident('i'), b.intc(1))),
          b.exprStmt(null),
        ),
      ]),
    );
    expect(errors).toEqual([]);
  });

  it('rejects a void condition (the only non-scalar value the subset can produce)', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([
        b.func('void', 'v', [], b.block([b.ret()])),
        b.func(
          'int',
          'main',
          [],
          b.block([b.ifs(b.call('v', []), b.exprStmt(null)), b.ret(b.intc(0))]),
        ),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.voidValue);
  });
});

describe('void declarations and function names as values', () => {
  it('rejects a void variable, citing the type rule', () => {
    const { errors } = analyzeFixture((b) =>
      mainWith(b, [b.varDecl('void', [b.initDecl(b.dcl('x'))])]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.voidVar);
  });

  it('rejects using a function name as a value', () => {
    const { errors } = analyzeFixture((b) =>
      b.program([
        b.func('int', 'f', [], b.block([b.ret(b.intc(1))])),
        b.func(
          'int',
          'main',
          [],
          b.block([
            b.varDecl('int', [b.initDecl(b.dcl('x'))]),
            b.exprStmt(b.assign(b.ident('x'), b.ident('f'))),
            b.ret(b.intc(0)),
          ]),
        ),
      ]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rule).toBe(RULE.funcAsValue);
  });
});

describe('typed events (synthesized attributes, post-order)', () => {
  it('emits a typed(nodeId, type, ruleApplied) macro event for each well-typed node, children first', () => {
    let left!: Expr;
    let right!: Expr;
    let sum!: Expr;
    const { rec } = analyzeFixture((b) => {
      left = b.intc(1);
      right = b.intc(2);
      sum = b.bin('+', left, right);
      return mainWith(b, [b.exprStmt(sum)]);
    });
    const typedIds = rec.trace.steps
      .filter((s) => s.event.kind === 'typed')
      .map((s) => (s.event.kind === 'typed' ? s.event.nodeId : -1));
    const li = typedIds.indexOf(left.id);
    const ri = typedIds.indexOf(right.id);
    const si = typedIds.indexOf(sum.id);
    expect(li).toBeGreaterThanOrEqual(0);
    expect(ri).toBeGreaterThan(li);
    expect(si).toBeGreaterThan(ri);
    const sumStep = rec.trace.steps.find(
      (s) => s.event.kind === 'typed' && s.event.nodeId === sum.id,
    )!;
    expect(sumStep.event.kind === 'typed' && sumStep.event.ruleApplied).toBe(RULE.arithOperands);
    expect(sumStep.meta.level).toBe('macro');
    expect(sumStep.meta.irRefs).toEqual([{ kind: 'astNode', id: sum.id }]);
  });
});
