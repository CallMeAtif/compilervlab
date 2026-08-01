/**
 * Small presentational atoms shared by the six code-generation tabs.
 * Nothing here holds algorithm state — every tab renders `stepper.state`.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Trace } from '@lab/trace';
import type { Diagnostic } from '@lab/core';
import { clsx } from 'clsx';
import { Info, Loader2, OctagonAlert, TriangleAlert } from 'lucide-react';
import { TracePanel } from '../../components/TracePanel';
import type { JumpTarget } from '../../components/StepControls';
import { useStepper, type Stepper, type UseStepperOptions } from '../../lib/useStepper';
import { usePhaseUrlState } from '../../lib/urlState';
import type { CodegenTrace } from './useCodegenTrace';

// ── layout ──────────────────────────────────────────────────────────────────

export function Panel({
  title,
  subtitle,
  actions,
  bodyClassName,
  className,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={clsx('flex min-w-0 flex-col rounded-lg border border-line bg-surface', className)}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">{title}</h3>
        {subtitle && <p className="text-xs text-ink-faint">{subtitle}</p>}
        {actions && (
          <>
            <span className="flex-1" />
            {actions}
          </>
        )}
      </header>
      <div className={clsx('min-w-0', bodyClassName ?? 'p-3')}>{children}</div>
    </section>
  );
}

/**
 * The mandated `[artifact visualization | TracePanel]` split. The stepper is
 * created HERE and shared: the artifact view is column 1, `<TracePanel/>`
 * (StepControls + jump menu + ExplainCard + CitationBadge) is column 2, and
 * both read the same cursor in the same commit.
 */
export function TraceSplit<S, E extends { kind: string }>({
  trace,
  stepperOptions,
  jumpTargets,
  children,
}: {
  trace: Trace<S, E>;
  stepperOptions?: UseStepperOptions;
  jumpTargets?: readonly JumpTarget<E>[];
  children: (stepper: Stepper<S, E>) => ReactNode;
}) {
  const stepper = useStepper<S, E>(trace, stepperOptions);
  return (
    <div className="cg-split">
      <div className="cg-viz flex min-w-0 flex-col gap-3">{children(stepper)}</div>
      <TracePanel stepper={stepper} className="cg-tracepanel min-w-0" jumpTargets={jumpTargets} />
    </div>
  );
}

/**
 * Code generation has almost no macro steps worth watching on their own — the
 * teaching content (each emitted instruction, each live set, each edge, each
 * simplify/select decision) is recorded at micro level. So every tab opens in
 * micro mode; the StepControls switch still lets the reader coarsen it.
 */
export function AutoMicroSteps<S, E extends { kind: string }>({
  stepper,
}: {
  stepper: Stepper<S, E>;
}) {
  const { setLevel } = stepper;
  const traceId = stepper.trace.id;
  useEffect(() => {
    setLevel('micro');
  }, [setLevel, traceId]);
  return null;
}

/** `?step=` round-tripping: seek on load, write back (debounced by urlState). */
export function useStepSync(): UseStepperOptions {
  const { step, setPhaseParams } = usePhaseUrlState();
  const initialIndex = useRef(step ?? 0);
  const setParams = useRef(setPhaseParams);
  setParams.current = setPhaseParams;
  return useMemo<UseStepperOptions>(
    () => ({
      initialIndex: initialIndex.current,
      onIndexChange: (i: number) => setParams.current({ step: i }),
    }),
    [],
  );
}

// ── status surfaces ─────────────────────────────────────────────────────────

export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'warn' | 'error' | 'ok';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = tone === 'error' ? OctagonAlert : tone === 'warn' ? TriangleAlert : Info;
  return (
    <div
      role="status"
      className={clsx(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        tone === 'error' && 'border-err/50 bg-err-soft text-err',
        tone === 'warn' && 'border-warn/50 bg-warn-soft text-warn',
        tone === 'ok' && 'border-ok/40 bg-ok-soft text-ok',
        tone === 'info' && 'border-line bg-raised text-ink-muted',
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="[&_p]:mt-1">{children}</div>}
      </div>
    </div>
  );
}

