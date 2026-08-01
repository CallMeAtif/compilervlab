/**
 * Optimization pipeline: apply the passes in the fixed order
 * [const-fold, const-prop, copy-prop, cse, licm, dce] (each optional),
 * renumbering quads and recomputing basic blocks / CFGs after every pass
 * (each pass derives fresh blocks and CFGs from its input program).
 */
import type { TacProgram } from '../../ir/types.js';
import type { Recorded, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { Cfg, OptPassName, OptPassResult, OptimizedProgram } from '../types.js';
import type { OptEvent, PipelineState } from '../opt-events.js';
import { initialPipelineState, pipelineReducer, pipelineStateFromResult } from '../opt-events.js';
import { findBasicBlocks } from '../basic-blocks.js';
import { buildCfg } from '../cfg.js';
import { cloneProgram, renumber } from './util.js';
import { constFold } from './const-fold.js';
import { constProp } from './const-prop.js';
import { copyProp } from './copy-prop.js';
import { cse } from './cse.js';
import { dce } from './dce.js';
import { licm } from './licm.js';

export const PIPELINE_ORDER: OptPassName[] = [
  'const-fold',
  'const-prop',
  'copy-prop',
  'cse',
  'licm',
  'dce',
];

export interface OptimizeOptions {
  /** Which passes to run; defaults to all, always applied in PIPELINE_ORDER. */
  passes?: OptPassName[];
}

const PASS_GENERATORS: Record<OptPassName, (p: TacProgram) => Steps<OptEvent, OptPassResult>> = {
  'const-fold': constFold,
  'const-prop': constProp,
  'copy-prop': copyProp,
  cse,
  licm,
  dce,
};

export function* optimize(
  program: TacProgram,
  options: OptimizeOptions = {},
): Steps<OptEvent, OptimizedProgram> {
  const enabled = new Set(options.passes ?? PIPELINE_ORDER);
  const input = renumber(cloneProgram(program));

  // Traced basic blocks + CFG of the INPUT program (§8.4).
  const cfgs: Cfg[] = [];
  for (const fn of input.functions) {
    const { blocks } = yield* findBasicBlocks(fn);
    const cfg = yield* buildCfg(fn, blocks);
    cfgs.push(cfg);
  }

  let current = input;
  const passes: OptPassResult[] = [];
  for (const name of PIPELINE_ORDER) {
    if (!enabled.has(name)) continue;
    const result = yield* PASS_GENERATORS[name](current);
    passes.push(result);
    // Each pass's `after` is renumbered with freshly recomputed blocks/CFGs;
    // it becomes the next pass's input.
    current = result.after;
  }

  return { input, cfgs, passes, output: current };
}

export function runOptimize(
  program: TacProgram,
  options: OptimizeOptions = {},
): Recorded<PipelineState, OptEvent, OptimizedProgram> {
  return record(() => optimize(program, options), initialPipelineState, pipelineReducer, {
    id: 'opt.pipeline',
  });
}

export { pipelineStateFromResult as projectOptimize };
