/**
 * Shared fixture programs for the IR tests. Each builder returns a fresh
 * { ast, sem } pair (deterministic node/symbol ids per build).
 */
import type { Ast } from '../../src/ast/types.js';
import type { SemanticInfo } from '../../src/sem/types.js';
import { buildProgram } from './fixtures.js';

export interface Fixture {
  name: string;
  build: () => { ast: Ast; sem: SemanticInfo };
}

/** int f(int a, int b) { while (a < b) a = a + 1; return a; } */
export const whileProgram: Fixture = {
  name: 'while',
  build: () =>
    buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'f',
          [b.param('int', 'a'), b.param('int', 'b')],
          b.compound(
            b.whileS(
              b.bin('<', b.id('a'), b.id('b')),
              b.exprStmt(b.assign(b.id('a'), b.bin('+', b.id('a'), b.int(1)))),
            ),
            b.ret(b.id('a')),
          ),
        ),
      ),
    ),
};

/** int f(int a,int b,int c,int d,int x) { if (a<b && c<d) x=1; else x=2; return x; } */
export const ifElseAndProgram: Fixture = {
  name: 'if-else-and',
  build: () =>
    buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'f',
          [
            b.param('int', 'a'),
            b.param('int', 'b'),
            b.param('int', 'c'),
            b.param('int', 'd'),
            b.param('int', 'x'),
          ],
          b.compound(
            b.ifS(
              b.bin('&&', b.bin('<', b.id('a'), b.id('b')), b.bin('<', b.id('c'), b.id('d'))),
              b.exprStmt(b.assign(b.id('x'), b.int(1))),
              b.exprStmt(b.assign(b.id('x'), b.int(2))),
            ),
            b.ret(b.id('x')),
          ),
        ),
      ),
    ),
};

/**
 * int f(int i) { int a[10]; a[i] = a[i] + 1; return a[0]; }
 * float g(int i) { float v[5]; v[i] = 0.5; return v[i]; }
 */
export const arrayProgram: Fixture = {
  name: 'arrays',
  build: () =>
    buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'f',
          [b.param('int', 'i')],
          b.compound(
            b.varDecl('int', 'a', null, { arrayLen: 10 }),
            b.exprStmt(
              b.assign(
                b.index(b.id('a'), b.id('i')),
                b.bin('+', b.index(b.id('a'), b.id('i')), b.int(1)),
              ),
            ),
            b.ret(b.index(b.id('a'), b.int(0))),
          ),
        ),
        b.func(
          'float',
          'g',
          [b.param('int', 'i')],
          b.compound(
            b.varDecl('float', 'v', null, { arrayLen: 5 }),
            b.exprStmt(b.assign(b.index(b.id('v'), b.id('i')), b.flt(0.5))),
            b.ret(b.index(b.id('v'), b.id('i'))),
          ),
        ),
      ),
    ),
};

/** int f() { int x; int* p; int y; p = &x; *p = 5; y = *p; return y; } */
export const pointerProgram: Fixture = {
  name: 'pointers',
  build: () =>
    buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'f',
          [],
          b.compound(
            b.varDecl('int', 'x'),
            b.varDecl('int', 'p', null, { ptr: 1 }),
            b.varDecl('int', 'y'),
            b.exprStmt(b.assign(b.id('p'), b.un('&', b.id('x')))),
            b.exprStmt(b.assign(b.un('*', b.id('p')), b.int(5))),
            b.exprStmt(b.assign(b.id('y'), b.un('*', b.id('p')))),
            b.ret(b.id('y')),
          ),
        ),
      ),
    ),
};

/** int add(int x,int y){return x+y;}  int main(){int n; n = add(2,3); return n;} */
export const callProgram: Fixture = {
  name: 'call',
  build: () =>
    buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'add',
          [b.param('int', 'x'), b.param('int', 'y')],
          b.compound(b.ret(b.bin('+', b.id('x'), b.id('y')))),
        ),
        b.func(
          'int',
          'main',
          [],
          b.compound(
            b.varDecl('int', 'n'),
            b.exprStmt(b.assign(b.id('n'), b.call('add', [b.int(2), b.int(3)]))),
            b.ret(b.id('n')),
          ),
        ),
      ),
    ),
};

