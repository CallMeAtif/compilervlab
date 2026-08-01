/**
 * Backward live-variable analysis at instruction granularity over the
 * SELECTED code's pseudo-registers (plus the physical GP registers the tiles
 * pin, so the allocator can respect them as precolored constraints).
 *
 * use/def per instruction follows §8.4.2; the dataflow equations
 *   in[i]  = use[i] ∪ (out[i] − def[i])
 *   out[i] = ∪ { in[s] : s a successor of i }
 * are iterated to a fixpoint per §9.2.5 (backward order, FIFO-free classic
 * round-robin iteration — deterministic).
 */

import type { Recorded, Reducer, Steps, StepMeta } from '@lab/trace';
import { record } from '@lab/trace';
import type { LiveRange } from './types.js';
import type { FunctionLiveness, IselResult, LivenessEvent, VInstr, VOperand } from './cg-events.js';
import { cmpName, drainSteps, sortedNames } from './cg-events.js';

export type { FunctionLiveness, LivenessEvent } from './cg-events.js';

function cite(section: string, rule?: string, figureOrAlgo?: string): StepMeta['cite'] {
  const c: StepMeta['cite'] = { section };
  if (figureOrAlgo !== undefined) c.figureOrAlgo = figureOrAlgo;
  if (rule !== undefined) c.rule = rule;
  return c;
}

// ---------------------------------------------------------------------------
// use/def (§8.4.2)
// ---------------------------------------------------------------------------

const FIXED = new Set(['%rbp', '%rsp', '%rip']);

/** Registers we track: pseudos and physical GP registers. Frame/stack pointers
 *  and SSE registers (floats are out of allocation scope) are excluded. */
export function trackedName(n: string): boolean {
  return !FIXED.has(n) && !n.startsWith('%xmm');
}

function regsIn(o: VOperand, out: string[]): void {
  if (o.k === 'pseudo') {
    if (trackedName(o.name)) out.push(o.name);
  } else if (o.k === 'phys') {
    if (trackedName(o.reg)) out.push(o.reg);
  } else if (o.k === 'mem') {
    if (o.base !== null && trackedName(o.base)) out.push(o.base);
    if (o.index !== undefined && trackedName(o.index)) out.push(o.index);
  }
}

function regName(o: VOperand | undefined): string | null {
  if (!o) return null;
  if (o.k === 'pseudo' && trackedName(o.name)) return o.name;
  if (o.k === 'phys' && trackedName(o.reg)) return o.reg;
  return null;
}

const MOV_LIKE = new Set(['movq', 'movsd', 'leaq', 'cvtsi2sdq']);
const ARITH = new Set(['addq', 'subq', 'imulq', 'addsd', 'subsd', 'mulsd', 'divsd']);
const CMP = new Set(['cmpq', 'ucomisd']);
const JCC = new Set(['je', 'jne', 'jl', 'jle', 'jg', 'jge', 'jb', 'jbe', 'ja', 'jae']);

/** use/def sets of one virtual instruction (sorted, deduped). */
export function useDef(i: VInstr): { use: string[]; def: string[] } {
  const use: string[] = [];
  const def: string[] = [];
  if (i.kind !== 'label') {
    const src = i.operands[0];
    const dst = i.operands[i.operands.length - 1];
    if (MOV_LIKE.has(i.mnemonic)) {
      if (src) regsIn(src, use);
      const d = regName(dst);
      if (d !== null) def.push(d);
      else if (dst && dst.k === 'mem') regsIn(dst, use); // store: address regs are uses
    } else if (ARITH.has(i.mnemonic)) {
      if (src) regsIn(src, use);
      if (dst) regsIn(dst, use); // dst is read and written
      const d = regName(dst);
      if (d !== null) def.push(d);
    } else if (CMP.has(i.mnemonic)) {
      for (const o of i.operands) regsIn(o, use);
    } else if (i.mnemonic === 'cqto') {
      use.push('%rax');
      def.push('%rdx');
    } else if (i.mnemonic === 'idivq') {
      if (src) regsIn(src, use);
      use.push('%rax', '%rdx');
      def.push('%rax', '%rdx');
    } else if (i.mnemonic === 'pushq') {
      if (src) regsIn(src, use);
    } else if (i.mnemonic === 'popq') {
      const d = regName(src);
      if (d !== null) def.push(d);
    }
    // jmp/jcc/call: label operands contribute nothing.
  }
  for (const u of i.extraUse ?? []) if (trackedName(u)) use.push(u);
  for (const d of i.extraDef ?? []) if (trackedName(d)) def.push(d);
  return { use: sortedNames(new Set(use)), def: sortedNames(new Set(def)) };
}

