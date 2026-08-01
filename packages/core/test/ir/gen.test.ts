/**
 * Golden translations, transcribed in the book's style (Dragon 2nd ed. §6.4,
 * §6.6, §6.7, §6.9): exact quad sequences in formatQuad syntax, including
 * backpatched jump targets.
 */
import { describe, expect, it } from 'vitest';
import { formatQuad } from '../../src/ir/types.js';
import type { TacProgram } from '../../src/ir/types.js';
import { runIrGen } from '../../src/ir/gen.js';
import type { Fixture } from './programs.js';
import {
  arrayProgram,
  callProgram,
  conversionProgram,
  gcdProgram,
  globalVoidProgram,
  ifElseAndProgram,
  pointerProgram,
  sumForProgram,
  whileProgram,
} from './programs.js';

function tacOf(fix: Fixture): TacProgram {
  const { ast, sem } = fix.build();
  return runIrGen(ast, sem).result;
}

function fmt(tac: TacProgram, fnName: string): string[] {
  const fn = tac.functions.find((f) => f.name === fnName);
  if (!fn) throw new Error(`no function ${fnName}`);
  return fn.quads.map(formatQuad);
}

describe('ir gen goldens (§6.6.3/§6.7 backpatched control flow)', () => {
  it('while (a < b) a = a + 1; — Fig 6.46 while scheme with backpatching', () => {
    const tac = tacOf(whileProgram);
    expect(fmt(tac, 'f')).toEqual([
      'L1:',
      'if a < b goto L2',
      'goto L3',
      'L2:',
      't1 = a + 1',
      'a = t1',
      'goto L1',
      'L3:',
      'return a',
    ]);
  });

  it('if (a < b && c < d) x = 1; else x = 2; — short-circuit && per Fig 6.43', () => {
    const tac = tacOf(ifElseAndProgram);
    expect(fmt(tac, 'f')).toEqual([
      'if a < b goto L1',
      'goto L3',
      'L1:',
      'if c < d goto L2',
      'goto L3',
      'L2:',
      'x = 1',
      'goto L4',
      'L3:',
      'x = 2',
      'L4:',
      'return x',
    ]);
  });
});

describe('ir gen goldens (§6.4.3 arrays)', () => {
  it('a[i] = a[i] + 1 with int width 4 (offset = i * w, then index ops)', () => {
    const tac = tacOf(arrayProgram);
    expect(fmt(tac, 'f')).toEqual([
      't1 = i * 4',
      't2 = i * 4',
      't3 = a [ t2 ]',
      't4 = t3 + 1',
      'a [ t1 ] = t4',
      't5 = 0 * 4',
      't6 = a [ t5 ]',
      'return t6',
    ]);
  });

  it('float array uses width 8', () => {
    const tac = tacOf(arrayProgram);
    expect(fmt(tac, 'g')).toEqual([
      't1 = i * 8',
      'v [ t1 ] = 0.5',
      't2 = i * 8',
      't3 = v [ t2 ]',
      'return t3',
    ]);
  });
});

describe('ir gen goldens (§6.2.2 pointers)', () => {
  it('p = &x; *p = 5; y = *p;', () => {
    const tac = tacOf(pointerProgram);
    expect(fmt(tac, 'f')).toEqual([
      't1 = & x',
      'p = t1',
      '* p = 5',
      't2 = * p',
      'y = t2',
      'return y',
    ]);
  });
});

describe('ir gen goldens (§6.9 functions)', () => {
  it('n = add(2, 3): param/call/return shape, args left to right', () => {
    const tac = tacOf(callProgram);
    expect(fmt(tac, 'add')).toEqual(['t1 = x + y', 'return t1']);
    expect(fmt(tac, 'main')).toEqual([
      'param 2',
      'param 3',
      't1 = call add, 2',
      'n = t1',
      'return n',
    ]);
  });

  it('void call has no result; globals are collected', () => {
    const tac = tacOf(globalVoidProgram);
    expect(tac.globals).toHaveLength(1);
    expect(fmt(tac, 'setg')).toEqual(['g = v', 'return']);
    expect(fmt(tac, 'main')).toEqual(['param 5', 'call setg, 1', 'return g']);
  });
});

describe('ir gen goldens (§6.5.2 conversions)', () => {
  it('x = i + 1.5 inserts an explicit inttofloat where the conversions map says so', () => {
    const tac = tacOf(conversionProgram);
    expect(fmt(tac, 'f')).toEqual([
      't1 = (float) i',
      't2 = t1 + 1.5',
      'x = t2',
      'return x',
    ]);
  });
});

describe('ir gen goldens (for-loop + pointer indexing + decay)', () => {
  it('sum over a decayed array with a for loop', () => {
    const tac = tacOf(sumForProgram);
    expect(fmt(tac, 'sum')).toEqual([
      's = 0',
      'i = 0',
      'L1:',
      'if i < n goto L2',
      'goto L3',
      'L2:',
      't1 = i * 4',
      't2 = v + t1',
      't3 = * t2',
      't4 = s + t3',
      's = t4',
      't5 = i + 1',
      'i = t5',
      'goto L1',
      'L3:',
      'return s',
    ]);
    expect(fmt(tac, 'main')).toEqual([
      't1 = 0 * 4',
      'a [ t1 ] = 1',
      't2 = 1 * 4',
      'a [ t2 ] = 2',
      't3 = 2 * 4',
      'a [ t3 ] = 3',
      't4 = 3 * 4',
      'a [ t4 ] = 4',
      't5 = & a',
      'param t5',
      'param 4',
      't6 = call sum, 2',
      'return t6',
    ]);
  });
});

describe('ir gen goldens (gcd acceptance program)', () => {
  it('translates gcd and main', () => {
    const tac = tacOf(gcdProgram);
    expect(fmt(tac, 'gcd')).toEqual([
      'if b == 0 goto L1',
      'goto L2',
      'L1:',
      'return a',
      'L2:',
      't1 = a % b',
      'param b',
      'param t1',
      't2 = call gcd, 2',
      'return t2',
    ]);
    expect(fmt(tac, 'main')).toEqual([
      'param 12',
      'param 18',
      't1 = call gcd, 2',
      'return t1',
    ]);
  });

  it('temp and label numbering restarts per function; label quads bind L1, L2, …', () => {
    const tac = tacOf(gcdProgram);
    const gcd = tac.functions.find((f) => f.name === 'gcd')!;
    expect(gcd.tempCount).toBe(2);
    const labels = gcd.quads.filter((q) => q.op === 'label').map((q) => formatQuad(q));
    expect(labels).toEqual(['L1:', 'L2:']);
    const main = tac.functions.find((f) => f.name === 'main')!;
    expect(main.tempCount).toBe(1);
  });
});
