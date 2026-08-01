/**
 * Hand-written TAC fixture programs for the codegen tests (lab TAC per
 * ir/types.ts; quads numbered from 0 within each function).
 *
 * Array convention (must match ir/gen.ts and interp/tac.ts): the second
 * operand of `index-load` / `index-store` is the ALREADY-SCALED BYTE OFFSET
 * `i × width` (§6.4.3 Fig 6.22), NOT an element number. With int width 4,
 * a[0], a[1], a[2], a[3] are offsets 0, 4, 8, 12.
 */
import type { Quad, TacFunction, TacOp, TacOperand, TacProgram } from '../../src/ir/types.js';
import type { SymbolEntry } from '../../src/sem/types.js';

export const t = (id: number): TacOperand => ({ kind: 'temp', id });
export const v = (symbolId: number, name: string): TacOperand => ({ kind: 'var', symbolId, name });
export const ci = (value: number): TacOperand => ({ kind: 'const', value, ctype: 'int' });
export const cf = (value: number): TacOperand => ({ kind: 'const', value, ctype: 'float' });
export const lb = (name: string): TacOperand => ({ kind: 'label', name });

let qi = 0;
export function resetQuads(): void {
  qi = 0;
}
export function q(
  op: TacOp,
  arg1: TacOperand | null,
  arg2: TacOperand | null,
  result: TacOperand | null,
  relop?: '==' | '!=' | '<' | '>' | '<=' | '>=',
): Quad {
  const quad: Quad = { index: qi++, op, arg1, arg2, result, astNodeId: 0 };
  if (relop !== undefined) quad.relop = relop;
  return quad;
}

export function fn(name: string, symbolId: number, params: number[], quads: Quad[], tempCount: number): TacFunction {
  return { name, symbolId, params, quads, tempCount };
}

export function prog(functions: TacFunction[], globals: number[] = []): TacProgram {
  return { functions, globals };
}

const SPAN = { start: 0, end: 0, line: 1, col: 1 };
export function sym(id: number, name: string, type: SymbolEntry['type'], kind: SymbolEntry['kind'] = 'var'): SymbolEntry {
  return { id, name, type, kind, scopeId: 0, declSpan: { ...SPAN }, declNodeId: 0 };
}

// ---------------------------------------------------------------------------
// f(a, b, c) { t1 = a + b; t2 = t1 * c; return t2; }  — the golden fixture
// ---------------------------------------------------------------------------
export function fnAbcProgram(): TacProgram {
  resetQuads();
  const f = fn('f', 100, [1, 2, 3], [
    q('+', v(1, 'a'), v(2, 'b'), t(1)),
    q('*', t(1), v(3, 'c'), t(2)),
    q('return', t(2), null, null),
  ], 2);
  return prog([f]);
}

/** main() { return f(2, 3, 4); } + f above ⇒ (2+3)*4 = 20 */
export function callProgram(): TacProgram {
  resetQuads();
  const f = fn('f', 100, [1, 2, 3], [
    q('+', v(1, 'a'), v(2, 'b'), t(1)),
    q('*', t(1), v(3, 'c'), t(2)),
    q('return', t(2), null, null),
  ], 2);
  resetQuads();
  const main = fn('main', 101, [], [
    q('param', ci(2), null, null),
    q('param', ci(3), null, null),
    q('param', ci(4), null, null),
    q('call', v(100, 'f'), ci(3), t(1)),
    q('return', t(1), null, null),
  ], 1);
  return prog([f, main]);
}

