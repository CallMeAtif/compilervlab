/**
 * "Where in the C source are we": the step-synchronized strip that lives in the
 * TracePanel column. Only `enter-node` steps carry srcSpans, so the strip shows
 * the most recent spans at or before the cursor — which is exactly the
 * construct whose translation the micro steps below it are emitting.
 */
import { useMemo } from 'react';
import type { SourceSpan } from '@lab/trace';
import type { IrEvent, IrGenState } from '@lab/core/ir/ir-events.js';
import { CodeStrip } from '../../components/viz/CodeStrip';
import type { Stepper } from '../../lib/useStepper';

const NO_SPANS: readonly SourceSpan[] = [];

export function SourceTrail({
  source,
  stepper,
}: {
  source: string;
  stepper: Stepper<IrGenState, IrEvent>;
}) {
  const { trace, index } = stepper;
  const spans = useMemo(() => {
    for (let i = index - 1; i >= 0; i--) {
      const s = trace.steps[i];
      if (s?.meta.srcSpans && s.meta.srcSpans.length > 0) return s.meta.srcSpans;
    }
    return NO_SPANS;
  }, [trace, index]);

  return (
    <section aria-label="Source position" className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold tracking-tight text-ink-muted">
        Construct being translated
      </h3>
      <CodeStrip source={source} spans={spans} maxHeight="12rem" />
    </section>
  );
}
