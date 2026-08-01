/**
 * Optimization artifacts: basic blocks, CFG, per-pass snapshots.
 */
import type { Quad, TacFunction, TacProgram } from '../ir/types.js';

export interface BasicBlock {
  id: number; // B0, B1, … in leader order (entry = B0 by convention §8.4.1)
  /** Quad indices (into the function's quads array) belonging to this block. */
  quadIndices: number[];
  leaderIndex: number;
}

export interface Cfg {
  functionName: string;
  blocks: BasicBlock[];
  /** Directed edges by block id. ENTRY = -1, EXIT = -2 pseudo-nodes. */
  edges: Array<{ from: number; to: number }>;
}

export type OptPassName =
  | 'const-fold'
  | 'const-prop'
  | 'copy-prop'
  | 'cse'
  | 'dce'
  | 'licm';

export interface OptPassResult {
  pass: OptPassName;
  /** Program state after this pass (per-function quads renumbered). */
  after: TacProgram;
  cfgAfter: Cfg[];
  /** Instruction-level change list powering the DiffView. */
  changes: Array<{
    functionName: string;
    kind: 'replace' | 'delete' | 'move' | 'insert';
    beforeIndex: number | null;
    afterIndex: number | null;
    justification: string;
  }>;
}

export interface OptimizedProgram {
  input: TacProgram;
  cfgs: Cfg[]; // CFGs of the input program
  passes: OptPassResult[]; // in applied order
  output: TacProgram;
}

export function blockQuads(fn: TacFunction, block: BasicBlock): Quad[] {
  return block.quadIndices.map((i) => {
    const q = fn.quads[i];
    if (!q) throw new Error(`block ${block.id} references missing quad ${i}`);
    return q;
  });
}
