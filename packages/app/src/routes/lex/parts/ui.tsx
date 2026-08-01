/**
 * Small presentational pieces shared by the four /lex tabs. Nothing here is
 * lex-specific enough to be interesting on its own — the one component worth
 * reading is `TraceSplit`, which owns the page's single `Stepper` and hands it
 * to both the visualization and the shared `<TracePanel/>`.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, ChevronRight, CircleAlert, FileCode2, Info, Loader2 } from 'lucide-react';
import type { Trace } from '@lab/trace';
import type { Diagnostic } from '@lab/core/common/types.js';
import { TracePanel } from '../../../components/TracePanel';
import type { JumpTarget } from '../../../components/StepControls';
import { useStepper, type Stepper } from '../../../lib/useStepper';
import { usePhaseUrlState } from '../../../lib/urlState';

// ── layout primitives ───────────────────────────────────────────────────────

/**
 * A titled region. `.section` + `.section-head` (docs/EDITORIAL.md rule 1):
 * a serif title, a hairline, air below. The artifacts inside draw their own
 * frame when they scroll — nothing here does.
 */
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
    <section className={clsx('section min-w-0', className)}>
      <header className="section-head">
        <h2 className="section-title">{title}</h2>
        {subtitle && <p className="section-meta max-w-prose">{subtitle}</p>}
        <span className="flex-1" />
        {actions}
      </header>
      <div className={clsx('min-w-0', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * Reference material — legends, keys, shape vocabularies — one interaction
 * away instead of permanently on screen. Drop it in a `Panel`'s `actions` slot
 * so the closed state costs no vertical band at all.
 *
 * Native `<details>`: keyboard-operable and announced as a disclosure without a
 * line of script.
 */
export function Reveal({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={clsx('group min-w-0', className)}>
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-sm font-mono text-2xs text-ink-faint transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 transition-transform duration-[var(--dur-fast)] group-open:rotate-90 motion-reduce:transition-none"
        />
        {label}
      </summary>
      <div className="pt-1.5 pb-1">{children}</div>
    </details>
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
        // A rule on the leading edge carries the tone; the body stays prose.
        'flex flex-col gap-2 border-l-2 py-1 pl-3',
        tone === 'info' && 'border-line-strong',
        tone === 'warn' && 'border-warn',
        tone === 'error' && 'border-err',
      )}
    >
      <p
        className={clsx(
          'flex items-center gap-2 font-semibold',
          tone === 'info' && 'text-ink',
          tone === 'warn' && 'text-warn',
          tone === 'error' && 'text-err',
        )}
      >
        <Icon
          aria-hidden
          className={clsx('size-4 shrink-0', tone === 'info' && 'text-ink-faint')}
        />
        {title}
      </p>
      {children && <div className="prose-note">{children}</div>}
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
        'flex h-11 cursor-pointer items-center gap-1.5 rounded-sm px-3 text-sm font-medium transition-colors',
        emphasis
          ? 'bg-accent text-on-accent hover:bg-accent-strong'
          : 'text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-accent',
      )}
    >
      {children}
    </button>
  );
}

/** "Compile a program to begin" and friends — quiet prose, not a loud box. */
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
    <div className="flex max-w-3xl flex-col gap-4 py-6">
      <div className="section-head">
        <h2 className="section-title flex items-baseline gap-2">
          <Icon aria-hidden className="size-4 shrink-0 translate-y-0.5 text-ink-faint" strokeWidth={1.5} />
          {title}
        </h2>
      </div>
      {children && <div className="prose-note">{children}</div>}
    </div>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex max-w-2xl flex-col gap-3 py-8">
      <p className="prose-note flex items-center gap-2">
        <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-accent" />
        {label}
      </p>
      <div aria-hidden className="flex w-full max-w-sm flex-col gap-2 pt-1">
        <span className="h-2 w-full rounded-full bg-raised" />
        <span className="h-2 w-4/5 rounded-full bg-raised" />
        <span className="h-2 w-3/5 rounded-full bg-raised" />
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
        <ul className="mt-2 flex flex-col gap-2">
          {diagnostics.map((d, i) => (
            <li key={i} className="border-l border-dashed border-warn pl-2.5">
              <span className="font-mono text-2xs text-ink-faint">
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
  initialStep,
  jumpTargets,
  children,
}: {
  trace: Trace<S, E>;
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
    // No gap inside the artifact column: its regions are `.section`s and space
    // themselves 2rem apart. The trace column is marked off by a rule.
    <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:gap-x-10">
      <div className="flex min-w-0 flex-col">{children(stepper)}</div>
      <TracePanel
        stepper={stepper}
        jumpTargets={jumpTargets}
        className="min-w-0 lg:border-l lg:border-line lg:pl-10"
      />
    </div>
  );
}
