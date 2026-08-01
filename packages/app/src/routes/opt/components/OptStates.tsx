/**
 * Shared chrome for the optimization phase: panels, chips, and the required
 * empty / upstream-error / loading states. Every state is educational — it says
 * what is missing and what to do about it.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  CircleAlert,
  Info,
  Loader2,
  PlayCircle,
  TriangleAlert,
} from 'lucide-react';
import type { Diagnostic } from '@lab/core';
import { CitationBadge } from '../../../components/CitationBadge';
import { CompileCta } from '../../../components/CompileCta';

// ── Panel ────────────────────────────────────────────────────────────────────

export function Panel({
  title,
  subtitle,
  cite,
  actions,
  children,
  bodyClassName,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** "§9.2.4 · Algorithm 9.11" style anchor, rendered as a citation chip. */
  cite?: { section: string; figureOrAlgo?: string; rule?: string };
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section className={clsx('rounded-lg border border-line bg-surface', className)}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {cite && <CitationBadge cite={cite} />}
        {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </header>
      <div className={clsx('p-3', bodyClassName)}>{children}</div>
    </section>
  );
}

// ── Small chips ──────────────────────────────────────────────────────────────

export function Chip({
  children,
  tone = 'neutral',
  title,
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn' | 'err' | 'accent';
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex h-5 items-center gap-1 rounded-full border px-2 font-mono text-[11px]',
        tone === 'neutral' && 'border-line bg-raised text-ink-muted',
        tone === 'ok' && 'border-ok/50 bg-ok-soft text-ok',
        tone === 'warn' && 'border-warn/50 bg-warn-soft text-warn',
        tone === 'err' && 'border-err/50 bg-err-soft text-err',
        tone === 'accent' && 'border-accent/60 bg-accent-soft text-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info',
  icon,
  children,
  className,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'err';
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const fallback =
    tone === 'err' ? (
      <CircleAlert aria-hidden className="size-4 shrink-0" />
    ) : tone === 'warn' ? (
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
    ) : (
      <Info aria-hidden className="size-4 shrink-0" />
    );
  return (
    <div
      role="status"
      className={clsx(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        tone === 'info' && 'border-line bg-raised text-ink-muted',
        tone === 'ok' && 'border-ok/50 bg-ok-soft text-ok',
        tone === 'warn' && 'border-warn/50 bg-warn-soft text-warn',
        tone === 'err' && 'border-err/50 bg-err-soft text-err',
        className,
      )}
    >
      {icon ?? fallback}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ── Required states ──────────────────────────────────────────────────────────

/** No compilation at all yet. */
export function NothingCompiled() {
  return (
    <section className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
      <PlayCircle aria-hidden className="size-8 text-ink-faint" strokeWidth={1.5} />
      <h2 className="text-base font-semibold text-ink">Compile a program to begin</h2>
      <p className="max-w-lg text-sm text-ink-muted">
        The optimizer runs on the three-address code of a compiled program. Compile, and this
        view shows the basic blocks, the flow graph, the data-flow analyses and every pass
        rewrite, step by step.
      </p>
      <CompileCta />
    </section>
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
            d.severity === 'error' ? 'border-err/40 bg-err-soft' : 'border-warn/40 bg-warn-soft',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={d.severity === 'error' ? 'err' : 'warn'}>{d.phase}</Chip>
            <span className="font-mono text-[11px] text-ink-muted">
              line {d.span.line}:{d.span.col}
            </span>
          </div>
          <p className={clsx('mt-1', d.severity === 'error' ? 'text-err' : 'text-warn')}>
            {d.message}
          </p>
          {d.rule && <p className="mt-1 text-xs text-ink-muted">Rule: {d.rule}</p>}
          {d.hint && <p className="mt-0.5 text-xs text-ink-muted">Hint: {d.hint}</p>}
        </li>
      ))}
    </ul>
  );
}

/** An upstream phase failed, so there is no optimizer input. */
export function UpstreamBlocked({
  diagnostics,
  what = 'Optimization',
}: {
  diagnostics: readonly Diagnostic[];
  what?: string;
}) {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-err/40 bg-surface p-4">
      <div className="flex items-center gap-2">
        <CircleAlert aria-hidden className="size-5 text-err" />
        <h2 className="text-base font-semibold text-ink">
          {what} did not run — an earlier phase reported errors
        </h2>
      </div>
      <p className="max-w-2xl text-sm text-ink-muted">
        The optimizer consumes the three-address code produced by intermediate-code generation.
        Fix the diagnostics below on the overview page and recompile; every optimization view
        then becomes available.
      </p>
      {errors.length > 0 ? (
        <DiagnosticList diagnostics={errors} />
      ) : (
        <Notice tone="warn">
          No diagnostics were attached — the phase simply produced no artifact.
        </Notice>
      )}
      <Link
        to="/"
        className="flex h-11 w-fit items-center rounded-md border border-line px-4 text-sm font-medium text-ink transition-colors hover:border-line-strong"
      >
        Back to the source
      </Link>
    </section>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-line bg-surface p-8"
    >
      <Loader2 aria-hidden className="size-5 animate-spin text-accent" />
      <p className="text-sm text-ink-muted">{label}</p>
      <div className="flex w-full max-w-md flex-col gap-2" aria-hidden>
        <div className="h-3 w-3/4 animate-pulse rounded bg-raised" />
        <div className="h-3 w-full animate-pulse rounded bg-raised" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-raised" />
      </div>
    </div>
  );
}

export function TraceUnavailable({
  title,
  explanation,
  diagnostics,
  error,
}: {
  title: string;
  explanation: string;
  diagnostics?: readonly Diagnostic[];
  error?: string | null;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-warn/40 bg-surface p-4">
      <div className="flex items-center gap-2">
        <TriangleAlert aria-hidden className="size-5 text-warn" />
        <h2 className="text-base font-semibold text-ink">{title}</h2>
      </div>
      <p className="max-w-2xl text-sm text-ink-muted">{explanation}</p>
      {error && (
        <p className="rounded-md border border-err/40 bg-err-soft px-3 py-2 font-mono text-xs text-err">
          {error}
        </p>
      )}
      {diagnostics && diagnostics.length > 0 && <DiagnosticList diagnostics={diagnostics} />}
    </section>
  );
}
