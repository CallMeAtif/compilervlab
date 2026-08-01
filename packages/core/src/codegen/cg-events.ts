/**
 * Shared virtual-code types and event unions for the code-generation phase.
 *
 * Instruction selection (isel.ts) lowers each TacFunction to "virtual code":
 * x86-64 instructions (AT&T operand order) over PSEUDO-REGISTERS — temps tN
 * and scalar locals by name — plus the physical registers the ABI tiles pin
 * (%rdi… for arguments, %rax/%rdx for division and results). Liveness,
 * interference and coloring operate on this virtual code; emit.ts substitutes
 * the coloring and prints final AT&T assembly.
 *
 * Everything here is plain JSON (events and reduced states cross the worker
 * boundary and are replayed by pure reducers).
 */

import type { StepMeta } from '@lab/trace';
import type { Diagnostic } from '../common/types.js';
import type {
  GpRegister,
  InterferenceGraph,
  LiveRange,
  RaNode,
  RegisterAssignment,
} from './types.js';

// ---------------------------------------------------------------------------
// Virtual code
// ---------------------------------------------------------------------------

/** Operand of a virtual instruction. Pseudo-registers are plain names that
 *  never start with '%'; physical registers are '%rax' etc. */
export type VOperand =
  | { k: 'pseudo'; name: string }
  | { k: 'phys'; reg: string }
  | { k: 'imm'; value: number }
  /** Memory operand `offset(base, index, scale)`; base/index may be pseudo or
   *  physical register names. `sym` set means rip-relative `sym(%rip)`. */
  | { k: 'mem'; base: string | null; offset: number; index?: string; scale?: number; sym?: string }
  /** Jump / call target. */
  | { k: 'lab'; name: string };

export interface VInstr {
  kind: 'instr' | 'label';
  /** Mnemonic ('movq', 'addq', …); for kind 'label' this is 'label'. */
  mnemonic: string;
  operands: VOperand[];
  /** Label name when kind === 'label'. */
  label?: string;
  /** Provenance: quad index (within the function) that selected this line. */
  tacIndex: number | null;
  /** Uses/defs not visible in the operand list (call argument registers,
   *  the return value flowing through %rax to the epilogue, …). */
  extraUse?: string[];
  extraDef?: string[];
  /** Set on load/store instructions inserted by spill rewriting. */
  spillOf?: string;
}

export type FrameReason = 'array' | 'addr-taken' | 'spill' | 'float';

export interface FrameSlot {
  name: string; // variable / pseudo the slot belongs to
  offset: number; // rbp-relative byte offset of the LOWEST byte (negative)
  size: number; // bytes (multiple of 8)
  reason: FrameReason;
}

export interface FrameInfo {
  slots: FrameSlot[];
  size: number; // total bytes below %rbp (before 16-alignment at emit)
}

export interface VFunction {
  name: string;
  /** Pseudo names of the parameters in order (null when a parameter is never
   *  referenced in the body, so no entry move is needed). */
  params: Array<string | null>;
  code: VInstr[];
  frame: FrameInfo;
  /** GP-colorable pseudo-registers, sorted lexicographically. */
  pseudos: RaNode[];
  /** Float pseudos that live in an SSE register. Always empty: floats are not
   *  register-allocated in this lab, so every float value gets a frame slot
   *  (FrameReason 'float') and only the reserved SSE scratch register touches
   *  it — see isel.ts `expandFloat`. Kept so consumers can assert emptiness. */
  floatPseudos: Array<{ name: string; xmm: string }>;
  /** Next fresh temp id (continues the TAC numbering; used for spill scratch). */
  tempCounter: number;
  /** Next fresh local-label id. */
  labelCounter: number;
}

/**
 * One statically allocated global. Without an initializer it is emitted as a
 * `.comm` reservation (zero-filled); with one it is emitted in the data section
 * as a label plus an initialized cell, because a statically allocated name
 * holds its initial value before execution begins (§7.1 / §8.3.1).
 */
export interface GlobalDatum {
  name: string;
  size: number;
  init?: { value: number; ctype: 'int' | 'float' | 'char' };
}

export interface IselResult {
  functions: VFunction[];
  /** Pooled float constants, emitted as `.double` data. */
  floatConsts: Array<{ label: string; value: number }>;
  /** Global variables (name + byte size, plus any static initial value). */
  globals: GlobalDatum[];
  diagnostics: Diagnostic[];
}

export interface FunctionLiveness {
  functionName: string;
  iterations: number;
  /** Per instruction index: sorted live-in / live-out name sets (pseudos and
   *  tracked physical GP registers). */
  liveIn: string[][];
  liveOut: string[][];
  /** Contract LiveRange[] over pseudo-registers only (instruction indices
   *  into the selected code where the pseudo is live-in). */
  ranges: LiveRange[];
}

export interface InterferenceResult {
  graph: InterferenceGraph;
  /** Precolored-neighbor constraints: pseudo → GP registers it must not get
   *  (its live range overlaps a pinned physical register). */
  forbidden: Record<string, GpRegister[]>;
  /** Move-related pseudo pairs (copy instructions), a < b, deduped, sorted. */
  moves: Array<{ a: string; b: string }>;
}

export interface ColorOutcome {
  assignment: RegisterAssignment;
  rounds: number;
  /** Selected code after spill rewriting (round > 1 only changes it). */
  finalCode: VInstr[];
  frame: FrameInfo;
  tempCounter: number;
}

