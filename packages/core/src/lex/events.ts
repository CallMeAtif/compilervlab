/**
 * Event unions for the four traced lexical-analysis algorithms.
 * Every event is plain JSON and carries everything its reducer needs — the
 * replay invariant (reduce(all events) ≡ returned artifact) is CI-enforced.
 */

import type { SourceSpan } from '@lab/trace';
import type { Token } from '../csubset/tokens.js';
import type { DfaAccept, MinDfa, NfaEdge } from './types.js';

// ---------------------------------------------------------------------------
// Thompson's construction (Algorithm 3.23, §3.7.4)
// ---------------------------------------------------------------------------

export type ThompsonEvent =
  | {
      kind: 'leafChar';
      regexNodeId: number;
      ch: string;
      start: number;
      end: number;
      createdStates: number[];
      createdEdges: NfaEdge[];
    }
  | {
      kind: 'leafEpsilon';
      regexNodeId: number;
      start: number;
      end: number;
      createdStates: number[];
      createdEdges: NfaEdge[];
    }
  | {
      kind: 'union';
      regexNodeId: number;
      start: number;
      end: number;
      leftStart: number;
      leftEnd: number;
      rightStart: number;
      rightEnd: number;
      createdStates: number[];
      createdEdges: NfaEdge[];
    }
  | {
      kind: 'concat';
      regexNodeId: number;
      start: number;
      end: number;
      /** Accepting state of N(s) merged with the start state of N(t). */
      mergedState: number;
      createdStates: number[];
      createdEdges: NfaEdge[];
    }
  | {
      kind: 'star';
      regexNodeId: number;
      start: number;
      end: number;
      innerStart: number;
      innerEnd: number;
      createdStates: number[];
      createdEdges: NfaEdge[];
    }
  | { kind: 'complete'; start: number; accept: number; numStates: number };

// ---------------------------------------------------------------------------
// Subset construction (Algorithm 3.20, §3.7.1; ε-closure per Fig 3.33)
// ---------------------------------------------------------------------------

export type SubsetEvent =
  | { kind: 'init'; alphabet: string[]; nfaStart: number }
  | {
      kind: 'eclosureInit';
      /** move() result (or {s0}) whose closure is being computed. */
      input: number[];
      stack: number[];
      closure: number[];
      context: string; // e.g. "move(A, a)" or "start state"
    }
  | { kind: 'eclosurePop'; state: number; stack: number[] }
  | { kind: 'eclosureAdd'; state: number; via: number; stack: number[]; closure: number[] }
  | {
      kind: 'dstateCreated';
      id: string;
      nfaStates: number[];
      accept: DfaAccept | null;
      isStart: boolean;
    }
  | { kind: 'dstateMarked'; id: string }
  | { kind: 'dtranSet'; from: string; symbol: string; to: string }
  /** move(T, a) = ∅, so U = ε-closure(∅) = ∅ — Fig 3.32's dead state. The lab
   *  keeps Dtran partial (no entry), so the step is recorded rather than
   *  silently skipped; Algorithm 3.39 re-introduces ∅ if it needs a total
   *  transition function. */
  | { kind: 'emptyMove'; from: string; symbol: string }
  | { kind: 'complete'; numStates: number };

// ---------------------------------------------------------------------------
// DFA minimization (Algorithm 3.39, §3.9.6)
// ---------------------------------------------------------------------------

export interface SignatureCell {
  symbol: string;
  to: string;
  // Index of the target's group in Π as it stood at the START of this round —
  // Algorithm 3.39 holds Π fixed for a whole round (`MinimizeState.partition`).
  group: number;
}

export type MinimizeEvent =
  /** Step 4's other clean-up, applied first: states the start state cannot reach. */
  | { kind: 'unreachableRemoved'; states: string[] }
  | { kind: 'deadStateAdded'; name: string; missingTransitions: number }
  | {
      kind: 'initPartition';
      groups: Array<{ states: string[]; accept: string | null }>;
    }
  | { kind: 'signature'; state: string; row: SignatureCell[]; group: number; round: number }
  | { kind: 'split'; round: number; from: string[]; into: string[][]; symbol: string }
  | { kind: 'groupUnchanged'; round: number; states: string[] }
  | { kind: 'fixpoint'; rounds: number }
  | { kind: 'deadStateRemoved'; name: string; groupMembers: string[] }
  | {
      kind: 'representative';
      members: string[];
      representative: string;
      accept: string | null;
    }
  | { kind: 'finalTable'; dfa: MinDfa };

// ---------------------------------------------------------------------------
// Scanner driver (§3.8.3: simulation with longest match + lastAccept rollback)
// ---------------------------------------------------------------------------

export type ScanEvent =
  | { kind: 'wsSkipped'; span: SourceSpan; pos: number }
  | { kind: 'commentSkipped'; style: 'line' | 'block'; span: SourceSpan; pos: number }
  | { kind: 'tokenStart'; startPos: number; dfaState: string; pos: number }
  | {
      kind: 'advance';
      from: string;
      ch: string;
      to: string;
      /** Token accepted by `to`, if any — updates lastAccept (§3.8.3). */
      accepting: string | null;
      pos: number;
    }
  | {
      kind: 'rollback';
      fromPos: number;
      toPos: number;
      token: string;
      /** The accepting state the machine backs up INTO — after retraction the
       *  DFA is in this state, not in the dead-end state it stopped at. */
      toState: string;
      /** Why the simulation loop stopped: no edge on the character at
       *  `fromPos`, or the input was exhausted. Both retract (§3.8.3). */
      reason: 'noTransition' | 'endOfInput';
      pos: number;
    }
  | { kind: 'keywordLookup'; lexeme: string; isKeyword: boolean; pos: number }
  | {
      kind: 'charStep';
      stage: 'open' | 'char' | 'escape' | 'close';
      ch: string | null;
      code: number | null;
      pos: number;
    }
  | {
      kind: 'tokenEmitted';
      token: Token;
      symbol: { id: number; lexeme: string; isNew: boolean } | null;
      pos: number;
    }
  | { kind: 'lexError'; message: string; hint: string | null; span: SourceSpan; pos: number }
  | { kind: 'done'; pos: number };
