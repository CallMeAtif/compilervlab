/**
 * Code-generation artifacts: x86-64 subset assembly with provenance, plus the
 * register-allocation structures (liveness, interference graph, coloring).
 */

/** Registers available to the allocator (System V-ish subset; %rax/%rdx are
 *  reserved as scratch for spills and division). Values are 32-bit (int) or
 *  SSE (float) — the allocator colors GP registers; floats use %xmm0-%xmm7. */
export const GP_REGISTERS = ['%rbx', '%rcx', '%rsi', '%rdi', '%r8', '%r9', '%r10', '%r11'] as const;
export type GpRegister = (typeof GP_REGISTERS)[number];

export interface AsmLine {
  index: number;
  text: string; // AT&T syntax
  kind: 'label' | 'instr' | 'directive';
  /** Provenance: quad index (per function) that selected this line, if any. */
  tacIndex: number | null;
  functionName: string | null;
}

export interface AsmProgram {
  lines: AsmLine[];
}

/** A colorable node in the interference graph: a temp or local variable. */
export interface RaNode {
  id: string; // "t3" or variable name
  kind: 'temp' | 'var';
}

export interface InterferenceGraph {
  functionName: string;
  nodes: RaNode[];
  /** Symmetric adjacency, stored once with a < b lexicographically. */
  edges: Array<{ a: string; b: string }>;
}

export interface RegisterAssignment {
  functionName: string;
  /** node id → register, or 'spill' with a stack slot. */
  assignment: Record<string, { reg: GpRegister } | { spillSlot: number }>;
  spilled: string[];
}

export interface LiveRange {
  nodeId: string;
  /** Instruction indices INTO THE SELECTED CODE (VFunction.code) where the
   *  value is live-in — liveness runs at machine-instruction granularity, so
   *  these are not TAC quad indices. */
  liveAt: number[];
}
