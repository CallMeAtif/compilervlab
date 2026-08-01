/**
 * Dominators — Dragon Book (2nd ed.) §9.6.1: node d dominates node n (d dom n)
 * if every path from the entry node to n goes through d. Computed by the
 * forward data-flow formulation the book gives: D(n0) = {n0}; for n ≠ n0,
 * D(n) = {n} ∪ ( ∩ over predecessors p of n of D(p) ), iterated to a fixpoint
 * visiting blocks in ascending id order.
 */
import type { Reducer, Recorded, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { Cfg } from './types.js';
import { predecessors } from './cfg.js';
import { intersection, sameSet, sortSet, union } from './dataflow.js';

export type DominatorsEvent =
  | { kind: 'dom-init'; entry: number; blockIds: number[] }
  | { kind: 'dom-iteration'; iteration: number }
  | { kind: 'dom-update'; iteration: number; blockId: number; doms: number[]; changed: boolean }
  | { kind: 'dom-converged'; iterations: number };

export interface DominatorsResult {
  /** dom[String(blockId)] = sorted list of dominators of that block. */
  dom: Record<string, number[]>;
  iterations: number;
  entry: number;
}

export interface DominatorsState {
  dom: Record<string, number[]>;
  iterations: number;
  converged: boolean;
  entry: number;
}

export const initialDominatorsState: DominatorsState = {
  dom: {},
  iterations: 0,
  converged: false,
  entry: 0,
};

export const dominatorsReducer: Reducer<DominatorsState, DominatorsEvent> = (state, event) => {
  switch (event.kind) {
    case 'dom-init': {
      const dom: Record<string, number[]> = {};
      for (const id of event.blockIds) {
        dom[String(id)] = id === event.entry ? [id] : [...event.blockIds];
      }
      return { dom, iterations: 0, converged: false, entry: event.entry };
    }
    case 'dom-iteration':
      return { ...state, iterations: event.iteration };
    case 'dom-update':
      return { ...state, dom: { ...state.dom, [String(event.blockId)]: event.doms } };
    case 'dom-converged':
      return { ...state, converged: true, iterations: event.iterations };
  }
};

export function projectDominators(result: DominatorsResult): DominatorsState {
  return { dom: result.dom, iterations: result.iterations, converged: true, entry: result.entry };
}

// §9.6.1 defines dominators and gives the D(n) = {n} ∪ ⋂ D(p) recurrence; it
// does not number that recurrence as a figure or algorithm, so no
// figureOrAlgo is claimed here.
const cite = (rule?: string): StepMeta['cite'] => ({
  section: '9.6.1',
  ...(rule ? { rule } : {}),
});

const setText = (xs: number[]): string => `{${xs.map((x) => `B${x}`).join(', ')}}`;

/**
 * Iterative dominator computation over the real blocks of a CFG (the entry
 * block is the block whose predecessor is the ENTRY pseudo-node — B0 by the
 * §8.4.1 convention).
 */
export function* computeDominators(cfg: Cfg): Steps<DominatorsEvent, DominatorsResult> {
  const blockIds = cfg.blocks.map((b) => b.id).sort((a, b) => a - b);
  const entry = blockIds[0] ?? 0;
  const dom: Record<string, number[]> = {};
  for (const id of blockIds) dom[String(id)] = id === entry ? [id] : [...blockIds];

  yield [
    { kind: 'dom-init', entry, blockIds: [...blockIds] },
    {
      cite: cite('D(n0) = {n0}; D(n) = N (the set of all nodes) for every n ≠ n0'),
      prose: `Initialize D(B${entry}) = {B${entry}} (the entry dominates only itself so far) and D(n) = all ${blockIds.length} blocks for every other block n.`,
      level: 'macro',
      section: 'Dominators setup',
    },
  ];

  let iteration = 0;
  let changedAny = true;
  while (changedAny) {
    changedAny = false;
    iteration++;
    const section = `Dominators iteration ${iteration}`;
    const groupId = `dominators-iteration-${iteration}`;
    yield [
      { kind: 'dom-iteration', iteration },
      {
        cite: cite(),
        prose: `Dominator iteration ${iteration}: recompute D(n) = {n} ∪ (∩ of D(p) over predecessors p) for every block in ascending id order.`,
        level: 'macro',
        section,
        groupId,
      },
    ];
    for (const id of blockIds) {
      if (id === entry) continue;
      const preds = predecessors(cfg, id).filter((p) => p >= 0);
      let meet: number[] | null = null;
      for (const p of preds) {
        const dp = dom[String(p)] ?? [];
        meet = meet === null ? [...dp] : meet.filter((x) => dp.includes(x));
      }
      const next = sortNums([...(meet ?? blockIds.filter((b) => b !== id)), id]);
      const changed = !sameNums(next, dom[String(id)] ?? []);
      dom[String(id)] = next;
      if (changed) changedAny = true;
      yield [
        { kind: 'dom-update', iteration, blockId: id, doms: [...next], changed },
        {
          cite: cite('D(n) = {n} ∪ ( ∩ over predecessors p of n of D(p) )'),
          prose: `D(B${id}) = {B${id}} ∪ ∩ over predecessors {${preds
            .map((p) => `B${p}`)
            .join(', ')}} = ${setText(next)}${changed ? ' (changed)' : ' (unchanged)'}.`,
          level: 'micro',
          section,
          groupId,
          irRefs: [{ kind: 'block', id }],
        },
      ];
    }
  }

  yield [
    { kind: 'dom-converged', iterations: iteration },
    {
      cite: cite(),
      prose: `Dominator sets converged after ${iteration} iteration(s): every path from the entry to a block passes through each of the block's dominators.`,
      level: 'macro',
      section: 'Dominators converged',
    },
  ];

  return { dom, iterations: iteration, entry };
}

function sortNums(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

function sameNums(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function runComputeDominators(cfg: Cfg): Recorded<DominatorsState, DominatorsEvent, DominatorsResult> {
  return record(() => computeDominators(cfg), initialDominatorsState, dominatorsReducer, {
    id: `opt.dominators.${cfg.functionName}`,
  });
}

/** Untraced convenience for passes. */
export function solveDominators(cfg: Cfg): DominatorsResult {
  const gen = computeDominators(cfg);
  let it = gen.next();
  while (!it.done) it = gen.next();
  return it.value;
}

export function dominates(result: DominatorsResult, a: number, b: number): boolean {
  return (result.dom[String(b)] ?? []).includes(a);
}

// Keep set helpers importable from one place for loops.ts.
export { intersection, sortSet, sameSet, union };
