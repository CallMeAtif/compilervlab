/**
 * The phase layout: [visualization | TracePanel], stacking vertically under lg.
 *
 * The stepper is created here and handed to BOTH columns, so the visualization
 * is a plain grid sibling of the panel and stays in perfect sync with the
 * transport controls (same stepper, same commit, no extra state).
 */
import type { ReactNode } from 'react';
import type { Trace } from '@lab/trace';
import { TracePanel } from '../../../components/TracePanel';
import type { JumpTarget } from '../../../components/StepControls';
import { useStepper, type Stepper, type UseStepperOptions } from '../../../lib/useStepper';

export interface SplitTraceViewProps<S, E extends { kind: string }> {
  trace: Trace<S, E>;
  title?: string;
  stepperOptions?: UseStepperOptions;
  /** Per-algorithm "jump to…" entries for the shared StepControls menu. */
  jumpTargets?: readonly JumpTarget<E>[];
  /** The visualization; rendered into the left column. */
  children: (stepper: Stepper<S, E>) => ReactNode;
  /** Optional extra content inside the panel, above the transport controls. */
  panelExtras?: (stepper: Stepper<S, E>) => ReactNode;
}

export function SplitTraceView<S, E extends { kind: string }>({
  trace,
  title,
  stepperOptions,
  jumpTargets,
  children,
  panelExtras,
}: SplitTraceViewProps<S, E>) {
  const stepper = useStepper<S, E>(trace, stepperOptions);

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
      <div className="flex min-w-0 flex-col gap-3">{children(stepper)}</div>
      <TracePanel
        stepper={stepper}
        title={title}
        jumpTargets={jumpTargets}
        className="min-w-0 lg:sticky lg:top-4 lg:self-start"
      >
        {panelExtras}
      </TracePanel>
    </div>
  );
}