/** Register-to-register copy (the Chaitin move-related special case). */
export function moveOf(i: VInstr): { src: string; dst: string } | null {
  if (i.kind !== 'instr' || (i.mnemonic !== 'movq' && i.mnemonic !== 'movsd')) return null;
  if (i.operands.length !== 2) return null;
  const src = regName(i.operands[0]);
  const dst = regName(i.operands[1]);
  if (src === null || dst === null) return null;
  return { src, dst };
}

// ---------------------------------------------------------------------------
// Control flow over the selected code
// ---------------------------------------------------------------------------

export function labelIndexOf(code: VInstr[]): Map<string, number> {
  const m = new Map<string, number>();
  code.forEach((i, idx) => {
    if (i.kind === 'label' && i.label !== undefined) m.set(i.label, idx);
  });
  return m;
}

export function successorsOf(code: VInstr[], labels: Map<string, number>, i: number): number[] {
  const instr = code[i]!;
  const next = i + 1 < code.length ? [i + 1] : [];
  if (instr.kind === 'label') return next;
  const target = (): number | null => {
    const t = instr.operands[0];
    if (t && t.k === 'lab') {
      const idx = labels.get(t.name);
      return idx === undefined ? null : idx; // e.g. jump to the epilogue = exit
    }
    return null;
  };
  if (instr.mnemonic === 'jmp') {
    const t = target();
    return t === null ? [] : [t];
  }
  if (JCC.has(instr.mnemonic)) {
    const t = target();
    return t === null ? next : [...next, t];
  }
  return next; // call falls through (callee-save convention)
}

// ---------------------------------------------------------------------------
// The traced algorithm (per function)
// ---------------------------------------------------------------------------

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function* livenessForFunction(
  functionName: string,
  code: VInstr[],
): Steps<LivenessEvent, FunctionLiveness> {
  const n = code.length;
  const labels = labelIndexOf(code);
  const uds = code.map((i) => useDef(i));
  const succ = code.map((_, i) => successorsOf(code, labels, i));
  const liveIn: string[][] = code.map(() => []);
  const liveOut: string[][] = code.map(() => []);

  yield [
    { kind: 'fnStart', functionName, instrCount: n },
    {
      cite: cite('9.2.5', 'live-variable analysis is a backward dataflow problem', 'live-variable equations'),
      prose: `Compute liveness for '${functionName}' (${n} instructions): iterate in[i] = use[i] ∪ (out[i] − def[i]) backward to a fixpoint.`,
      level: 'macro',
      section: `${functionName}: liveness`,
    },
  ];

  let iter = 0;
  let changed = true;
  while (changed) {
    changed = false;
    iter++;
    yield [
      { kind: 'iterStart', functionName, iter },
      {
        cite: cite('9.2.5', 'iterate the transfer equations until the live sets stabilize'),
        prose: `Liveness pass ${iter} over '${functionName}' (backward, last instruction first).`,
        level: 'macro',
        section: `${functionName}: liveness pass ${iter}`,
      },
    ];
    for (let i = n - 1; i >= 0; i--) {
      const outSet = new Set<string>();
      for (const s of succ[i]!) for (const x of liveIn[s]!) outSet.add(x);
      const out = sortedNames(outSet);
      const ud = uds[i]!;
      const inSet = new Set(ud.use);
      const defSet = new Set(ud.def);
      for (const x of out) if (!defSet.has(x)) inSet.add(x);
      const inn = sortedNames(inSet);
      const instrChanged = !sameSet(out, liveOut[i]!) || !sameSet(inn, liveIn[i]!);
      if (instrChanged) changed = true;
      liveOut[i] = out;
      liveIn[i] = inn;
      yield [
        {
          kind: 'instrLive',
          functionName,
          iter,
          index: i,
          use: ud.use,
          def: ud.def,
          liveOut: out,
          liveIn: inn,
          changed: instrChanged,
        },
        {
          cite: cite('8.4.2', 'use/def per instruction; in[i] = use[i] ∪ (out[i] − def[i]), out[i] = ∪ in[succ] (equations per §9.2.5)'),
          prose: `Instruction ${i}: use {${ud.use.join(', ')}}, def {${ud.def.join(', ')}} ⇒ out = {${out.join(', ')}}, in = {${inn.join(', ')}}${instrChanged ? '' : ' (unchanged)'}.`,
          level: 'micro',
          groupId: `${functionName}:live${iter}`,
          section: `${functionName}: liveness pass ${iter}`,
        },
      ];
    }
  }

  // Live ranges over pseudo-registers only (contract LiveRange[]).
  const pseudoSet = new Set<string>();
  for (const ud of uds) for (const x of [...ud.use, ...ud.def]) if (!x.startsWith('%')) pseudoSet.add(x);
  const ranges: LiveRange[] = sortedNames(pseudoSet).map((nodeId) => ({
    nodeId,
    liveAt: liveIn.flatMap((s, i) => (s.includes(nodeId) ? [i] : [])),
  }));

  yield [
    { kind: 'converged', functionName, iterations: iter, ranges },
    {
      cite: cite('9.2.5', 'the iteration converges because the sets only grow'),
      prose: `Liveness for '${functionName}' converged after ${iter} pass(es); ${ranges.length} pseudo-register live range(s).`,
      level: 'macro',
      section: `${functionName}: liveness pass ${iter}`,
    },
  ];

  return { functionName, iterations: iter, liveIn, liveOut, ranges };
}

