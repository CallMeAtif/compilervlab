/**
 * Copy propagation — Dragon Book (2nd ed.) §9.1.3: after a copy x = y, uses of
 * x may be replaced by y as long as neither x nor y has been reassigned in
 * between. The "reaching copies" analysis is the iterative framework of §9.3
 * instantiated forward with meet = intersection (a copy must be available on
 * ALL paths): gen_B = copies in B still intact at its end, kill_B = copies
 * whose target or source B redefines.
 */
import type { Quad, TacFunction, TacProgram } from '../../ir/types.js';
import { formatQuad } from '../../ir/types.js';
import type { Recorded, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { Cfg, OptPassResult } from '../types.js';
import type { PassEvent, PassState, RewriteChange } from '../opt-events.js';
import { initialPassState, passReducer, passStateFromResult } from '../opt-events.js';
import {
  addressTakenVars,
  definedVar,
  difference,
  iterativeDataflow,
  sortSet,
  union,
  varKey,
  type DataflowProblem,
  type DataflowResult,
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
  section: '9.1.3',
  rule: 'After the copy x = y, uses of x may be replaced by y while neither x nor y is reassigned',
};

export interface CopyInfo {
  id: string; // c1, c2, … in program order
  quadIndex: number;
  dst: string;
  src: string;
}

/** Build the reaching-copies problem for one function. */
export function reachingCopiesProblem(
  fn: TacFunction,
  cfg: Cfg,
  excluded: Set<string>,
): { problem: DataflowProblem; copies: CopyInfo[] } {
  const copies: CopyInfo[] = [];
  for (const q of fn.quads) {
    if (q.op !== 'copy' || !q.arg1 || !q.result) continue;
    const dst = varKey(q.result);
    const src = varKey(q.arg1);
    if (dst === null || src === null) continue; // x = const is not a copy here
    if (excluded.has(dst) || excluded.has(src)) continue;
    if (dst === src) continue;
    copies.push({ id: `c${copies.length + 1}`, quadIndex: q.index, dst, src });
  }
  const copyAtQuad: Record<number, CopyInfo> = {};
  for (const c of copies) copyAtQuad[c.quadIndex] = c;
  const involving: Record<string, string[]> = {};
  for (const c of copies) {
    (involving[c.dst] ??= []).push(c.id);
    if (c.src !== c.dst) (involving[c.src] ??= []).push(c.id);
  }

  const gen: Record<string, string[]> = {};
  const kill: Record<string, string[]> = {};
  for (const b of cfg.blocks) {
    let genB: string[] = [];
    let killB: string[] = [];
    for (const qi of b.quadIndices) {
      const q = fn.quads[qi]!;
      const d = definedVar(q);
      if (d !== null) {
        const killed = involving[d] ?? [];
        genB = difference(genB, killed);
        killB = union(killB, killed);
      }
      const c = copyAtQuad[qi];
      if (c) {
        genB = union(genB, [c.id]);
        killB = difference(killB, [c.id]);
      }
    }
    gen[String(b.id)] = genB;
    kill[String(b.id)] = killB;
  }

  return {
    problem: {
      name: 'reaching-copies',
      direction: 'forward',
      meet: 'intersection',
      domain: copies.map((c) => c.id),
      gen,
      kill,
      boundary: [],
      init: copies.map((c) => c.id),
      cite: { section: '9.3', figureOrAlgo: 'Iterative framework (Algorithm 9.11 style)' },
    },
    copies,
  };
}

export function* copyProp(program: TacProgram): Steps<PassEvent, OptPassResult> {
  const working = cloneProgram(program);
  const changes: RewriteChange[] = [];
  const globals = new Set(globalVarNames(working));

  yield passBeginStep(
    'copy-prop',
    working,
    CITE,
    'Copy propagation solves "reaching copies" (forward, meet = ∩ over the §9.3 framework), then replaces each use of x by y wherever the copy x = y reaches undisturbed (§9.1.3).',
  );

  for (const fn of working.functions) {
    const frozen: TacFunction = { ...fn, quads: fn.quads.map((q) => ({ ...q })) };
    const cfg = cfgOf(frozen);
    // Address-taken variables can change through pointers, globals through
    // calls; both are excluded from copies conservatively.
    const excluded = new Set<string>([...addressTakenVars(frozen), ...globals]);
    const { problem, copies } = reachingCopiesProblem(frozen, cfg, excluded);
    const rc: DataflowResult = yield* iterativeDataflow(cfg, problem);

    const copyById: Record<string, CopyInfo> = {};
    for (const c of copies) copyById[c.id] = c;
    const copyAtQuad: Record<number, CopyInfo> = {};
    for (const c of copies) copyAtQuad[c.quadIndex] = c;
    const involving: Record<string, string[]> = {};
    for (const c of copies) {
      (involving[c.dst] ??= []).push(c.id);
      if (c.src !== c.dst) (involving[c.src] ??= []).push(c.id);
    }

    for (const block of cfg.blocks) {
      let cur = rc.in[String(block.id)] ?? [];
      for (const qi of block.quadIndices) {
        const q = fn.quads[qi]!;
        const frozenQ = frozen.quads[qi]!;
        for (const slot of valueUseSlots(frozenQ)) {
          const operand = q[slot];
          if (!operand || (operand.kind !== 'var' && operand.kind !== 'temp')) continue;
          const v = varKey(operand);
          if (v === null) continue;
          // Copies with dst = v available at this point; if several, the one
          // with the largest quad index is the most recent on every path.
          const avail = cur
            .map((id) => copyById[id]!)
            .filter((c) => c.dst === v)
            .sort((a, b) => a.quadIndex - b.quadIndex);
          const c = avail[avail.length - 1];
          if (!c) continue;
          const srcQuad = frozen.quads[c.quadIndex]!;
          const srcOperand = srcQuad.arg1;
          if (!srcOperand || (srcOperand.kind !== 'var' && srcOperand.kind !== 'temp')) continue;

          const before = formatQuad(q);
          q[slot] = { ...srcOperand };
          const change: RewriteChange = {
            functionName: fn.name,
            kind: 'replace',
            beforeIndex: qi,
            afterIndex: qi,
            justification: `Copy propagation (§9.1.3): copy ${c.id} ("${formatQuad(
              srcQuad,
            )}" at instruction ${c.quadIndex}) reaches instruction ${qi} on every path with neither ${c.dst} nor ${c.src} reassigned, so "${before}" becomes "${formatQuad(q)}".`,
          };
          changes.push(change);
          yield rewriteStep('copy-prop', change, fn, CITE);
        }
        // Advance the point: kill copies disturbed by a definition, then gen.
        const d = definedVar(frozenQ);
        if (d !== null) cur = difference(cur, involving[d] ?? []);
        const c = copyAtQuad[qi];
        if (c) cur = sortSet(union(cur, [c.id]));
      }
    }
  }

  const result = finishPass('copy-prop', working, changes);
  yield passEndStep('copy-prop', result.after, changes.length, CITE);
  return result;
}

export function runCopyProp(program: TacProgram): Recorded<PassState, PassEvent, OptPassResult> {
  return record(() => copyProp(program), initialPassState, passReducer, { id: 'opt.pass.copy-prop' });
}

export { passStateFromResult as projectCopyProp };
