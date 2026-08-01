/**
 * The linear three-address code of one function, annotated as the partitioning
 * algorithm discovers leaders (§8.4.1, Algorithm 8.5) and forms blocks.
 * Leaders are marked with the RULE that fired (a numbered badge, so the signal
 * is never colour alone).
 */
import { clsx } from 'clsx';
import { Flag } from 'lucide-react';
import type { QuadLine } from '../lib/cfgModel';

export type LeaderRule = 1 | 2 | 3;

export const LEADER_RULES: Record<LeaderRule, string> = {
  1: 'Rule 1 — the first three-address instruction of the program is a leader.',
  2: 'Rule 2 — any instruction that is the target of a conditional or unconditional jump is a leader.',
  3: 'Rule 3 — any instruction that immediately follows a conditional or unconditional jump is a leader.',
};

export interface TacListingProps {
  lines: readonly QuadLine[];
  /** quadIndex → leader rule that fired. */
  leaders?: ReadonlyMap<number, LeaderRule>;
  /** quadIndex → block id, for instructions already assigned to a block. */
  blockOf?: ReadonlyMap<number, number>;
  currentQuads?: ReadonlySet<number>;
  /** quadIndex → short marker text shown at the end of the row. */
  markers?: ReadonlyMap<number, string>;
  className?: string;
  ariaLabel?: string;
}

export function TacListing({
  lines,
  leaders,
  blockOf,
  currentQuads,
  markers,
  className,
  ariaLabel = 'Three-address code',
}: TacListingProps) {
  return (
    <ol
      aria-label={ariaLabel}
      className={clsx('overflow-auto rounded-md border border-line bg-code font-mono text-xs', className)}
    >
      {lines.map((line) => {
        const rule = leaders?.get(line.index);
        const block = blockOf?.get(line.index);
        const isCurrent = currentQuads?.has(line.index) ?? false;
        const marker = markers?.get(line.index);
        return (
          <li
            key={line.index}
            aria-current={isCurrent ? 'step' : undefined}
            className={clsx(
              'flex items-start gap-2 border-l-2 px-2 py-[3px]',
              block !== undefined ? 'border-l-accent/60' : 'border-l-transparent',
              isCurrent && 'bg-accent-soft',
              rule !== undefined && !isCurrent && 'bg-raised',
            )}
          >
            <span className="w-6 shrink-0 text-right text-ink-faint">{line.index}</span>
            <span className="flex w-11 shrink-0 justify-start">
              {rule !== undefined ? (
                <span
                  title={LEADER_RULES[rule]}
                  className="inline-flex h-4 items-center gap-0.5 rounded-sm border border-accent/60 px-1 text-[10px] font-semibold text-ink"
                >
                  <Flag aria-hidden className="size-2.5" />
                  L{rule}
                </span>
              ) : null}
            </span>
            <span className="w-9 shrink-0 text-[10px] text-ink-muted">
              {block !== undefined ? `B${block}` : ''}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap text-ink">{line.text}</span>
            {marker && (
              <span className="shrink-0 rounded-sm border border-line-strong px-1 text-[10px] tracking-wide text-ink-muted uppercase">
                {marker}
              </span>
            )}
          </li>
        );
      })}
      {lines.length === 0 && (
        <li className="px-3 py-6 text-center text-ink-faint">This function has no instructions.</li>
      )}
    </ol>
  );
}
