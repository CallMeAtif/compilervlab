/**
 * Small presentational atoms shared by the six code-generation tabs.
 * Nothing here holds algorithm state — every tab renders `stepper.state`.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Trace } from '@lab/trace';
import type { Diagnostic } from '@lab/core';
import { clsx } from 'clsx';
import {
  ChevronRight,
  CircleCheck,
  Info,
  Loader2,
  OctagonAlert,
  TriangleAlert,
} from 'lucide-react';
import { TracePanel } from '../../components/TracePanel';
import type { JumpTarget } from '../../components/StepControls';
import { FullscreenBody, FullscreenToggle } from '../../components/Fullscreen';
import { useFullscreen } from '../../lib/useFullscreen';
import { useStepper, type Stepper, type UseStepperOptions } from '../../lib/useStepper';
import { usePhaseUrlState } from '../../lib/urlState';
import type { CodegenTrace } from './useCodegenTrace';

// ── layout ──────────────────────────────────────────────────────────────────

/**
 * A titled region (docs/EDITORIAL.md §1): serif title over a hairline, air
 * below, and NO box. `frame` opts the body into a border — reserved for the
 * artifacts that genuinely need containing: the assembly listing, the graphs,
 * the long scrolling tables.
 *
 * There is deliberately NO `subtitle` slot: a panel gets a LABEL, never a
 * standing sentence (docs/EDITORIAL.md §0). Metadata goes in `actions`;
 * explanation belongs in the step prose, which changes as you step.
 */
export function Panel({
  title,
  actions,
  bodyClassName,
  className,
  frame = false,
  fullscreen,
  children,
}: {
  /** A label. Four words at most. */
  title: string;
  actions?: ReactNode;
  bodyClassName?: string;
  className?: string;
  /** Opt in to a border — artifacts that scroll or must be visually contained. */
  frame?: boolean;
  /**
   * Opt in to fullscreen. The toggle joins `actions` in the head rather than
   * floating over the artifact — over the assembly listing that corner is the
   * first line's role tag. `controls` is the transport the artifact keeps
   * while it fills the screen, since fullscreen hides the TracePanel.
   */
  fullscreen?: { label: string; controls?: ReactNode; bodyClassName?: string };
  children: ReactNode;
}) {
  // Called unconditionally (hook rules); inert until a caller opts in.
  const fs = useFullscreen();
  const body = clsx('min-w-0', frame && 'framed artifact-scroll', bodyClassName);

  return (
    <section aria-label={title} className={clsx('section min-w-0', className)}>
      <header className="section-head">
        <h2 className="section-title">{title}</h2>
        {/* Unwrapped when there is no toggle: `actions` styles itself against
            the head's own baseline row, and a flex box would re-align it. */}
        {fullscreen ? (
          <span className="flex shrink-0 items-center gap-1.5">
            {actions}
            <FullscreenToggle fs={fs} label={fullscreen.label} />
          </span>
        ) : (
          (actions ?? null)
        )}
      </header>
      {fullscreen ? (
        <FullscreenBody
          fs={fs}
          controls={fullscreen.controls}
          className={body}
          fullscreenClassName={fullscreen.bodyClassName}
        >
          {children}
        </FullscreenBody>
      ) : (
        <div className={body}>{children}</div>
      )}
    </section>
  );
}

/**
 * Reference material — keys, register files, rule statements — one interaction
 * away instead of permanently on screen. Native `<details>`: keyboard operable
 * and announced, with no state of our own.
 */
export function Disclosure({
  summary,
  meta,
  children,
  className,
}: {
  summary: string;
  /** Mono metadata that stays visible on the closed summary line. */
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={clsx('group section', className)}>
      <summary className="flex h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm text-ink-faint transition-colors duration-[var(--dur-fast)] hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 transition-transform duration-[var(--dur-fast)] group-open:rotate-90"
        />
        <span className="group-label">{summary}</span>
        {meta && (
          <span className="section-meta">
            <span aria-hidden>· </span>
            {meta}
          </span>
        )}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
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
      {/* No gap: the artifact column's children are `.section`s, and the
          editorial rhythm between titled regions is `.section + .section`. */}
      <div className="cg-viz flex min-w-0 flex-col">{children(stepper)}</div>
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
  // Shape as well as colour: each tone has its own glyph, so the meaning
  // survives greyscale even though the only fill is a 2px rule.
  const Icon =
    tone === 'error'
      ? OctagonAlert
      : tone === 'warn'
        ? TriangleAlert
        : tone === 'ok'
          ? CircleCheck
          : Info;
  return (
    <div
      role="status"
      className={clsx(
        // A remark, not a box: a coloured rule on the leading edge plus the
        // tone's own glyph, so the meaning survives greyscale without a fill.
        'section flex items-start gap-2.5 border-l-2 py-0.5 pl-3 text-sm',
        tone === 'error' && 'border-l-err [&>svg]:text-err',
        tone === 'warn' && 'border-l-warn [&>svg]:text-warn',
        tone === 'ok' && 'border-l-ok [&>svg]:text-ok',
        tone === 'info' && 'border-l-line-strong [&>svg]:text-ink-faint',
        className,
      )}
    >
      <Icon aria-hidden className="mt-1 size-4 shrink-0" />
      <div className="min-w-0 flex-1 text-ink-muted">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className="leading-relaxed [&_p]:mt-1">{children}</div>}
      </div>
    </div>
  );
}

