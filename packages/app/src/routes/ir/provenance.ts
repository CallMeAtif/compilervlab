/**
 * Step → highlight derivation for the /ir page.
 *
 * Nothing here re-derives algorithm state: the reduced `stepper.state` is the
 * only source of quads, lists and labels. This module only reads the RECORDED
 * step list to answer two UI questions the reduced state does not carry:
 *   1. which instructions did the step(s) the cursor just revealed emit/patch?
 *   2. which AST nodes has the translator entered so far?
 *
 * "The step the cursor just revealed" is a window, not a single step: at macro
 * level the visible cursor skips over the micro `emit-quad` steps of a node, so
 * the window spans (previous visible cursor, current cursor].
 */
import { useMemo } from 'react';
import type { IrEvent, IrGenState } from '@lab/core/ir/ir-events.js';
import type { Quad, TacOperand } from '@lab/core/ir/types.js';
import type { Stepper } from '../../lib/useStepper';

export interface IrHighlight {
  /** Instruction indices emitted inside the current step window. */
  emitted: ReadonlySet<number>;
  /** Instruction indices whose target was filled in by a backpatch in it. */
  patched: ReadonlySet<number>;
  /** Instruction indices put on a backpatch list by it (makelist / merge). */
  listed: ReadonlySet<number>;
  /** AST node ids entered so far, as TidyTree ids (strings). */
  visitedAstIds: ReadonlySet<string>;
  /** The backpatch-primitive event of the current step, if it is one. */
  listOp: Extract<IrEvent, { kind: 'makelist' | 'merge' | 'backpatch' }> | null;
}

/** Largest visible cursor strictly below `index` (0 when there is none). */
function windowStart(visibleIndices: readonly number[], index: number): number {
  let start = 0;
  for (const i of visibleIndices) {
    const cursor = i + 1;
    if (cursor < index && cursor > start) start = cursor;
    if (cursor >= index) break;
  }
  return start;
}

export function useIrHighlight(
  stepper: Stepper<IrGenState, IrEvent>,
  funcName: string | null,
): IrHighlight {
  const { trace, index, visibleIndices, currentStep } = stepper;

  return useMemo(() => {
    const emitted = new Set<number>();
    const patched = new Set<number>();
    const listed = new Set<number>();
    const visitedAstIds = new Set<string>();

    // Every AST node the translator has entered so far.
    for (let i = 0; i < index; i++) {
      const step = trace.steps[i];
      if (!step) continue;
      const ev = step.event;
      if (ev.kind === 'enter-node' && (funcName === null || ev.func === funcName)) {
        visitedAstIds.add(String(ev.astNodeId));
      }
    }

    // What the just-revealed step(s) did.
    const from = windowStart(visibleIndices, index);
    for (let i = from; i < index; i++) {
      const step = trace.steps[i];
      if (!step) continue;
      const ev = step.event;
      if (funcName !== null && 'func' in ev && ev.func !== funcName) continue;
      switch (ev.kind) {
        case 'emit-quad':
          emitted.add(ev.quad.index);
          break;
        case 'backpatch':
          for (const n of ev.instrs) patched.add(n);
          break;
        case 'makelist':
          listed.add(ev.instr);
          break;
        case 'merge':
          for (const n of ev.instrs) listed.add(n);
          break;
        default:
          break;
      }
    }

    const ev = currentStep?.event;
    const listOp =
      ev && (ev.kind === 'makelist' || ev.kind === 'merge' || ev.kind === 'backpatch')
        ? ev
        : null;

    return { emitted, patched, listed, visitedAstIds, listOp };
  }, [trace, index, visibleIndices, currentStep, funcName]);
}

// ── quad rendering helpers (shared by the three representation views) ────────

const JUMP_OPS: ReadonlySet<string> = new Set(['goto', 'if', 'iffalse', 'ifrel']);

/** True when `result` holds a jump target rather than a destination operand. */
export function isJump(q: Quad): boolean {
  return JUMP_OPS.has(q.op);
}

/** A jump whose target has not been backpatched yet (§6.7: "goto _"). */
export function hasPendingTarget(q: Quad): boolean {
  return isJump(q) && q.result === null;
}

/** The `op` column of the quadruple table (Fig 6.10 spelling). */
export function quadOpLabel(q: Quad): string {
  switch (q.op) {
    case 'ifrel':
      return `if ${q.relop ?? '?'}`;
    case 'iffalse':
      return 'ifFalse';
    case 'copy':
      return '=';
    case 'neg':
      return 'minus';
    case 'inttofloat':
      return '(float)';
    case 'index-load':
      return '=[]';
    case 'index-store':
      return '[]=';
    case 'addr':
      return '&';
    case 'deref-load':
      return '*';
    case 'deref-store':
      return '*=';
    default:
      return q.op;
  }
}

export function operandText(o: TacOperand | null): string {
  if (!o) return '';
  switch (o.kind) {
    case 'temp':
      return `t${o.id}`;
    case 'var':
      return o.name;
    case 'const':
      return String(o.value);
    case 'label':
      return o.name;
  }
}
