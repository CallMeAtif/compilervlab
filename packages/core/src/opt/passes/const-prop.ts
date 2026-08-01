/**
 * Constant propagation based on reaching definitions — Dragon Book (2nd ed.)
 * §9.2.4: "if all the definitions of x that reach this use of x assign the
 * same constant to x, the use of x can be replaced by that constant."
 *
 * "ALL the definitions" includes the value x already holds when the flow graph
 * is entered — a parameter, or a local that is only assigned on some paths. To
 * see those, the reaching-definitions analysis is run with the dummy entry
 * definitions of §9.2.4 ("Detection of Possible Uses Before Definition"): a
 * use reached by d0(x) is a use that may read a value this pass knows nothing
 * about, so no substitution is legal there.
 */
import type { Quad, TacFunction, TacOperand, TacProgram } from '../../ir/types.js';
import { formatQuad } from '../../ir/types.js';
import type { Recorded, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { Cfg, OptPassResult } from '../types.js';
import type { PassEvent, PassState, RewriteChange } from '../opt-events.js';
import { initialPassState, passReducer, passStateFromResult } from '../opt-events.js';
import {
  addressTakenVars,
  difference,
  reachingDefinitions,
  union,
  varKey,
  type DefInfo,
  type ReachingDefsResult,
} from '../dataflow.js';
import {
  cloneProgram,
  cfgOf,
  finishPass,
  globalVarNames,
  passBeginStep,
  passEndStep,
  rewriteStep,
  valueUseSlots,
  type PassCite,
} from './util.js';

const CITE: PassCite = {
  section: '9.2.4',
  figureOrAlgo: 'Algorithm 9.11',
  rule: 'A use of x may be replaced by constant c if every definition of x reaching that use assigns c',
};

type ConstOp = Extract<TacOperand, { kind: 'const' }>;

/** Constant assigned by a definition quad, if it is "x = constant". */
function constAssigned(q: Quad): ConstOp | null {
  if (q.op === 'copy' && q.arg1 && q.arg1.kind === 'const') return q.arg1;
  return null;
}

export function* constProp(program: TacProgram): Steps<PassEvent, OptPassResult> {
  const working = cloneProgram(program);
  const changes: RewriteChange[] = [];
  // Calls may write global variables; reaching definitions here does not model
  // that, so global variables are conservatively excluded from propagation.
  const globals = new Set(globalVarNames(working));

  yield passBeginStep(
    'const-prop',
    working,
    CITE,
    'Constant propagation computes reaching definitions, then replaces each use whose reaching definitions all assign the same constant (§9.2.4).',
  );

  for (const fn of working.functions) {
    // Analysis runs on a frozen snapshot; rewrites only change USE operands,
    // so the reaching-definitions facts stay valid throughout the pass.
    const frozen: TacFunction = { ...fn, quads: fn.quads.map((q) => ({ ...q })) };
    const cfg: Cfg = cfgOf(frozen);
    const rd: ReachingDefsResult = yield* reachingDefinitions(frozen, cfg, {
      entryDefinitions: true,
    });
    const addrTaken = addressTakenVars(frozen);

    const defById: Record<string, DefInfo> = {};
    for (const d of rd.defs) defById[d.id] = d;
    const defsOfVar: Record<string, string[]> = {};
    for (const d of rd.defs) (defsOfVar[d.var] ??= []).push(d.id);

    for (const block of cfg.blocks) {
      // Point-level reaching set: start from IN[B], advance quad by quad.
      let cur = rd.in[String(block.id)] ?? [];
      for (const qi of block.quadIndices) {
        const q = fn.quads[qi]!;
        const frozenQ = frozen.quads[qi]!;
        for (const slot of valueUseSlots(frozenQ)) {
          const operand = q[slot];
          if (!operand || (operand.kind !== 'var' && operand.kind !== 'temp')) continue;
          const v = varKey(operand);
          if (v === null || addrTaken.has(v) || globals.has(v)) continue;
          const reachingDefIds = cur.filter((d) => defById[d]?.var === v);
          if (reachingDefIds.length === 0) continue;
          const constants = reachingDefIds.map((d) => {
            const info = defById[d]!;
            // A dummy entry definition assigns no constant we can see, so a
            // use it reaches can never be replaced (§9.2.4).
            const defQuad = info.entry ? undefined : frozen.quads[info.quadIndex];
            return defQuad ? constAssigned(defQuad) : null;
          });
          const first = constants[0];
          if (!first) continue;
          const allSame = constants.every(
            (c) => c !== null && c.value === first.value && c.ctype === first.ctype,
          );
          if (!allSame) continue;

          const before = formatQuad(q);
          q[slot] = { kind: 'const', value: first.value, ctype: first.ctype };
          const change: RewriteChange = {
            functionName: fn.name,
            kind: 'replace',
            beforeIndex: qi,
            afterIndex: qi,
            justification: `Constant propagation (§9.2.4): the definition(s) {${reachingDefIds.join(
              ', ',
            )}} are ALL the definitions of ${v} reaching instruction ${qi}, and each assigns the constant ${first.value}; "${before}" becomes "${formatQuad(q)}".`,
          };
          changes.push(change);
          yield rewriteStep('const-prop', change, fn, CITE);
        }
        // Advance the point past this quad (defs kill other defs of same var).
        const defHere = rd.defs.find((d) => d.quadIndex === qi);
        if (defHere) {
          cur = union(
            [defHere.id],
            difference(cur, (defsOfVar[defHere.var] ?? []).filter((x) => x !== defHere.id)),
          );
        }
      }
    }
  }

  const result = finishPass('const-prop', working, changes);
  yield passEndStep('const-prop', result.after, changes.length, CITE);
  return result;
}

export function runConstProp(program: TacProgram): Recorded<PassState, PassEvent, OptPassResult> {
  return record(() => constProp(program), initialPassState, passReducer, { id: 'opt.pass.const-prop' });
}

export { passStateFromResult as projectConstProp };
