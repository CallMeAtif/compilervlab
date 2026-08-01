/**
 * Fetch one recorded trace from the compile worker and rebuild it locally with
 * its pure reducer (the contract in worker/trace-kinds.ts).
 *
 * The heavy lifting stays off the UI thread; this hook only owns the request
 * lifecycle (loading / ready / unavailable / failed) and a tiny LRU so that
 * flipping between the four tabs does not re-transfer a payload the worker has
 * already memoized — `lex.subset` payloads run to several megabytes.
 */
import { useEffect, useRef, useState } from 'react';
import type { Reducer, Trace } from '@lab/trace';
import { traceFromSerialized } from '@lab/trace';
import type { Diagnostic } from '@lab/core/common/types.js';
import { getCompilerClient, type AnySerializedTrace } from '../../worker/api';
import type { TraceKind } from '../../worker/trace-kinds';

export interface LexTraceRequest {
  kind: TraceKind;
  params: Record<string, unknown>;
}

export type LexTraceState<S, E extends { kind: string }> =
  /** No request yet (nothing compiled, or the view is gated). */
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; trace: Trace<S, E> }
  /** The worker could not build it; `diagnostics` says why. */
  | { status: 'unavailable'; diagnostics: Diagnostic[] }
  | { status: 'failed'; message: string };

export function requestKey(req: LexTraceRequest | null): string {
  return req === null ? '' : `${req.kind}#${JSON.stringify(req.params)}`;
}

interface CacheEntry {
  payload: AnySerializedTrace | null;
  diagnostics: Diagnostic[];
}

const CACHE_LIMIT = 4;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, entry: CacheEntry): void {
  cache.set(key, entry);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
}

export function useLexTrace<S, E extends { kind: string }>(
  request: LexTraceRequest | null,
  reducer: Reducer<S, E>,
): LexTraceState<S, E> {
  const key = requestKey(request);
  const [state, setState] = useState<LexTraceState<S, E>>({ status: 'idle' });

  // Reducers are module-level constants; keep them out of the effect deps so a
  // re-render never re-issues the request.
  const reducerRef = useRef(reducer);
  reducerRef.current = reducer;

  useEffect(() => {
    if (request === null) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;

    const settle = (entry: CacheEntry): void => {
      if (cancelled) return;
      if (entry.payload === null) {
        setState({ status: 'unavailable', diagnostics: entry.diagnostics });
        return;
      }
      setState({
        status: 'ready',
        trace: traceFromSerialized<S, E>(entry.payload as never, reducerRef.current),
      });
    };

    const cached = cacheGet(key);
    if (cached) {
      settle(cached);
      return () => {
        cancelled = true;
      };
    }

    setState({ status: 'loading' });
    getCompilerClient()
      .getTraceOrError({ kind: request.kind, params: request.params })
      .then((res) => {
        const entry: CacheEntry = { payload: res.trace, diagnostics: res.diagnostics };
        cacheSet(key, entry);
        settle(entry);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
