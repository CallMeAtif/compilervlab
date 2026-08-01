/**
 * Shared automata types for the lexical-analysis phase (Dragon Book ch. 3).
 * All shapes are plain JSON: sorted number arrays for state sets, `null` edge
 * labels for ε, and records/arrays everywhere (no Map/Set in artifacts).
 */

/** One NFA transition. `label === null` means an ε-edge. */
export interface NfaEdge {
  from: number;
  to: number;
  label: string | null;
}

/** Result of Thompson's construction (Algorithm 3.23): exactly one start and
 *  one accepting state. States are numbered 0..n-1 in the book's order. */
export interface Nfa {
  states: number[]; // ascending
  edges: NfaEdge[]; // creation order
  start: number;
  accept: number;
}

/** An accepting NFA state annotated with the token pattern it recognizes.
 *  Lower `priority` wins when a D-state contains several accepts (§3.8.1:
 *  the first-listed pattern takes precedence). */
export interface NfaAccept {
  state: number;
  token: string;
  priority: number;
}

/** An NFA with possibly many accepting states — the combined machine built
 *  from all token patterns of a lexical analyzer (§3.8.2). */
export interface MultiNfa {
  states: number[];
  edges: NfaEdge[];
  start: number;
  accepts: NfaAccept[];
}

export interface DfaAccept {
  token: string;
  priority: number;
}

/** A D-state of the subset construction: a named set of NFA states. */
export interface DfaState {
  id: string; // 'A', 'B', … in creation order
  nfaStates: number[]; // ascending
  accept: DfaAccept | null;
}

export interface DtranEntry {
  from: string;
  symbol: string;
  to: string;
}

/** Result of the subset construction (Algorithm 3.20). Transitions are listed
 *  in the order Dtran entries were filled in (Fig 3.37 row order). */
export interface Dfa {
  states: DfaState[]; // creation order
  start: string;
  alphabet: string[]; // sorted
  trans: DtranEntry[];
}

/** A state of the minimized DFA: a group of equivalent original DFA states,
 *  named after its representative (Algorithm 3.39 step 3). */
export interface MinDfaState {
  id: string; // representative's name
  members: string[]; // in original DFA creation order
  accept: DfaAccept | null;
}

/** Result of state minimization (Algorithm 3.39, §3.9.6). `rounds` is the
 *  number of refinement rounds until the fixpoint (final round included). */
export interface MinDfa {
  states: MinDfaState[];
  start: string;
  alphabet: string[];
  trans: DtranEntry[];
  rounds: number;
}

/** Wrap a single-accept Thompson NFA for the subset construction. */
export function toMultiNfa(nfa: Nfa, token = 'accept', priority = 0): MultiNfa {
  return {
    states: nfa.states,
    edges: nfa.edges,
    start: nfa.start,
    accepts: [{ state: nfa.accept, token, priority }],
  };
}

/** D-state names in creation order: A, B, …, Z, AA, AB, … (Fig 3.36 style). */
export function dstateName(i: number): string {
  let n = i;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Ascending numeric sort helper (state sets are kept sorted for determinism). */
export function sortedNums(xs: Iterable<number>): number[] {
  return [...xs].sort((a, b) => a - b);
}
