/**
 * Small presentational parts shared by the semantic-analysis panes.
 *
 * Editorial rules (docs/EDITORIAL.md): a titled region is a RULE plus air, not
 * a card. Only an artifact that scrolls earns a border (`framed`). Every state
 * still carries a shape — an icon, a glyph, a dashed or coloured edge — so it
 * survives greyscale.
 */
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Box, ChevronRight, FunctionSquare, Variable } from 'lucide-react';
import type { CType, SymbolEntry } from '@lab/core/sem/types.js';
import { Tooltip } from '../../components/ui/Tooltip';
import { typeDescription, typeLabel } from './derive';

/**
 * A titled region: serif title, hairline under it, air below.
 *
 * `mt-0` cancels the `.section + .section` stacking margin, because every call
 * site here places panels in a grid or a `gap`-spaced column and would
 * otherwise get the 2rem twice.
 */
export function Panel({
  title,
  meta,
  primary = false,
  framed = false,
  bodyClassName,
  className,
  children,
}: {
  title: string;
  /** Mono metadata beside the title — counts, citations, column legends. */
  meta?: ReactNode;
  /** The pane the selected algorithm is about: its head rule turns accent. */
  primary?: boolean;
  /** Opt-in border, for a body that scrolls. */
  framed?: boolean;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className={clsx('section mt-0 flex min-w-0 flex-col', className)}>
      <header
        className={clsx(
          'section-head',
          // Accent rule, drawn as a shadow so switching algorithm never
          // changes the head's height (layout-stability rule).
          primary && 'shadow-[0_1px_0_var(--accent)]',
        )}
      >
        <h2 className="section-title">{title}</h2>
        {meta !== undefined && <span className="section-meta">{meta}</span>}
      </header>
      <div
        className={clsx(
          'min-w-0 flex-1',
          framed && 'framed artifact-scroll',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Reference material — the tree's shape key — one interaction away instead of
 * standing permanently between the picker and the tree. Native `<details>`, so
 * it is keyboard-operable and announced as a disclosure with no script.
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

/** Compact C-like type, with the spelled-out reading as its tooltip/title. */
export function TypeChip({ type, className }: { type: CType; className?: string }) {
  const label = typeLabel(type);
  const description = typeDescription(type);
  return (
    <Tooltip content={description}>
      <span
        title={description}
        aria-label={`type ${description}`}
        className={clsx(
          'inline-flex h-5 shrink-0 cursor-help items-center rounded-sm bg-raised px-1.5 font-mono text-2xs text-ink',
          className,
        )}
      >
        {label}
      </span>
    </Tooltip>
  );
}

const KIND_ICON = {
  var: Variable,
  param: Box,
  func: FunctionSquare,
} as const;

/** var / param / func — icon + word, never colour alone. */
export function KindChip({ kind }: { kind: SymbolEntry['kind'] }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-2xs text-ink-faint">
      <Icon aria-hidden className="size-3" />
      {kind}
    </span>
  );
}

/**
 * Educational empty / blocked state: quiet prose, never a loud box. An error
 * keeps a status edge (a 2px rule down the left) so the tone is not colour on
 * text alone.
 */
export function StateCard({
  title,
  children,
  tone = 'neutral',
}: {
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'error';
}) {
  return (
    <section
      aria-label={title}
      className={clsx('section mt-0', tone === 'error' && 'border-l-2 border-err pl-5')}
    >
      <h2 className={clsx('state-title', tone === 'error' && 'text-err')}>
        {title}
      </h2>
      <div className="prose-note mt-2">{children}</div>
    </section>
  );
}

/** Skeleton block used while the worker computes the trace. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx('animate-pulse rounded-sm bg-raised motion-reduce:animate-none', className)}
    />
  );
}
