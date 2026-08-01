/**
 * Semantic equivalence: runAsm(emit(select(tac))) must compute the value the
 * source TAC denotes — the asm interpreter (§8.2.1 machine model) is the
 * oracle for the whole codegen pipeline.
 */
import { describe, expect, it } from 'vitest';
import { codegen } from '../../src/codegen/emit.js';
import { runAsm } from '../../src/interp/asm.js';
import { runTac } from '../../src/interp/tac.js';
import type { TacProgram } from '../../src/ir/types.js';
import type { SymbolEntry } from '../../src/sem/types.js';
import {
  arrayPointerAgreementProgram,
  arrayProgram,
  callProgram,
  crossCallProgram,
  divProgram,
  divZeroProgram,
  floatAcrossCallProgram,
  floatProgram,
  frameArrayProgram,
  gcdProgram,
  globalArrayOverflowProgram,
  globalArrayProgram,
  globalProgram,
  logicProgram,
  manyLiveFloatsProgram,
  pointerProgram,
  spillProgram,
} from './fixtures.js';

function run(program: Parameters<typeof codegen>[0], symbols?: Parameters<typeof codegen>[1]) {
  const art = codegen(program, symbols);
  expect(art.diagnostics).toEqual([]);
  return runAsm(art.asm);
}

/** The TAC interpreter is the oracle: the emitted asm must compute the same
 *  value the source TAC denotes (§8.2.1 machine model vs the IR semantics). */
function agreesWithTac(program: TacProgram, symbols: SymbolEntry[] | undefined, expected: number) {
  const tac = runTac(program);
  expect(tac.returnValue).toBe(expected);
  const asm = run(program, symbols);
  expect(asm.error).toBeNull();
  expect(asm.returnValue).toBe(tac.returnValue);
}

describe('semantic equivalence (asm interpreter as oracle)', () => {
  it('call convention: main calling f(2,3,4) returns (2+3)*4 = 20', () => {
    expect(run(callProgram())).toEqual({ returnValue: 20, steps: expect.any(Number), error: null });
  });

  it('hand-written gcd TAC: gcd(48, 36) = 12', () => {
    expect(run(gcdProgram()).returnValue).toBe(12);
    expect(run(gcdProgram()).error).toBeNull();
  });

  it('spill program still sums 1..10 = 55 through its stack slots', () => {
    const art = codegen(spillProgram());
    expect(art.registers[0]!.spilled.length).toBeGreaterThan(0); // a REAL spill
    expect(runAsm(art.asm).returnValue).toBe(55);
  });

  it('division idiom (cqto + idivq): (7/2)*10 + 7%2 = 31', () => {
    expect(run(divProgram()).returnValue).toBe(31);
  });

  it('division by zero is a runtime error', () => {
    const art = codegen(divZeroProgram());
    const r = runAsm(art.asm);
    expect(r.returnValue).toBeNull();
    expect(r.error).toBe('division by zero');
  });

  it('frame arrays with constant and register indices: 5 + 7 = 12', () => {
    const { program, symbols } = arrayProgram();
    expect(run(program, symbols).returnValue).toBe(12);
  });

  it('float path (SSE round-robin, .double pool): (1.5+2.5)*3.0 > 11.9 ⇒ 1', () => {
    expect(run(floatProgram()).returnValue).toBe(1);
  });

  it('pointers through an address-taken local: *(&x) + 1 = 42', () => {
    expect(run(pointerProgram()).returnValue).toBe(42);
  });

  it('globals via rip-relative .comm storage: 30 + 12 = 42', () => {
    expect(run(globalProgram()).returnValue).toBe(42);
  });

  it('logic tiles (relop-value, not, neg, if/ifFalse): 42', () => {
    expect(run(logicProgram()).returnValue).toBe(42);
  });

  it('a value living ACROSS a call survives (callee-save discipline): 5+7 = 12', () => {
    expect(run(crossCallProgram()).returnValue).toBe(12);
  });

  it('global array via leaq g(%rip) and register index: 40 + 2 = 42', () => {
    const { program, symbols } = globalArrayProgram();
    expect(run(program, symbols).returnValue).toBe(42);
  });

  // Regression: index-load / index-store carry an ALREADY-SCALED byte offset
  // (§6.4.3 Fig 6.22). Re-scaling it in the addressing mode put element i of an
  // int array at base + 32i, past its slot and into the saved %rbp / caller.
  it('a local array in a non-main function stays inside its frame slot: 1+2+3+4 = 10', () => {
    const { program, symbols } = frameArrayProgram();
    agreesWithTac(program, symbols, 10);
  });

  it('the array-name path and the pointer path address the same element: a[1] = 7', () => {
    const { program, symbols } = arrayPointerAgreementProgram();
    agreesWithTac(program, symbols, 7);
  });

  it('a global array never writes past its .comm reservation into the next global: 5 + 777 = 782', () => {
    const { program, symbols } = globalArrayOverflowProgram();
    agreesWithTac(program, symbols, 782);
  });

  // Regression: float values used to get %xmm registers by round-robin, so a
  // live float collided with the pinned %xmm0 argument register (and with
  // another float once more than eight were live).
  it('a float live across a call survives the %xmm0 argument move: (1+2) + g(4) = 11', () => {
    const { program, symbols } = floatAcrossCallProgram();
    agreesWithTac(program, symbols, 1);
  });

  it('ten simultaneously live floats keep distinct values: 1.0 + … + 10.0 = 55', () => {
    agreesWithTac(manyLiveFloatsProgram(), undefined, 1);
  });

  it('step limit halts runaway programs', () => {
    const art = codegen(gcdProgram());
    const r = runAsm(art.asm, { stepLimit: 5 });
    expect(r.error).toMatch(/step limit/);
  });
});