// ---------------------------------------------------------------------------
// Euclid's gcd (loop; exercises ifrel, copies, calls) ⇒ gcd(48, 36) = 12
// ---------------------------------------------------------------------------
export function gcdProgram(): TacProgram {
  resetQuads();
  const gcd = fn('gcd', 100, [1, 2], [
    q('label', null, null, lb('L1')),
    q('ifrel', v(1, 'a'), v(2, 'b'), lb('L2'), '=='),
    q('ifrel', v(1, 'a'), v(2, 'b'), lb('L3'), '<'),
    q('-', v(1, 'a'), v(2, 'b'), t(1)),
    q('copy', t(1), null, v(1, 'a')),
    q('goto', null, null, lb('L1')),
    q('label', null, null, lb('L3')),
    q('-', v(2, 'b'), v(1, 'a'), t(2)),
    q('copy', t(2), null, v(2, 'b')),
    q('goto', null, null, lb('L1')),
    q('label', null, null, lb('L2')),
    q('return', v(1, 'a'), null, null),
  ], 2);
  resetQuads();
  const main = fn('main', 101, [], [
    q('param', ci(48), null, null),
    q('param', ci(36), null, null),
    q('call', v(100, 'gcd'), ci(2), t(1)),
    q('return', t(1), null, null),
  ], 1);
  return prog([gcd, main]);
}

// ---------------------------------------------------------------------------
// >8 simultaneously live temps — forces a real spill ⇒ 1+2+…+10 = 55
// ---------------------------------------------------------------------------
export function spillProgram(): TacProgram {
  resetQuads();
  const quads: Quad[] = [];
  for (let i = 1; i <= 10; i++) quads.push(q('copy', ci(i), null, t(i)));
  quads.push(q('+', t(1), t(2), t(11)));
  for (let i = 3; i <= 10; i++) quads.push(q('+', t(8 + i), t(i), t(9 + i)));
  quads.push(q('return', t(19), null, null));
  return prog([fn('main', 100, [], quads, 19)]);
}

// ---------------------------------------------------------------------------
// Division/remainder ⇒ (7/2)*10 + 7%2 = 31
// ---------------------------------------------------------------------------
export function divProgram(): TacProgram {
  resetQuads();
  const main = fn('main', 100, [], [
    q('/', ci(7), ci(2), t(1)),
    q('%', ci(7), ci(2), t(2)),
    q('*', t(1), ci(10), t(3)),
    q('+', t(3), t(2), t(4)),
    q('return', t(4), null, null),
  ], 4);
  return prog([main]);
}

/** Division by zero ⇒ runtime error in the asm interpreter. */
export function divZeroProgram(): TacProgram {
  resetQuads();
  const main = fn('main', 100, [], [
    q('/', ci(1), ci(0), t(1)),
    q('return', t(1), null, null),
  ], 1);
  return prog([main]);
}

// ---------------------------------------------------------------------------
// Array on the frame (const + register byte offset) ⇒ 5 + 7 = 12; needs symbols
// ---------------------------------------------------------------------------
export function arrayProgram(): { program: TacProgram; symbols: SymbolEntry[] } {
  resetQuads();
  const main = fn('main', 100, [], [
    q('index-store', ci(5), ci(0), v(1, 'a')), // a[0] = 5
    q('copy', ci(4), null, t(1)), // t1 = byte offset of a[1] (int width 4)
    q('index-store', ci(7), t(1), v(1, 'a')), // a[1] = 7
    q('index-load', v(1, 'a'), ci(0), t(2)),
    q('index-load', v(1, 'a'), t(1), t(3)),
    q('+', t(2), t(3), t(4)),
    q('return', t(4), null, null),
  ], 4);
  const symbols = [
    sym(1, 'a', { kind: 'array', of: { kind: 'base', name: 'int' }, length: 5 }),
    sym(100, 'main', { kind: 'function', ret: { kind: 'base', name: 'int' }, params: [] }, 'func'),
  ];
  return { program: prog([main]), symbols };
}

// ---------------------------------------------------------------------------
// Floats: SSE round-robin path ⇒ (1.5+2.5)*(float)3 = 12.0 > 11.9 ⇒ 1
// ---------------------------------------------------------------------------
export function floatProgram(): TacProgram {
  resetQuads();
  const main = fn('main', 100, [], [
    q('copy', cf(1.5), null, t(1)),
    q('copy', cf(2.5), null, t(2)),
    q('+', t(1), t(2), t(3)),
    q('inttofloat', ci(3), null, t(4)),
    q('*', t(3), t(4), t(5)),
    q('>', t(5), cf(11.9), t(6)),
    q('return', t(6), null, null),
  ], 6);
  return prog([main]);
}

