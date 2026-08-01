/**
 * Register-interference graph construction (§8.8.4): nodes are the function's
 * pseudo-registers; an edge connects two nodes if one is defined at a point
 * where the other is live (def × live-out per instruction).
 *
 * Copy instructions get the standard Chaitin move-related exception: for
 * `movq a, b` the definition of b does NOT interfere with its source a (both
 * hold the same value), so a and b may share a register — this is what makes
 * coalescing-style assignments possible.
 *
 * Physical GP registers pinned by the tiles (argument registers, %rax/%rdx
 * around division) are treated as precolored: a pseudo whose live range
 * overlaps a pinned register's definition (or vice versa) is forbidden that
 * color rather than getting a graph node.
 */

import type { Recorded, Reducer, Steps, StepMeta } from '@lab/trace';
import { record } from '@lab/trace';
import { GP_REGISTERS } from './types.js';
import type { GpRegister, RaNode } from './types.js';
import type {
  FunctionLiveness,
  InterferenceEvent,
  InterferenceResult,
  IselResult,
  VInstr,
} from './cg-events.js';
import { cmpName, drainSteps, edgeKey } from './cg-events.js';
import { moveOf, useDef } from './liveness.js';

export type { InterferenceEvent, InterferenceResult } from './cg-events.js';

function cite(section: string, rule?: string): StepMeta['cite'] {
  const c: StepMeta['cite'] = { section };
  if (rule !== undefined) c.rule = rule;
  return c;
}

const GP_SET = new Set<string>(GP_REGISTERS);

export interface InterferenceInput {
  name: string;
  code: VInstr[];
  pseudos: RaNode[];
}

// ---------------------------------------------------------------------------
// The traced algorithm (per function)
// ---------------------------------------------------------------------------