/** float f(int i) { float x; x = i + 1.5; return x; } */
export const conversionProgram: Fixture = {
  name: 'inttofloat',
  build: () =>
    buildProgram((b) =>
      b.program(
        b.func(
          'float',
          'f',
          [b.param('int', 'i')],
          b.compound(
            b.varDecl('float', 'x'),
            b.exprStmt(b.assign(b.id('x'), b.bin('+', b.id('i'), b.flt(1.5)))),
            b.ret(b.id('x')),
          ),
        ),
      ),
    ),
};

/**
 * int gcd(int a, int b) { if (b == 0) return a; return gcd(b, a % b); }
 * int main() { return gcd(12, 18); }
 */
export const gcdProgram: Fixture = {
  name: 'gcd',
  build: () =>
    buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'gcd',
          [b.param('int', 'a'), b.param('int', 'b')],
          b.compound(
            b.ifS(b.bin('==', b.id('b'), b.int(0)), b.ret(b.id('a'))),
            b.ret(b.call('gcd', [b.id('b'), b.bin('%', b.id('a'), b.id('b'))])),
          ),
        ),
        b.func('int', 'main', [], b.compound(b.ret(b.call('gcd', [b.int(12), b.int(18)])))),
      ),
    ),
};

/**
 * int sum(int* v, int n) { int s; int i; s = 0;
 *   for (i = 0; i < n; i = i + 1) s = s + v[i]; return s; }
 * int main() { int a[4]; a[0]=1; a[1]=2; a[2]=3; a[3]=4; return sum(a, 4); }
 */
export const sumForProgram: Fixture = {
  name: 'sum-for',
  build: () =>
    buildProgram((b) =>
      b.program(
        b.func(
          'int',
          'sum',
          [b.param('int', 'v', { ptr: 1 }), b.param('int', 'n')],
          b.compound(
            b.varDecl('int', 's'),
            b.varDecl('int', 'i'),
            b.exprStmt(b.assign(b.id('s'), b.int(0))),
            b.forS(
              b.assign(b.id('i'), b.int(0)),
              b.bin('<', b.id('i'), b.id('n')),
              b.assign(b.id('i'), b.bin('+', b.id('i'), b.int(1))),
              b.exprStmt(b.assign(b.id('s'), b.bin('+', b.id('s'), b.index(b.id('v'), b.id('i'))))),
            ),
            b.ret(b.id('s')),
          ),
        ),
        b.func(
          'int',
          'main',
          [],
          b.compound(
            b.varDecl('int', 'a', null, { arrayLen: 4 }),
            b.exprStmt(b.assign(b.index(b.id('a'), b.int(0)), b.int(1))),
            b.exprStmt(b.assign(b.index(b.id('a'), b.int(1)), b.int(2))),
            b.exprStmt(b.assign(b.index(b.id('a'), b.int(2)), b.int(3))),
            b.exprStmt(b.assign(b.index(b.id('a'), b.int(3)), b.int(4))),
            b.ret(b.call('sum', [b.id('a'), b.int(4)])),
          ),
        ),
      ),
    ),
};

/** int g;  void setg(int v) { g = v; }  int main() { setg(5); return g; } */
export const globalVoidProgram: Fixture = {
  name: 'global-void',
  build: () =>
    buildProgram((b) =>
      b.program(
        b.varDecl('int', 'g'),
        b.func(
          'void',
          'setg',
          [b.param('int', 'v')],
          b.compound(b.exprStmt(b.assign(b.id('g'), b.id('v')))),
        ),
        b.func(
          'int',
          'main',
          [],
          b.compound(b.exprStmt(b.call('setg', [b.int(5)])), b.ret(b.id('g'))),
        ),
      ),
    ),
};

/** All fixtures, for the invariants/determinism sweep. */
export const allFixtures: Fixture[] = [
  whileProgram,
  ifElseAndProgram,
  arrayProgram,
  pointerProgram,
  callProgram,
  conversionProgram,
  gcdProgram,
  sumForProgram,
  globalVoidProgram,
];
