/**
 * Register allocation by graph coloring — the Kempe/Chaitin simplify–select
 * heuristic exactly as §8.8.4 presents it, with K = |GP_REGISTERS| = 8:
 *
 *   simplify: repeatedly remove a node with degree < K from the graph and
 *             push it on a stack (it can always be colored later);
 *   stuck:    when every remaining node has degree ≥ K, choose a potential
 *             spill (highest degree, ties broken by name) and push it anyway
 *             (optimistic — it may still find a color);
 *   select:   pop nodes and give each the lowest-numbered register not used
 *             by an already-colored neighbor (nor forbidden by a precolored
 *             physical register);
 *   spill:    a node that finds no color gets a stack slot; loads/stores are
 *             inserted around every use/def and the whole allocation is
 *             RETRIED on the rewritten code (the fresh scratch temps have tiny
 *             live ranges, so this normally converges in round 2).
 *
 * K is a parameter: colorFunction/allocateRegisters take it, SELECT colours
 * from GP_REGISTERS.slice(0, K), and lowering it is how the lab demonstrates
 * spilling on a small program.
 */

import type { Recorded, Reducer, Steps, StepMeta } from '@lab/trace';
import { record } from '@lab/trace';
import { GP_REGISTERS } from './types.js';
import type { GpRegister, RaNode, RegisterAssignment } from './types.js';
import type {
  ColorEvent,
  ColorOutcome,
  FrameInfo,
  IselResult,
  VFunction,
  VInstr,
  VOperand,
} from './cg-events.js';
import { cmpName, drainSteps, sortedNames } from './cg-events.js';
import { computeLiveness, useDef } from './liveness.js';
import { computeInterference } from './interference.js';

export type { ColorEvent, ColorOutcome } from './cg-events.js';

/**
 * Spill rounds allowed before we give up. Each round rewrites spilled values
 * with fresh scratch temps around every use/def, so a round can introduce new
 * (short-lived) pseudos; with a realistic K this settles in one or two rounds.
 * Very small K (1–2) can genuinely fail to converge — a three-address
 * instruction may need more simultaneously-live scratch registers than exist —
 * and that failure is reported rather than looped on.
 */
const MAX_ROUNDS = 10;

