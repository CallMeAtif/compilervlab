/**
 * Allocator VALIDITY checker (test oracle): walks the final selected code
 * with a fresh liveness analysis and asserts
 *   (1) no two simultaneously-live pseudos share a register (with the sound
 *       exception of a copy's source/target, which hold the same value);
 *   (2) pseudos never share a register with an overlapping pinned physical
 *       register (argument registers etc.);
 *   (3) every spilled pseudo is fully rewritten out of the code and all its
 *       spill traffic goes through its own stack slot (value round-trips).
 */
import { GP_REGISTERS } from '../../src/codegen/types.js';
import type { ColorOutcome, VFunction } from '../../src/codegen/cg-events.js';
import { computeLiveness, moveOf, useDef } from '../../src/codegen/liveness.js';

const GP_SET = new Set<string>(GP_REGISTERS);

export function checkAllocation(vfn: VFunction, outcome: ColorOutcome): string[] {
  const violations: string[] = [];
  const code = outcome.finalCode;
  const floatSet = new Set(vfn.floatPseudos.map((f) => f.name));
  const isPseudo = (n: string): boolean => !n.startsWith('%') && !floatSet.has(n);

  const regOf = (n: string): string | null => {
    const a = outcome.assignment.assignment[n];
    return a && 'reg' in a ? a.reg : null;
  };

  const live = computeLiveness(vfn.name, code);

  // (1)+(2): def × live-out conflicts
  for (let i = 0; i < code.length; i++) {
    const instr = code[i]!;
    const ud = useDef(instr);
    const liveOut = live.liveOut[i] ?? [];
    const mv = moveOf(instr);
    for (const d of ud.def) {
      for (const l of liveOut) {
        if (l === d) continue;
        if (mv && mv.dst === d && mv.src === l) continue; // same value: sound share
        if (isPseudo(d) && isPseudo(l)) {
          const rd = regOf(d);
          const rl = regOf(l);
          if (rd === null) violations.push(`instr ${i}: pseudo '${d}' has no register`);
          else if (rl === null) violations.push(`instr ${i}: live pseudo '${l}' has no register`);
          else if (rd === rl) {
            violations.push(`instr ${i}: '${d}' and simultaneously-live '${l}' share ${rd}`);
          }
        } else if (isPseudo(d) && GP_SET.has(l)) {
          if (regOf(d) === l) violations.push(`instr ${i}: '${d}' defined in ${l} while physical ${l} is live`);
        } else if (GP_SET.has(d) && isPseudo(l)) {
          if (regOf(l) === d) violations.push(`instr ${i}: physical ${d} written while '${l}' (in ${d}) is live`);
        }
      }
    }
  }

  // Every non-float pseudo appearing in the final code must have a register.
  const seen = new Set<string>();
  for (const instr of code) {
    for (const o of instr.operands) {
      const names: string[] = [];
      if (o.k === 'pseudo') names.push(o.name);
      if (o.k === 'mem') {
        if (o.base !== null && !o.base.startsWith('%')) names.push(o.base);
        if (o.index !== undefined && !o.index.startsWith('%')) names.push(o.index);
      }
      for (const n of names) {
        if (floatSet.has(n) || seen.has(n)) continue;
        seen.add(n);
        if (regOf(n) === null) violations.push(`pseudo '${n}' in final code has no register`);
      }
    }
  }

  // (3): spilled pseudos are gone; their traffic uses exactly their slot.
  for (const s of outcome.assignment.spilled) {
    if (seen.has(s)) violations.push(`spilled pseudo '${s}' still appears in the final code`);
    const a = outcome.assignment.assignment[s];
    if (!a || !('spillSlot' in a)) {
      violations.push(`spilled pseudo '${s}' has no spill slot in the assignment`);
      continue;
    }
    const slot = a.spillSlot;
    const frameSlot = outcome.frame.slots.find((f) => f.reason === 'spill' && f.name === s);
    if (!frameSlot) violations.push(`spilled pseudo '${s}' has no frame slot`);
    else if (frameSlot.offset !== slot) {
      violations.push(`spilled pseudo '${s}': assignment slot ${slot} != frame slot ${frameSlot.offset}`);
    }
    let loads = 0;
    let stores = 0;
    for (let i = 0; i < code.length; i++) {
      const instr = code[i]!;
      if (instr.spillOf !== s) continue;
      const memOp = instr.operands.find((o) => o.k === 'mem');
      if (!memOp || memOp.k !== 'mem' || memOp.base !== '%rbp' || memOp.offset !== slot) {
        violations.push(`instr ${i}: spill traffic for '${s}' does not use slot ${slot}(%rbp)`);
      }
      if (memOp === instr.operands[0]) loads++;
      else stores++;
    }
    if (loads + stores === 0) violations.push(`spilled pseudo '${s}' has no spill traffic at all`);
  }

  // Distinct spilled pseudos must use distinct slots.
  const slotUsed = new Map<number, string>();
  for (const s of outcome.assignment.spilled) {
    const a = outcome.assignment.assignment[s];
    if (a && 'spillSlot' in a) {
      const prev = slotUsed.get(a.spillSlot);
      if (prev !== undefined) violations.push(`spill slot ${a.spillSlot} shared by '${prev}' and '${s}'`);
      slotUsed.set(a.spillSlot, s);
    }
  }

  return violations;
}
