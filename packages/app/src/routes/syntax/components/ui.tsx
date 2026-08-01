/**
 * Small presentation atoms shared by the syntax views. Nothing here invents a
 * visual language — every colour, radius and spacing value comes from the app’s
 * tokens (styles/theme.css) and mirrors the existing shell components.
 */
import { useMemo, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Loader2, TriangleAlert, Info, CircleDashed, OctagonAlert } from 'lucide-react';
import type { Diagnostic } from '@lab/core';
import type { StepRecord } from '@lab/trace';
import type { Stepper } from '../../../lib/useStepper';
import { TracePanel } from '../../../components/TracePanel';
import type { JumpTarget } from '../../../components/StepControls';

// ── Layout ───────────────────────────────────────────────────────────────────

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
    <section
      aria-label={title}
      className={clsx('flex min-w-0 flex-col rounded-lg border border-line bg-surface', className)}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>
        {subtitle && <span className="text-xs text-ink-muted">{subtitle}</span>}
        {actions && (
          <>
            <span className="flex-1" />
            {actions}
          </>
        )}
      </header>
      <div className={clsx('min-w-0 p-3', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Accessible segmented control (radio-group semantics, ≥44px targets). */
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
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
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
              'cursor-pointer rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              size === 'md' ? 'h-11 px-3 text-xs' : 'h-9 px-2.5 text-[11px]',
              selected
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {selected && (
              <span aria-hidden className="mr-1.5 font-mono text-accent">
                ●
              </span>
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Legend({ items }: { items: ReadonlyArray<{ swatch: ReactNode; label: string }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-raised px-2 font-mono text-[11px] text-ink-muted">
      <span className="text-ink-faint">{label}</span>
      <span className="text-ink">{value}</span>
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
        'flex flex-col gap-2 rounded-lg border p-3 text-sm',
        tone === 'error' && 'border-err/50 bg-err-soft text-err',
        tone === 'warn' && 'border-warn/50 bg-warn-soft text-warn',
        tone === 'info' && 'border-line bg-raised text-ink',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          {children && <div className="mt-1 leading-relaxed opacity-90">{children}</div>}
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
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
      <CircleDashed aria-hidden className="size-7 text-ink-faint" strokeWidth={1.5} />
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {children && <div className="max-w-lg text-sm leading-relaxed text-ink-muted">{children}</div>}
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface p-10 text-center"
    >
      <Loader2 aria-hidden className="size-5 animate-spin text-accent" />
      <p className="text-sm text-ink-muted">{label}</p>
      <div aria-hidden className="flex w-full max-w-md flex-col gap-2 pt-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-3 rounded bg-raised" style={{ width: `${90 - i * 12}%` }} />
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
        'h-11 cursor-pointer rounded-md border px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        emphasis
          ? 'border-accent bg-accent text-on-accent hover:bg-accent-strong'
          : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
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
      {children === undefined ? undefined : () => children}
    </TracePanel>
  );
}
