/**
 * LR(1) items — Algorithm 4.53 (§4.7.2): CLOSURE and GOTO with lookaheads per
 * Fig 4.40, and the canonical collection of sets of LR(1) items. Also the
 * canonical LR(1) parsing table — Algorithm 4.56 (§4.7.3).
 *
 * Determinism mirrors lr0-items.ts: FIFO worklist, GOTO over nonterminals then
 * terminals in declaration order, CLOSURE via FIFO scan adding productions in
 * declaration order with lookaheads in terminal order. On Grammar 4.55 this
 * reproduces I0–I9 of Fig 4.41 exactly.
 *
 * Educational cap: canonical LR(1) collections blow up on real grammars, so
 * items() accepts opts.maxStates (default 400) and stops with a truncation
 * event explaining that this blowup is why LALR exists.
 */
import type { Recorded, Reducer, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import { augment, EOF, EPSILON, formatProduction, type Grammar } from './grammar.js';
import { computeFirst, firstOfString, ntSet, sortTerminals, type TerminalSet } from './lr-first.js';
import {
  buildTableSteps,
  drain,
  formatDotted,
  formatLr1Item,
  reduceTableEvent,
  type Lr1ItemJson,
  type LrTransitionJson,
  type TableEvent,
  type TableFields,
} from './lr-events.js';

export type { Lr1ItemJson } from './lr-events.js';

export interface Lr1StateJson {
  id: number;
  /** Kernel items first, then closure items in discovery order. */
  items: Lr1ItemJson[];
}

export interface Lr1Collection {
  grammarName: string;
  states: Lr1StateJson[];
  transitions: LrTransitionJson[];
  /** True if construction stopped at opts.maxStates. */
  truncated: boolean;
}

// ── Events ───────────────────────────────────────────────────────────────────

export type Lr1Event =
  | { kind: 'lr1/start'; grammarName: string; augmentedProduction: string; maxStates: number }
  | { kind: 'lr1/state'; id: number; kernel: Lr1ItemJson[] }
  | {
      kind: 'lr1/closureItem';
      state: number;
      item: Lr1ItemJson;
      fromProd: number;
      fromDot: number;
      fromLa: string;
      /** FIRST(βa) that produced the lookahead — the provenance of item.la. */
      firstOf: string[];
    }
  | { kind: 'lr1/goto'; from: number; symbol: string; to: number; isNew: boolean }
  | { kind: 'lr1/truncated'; statesBuilt: number; maxStates: number };

export type Lr1UiState = Lr1Collection;

export function lr1Initial(): Lr1UiState {
  return { grammarName: '', states: [], transitions: [], truncated: false };
}

export const lr1Reducer: Reducer<Lr1UiState, Lr1Event> = (s, e) => {
  switch (e.kind) {
    case 'lr1/start':
      return { ...s, grammarName: e.grammarName };
    case 'lr1/state':
      return { ...s, states: [...s.states, { id: e.id, items: [...e.kernel] }] };
    case 'lr1/closureItem':
      return {
        ...s,
        states: s.states.map((st) =>
          st.id === e.state ? { ...st, items: [...st.items, e.item] } : st,
        ),
      };
    case 'lr1/goto':
      return {
        ...s,
        transitions: [...s.transitions, { from: e.from, symbol: e.symbol, to: e.to }],
      };
    case 'lr1/truncated':
      return { ...s, truncated: true };
  }
};

// ── The algorithm ────────────────────────────────────────────────────────────

const itemKey = (it: { prod: number; dot: number; la: string }) =>
  `${it.prod}.${it.dot}.${it.la}`;

export interface Lr1ItemsOpts {
  /** Educational cap on the number of states (default 400). */
  maxStates?: number;
}

/**
 * Thrown when a table construction needs the WHOLE canonical LR(1) collection
 * but the educational cap cut it off. This is not an internal fault: it is the
 * §4.7.4 lesson itself (the canonical collection blows up, which is why LALR
 * exists), so callers should present it as truncation — with `hint` — rather
 * than as a bug.
 */
export class Lr1StateCapError extends Error {
  readonly rule =
    'canonical LR tables can have many more states than the SLR/LALR tables for the same language';
  readonly hint =
    'Splitting states by lookahead multiplies the LR(0) states by their viable lookahead contexts — this blowup is exactly why LALR exists, which merges same-core states back together into a table with as many rows as the LR(0) machine (§4.7.4). Build the LALR(1) table for this grammar instead.';
  constructor(
    what: string,
    readonly grammarName: string,
    readonly statesBuilt: number,
    readonly maxStates: number,
  ) {
    super(
      `${what} for ${grammarName}: the canonical LR(1) collection is larger than the lab's ${maxStates}-state cap (construction stopped after ${statesBuilt} states), and a table built from a truncated collection would be missing rows`,
    );
    this.name = 'Lr1StateCapError';
  }
}

/**
 * The canonical collection of sets of LR(1) items for the augmented grammar —
 * Algorithm 4.53. CLOSURE follows Fig 4.40: for [A → α·Bβ, a], each
 * production B → γ gains [B → ·γ, b] for every b ∈ FIRST(βa).
 */
export function* lr1Items(
  grammar: Grammar,
  opts?: Lr1ItemsOpts,
): Steps<Lr1Event, Lr1Collection> {
  const maxStates = opts?.maxStates ?? 400;
  const ag = augment(grammar);
  const nts = ntSet(ag);
  const first = computeFirst(ag);
  const augProd = ag.productions[ag.productions.length - 1]!;
  const coll: Lr1Collection = {
    grammarName: grammar.name,
    states: [],
    transitions: [],
    truncated: false,
  };

  const byLhs = new Map<string, number[]>();
  for (const p of ag.productions) {
    const l = byLhs.get(p.lhs) ?? [];
    l.push(p.id);
    byLhs.set(p.lhs, l);
  }

  /** Memoized FIRST(βa) for the item (prod, dot, la), as a sorted array. */
  const firstOfCache = new Map<string, string[]>();
  function firstOfBetaA(prod: number, dot: number, la: string): string[] {
    const key = `${prod}.${dot}.${la}`;
    let v = firstOfCache.get(key);
    if (v === undefined) {
      const beta = ag.productions[prod]!.rhs.slice(dot + 1);
      const f: TerminalSet = firstOfString(ag, first, [...beta, la]);
      f.delete(EPSILON); // la is a terminal/$, so ε cannot survive; be explicit
      v = sortTerminals(ag, f);
      firstOfCache.set(key, v);
    }
    return v;
  }

  yield [
    {
      kind: 'lr1/start',
      grammarName: grammar.name,
      augmentedProduction: formatProduction(augProd),
      maxStates,
    },
    {
      cite: { section: '4.7.2', figureOrAlgo: 'Algorithm 4.53' },
      prose: `Build the canonical collection of sets of LR(1) items for the grammar augmented with ${formatProduction(augProd)}; each item now carries a lookahead terminal (cap: ${maxStates} states).`,
      level: 'macro',
      section: 'Augment',
    },
  ];

  function* closureSteps(state: Lr1StateJson, section: string): Steps<Lr1Event, void> {
    const have = new Set(state.items.map(itemKey));
    for (let i = 0; i < state.items.length; i++) {
      const it = state.items[i]!;
      const p = ag.productions[it.prod]!;
      const b = p.rhs[it.dot];
      if (b === undefined || !nts.has(b)) continue;
      const firstSet = firstOfBetaA(it.prod, it.dot, it.la);
      for (const prodId of byLhs.get(b) ?? []) {
        for (const la of firstSet) {
          const add: Lr1ItemJson = { prod: prodId, dot: 0, la, kernel: false };
          const key = itemKey(add);
          if (have.has(key)) continue;
          have.add(key);
          state.items.push(add);
          const beta = p.rhs.slice(it.dot + 1);
          const betaA = [...beta, it.la].join(' ');
          const meta: StepMeta = {
            cite: { section: '4.7.2', figureOrAlgo: 'Fig 4.40 (CLOSURE)', rule: 'add [B → ·γ, b] for each b ∈ FIRST(βa)' },
            prose: `Added ${formatLr1Item(ag, add)} to I${state.id}: in ${formatLr1Item(ag, it)} the dot precedes ${b}, and FIRST(${betaA}) = {${firstSet.join(', ')}}, so lookahead '${la}' is justified because ${la} ∈ FIRST(βa).`,
            level: 'micro',
            groupId: `lr1:closure:I${state.id}`,
            section,
            irRefs: [{ kind: 'production', id: prodId }],
          };
          yield [
            {
              kind: 'lr1/closureItem',
              state: state.id,
              item: { ...add },
              fromProd: it.prod,
              fromDot: it.dot,
              fromLa: it.la,
              firstOf: [...firstSet],
            },
            meta,
          ];
        }
      }
    }
  }

  const stateByKernel = new Map<string, number>();
  const kernelKeyOf = (kernel: Lr1ItemJson[]) => kernel.map(itemKey).sort().join(',');

  function* newState(kernel: Lr1ItemJson[], section: string): Steps<Lr1Event, number> {
    const id = coll.states.length;
    const st: Lr1StateJson = { id, items: kernel.map((k) => ({ ...k })) };
    coll.states.push(st);
    stateByKernel.set(kernelKeyOf(kernel), id);
    yield [
      { kind: 'lr1/state', id, kernel: kernel.map((k) => ({ ...k })) },
      {
        cite: { section: '4.7.2', figureOrAlgo: 'Algorithm 4.53' },
        prose: `New state I${id} with kernel {${kernel.map((k) => `${formatDotted(ag, k.prod, k.dot)}, ${k.la}`).join('; ')}} joins the collection; its CLOSURE follows.`,
        level: 'macro',
        groupId: `lr1:closure:I${id}`,
        section,
      },
    ];
    yield* closureSteps(st, section);
    return id;
  }

  /** Stop the construction at the cap, explaining why the blowup happens. */
  function* truncate(): Steps<Lr1Event, void> {
    coll.truncated = true;
    yield [
      { kind: 'lr1/truncated', statesBuilt: coll.states.length, maxStates },
      {
        cite: { section: '4.7.4', rule: 'canonical LR tables can have many more states than SLR/LALR tables for the same language' },
        prose: `Stopped after ${coll.states.length} LR(1) states (cap ${maxStates}): splitting states by lookahead multiplies the LR(0) states by their viable lookahead contexts — this blowup is exactly why LALR exists, which merges same-core states back together (§4.7.4).`,
        level: 'macro',
        section: 'Truncated',
      },
    ];
  }

  // The cap counts I0 too: with maxStates = 0 nothing is built at all.
  if (maxStates < 1) {
    yield* truncate();
    return coll;
  }
  yield* newState([{ prod: augProd.id, dot: 0, la: EOF, kernel: true }], 'I0');

  const symbolOrder = [...ag.nonterminals, ...ag.terminals];
  const worklist: number[] = [0];
  while (worklist.length > 0) {
    const i = worklist.shift()!; // FIFO
    const section = `I${i}`;
    const src = coll.states[i]!;
    const moved = new Map<string, Lr1ItemJson[]>();
    for (const it of src.items) {
      const p = ag.productions[it.prod]!;
      const x = p.rhs[it.dot];
      if (x === undefined) continue;
      const l = moved.get(x) ?? [];
      l.push({ prod: it.prod, dot: it.dot + 1, la: it.la, kernel: true });
      moved.set(x, l);
    }
    for (const x of symbolOrder) {
      const kernel = moved.get(x);
      if (!kernel) continue;
      const key = kernelKeyOf(kernel);
      const existing = stateByKernel.get(key);
      if (existing === undefined && coll.states.length >= maxStates) {
        yield* truncate();
        return coll;
      }
      const isNew = existing === undefined;
      const to = existing ?? coll.states.length;
      coll.transitions.push({ from: i, symbol: x, to });
      yield [
        { kind: 'lr1/goto', from: i, symbol: x, to, isNew },
        {
          cite: { section: '4.7.2', figureOrAlgo: 'Fig 4.40 (GOTO)', rule: 'GOTO(I, X) = CLOSURE of { [A → αX·β, a] : [A → α·Xβ, a] ∈ I } — lookaheads ride along unchanged' },
          prose: isNew
            ? `GOTO(I${i}, ${x}): advancing the dot over ${x} (lookaheads unchanged) gives a kernel not yet in the collection — it becomes new state I${to}.`
            : `GOTO(I${i}, ${x}) = I${to}, an existing state (same items including lookaheads); only the transition is recorded.`,
          level: 'macro',
          section,
          irRefs: [{ kind: 'grammarSymbol', id: x }],
        },
      ];
      if (isNew) {
        yield* newState(kernel, section);
        worklist.push(to);
      }
    }
  }

  return coll;
}

export type Lr1Result = Lr1Collection;

/** Convenience: record the canonical LR(1) collection trace. */
export function lr1ItemsRun(
  grammar: Grammar,
  opts?: Lr1ItemsOpts & { id?: string },
): Recorded<Lr1UiState, Lr1Event, Lr1Result> {
  return record(() => lr1Items(grammar, opts), lr1Initial(), lr1Reducer, {
    id: opts?.id ?? 'syntax.lr1-items',
  });
}

// ── Canonical LR(1) parsing table — Algorithm 4.56 (§4.7.3) ─────────────────

export type Lr1TableEvent = TableEvent;
export type Lr1TableUiState = TableFields;
export type Lr1TableResult = TableFields;

export function lr1TableInitial(): Lr1TableUiState {
  return { grammarName: '', follow: {}, action: [], goto: [], conflicts: [] };
}

export const lr1TableReducer: Reducer<Lr1TableUiState, Lr1TableEvent> = reduceTableEvent;

/**
 * Canonical LR(1) table: shift entries from terminal transitions; a complete
 * item [A → α·, a] demands reduce only on its own lookahead a; [S' → S·, $]
 * accepts. The collection is built untraced here (it has its own trace above).
 */
export function* lr1Table(
  grammar: Grammar,
  opts?: Lr1ItemsOpts,
): Steps<Lr1TableEvent, Lr1TableResult> {
  const ag = augment(grammar);
  const maxStates = opts?.maxStates ?? 400;
  const coll = drain(lr1Items(grammar, { maxStates }));
  if (coll.truncated) {
    throw new Lr1StateCapError(
      'cannot build the canonical LR(1) table',
      grammar.name,
      coll.states.length,
      maxStates,
    );
  }
  const trans = new Map<string, number>();
  for (const t of coll.transitions) trans.set(`${t.from} ${t.symbol}`, t.to);

  yield [
    { kind: 'table/start', algo: 'lr1', grammarName: grammar.name, numStates: coll.states.length },
    {
      cite: { section: '4.7.3', figureOrAlgo: 'Algorithm 4.56' },
      prose: `Construct the canonical LR(1) parsing table from the ${coll.states.length} LR(1) item sets; each reduction applies only on the item's own lookahead, not the whole FOLLOW set.`,
      level: 'macro',
      section: 'ACTION/GOTO',
    },
  ];

  const built = yield* buildTableSteps({
    algo: 'lr1',
    ag,
    states: coll.states,
    transition: (from, sym) => trans.get(`${from} ${sym}`),
    reduceLookaheads: (_state, item) => [(item as Lr1ItemJson).la],
    reduceWhy: (_state, item) =>
      `its lookahead is '${(item as Lr1ItemJson).la}' — reductions in canonical LR(1) apply only on the item's own lookahead`,
    cite: { section: '4.7.3', figureOrAlgo: 'Algorithm 4.56' },
    conflictNote: () =>
      'The grammar is therefore not LR(1): even full lookahead splitting cannot decide this state deterministically.',
    resolveDanglingElseByShift: false,
    section: 'ACTION/GOTO',
    formatItem: (it) => formatLr1Item(ag, it as Lr1ItemJson),
  });

  return {
    grammarName: grammar.name,
    follow: {},
    action: built.action,
    goto: built.goto,
    conflicts: built.conflicts,
  };
}

/** Convenience: record the canonical LR(1) table trace. */
export function lr1TableRun(
  grammar: Grammar,
  opts?: Lr1ItemsOpts & { id?: string },
): Recorded<Lr1TableUiState, Lr1TableEvent, Lr1TableResult> {
  return record(() => lr1Table(grammar, opts), lr1TableInitial(), lr1TableReducer, {
    id: opts?.id ?? 'syntax.lr1-table',
  });
}
