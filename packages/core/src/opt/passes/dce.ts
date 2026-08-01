/**
 * Dead-code elimination — Dragon Book (2nd ed.) §9.1.4, justified by live
 * variables (§9.2.5): an assignment x = … is dead if x is not live immediately
 * after it, and the statement has no side effects. Removing dead code can make
 * more code dead, so the pass iterates to a fixpoint, recomputing liveness
 * each round. Calls, param, return, labels, jumps, and stores always stay.
 */
import type { TacFunction, TacProgram } from '../../ir/types.js';
import { formatQuad } from '../../ir/types.js';
import type { Recorded, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { OptPassResult } from '../types.js';
import type { PassEvent, PassState, RewriteChange } from '../opt-events.js';
import { initialPassState, passReducer, passStateFromResult } from '../opt-events.js';
import {
  addressTakenVars,
  definedVar,
  hasSideEffects,
  liveAfter,
  liveVariables,
  sortSet,
  type LiveVarsResult,
} from '../dataflow.js';
import {
  cloneProgram,
  cfgOf,
  finishPass,
  globalVarNames,
  passBeginStep,
  passEndStep,
  rewriteStep,
  type PassCite,
} from './util.js';

const CITE: PassCite = {
  section: '9.1.4',
  rule: 'An assignment to x is dead if x is not live (will not be used) after it and the statement has no side effects',
};

export function* dce(program: TacProgram): Steps<PassEvent, OptPassResult> {
  const working = cloneProgram(program);
  const changes: RewriteChange[] = [];
  const globals = sortSet(globalVarNames(working));

  yield passBeginStep(
    'dce',
    working,
    CITE,
    'Dead-code elimination computes live variables (§9.2.5) and removes side-effect-free assignments to dead variables (§9.1.4), iterating to a fixpoint.',
  );

  for (const fn of working.functions) {
    let round = 0;
    for (;;) {
      round++;
      const frozen: TacFunction = { ...fn, quads: fn.quads.map((q) => ({ ...q })) };
      const cfg = cfgOf(frozen);
      const addrTaken = addressTakenVars(frozen);
      // Globals may be read by other functions after this one returns, and
      // address-taken variables may be read through pointers: both are live
      // at EXIT.
      const boundary = sortSet([...globals, ...addrTaken]);
      const lv: LiveVarsResult = yield* liveVariables(frozen, cfg, boundary);

      // Decide all removals of this round against the frozen analysis.
      const dead: number[] = [];
      for (const block of cfg.blocks) {
        for (const qi of block.quadIndices) {
          const q = frozen.quads[qi]!;
          const d = definedVar(q);
          if (d === null) continue;
          if (hasSideEffects(q)) continue; // calls/param/stores/labels/jumps stay
          if (globals.includes(d) || addrTaken.has(d)) continue;
          const live = liveAfter(frozen, cfg, lv, block.id, qi);
          if (!live.includes(d)) dead.push(qi);
        }
      }
      if (dead.length === 0) break;

      // Remove from highest index down so earlier positions stay valid.
      for (const qi of [...dead].sort((a, b) => b - a)) {
        const q = fn.quads[qi]!;
        const before = formatQuad(q);
        const d = definedVar(q)!;
        fn.quads.splice(qi, 1);
        const change: RewriteChange = {
          functionName: fn.name,
          kind: 'delete',
          beforeIndex: qi,
          afterIndex: null,
          justification: `Dead-code elimination (§9.1.4, round ${round}): "${before}" assigns ${d}, which is not live after instruction ${qi} (§9.2.5 live variables), and the statement has no side effects, so it is removed.`,
        };
        changes.push(change);
        yield rewriteStep('dce', change, fn, CITE, { section: `DCE round ${round} (${fn.name})` });
      }
      // Renumber inside the loop so the next round's indices are consistent.
      fn.quads.forEach((q, i) => {
        q.index = i;
      });
    }
  }

  const result = finishPass('dce', working, changes);
  yield passEndStep('dce', result.after, changes.length, CITE);
  return result;
}

export function runDce(program: TacProgram): Recorded<PassState, PassEvent, OptPassResult> {
  return record(() => dce(program), initialPassState, passReducer, { id: 'opt.pass.dce' });
}

export { passStateFromResult as projectDce };
