/** Replay invariants (checkTraceInvariants) and determinism for every
 *  recorded optimization trace. */
import { describe, expect, it } from 'vitest';
import { checkTraceInvariants } from '@lab/trace';
import type { Recorded, Reducer } from '@lab/trace';
import type { TacProgram } from '../../src/ir/types.js';
import {
  basicBlocksReducer,
  projectBasicBlocks,
  runFindBasicBlocks,
} from '../../src/opt/basic-blocks.js';
import { cfgReducer, computeCfg, projectCfg, runBuildCfg } from '../../src/opt/cfg.js';
import {
  dataflowReducer,
  projectDataflow,
  runAvailableExpressions,
  runLiveVariables,
  runReachingDefinitions,
} from '../../src/opt/dataflow.js';
import {
  dominatorsReducer,
  projectDominators,
  runComputeDominators,
} from '../../src/opt/dominators.js';
import { loopsReducer, projectLoops, runFindLoops } from '../../src/opt/loops.js';
import { passReducer, passStateFromResult, pipelineReducer, pipelineStateFromResult } from '../../src/opt/opt-events.js';
import { runConstFold } from '../../src/opt/passes/const-fold.js';
import { runConstProp } from '../../src/opt/passes/const-prop.js';
import { runCopyProp } from '../../src/opt/passes/copy-prop.js';
import { runCse } from '../../src/opt/passes/cse.js';
import { runDce } from '../../src/opt/passes/dce.js';
import { runLicm } from '../../src/opt/passes/licm.js';
import { runOptimize } from '../../src/opt/passes/pipeline.js';
import { bin, c, copy, fig913, fn, goto_, iffalse, label, prog, ret, t, v } from './helpers.js';

/** A program that exercises every pass at once: constants, copies, a common
 *  subexpression, a while-loop with an invariant, and dead code. */
function kitchenSink(): TacProgram {
  const i = v('i', 1);
  const n = v('n', 2);
  const x = v('x', 3);
  const y = v('y', 4);
  const dead = v('dead', 5);
  return prog([
    fn(
      'f',
      [
        bin(t(1), c(2), '*', c(3)), //     foldable
        copy(x, t(1)), //                  copy source
        copy(dead, c(9)), //               dead
        bin(t(2), x, '+', y), //           cse site
        bin(t(3), x, '+', y), //           redundant
        label('L1'), //                    loop header
        bin(t(4), i, '<', n), //           condition
        iffalse(t(4), 'L2'),
        bin(t(5), x, '+', c(1)), //        invariant
        bin(i, i, '+', t(5)),
        goto_('L1'),
        label('L2'),
        bin(t(6), t(2), '+', t(3)),
        ret(t(6)),
      ],
      6,
    ),
  ]);
}

function expectClean<S, E extends { kind: string }, R>(
  recorded: Recorded<S, E, R>,
  reducer: Reducer<S, E>,
  project: (r: R) => S,
): void {
  expect(checkTraceInvariants(recorded, reducer, project)).toEqual([]);
}

describe('trace invariants (replay ≡ artifact, keyframes, citations, prose)', () => {
  const f = fig913();
  const blocks = runFindBasicBlocks(f).result.blocks;
  const cfg = computeCfg(f, blocks);
  const sink = kitchenSink();

  it('basic blocks', () => expectClean(runFindBasicBlocks(f), basicBlocksReducer, projectBasicBlocks));
  it('cfg', () => expectClean(runBuildCfg(f, blocks), cfgReducer, projectCfg));
  it('reaching definitions', () =>
    expectClean(runReachingDefinitions(f, cfg), dataflowReducer, projectDataflow));
  it('live variables', () => expectClean(runLiveVariables(f, cfg, []), dataflowReducer, projectDataflow));
  it('available expressions', () =>
    expectClean(runAvailableExpressions(f, cfg), dataflowReducer, projectDataflow));
  it('dominators', () => expectClean(runComputeDominators(cfg), dominatorsReducer, projectDominators));
  it('loops', () => expectClean(runFindLoops(cfg), loopsReducer, projectLoops));
  it('const-fold', () => expectClean(runConstFold(sink), passReducer, passStateFromResult));
  it('const-prop', () => expectClean(runConstProp(sink), passReducer, passStateFromResult));
  it('copy-prop', () => expectClean(runCopyProp(sink), passReducer, passStateFromResult));
  it('cse', () => expectClean(runCse(sink), passReducer, passStateFromResult));
  it('dce', () => expectClean(runDce(sink), passReducer, passStateFromResult));
  it('licm', () => expectClean(runLicm(sink), passReducer, passStateFromResult));
  it('pipeline', () => expectClean(runOptimize(sink), pipelineReducer, pipelineStateFromResult));
});

describe('determinism: two recordings are event-identical', () => {
  it('pipeline events and result agree across runs', () => {
    const a = runOptimize(kitchenSink());
    const b = runOptimize(kitchenSink());
    expect(JSON.stringify(a.trace.steps)).toBe(JSON.stringify(b.trace.steps));
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
  });

  it('analysis traces agree across runs', () => {
    const f1 = fig913();
    const f2 = fig913();
    const cfg1 = computeCfg(f1, runFindBasicBlocks(f1).result.blocks);
    const cfg2 = computeCfg(f2, runFindBasicBlocks(f2).result.blocks);
    expect(JSON.stringify(runReachingDefinitions(f1, cfg1).trace.steps)).toBe(
      JSON.stringify(runReachingDefinitions(f2, cfg2).trace.steps),
    );
    expect(JSON.stringify(runFindLoops(cfg1).trace.steps)).toBe(
      JSON.stringify(runFindLoops(cfg2).trace.steps),
    );
  });
});