export function* interferenceForFunction(
  fn: InterferenceInput,
  liveness: FunctionLiveness,
): Steps<InterferenceEvent, InterferenceResult> {
  const nodes = [...fn.pseudos].sort((a, b) => cmpName(a.id, b.id));
  const nodeSet = new Set(nodes.map((n) => n.id));

  yield [
    { kind: 'fnStart', functionName: fn.name, nodes },
    {
      cite: cite('8.8.4', 'construct a register-interference graph: nodes are symbolic registers'),
      prose: `Build the interference graph of '${fn.name}': ${nodes.length} pseudo-register node(s); scan each instruction's definition against its live-out set.`,
      level: 'macro',
      section: `${fn.name}: interference`,
    },
  ];

  const edgeSet = new Set<string>();
  const edges: Array<{ a: string; b: string }> = [];
  const forbidden = new Map<string, Set<GpRegister>>();
  const moveSet = new Set<string>();
  const moves: Array<{ a: string; b: string }> = [];

  for (let i = 0; i < fn.code.length; i++) {
    const instr = fn.code[i]!;
    const ud = useDef(instr);
    const liveOut = liveness.liveOut[i] ?? [];
    const mv = moveOf(instr);

    if (mv && nodeSet.has(mv.src) && nodeSet.has(mv.dst) && mv.src !== mv.dst) {
      const k = `${edgeKey(mv.src, mv.dst).a}|${edgeKey(mv.src, mv.dst).b}`;
      if (!moveSet.has(k)) {
        moveSet.add(k);
        moves.push(edgeKey(mv.src, mv.dst));
        yield [
          { kind: 'movePair', functionName: fn.name, a: edgeKey(mv.src, mv.dst).a, b: edgeKey(mv.src, mv.dst).b, atIndex: i },
          {
            cite: cite('8.8.4', 'copy instructions relate two symbolic registers that may share a color'),
            prose: `Instruction ${i} is a copy between ${mv.src} and ${mv.dst}: the pair is move-related.`,
            level: 'micro',
            groupId: `${fn.name}:interf`,
            section: `${fn.name}: interference`,
          },
        ];
      }
    }

    for (const d of ud.def) {
      const dIsNode = nodeSet.has(d);
      const dIsGp = GP_SET.has(d);
      if (!dIsNode && !dIsGp) continue; // %rax/%rdx and untracked names
      for (const l of liveOut) {
        if (l === d) continue;
        if (mv && l === mv.src) {
          // Chaitin's move-related exception: a copy's target does not
          // interfere with its source — they hold the same value.
          if (dIsNode || (dIsGp && nodeSet.has(l))) {
            yield [
              { kind: 'moveException', functionName: fn.name, def: d, src: mv.src, atIndex: i },
              {
                cite: cite('8.8.4', "move-related exception (Chaitin): for a copy x ← y, x and y hold the same value, so no edge x—y is added"),
                prose: `Instruction ${i} copies ${mv.src} into ${d}; the source stays live but no interference is recorded (move-related exception).`,
                level: 'micro',
                groupId: `${fn.name}:interf`,
                section: `${fn.name}: interference`,
              },
            ];
          }
          continue;
        }
        if (dIsNode && nodeSet.has(l)) {
          const e = edgeKey(d, l);
          const k = `${e.a}|${e.b}`;
          if (edgeSet.has(k)) continue;
          edgeSet.add(k);
          edges.push(e);
          yield [
            { kind: 'edge', functionName: fn.name, a: e.a, b: e.b, atIndex: i, def: d, liveOut },
            {
              cite: cite('8.8.4', 'an edge connects two nodes if one is live at a point where the other is defined'),
              prose: `Instruction ${i} defines ${d} while ${l} is live-out ⇒ edge ${e.a} — ${e.b}.`,
              level: 'micro',
              groupId: `${fn.name}:interf`,
              section: `${fn.name}: interference`,
            },
          ];
        } else if (dIsNode && GP_SET.has(l)) {
          const reg = l as GpRegister;
          const set = forbidden.get(d) ?? new Set<GpRegister>();
          if (!set.has(reg)) {
            set.add(reg);
            forbidden.set(d, set);
            yield [
              { kind: 'forbid', functionName: fn.name, node: d, reg, atIndex: i },
              {
                cite: cite('8.8.4', 'machine registers participate as precolored nodes: a symbolic register interfering with one cannot receive its color'),
                prose: `Instruction ${i} defines ${d} while physical ${reg} is live ⇒ ${d} must not be colored ${reg}.`,
                level: 'micro',
                groupId: `${fn.name}:interf`,
                section: `${fn.name}: interference`,
              },
            ];
          }
        } else if (dIsGp && nodeSet.has(l)) {
          const reg = d as GpRegister;
          const set = forbidden.get(l) ?? new Set<GpRegister>();
          if (!set.has(reg)) {
            set.add(reg);
            forbidden.set(l, set);
            yield [
              { kind: 'forbid', functionName: fn.name, node: l, reg, atIndex: i },
              {
                cite: cite('8.8.4', 'machine registers participate as precolored nodes: defining one clobbers any symbolic register sharing its color'),
                prose: `Instruction ${i} writes physical ${reg} while ${l} is live-out ⇒ ${l} must not be colored ${reg}.`,
                level: 'micro',
                groupId: `${fn.name}:interf`,
                section: `${fn.name}: interference`,
              },
            ];
          }
        }
      }
    }
  }

  edges.sort((x, y) => cmpName(x.a, y.a) || cmpName(x.b, y.b));
  moves.sort((x, y) => cmpName(x.a, y.a) || cmpName(x.b, y.b));
  const forbiddenRec: Record<string, GpRegister[]> = {};
  for (const id of [...forbidden.keys()].sort(cmpName)) {
    forbiddenRec[id] = [...forbidden.get(id)!].sort(cmpName);
  }

  const result: InterferenceResult = {
    graph: { functionName: fn.name, nodes, edges },
    forbidden: forbiddenRec,
    moves,
  };

  yield [
    { kind: 'fnDone', functionName: fn.name, edgeCount: edges.length },
    {
      cite: cite('8.8.4', 'the interference graph summarizes all simultaneous-liveness constraints'),
      prose: `Interference graph of '${fn.name}' complete: ${nodes.length} node(s), ${edges.length} edge(s), ${Object.keys(forbiddenRec).length} precolor-constrained node(s).`,
      level: 'macro',
      section: `${fn.name}: interference`,
    },
  ];

  return result;
}