/** Traced liveness over every selected function of the program. */
export function* analyzeLiveness(isel: IselResult): Steps<LivenessEvent, FunctionLiveness[]> {
  const out: FunctionLiveness[] = [];
  for (const fn of isel.functions) {
    out.push(yield* livenessForFunction(fn.name, fn.code));
  }
  yield [
    { kind: 'done' },
    {
      cite: cite('9.2.5', 'live-variable analysis complete'),
      prose: `Liveness computed for ${out.length} function(s).`,
      level: 'macro',
      section: 'Done',
    },
  ];
  return out;
}

/** Untraced reuse of the exact traced algorithm (for spill-retry rounds). */
export function computeLiveness(functionName: string, code: VInstr[]): FunctionLiveness {
  return drainSteps(livenessForFunction(functionName, code));
}

// ---------------------------------------------------------------------------
// UI state + reducer
// ---------------------------------------------------------------------------

export interface LivenessState {
  functions: FunctionLiveness[];
  done: boolean;
}

export function initialLivenessState(): LivenessState {
  return { functions: [], done: false };
}

export const livenessReducer: Reducer<LivenessState, LivenessEvent> = (s, e) => {
  switch (e.kind) {
    case 'fnStart':
      return {
        ...s,
        functions: [
          ...s.functions,
          {
            functionName: e.functionName,
            iterations: 0,
            liveIn: Array.from({ length: e.instrCount }, () => []),
            liveOut: Array.from({ length: e.instrCount }, () => []),
            ranges: [],
          },
        ],
      };
    case 'iterStart':
      return s;
    case 'instrLive': {
      const fns = [...s.functions];
      const last = fns[fns.length - 1];
      if (!last) return s;
      const liveIn = [...last.liveIn];
      const liveOut = [...last.liveOut];
      liveIn[e.index] = e.liveIn;
      liveOut[e.index] = e.liveOut;
      fns[fns.length - 1] = { ...last, liveIn, liveOut };
      return { ...s, functions: fns };
    }
    case 'converged': {
      const fns = [...s.functions];
      const last = fns[fns.length - 1];
      if (!last) return s;
      fns[fns.length - 1] = { ...last, iterations: e.iterations, ranges: e.ranges };
      return { ...s, functions: fns };
    }
    case 'done':
      return { ...s, done: true };
  }
};

export function projectLiveness(r: FunctionLiveness[]): LivenessState {
  return { functions: r, done: true };
}

/** Convenience: record a liveness trace for a selected program. */
export function runLiveness(
  isel: IselResult,
  id = 'codegen.liveness',
): Recorded<LivenessState, LivenessEvent, FunctionLiveness[]> {
  return record(() => analyzeLiveness(isel), initialLivenessState(), livenessReducer, { id });
}

export { cmpName };
