/**
 * LR(0) items: CLOSURE and GOTO (§4.6.2, Fig 4.32) and the canonical LR(0)
 * collection — procedure items(G') of Fig 4.33.
 *
 * Determinism: FIFO worklist over states; for each state GOTO is computed over
 * symbols in declaration order (nonterminals first, then terminals), and
 * CLOSURE adds productions in grammar declaration order via a FIFO scan of the
 * item list. On augmented Grammar 4.1 this reproduces the book's I0–I11
 * numbering of Fig 4.31 exactly.
 */
import type { Recorded, Reducer, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import { augment, formatProduction, type Grammar } from './grammar.js';
import { ntSet } from './lr-first.js';
import {
  formatDotted,
  formatLr0Item,
  type Lr0ItemJson,
  type LrTransitionJson,
} from './lr-events.js';

export type { Lr0ItemJson } from './lr-events.js';

export interface Lr0StateJson {
  id: number;
  /** Kernel items first (in creation order), then closure items in the order
   *  CLOSURE discovered them — the order the book lists them in Fig 4.31. */
  items: Lr0ItemJson[];
}

export interface Lr0Collection {
  grammarName: string;
  states: Lr0StateJson[];
  transitions: LrTransitionJson[];
}

// ── Events ───────────────────────────────────────────────────────────────────

export type Lr0Event =
  | { kind: 'lr0/start'; grammarName: string; augmentedProduction: string }
  | { kind: 'lr0/state'; id: number; kernel: Lr0ItemJson[] }
  | {
      kind: 'lr0/closureItem';
      state: number;
      item: Lr0ItemJson;
      /** The item whose dot-before-nonterminal justified this addition. */
      fromProd: number;
      fromDot: number;
    }
  | { kind: 'lr0/goto'; from: number; symbol: string; to: number; isNew: boolean };

export type Lr0UiState = Lr0Collection;

export function lr0Initial(): Lr0UiState {
  return { grammarName: '', states: [], transitions: [] };
}

export const lr0Reducer: Reducer<Lr0UiState, Lr0Event> = (s, e) => {
  switch (e.kind) {
    case 'lr0/start':
      return { ...s, grammarName: e.grammarName };
    case 'lr0/state':
      return { ...s, states: [...s.states, { id: e.id, items: [...e.kernel] }] };
    case 'lr0/closureItem':
      return {
        ...s,
        states: s.states.map((st) =>
          st.id === e.state ? { ...st, items: [...st.items, e.item] } : st,
        ),
      };
    case 'lr0/goto':
      return {
        ...s,
        transitions: [...s.transitions, { from: e.from, symbol: e.symbol, to: e.to }],
      };
  }
};

// ── The algorithm ────────────────────────────────────────────────────────────

const itemKey = (it: { prod: number; dot: number }) => `${it.prod}.${it.dot}`;

/**
 * CLOSURE(I) of Fig 4.32, traced: FIFO scan of the item list; whenever the dot
 * stands before a nonterminal B, every production B → γ (in declaration
 * order) contributes [B → ·γ] once. Mutates `state.items` and yields one
 * micro event per added item.
 */
function* closureSteps(
  ag: Grammar,
  state: Lr0StateJson,
  section: string,
): Steps<Lr0Event, void> {
  const nts = ntSet(ag);
  const byLhs = new Map<string, number[]>();
  for (const p of ag.productions) {
    const l = byLhs.get(p.lhs) ?? [];
    l.push(p.id);
    byLhs.set(p.lhs, l);
  }
  const have = new Set(state.items.map(itemKey));
  for (let i = 0; i < state.items.length; i++) {
    const it = state.items[i]!;
    const p = ag.productions[it.prod]!;
    const b = p.rhs[it.dot];
    if (b === undefined || !nts.has(b)) continue;
    for (const prodId of byLhs.get(b) ?? []) {
      const add: Lr0ItemJson = { prod: prodId, dot: 0, kernel: false };
      if (have.has(itemKey(add))) continue;
      have.add(itemKey(add));
      state.items.push(add);
      const meta: StepMeta = {
        cite: { section: '4.6.2', figureOrAlgo: 'Fig 4.32 (CLOSURE)' },
        prose: `Added closure item ${formatLr0Item(ag, add)} to I${state.id}: the dot in ${formatLr0Item(ag, it)} stands just before nonterminal ${b}, so every ${b}-production is added with the dot at its left end.`,
        level: 'micro',
        groupId: `lr0:closure:I${state.id}`,
        section,
        irRefs: [{ kind: 'production', id: prodId }],
      };
      yield [
        {
          kind: 'lr0/closureItem',
          state: state.id,
          item: { ...add },
          fromProd: it.prod,
          fromDot: it.dot,
        },
        meta,
      ];
    }
  }
}

/**
 * The canonical collection of sets of LR(0) items — items(G') of Fig 4.33 —
 * for the AUGMENTED version of `grammar` (augmentation done internally,
 * §4.6.2). Pure generator; see lr0ItemsRun for the recorded form.
 */
export function* lr0Items(grammar: Grammar): Steps<Lr0Event, Lr0Collection> {
  const ag = augment(grammar);
  const nts = ntSet(ag);
  const augProd = ag.productions[ag.productions.length - 1]!;
  const coll: Lr0Collection = { grammarName: grammar.name, states: [], transitions: [] };

  // GOTO is computed per grammar symbol in declaration order, each symbol
  // visited exactly once (a symbol listed twice would record its edge twice).
  const symbolOrder = [...new Set([...ag.nonterminals, ...ag.terminals])];
  // A symbol used in a body but declared in neither list would be silently
  // skipped by that loop, truncating the collection; reject it instead.
  const declared = new Set(symbolOrder);
  for (const p of ag.productions) {
    for (const x of p.rhs) {
      if (!declared.has(x)) {
        throw new Error(
          `grammar symbol '${x}' appears in the body of ${formatProduction(p)} but is declared neither as a nonterminal nor as a terminal of ${grammar.name}`,
        );
      }
    }
  }

  yield [
    {
      kind: 'lr0/start',
      grammarName: grammar.name,
      augmentedProduction: formatProduction(augProd),
    },
    {
      cite: { section: '4.6.2', rule: "augmented grammar G': add S' → S so acceptance is exactly the reduction by S' → S" },
      prose: `Augment the grammar with ${formatProduction(augProd)}; the canonical LR(0) collection is built for the augmented grammar G'.`,
      level: 'macro',
      section: 'Augment',
    },
  ];

  /** kernel-key → state id (the closure is a function of the kernel). */
  const stateByKernel = new Map<string, number>();
  const kernelKeyOf = (kernel: Lr0ItemJson[]) =>
    kernel.map(itemKey).sort().join(',');

  function* newState(kernel: Lr0ItemJson[], section: string): Steps<Lr0Event, number> {
    const id = coll.states.length;
    const st: Lr0StateJson = { id, items: kernel.map((k) => ({ ...k })) };
    coll.states.push(st);
    stateByKernel.set(kernelKeyOf(kernel), id);
    yield [
      { kind: 'lr0/state', id, kernel: kernel.map((k) => ({ ...k })) },
      {
        cite: { section: '4.6.2', figureOrAlgo: 'Fig 4.33 (items)' },
        prose: `New state I${id} with kernel {${kernel.map((k) => formatDotted(ag, k.prod, k.dot)).join('; ')}} is added to the collection C; its closure follows.`,
        level: 'macro',
        groupId: `lr0:closure:I${id}`,
        section,
      },
    ];
    yield* closureSteps(ag, st, section);
    return id;
  }

  // I0 = CLOSURE({ [S' → ·S] })
  yield* newState([{ prod: augProd.id, dot: 0, kernel: true }], 'I0');

  const worklist: number[] = [0];
  while (worklist.length > 0) {
    const i = worklist.shift()!; // FIFO — reproduces the book's numbering
    const section = `I${i}`;
    const src = coll.states[i]!;
    // One pass over the items collects, per symbol, the advanced kernel items.
    const moved = new Map<string, Lr0ItemJson[]>();
    for (const it of src.items) {
      const p = ag.productions[it.prod]!;
      const x = p.rhs[it.dot];
      if (x === undefined) continue;
      const l = moved.get(x) ?? [];
      l.push({ prod: it.prod, dot: it.dot + 1, kernel: true });
      moved.set(x, l);
    }
    for (const x of symbolOrder) {
      const kernel = moved.get(x);
      if (!kernel) continue;
      const key = kernelKeyOf(kernel);
      const existing = stateByKernel.get(key);
      const isNew = existing === undefined;
      const to = existing ?? coll.states.length;
      // Fig 4.33 adds GOTO(I, X) to C first and only then is the edge a fact:
      // create the target state BEFORE recording the transition, so no reduced
      // state ever contains an edge to a state that does not exist yet.
      if (isNew) {
        yield* newState(kernel, section);
        worklist.push(to);
      }
      coll.transitions.push({ from: i, symbol: x, to });
      yield [
        { kind: 'lr0/goto', from: i, symbol: x, to, isNew },
        {
          cite: { section: '4.6.2', figureOrAlgo: 'Fig 4.33 (items)', rule: 'GOTO(I, X) = CLOSURE of { [A → αX·β] : [A → α·Xβ] ∈ I }' },
          prose: isNew
            ? `GOTO(I${i}, ${x}): advancing the dot over ${x} gives kernel {${kernel.map((k) => formatDotted(ag, k.prod, k.dot)).join('; ')}} — a set not yet in C, so it was added as the new state I${to}, and the edge I${i} —${x}→ I${to} is recorded.`
            : `GOTO(I${i}, ${x}): advancing the dot over ${x} gives {${kernel.map((k) => formatDotted(ag, k.prod, k.dot)).join('; ')}}, which is already state I${to} — only the transition is recorded.`,
          level: 'macro',
          section,
          irRefs: [{ kind: 'grammarSymbol', id: x }],
        },
      ];
    }
  }

  return coll;
}

export type Lr0Result = Lr0Collection;

/** Convenience: record the canonical LR(0) collection trace. */
export function lr0ItemsRun(
  grammar: Grammar,
  opts?: { id?: string },
): Recorded<Lr0UiState, Lr0Event, Lr0Result> {
  return record(() => lr0Items(grammar), lr0Initial(), lr0Reducer, {
    id: opts?.id ?? 'syntax.lr0-items',
  });
}
