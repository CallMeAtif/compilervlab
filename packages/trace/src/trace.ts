/**
 * Step-recorder / replay abstraction — the single contract every algorithm
 * in the Compiler Virtual Lab builds against. See docs/PLAN.md.
 *
 * Algorithms are pure generators yielding typed JSON events; the UI replays a
 * pure reducer over them. Keyframes (periodic reduced-state snapshots) give
 * fast stateAt(i) for jump-to-step and O(1) sequential next/prev.
 */

/** Every event and every reduced state must be a plain JSON value (structured-clone safe). */
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

/** Half-open span into the original C source. */
export interface SourceSpan {
  start: number; // absolute offset, inclusive
  end: number; // absolute offset, exclusive
  line: number; // 1-based
  col: number; // 1-based
}

/** Provenance pointer into an upstream artifact. */
export interface IrRef {
  kind: 'token' | 'astNode' | 'tacInstr' | 'block' | 'asmLine' | 'grammarSymbol' | 'production';
  id: number | string;
}

/** Citation anchoring a step to the Dragon Book (2nd ed.). Mandatory: an
 *  unciteable step is a design smell. */
export interface Citation {
  section: string; // e.g. "4.6.2"
  figureOrAlgo?: string; // e.g. "Algorithm 4.53", "Fig 3.33"
  rule?: string; // e.g. "FOLLOW rule 3: A → αB ⇒ FOLLOW(A) ⊆ FOLLOW(B)"
}

export type StepLevel = 'macro' | 'micro';

export interface StepMeta {
  cite: Citation;
  /** Human explanation of THIS step, written by the algorithm. */
  prose: string;
  level: StepLevel;
  /** Micro-steps grouped under their governing macro step. */
  groupId?: string;
  /** Named section for scrubber tick-marks ("Thompson", "Subset construction", …). */
  section?: string;
  srcSpans?: SourceSpan[];
  irRefs?: IrRef[];
}

export interface StepRecord<E extends { kind: string }> {
  index: number;
  event: E;
  meta: StepMeta;
}

/** Reducer MUST be pure and treat state as immutable (always return new state). */
export type Reducer<S, E> = (state: S, event: E) => S;

/** The shape of an algorithm implementation: a generator yielding
 *  [event, meta] pairs and returning the final artifact. It never touches the
 *  recorder or the UI. */
export type Steps<E, R> = Generator<[E, StepMeta], R, void>;

export interface Trace<S, E extends { kind: string }> {
  readonly id: string; // e.g. "lex.subset-construction"
  readonly steps: ReadonlyArray<StepRecord<E>>;
  readonly initial: S;
  /** Number of steps. Valid cursor positions are 0..length (0 = initial state). */
  readonly length: number;
  /** True if recording stopped at maxEvents; UI must surface a banner. */
  readonly truncated: boolean;
  /** State after applying steps[0..index-1]; index in [0, length]. */
  stateAt(index: number): S;
  final(): S;
  /** Index of first step at/after `from` matching pred, or -1. */
  findIndex(pred: (s: StepRecord<E>) => boolean, from?: number): number;
  /** Named sections in order of first appearance: for scrubber tick-marks. */
  sections(): Array<{ name: string; startIndex: number }>;
}

export interface RecordOptions {
  id: string;
  /** Snapshot the reduced state every N events (default 50). */
  keyframeEvery?: number;
  /** Hard cap on recorded events (default 200_000). Recording stops,
   *  `truncated` is set, and the generator is run to completion untraced so
   *  the returned artifact is still exact. */
  maxEvents?: number;
}

export interface Recorded<S, E extends { kind: string }, R> {
  trace: Trace<S, E>;
  result: R;
}