// ---------------------------------------------------------------------------
// Pointers: & and * through an address-taken local ⇒ 41 + 1 = 42
// ---------------------------------------------------------------------------
export function pointerProgram(): TacProgram {
  resetQuads();
  const main = fn('main', 100, [], [
    q('copy', ci(41), null, v(1, 'x')),
    q('addr', v(1, 'x'), null, v(2, 'p')),
    q('deref-load', v(2, 'p'), null, t(1)),
    q('+', t(1), ci(1), t(2)),
    q('deref-store', t(2), null, v(2, 'p')),
    q('copy', v(1, 'x'), null, t(3)),
    q('return', t(3), null, null),
  ], 3);
  return prog([main]);
}

// ---------------------------------------------------------------------------
// Globals ⇒ g = 30; h = g + 12; return h ⇒ 42
// ---------------------------------------------------------------------------
export function globalProgram(): TacProgram {
  resetQuads();
  const main = fn('main', 100, [], [
    q('copy', ci(30), null, v(1, 'g')),
    q('+', v(1, 'g'), ci(12), t(1)),
    q('copy', t(1), null, v(2, 'h')),
    q('copy', v(2, 'h'), null, t(2)),
    q('return', t(2), null, null),
  ], 2);
  return prog([main], [1, 2]);
}

// ---------------------------------------------------------------------------
// Logic tiles: relop-value, not, neg, if / ifFalse ⇒ 42
// ---------------------------------------------------------------------------
export function logicProgram(): TacProgram {
  resetQuads();
  const main = fn('main', 100, [], [
    q('<', ci(5), ci(3), t(1)), // t1 = 0
    q('not', t(1), null, t(2)), // t2 = 1
    q('iffalse', t(1), null, lb('L1')), // taken
    q('return', ci(7), null, null), // dead
    q('label', null, null, lb('L1')),
    q('if', t(2), null, lb('L2')), // taken
    q('return', ci(8), null, null), // dead
    q('label', null, null, lb('L2')),
    q('neg', t(2), null, t(3)), // t3 = -1
    q('+', t(3), ci(43), t(4)), // t4 = 42
    q('return', t(4), null, null),
  ], 4);
  return prog([main]);
}

// ---------------------------------------------------------------------------
// A value lives ACROSS a call: exercises callee-save + precolored arg regs
// main: x = 5; t1 = id(7); t2 = x + t1; return 12
// ---------------------------------------------------------------------------
export function crossCallProgram(): TacProgram {
  resetQuads();
  const id = fn('id', 100, [1], [
    q('copy', v(1, 'n'), null, t(1)),
    q('return', t(1), null, null),
  ], 1);
  resetQuads();
  const main = fn('main', 101, [], [
    q('copy', ci(5), null, v(2, 'x')),
    q('param', ci(7), null, null),
    q('call', v(100, 'id'), ci(1), t(1)),
    q('+', v(2, 'x'), t(1), t(2)),
    q('return', t(2), null, null),
  ], 2);
  return prog([id, main]);
}

// ---------------------------------------------------------------------------
// Global ARRAY via leaq g(%rip) + register index ⇒ 40 + 2 = 42; needs symbols
// ---------------------------------------------------------------------------
export function globalArrayProgram(): { program: TacProgram; symbols: SymbolEntry[] } {
  resetQuads();
  const main = fn('main', 100, [], [
    q('copy', ci(0), null, t(1)),
    q('index-store', ci(40), t(1), v(1, 'g')),
    q('index-load', v(1, 'g'), ci(0), t(2)),
    q('+', t(2), ci(2), t(3)),
    q('return', t(3), null, null),
  ], 3);
  const symbols = [
    sym(1, 'g', { kind: 'array', of: { kind: 'base', name: 'int' }, length: 3 }),
  ];
  return { program: prog([main], [1]), symbols };
}