function cite(section: string, rule?: string): StepMeta['cite'] {
  const c: StepMeta['cite'] = { section };
  if (rule !== undefined) c.rule = rule;
  return c;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneInstr(i: VInstr): VInstr {
  return JSON.parse(JSON.stringify(i)) as VInstr;
}

const FIXED_BASES = new Set(['%rbp', '%rsp', '%rip']);

/** Pseudo-registers appearing in the code, first-occurrence order. */
function pseudosIn(code: VInstr[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const add = (n: string) => {
    if (!n.startsWith('%') && !seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  };
  for (const i of code) {
    for (const o of i.operands) {
      if (o.k === 'pseudo') add(o.name);
      else if (o.k === 'mem') {
        if (o.base !== null && !FIXED_BASES.has(o.base)) add(o.base);
        if (o.index !== undefined && !FIXED_BASES.has(o.index)) add(o.index);
      }
    }
  }
  return order;
}

function instrReferences(i: VInstr, name: string): boolean {
  for (const o of i.operands) {
    if (o.k === 'pseudo' && o.name === name) return true;
    if (o.k === 'mem' && (o.base === name || o.index === name)) return true;
  }
  return false;
}

function renameIn(i: VInstr, from: string, to: string): void {
  for (const o of i.operands) {
    if (o.k === 'pseudo' && o.name === from) o.name = to;
    else if (o.k === 'mem') {
      if (o.base === from) o.base = to;
      if (o.index === from) o.index = to;
    }
  }
}

// ---------------------------------------------------------------------------
// The traced algorithm (per function)
// ---------------------------------------------------------------------------

export function* colorFunction(vfn: VFunction, k: number): Steps<ColorEvent, ColorOutcome> {
  let code = vfn.code.map(cloneInstr);
  const frame: FrameInfo = {
    slots: vfn.frame.slots.map((s) => ({ ...s })),
    size: vfn.frame.size,
  };
  let tempCounter = vfn.tempCounter;
  const floatSet = new Set(vfn.floatPseudos.map((f) => f.name));
  const kindOf = new Map(vfn.pseudos.map((n) => [n.id, n.kind]));
  const spillSlotOf = new Map<string, number>(); // node → rbp offset

  yield [
    { kind: 'fnStart', functionName: vfn.name, k },
    {
      cite: cite('8.8.4', 'register allocation by graph coloring with k physical registers'),
      prose: `Color the interference graph of '${vfn.name}' with K = ${k} register(s) (${GP_REGISTERS.slice(0, Math.max(1, k)).join(', ')}).`,
      level: 'macro',
      section: `${vfn.name}: coloring`,
    },
  ];

  let rounds = 0;
  let assignment = new Map<string, GpRegister>();
  /** The K colors this run may use — K is a real constraint, not just a
   *  simplify-phase heuristic, so SELECT picks from this pool (§8.8.4). */
  const palette: readonly GpRegister[] = GP_REGISTERS.slice(0, Math.max(1, k));

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    rounds = round;
    // (Re)analyze the current code — untraced reuse of the traced algorithms.
    const nodes: RaNode[] = pseudosIn(code)
      .filter((n) => !floatSet.has(n))
      .map((id) => ({ id, kind: kindOf.get(id) ?? 'temp' }))
      .sort((a, b) => cmpName(a.id, b.id));
    const liveness = computeLiveness(vfn.name, code);
    const interf = computeInterference({ name: vfn.name, code, pseudos: nodes }, liveness);

    yield [
      { kind: 'roundStart', functionName: vfn.name, round, nodeCount: nodes.length, edgeCount: interf.graph.edges.length },
      {
        cite: cite('8.8.4', round === 1 ? 'color the interference graph of the function' : 'after spill code is inserted, the process is repeated on the modified code'),
        prose: round === 1
          ? `Round 1: ${nodes.length} node(s), ${interf.graph.edges.length} interference edge(s).`
          : `Round ${round}: liveness and interference recomputed on the spill-rewritten code (${nodes.length} node(s), ${interf.graph.edges.length} edge(s)).`,
        level: 'macro',
        section: `${vfn.name}: coloring round ${round}`,
      },
    ];

    // Adjacency
    const adj = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set<string>()]));
    for (const e of interf.graph.edges) {
      adj.get(e.a)?.add(e.b);
      adj.get(e.b)?.add(e.a);
    }

    // --- simplify phase ---
    const removed = new Set<string>();
    const stack: Array<{ node: string; potentialSpill: boolean }> = [];
    const degreeOf = (n: string): number => {
      let d = 0;
      for (const m of adj.get(n) ?? []) if (!removed.has(m)) d++;
      return d;
    };
    while (removed.size < nodes.length) {
      let picked: string | null = null;
      for (const n of nodes) {
        if (!removed.has(n.id) && degreeOf(n.id) < k) {
          picked = n.id;
          break;
        }
      }
      if (picked !== null) {
        const deg = degreeOf(picked);
        removed.add(picked);
        stack.push({ node: picked, potentialSpill: false });
        yield [
          { kind: 'simplifyPush', functionName: vfn.name, node: picked, degree: deg, remaining: nodes.length - removed.size },
          {
            cite: cite('8.8.4', 'a node with fewer than k neighbors can always be colored: remove it and color the rest first'),
            prose: `Simplify: '${picked}' has degree ${deg} < ${k}, so it is removed and pushed on the stack (${nodes.length - removed.size} node(s) remain).`,
            level: 'micro',
            groupId: `${vfn.name}:simplify${round}`,
            section: `${vfn.name}: coloring round ${round}`,
          },
        ];
      } else {
        // stuck: every remaining node has degree >= k — potential spill.
        let cand: string | null = null;
        let candDeg = -1;
        for (const n of nodes) {
          if (removed.has(n.id)) continue;
          const d = degreeOf(n.id);
          if (d > candDeg) {
            cand = n.id;
            candDeg = d;
          } // ties: first in sorted node order wins (deterministic by name)
        }
        removed.add(cand!);
        stack.push({ node: cand!, potentialSpill: true });
        yield [
          { kind: 'spillCandidate', functionName: vfn.name, node: cand!, degree: candDeg },
          {
            cite: cite('8.8.4', 'when every node has k or more neighbors, a node is chosen to spill — heuristic: highest degree (most constrained, frees the most edges)'),
            prose: `Stuck: every remaining node has degree ≥ ${k}. '${cand}' (degree ${candDeg}, ties broken by name) is marked a potential spill and pushed anyway — it may still find a color.`,
            level: 'macro',
            section: `${vfn.name}: coloring round ${round}`,
          },
        ];
      }
    }

    // --- select phase ---
    assignment = new Map<string, GpRegister>();
    const spilledNow: string[] = [];
    while (stack.length > 0) {
      const { node } = stack.pop()!;
      const forbid = new Set<string>(interf.forbidden[node] ?? []);
      for (const m of adj.get(node) ?? []) {
        const r = assignment.get(m);
        if (r !== undefined) forbid.add(r);
      }
      const forbiddenColors = sortedNames(forbid);
      const chosen = palette.find((r) => !forbid.has(r));
      if (chosen !== undefined) {
        assignment.set(node, chosen);
        yield [
          { kind: 'select', functionName: vfn.name, node, forbiddenColors, chosen },
          {
            cite: cite('8.8.4', 'pop a node and assign it a color not used by any of its neighbors'),
            prose: `Select: '${node}' — neighbors/precoloring forbid {${forbiddenColors.join(', ')}}; assign the lowest-numbered free register ${chosen}.`,
            level: 'micro',
            groupId: `${vfn.name}:select${round}`,
            section: `${vfn.name}: coloring round ${round}`,
          },
        ];
      } else {
        frame.size += 8;
        const slot = -frame.size;
        frame.slots.push({ name: node, offset: slot, size: 8, reason: 'spill' });
        spillSlotOf.set(node, slot);
        spilledNow.push(node);
        yield [
          { kind: 'actualSpill', functionName: vfn.name, node, forbiddenColors, spillSlot: slot },
          {
            cite: cite('8.8.4', 'a node that cannot be colored is spilled: its value lives in memory'),
            prose: `Actual spill: '${node}' has no free color (all of {${forbiddenColors.join(', ')}} taken); it gets stack slot ${slot}(%rbp).`,
            level: 'macro',
            section: `${vfn.name}: coloring round ${round}`,
          },
        ];
      }
    }

    if (spilledNow.length === 0) break;
    if (round === MAX_ROUNDS) {
      throw new Error(
        `register allocation for '${vfn.name}' did not converge in ${MAX_ROUNDS} rounds with K = ${k}: spilling keeps introducing values that do not fit. Raise K.`,
      );
    }

    // --- spill rewriting: loads/stores around every use/def ---
    const spillSet = new Set(spilledNow);
    const newCode: VInstr[] = [];
    for (let i = 0; i < code.length; i++) {
      const instr = code[i]!;
      const touching = sortedNames(
        pseudosIn([instr]).filter((n) => spillSet.has(n)),
      );
      if (touching.length === 0) {
        newCode.push(instr);
        continue;
      }
      const ud = useDef(instr);
      const rewritten = cloneInstr(instr);
      const post: VInstr[] = [];
      for (const s of touching) {
        const scratch = `t${tempCounter++}`;
        const slot = spillSlotOf.get(s)!;
        const slotMem: VOperand = { k: 'mem', base: '%rbp', offset: slot };
        const used = ud.use.includes(s);
        const defined = ud.def.includes(s);
        renameIn(rewritten, s, scratch);
        let loads = 0;
        let stores = 0;
        if (used) {
          const ld: VInstr = { kind: 'instr', mnemonic: 'movq', operands: [slotMem, { k: 'pseudo', name: scratch }], tacIndex: instr.tacIndex, spillOf: s };
          newCode.push(ld);
          loads = 1;
        }
        if (defined) {
          const st: VInstr = { kind: 'instr', mnemonic: 'movq', operands: [{ k: 'pseudo', name: scratch }, { k: 'mem', base: '%rbp', offset: slot }], tacIndex: instr.tacIndex, spillOf: s };
          post.push(st);
          stores = 1;
        }
        yield [
          { kind: 'spillRewrite', functionName: vfn.name, node: s, atIndex: i, scratch, loads, stores },
          {
            cite: cite('8.8.4', 'spill code: a load before each use and a store after each definition of the spilled value'),
            prose: `Rewrite instruction ${i}: spilled '${s}' is ${used ? `loaded from ${spillSlotOf.get(s)}(%rbp) into scratch '${scratch}'` : ''}${used && defined ? ' and ' : ''}${defined ? `stored back to ${spillSlotOf.get(s)}(%rbp) after its definition` : ''}.`,
            level: 'micro',
            groupId: `${vfn.name}:rewrite${round}`,
            section: `${vfn.name}: coloring round ${round}`,
          },
        ];
      }
      newCode.push(rewritten, ...post);
    }
    code = newCode;
  }

  // Final RegisterAssignment: registers for the surviving pseudos, slots for
  // every spilled pseudo.
  const assignmentRec: RegisterAssignment['assignment'] = {};
  for (const id of sortedNames(assignment.keys())) {
    assignmentRec[id] = { reg: assignment.get(id)! };
  }
  for (const id of sortedNames(spillSlotOf.keys())) {
    assignmentRec[id] = { spillSlot: spillSlotOf.get(id)! };
  }
  const ra: RegisterAssignment = {
    functionName: vfn.name,
    assignment: assignmentRec,
    spilled: sortedNames(spillSlotOf.keys()),
  };

  yield [
    { kind: 'fnDone', functionName: vfn.name, rounds, assignment: ra },
    {
      cite: cite('8.8.4', 'every symbolic register now has a physical register or a memory location'),
      prose: `'${vfn.name}' allocated in ${rounds} round(s): ${Object.values(assignmentRec).filter((a) => 'reg' in a).length} pseudo(s) in registers, ${ra.spilled.length} spilled.`,
      level: 'macro',
      section: `${vfn.name}: coloring`,
    },
  ];

  return { assignment: ra, rounds, finalCode: code, frame, tempCounter };
}

