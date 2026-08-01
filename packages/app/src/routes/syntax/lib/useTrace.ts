/**
 * Fetch one trace payload from the compile worker and rebuild it locally with
 * its pure reducer (the contract in worker/trace-kinds.ts).
 *
 * Two-stage loading on purpose: the worker call is async, but
 * `traceFromSerialized` replays every event on the UI thread and is *not* free
 * for the big collections (the truncated canonical LR(1) run on the C grammar is
 * ~40 000 events). So the hook reports `phase: 'computing' | 'replaying'` and
 * yields to the browser between them, which lets the skeleton paint first.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Diagnostic } from '@lab/core';
import type { Reducer, Trace } from '@lab/trace';
import { traceFromSerialized } from '@lab/trace';
import { getCompilerClient } from '../../../worker/api';
import type { TraceKind } from '../../../worker/trace-kinds';

export type TracePhase = 'idle' | 'computing' | 'replaying' | 'ready' | 'unavailable';

export interface TraceResult<S, E extends { kind: string }> {
  trace: Trace<S, E> | null;
  phase: TracePhase;
  loading: boolean;
  /** Why there is no trace (worker diagnostics, or an unexpected failure). */
  diagnostics: readonly Diagnostic[];
}

function stableKey(kind: string, params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  return `${kind}|${JSON.stringify(keys.map((k) => [k, params[k]]))}`;
}

export function useTrace<S, E extends { kind: string }>(
  kind: TraceKind,
  params: Record<string, unknown> | null,
  reducer: Reducer<S, E>,
): TraceResult<S, E> {
  const key = params === null ? null : stableKey(kind, params);
  const [result, setResult] = useState<TraceResult<S, E>>({
    trace: null,
    phase: key === null ? 'idle' : 'computing',
    loading: key !== null,
    diagnostics: [],
  });

  // `params` is rebuilt every render; the stable key is what identifies a request.
  const frozenParams = useMemo(() => params, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (key === null || frozenParams === null) {
      setResult({ trace: null, phase: 'idle', loading: false, diagnostics: [] });
      return;
    }
    let cancelled = false;
    setResult({ trace: null, phase: 'computing', loading: true, diagnostics: [] });

    void getCompilerClient()
      .getTraceOrError({ kind, params: frozenParams })
      .then((res) => {
        if (cancelled) return;
        if (!res.trace) {
          setResult({
            trace: null,
            phase: 'unavailable',
            loading: false,
            diagnostics: res.diagnostics,
          });
          return;
        }
        // Let the "replaying…" skeleton paint before the synchronous replay.
        setResult({ trace: null, phase: 'replaying', loading: true, diagnostics: [] });
        const payload = res.trace;
        window.setTimeout(() => {
          if (cancelled) return;
          try {
            const trace = traceFromSerialized<S, E>(payload as never, reducer);
            setResult({ trace, phase: 'ready', loading: false, diagnostics: [] });
          } catch (err) {
            setResult({
              trace: null,
              phase: 'unavailable',
              loading: false,
              diagnostics: [failure(err)],
            });
          }
        }, 0);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setResult({
          trace: null,
          phase: 'unavailable',
          loading: false,
          diagnostics: [failure(err)],
        });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return result;
}

function failure(err: unknown): Diagnostic {
  return {
    phase: 'syntax',
    severity: 'error',
    message: `the syntax trace could not be built: ${err instanceof Error ? err.message : String(err)}`,
    hint: 'This is a lab problem, not a problem with your program.',
    span: { start: 0, end: 0, line: 1, col: 1 },
  };
}
