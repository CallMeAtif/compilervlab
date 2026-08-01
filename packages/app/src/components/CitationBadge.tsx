/** Dragon Book citation chip: "§4.6.2 · Algorithm 4.53" with rule tooltip. */
import { BookOpen } from 'lucide-react';
import type { Citation } from '@lab/trace';
import { Tooltip } from './ui/Tooltip';

export function CitationBadge({ cite }: { cite: Citation }) {
  const label = cite.figureOrAlgo ? `§${cite.section} · ${cite.figureOrAlgo}` : `§${cite.section}`;
  return (
    <Tooltip
      content={
        <span>
          <span className="font-medium">Dragon Book (2nd ed.), §{cite.section}</span>
          {cite.figureOrAlgo && <span> — {cite.figureOrAlgo}</span>}
          {cite.rule && <span className="mt-1 block text-ink-muted">{cite.rule}</span>}
        </span>
      }
    >
      <span className="inline-flex h-6 cursor-help items-center gap-1.5 rounded-full border border-line bg-raised px-2 font-mono text-2xs text-ink-muted">
        <BookOpen aria-hidden className="size-3" />
        {label}
      </span>
    </Tooltip>
  );
}
