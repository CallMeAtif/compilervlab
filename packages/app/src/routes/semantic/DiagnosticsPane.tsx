/**
 * Educational diagnostic cards: what failed (message), which rule of
 * docs/c-subset.md it violated, how to fix it (hint), and where (span).
 * Clicking a card seeks the trace to the step that reported it, so the
 * ExplainCard and the source strip follow.
 */
import { clsx } from 'clsx';
import { CircleAlert, CircleCheck, Crosshair, TriangleAlert } from 'lucide-react';
import type { Diagnostic } from '@lab/core';

export interface DiagnosticsPaneProps {
  /** Diagnostics revealed by the cursor, in report order. */
  diagnostics: readonly Diagnostic[];
  /** Diagnostics the finished pass reports (may be more than revealed). */
  total: number;
  onFocus: (d: Diagnostic) => void;
  selectedIndex: number | null;
}

export function DiagnosticsPane({
  diagnostics,
  total,
  onFocus,
  selectedIndex,
}: DiagnosticsPaneProps) {
  if (total === 0) {
    return (
      <h3 className="flex items-center gap-2 text-[17px] font-semibold text-ink">
        <CircleCheck aria-hidden className="size-4.5 text-ok" />
        No semantic diagnostics
      </h3>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-2xs text-ink-faint">
        {diagnostics.length} of {total} reported
      </p>
      <ul className="flex flex-col gap-4">
        {diagnostics.map((d, i) => {
          const isError = d.severity === 'error';
          const Icon = isError ? CircleAlert : TriangleAlert;
          return (
            <li key={`${d.span.start}-${i}`}>
              <button
                type="button"
                onClick={() => onFocus(d)}
                aria-label={`${d.severity} at line ${d.span.line}, column ${d.span.col}: ${d.message}. Seek the trace to this step.`}
                className={clsx(
                  // Status edge, not a box: a 2px rule down the left. Selection
                  // adds a tint on top, so the two signals never collide.
                  'flex w-full cursor-pointer flex-col gap-1 border-l-2 py-1 pl-3 text-left transition-colors duration-[var(--dur)]',
                  isError ? 'border-err' : 'border-warn',
                  selectedIndex === i
                    ? isError
                      ? 'bg-err-soft'
                      : 'bg-warn-soft'
                    : 'hover:bg-raised',
                )}
              >
                <span
                  className={clsx(
                    'flex flex-wrap items-center gap-2 font-mono text-2xs font-semibold',
                    isError ? 'text-err' : 'text-warn',
                  )}
                >
                  <Icon aria-hidden className="size-3.5 shrink-0" />
                  {d.severity}
                  <span className="font-normal text-ink-faint">
                    line {d.span.line}:{d.span.col}
                  </span>
                  <span className="flex-1" />
                  <span className="inline-flex items-center gap-1 font-normal text-ink-muted">
                    <Crosshair aria-hidden className="size-3" />
                    show step
                  </span>
                </span>

                <span className="text-ink">{d.message}</span>

                {d.rule && (
                  <span className="font-mono text-2xs leading-relaxed text-ink-muted">
                    <span className="text-ink-faint">failed rule · </span>
                    {d.rule}
                  </span>
                )}

                {d.hint && (
                  <span className="text-sm leading-relaxed text-ink-muted">
                    <span className="text-ink-faint">hint · </span>
                    {d.hint}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