export function DiagnosticList({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {diagnostics.map((d, i) => (
        <li
          key={`${d.phase}-${d.span.start}-${i}`}
          className={clsx(
            'rounded-md border px-3 py-2 text-sm',
            d.severity === 'error'
              ? 'border-err/50 bg-err-soft text-err'
              : 'border-warn/50 bg-warn-soft text-warn',
          )}
        >
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-surface/70 px-2 font-mono text-[11px] tracking-wide uppercase">
              {d.phase}
            </span>
            <span className="font-mono text-[11px]">
              line {d.span.line}:{d.span.col}
            </span>
          </p>
          <p className="mt-1 font-medium">{d.message}</p>
          {d.rule && <p className="mt-1 text-xs opacity-90">Rule: {d.rule}</p>}
          {d.hint && <p className="mt-1 text-xs opacity-90">{d.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface p-8 text-sm text-ink-faint"
    >
      <Loader2 aria-hidden className="size-5 animate-spin text-accent" />
      {label}
      <div aria-hidden className="mt-2 flex w-full max-w-md flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-3 rounded bg-raised"
            style={{ width: `${100 - i * 12}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Renders the loading / unavailable states of a codegen trace and hands the
 * ready trace to `children`. Every failure is explained with the diagnostics
 * the worker returned — that is the pedagogy, not an error toast.
 */
export function TraceGate<S, E extends { kind: string }>({
  result,
  label,
  unavailableTitle,
  children,
}: {
  result: CodegenTrace<S, E>;
  label: string;
  unavailableTitle: string;
  children: (trace: Trace<S, E>) => ReactNode;
}) {
  if (result.status === 'loading' || result.status === 'idle') {
    return <LoadingPanel label={label} />;
  }
  if (result.status === 'unavailable' || result.trace === null) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <Notice tone="error" title={unavailableTitle}>
          <p className="text-sm">
            This stage never ran, so there is nothing to step through. Fix the diagnostics below
            (or raise K, for a coloring that cannot converge) and compile again.
          </p>
        </Notice>
        <DiagnosticList diagnostics={result.diagnostics} />
      </div>
    );
  }
  return <>{children(result.trace)}</>;
}

// ── tiny inline atoms ───────────────────────────────────────────────────────

export function Tag({
  children,
  tone = 'neutral',
  className,
  title,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'err';
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[11px] whitespace-nowrap',
        tone === 'neutral' && 'border-line bg-raised text-ink-muted',
        tone === 'accent' && 'border-accent/60 bg-accent-soft text-ink',
        tone === 'ok' && 'border-ok/40 bg-ok-soft text-ok',
        tone === 'warn' && 'border-warn/50 bg-warn-soft text-warn',
        tone === 'err' && 'border-err/50 bg-err-soft text-err',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Legend({ items }: { items: Array<{ swatch: ReactNode; label: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-muted">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          {it.swatch}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Function picker: follows the trace until the reader pins a function. */
export function FunctionPicker({
  names,
  value,
  pinned,
  onPick,
  onFollow,
}: {
  names: readonly string[];
  value: string | null;
  pinned: boolean;
  onPick: (name: string) => void;
  onFollow: () => void;
}) {
  if (names.length <= 1 && !pinned) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-ink-faint">function</span>
      {names.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={n === value}
          onClick={() => onPick(n)}
          className={clsx(
            'h-7 cursor-pointer rounded-md border px-2 font-mono text-xs transition-colors',
            n === value
              ? 'border-accent bg-accent-soft text-ink'
              : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
          )}
        >
          {n}
        </button>
      ))}
      {pinned && (
        <button
          type="button"
          onClick={onFollow}
          className="h-7 cursor-pointer rounded-md border border-control bg-surface px-2 text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          Follow trace
        </button>
      )}
    </div>
  );
}

/** Follows the trace's current function unless the reader pinned one. */
export function pickFunctionName(
  names: readonly string[],
  fromTrace: string | null,
  pinned: string | null,
): string | null {
  if (pinned !== null && names.includes(pinned)) return pinned;
  if (fromTrace !== null && names.includes(fromTrace)) return fromTrace;
  return names.length > 0 ? (names[names.length - 1] ?? null) : null;
}
