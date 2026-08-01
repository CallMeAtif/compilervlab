/**
 * Small presentational parts shared by the semantic-analysis panes. They only
 * use the app's existing tokens (surface/raised/line/ink/accent/ok/err/warn)
 * and never signal with colour alone — every state also carries an icon,
 * a glyph, or a border pattern.
 */
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Box, FunctionSquare, Variable } from 'lucide-react';
import type { CType, SymbolEntry } from '@lab/core/sem/types.js';
import { Tooltip } from '../../components/ui/Tooltip';
import { typeDescription, typeLabel } from './derive';

/** A titled card with the app's standard panel chrome. */
export function Panel({
  title,
  icon,
  actions,
  bodyClassName,
  className,
  children,
}: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={clsx(
        'flex min-w-0 flex-col rounded-lg border border-line bg-surface',
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-ink">
          {icon}
          {title}
        </h3>
        <span className="flex-1" />
        {actions}
      </header>
      <div className={clsx('min-w-0 flex-1', bodyClassName)}>{children}</div>
    </section>
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
          'inline-flex h-5 shrink-0 cursor-help items-center rounded border border-line bg-raised px-1.5 font-mono text-[11px] text-ink',
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
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-line px-1.5 font-mono text-[11px] text-ink-muted">
      <Icon aria-hidden className="size-3" />
      {kind}
    </span>
  );
}

/** Educational empty / blocked state. */
export function StateCard({
  icon,
  title,
  children,
  tone = 'neutral',
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'error';
}) {
  return (
    <section
      aria-label={title}
      className={clsx(
        'flex flex-col items-center gap-2 rounded-lg border p-8 text-center',
        tone === 'error'
          ? 'border-err/50 bg-err-soft'
          : 'border-dashed border-line-strong bg-surface',
      )}
    >
      <span aria-hidden className={tone === 'error' ? 'text-err' : 'text-ink-faint'}>
        {icon}
      </span>
      <h2 className={clsx('text-base font-semibold', tone === 'error' ? 'text-err' : 'text-ink')}>
        {title}
      </h2>
      <div className="max-w-lg text-sm text-ink-muted">{children}</div>
    </section>
  );
}

/** Skeleton block used while the worker computes the trace. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx('animate-pulse rounded-md bg-raised motion-reduce:animate-none', className)}
    />
  );
}
