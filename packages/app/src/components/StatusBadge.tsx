/**
 * Stage-status visuals shared by the top bar rail, the phase header and the
 * pipeline diagram.
 *
 * Every status pairs a SHAPE with its colour, so the vocabulary survives
 * greyscale — three ways over, because the three call sites have three
 * densities:
 *   `icon`  a lucide glyph (check / octagon / clock / dashed circle),
 *   `mark`  a one-character typographic mark for the editorial rail (✓ ! ~ ·),
 *   `chip`  the legacy bordered pill (solid vs DASHED border).
 */
import type { LucideIcon } from 'lucide-react';
import { CircleCheck, OctagonAlert, Clock, CircleDashed } from 'lucide-react';
import { clsx } from 'clsx';
import type { StageStatus } from '../store/compilation';

export const STATUS_META: Record<
  StageStatus,
  { icon: LucideIcon; mark: string; label: string; text: string; chip: string }
> = {
  ok: {
    icon: CircleCheck,
    mark: '✓',
    label: 'up to date',
    text: 'text-ok',
    chip: 'border-solid border-ok/40 bg-ok-soft text-ok',
  },
  errors: {
    icon: OctagonAlert,
    mark: '!',
    label: 'has errors',
    text: 'text-err',
    chip: 'border-solid border-err/40 bg-err-soft text-err',
  },
  stale: {
    icon: Clock,
    mark: '~',
    label: 'stale — recompile',
    text: 'text-warn',
    chip: 'border-dashed border-warn/60 bg-warn-soft text-warn',
  },
  pending: {
    icon: CircleDashed,
    mark: '·',
    label: 'not yet compiled',
    text: 'text-ink-faint',
    chip: 'border-dashed border-line-strong bg-transparent text-ink-faint',
  },
};

/**
 * The typographic status mark: a fixed-width mono cell so four different
 * glyphs never shift the label beside them. Decorative — every call site
 * already states the status in its own accessible name.
 */
export function StatusMark({
  status,
  count,
  className,
}: {
  status: StageStatus;
  /** Error count, printed after the mark when > 1 occurrence matters. */
  count?: number;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex shrink-0 items-center justify-center font-mono text-2xs leading-none tabular-nums',
        meta.text,
        className,
      )}
    >
      <span className="inline-block w-[0.6rem] text-center">{meta.mark}</span>
      {count !== undefined && count > 0 && <span className="ml-px">{count}</span>}
    </span>
  );
}

export function StatusIcon({
  status,
  className,
}: {
  status: StageStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Icon
      aria-hidden
      className={clsx('size-3.5 shrink-0', meta.text, className)}
      strokeWidth={2.25}
    />
  );
}
