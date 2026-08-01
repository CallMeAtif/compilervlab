/**
 * Shared chrome for the optimization phase: the titled region, chips, the
 * disclosure that holds reference material, and the required empty /
 * upstream-error / loading states.
 *
 * EDITORIAL (docs/EDITORIAL.md §0): a panel gets a LABEL, never a sentence —
 * which is why `Panel` has no `subtitle` slot at all. Anything a reader needs
 * beside the title is metadata (`actions`) or belongs in the step prose, which
 * changes as you step. Reference material goes in a `Disclosure`.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ChevronRight, CircleAlert, Info, Loader2, TriangleAlert } from 'lucide-react';
import type { Diagnostic } from '@lab/core';
import { CitationBadge } from '../../../components/CitationBadge';
import { CompileCta } from '../../../components/CompileCta';
import { FullscreenBody, FullscreenToggle } from '../../../components/Fullscreen';
import { useFullscreen } from '../../../lib/useFullscreen';

// ── Panel: a titled region ───────────────────────────────────────────────────

/**
 * Fullscreen opt-in for a panel whose artifact is a table or a listing.
 * `label` names it in the toggle's accessible name; `controls` is the transport
 * bar the artifact keeps while it fills the screen (a table you cannot step is
 * a screenshot).
 */
export interface PanelFullscreen {
  label: string;
  controls?: ReactNode;
  /** Classes for the scrolling area while fullscreen (e.g. a listing's stock). */
  bodyClassName?: string;
}

export function Panel({
  title,
  cite,
  actions,
  children,
  bodyClassName,
  className,
  frame = false,
  fullscreen,
}: {
  /** A label. Four words at most — never a sentence (docs/EDITORIAL.md §0). */
  title: ReactNode;
  /** "§9.2.4 · Algorithm 9.11" style anchor, rendered as a citation chip. */
  cite?: { section: string; figureOrAlgo?: string; rule?: string };
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
  /** Opt in to a border — only for artifacts that scroll or must be contained. */
  frame?: boolean;
  /** Opt in to fullscreen; the toggle joins `actions` in the head. */
  fullscreen?: PanelFullscreen;
}) {
  // Called unconditionally (hook rules); inert until a caller opts in.
  const fs = useFullscreen();
  const body = clsx(frame && 'framed artifact-scroll', bodyClassName);

  return (
    <section className={clsx('section', className)}>
      <header className="section-head">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="section-title">{title}</h2>
          {cite && <CitationBadge cite={cite} />}
        </div>
        {(actions || fullscreen) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            {/* The toggle sits in the band the region already has, rather than
                floating over the artifact's top-right corner — which on a
                table is the OUT column and on a listing is the first line. */}
            {fullscreen && <FullscreenToggle fs={fs} label={fullscreen.label} />}
          </div>
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
 * Reference material — rule statements, domain listings, keys — one interaction
 * away instead of permanently on screen. Native `<details>`: keyboard operable,
 * announced, and no state of our own.
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
        'inline-flex h-5 items-center gap-1 rounded-full px-2 font-mono text-2xs',
        tone === 'neutral' && 'bg-raised text-ink-muted',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'err' && 'bg-err-soft text-err',
        tone === 'accent' && 'bg-accent-soft text-ink shadow-[inset_0_0_0_1px_var(--accent)]',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * A remark, not a box: a coloured rule on the leading edge, a glyph, and the
 * sentence itself in the running voice. Tone is carried by the rule + the icon
 * (shape as well as colour), so it survives greyscale without a fill.
 */
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
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
    ) : tone === 'warn' ? (
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
    ) : (
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
    );
  return (
    <div
      role="status"
      className={clsx(
        'section flex items-start gap-2.5 border-l-2 py-0.5 pl-3 text-sm',
        tone === 'info' && 'border-l-line-strong text-ink-muted',
        tone === 'ok' && 'border-l-ok text-ink-muted [&>svg]:text-ok',
        tone === 'warn' && 'border-l-warn text-ink-muted [&>svg]:text-warn',
        tone === 'err' && 'border-l-err text-ink-muted [&>svg]:text-err',
        className,
      )}
    >
      {icon ?? fallback}
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

// ── Required states ──────────────────────────────────────────────────────────

/** No compilation at all yet. Quiet prose and one action — not a dashed box. */
export function NothingCompiled() {
  return (
    <section className="section max-w-2xl py-6">
      <h2 className="state-title">Nothing compiled yet</h2>
      <p className="prose-note mt-3">Compile to trace the optimizer.</p>
      {/* Left-aligned: the state is a paragraph with an action after it, not a
          centred placeholder card. */}
      <CompileCta className="mt-5 flex flex-col items-start gap-2" />
    </section>
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
            <span className={clsx(d.severity === 'error' ? 'text-err' : 'text-warn')}>
              {d.severity === 'error' ? '■' : '▲'} {d.phase}
            </span>
            {'  '}line {d.span.line}:{d.span.col}
          </p>
          <p className="mt-0.5 text-sm text-ink">{d.message}</p>
          {d.rule && <p className="prose-note mt-0.5 text-sm">Rule: {d.rule}</p>}
          {d.hint && <p className="prose-note mt-0.5 text-sm">Hint: {d.hint}</p>}
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
    <section className="section max-w-3xl py-4">
      <h2 className="state-title text-err">{what} did not run</h2>
      <p className="prose-note mt-3">An earlier phase reported errors.</p>
      <hr className="rule" />
      {errors.length > 0 ? (
        <DiagnosticList diagnostics={errors} />
      ) : (
        <Notice tone="warn">No diagnostics recorded.</Notice>
      )}
      <Link
        to="/"
        className="mt-5 flex h-11 w-fit items-center rounded-md border border-control px-4 text-sm font-medium text-ink transition-colors hover:bg-raised"
      >
        Back to the source
      </Link>
    </section>
  );
}

export function LoadingPanel({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="section flex flex-col gap-4 py-10">
      <p className="flex items-center gap-2.5 text-sm text-ink-muted">
        <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-accent" />
        {label}
      </p>
      <div className="flex max-w-md flex-col gap-2" aria-hidden>
        <div className="h-px w-3/4 animate-pulse bg-line" />
        <div className="h-px w-full animate-pulse bg-line" />
        <div className="h-px w-2/3 animate-pulse bg-line" />
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
    <section className="section max-w-3xl py-4">
      <h2 className="section-title flex items-center gap-2 text-warn">
        <TriangleAlert aria-hidden className="size-4 shrink-0" />
        {title}
      </h2>
      <p className="prose-note mt-2">{explanation}</p>
      {error && (
        <pre className="framed artifact-scroll mt-4 px-3 py-2 font-mono text-2xs text-err">
          {error}
        </pre>
      )}
      {diagnostics && diagnostics.length > 0 && (
        <div className="mt-4">
          <DiagnosticList diagnostics={diagnostics} />
        </div>
      )}
    </section>
  );
}