export interface AsmRunResult {
  returnValue: number | null;
  steps: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Formatting (pure; shared by UI, emit and tests)
// ---------------------------------------------------------------------------

export function formatVOperand(o: VOperand): string {
  switch (o.k) {
    case 'pseudo':
      return o.name;
    case 'phys':
      return o.reg;
    case 'imm':
      return `$${o.value}`;
    case 'lab':
      return o.name;
    case 'mem': {
      if (o.sym !== undefined) return `${o.sym}(%rip)`;
      const off = o.offset === 0 ? '' : String(o.offset);
      const parts = [o.base ?? ''];
      if (o.index !== undefined) parts.push(o.index, String(o.scale ?? 1));
      return `${off}(${parts.join(', ')})`;
    }
  }
}

export function formatVInstr(i: VInstr): string {
  if (i.kind === 'label') return `${i.label ?? ''}:`;
  const ops = i.operands.map(formatVOperand).join(', ');
  return ops.length > 0 ? `${i.mnemonic} ${ops}` : i.mnemonic;
}

// ---------------------------------------------------------------------------
// Ordering helpers (determinism: everything sorted lexicographically)
// ---------------------------------------------------------------------------

export function cmpName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedNames(xs: Iterable<string>): string[] {
  return [...xs].sort(cmpName);
}

/** Normalize an undirected edge to a < b (lexicographic). */
export function edgeKey(a: string, b: string): { a: string; b: string } {
  return cmpName(a, b) <= 0 ? { a, b } : { a: b, b: a };
}

/** Run a Steps generator to completion, discarding events (untraced reuse of
 *  the exact traced algorithm — determinism guaranteed by construction). */
export function drainSteps<E, R>(g: Generator<[E, StepMeta], R, void>): R {
  let it = g.next();
  while (!it.done) it = g.next();
  return it.value;
}

// ---------------------------------------------------------------------------
// Event unions
// ---------------------------------------------------------------------------

/** Instruction selection (§8.9 tiling, quad-at-a-time; simple tiles per §8.6). */
export type IselEvent =
  | {
      kind: 'fnStart';
      functionName: string;
      params: Array<string | null>;
      frame: FrameSlot[];
      frameSize: number;
    }
  | { kind: 'entryMove'; functionName: string; param: string; instr: VInstr }
  | {
      kind: 'tile';
      functionName: string;
      tacIndex: number;
      quadText: string;
      tileName: string;
    }
  | { kind: 'instr'; functionName: string; instr: VInstr }
  | { kind: 'floatConst'; label: string; value: number }
  | { kind: 'globalDecl'; name: string; size: number; init?: GlobalDatum['init'] }
  | { kind: 'diagnostic'; diagnostic: Diagnostic }
  | {
      kind: 'fnEnd';
      functionName: string;
      pseudos: RaNode[];
      floatPseudos: Array<{ name: string; xmm: string }>;
      tempCounter: number;
      labelCounter: number;
      frame: FrameSlot[];
      frameSize: number;
    }
  | { kind: 'done' };

/** Backward liveness at instruction granularity (§8.4.2 use/def; §9.2.5 equations). */
export type LivenessEvent =
  | { kind: 'fnStart'; functionName: string; instrCount: number }
  | { kind: 'iterStart'; functionName: string; iter: number }
  | {
      kind: 'instrLive';
      functionName: string;
      iter: number;
      index: number;
      use: string[];
      def: string[];
      liveOut: string[];
      liveIn: string[];
      changed: boolean;
    }
  | {
      kind: 'converged';
      functionName: string;
      iterations: number;
      ranges: LiveRange[];
    }
  | { kind: 'done' };

/** Interference-graph construction (§8.8.4). */
export type InterferenceEvent =
  | { kind: 'fnStart'; functionName: string; nodes: RaNode[] }
  | {
      kind: 'edge';
      functionName: string;
      a: string;
      b: string;
      atIndex: number;
      def: string;
      liveOut: string[];
    }
  | {
      kind: 'moveException';
      functionName: string;
      def: string;
      src: string;
      atIndex: number;
    }
  | { kind: 'forbid'; functionName: string; node: string; reg: GpRegister; atIndex: number }
  | { kind: 'movePair'; functionName: string; a: string; b: string; atIndex: number }
  | { kind: 'fnDone'; functionName: string; edgeCount: number }
  | { kind: 'done' };

/** Kempe/Chaitin simplify–select coloring with spill rewriting (§8.8.4). */
export type ColorEvent =
  | { kind: 'fnStart'; functionName: string; k: number }
  | {
      kind: 'roundStart';
      functionName: string;
      round: number;
      nodeCount: number;
      edgeCount: number;
    }
  | {
      kind: 'simplifyPush';
      functionName: string;
      node: string;
      degree: number;
      remaining: number;
    }
  | { kind: 'spillCandidate'; functionName: string; node: string; degree: number }
  | {
      kind: 'select';
      functionName: string;
      node: string;
      forbiddenColors: string[];
      chosen: GpRegister;
    }
  | {
      kind: 'actualSpill';
      functionName: string;
      node: string;
      forbiddenColors: string[];
      spillSlot: number;
    }
  | {
      kind: 'spillRewrite';
      functionName: string;
      node: string;
      atIndex: number;
      scratch: string;
      loads: number;
      stores: number;
    }
  | {
      kind: 'fnDone';
      functionName: string;
      rounds: number;
      assignment: RegisterAssignment;
    }
  | { kind: 'done' };

/** Final assembly emission. */
export type EmitEvent =
  | {
      kind: 'line';
      line: {
        index: number;
        text: string;
        lineKind: 'label' | 'instr' | 'directive';
        tacIndex: number | null;
        functionName: string | null;
      };
    }
  | { kind: 'done'; lineCount: number };

/** Traced execution of the emitted assembly (target-machine model, §8.2.1). */
export type AsmExecEvent =
  | { kind: 'exec'; pc: number; text: string; steps: number }
  | { kind: 'halt'; returnValue: number | null; steps: number; error: string | null };