/** Traced allocation for every function of the selected program. */
export function* allocateRegisters(
  isel: IselResult,
  k: number = GP_REGISTERS.length,
): Steps<ColorEvent, ColorOutcome[]> {
  const out: ColorOutcome[] = [];
  for (const fn of isel.functions) {
    out.push(yield* colorFunction(fn, k));
  }
  yield [
    { kind: 'done' },
    {
      cite: cite('8.8.4', 'register allocation complete'),
      prose: `Register allocation complete for ${out.length} function(s).`,
      level: 'macro',
      section: 'Done',
    },
  ];
  return out;
}

/** Untraced allocation (for the pipeline convenience function). */
export function computeAllocation(isel: IselResult, k: number = GP_REGISTERS.length): ColorOutcome[] {
  return drainSteps(allocateRegisters(isel, k));
}

// ---------------------------------------------------------------------------
// UI state + reducer
// ---------------------------------------------------------------------------

export interface ColorFnState {
  functionName: string;
  rounds: number;
  /** Simplify/select working stack (empty once the function is done). */
  stack: string[];
  assignment: RegisterAssignment['assignment'];
  spilled: string[];
}

export interface ColorState {
  functions: ColorFnState[];
  done: boolean;
}

export function initialColorState(): ColorState {
  return { functions: [], done: false };
}

