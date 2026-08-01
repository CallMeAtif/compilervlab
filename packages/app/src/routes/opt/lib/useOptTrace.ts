/**
 * Trace plumbing for the optimization phase.
 *
 * `useOptTrace` asks the compile worker for a SerializedTrace and rebuilds it
 * locally with the reducer named in worker/trace-kinds.ts. `useReplay` folds a
 * SUBSET of a trace's events through a second reducer — `opt.pass` traces
 * interleave the pass's own analysis events (blocks / CFG / dataflow /
 * dominators / loops) which `passReducer` deliberately ignores, so the analysis
 * tables next to the diff are produced by replaying exactly those events.
 *
 * The analysis reducers are exhaustive switches with no default arm: feeding
 * them a foreign event returns `undefined`. Every replay therefore filters by
 * the event kinds that belong to its reducer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Diagnostic } from '@lab/core';
import type { Reducer, StepRecord, Trace } from '@lab/trace';
import { traceFromSerialized } from '@lab/trace';
import { getCompilerClient, type TraceRequest } from '../../../worker/api';

export type TraceStatus = 'loading' | 'ready' | 'unavailable' | 'failed';

export interface TraceLoad<S, E extends { kind: string }> {
  status: TraceStatus;
  trace: Trace<S, E> | null;
  /** Why the worker returned no trace (upstream compilation diagnostics). */
  diagnostics: Diagnostic[];
  /** Worker/transport failure message (not a compilation diagnostic). */
  error: string | null;
}

const LOADING: TraceLoad<never, never> = {
  status: 'loading',
  trace: null,
  diagnostics: [],
  error: null,
};

/**
 * Fetch + rebuild one trace. `request` may be null (nothing to load yet).
 * The reducer is read through a ref so an inline arrow never re-triggers work;
 * requests are keyed by kind + params.
 */
export function useOptTrace<S, E extends { kind: string }>(
  request: TraceRequest | null,
  reducer: Reducer<S, E>,
): TraceLoad<S, E> {
  const reducerRef = useRef(reducer);
  reducerRef.current = reducer;

  const key = request ? `${request.kind}|${JSON.stringify(request.params)}` : null;
  const requestRef = useRef(request);
  requestRef.current = request;

  const [load, setLoad] = useState<TraceLoad<S, E>>(LOADING as TraceLoad<S, E>);

  useEffect(() => {
    const req = requestRef.current;
    if (key === null || req === null) return;
    let cancelled = false;
    setLoad(LOADING as TraceLoad<S, E>);
    getCompilerClient()
      .getTraceOrError(req)
      .then((response) => {
        if (cancelled) return;
        if (!response.trace) {
          setLoad({
            status: 'unavailable',
            trace: null,
            diagnostics: response.diagnostics,
            error: null,
          });
          return;
        }
        const trace = traceFromSerialized<S, E>(
          response.trace as never,
          reducerRef.current,
        );
        setLoad({ status: 'ready', trace, diagnostics: [], error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad({
          status: 'failed',
          trace: null,
          diagnostics: [],
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return load;
}

// ── Replaying a foreign reducer over a trace's events ────────────────────────

export interface ReplaySpec<S, E extends { kind: string }> {
  kinds: ReadonlySet<string>;
  reducer: Reducer<S, E>;
  initial: S;
}

export function replayEvents<S, E extends { kind: string }>(
  steps: ReadonlyArray<StepRecord<{ kind: string }>>,
  upTo: number,
  spec: ReplaySpec<S, E>,
  from = 0,
): S {
  let state = spec.initial;
  const end = Math.min(upTo, steps.length);
  for (let i = Math.max(0, from); i < end; i++) {
    const step = steps[i];
    if (!step || !spec.kinds.has(step.event.kind)) continue;
    state = spec.reducer(state, step.event as unknown as E);
  }
  return state;
}

/**
 * Fold the first `index` events of `trace` that belong to `spec` through its
 * reducer. Optimization traces are small (hundreds of events), so folding from
 * the start on every cursor move is cheaper than maintaining keyframes.
 */
export function useReplay<S, E extends { kind: string }>(
  trace: Trace<unknown, { kind: string }> | null,
  index: number,
  spec: ReplaySpec<S, E>,
  from = 0,
): S {
  return useMemo(
    () => (trace ? replayEvents(trace.steps, index, spec, from) : spec.initial),
    [trace, index, spec, from],
  );
}

/** Index of the last event at/before the cursor whose kind is in `kinds`, or 0. */
export function lastIndexOfKind(
  trace: Trace<unknown, { kind: string }> | null,
  index: number,
  kinds: ReadonlySet<string>,
): number {
  if (!trace) return 0;
  for (let i = Math.min(index, trace.steps.length) - 1; i >= 0; i--) {
    const step = trace.steps[i];
    if (step && kinds.has(step.event.kind)) return i;
  }
  return 0;
}

/** The last event at/before the cursor whose kind is in `kinds`, or null. */
export function lastEventOfKind<E extends { kind: string }>(
  trace: Trace<unknown, E> | null,
  index: number,
  kinds: ReadonlySet<string>,
): E | null {
  if (!trace) return null;
  for (let i = Math.min(index, trace.steps.length) - 1; i >= 0; i--) {
    const step = trace.steps[i];
    if (step && kinds.has(step.event.kind)) return step.event;
  }
  return null;
}

// ── Event-kind partitions of the shared PassEvent union ──────────────────────

export const DATAFLOW_KINDS: ReadonlySet<string> = new Set([
  'df-problem',
  'df-init',
  'df-iteration',
  'df-update',
  'df-converged',
]);

export const BLOCK_KINDS: ReadonlySet<string> = new Set(['leader-found', 'block-formed']);

export const CFG_KINDS: ReadonlySet<string> = new Set(['cfg-edge']);

export const DOMINATOR_KINDS: ReadonlySet<string> = new Set([
  'dom-init',
  'dom-iteration',
  'dom-update',
  'dom-converged',
]);

export const LOOP_KINDS: ReadonlySet<string> = new Set([
  'back-edge',
  'loop-node-added',
  'loop-found',
]);

export const LICM_KINDS: ReadonlySet<string> = new Set(['licm-invariant', 'licm-legality']);

export const REWRITE_KINDS: ReadonlySet<string> = new Set([
  'rewrite',
  'rewrite-skipped',
  'pass-begin',
  'pass-end',
]);
