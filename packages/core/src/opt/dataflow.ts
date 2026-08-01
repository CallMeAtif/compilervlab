/**
 * Iterative data-flow analysis framework — Dragon Book (2nd ed.) §9.3
 * (round-robin iterative algorithm in the style of Algorithm 9.11), with the
 * three classic instantiations:
 *   - reaching definitions  (§9.2.4, Algorithm 9.11: forward, meet = union)
 *   - live variables        (§9.2.5: backward, meet = union)
 *   - available expressions (§9.2.6: forward, meet = intersection)
 *
 * Sets are represented as sorted arrays of string ids (JSON-safe, canonical).
 * Determinism: forward problems visit blocks in ascending id order; backward
 * problems in descending id order; predecessors/successors are visited sorted.
 */
import type { Quad, TacFunction, TacOperand } from '../ir/types.js';
import { formatQuad } from '../ir/types.js';
import type { Reducer, Recorded, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { Cfg } from './types.js';
import { ENTRY, EXIT, predecessors, successors } from './cfg.js';

// ---------------------------------------------------------------------------
// Operand / definition / expression helpers (shared with the passes)
// ---------------------------------------------------------------------------

/** True when a varKey names a temp ("t" + digits). */
export function isTempName(v: string): boolean {
  return /^t\d+$/.test(v);
}

/** Canonical key for an assignable operand: variables by name, temps as tN. */
export function varKey(o: TacOperand): string | null {
  if (o.kind === 'var') return o.name;
  if (o.kind === 'temp') return `t${o.id}`;
  return null;
}

/** Ops whose result operand is a scalar definition (assignment). */
const DEFINING_OPS = new Set<string>([
  '+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=',
  'neg', 'not', 'copy', 'inttofloat', 'index-load', 'addr', 'deref-load',
]);

/** Variable/temp defined by a quad, or null. `x = call p, n` also defines x. */
export function definedVar(q: Quad): string | null {
  if (DEFINING_OPS.has(q.op) || (q.op === 'call' && q.result !== null)) {
    return q.result ? varKey(q.result) : null;
  }
  return null;
}

/** Variables/temps whose VALUES a quad reads, in operand order (may repeat). */
export function usedVars(q: Quad): string[] {
  const out: string[] = [];
  const push = (o: TacOperand | null) => {
    if (!o) return;
    const k = varKey(o);
    if (k !== null) out.push(k);
  };
  switch (q.op) {
    case 'label':
    case 'goto':
      return out;
    case 'if':
    case 'iffalse':
    case 'param':
    case 'return':
      push(q.arg1);
      return out;
    case 'ifrel':
      push(q.arg1);
      push(q.arg2);
      return out;
    case 'call':
      // arg1 names the callee (not a scalar value use), arg2 is the arg count.
      return out;
    case 'index-store':
      // x [ i ] = y : uses x (base), i, and y.
      push(q.arg1);
      push(q.arg2);
      push(q.result);
      return out;
    case 'deref-store':
      // * x = y : uses pointer x and value y.
      push(q.arg1);
      push(q.result);
      return out;
    case 'addr':
      // x = & y takes y's address, it does not read y's value.
      return out;
    default:
      push(q.arg1);
      push(q.arg2);
      return out;
  }
}

/** Variables whose address is taken anywhere in the function ("x = & y"). */
export function addressTakenVars(fn: TacFunction): Set<string> {
  const s = new Set<string>();
  for (const q of fn.quads) {
    if (q.op === 'addr' && q.arg1) {
      const k = varKey(q.arg1);
      if (k !== null) s.add(k);
    }
  }
  return s;
}

/**
 * True when executing q may raise a runtime error in the lab's C-subset
 * semantics (docs/c-subset.md "Evaluation semantics"): division or remainder
 * by zero, and `%` on float operands. Such an instruction is NOT a pure value
 * computation — removing it, or executing it on a path where the original
 * program would not, changes the observable behaviour of the program. This is
 * the same decision const-fold.ts makes when it refuses to fold `1 / 0`.
 */
export function mayRaiseRuntimeError(q: Quad): boolean {
  if (q.op !== '/' && q.op !== '%') return false;
  const divisor = q.arg2;
  const divisorIsNonZeroConst = divisor !== null && divisor.kind === 'const' && divisor.value !== 0;
  if (!divisorIsNonZeroConst) return true; // the divisor may be 0
  if (q.op === '%') {
    // `%` additionally requires integer operands; only a constant operand can
    // be proven non-float, since values carry their float tag at run time.
    const isFloatConst = (o: TacOperand | null): boolean =>
      o !== null && o.kind === 'const' && o.ctype === 'float';
    if (isFloatConst(q.arg1) || isFloatConst(q.arg2)) return true;
    if (q.arg1 === null || q.arg1.kind !== 'const') return true;
  }
  return false;
}

/**
 * Ops with side effects beyond assigning their result (never dead code):
 * control flow, calls, stores, and — per §9.1.4's requirement that a removable
 * assignment "has no side effects" — any computation that may raise a runtime
 * error, since deleting it would erase that error.
 */
export function hasSideEffects(q: Quad): boolean {
  switch (q.op) {
    case 'label':
    case 'goto':
    case 'if':
    case 'iffalse':
    case 'ifrel':
    case 'param':
    case 'call':
    case 'return':
    case 'index-store':
    case 'deref-store':
      return true;
    default:
      return mayRaiseRuntimeError(q);
  }
}

/** Natural ordering for ids like "d2" < "d10"; plain strings sort lexically. */
export function compareIds(a: string, b: string): number {
  const re = /^([a-zA-Z_]*)(\d+)$/;
  const ma = re.exec(a);
  const mb = re.exec(b);
  if (ma && mb && ma[1] === mb[1]) return Number(ma[2]) - Number(mb[2]);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortSet(xs: Iterable<string>): string[] {
  return [...new Set(xs)].sort(compareIds);
}

export function union(a: string[], b: string[]): string[] {
  return sortSet([...a, ...b]);
}

export function intersection(a: string[], b: string[]): string[] {
  const sb = new Set(b);
  return a.filter((x) => sb.has(x));
}

export function difference(a: string[], b: string[]): string[] {
  const sb = new Set(b);
  return a.filter((x) => !sb.has(x));
}

export function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// ---------------------------------------------------------------------------
// Generic framework
// ---------------------------------------------------------------------------

export type DataflowDirection = 'forward' | 'backward';
export type DataflowMeet = 'union' | 'intersection';

/** A fully-instantiated gen/kill problem over string-id sets. */
export interface DataflowProblem {
  name: string;
  direction: DataflowDirection;
  meet: DataflowMeet;
  /** The full domain U, sorted. */
  domain: string[];
  /** gen/kill per block id (real blocks only). */
  gen: Record<string, string[]>;
  kill: Record<string, string[]>;
  /** Value at the boundary (OUT[ENTRY] for forward, IN[EXIT] for backward). */
  boundary: string[];
  /** Initial value for all interior blocks (∅ for union, U for intersection). */
  init: string[];
  cite: { section: string; figureOrAlgo?: string };
}

export interface DataflowResult {
  name: string;
  direction: DataflowDirection;
  meet: DataflowMeet;
  domain: string[];
  gen: Record<string, string[]>;
  kill: Record<string, string[]>;
  /** Converged IN/OUT per block id (keys are String(blockId), plus ENTRY/EXIT). */
  in: Record<string, string[]>;
  out: Record<string, string[]>;
  iterations: number;
}

export type DataflowEvent =
  | {
      kind: 'df-problem';
      name: string;
      direction: DataflowDirection;
      meet: DataflowMeet;
      domain: string[];
      gen: Record<string, string[]>;
      kill: Record<string, string[]>;
    }
  | {
      kind: 'df-init';
      boundaryBlock: number;
      boundary: string[];
      init: string[];
      /** The interior blocks that receive `init` (all real blocks). */
      blockIds: number[];
    }
  | { kind: 'df-iteration'; iteration: number }
  | {
      kind: 'df-update';
      iteration: number;
      blockId: number;
      in: string[];
      out: string[];
      changed: boolean;
    }
  | { kind: 'df-converged'; name: string; iterations: number };

export interface DataflowState {
  name: string;
  direction: DataflowDirection;
  meet: DataflowMeet;
  domain: string[];
  gen: Record<string, string[]>;
  kill: Record<string, string[]>;
  in: Record<string, string[]>;
  out: Record<string, string[]>;
  iterations: number;
  converged: boolean;
}

export const initialDataflowState: DataflowState = {
  name: '',
  direction: 'forward',
  meet: 'union',
  domain: [],
  gen: {},
  kill: {},
  in: {},
  out: {},
  iterations: 0,
  converged: false,
};

export const dataflowReducer: Reducer<DataflowState, DataflowEvent> = (state, event) => {
  switch (event.kind) {
    case 'df-problem':
      return {
        ...initialDataflowState,
        name: event.name,
        direction: event.direction,
        meet: event.meet,
        domain: event.domain,
        gen: event.gen,
        kill: event.kill,
      };
    case 'df-init': {
      const boundaryKey = String(event.boundaryBlock);
      if (state.direction === 'forward') {
        // OUT[ENTRY] = boundary; OUT[B] = init for every other block (∅ for a
        // union problem, U for an intersection one). ENTRY's IN is trivially
        // empty; IN[B] is not defined until the first meet computes it.
        const out: Record<string, string[]> = { ...state.out };
        for (const id of event.blockIds) out[String(id)] = [...event.init];
        out[boundaryKey] = event.boundary;
        return { ...state, out, in: { ...state.in, [boundaryKey]: [] } };
      }
      // IN[EXIT] = boundary; IN[B] = init elsewhere; EXIT's OUT is empty.
      const inn: Record<string, string[]> = { ...state.in };
      for (const id of event.blockIds) inn[String(id)] = [...event.init];
      inn[boundaryKey] = event.boundary;
      return { ...state, in: inn, out: { ...state.out, [boundaryKey]: [] } };
    }
    case 'df-iteration':
      return { ...state, iterations: event.iteration };
    case 'df-update': {
      const k = String(event.blockId);
      return {
        ...state,
        in: { ...state.in, [k]: event.in },
        out: { ...state.out, [k]: event.out },
      };
    }
    case 'df-converged':
      return { ...state, converged: true, iterations: event.iterations };
  }
};

export function projectDataflow(result: DataflowResult): DataflowState {
  return {
    name: result.name,
    direction: result.direction,
    meet: result.meet,
    domain: result.domain,
    gen: result.gen,
    kill: result.kill,
    in: result.in,
    out: result.out,
    iterations: result.iterations,
    converged: true,
  };
}

function meetSets(meet: DataflowMeet, domain: string[], values: string[][]): string[] {
  if (values.length === 0) return meet === 'union' ? [] : [...domain];
  return values.reduce((acc, v) => (meet === 'union' ? union(acc, v) : intersection(acc, v)));
}

/**
 * Round-robin iterative solver (Algorithm 9.11 style). Forward:
 *   OUT[ENTRY] = boundary; OUT[B] = init for all other B;
 *   repeat { for each B: IN[B] = ∧ over predecessors P of OUT[P];
 *            OUT[B] = gen_B ∪ (IN[B] − kill_B) } until no OUT changes.
 * Backward is the mirror image over successors, computing IN from OUT.
 */
export function* iterativeDataflow(cfg: Cfg, problem: DataflowProblem): Steps<DataflowEvent, DataflowResult> {
  const { direction, meet, domain, gen, kill, boundary, init } = problem;
  const cite: StepMeta['cite'] = {
    section: problem.cite.section,
    ...(problem.cite.figureOrAlgo ? { figureOrAlgo: problem.cite.figureOrAlgo } : {}),
  };

  yield [
    { kind: 'df-problem', name: problem.name, direction, meet, domain, gen, kill },
    {
      cite,
      prose: `Set up ${problem.name} as a ${direction} data-flow problem with meet = ${
        meet === 'union' ? '∪' : '∩'
      }: per-block gen and kill sets over a domain of ${domain.length} item(s).`,
      level: 'macro',
      section: 'Setup',
    },
  ];

  const IN: Record<string, string[]> = {};
  const OUT: Record<string, string[]> = {};
  const blockIds = cfg.blocks.map((b) => b.id);
  const forward = direction === 'forward';
  const boundaryBlock = forward ? ENTRY : EXIT;

  if (forward) {
    OUT[String(ENTRY)] = [...boundary];
    IN[String(ENTRY)] = [];
    for (const id of blockIds) OUT[String(id)] = [...init];
  } else {
    IN[String(EXIT)] = [...boundary];
    OUT[String(EXIT)] = [];
    for (const id of blockIds) IN[String(id)] = [...init];
  }

  yield [
    {
      kind: 'df-init',
      boundaryBlock,
      boundary: [...boundary],
      init: [...init],
      blockIds: [...blockIds],
    },
    {
      cite,
      prose: forward
        ? `Initialize OUT[ENTRY] = {${boundary.join(', ')}} and OUT[B] = ${
            meet === 'union' ? '∅' : 'U (the full domain)'
          } for every other block.`
        : `Initialize IN[EXIT] = {${boundary.join(', ')}} and IN[B] = ${
            meet === 'union' ? '∅' : 'U (the full domain)'
          } for every other block.`,
      level: 'macro',
      section: 'Setup',
    },
  ];

  // Deterministic visit order: forward ascending id, backward descending id.
  const visitOrder = forward ? [...blockIds].sort((a, b) => a - b) : [...blockIds].sort((a, b) => b - a);

  let iteration = 0;
  let changedAny = true;
  while (changedAny) {
    changedAny = false;
    iteration++;
    const section = `Iteration ${iteration}`;
    const groupId = `${problem.name}-iteration-${iteration}`;
    yield [
      { kind: 'df-iteration', iteration },
      {
        cite,
        prose: `Iteration ${iteration}: recompute IN and OUT for every block in ${
          forward ? 'ascending' : 'descending'
        } id order until nothing changes.`,
        level: 'macro',
        section,
        groupId,
      },
    ];

    for (const id of visitOrder) {
      const k = String(id);
      const genB = gen[k] ?? [];
      const killB = kill[k] ?? [];
      if (forward) {
        const preds = predecessors(cfg, id);
        const inB = meetSets(meet, domain, preds.map((p) => OUT[String(p)] ?? []));
        const outB = union(genB, difference(inB, killB));
        const changed = !sameSet(outB, OUT[k] ?? []);
        IN[k] = inB;
        OUT[k] = outB;
        if (changed) changedAny = true;
        yield [
          { kind: 'df-update', iteration, blockId: id, in: inB, out: outB, changed },
          {
            cite,
            prose: `B${id}: IN = ${meet === 'union' ? '∪' : '∩'} of OUT over predecessors {${preds
              .map((p) => (p === ENTRY ? 'ENTRY' : `B${p}`))
              .join(', ')}} = {${inB.join(', ')}}; OUT = gen ∪ (IN − kill) = {${outB.join(', ')}}${
              changed ? ' (changed)' : ' (unchanged)'
            }.`,
            level: 'micro',
            section,
            groupId,
            irRefs: [{ kind: 'block', id }],
          },
        ];
      } else {
        const succs = successors(cfg, id);
        const outB = meetSets(meet, domain, succs.map((s) => IN[String(s)] ?? []));
        const inB = union(genB, difference(outB, killB));
        const changed = !sameSet(inB, IN[k] ?? []);
        OUT[k] = outB;
        IN[k] = inB;
        if (changed) changedAny = true;
        yield [
          { kind: 'df-update', iteration, blockId: id, in: inB, out: outB, changed },
          {
            cite,
            prose: `B${id}: OUT = ${meet === 'union' ? '∪' : '∩'} of IN over successors {${succs
              .map((s) => (s === EXIT ? 'EXIT' : `B${s}`))
              .join(', ')}} = {${outB.join(', ')}}; IN = gen ∪ (OUT − kill) = {${inB.join(', ')}}${
              changed ? ' (changed)' : ' (unchanged)'
            }.`,
            level: 'micro',
            section,
            groupId,
            irRefs: [{ kind: 'block', id }],
          },
        ];
      }
    }
  }

  yield [
    { kind: 'df-converged', name: problem.name, iterations: iteration },
    {
      cite,
      prose: `${problem.name} converged: iteration ${iteration} produced no changes, so IN and OUT are the greatest fixedpoint the round-robin algorithm computes.`,
      level: 'macro',
      section: 'Converged',
    },
  ];

  return {
    name: problem.name,
    direction,
    meet,
    domain,
    gen,
    kill,
    in: IN,
    out: OUT,
    iterations: iteration,
  };
}

// ---------------------------------------------------------------------------
// Instantiation 1: reaching definitions (§9.2.4, Algorithm 9.11)
// ---------------------------------------------------------------------------

export interface DefInfo {
  id: string; // d1, d2, … in quad order ("d0(x)" for an entry dummy definition)
  /** Quad that performs the definition; -1 for an ENTRY dummy definition. */
  quadIndex: number;
  var: string;
  /** True for the §9.2.4 dummy definition of a variable at the flow-graph entry. */
  entry?: true;
}

export interface ReachingDefsResult extends DataflowResult {
  defs: DefInfo[];
}

export interface ReachingDefsOptions {
  /**
   * §9.2.4, "Detection of Possible Uses Before Definition": introduce a dummy
   * definition of every variable at the entry of the flow graph. Without them
   * a use that is reached by a real definition on one path and by the entry
   * value on another looks as if the real definition were the only one — which
   * is exactly the mistake constant propagation must not make. The plain
   * problem (no dummy definitions) is the Fig 9.14 / Algorithm 9.11 running
   * example; clients that need soundness at possibly-undefined uses ask for
   * the dummy definitions.
   */
  entryDefinitions?: boolean;
}

/** Every variable/temp mentioned (defined or used) anywhere in the function. */
function allVariables(fn: TacFunction): string[] {
  const vars = new Set<string>();
  for (const q of fn.quads) {
    for (const u of usedVars(q)) vars.add(u);
    const d = definedVar(q);
    if (d !== null) vars.add(d);
  }
  return sortSet(vars);
}

/**
 * Number the definitions d1, d2, … in program order (as the book does).
 * With `entryDefinitions`, each variable additionally gets the §9.2.4 dummy
 * definition "d0(x)" at the entry of the flow graph; those sort before d1.
 */
export function numberDefinitions(fn: TacFunction, opts: ReachingDefsOptions = {}): DefInfo[] {
  const defs: DefInfo[] = [];
  if (opts.entryDefinitions) {
    for (const v of allVariables(fn)) defs.push({ id: `d0(${v})`, quadIndex: -1, var: v, entry: true });
  }
  let n = 0;
  for (const q of fn.quads) {
    const v = definedVar(q);
    if (v !== null) defs.push({ id: `d${++n}`, quadIndex: q.index, var: v });
  }
  return defs;
}

export function reachingDefsProblem(
  fn: TacFunction,
  cfg: Cfg,
  opts: ReachingDefsOptions = {},
): { problem: DataflowProblem; defs: DefInfo[] } {
  const defs = numberDefinitions(fn, opts);
  const defsOfVar: Record<string, string[]> = {};
  for (const d of defs) (defsOfVar[d.var] ??= []).push(d.id);
  const defAtQuad: Record<number, DefInfo> = {};
  for (const d of defs) if (!d.entry) defAtQuad[d.quadIndex] = d;

  const gen: Record<string, string[]> = {};
  const kill: Record<string, string[]> = {};
  for (const b of cfg.blocks) {
    // Compose the block's quads in order: a later def of v kills earlier ones.
    let genB: string[] = [];
    let killB: string[] = [];
    for (const qi of b.quadIndices) {
      const d = defAtQuad[qi];
      if (!d) continue;
      const killsHere = (defsOfVar[d.var] ?? []).filter((x) => x !== d.id);
      genB = union([d.id], difference(genB, killsHere));
      killB = union(killB, killsHere);
    }
    gen[String(b.id)] = genB;
    kill[String(b.id)] = killB;
  }

  return {
    problem: {
      name: 'reaching-definitions',
      direction: 'forward',
      meet: 'union',
      domain: defs.map((d) => d.id),
      gen,
      kill,
      // The dummy definitions of §9.2.4 hold at the entry of the flow graph.
      boundary: defs.filter((d) => d.entry).map((d) => d.id),
      init: [],
      cite: { section: '9.2.4', figureOrAlgo: 'Algorithm 9.11' },
    },
    defs,
  };
}

export function* reachingDefinitions(
  fn: TacFunction,
  cfg: Cfg,
  opts: ReachingDefsOptions = {},
): Steps<DataflowEvent, ReachingDefsResult> {
  const { problem, defs } = reachingDefsProblem(fn, cfg, opts);
  const result = yield* iterativeDataflow(cfg, problem);
  return { ...result, defs };
}

export function runReachingDefinitions(
  fn: TacFunction,
  cfg: Cfg,
  opts: ReachingDefsOptions = {},
): Recorded<DataflowState, DataflowEvent, ReachingDefsResult> {
  return record(() => reachingDefinitions(fn, cfg, opts), initialDataflowState, dataflowReducer, {
    id: `opt.reaching-definitions.${fn.name}`,
  });
}

// ---------------------------------------------------------------------------
// Instantiation 2: live variables (§9.2.5)
// ---------------------------------------------------------------------------

export interface LiveVarsResult extends DataflowResult {
  /** use/def per block, in the book's terminology (gen = use, kill = def). */
  use: Record<string, string[]>;
  def: Record<string, string[]>;
}

/**
 * use_B: variables used in B before any definition in B;
 * def_B: variables defined in B before any use in B (§9.2.5).
 */
export function liveVarsProblem(fn: TacFunction, cfg: Cfg, liveAtExit: string[]): DataflowProblem & {
  use: Record<string, string[]>;
  def: Record<string, string[]>;
} {
  const domain = allVariables(fn);

  const use: Record<string, string[]> = {};
  const def: Record<string, string[]> = {};
  for (const b of cfg.blocks) {
    const useB = new Set<string>();
    const defB = new Set<string>();
    for (const qi of b.quadIndices) {
      const q = fn.quads[qi];
      if (!q) continue;
      for (const u of usedVars(q)) if (!defB.has(u)) useB.add(u);
      const d = definedVar(q);
      if (d !== null && !useB.has(d)) defB.add(d);
    }
    use[String(b.id)] = sortSet(useB);
    def[String(b.id)] = sortSet(defB);
  }

  return {
    name: 'live-variables',
    direction: 'backward',
    meet: 'union',
    domain,
    gen: use,
    kill: def,
    boundary: sortSet(liveAtExit),
    init: [],
    cite: { section: '9.2.5' },
    use,
    def,
  };
}

export function* liveVariables(
  fn: TacFunction,
  cfg: Cfg,
  liveAtExit: string[] = [],
): Steps<DataflowEvent, LiveVarsResult> {
  const problem = liveVarsProblem(fn, cfg, liveAtExit);
  const result = yield* iterativeDataflow(cfg, problem);
  return { ...result, use: problem.use, def: problem.def };
}

export function runLiveVariables(
  fn: TacFunction,
  cfg: Cfg,
  liveAtExit: string[] = [],
): Recorded<DataflowState, DataflowEvent, LiveVarsResult> {
  return record(() => liveVariables(fn, cfg, liveAtExit), initialDataflowState, dataflowReducer, {
    id: `opt.live-variables.${fn.name}`,
  });
}

// ---------------------------------------------------------------------------
// Instantiation 3: available expressions (§9.2.6)
// ---------------------------------------------------------------------------

const EXPR_OPS = new Set<string>(['+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=']);

function operandText(o: TacOperand | null): string | null {
  if (!o) return null;
  if (o.kind === 'const') return String(o.value);
  return varKey(o);
}

/** Canonical text "y op z" for a binary expression quad, else null. */
export function exprKey(q: Quad): string | null {
  if (!EXPR_OPS.has(q.op)) return null;
  const a = operandText(q.arg1);
  const b = operandText(q.arg2);
  if (a === null || b === null) return null;
  return `${a} ${q.op} ${b}`;
}

/** Variables/temps appearing as operands of an expression key. */
export function exprOperandVars(q: Quad): string[] {
  const out: string[] = [];
  for (const o of [q.arg1, q.arg2]) {
    if (o && (o.kind === 'var' || o.kind === 'temp')) {
      const k = varKey(o);
      if (k !== null) out.push(k);
    }
  }
  return out;
}

export interface AvailExprsResult extends DataflowResult {
  /** expression key -> quad indices that compute it, in program order. */
  sites: Record<string, number[]>;
}

/**
 * Does executing `q` kill an expression whose operands are `operands`?
 *
 * §9.2.6 kills an expression when one of its operands is redefined. §8.5.6
 * ("Pointer Assignments and Procedure Calls") adds the two indirect cases:
 * with no pointer analysis, an assignment `* p = y` through a pointer may
 * write ANY variable the pointer may point to, and a procedure call may write
 * any variable the callee can reach — both therefore kill every expression
 * over a variable that is not a purely local compiler temp. An array store
 * `x [ i ] = y` writes only inside the array x, so it kills only expressions
 * involving x itself.
 */
export function expressionKilledBy(
  q: Quad,
  operands: string[],
  addrTaken: ReadonlySet<string> = new Set(),
): boolean {
  const d = definedVar(q);
  if (d !== null && operands.includes(d)) return true;
  if (q.op === 'call' || q.op === 'deref-store') {
    return operands.some((v) => !isTempName(v) || addrTaken.has(v));
  }
  if (q.op === 'index-store') {
    const base = q.result ? varKey(q.result) : null;
    return base !== null && operands.includes(base);
  }
  return false;
}

export function availExprsProblem(fn: TacFunction, cfg: Cfg): { problem: DataflowProblem; sites: Record<string, number[]> } {
  const sites: Record<string, number[]> = {};
  const operandsOf: Record<string, string[]> = {};
  for (const q of fn.quads) {
    const e = exprKey(q);
    if (e === null) continue;
    (sites[e] ??= []).push(q.index);
    operandsOf[e] = exprOperandVars(q);
  }
  const domain = sortSet(Object.keys(sites));
  const addrTaken = addressTakenVars(fn);

  const gen: Record<string, string[]> = {};
  const kill: Record<string, string[]> = {};
  for (const b of cfg.blocks) {
    let genB = new Set<string>();
    const killB = new Set<string>();
    for (const qi of b.quadIndices) {
      const q = fn.quads[qi];
      if (!q) continue;
      const e = exprKey(q);
      // §9.2.6: at x = y + z, first add y + z to gen, then delete anything
      // involving x from gen and add it to kill (handles x = x + z correctly
      // when done in this order — add, then kill expressions involving x).
      if (e !== null) {
        genB.add(e);
        killB.delete(e);
      }
      // Kills: a redefined operand (§9.2.6), plus the indirect writes of
      // §8.5.6 (stores through pointers, array stores, procedure calls).
      const killedBy = (expr: string): boolean =>
        expressionKilledBy(q, operandsOf[expr] ?? [], addrTaken);
      genB = new Set([...genB].filter((x) => !killedBy(x)));
      for (const x of domain) if (killedBy(x)) killB.add(x);
      if (e !== null && !killedBy(e)) killB.delete(e);
    }
    gen[String(b.id)] = sortSet(genB);
    kill[String(b.id)] = sortSet(killB);
  }

  return {
    problem: {
      name: 'available-expressions',
      direction: 'forward',
      meet: 'intersection',
      domain,
      gen,
      kill,
      boundary: [],
      init: [...domain],
      cite: { section: '9.2.6' },
    },
    sites,
  };
}

export function* availableExpressions(fn: TacFunction, cfg: Cfg): Steps<DataflowEvent, AvailExprsResult> {
  const { problem, sites } = availExprsProblem(fn, cfg);
  const result = yield* iterativeDataflow(cfg, problem);
  return { ...result, sites };
}

export function runAvailableExpressions(
  fn: TacFunction,
  cfg: Cfg,
): Recorded<DataflowState, DataflowEvent, AvailExprsResult> {
  return record(() => availableExpressions(fn, cfg), initialDataflowState, dataflowReducer, {
    id: `opt.available-expressions.${fn.name}`,
  });
}

// ---------------------------------------------------------------------------
// Point-level queries used by the passes (walk a block from its boundary set)
// ---------------------------------------------------------------------------

/** Definitions (d-ids) reaching the program point JUST BEFORE quadIndex. */
export function defsReachingAt(
  fn: TacFunction,
  cfg: Cfg,
  rd: ReachingDefsResult,
  blockId: number,
  quadIndex: number,
): string[] {
  const block = cfg.blocks.find((b) => b.id === blockId);
  if (!block) return [];
  const defAtQuad: Record<number, DefInfo> = {};
  for (const d of rd.defs) if (!d.entry) defAtQuad[d.quadIndex] = d;
  const defsOfVar: Record<string, string[]> = {};
  for (const d of rd.defs) (defsOfVar[d.var] ??= []).push(d.id);

  let cur = rd.in[String(blockId)] ?? [];
  for (const qi of block.quadIndices) {
    if (qi === quadIndex) return cur;
    const d = defAtQuad[qi];
    if (d) cur = union([d.id], difference(cur, (defsOfVar[d.var] ?? []).filter((x) => x !== d.id)));
  }
  return cur;
}

/** Variables live JUST AFTER quadIndex (walk the block backwards from OUT). */
export function liveAfter(
  fn: TacFunction,
  cfg: Cfg,
  lv: LiveVarsResult,
  blockId: number,
  quadIndex: number,
): string[] {
  const block = cfg.blocks.find((b) => b.id === blockId);
  if (!block) return [];
  let cur = lv.out[String(blockId)] ?? [];
  for (let i = block.quadIndices.length - 1; i >= 0; i--) {
    const qi = block.quadIndices[i]!;
    if (qi === quadIndex) return cur;
    const q = fn.quads[qi];
    if (!q) continue;
    const d = definedVar(q);
    if (d !== null) cur = difference(cur, [d]);
    cur = union(cur, sortSet(usedVars(q)));
  }
  return cur;
}

/** Expressions available JUST BEFORE quadIndex (walk block from IN). */
export function exprsAvailableAt(
  fn: TacFunction,
  cfg: Cfg,
  ae: AvailExprsResult,
  blockId: number,
  quadIndex: number,
): string[] {
  const block = cfg.blocks.find((b) => b.id === blockId);
  if (!block) return [];
  const operandsOf: Record<string, string[]> = {};
  for (const e of ae.domain) {
    const site = (ae.sites[e] ?? [])[0];
    const q = site !== undefined ? fn.quads[site] : undefined;
    operandsOf[e] = q ? exprOperandVars(q) : [];
  }
  const addrTaken = addressTakenVars(fn);
  let cur = new Set(ae.in[String(blockId)] ?? []);
  for (const qi of block.quadIndices) {
    if (qi === quadIndex) return sortSet(cur);
    const q = fn.quads[qi];
    if (!q) continue;
    const e = exprKey(q);
    if (e !== null) cur.add(e);
    cur = new Set([...cur].filter((x) => !expressionKilledBy(q, operandsOf[x] ?? [], addrTaken)));
  }
  return sortSet(cur);
}

/** Untraced driver for internal (pass) use. */
export function solveDataflow(cfg: Cfg, problem: DataflowProblem): DataflowResult {
  const gen = iterativeDataflow(cfg, problem);
  let it = gen.next();
  while (!it.done) it = gen.next();
  return it.value;
}

// Re-export formatQuad so passes have a single import site for rendering.
export { formatQuad };
