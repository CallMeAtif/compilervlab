/**
 * Trace loading for the /codegen tabs.
 *
 * Every tab asks the compile worker for one trace kind (see
 * `worker/trace-kinds.ts`), then rebuilds it locally with that kind's pure
 * reducer — the UI never re-derives algorithm state, it only replays it.
 *
 * Payloads are cached per (kind, params) on the UI thread so switching tabs
 * back and forth (or re-selecting a function) never re-crosses the worker
 * boundary; the worker memoizes on its side as well.
 */
import { useEffect, useRef, useState } from 'react';
import type { Reducer, Trace } from '@lab/trace';
import { traceFromSerialized } from '@lab/trace';
import type { Diagnostic } from '@lab/core';
import type { AnySerializedTrace } from '../../worker/api';
import { getCompilerClient } from '../../worker/api';
import type { TraceKind } from '../../worker/trace-kinds';

export type TraceStatus =
  /** Nothing requested yet (no compilation, or the tab is not active). */
  | 'idle'
  /** The worker is computing (most kinds < 100ms). */
  | 'loading'
  /** `trace` is non-null and replayable. */
  | 'ready'
  /** The worker returned no trace; `diagnostics` says why. */
  | 'unavailable';

export interface CodegenTrace<S, E extends { kind: string }> {
  status: TraceStatus;
  trace: Trace<S, E> | null;
  /** Why `trace` is null (upstream phase diagnostics, or a lab-internal one). */
  diagnostics: Diagnostic[];
}

interface CacheEntry {
  payload: AnySerializedTrace | null;
  diagnostics: Diagnostic[];
}

/** Small FIFO payload cache — keys embed the whole source, so cap the size. */
const CACHE_LIMIT = 12;
const cache = new Map<string, CacheEntry>();

function cacheKey(kind: string, params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  return `${kind}|${JSON.stringify(keys.map((k) => [k, params[k]]))}`;
}

function remember(key: string, entry: CacheEntry): void {
  cache.set(key, entry);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

/**
 * Fetch + rebuild one trace. `params` may be null (or `enabled` false) to keep
 * the hook idle — that is how inactive tabs avoid paying for their trace.
 */
export function useCodegenTrace<S, E extends { kind: string }>(
  kind: TraceKind,
  params: Record<string, unknown> | null,
  reducer: Reducer<S, E>,
  enabled = true,
): CodegenTrace<S, E> {
  const key = params === null || !enabled ? null : cacheKey(kind, params);
  const [result, setResult] = useState<CodegenTrace<S, E>>({
    status: 'idle',
    trace: null,
    diagnostics: [],
  });

  // The reducer is a module-level constant per kind; keep it out of the effect
  // dependency list so a re-render never re-requests the payload.
  const reducerRef = useRef(reducer);
  reducerRef.current = reducer;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    if (key === null) {
      setResult({ status: 'idle', trace: null, diagnostics: [] });
      return;
    }
    let cancelled = false;

    const build = (entry: CacheEntry): CodegenTrace<S, E> =>
      entry.payload === null
        ? { status: 'unavailable', trace: null, diagnostics: entry.diagnostics }
        : {
            status: 'ready',
            trace: traceFromSerialized<S, E>(
              entry.payload as never,
              reducerRef.current,
            ),
            diagnostics: [],
          };

    const hit = cache.get(key);
    if (hit) {
      setResult(build(hit));
      return;
    }

    setResult({ status: 'loading', trace: null, diagnostics: [] });
    getCompilerClient()
      .getTraceOrError({ kind, params: paramsRef.current ?? {} })
      .then((res) => {
        const entry: CacheEntry = { payload: res.trace, diagnostics: res.diagnostics };
        remember(key, entry);
        if (!cancelled) setResult(build(entry));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({
          status: 'unavailable',
          trace: null,
          diagnostics: [
            {
              phase: 'codegen',
              severity: 'error',
              message: `The compile worker failed to build the '${kind}' trace: ${
                err instanceof Error ? err.message : String(err)
              }`,
              hint: 'This is a lab problem, not a problem with your program. Recompiling usually clears it.',
              span: { start: 0, end: 0, line: 1, col: 1 },
            },
          ],
        });
      });

    return () => {
      cancelled = true;
    };
  }, [key, kind]);

  return result;
}
