/** Tiny TAC builders for the optimization tests. */
import type { Quad, TacFunction, TacOperand, TacOp, TacProgram } from '../../src/ir/types.js';

export const t = (id: number): TacOperand => ({ kind: 'temp', id });
export const v = (name: string, symbolId = 100): TacOperand => ({ kind: 'var', symbolId, name });
export const c = (value: number, ctype: 'int' | 'float' | 'char' = 'int'): TacOperand => ({
  kind: 'const',
  value,
  ctype,
});
export const lbl = (name: string): TacOperand => ({ kind: 'label', name });

let nextQuadIndex = 0;

export function q(
  op: TacOp,
  arg1: TacOperand | null,
  arg2: TacOperand | null,
  result: TacOperand | null,
  relop?: '==' | '!=' | '<' | '>' | '<=' | '>=',
): Quad {
  const quad: Quad = { index: nextQuadIndex++, op, arg1, arg2, result, astNodeId: 0 };
  if (relop) quad.relop = relop;
  return quad;
}

export const bin = (result: TacOperand, a: TacOperand, op: TacOp, b: TacOperand): Quad =>
  q(op, a, b, result);
export const copy = (result: TacOperand, src: TacOperand): Quad => q('copy', src, null, result);
export const label = (name: string): Quad => q('label', null, null, lbl(name));
export const goto_ = (name: string): Quad => q('goto', null, null, lbl(name));
export const if_ = (x: TacOperand, name: string): Quad => q('if', x, null, lbl(name));
export const iffalse = (x: TacOperand, name: string): Quad => q('iffalse', x, null, lbl(name));
export const ret = (x: TacOperand | null = null): Quad => q('return', x, null, null);
export const param = (x: TacOperand): Quad => q('param', x, null, null);
export const call = (fnName: string, n: number, result: TacOperand | null = null): Quad =>
  q('call', lbl(fnName), c(n), result);

/** Build a function; quad indices are rewritten to 0..n-1 in order. */
export function fn(name: string, quads: Quad[], tempCount = 10): TacFunction {
  quads.forEach((quad, i) => {
    quad.index = i;
  });
  nextQuadIndex = 0;
  return { name, symbolId: 1, params: [], quads, tempCount };
}

export function prog(fns: TacFunction[], globals: number[] = []): TacProgram {
  return { functions: fns, globals };
}

/**
 * The Dragon Book §9.2 running example flow graph (Fig 9.13): B1 = {d1: i=m-1,
 * d2: j=n, d3: a=u1}, B2 = {d4: i=i+1, d5: j=j-1}, B3 = {d6: a=u2},
 * B4 = {d7: i=u3}; edges B1→B2, B2→B3, B2→B4, B3→B4, B4→B2, B4→EXIT.
 * Our blocks B0..B3 correspond to the book's B1..B4.
 */
export function fig913(): TacFunction {
  const i = v('i', 1);
  const j = v('j', 2);
  const a = v('a', 3);
  const m = v('m', 4);
  const n = v('n', 5);
  const u1 = v('u1', 6);
  const u2 = v('u2', 7);
  const u3 = v('u3', 8);
  const e1 = v('e1', 9);
  const e2 = v('e2', 10);
  return fn('f', [
    bin(i, m, '-', c(1)), // 0  d1
    copy(j, n), //           1  d2
    copy(a, u1), //          2  d3
    label('L2'), //          3
    bin(i, i, '+', c(1)), // 4  d4
    bin(j, j, '-', c(1)), // 5  d5
    iffalse(e1, 'L4'), //    6
    copy(a, u2), //          7  d6
    label('L4'), //          8
    copy(i, u3), //          9  d7
    if_(e2, 'L2'), //        10
  ]);
}