// ---------------------------------------------------------------------------
// A local array in a NON-main function, written through both a register byte
// offset and constant byte offsets. Any re-scaling of the IR's byte offset
// runs off the 32-byte slot and smashes the saved %rbp / return address.
// f() { int a[4]; a[0]=1; a[1]=2; a[2]=3; a[3]=4; return a[0]+a[1]+a[2]+a[3]; }
// main() { return f(); }                                            ⇒ 10
// ---------------------------------------------------------------------------
export function frameArrayProgram(): { program: TacProgram; symbols: SymbolEntry[] } {
  resetQuads();
  const f = fn('f', 100, [], [
    q('copy', ci(4), null, t(1)), // byte offset of a[1]
    q('index-store', ci(1), ci(0), v(1, 'a')),
    q('index-store', ci(2), t(1), v(1, 'a')), // register offset
    q('index-store', ci(3), ci(8), v(1, 'a')),
    q('index-store', ci(4), ci(12), v(1, 'a')),
    q('index-load', v(1, 'a'), ci(0), t(2)),
    q('index-load', v(1, 'a'), t(1), t(3)),
    q('index-load', v(1, 'a'), ci(8), t(4)),
    q('index-load', v(1, 'a'), ci(12), t(5)),
    q('+', t(2), t(3), t(6)),
    q('+', t(6), t(4), t(7)),
    q('+', t(7), t(5), t(8)),
    q('return', t(8), null, null),
  ], 8);
  resetQuads();
  const main = fn('main', 101, [], [
    q('call', v(100, 'f'), ci(0), t(1)),
    q('return', t(1), null, null),
  ], 1);
  const symbols = [
    sym(1, 'a', { kind: 'array', of: { kind: 'base', name: 'int' }, length: 4 }),
    sym(100, 'f', { kind: 'function', ret: { kind: 'base', name: 'int' }, params: [] }, 'func'),
    sym(101, 'main', { kind: 'function', ret: { kind: 'base', name: 'int' }, params: [] }, 'func'),
  ];
  return { program: prog([f, main]), symbols };
}

// ---------------------------------------------------------------------------
// The array-name path (index-store on 'a') and the pointer path (a decayed
// array parameter reached by `t = p + off; *t`) must address the SAME element.
// main() { int a[4]; a[1] = 7; return g(a); }   int g(int* p) { return p[1]; }
//                                                                    ⇒ 7
// ---------------------------------------------------------------------------
export function arrayPointerAgreementProgram(): { program: TacProgram; symbols: SymbolEntry[] } {
  resetQuads();
  const g = fn('g', 100, [2], [
    q('+', v(2, 'p'), ci(4), t(1)), // &p[1] — byte offset, unscaled
    q('deref-load', t(1), null, t(2)),
    q('return', t(2), null, null),
  ], 2);
  resetQuads();
  const main = fn('main', 101, [], [
    q('copy', ci(4), null, t(1)),
    q('index-store', ci(7), t(1), v(1, 'a')), // a[1] = 7 through the array name
    q('addr', v(1, 'a'), null, t(2)), // array name in value context decays
    q('param', t(2), null, null),
    q('call', v(100, 'g'), ci(1), t(3)),
    q('return', t(3), null, null),
  ], 3);
  const symbols = [
    sym(1, 'a', { kind: 'array', of: { kind: 'base', name: 'int' }, length: 4 }),
    sym(2, 'p', { kind: 'pointer', to: { kind: 'base', name: 'int' } }, 'param'),
    sym(100, 'g', { kind: 'function', ret: { kind: 'base', name: 'int' }, params: [{ kind: 'pointer', to: { kind: 'base', name: 'int' } }] }, 'func'),
    sym(101, 'main', { kind: 'function', ret: { kind: 'base', name: 'int' }, params: [] }, 'func'),
  ];
  return { program: prog([g, main]), symbols };
}

