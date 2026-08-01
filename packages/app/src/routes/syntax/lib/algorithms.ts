/**
 * The ten selectable syntax algorithms (?algo=), each mapped to the trace kind
 * it replays. Everything the shell needs to decide what to fetch, what to warn
 * about, and how to label the view lives here.
 */
import type { TraceKind } from '../../../worker/trace-kinds';

export type AlgoId =
  | 'first-follow'
  | 'll1-table'
  | 'll1-parse'
  | 'rd'
  | 'transforms'
  | 'lr0'
  | 'slr'
  | 'lr1'
  | 'lalr'
  | 'lr-parse';

export type AlgoFamily = 'grammar' | 'll' | 'lr';

export interface AlgoMeta {
  id: AlgoId;
  label: string;
  family: AlgoFamily;
  kind: TraceKind;
  /** §/Algorithm anchor shown next to the view title. */
  cite: string;
  blurb: string;
  /** Needs an input sentence (and, for the C grammars, a compiled program). */
  needsInput: boolean;
  /** Top-down: impossible on a left-recursive grammar (would not terminate). */
  topDown: boolean;
}

export const ALGORITHMS: readonly AlgoMeta[] = [
  {
    id: 'first-follow',
    label: 'FIRST / FOLLOW',
    family: 'grammar',
    kind: 'syntax.first-follow',
    cite: '§4.4.2 · Example 4.30',
    blurb:
      'The fixed-point computation: repeat passes over the productions until no terminal or ε can be added to any set.',
    needsInput: false,
    topDown: false,
  },
  {
    id: 'transforms',
    label: 'Grammar transforms',
    family: 'grammar',
    kind: 'syntax.transforms',
    cite: '§4.3.3 Algo 4.19 · §4.3.4 Algo 4.21',
    blurb:
      'Make a grammar fit for top-down parsing: eliminate left recursion, then left-factor the result.',
    needsInput: false,
    topDown: false,
  },
  {
    id: 'll1-table',
    label: 'LL(1) table',
    family: 'll',
    kind: 'syntax.ll1-table',
    cite: '§4.4.3 · Algorithm 4.31 (Fig 4.17)',
    blurb:
      'Fill M[A, a] from FIRST(α) and, when α ⇒* ε, from FOLLOW(A). A cell with two productions proves the grammar is not LL(1).',
    needsInput: false,
    topDown: false,
  },
  {
    id: 'll1-parse',
    label: 'LL(1) parse',
    family: 'll',
    kind: 'syntax.ll1-parse',
    cite: '§4.4.4 · Algorithm 4.34 (Fig 4.19/4.21)',
    blurb:
      'The table-driven predictive parser: an explicit stack, one lookahead token, and the productions it outputs.',
    needsInput: true,
    topDown: true,
  },
  {
    id: 'rd',
    label: 'Recursive descent',
    family: 'll',
    kind: 'syntax.rd',
    cite: '§4.4.1 (Fig 4.13/4.14)',
    blurb:
      'One procedure per nonterminal; the lookahead picks the production whose prediction set contains it.',
    needsInput: true,
    topDown: true,
  },
  {
    id: 'lr0',
    label: 'LR(0) items',
    family: 'lr',
    kind: 'syntax.lr0',
    cite: '§4.6.2 · Algorithm 4.32 (Fig 4.31)',
    blurb:
      'The canonical collection of sets of LR(0) items: CLOSURE grows each state, GOTO wires the automaton.',
    needsInput: false,
    topDown: false,
  },
  {
    id: 'slr',
    label: 'SLR(1)',
    family: 'lr',
    kind: 'syntax.slr',
    cite: '§4.6.4 · Algorithm 4.46 (Fig 4.37)',
    blurb:
      'ACTION/GOTO from the LR(0) automaton, reducing on every terminal of FOLLOW(A) — the coarsest of the three lookahead rules.',
    needsInput: false,
    topDown: false,
  },
  {
    id: 'lr1',
    label: 'LR(1) items',
    family: 'lr',
    kind: 'syntax.lr1',
    cite: '§4.7.2 · Algorithm 4.53 (Fig 4.41)',
    blurb:
      'Canonical LR(1): every item carries its own lookahead, so states split by the contexts they can be reached from.',
    needsInput: false,
    topDown: false,
  },
  {
    id: 'lalr',
    label: 'LALR(1)',
    family: 'lr',
    kind: 'syntax.lalr',
    cite: '§4.7.4 · Algorithm 4.59 (Fig 4.43)',
    blurb:
      'Merge LR(1) states with the same core, union their lookaheads, then build the table — the parser generators’ method.',
    needsInput: false,
    topDown: false,
  },
  {
    id: 'lr-parse',
    label: 'LR parse',
    family: 'lr',
    kind: 'syntax.lr-parse',
    cite: '§4.6.3 · Algorithm 4.44 (Fig 4.36/4.38)',
    blurb:
      'The shift-reduce driver. The same code runs an SLR or an LALR table — only the table changes.',
    needsInput: true,
    topDown: false,
  },
];

export const DEFAULT_ALGO: AlgoId = 'first-follow';

/** ?algo= values used by lib/phases.tsx (the shell’s planned ids) map here. */
const ALIASES: Record<string, AlgoId> = {
  ll1: 'll1-table',
  'll1table': 'll1-table',
  lalr1: 'lalr',
  'lr1-items': 'lr1',
  'lr0-items': 'lr0',
  'recursive-descent': 'rd',
  parse: 'lr-parse',
};

export function resolveAlgo(raw: string | null | undefined): AlgoId {
  if (!raw) return DEFAULT_ALGO;
  const direct = ALGORITHMS.find((a) => a.id === raw);
  if (direct) return direct.id;
  return ALIASES[raw] ?? DEFAULT_ALGO;
}

export function algoMeta(id: AlgoId): AlgoMeta {
  return ALGORITHMS.find((a) => a.id === id) ?? ALGORITHMS[0]!;
}

/**
 * The algorithms that refuse a left-recursive grammar, and so are the only
 * legal values of `?from=` — the algorithm the reader was sent to the transform
 * view *from*, and the one the transform view sends them back to.
 */
export const TOP_DOWN_ALGOS: readonly AlgoId[] = ALGORITHMS.filter((a) => a.topDown).map(
  (a) => a.id,
);

/** Where "parse with this grammar" goes when nothing recorded an origin. */
export const DEFAULT_RETURN_ALGO: AlgoId = 'll1-parse';

// ── Phase-specific sub-selections ────────────────────────────────────────────

export type TransformStage = 'eliminate-left-recursion' | 'left-factor';
export const TRANSFORM_STAGES: ReadonlyArray<{ id: TransformStage; label: string }> = [
  { id: 'eliminate-left-recursion', label: 'Eliminate left recursion' },
  { id: 'left-factor', label: 'Left factor' },
];

export type LrTableChoice = 'slr' | 'lalr';
export const LR_TABLES: ReadonlyArray<{ id: LrTableChoice; label: string }> = [
  { id: 'lalr', label: 'LALR(1) table' },
  { id: 'slr', label: 'SLR(1) table' },
];

/** LR(1) has two traces: the item sets, and the table built from them. */
export type Lr1View = 'items' | 'table';
export const LR1_VIEWS: ReadonlyArray<{ id: Lr1View; label: string }> = [
  { id: 'items', label: 'Item sets' },
  { id: 'table', label: 'ACTION / GOTO' },
];