export const colorReducer: Reducer<ColorState, ColorEvent> = (s, e) => {
  const withLast = (f: (last: ColorFnState) => ColorFnState): ColorState => {
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
          { functionName: e.functionName, rounds: 0, stack: [], assignment: {}, spilled: [] },
        ],
      };
    case 'roundStart':
      return withLast((last) => ({ ...last, rounds: e.round, stack: [], assignment: {} }));
    case 'simplifyPush':
    case 'spillCandidate':
      return withLast((last) => ({ ...last, stack: [...last.stack, e.node] }));
    case 'select':
      return withLast((last) => ({
        ...last,
        stack: last.stack.slice(0, -1),
        assignment: { ...last.assignment, [e.node]: { reg: e.chosen } },
      }));
    case 'actualSpill':
      return withLast((last) => ({
        ...last,
        stack: last.stack.slice(0, -1),
        assignment: { ...last.assignment, [e.node]: { spillSlot: e.spillSlot } },
        spilled: [...last.spilled, e.node].sort(cmpName),
      }));
    case 'spillRewrite':
      return s;
    case 'fnDone':
      return withLast(() => ({
        functionName: e.functionName,
        rounds: e.rounds,
        stack: [],
        assignment: e.assignment.assignment,
        spilled: e.assignment.spilled,
      }));
    case 'done':
      return { ...s, done: true };
  }
};

export function projectColor(r: ColorOutcome[]): ColorState {
  return {
    functions: r.map((o) => ({
      functionName: o.assignment.functionName,
      rounds: o.rounds,
      stack: [],
      assignment: o.assignment.assignment,
      spilled: o.assignment.spilled,
    })),
    done: true,
  };
}

/** Convenience: record a register-allocation trace. */
export function runColor(
  isel: IselResult,
  k: number = GP_REGISTERS.length,
  id = 'codegen.color',
): Recorded<ColorState, ColorEvent, ColorOutcome[]> {
  return record(() => allocateRegisters(isel, k), initialColorState(), colorReducer, { id });
}