/** Traced interference construction for every function. */
export function* buildInterference(
  isel: IselResult,
  liveness: FunctionLiveness[],
): Steps<InterferenceEvent, InterferenceResult[]> {
  const out: InterferenceResult[] = [];
  for (let i = 0; i < isel.functions.length; i++) {
    const fn = isel.functions[i]!;
    const live = liveness.find((l) => l.functionName === fn.name);
    if (!live) throw new Error(`no liveness for function '${fn.name}'`);
    out.push(
      yield* interferenceForFunction({ name: fn.name, code: fn.code, pseudos: fn.pseudos }, live),
    );
  }
  yield [
    { kind: 'done' },
    {
      cite: cite('8.8.4', 'interference graphs built for all functions'),
      prose: `Interference graphs built for ${out.length} function(s).`,
      level: 'macro',
      section: 'Done',
    },
  ];
  return out;
}

/** Untraced reuse of the exact traced algorithm (for spill-retry rounds). */
export function computeInterference(
  fn: InterferenceInput,
  liveness: FunctionLiveness,
): InterferenceResult {
  return drainSteps(interferenceForFunction(fn, liveness));
}

// ---------------------------------------------------------------------------
// UI state + reducer
// ---------------------------------------------------------------------------

export interface InterferenceState {
  functions: InterferenceResult[];
  done: boolean;
}

export function initialInterferenceState(): InterferenceState {
  return { functions: [], done: false };
}

export const interferenceReducer: Reducer<InterferenceState, InterferenceEvent> = (s, e) => {
  const withLast = (
    f: (last: InterferenceResult) => InterferenceResult,
  ): InterferenceState => {
    const fns = [...s.functions];
    const last = fns[fns.length - 1];
    if (!last) return s;
    fns[fns.length - 1] = f(last);
    return { ...s, functions: fns };
  };
  switch (e.kind) {
    case 'fnStart':
      return {
        ...s,
        functions: [
          ...s.functions,
          { graph: { functionName: e.functionName, nodes: e.nodes, edges: [] }, forbidden: {}, moves: [] },
        ],
      };
    case 'edge':
      return withLast((last) => ({
        ...last,
        graph: { ...last.graph, edges: [...last.graph.edges, { a: e.a, b: e.b }] },
      }));
    case 'forbid':
      return withLast((last) => {
        const prev = last.forbidden[e.node] ?? [];
        return { ...last, forbidden: { ...last.forbidden, [e.node]: [...prev, e.reg] } };
      });
    case 'movePair':
      return withLast((last) => ({ ...last, moves: [...last.moves, { a: e.a, b: e.b }] }));
    case 'moveException':
      return s;
    case 'fnDone':
      return withLast((last) => {
        const edges = [...last.graph.edges].sort((x, y) => cmpName(x.a, y.a) || cmpName(x.b, y.b));
        const moves = [...last.moves].sort((x, y) => cmpName(x.a, y.a) || cmpName(x.b, y.b));
        const forbidden: Record<string, GpRegister[]> = {};
        for (const k of Object.keys(last.forbidden).sort(cmpName)) {
          forbidden[k] = [...last.forbidden[k]!].sort(cmpName);
        }
        return { graph: { ...last.graph, edges }, forbidden, moves };
      });
    case 'done':
      return { ...s, done: true };
  }
};

export function projectInterference(r: InterferenceResult[]): InterferenceState {
  return { functions: r, done: true };
}

/** Convenience: record an interference-graph trace. */
export function runInterference(
  isel: IselResult,
  liveness: FunctionLiveness[],
  id = 'codegen.interference',
): Recorded<InterferenceState, InterferenceEvent, InterferenceResult[]> {
  return record(
    () => buildInterference(isel, liveness),
    initialInterferenceState(),
    interferenceReducer,
    { id },
  );
}
