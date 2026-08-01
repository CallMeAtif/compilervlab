/**
 * Back edges and natural loops — Dragon Book (2nd ed.):
 *  - §9.6.4: an edge a → b is a BACK edge if its head b dominates its tail a.
 *  - §9.6.6, Algorithm 9.46: the natural loop of a back edge a → b is b plus
 *    all nodes that can reach a without going through b (worklist over
 *    predecessors, seeded with a).
 */
import type { Reducer, Recorded, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { Cfg } from './types.js';
import { ENTRY, predecessors, successors } from './cfg.js';
import type { DominatorsResult } from './dominators.js';
import { dominates, solveDominators } from './dominators.js';

export interface NaturalLoop {
  /** Loop header (the target b of the back edge). */
  header: number;
  backEdge: { from: number; to: number };
  /** Sorted block ids in the loop body (includes the header). */
  body: number[];
}

export type LoopsEvent =
  | { kind: 'back-edge'; from: number; to: number }
  | { kind: 'loop-node-added'; header: number; backEdgeFrom: number; node: number }
  | { kind: 'loop-found'; header: number; backEdgeFrom: number; body: number[] };

export interface LoopsState {
  backEdges: Array<{ from: number; to: number }>;
  loops: NaturalLoop[];
  /** Body being accumulated for the loop currently under construction. */
  building: { header: number; backEdgeFrom: number; nodes: number[] } | null;
}

export const initialLoopsState: LoopsState = { backEdges: [], loops: [], building: null };

export const loopsReducer: Reducer<LoopsState, LoopsEvent> = (state, event) => {
  switch (event.kind) {
    case 'back-edge':
      return { ...state, backEdges: [...state.backEdges, { from: event.from, to: event.to }] };
    case 'loop-node-added': {
      const building =
        state.building &&
        state.building.header === event.header &&
        state.building.backEdgeFrom === event.backEdgeFrom
          ? {
              ...state.building,
              nodes: [...state.building.nodes, event.node].sort((a, b) => a - b),
            }
          : { header: event.header, backEdgeFrom: event.backEdgeFrom, nodes: [event.node] };
      return { ...state, building };
    }
    case 'loop-found':
      return {
        ...state,
        building: null,
        loops: [
          ...state.loops,
          {
            header: event.header,
            backEdge: { from: event.backEdgeFrom, to: event.header },
            body: [...event.body],
          },
        ],
      };
  }
};

export interface LoopsResult {
  backEdges: Array<{ from: number; to: number }>;
  loops: NaturalLoop[];
}

export function projectLoops(result: LoopsResult): LoopsState {
  return { backEdges: result.backEdges, loops: result.loops, building: null };
}

/** Blocks reachable from the entry pseudo-node (guards odd unreachable code). */
export function reachableBlocks(cfg: Cfg): Set<number> {
  const seen = new Set<number>();
  const work: number[] = [];
  for (const s of successors(cfg, ENTRY)) if (s >= 0) work.push(s);
  while (work.length > 0) {
    const b = work.shift()!; // FIFO for determinism
    if (seen.has(b)) continue;
    seen.add(b);
    for (const s of successors(cfg, b)) if (s >= 0 && !seen.has(s)) work.push(s);
  }
  return seen;
}

/**
 * Find back edges (§9.6.4) and their natural loops (Algorithm 9.46).
 * Edges are examined in CFG edge order (which is block-id order); the loop
 * body worklist is FIFO with predecessors visited in ascending id order.
 */
export function* findLoops(cfg: Cfg, doms?: DominatorsResult): Steps<LoopsEvent, LoopsResult> {
  const d = doms ?? solveDominators(cfg);
  const reachable = reachableBlocks(cfg);
  const backEdges: Array<{ from: number; to: number }> = [];
  const loops: NaturalLoop[] = [];

  const backEdgeCite: StepMeta['cite'] = {
    section: '9.6.4',
    rule: 'An edge a → b is a back edge if its head b dominates its tail a',
  };
  const loopCite = (rule?: string): StepMeta['cite'] => ({
    section: '9.6.6',
    figureOrAlgo: 'Algorithm 9.46',
    ...(rule ? { rule } : {}),
  });

  for (const e of cfg.edges) {
    if (e.from < 0 || e.to < 0) continue;
    if (!reachable.has(e.from) || !reachable.has(e.to)) continue;
    if (!dominates(d, e.to, e.from)) continue;
    backEdges.push({ from: e.from, to: e.to });
    yield [
      { kind: 'back-edge', from: e.from, to: e.to },
      {
        cite: backEdgeCite,
        prose: `Edge B${e.from} → B${e.to} is a back edge because its head B${e.to} dominates its tail B${e.from} (B${e.to} ∈ D(B${e.from})).`,
        level: 'macro',
        section: 'Back edges',
        irRefs: [
          { kind: 'block', id: e.from },
          { kind: 'block', id: e.to },
        ],
      },
    ];
  }

  for (const be of backEdges) {
    const header = be.to;
    const section = `Natural loop of B${be.from} → B${header}`;
    const groupId = `loop-${be.from}-${header}`;
    const loop = new Set<number>([header]);
    yield [
      { kind: 'loop-node-added', header, backEdgeFrom: be.from, node: header },
      {
        cite: loopCite('loop = {b}; the header is always in the natural loop'),
        prose: `Start the natural loop of back edge B${be.from} → B${header} with its header B${header}.`,
        level: 'micro',
        section,
        groupId,
        irRefs: [{ kind: 'block', id: header }],
      },
    ];

    // Algorithm 9.46: stack := ∅; insert(a); insert pushes unseen nodes and
    // then, popping, inserts each predecessor. FIFO here keeps id-order
    // determinism; membership (not order) defines the loop.
    const work: number[] = [];
    const pushNode = (m: number): boolean => {
      if (loop.has(m)) return false;
      loop.add(m);
      work.push(m);
      return true;
    };
    if (pushNode(be.from)) {
      yield [
        { kind: 'loop-node-added', header, backEdgeFrom: be.from, node: be.from },
        {
          cite: loopCite('insert(a): the tail of the back edge is in the loop'),
          prose: `Add B${be.from}, the tail of the back edge, to the loop.`,
          level: 'micro',
          section,
          groupId,
          irRefs: [{ kind: 'block', id: be.from }],
        },
      ];
    }
    while (work.length > 0) {
      const m = work.shift()!;
      for (const p of predecessors(cfg, m).filter((x) => x >= 0)) {
        if (pushNode(p)) {
          yield [
            { kind: 'loop-node-added', header, backEdgeFrom: be.from, node: p },
            {
              cite: loopCite('while stack not empty: pop m; insert each predecessor of m'),
              prose: `Add B${p} because it is a predecessor of loop node B${m} and can reach the back edge's tail without passing through the header.`,
              level: 'micro',
              section,
              groupId,
              irRefs: [{ kind: 'block', id: p }],
            },
          ];
        }
      }
    }

    const body = [...loop].sort((a, b) => a - b);
    loops.push({ header, backEdge: { from: be.from, to: header }, body });
    yield [
      { kind: 'loop-found', header, backEdgeFrom: be.from, body: [...body] },
      {
        cite: loopCite(),
        prose: `The natural loop of back edge B${be.from} → B${header} is {${body
          .map((b) => `B${b}`)
          .join(', ')}}: the header plus every node that can reach B${be.from} without going through B${header}.`,
        level: 'macro',
        section,
        groupId,
      },
    ];
  }

  return { backEdges, loops };
}

export function runFindLoops(cfg: Cfg, doms?: DominatorsResult): Recorded<LoopsState, LoopsEvent, LoopsResult> {
  return record(() => findLoops(cfg, doms), initialLoopsState, loopsReducer, {
    id: `opt.loops.${cfg.functionName}`,
  });
}

/** Untraced convenience for passes. */
export function solveLoops(cfg: Cfg, doms?: DominatorsResult): LoopsResult {
  const gen = findLoops(cfg, doms);
  let it = gen.next();
  while (!it.done) it = gen.next();
  return it.value;
}
