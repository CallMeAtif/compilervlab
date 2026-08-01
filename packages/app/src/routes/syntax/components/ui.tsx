/**
 * Small presentation atoms shared by the syntax views.
 *
 * EDITORIAL PASS (docs/EDITORIAL.md): a titled region is a `.section` — serif
 * title, hairline, air — not a rounded rectangle with a fill. The only borders
 * left in this file belong to artifacts that scroll (which draw their own) and
 * to the shape signifiers status colours are paired with.
 */
import { useMemo, type ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  ChevronRight,
  CircleDashed,
  Info,
  Loader2,
  OctagonAlert,
  TriangleAlert,
} from 'lucide-react';
import type { Diagnostic } from '@lab/core';
import type { StepRecord } from '@lab/trace';
import type { Stepper } from '../../../lib/useStepper';
import { TracePanel } from '../../../components/TracePanel';
import type { JumpTarget } from '../../../components/StepControls';

// ── Layout ───────────────────────────────────────────────────────────────────

/**
 * A titled region. Renders `.section` / `.section-head` / `.section-title`, so
 * two adjacent Panels are separated by a rule and 2rem of paper — never by a
 * card edge. Callers that need a border put it on the artifact itself (every
 * viz primitive already draws one).
 */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section aria-label={title} className={clsx('section min-w-0', className)}>
      <header className="section-head">
        <h2 className="section-title">{title}</h2>
        {subtitle && <span className="section-meta">{subtitle}</span>}
        {actions && (
          <>
            <span className="flex-1" />
            {actions}
          </>
        )}
      </header>
      <div className={clsx('min-w-0', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * Accessible segmented control (radio-group semantics, ≥36px targets).
 *
 * Editorial: the options are quiet text; the chosen one carries a soft accent
 * fill AND an underline rule, so the selection survives greyscale.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; disabled?: boolean; title?: string }>;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.id)}
            className={clsx(
              'cursor-pointer rounded-sm px-2.5 font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              size === 'md' ? 'h-11 text-xs' : 'h-9 text-2xs',
              selected
                ? 'bg-accent-soft font-semibold text-ink shadow-[inset_0_-2px_0_var(--accent)]'
                : 'text-ink-muted hover:bg-raised hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A shape/colour key, one interaction away instead of standing on the page.
 *
 * Every route presents reference material the same way: a `> key` summary that
 * costs one line closed, native `<details>` so it is keyboard-operable and
 * announced as a disclosure without a line of script.
 */
export function Legend({ items }: { items: ReadonlyArray<{ swatch: ReactNode; label: string }> }) {
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

/** One mono counter in a metadata line — no pill, no fill; the label recedes. */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono text-2xs whitespace-nowrap">
      <span className="text-ink-faint">{label}</span>
      <span className="tabular-nums text-ink">{value}</span>
    </span>
  );
}

// ── Status / empty states ────────────────────────────────────────────────────

export function Note({
  tone = 'info',
  title,
  children,
  actions,
}: {
  tone?: 'info' | 'warn' | 'error';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = tone === 'error' ? OctagonAlert : tone === 'warn' ? TriangleAlert : Info;
  return (
    <div
      role="status"
      className={clsx(
        // A rule on the leading edge, not a filled card: the tone lives in the
        // rule + the icon + the title, and the explanation stays quiet prose.
        'flex flex-col gap-2 border-l-2 py-1 pl-3',
        tone === 'error' && 'border-err',
        tone === 'warn' && 'border-warn',
        tone === 'info' && 'border-line-strong',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          aria-hidden
          className={clsx(
            'mt-0.5 size-4 shrink-0',
            tone === 'error' && 'text-err',
            tone === 'warn' && 'text-warn',
            tone === 'info' && 'text-ink-faint',
          )}
        />
        <div className="min-w-0 flex-1">
          <p
            className={clsx(
              'font-semibold',
              tone === 'error' && 'text-err',
              tone === 'warn' && 'text-warn',
              tone === 'info' && 'text-ink',
            )}
          >
            {title}
          </p>
          {children && <div className="prose-note mt-1">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 pl-6">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  actions,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  // A state is quiet prose under one serif line — the same `.state-title`
  // /ir, /semantic, /opt and /codegen use, so an empty view looks the same
  // whichever phase the reader is in.
  return (
    <div className="flex max-w-3xl flex-col gap-4 py-6">
      <h2 className="state-title flex items-baseline gap-2.5">
        <CircleDashed
          aria-hidden
          className="size-4 shrink-0 translate-y-0.5 text-ink-faint"
          strokeWidth={1.5}
        />
        {title}
      </h2>
      {children && <div className="prose-note">{children}</div>}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex max-w-2xl flex-col gap-3 py-8">
      <p className="prose-note flex items-center gap-2">
        <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-accent" />
        {label}
      </p>
      <div aria-hidden className="flex w-full max-w-md flex-col gap-2 pt-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-2 rounded-full bg-raised" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
    </div>
  );
}

export function Diagnostics({
  diagnostics,
  title,
}: {
  diagnostics: readonly Diagnostic[];
  title: string;
}) {
  if (diagnostics.length === 0) return null;
  return (
    <Note tone="error" title={title}>
      <ul className="flex flex-col gap-2">
        {diagnostics.map((d, i) => (
          <li key={i} className="flex flex-col gap-0.5">
            <span className="font-mono text-xs">
              {d.phase} · line {d.span.line}:{d.span.col} · {d.severity}
            </span>
            <span>{d.message}</span>
            {d.hint && <span className="text-xs opacity-80">{d.hint}</span>}
          </li>
        ))}
      </ul>
    </Note>
  );
}

export function TextButton({
  onClick,
  children,
  emphasis,
  disabled,
  ariaLabel,
}: {
  onClick: () => void;
  children: ReactNode;
  emphasis?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={clsx(
        'h-11 cursor-pointer rounded-sm px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        emphasis
          ? 'bg-accent text-on-accent hover:bg-accent-strong'
          : 'text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-accent',
      )}
    >
      {children}
    </button>
  );
}

// ── The step panel ───────────────────────────────────────────────────────────

/**
 * The right-hand column: the shared `<TracePanel/>` driven by the stepper this
 * page already owns (so the visualization can be a sibling grid column, per the
 * [viz | panel] layout rule) — truncation banner, StepControls with the
 * per-algorithm "jump to…" menu, ExplainCard.
 *
 * This used to be a hand-rolled copy of TracePanel plus its own jump bar; both
 * are now shared components.
 */
export function StepPanel<S, E extends { kind: string }>({
  stepper,
  jumps,
  children,
  className,
}: {
  stepper: Stepper<S, E>;
  jumps?: ReadonlyArray<{ label: string; pred: (s: StepRecord<E>) => boolean }>;
  children?: ReactNode;
  className?: string;
}) {
  const jumpTargets = useMemo<readonly JumpTarget<E>[] | undefined>(
    () => jumps?.map((j) => ({ label: j.label, predicate: j.pred })),
    [jumps],
  );
  return (
    <TracePanel
      stepper={stepper}
      jumpTargets={jumpTargets}
      className={clsx('min-w-0', className)}
    >
      {children === undefined
        ? undefined
        : // One wrapper so `.section + .section` (2rem) owns the rhythm between
          // the panel's own regions, and TracePanel's gap only separates this
          // block from the step controls below it.
          () => <div className="flex min-w-0 flex-col">{children}</div>}
    </TracePanel>
  );
}
