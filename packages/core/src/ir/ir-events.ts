/**
 * Event union + UI reducer state for the traced AST → TAC translation
 * (§6.4–§6.9). Events are plain JSON; the reducer reconstructs, from the event
 * stream alone, the quads emitted so far per function, the current AST node
 * highlight, the active backpatch lists, and the label table.
 */
import type { Reducer } from '@lab/trace';
import type { GlobalInit, Quad, TacOperand, TacProgram } from './types.js';

export type ListRole = 'truelist' | 'falselist' | 'nextlist';

export type IrEvent =
  | { kind: 'ir-globals'; symbolIds: number[]; inits: GlobalInit[] }
  | { kind: 'func-begin'; name: string; symbolId: number; params: number[] }
  | { kind: 'enter-node'; func: string; astNodeId: number; nodeKind: string }
  | { kind: 'emit-quad'; func: string; quad: Quad }
  | {
      kind: 'makelist';
      func: string;
      listId: number;
      role: ListRole;
      astNodeId: number;
      instr: number;
    }
  | {
      kind: 'merge';
      func: string;
      listId: number;
      role: ListRole;
      astNodeId: number;
      sources: number[];
      instrs: number[];
    }
  | {
      kind: 'backpatch';
      func: string;
      listId: number;
      instrs: number[];
      targetLabel: string;
      targetInstr: number;
    }
  | { kind: 'func-end'; name: string; tempCount: number };

export interface LabelEntry {
  name: string;
  instr: number;
}

export interface IrGenFunctionState {
  name: string;
  symbolId: number;
  params: number[];
  quads: Quad[];
  tempCount: number;
  /** Label table: label name → instruction index of its `label` quad. */
  labels: LabelEntry[];
}

export interface ActiveList {
  id: number;
  func: string;
  role: ListRole;
  astNodeId: number;
  instrs: number[];
}

export interface IrGenState {
  globals: number[];
  /** Initial values of the statically allocated globals (§7.1) — no code runs
   *  for these, the data area already holds them when execution begins. */
  globalInits: GlobalInit[];
  functions: IrGenFunctionState[];
  currentFunc: string | null;
  /** AST node currently being translated (UI highlight). */
  currentAstNode: number | null;
  /** Backpatch lists that exist but have not yet been patched or merged away. */
  activeLists: ActiveList[];
}

export function initialIrGenState(): IrGenState {
  return {
    globals: [],
    globalInits: [],
    functions: [],
    currentFunc: null,
    currentAstNode: null,
    activeLists: [],
  };
}

function maxTempIn(op: TacOperand | null, cur: number): number {
  return op && op.kind === 'temp' && op.id > cur ? op.id : cur;
}

function updateFunc(
  state: IrGenState,
  name: string,
  f: (fn: IrGenFunctionState) => IrGenFunctionState,
): IrGenState {
  return {
    ...state,
    functions: state.functions.map((fn) => (fn.name === name ? f(fn) : fn)),
  };
}

export const irGenReducer: Reducer<IrGenState, IrEvent> = (state, event) => {
  switch (event.kind) {
    case 'ir-globals':
      return { ...state, globals: event.symbolIds, globalInits: event.inits };
    case 'func-begin':
      return {
        ...state,
        currentFunc: event.name,
        functions: [
          ...state.functions,
          {
            name: event.name,
            symbolId: event.symbolId,
            params: event.params,
            quads: [],
            tempCount: 0,
            labels: [],
          },
        ],
      };
    case 'enter-node':
      return { ...state, currentAstNode: event.astNodeId };
    case 'emit-quad':
      return updateFunc(state, event.func, (fn) => {
        const q = event.quad;
        let tempCount = fn.tempCount;
        tempCount = maxTempIn(q.result, tempCount);
        tempCount = maxTempIn(q.arg1, tempCount);
        tempCount = maxTempIn(q.arg2, tempCount);
        const labels =
          q.op === 'label' && q.result && q.result.kind === 'label'
            ? [...fn.labels, { name: q.result.name, instr: q.index }]
            : fn.labels;
        return { ...fn, quads: [...fn.quads, q], tempCount, labels };
      });
    case 'makelist':
      return {
        ...state,
        activeLists: [
          ...state.activeLists,
          {
            id: event.listId,
            func: event.func,
            role: event.role,
            astNodeId: event.astNodeId,
            instrs: [event.instr],
          },
        ],
      };
    case 'merge':
      return {
        ...state,
        activeLists: [
          ...state.activeLists.filter((l) => !event.sources.includes(l.id)),
          {
            id: event.listId,
            func: event.func,
            role: event.role,
            astNodeId: event.astNodeId,
            instrs: event.instrs,
          },
        ],
      };
    case 'backpatch': {
      const patched = updateFunc(state, event.func, (fn) => ({
        ...fn,
        quads: fn.quads.map((q) =>
          event.instrs.includes(q.index)
            ? { ...q, result: { kind: 'label' as const, name: event.targetLabel } }
            : q,
        ),
      }));
      return {
        ...patched,
        activeLists: patched.activeLists.filter((l) => l.id !== event.listId),
      };
    }
    case 'func-end':
      return updateFunc(
        { ...state, currentFunc: null, currentAstNode: null },
        event.name,
        (fn) => ({ ...fn, tempCount: event.tempCount }),
      );
  }
};

/** Projection of the returned TacProgram onto the reduced-state shape, for the
 *  replay-equals-artifact invariant (checkTraceInvariants). */
export function projectIrGenState(result: TacProgram): IrGenState {
  return {
    globals: result.globals,
    globalInits: result.globalInits ?? [],
    functions: result.functions.map((f) => ({
      name: f.name,
      symbolId: f.symbolId,
      params: f.params,
      quads: f.quads,
      tempCount: f.tempCount,
      labels: f.quads
        .filter((q) => q.op === 'label')
        .map((q) => ({
          name: q.result && q.result.kind === 'label' ? q.result.name : '?',
          instr: q.index,
        })),
    })),
    currentFunc: null,
    currentAstNode: null,
    activeLists: [],
  };
}
