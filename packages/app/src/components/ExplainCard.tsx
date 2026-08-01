/** Prose explanation of the current step, with its mandatory citation. */
import type { StepRecord } from '@lab/trace';
import { clsx } from 'clsx';
import { Layers, OctagonAlert } from 'lucide-react';
import { CitationBadge } from './CitationBadge';
import { isErrorEvent } from '../lib/useStepper';

export interface ExplainCardProps {
  step: StepRecord<{ kind: string }> | null;
  index: number;
  length: number;
  className?: string;
}

export function ExplainCard({ step, index, length, className }: ExplainCardProps) {
  const isError = step !== null && isErrorEvent(step.event);
  return (
    <section
      aria-label="Step explanation"
      className={clsx(
        'flex min-h-24 flex-col gap-2 rounded-lg border p-3',
        isError ? 'border-err/50 bg-err-soft' : 'border-line bg-surface',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xs text-ink-faint">
          {step ? `step ${index} / ${length}` : `initial state · ${length} steps`}
        </span>
        {step && (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-raised px-2 font-mono text-2xs text-ink-muted">
            {step.event.kind}
          </span>
        )}
        {step?.meta.level === 'micro' && (
          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-raised px-2 text-2xs text-ink-muted">
            <Layers aria-hidden className="size-3" />
            micro
          </span>
        )}
        <span className="flex-1" />
        {step && <CitationBadge cite={step.meta.cite} />}
      </div>
      {/* The error state carries a glyph and a word as well as the colour. */}
      <p
        className={clsx(
          'flex items-start gap-1.5 text-sm leading-relaxed',
          isError ? 'text-err' : 'text-ink',
        )}
      >
        {isError && (
          <>
            <OctagonAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="sr-only">Error step: </span>
          </>
        )}
        <span>
          {step
            ? step.meta.prose
            : 'Nothing applied yet — press play or step forward to begin.'}
        </span>
      </p>
    </section>
  );
}
