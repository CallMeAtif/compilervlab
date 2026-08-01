/**
 * The standard right-hand panel of every phase view: StepControls + ExplainCard
 * over one recorded trace.
 *
 * Two ways to use it, both keeping ONE stepper per page:
 *
 *  1. TracePanel owns the stepper — pass `trace` (+ `stepperOptions`). The
 *     render-prop child receives it, so an artifact drawn INSIDE the panel
 *     column stays in sync.
 *
 *  2. The route owns the stepper — `const stepper = useStepper(trace)`, then
 *     `<Viz stepper={stepper}/>` beside `<TracePanel stepper={stepper}/>`.
 *     This is what the documented `[visualization | TracePanel]` layout needs:
 *     the visualization is a SIBLING in the grid, not a child of the panel, so
 *     it no longer has to be portalled out of the panel's own column.
 */
import type { ReactNode } from 'react';
import type { Trace } from '@lab/trace';
import { TriangleAlert } from 'lucide-react';
import { clsx } from 'clsx';
import { useStepper, type Stepper, type UseStepperOptions } from '../lib/useStepper';
import { StepControls, type JumpTarget } from './StepControls';
import { ExplainCard } from './ExplainCard';

interface TracePanelCommonProps<S, E extends { kind: string }> {
  title?: string;
  className?: string;
  /** Per-algorithm "jump to…" entries, rendered inside StepControls. */
  jumpTargets?: readonly JumpTarget<E>[];
  /** Artifact view synchronized to the stepper (rendered above the controls). */
  children?: (stepper: Stepper<S, E>) => ReactNode;
}

/** Trace-owning form: TracePanel creates the stepper (backwards compatible). */
export interface TracePanelOwnedProps<S, E extends { kind: string }>
  extends TracePanelCommonProps<S, E> {
  trace: Trace<S, E>;
  stepperOptions?: UseStepperOptions;
  stepper?: undefined;
}

/** Externally-stepped form: the route created the stepper and shares it. */
export interface TracePanelSharedProps<S, E extends { kind: string }>
  extends TracePanelCommonProps<S, E> {
  stepper: Stepper<S, E>;
  /** Optional; defaults to `stepper.trace`. */
  trace?: Trace<S, E>;
  stepperOptions?: undefined;
}

export type TracePanelProps<S, E extends { kind: string }> =
  | TracePanelOwnedProps<S, E>
  | TracePanelSharedProps<S, E>;

/**
 * The two forms are two COMPONENTS, not one component with a conditional hook.
 *
 * A single component would have to call `useStepper` unconditionally even when
 * the route already owns one — and that is not the "single `stateAt(0)`" it
 * looks like: `useStepper` also builds `visibleIndices` (O(steps)),
 * `visibleCursors` (a second O(steps) array) and `trace.sections()` (O(steps))
 * for the stepper it is about to throw away. On the truncated canonical LR(1)
 * trace (~40 000 events) that is three extra full passes and two 40 000-element
 * arrays on the UI thread every time the trace changes. Splitting the form at
 * the component boundary makes the discarded stepper simply not exist.
 *
 * The branch is stable in practice: a call site either owns the stepper or does
 * not, and never flips between the two.
 */
export function TracePanel<S, E extends { kind: string }>(props: TracePanelProps<S, E>) {
  return props.stepper === undefined ? (
    <TracePanelOwning {...props} />
  ) : (
    <TracePanelBody {...props} stepper={props.stepper} />
  );
}

/** Trace-owning form: builds the one stepper it then renders. */
function TracePanelOwning<S, E extends { kind: string }>({
  trace,
  stepperOptions,
  ...rest
}: TracePanelOwnedProps<S, E>) {
  const stepper = useStepper<S, E>(trace, stepperOptions);
  return <TracePanelBody {...rest} stepper={stepper} />;
}

function TracePanelBody<S, E extends { kind: string }>({
  stepper,
  title,
  className,
  jumpTargets,
  children,
}: TracePanelCommonProps<S, E> & { stepper: Stepper<S, E> }) {
  const shown = stepper.trace;

  return (
    <div className={clsx('flex flex-col gap-3', className)}>
      {title && (
        <h2 className="text-sm font-semibold tracking-tight text-ink-muted">{title}</h2>
      )}

      {shown.truncated && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-warn/50 bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          Trace truncated at {shown.length.toLocaleString()} steps — the final artifact is
          still exact, but later steps are not replayable.
        </div>
      )}

      {children?.(stepper)}

      <StepControls stepper={stepper} jumpTargets={jumpTargets} />
      <ExplainCard step={stepper.currentStep} index={stepper.index} length={stepper.length} />
    </div>
  );
}
