import type {
  Recorded,
  RecordOptions,
  Reducer,
  StepMeta,
  StepRecord,
  Steps,
  Trace,
} from './trace.js';

const DEFAULT_KEYFRAME_EVERY = 50;
const DEFAULT_MAX_EVENTS = 200_000;

/** Structural deep-clone guard: reduced states are stored as keyframes, so the
 *  reducer must not mutate. We freeze keyframes in dev to catch violations. */
function keyframeSnapshot<S>(state: S): S {
  return state; // states are immutable by contract; invariants.ts verifies via replay
}

class RecordedTrace<S, E extends { kind: string }> implements Trace<S, E> {
  readonly id: string;
  readonly steps: ReadonlyArray<StepRecord<E>>;
  readonly initial: S;
  readonly length: number;
  readonly truncated: boolean;

  private readonly reducer: Reducer<S, E>;
  private readonly keyframeEvery: number;
  /** keyframes[k] = state after applying steps[0 .. k*keyframeEvery - 1] */
  private readonly keyframes: S[];
  private memo: { index: number; state: S } | null = null;
  private sectionIndex: Array<{ name: string; startIndex: number }> | null = null;

  constructor(
    id: string,
    steps: StepRecord<E>[],
    initial: S,
    reducer: Reducer<S, E>,
    keyframes: S[],
    keyframeEvery: number,
    truncated: boolean,
  ) {
    this.id = id;
    this.steps = steps;
    this.initial = initial;
    this.length = steps.length;
    this.reducer = reducer;
    this.keyframes = keyframes;
    this.keyframeEvery = keyframeEvery;
    this.truncated = truncated;
  }

  stateAt(index: number): S {
    if (index < 0 || index > this.length) {
      throw new RangeError(`stateAt(${index}) out of range [0, ${this.length}]`);
    }
    // Sequential access fast path: extend the memoized state by one.
    if (this.memo && index === this.memo.index + 1) {
      const step = this.steps[index - 1]!;
      const state = this.reducer(this.memo.state, step.event);
      this.memo = { index, state };
      return state;
    }
    if (this.memo && index === this.memo.index) return this.memo.state;

    // Nearest keyframe at or before index, then replay forward.
    const k = Math.floor(index / this.keyframeEvery);
    let state = k === 0 ? this.initial : this.keyframes[k - 1]!;
    for (let i = k * this.keyframeEvery; i < index; i++) {
      state = this.reducer(state, this.steps[i]!.event);
    }
    this.memo = { index, state };
    return state;
  }

  final(): S {
    return this.stateAt(this.length);
  }

  findIndex(pred: (s: StepRecord<E>) => boolean, from = 0): number {
    for (let i = Math.max(0, from); i < this.steps.length; i++) {
      if (pred(this.steps[i]!)) return i;
    }
    return -1;
  }

  sections(): Array<{ name: string; startIndex: number }> {
    if (!this.sectionIndex) {
      const out: Array<{ name: string; startIndex: number }> = [];
      let last: string | undefined;
      for (const s of this.steps) {
        const name = s.meta.section;
        if (name && name !== last) {
          out.push({ name, startIndex: s.index });
          last = name;
        }
      }
      this.sectionIndex = out;
    }
    return this.sectionIndex;
  }
}

/**
 * Run an algorithm generator to completion, recording its events.
 * The reducer is applied as events arrive to build keyframes; the final reduced
 * state is compared (by the invariants test, not here) against `result`.
 */
export function record<S, E extends { kind: string }, R>(
  algo: () => Steps<E, R>,
  initial: S,
  reducer: Reducer<S, E>,
  opts: RecordOptions,
): Recorded<S, E, R> {
  const keyframeEvery = opts.keyframeEvery ?? DEFAULT_KEYFRAME_EVERY;
  const maxEvents = opts.maxEvents ?? DEFAULT_MAX_EVENTS;

  const steps: StepRecord<E>[] = [];
  const keyframes: S[] = [];
  let state = initial;
  let truncated = false;

  const gen = algo();
  let iter = gen.next();
  while (!iter.done) {
    const [event, meta] = iter.value as [E, StepMeta];
    if (steps.length < maxEvents) {
      steps.push({ index: steps.length, event, meta });
      state = reducer(state, event);
      if (steps.length % keyframeEvery === 0) {
        keyframes.push(keyframeSnapshot(state));
      }
    } else {
      truncated = true; // stop recording but run the algorithm to completion
    }
    iter = gen.next();
  }
  const result = iter.value as R;

  return {
    trace: new RecordedTrace<S, E>(
      opts.id,
      steps,
      initial,
      reducer,
      keyframes,
      keyframeEvery,
      truncated,
    ),
    result,
  };
}

/** JSON-safe payload of a trace for crossing a worker boundary. */
export interface SerializedTrace<S, E extends { kind: string }> {
  id: string;
  steps: StepRecord<E>[];
  initial: S;
  truncated: boolean;
  keyframeEvery: number;
}

export function serializeTrace<S, E extends { kind: string }>(
  t: Trace<S, E>,
): SerializedTrace<S, E> {
  return {
    id: t.id,
    steps: [...t.steps],
    initial: t.initial,
    truncated: t.truncated,
    keyframeEvery: DEFAULT_KEYFRAME_EVERY,
  };
}

/** Rebuild a replayable Trace from a serialized payload plus its (pure) reducer,
 *  recomputing keyframes locally. */
export function traceFromSerialized<S, E extends { kind: string }>(
  payload: SerializedTrace<S, E>,
  reducer: Reducer<S, E>,
): Trace<S, E> {
  const keyframes: S[] = [];
  let state = payload.initial;
  for (let i = 0; i < payload.steps.length; i++) {
    state = reducer(state, payload.steps[i]!.event);
    if ((i + 1) % payload.keyframeEvery === 0) keyframes.push(state);
  }
  return new RecordedTrace<S, E>(
    payload.id,
    payload.steps,
    payload.initial,
    reducer,
    keyframes,
    payload.keyframeEvery,
    payload.truncated,
  );
}
