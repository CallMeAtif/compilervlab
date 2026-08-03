/**
 * Shared building blocks for `/` and `/about`, so both pages speak one voice.
 *
 *   Cta          — the two action shapes. Crimson fill means "the primary way
 *                  forward"; the outline is everything else. No pills, no
 *                  gradients, no icons: 4px corners, matching the lab's own
 *                  `.framed` geometry.
 *   Artifact     — a mono listing in the code well, with a mono caption row.
 *                  Wide content scrolls inside itself, never widening the page.
 *   PhaseSection — one of the six compiler phases. The ordinal sits ON the
 *                  spine rule drawn by `.site-spine`, paired with the Dragon
 *                  Book section the lab cites for that phase, so the numbering
 *                  carries information instead of decorating.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { Reveal } from './Reveal';

// ── Actions ──────────────────────────────────────────────────────────────────

interface CtaProps {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
}

export function Cta({ to, children, variant = 'primary', className }: CtaProps) {
  return (
    <Link
      to={to}
      className={clsx(
        'inline-flex min-h-11 items-center justify-center rounded-xs px-5 font-inter text-sm font-semibold transition-colors duration-[var(--dur-fast)]',
        variant === 'primary'
          ? 'bg-somaiya text-on-somaiya hover:bg-somaiya-dark'
          : 'border border-control text-ink hover:border-ink-faint hover:bg-raised',
        className,
      )}
    >
      {children}
    </Link>
  );
}

// ── Artifacts ────────────────────────────────────────────────────────────────

interface ArtifactProps {
  /** Mono caption under the listing: counts, citation, provenance. */
  caption: string;
  children: ReactNode;
  className?: string;
}

export function Artifact({ caption, children, className }: ArtifactProps) {
  return (
    <figure className={clsx('site-well overflow-hidden', className)}>
      <div className="site-listing artifact-scroll px-4 py-4 text-ink sm:px-5">{children}</div>
      <figcaption className="border-t border-line px-4 py-2 font-mono text-2xs text-ink-faint sm:px-5">
        {caption}
      </figcaption>
    </figure>
  );
}

// ── The pipeline ─────────────────────────────────────────────────────────────

export interface PhaseSectionProps {
  /** "01" … "06". The compiler's phases genuinely are an ordered sequence. */
  ordinal: string;
  /** LEXICAL, SYNTAX, … — the phase's name in the lab's own vocabulary. */
  name: string;
  /** The Dragon Book anchor the lab cites for this phase. Real, from the code. */
  cite: string;
  /** Route into the lab for this phase. */
  href: string;
  /** The heading a reader actually reads. */
  title: string;
  /** What the phase does to `max.c`. Two or three sentences, no filler. */
  children: ReactNode;
  /** The artifact this phase produced. */
  artifact: ReactNode;
}

export function PhaseSection({
  ordinal,
  name,
  cite,
  href,
  title,
  children,
  artifact,
}: PhaseSectionProps) {
  return (
    <Reveal as="section" className="scroll-mt-24">
      <div className="grid grid-cols-1 gap-x-6 lg:grid-cols-[2.25rem_minmax(0,1fr)]">
        {/* Ordinal — on the spine at lg, inline with the phase name below it. */}
        <div className="hidden lg:block">
          <span className="site-ordinal">{ordinal}</span>
        </div>

        <div className="min-w-0">
          <div className="site-eyebrow flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="lg:hidden">{ordinal}</span>
            <span className="text-ink-muted">{name}</span>
            <span aria-hidden className="hidden h-px flex-1 bg-line sm:block" />
            <span>{cite}</span>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <h3 className="site-heading">{title}</h3>
              <div className="site-body mt-3">{children}</div>
              <Link
                to={href}
                className="mt-3 inline-flex min-h-11 items-center font-mono text-2xs tracking-[0.12em] text-ink-muted uppercase underline decoration-line-strong underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:text-somaiya-strong hover:decoration-somaiya-strong"
              >
                Step through {name.toLowerCase()}
              </Link>
            </div>
            <div className="min-w-0">{artifact}</div>
          </div>
        </div>
      </div>
    </Reveal>
  );
}
