/**
 * Small presentational pieces shared by the four /lex tabs. Nothing here is
 * lex-specific enough to be interesting on its own — the one component worth
 * reading is `TraceSplit`, which owns the page's single `Stepper` and hands it
 * to both the visualization and the shared `<TracePanel/>`.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, CircleAlert, FileCode2, Info, Loader2 } from 'lucide-react';
import type { Trace } from '@lab/trace';
import type { Diagnostic } from '@lab/core/common/types.js';
import { TracePanel } from '../../../components/TracePanel';
import type { JumpTarget } from '../../../components/StepControls';
import { useStepper, type Stepper } from '../../../lib/useStepper';
import { usePhaseUrlState } from '../../../lib/urlState';

// ── layout primitives ───────────────────────────────────────────────────────

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('flex min-w-0 flex-col rounded-lg border border-line bg-surface', className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        <span className="flex-1" />
        {actions}
      </header>
      <div className={clsx('min-w-0 p-3', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Note({
  tone = 'info',
  title,
  children,
  actions,
}: {
  tone?: 'info' | 'warn' | 'error';
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = tone === 'info' ? Info : tone === 'warn' ? AlertTriangle : CircleAlert;
  return (
    <div
      role={tone === 'info' ? 'note' : 'status'}
      className={clsx(
        'flex flex-col gap-2 rounded-lg border p-3 text-sm',
        tone === 'info' && 'border-line bg-raised text-ink',
        tone === 'warn' && 'border-warn/50 bg-warn-soft text-warn',
        tone === 'error' && 'border-err/50 bg-err-soft text-err',
      )}
    >
      <p className="flex items-center gap-2 font-semibold">
        <Icon aria-hidden className="size-4 shrink-0" />
        {title}
      </p>
      {children && <div className="text-sm leading-relaxed opacity-90">{children}</div>}
      {actions && <div className="flex flex-wrap gap-2 pt-0.5">{actions}</div>}
    </div>
  );
}

export function LabButton({
  onClick,
  children,
  emphasis,
  ariaLabel,
}: {
  onClick: () => void;
  children: ReactNode;
  emphasis?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={clsx(
        'flex h-11 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
        emphasis
          ? 'border-accent bg-accent text-on-accent hover:bg-accent-strong'
          : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

/** "Compile a program to begin" and friends. */
export function EmptyState({
  title,
  children,
  icon: Icon = FileCode2,
}: {
  title: string;
  children?: ReactNode;
  icon?: typeof FileCode2;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
      <Icon aria-hidden className="size-8 text-ink-faint" strokeWidth={1.5} />
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {children && <div className="max-w-lg text-sm text-ink-muted">{children}</div>}
    </div>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface p-8 text-sm text-ink-muted"
    >
      <Loader2 aria-hidden className="size-5 animate-spin text-accent" />
      {label}
      <div aria-hidden className="mt-1 flex w-full max-w-sm flex-col gap-2">
        <span className="h-2.5 w-full rounded-full bg-raised" />
        <span className="h-2.5 w-4/5 rounded-full bg-raised" />
        <span className="h-2.5 w-3/5 rounded-full bg-raised" />
      </div>
    </div>
  );
}

/** The worker returned no trace: show exactly why, with the diagnostics. */
export function UnavailablePanel({
  title,
  diagnostics,
  children,
}: {
  title: string;
  diagnostics: readonly Diagnostic[];
  children?: ReactNode;
}) {
  return (
    <Note tone="warn" title={title}>
      {children}
      {diagnostics.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {diagnostics.map((d, i) => (
            <li key={i} className="rounded-md border border-warn/40 bg-surface/60 px-2 py-1.5">
              <span className="font-mono text-[11px] text-ink-faint">
                {d.phase} · line {d.span.line}:{d.span.col}
              </span>
              <p className="text-ink">{d.message}</p>
              {d.hint && <p className="text-xs text-ink-muted">{d.hint}</p>}
            </li>
          ))}
        </ul>
      )}
    </Note>
  );
}

/**
 * Gate for automata that are too large to lay out comfortably. The point is
 * educational as much as practical: expanding `letter` to 53 alternatives is
 * exactly why real scanners use character classes.
 */
export function HeavyGate({
  title,
  children,
  reason,
  render,
}: {
  title: string;
  reason: ReactNode;
  children: ReactNode;
  /** When false, the gate is skipped entirely. */
  render: boolean;
}) {
  const [accepted, setAccepted] = useState(false);
  if (!render || accepted) return <>{children}</>;
  return (
    <Note
      tone="warn"
      title={title}
      actions={<LabButton onClick={() => setAccepted(true)}>Draw it anyway</LabButton>}
    >
      {reason}
    </Note>
  );
}

// ── the [visualization | TracePanel] split ──────────────────────────────────

/**
 * The required `[visualization | TracePanel]` split. The stepper is created
 * here and shared, so the visualization is a plain grid SIBLING of the panel
 * rather than a portal out of it — one stepper, one cursor, one commit.
 *
 * Mount this with a `key` that changes whenever the trace changes so the
 * `?step=` deep link is captured exactly once per trace.
 */
export function TraceSplit<S, E extends { kind: string }>({
  trace,
  title,
  initialStep,
  jumpTargets,
  children,
}: {
  trace: Trace<S, E>;
  title?: string;
  initialStep: number | null;
  /** Per-algorithm "jump to…" entries for the shared StepControls menu. */
  jumpTargets?: readonly JumpTarget<E>[];
  children: (stepper: Stepper<S, E>) => ReactNode;
}) {
  const { setPhaseParams } = usePhaseUrlState();

  const onIndexChange = useCallback(
    (index: number) => setPhaseParams({ step: index }),
    [setPhaseParams],
  );
  // `initialIndex` is captured on mount (and on trace identity change) by
  // useStepper; the caller's `key` guarantees that is the fresh URL value.
  const stepperOptions = useMemo(
    () => ({ initialIndex: initialStep ?? 0, onIndexChange }),
    [initialStep, onIndexChange],
  );
  const stepper = useStepper<S, E>(trace, stepperOptions);

  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <div className="flex min-w-0 flex-col gap-4">{children(stepper)}</div>
      <TracePanel stepper={stepper} title={title} jumpTargets={jumpTargets} className="min-w-0" />
    </div>
  );
}
