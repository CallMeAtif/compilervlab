/**
 * Register-allocator validity: on every fixture, no two simultaneously-live
 * pseudos share a register and spilled values round-trip through their own
 * stack slots (checked structurally by walking the final code with a fresh
 * liveness analysis — see validity.ts).
 */
import { describe, expect, it } from 'vitest';
import { drainSteps } from '../../src/codegen/cg-events.js';
import { allocateRegisters, computeAllocation } from '../../src/codegen/color.js';
import { selectInstructions } from '../../src/codegen/isel.js';
import { GP_REGISTERS } from '../../src/codegen/types.js';
import type { SymbolEntry } from '../../src/sem/types.js';
import type { TacProgram } from '../../src/ir/types.js';
import {
  arrayPointerAgreementProgram,
  arrayProgram,
  callProgram,
  crossCallProgram,
  divProgram,
  fnAbcProgram,
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
import { checkAllocation } from './validity.js';

function allocate(program: TacProgram, symbols?: SymbolEntry[]) {
  const isel = drainSteps(selectInstructions(program, symbols));
  const colors = computeAllocation(isel);
  return { isel, colors };
}

const fixtures: Array<[string, () => { program: TacProgram; symbols?: SymbolEntry[] }]> = [
  ['fnAbc', () => ({ program: fnAbcProgram() })],
  ['call', () => ({ program: callProgram() })],
  ['gcd', () => ({ program: gcdProgram() })],
  ['spill (>8 live temps)', () => ({ program: spillProgram() })],
  ['div', () => ({ program: divProgram() })],
  ['array', () => arrayProgram()],
  ['float', () => ({ program: floatProgram() })],
  ['pointer', () => ({ program: pointerProgram() })],
  ['global', () => ({ program: globalProgram() })],
  ['logic', () => ({ program: logicProgram() })],
  ['cross-call', () => ({ program: crossCallProgram() })],
  ['global-array', () => globalArrayProgram()],
  ['frame-array', () => frameArrayProgram()],
  ['array/pointer agreement', () => arrayPointerAgreementProgram()],
  ['global-array overflow', () => globalArrayOverflowProgram()],
  ['float across a call', () => floatAcrossCallProgram()],
  ['many live floats', () => ({ program: manyLiveFloatsProgram() })],
];

describe('allocator validity checker', () => {
  for (const [name, mk] of fixtures) {
    it(`${name}: every function passes the validity walk`, () => {
      const { program, symbols } = mk();
      const { isel, colors } = allocate(program, symbols);
      expect(isel.functions.length).toBe(colors.length);
      for (let i = 0; i < isel.functions.length; i++) {
        expect(checkAllocation(isel.functions[i]!, colors[i]!)).toEqual([]);
      }
    });
  }

  it('spill fixture really spills: >8 simultaneously live temps, K=8', () => {
    const { isel, colors } = allocate(spillProgram());
    const main = colors[0]!;
    expect(main.assignment.spilled.length).toBeGreaterThanOrEqual(2);
    expect(main.rounds).toBeGreaterThan(1);
    // spilled pseudos got frame slots, everyone else a real GP register
    for (const [node, a] of Object.entries(main.assignment.assignment)) {
      if ('reg' in a) expect(GP_REGISTERS).toContain(a.reg);
      else expect(main.assignment.spilled).toContain(node);
    }
    // ≥ 9 pseudos live at once cannot fit 8 registers — sanity: the graph had
    // a 10-clique, so at most 8 of t1..t10 can be register-allocated.
    const clique = Array.from({ length: 10 }, (_, i) => `t${i + 1}`);
    const inRegs = clique.filter((n) => {
      const a = main.assignment.assignment[n];
      return a !== undefined && 'reg' in a;
    });
    expect(inRegs.length).toBeLessThanOrEqual(8);
    expect(isel.functions[0]!.pseudos.length).toBeGreaterThanOrEqual(19);
  });

  it('never assigns the reserved scratch registers %rax/%rdx', () => {
    for (const [, mk] of fixtures) {
      const { program, symbols } = mk();
      const { colors } = allocate(program, symbols);
      for (const c of colors) {
        for (const a of Object.values(c.assignment.assignment)) {
          if ('reg' in a) expect(['%rax', '%rdx']).not.toContain(a.reg);
        }
      }
    }
  });
});

/**
 * K is a real constraint on SELECT, not just a simplify-phase heuristic: with a
 * smaller K the allocator must colour from the first K registers only and spill
 * whatever will not fit — and the result must stay valid.
 */
describe('K constrains the colour palette (§8.8.4)', () => {
  for (const [name, mk] of fixtures) {
    it(`${name}: uses at most K registers and stays valid for K = 8, 4, 3, 2`, () => {
      const { program, symbols } = mk();
      const isel = drainSteps(selectInstructions(program, symbols));
      for (const k of [8, 4, 3, 2]) {
        const colors = drainSteps(allocateRegisters(isel, k));
        const used = new Set<string>();
        for (const c of colors) {
          for (const a of Object.values(c.assignment.assignment)) {
            if ('reg' in a) used.add(a.reg);
          }
        }
        expect(used.size, `${name} K=${k} used ${[...used].sort().join(',')}`).toBeLessThanOrEqual(k);
        for (const r of used) expect(GP_REGISTERS.slice(0, k)).toContain(r);
        for (let i = 0; i < isel.functions.length; i++) {
          expect(checkAllocation(isel.functions[i]!, colors[i]!)).toEqual([]);
        }
      }
    });
  }
});
