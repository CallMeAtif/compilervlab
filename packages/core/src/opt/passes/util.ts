/**
 * Shared machinery for the optimization passes: deep-cloned working copies,
 * untraced block/CFG drivers, renumbering, and the pass-begin / rewrite /
 * pass-end event plumbing (see opt-events.ts).
 */
import type { Quad, TacFunction, TacOperand, TacProgram } from '../../ir/types.js';
import { formatQuad } from '../../ir/types.js';
import type { StepMeta } from '@lab/trace';
import { findBasicBlocks } from '../basic-blocks.js';
import { computeCfg } from '../cfg.js';
import type { BasicBlock, Cfg, OptPassName, OptPassResult } from '../types.js';
import type { FunctionView, PassEvent, RewriteChange } from '../opt-events.js';

/** Run a Steps generator to completion, discarding events. */
export function drain<E, R>(gen: Generator<[E, StepMeta], R, void>): R {
  let it = gen.next();
  while (!it.done) it = gen.next();
  return it.value;
}

export function computeBlocks(fn: TacFunction): BasicBlock[] {
  return drain(findBasicBlocks(fn)).blocks;
}

export function cfgOf(fn: TacFunction): Cfg {
  return computeCfg(fn, computeBlocks(fn));
}

export function cfgsOf(program: TacProgram): Cfg[] {
  return program.functions.map((fn) => cfgOf(fn));
}

export function cloneOperand(o: TacOperand | null): TacOperand | null {
  return o === null ? null : { ...o };
}

export function cloneQuad(q: Quad): Quad {
  const c: Quad = {
    index: q.index,
    op: q.op,
    arg1: cloneOperand(q.arg1),
    arg2: cloneOperand(q.arg2),
    result: cloneOperand(q.result),
    astNodeId: q.astNodeId,
  };
  if (q.relop !== undefined) c.relop = q.relop;
  return c;
}

export function cloneFunction(fn: TacFunction): TacFunction {
  return {
    name: fn.name,
    symbolId: fn.symbolId,
    params: [...fn.params],
    quads: fn.quads.map(cloneQuad),
    tempCount: fn.tempCount,
  };
}

export function cloneProgram(p: TacProgram): TacProgram {
  // The static initial values of the globals (§7.1) are part of the program:
  // an optimization must not change what the data area holds at entry.
  return {
    functions: p.functions.map(cloneFunction),
    globals: [...p.globals],
    ...(p.globalInits ? { globalInits: p.globalInits.map((g) => ({ ...g })) } : {}),
  };
}

/** Rebuild quad.index = array position for every function (renumbering). */
export function renumber(p: TacProgram): TacProgram {
  for (const fn of p.functions) {
    fn.quads.forEach((q, i) => {
      q.index = i;
    });
  }
  return p;
}

export function viewOf(fn: TacFunction): FunctionView {
  return { name: fn.name, quads: fn.quads.map((q) => formatQuad(q)) };
}

export function viewsOf(p: TacProgram): FunctionView[] {
  return p.functions.map(viewOf);
}

/** Global variable NAMES of a program (symbolId ∈ program.globals). */
export function globalVarNames(p: TacProgram): string[] {
  const ids = new Set(p.globals);
  const names = new Set<string>();
  for (const fn of p.functions) {
    for (const q of fn.quads) {
      for (const o of [q.arg1, q.arg2, q.result]) {
        if (o && o.kind === 'var' && ids.has(o.symbolId)) names.add(o.name);
      }
    }
  }
  return [...names].sort();
}

/** Fresh label name L<n> above every existing label number in the program. */
export function freshLabelName(p: TacProgram): string {
  let max = 0;
  for (const fn of p.functions) {
    for (const q of fn.quads) {
      for (const o of [q.arg1, q.result]) {
        if (o && o.kind === 'label') {
          const m = /^L(\d+)$/.exec(o.name);
          if (m) max = Math.max(max, Number(m[1]));
        }
      }
    }
  }
  return `L${max + 1}`;
}

export interface PassCite {
  section: string;
  figureOrAlgo?: string;
  rule?: string;
}

export function passBeginStep(
  pass: OptPassName,
  program: TacProgram,
  cite: PassCite,
  prose: string,
): [PassEvent, StepMeta] {
  return [
    { kind: 'pass-begin', pass, functions: viewsOf(program) },
    { cite, prose, level: 'macro', section: `Pass: ${pass}` },
  ];
}

export function rewriteStep(
  pass: OptPassName,
  change: RewriteChange,
  fn: TacFunction,
  cite: PassCite,
  extraMeta?: Partial<Pick<StepMeta, 'section' | 'groupId' | 'irRefs'>>,
): [PassEvent, StepMeta] {
  return [
    { kind: 'rewrite', pass, change, snapshot: viewOf(fn) },
    {
      cite,
      prose: change.justification,
      level: 'macro',
      section: extraMeta?.section ?? `Rewrites (${fn.name})`,
      ...(extraMeta?.groupId ? { groupId: extraMeta.groupId } : {}),
      irRefs:
        extraMeta?.irRefs ??
        (change.beforeIndex !== null ? [{ kind: 'tacInstr', id: change.beforeIndex }] : []),
    },
  ];
}

export function passEndStep(
  pass: OptPassName,
  after: TacProgram,
  changeCount: number,
  cite: PassCite,
): [PassEvent, StepMeta] {
  return [
    { kind: 'pass-end', pass, functions: viewsOf(after), changeCount },
    {
      cite,
      prose: `Pass ${pass} finished with ${changeCount} change(s); instructions renumbered and basic blocks/CFG recomputed on the result.`,
      level: 'macro',
      section: `Pass: ${pass}`,
    },
  ];
}

/** Finish a pass: renumber the working program, rebuild CFGs, package result. */
export function finishPass(
  pass: OptPassName,
  working: TacProgram,
  changes: RewriteChange[],
): OptPassResult {
  const after = renumber(working);
  return {
    pass,
    after,
    cfgAfter: cfgsOf(after),
    changes: changes.map((c) => ({ ...c })),
  };
}

/** Operand slots of a quad that are scalar VALUE uses (safe to substitute). */
export function valueUseSlots(q: Quad): Array<'arg1' | 'arg2'> {
  switch (q.op) {
    case '+':
    case '-':
    case '*':
    case '/':
    case '%':
    case '==':
    case '!=':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case 'ifrel':
      return ['arg1', 'arg2'];
    case 'neg':
    case 'not':
    case 'copy':
    case 'inttofloat':
    case 'if':
    case 'iffalse':
    case 'param':
    case 'return':
      return ['arg1'];
    case 'index-load':
      return ['arg2']; // index; arg1 is the array base
    case 'index-store':
      return ['arg1', 'arg2']; // stored value and index; result is the base
    case 'deref-store':
      return ['arg1']; // stored value; result is the pointer
    default:
      return [];
  }
}
