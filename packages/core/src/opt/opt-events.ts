/**
 * Shared event vocabulary and UI reducer states for the optimization passes
 * and the pass pipeline. Each pass trace is: pass-begin, analysis events
 * (the §9.2/§9.3/§9.6 events re-used from dataflow/dominators/loops),
 * rewrite events (one per change, with the justification string shown in the
 * DiffView), and pass-end carrying the renumbered result.
 */
import type { TacProgram } from '../ir/types.js';
import { formatQuad } from '../ir/types.js';
import type { Reducer } from '@lab/trace';
import type { OptPassName, OptPassResult, OptimizedProgram } from './types.js';
import type { BasicBlockEvent } from './basic-blocks.js';
import type { CfgEvent } from './cfg.js';
import type { DataflowEvent } from './dataflow.js';
import type { DominatorsEvent } from './dominators.js';
import type { LoopsEvent } from './loops.js';

/** One instruction-level change (mirrors OptPassResult['changes'][number]). */
export interface RewriteChange {
  functionName: string;
  kind: 'replace' | 'delete' | 'move' | 'insert';
  beforeIndex: number | null;
  afterIndex: number | null;
  justification: string;
}

export interface FunctionView {
  name: string;
  quads: string[]; // formatQuad rendering, current view
}

export type PassEvent =
  | BasicBlockEvent
  | CfgEvent
  | DataflowEvent
  | DominatorsEvent
  | LoopsEvent
  | { kind: 'pass-begin'; pass: OptPassName; functions: FunctionView[] }
  | {
      kind: 'rewrite';
      pass: OptPassName;
      change: RewriteChange;
      /** The whole function's quads after this change (small teaching programs;
       *  keeps the replayed view exact under deletes/moves/inserts). */
      snapshot: FunctionView;
    }
  | {
      kind: 'rewrite-skipped';
      pass: OptPassName;
      functionName: string;
      quadIndex: number;
      reason: string;
    }
  | { kind: 'pass-end'; pass: OptPassName; functions: FunctionView[]; changeCount: number }
  // LICM-specific analysis events (marking and legality; moves are 'rewrite').
  | {
      kind: 'licm-invariant';
      functionName: string;
      quadIndex: number;
      loopHeader: number;
      reason: string;
    }
  | {
      kind: 'licm-legality';
      functionName: string;
      quadIndex: number;
      loopHeader: number;
      condition:
        | 'dominates-exits-or-dead'
        | 'only-def-in-loop'
        | 'only-def-reaching-uses'
        | 'depends-on-moved-invariants';
      ok: boolean;
      detail: string;
    };

export interface PassState {
  pass: OptPassName | null;
  functions: FunctionView[];
  changes: RewriteChange[];
  /** Pending-change highlight for the DiffView (cleared at pass-end). */
  highlight: { functionName: string; beforeIndex: number | null; afterIndex: number | null } | null;
  done: boolean;
}

export const initialPassState: PassState = {
  pass: null,
  functions: [],
  changes: [],
  highlight: null,
  done: false,
};

export const passReducer: Reducer<PassState, PassEvent> = (state, event) => {
  switch (event.kind) {
    case 'pass-begin':
      return {
        pass: event.pass,
        functions: event.functions,
        changes: [],
        highlight: null,
        done: false,
      };
    case 'rewrite':
      return {
        ...state,
        functions: state.functions.map((f) =>
          f.name === event.snapshot.name ? event.snapshot : f,
        ),
        changes: [...state.changes, event.change],
        highlight: {
          functionName: event.change.functionName,
          beforeIndex: event.change.beforeIndex,
          afterIndex: event.change.afterIndex,
        },
      };
    case 'pass-end':
      return { ...state, functions: event.functions, highlight: null, done: true };
    default:
      // Analysis events (basic blocks / CFG / dataflow / dominators / loops)
      // do not change the pass view; their own reducers replay them for the
      // analysis tables.
      return state;
  }
};

export function functionViews(program: TacProgram): FunctionView[] {
  return program.functions.map((fn) => ({
    name: fn.name,
    quads: fn.quads.map((q) => formatQuad(q)),
  }));
}

/** Projection: OptPassResult -> final PassState (for checkTraceInvariants). */
export function passStateFromResult(result: OptPassResult): PassState {
  return {
    pass: result.pass,
    functions: functionViews(result.after),
    changes: result.changes.map((c) => ({ ...c })),
    highlight: null,
    done: true,
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export type OptEvent = PassEvent;

export interface PipelineState {
  /** One PassState per pass, in applied order; events route to the last. */
  passStates: PassState[];
}

export const initialPipelineState: PipelineState = { passStates: [] };

export const pipelineReducer: Reducer<PipelineState, OptEvent> = (state, event) => {
  if (event.kind === 'pass-begin') {
    return { passStates: [...state.passStates, passReducer(initialPassState, event)] };
  }
  if (state.passStates.length === 0) return state; // pre-pass CFG events
  const last = state.passStates[state.passStates.length - 1]!;
  const next = passReducer(last, event);
  if (next === last) return state;
  return { passStates: [...state.passStates.slice(0, -1), next] };
};

export function pipelineStateFromResult(result: OptimizedProgram): PipelineState {
  return { passStates: result.passes.map(passStateFromResult) };
}