// ---------------------------------------------------------------------------
// A global array immediately followed by a global scalar: writing past the
// array's 32 `.comm` bytes lands in 'h'.
// int g[4]; int h; main() { h = 777; g[1] = 5; g[3] = 6; return g[1] + h; }
//                                                                    ⇒ 782
// ---------------------------------------------------------------------------
export function globalArrayOverflowProgram(): { program: TacProgram; symbols: SymbolEntry[] } {
  resetQuads();
  const main = fn('main', 100, [], [
    q('copy', ci(777), null, v(2, 'h')),
    q('copy', ci(4), null, t(1)), // byte offset of g[1]
    q('index-store', ci(5), t(1), v(1, 'g')),
    q('index-store', ci(6), ci(12), v(1, 'g')),
    q('index-load', v(1, 'g'), t(1), t(2)),
    q('+', t(2), v(2, 'h'), t(3)),
    q('return', t(3), null, null),
  ], 3);
  const symbols = [
    sym(1, 'g', { kind: 'array', of: { kind: 'base', name: 'int' }, length: 4 }),
    sym(2, 'h', { kind: 'base', name: 'int' }),
  ];
  return { program: prog([main], [1, 2]), symbols };
}

// ---------------------------------------------------------------------------
// A float value LIVE ACROSS A CALL whose argument goes through %xmm0.
// float g(float x) { return x + x; }
// main() { float a = 1.0, b = 2.0; r = (a+b) + g(4.0); return 10.9<r<11.1; }
//                                                                    ⇒ 1
// ---------------------------------------------------------------------------
export function floatAcrossCallProgram(): { program: TacProgram; symbols: SymbolEntry[] } {
  resetQuads();
  const g = fn('g', 100, [1], [
    q('+', v(1, 'x'), v(1, 'x'), t(1)),
    q('return', t(1), null, null),
  ], 1);
  resetQuads();
  const main = fn('main', 101, [], [
    q('copy', cf(1.0), null, v(2, 'a')),
    q('copy', cf(2.0), null, v(3, 'b')),
    q('+', v(2, 'a'), v(3, 'b'), t(1)), // 3.0 — live across the call below
    q('param', cf(4.0), null, null),
    q('call', v(100, 'g'), ci(1), t(2)), // 8.0
    q('+', t(1), t(2), t(3)), // 11.0
    q('>', t(3), cf(10.9), t(4)),
    q('<', t(3), cf(11.1), t(5)),
    q('*', t(4), t(5), t(6)),
    q('return', t(6), null, null),
  ], 6);
  const symbols = [
    sym(1, 'x', { kind: 'base', name: 'float' }, 'param'),
    sym(2, 'a', { kind: 'base', name: 'float' }),
    sym(3, 'b', { kind: 'base', name: 'float' }),
    sym(100, 'g', { kind: 'function', ret: { kind: 'base', name: 'float' }, params: [{ kind: 'base', name: 'float' }] }, 'func'),
    sym(101, 'main', { kind: 'function', ret: { kind: 'base', name: 'int' }, params: [] }, 'func'),
  ];
  return { program: prog([g, main]), symbols };
}

// ---------------------------------------------------------------------------
// Ten simultaneously live float values — more than there are argument-class
// SSE registers, so any wrap-around scheme makes two of them share a register.
// 1.0 + 2.0 + … + 10.0 = 55.0, then range-checked                    ⇒ 1
// ---------------------------------------------------------------------------
export function manyLiveFloatsProgram(): TacProgram {
  resetQuads();
  const quads: Quad[] = [];
  for (let i = 1; i <= 10; i++) quads.push(q('copy', cf(i), null, t(i)));
  quads.push(q('+', t(1), t(2), t(11)));
  for (let i = 3; i <= 10; i++) quads.push(q('+', t(8 + i), t(i), t(9 + i)));
  quads.push(q('>', t(19), cf(54.9), t(20)));
  quads.push(q('<', t(19), cf(55.1), t(21)));
  quads.push(q('*', t(20), t(21), t(22)));
  quads.push(q('return', t(22), null, null));
  return prog([fn('main', 100, [], quads, 22)]);
}
