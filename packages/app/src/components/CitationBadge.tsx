/**
 * Dragon Book citation, set as a FOOTNOTE REFERENCE: "§4.6.2 · Algorithm 4.53"
 * in mono, marked by a dotted underline rather than a pill, with the full
 * reference and the rule it names in the tooltip.
 */
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
      <span className="cursor-help border-b border-dotted border-line-strong font-mono text-2xs whitespace-nowrap text-ink-faint transition-colors duration-[var(--dur-fast)] hover:border-accent hover:text-ink-muted">
        {label}
      </span>
    </Tooltip>
  );
}