export function DiagnosticList({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <ul className="flex flex-col gap-3">
      {diagnostics.map((d, i) => (
        <li
          key={`${d.phase}-${d.span.start}-${i}`}
          className={clsx(
            'border-l-2 pl-3',
            d.severity === 'error' ? 'border-l-err' : 'border-l-warn',
          )}
        >
          <p className="font-mono text-2xs text-ink-faint">
            <span className={d.severity === 'error' ? 'text-err' : 'text-warn'}>
              {d.severity === 'error' ? '■' : '▲'} {d.phase}
            </span>
            {'  '}line {d.span.line}:{d.span.col}
          </p>
          <p className="mt-0.5 text-sm text-ink">{d.message}</p>
          {d.rule && <p className="prose-note mt-0.5 text-sm">Rule: {d.rule}</p>}
          {d.hint && <p className="prose-note mt-0.5 text-sm">{d.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="section flex flex-col gap-4 py-10">
      <p className="flex items-center gap-2.5 text-sm text-ink-muted">
        <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-accent" />
        {label}
      </p>
      <div aria-hidden className="flex w-full max-w-md flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-px animate-pulse bg-line"
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
      <section className="section max-w-3xl py-4">
        <h2 className="state-title text-err">{unavailableTitle}</h2>
        <p className="prose-note mt-3">This stage never ran. Fix the diagnostics, or raise K.</p>
        {result.diagnostics.length > 0 && (
          <>
            <hr className="rule" />
            <DiagnosticList diagnostics={result.diagnostics} />
          </>
        )}
      </section>
    );
  }
  return <>{children(result.trace)}</>;
}

// ── tiny inline atoms ───────────────────────────────────────────────────────

/**
 * The one control skin this phase uses (docs/EDITORIAL.md §"what done looks
 * like"): the CURRENT choice gets a soft accent wash plus an underline rule —
 * the rule is the shape signifier — and every other choice is quiet text that
 * only earns a background on hover. 44px tall, so it is still a real target.
 */
export function cgControl(selected: boolean): string {
  return clsx(
    'flex h-11 cursor-pointer items-center rounded-sm px-2.5 whitespace-nowrap transition-colors duration-[var(--dur-fast)]',
    selected
      ? 'bg-accent-soft font-semibold text-ink shadow-[inset_0_-2px_0_var(--accent)]'
      : 'text-ink-muted hover:bg-raised hover:text-ink',
  );
}

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
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 font-mono text-2xs whitespace-nowrap',
        tone === 'neutral' && 'bg-raised text-ink-muted',
        tone === 'accent' && 'bg-accent-soft text-ink shadow-[inset_0_0_0_1px_var(--accent)]',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'err' && 'bg-err-soft text-err',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A figure key, set as a caption line rather than as chrome. */
/**
 * A shape/colour key, one interaction away instead of standing on the page.
 *
 * Every route presents reference material the same way: a `> key` summary that
 * costs one line closed, native `<details>` so it is keyboard-operable and
 * announced as a disclosure without a line of script.
 */
export function Legend({ items }: { items: Array<{ swatch: ReactNode; label: string }> }) {
  return (
    <details className="group min-w-0">
      <summary className="flex h-8 w-fit cursor-pointer list-none items-center gap-1 rounded-sm font-mono text-2xs text-ink-faint transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 transition-transform duration-[var(--dur-fast)] group-open:rotate-90 motion-reduce:transition-none"
        />
        key
      </summary>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 pb-1 font-mono text-2xs text-ink-faint">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-1.5">
            {i.swatch}
            {i.label}
          </li>
        ))}
      </ul>
    </details>
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
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <span className="group-label mr-2">fn</span>
      {names.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={n === value}
          onClick={() => onPick(n)}
          className={clsx(cgControl(n === value), 'font-mono text-xs')}
        >
          {n}
        </button>
      ))}
      {pinned && (
        <button
          type="button"
          onClick={onFollow}
          className="flex h-11 cursor-pointer items-center px-2 text-sm text-accent underline decoration-accent/40 underline-offset-4 transition-colors hover:decoration-accent"
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
