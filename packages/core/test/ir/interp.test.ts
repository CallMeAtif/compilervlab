/**
 * TAC interpreter oracle tests (docs/c-subset.md evaluation semantics),
 * including the gcd/main acceptance program.
 */
import { describe, expect, it } from 'vitest';
import { runIrGen } from '../../src/ir/gen.js';
import { runTac, TacRuntimeError } from '../../src/interp/tac.js';
import { buildProgram } from './fixtures.js';
import {
  arrayProgram,
  callProgram,
  gcdProgram,
  globalVoidProgram,
  pointerProgram,
  sumForProgram,
} from './programs.js';
import type { Fixture } from './programs.js';
import type { TacProgram } from '../../src/ir/types.js';

function tacOf(fix: Fixture): TacProgram {
  const { ast, sem } = fix.build();
  return runIrGen(ast, sem).result;
}

describe('tac interpreter (acceptance)', () => {
  it('gcd(12, 18) = 6 and main returns 6', () => {
    const tac = tacOf(gcdProgram);
    const run = runTac(tac);
    expect(run.returnValue).toBe(6);
    expect(run.steps).toBeGreaterThan(0);
    // explicit entry works too
    expect(runTac(tac, 'main').returnValue).toBe(6);
  });

  it('call program: main returns add(2, 3) = 5', () => {
    expect(runTac(tacOf(callProgram)).returnValue).toBe(5);
  });

  it('void call writes through to a global', () => {
    expect(runTac(tacOf(globalVoidProgram)).returnValue).toBe(5);
  });

  it('pointers: p = &x; *p = 5; y = *p', () => {
    expect(runTac(tacOf(pointerProgram), 'f').returnValue).toBe(5);
  });

  it('arrays: a[i] = a[i] + 1 with uninitialized reads as 0', () => {
    // entry f with parameter i unbound → i reads 0; a[0] becomes 0 + 1 = 1
    expect(runTac(tacOf(arrayProgram), 'f').returnValue).toBe(1);
  });

  it('for loop + decayed array parameter: sum(a, 4) = 10', () => {
    expect(runTac(tacOf(sumForProgram)).returnValue).toBe(10);
  });
});

describe('tac interpreter (evaluation semantics details)', () => {
  it('integer division truncates; float division does not', () => {
    const { ast, sem } = buildProgram((b) =>
      b.program(
        b.func('int', 'main', [], b.compound(b.ret(b.bin('/', b.int(7), b.int(2))))),
        b.func('float', 'fdiv', [], b.compound(b.ret(b.bin('/', b.flt(3), b.flt(2))))),
      ),
    );
    const tac = runIrGen(ast, sem).result;
    expect(runTac(tac).returnValue).toBe(3);
    expect(runTac(tac, 'fdiv').returnValue).toBe(1.5);
  });

  it('inttofloat conversion makes the division float', () => {
    // float f(int i) { return i / 2.0; } with i unbound (0) … use main instead:
    const { ast, sem } = buildProgram((b) =>
      b.program(
        b.func('float', 'half', [b.param('int', 'i')], b.compound(b.ret(b.bin('/', b.id('i'), b.flt(2))))),
        b.func('int', 'main', [], b.compound(b.exprStmt(b.call('half', [b.int(3)])), b.ret(b.int(0)))),
      ),
    );
    const tac = runIrGen(ast, sem).result;
    expect(runTac(tac, 'half').returnValue).toBe(0); // unbound i = 0
    // call half(3) through a wrapper that returns int is not allowed by the
    // subset; check the float path via a float-returning entry:
    const { ast: a2, sem: s2 } = buildProgram((b) =>
      b.program(
        b.func('float', 'main', [], b.compound(b.ret(b.bin('/', b.int(3), b.flt(2))))),
      ),
    );
    expect(runTac(runIrGen(a2, s2).result).returnValue).toBe(1.5);
  });

  it('division by zero is a runtime error', () => {
    const { ast, sem } = buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'main',
          [],
          b.compound(
            b.varDecl('int', 'x', b.int(0)),
            b.ret(b.bin('/', b.int(1), b.id('x'))),
          ),
        ),
      ),
    );
    expect(() => runTac(runIrGen(ast, sem).result)).toThrow(TacRuntimeError);
    expect(() => runTac(runIrGen(ast, sem).result)).toThrow(/division by zero/);
  });

  it('% by zero is a runtime error', () => {
    const { ast, sem } = buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'main',
          [],
          b.compound(
            b.varDecl('int', 'x', b.int(0)),
            b.ret(b.bin('%', b.int(1), b.id('x'))),
          ),
        ),
      ),
    );
    expect(() => runTac(runIrGen(ast, sem).result)).toThrow(/division by zero/);
  });

  it('step limit guards against infinite loops', () => {
    const { ast, sem } = buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'main',
          [],
          b.compound(b.whileS(b.int(1), b.exprStmt(null)), b.ret(b.int(0))),
        ),
      ),
    );
    const tac = runIrGen(ast, sem).result;
    expect(() => runTac(tac, 'main', 1000)).toThrow(/step limit/);
  });

  it('boolean value materialization: x = (a < b && c < d) yields 0/1', () => {
    const { ast, sem } = buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'main',
          [],
          b.compound(
            b.varDecl('int', 'a', b.int(1)),
            b.varDecl('int', 'b', b.int(2)),
            b.varDecl('int', 'c', b.int(3)),
            b.varDecl('int', 'd', b.int(4)),
            b.varDecl('int', 'x'),
            b.exprStmt(
              b.assign(
                b.id('x'),
                b.bin('&&', b.bin('<', b.id('a'), b.id('b')), b.bin('<', b.id('c'), b.id('d'))),
              ),
            ),
            b.ret(b.id('x')),
          ),
        ),
      ),
    );
    expect(runTac(runIrGen(ast, sem).result).returnValue).toBe(1);
  });

  it('unknown entry function is an error', () => {
    expect(() => runTac(tacOf(gcdProgram), 'nope')).toThrow(/no function named/);
  });
});
