/**
 * Loading / unavailable gate around one trace load. Traces are computed in the
 * compile worker, so the UI thread only ever waits here.
 */
import type { ReactNode } from 'react';
import type { Trace } from '@lab/trace';
import { LoadingPanel, TraceUnavailable } from './OptStates';
import type { TraceLoad } from '../lib/useOptTrace';

export interface TraceGateProps<S, E extends { kind: string }> {
  load: TraceLoad<S, E>;
  /** "the constant-folding pass", "reaching definitions on gcd()" … */
  what: string;
  /** Why a null trace can happen for this kind, in the student's terms. */
  unavailableExplanation?: string;
  children: (trace: Trace<S, E>) => ReactNode;
}

export function TraceGate<S, E extends { kind: string }>({
  load,
  what,
  unavailableExplanation,
  children,
}: TraceGateProps<S, E>) {
  if (load.status === 'loading') {
    return <LoadingPanel label={`Recording ${what} in the compile worker…`} />;
  }
  if (load.status === 'failed') {
    return (
      <TraceUnavailable
        title={`Could not record ${what}`}
        explanation="The compile worker rejected the request."
        error={load.error}
      />
    );
  }
  if (load.trace === null) {
    return (
      <TraceUnavailable
        title={`No trace for ${what}`}
        explanation={unavailableExplanation ?? 'The worker could not build this trace.'}
        diagnostics={load.diagnostics}
      />
    );
  }
  return <>{children(load.trace)}</>;
}
