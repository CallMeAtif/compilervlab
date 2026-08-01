/**
 * Stage-status visuals shared by the top bar chips and the pipeline diagram.
 * Every status pairs an icon + border shape with its color (never color-only):
 * ok = check, errors = octagon alert, stale = clock + DASHED border,
 * pending = dashed circle.
 */
import type { LucideIcon } from 'lucide-react';
import { CircleCheck, OctagonAlert, Clock, CircleDashed } from 'lucide-react';
import { clsx } from 'clsx';
import type { StageStatus } from '../store/compilation';

export const STATUS_META: Record<
  StageStatus,
  { icon: LucideIcon; label: string; text: string; chip: string }
> = {
  ok: {
    icon: CircleCheck,
    label: 'up to date',
    text: 'text-ok',
    chip: 'border-solid border-ok/40 bg-ok-soft text-ok',
  },
  errors: {
    icon: OctagonAlert,
    label: 'has errors',
    text: 'text-err',
    chip: 'border-solid border-err/40 bg-err-soft text-err',
  },
  stale: {
    icon: Clock,
    label: 'stale — recompile',
    text: 'text-warn',
    chip: 'border-dashed border-warn/60 bg-warn-soft text-warn',
  },
  pending: {
    icon: CircleDashed,
    label: 'not yet compiled',
    text: 'text-ink-faint',
    chip: 'border-dashed border-line-strong bg-transparent text-ink-faint',
  },
};

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
