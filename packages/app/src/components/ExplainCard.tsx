/**
 * What the CURRENT step did, and nothing else: a rule, a line of mono metadata
 * with the mandatory citation, and one short paragraph. No standing copy.
 *
 * The paragraph is clamped to three lines — roughly the 25-word ceiling
 * docs/EDITORIAL.md sets for step prose. A trace that writes more still reads
 * in full to a screen reader (the transport's aria-live region speaks the whole
 * string) and on hover, but the card never sprawls and never re-flows the page
 * under it. An error step is marked by a rule in the margin plus a glyph and
 * the word "Error", never by a coloured box.
 */
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
        // min-h holds the block still while prose of different lengths passes
        // through it, so stepping never re-flows the page below.
        'flex min-h-20 flex-col gap-1.5 border-t border-line pt-2',
        isError && 'border-l-2 border-l-err pl-3',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-mono text-2xs tabular-nums text-ink-faint">
          {step ? `step ${index} / ${length}` : `initial state · ${length} steps`}
        </span>
        {step && (
          <span className="font-mono text-2xs tracking-[0.06em] text-ink-muted">
            {step.event.kind}
          </span>
        )}
        {step?.meta.level === 'micro' && (
          <span className="inline-flex items-center gap-1 font-mono text-2xs text-ink-faint">
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
          'prose-note flex items-start gap-1.5',
          isError ? 'text-err' : 'text-ink',
        )}
      >
        {isError && (
          <>
            <OctagonAlert aria-hidden className="mt-1 size-4 shrink-0" />
            <span className="sr-only">Error step: </span>
          </>
        )}
        <span className="line-clamp-3" title={step?.meta.prose}>
          {step ? step.meta.prose : 'Press play to begin.'}
        </span>
      </p>
    </section>
  );
}
