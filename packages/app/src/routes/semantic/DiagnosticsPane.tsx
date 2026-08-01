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
      <div className="flex flex-col items-center gap-2 p-8 text-center">
        <CircleCheck aria-hidden className="size-7 text-ok" />
        <h3 className="text-base font-semibold text-ink">No semantic diagnostics</h3>
        <p className="max-w-md text-sm text-ink-muted">
          Every name resolved through the scope chain and every rule of the C subset held, so
          the pass hands a complete SemanticInfo to intermediate-code generation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <p className="text-xs text-ink-muted">
        {diagnostics.length} of {total} reported at this step. Playback stops on each error —
        errors are pedagogical stopping points, not crashes: the pass keeps checking so you see
        every violation.
      </p>
      <ul className="flex flex-col gap-2">
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
                  'flex w-full cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-left transition-[border-color,box-shadow] duration-200',
                  isError ? 'border-err/50 bg-err-soft' : 'border-warn/50 bg-warn-soft',
                  selectedIndex === i &&
                    (isError
                      ? 'shadow-[inset_0_0_0_1.5px_var(--err)]'
                      : 'shadow-[inset_0_0_0_1.5px_var(--warn)]'),
                )}
              >
                <span
                  className={clsx(
                    'flex flex-wrap items-center gap-2 text-xs font-semibold',
                    isError ? 'text-err' : 'text-warn',
                  )}
                >
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {d.severity}
                  <span className="font-mono font-normal">
                    line {d.span.line}:{d.span.col}
                  </span>
                  <span className="flex-1" />
                  <span className="inline-flex items-center gap-1 font-normal text-ink-muted">
                    <Crosshair aria-hidden className="size-3" />
                    show step
                  </span>
                </span>

                <span className="text-sm leading-relaxed text-ink">{d.message}</span>

                {d.rule && (
                  <span className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11px] leading-relaxed text-ink-muted">
                    <span className="font-semibold text-ink">failed rule · </span>
                    {d.rule}
                  </span>
                )}

                {d.hint && (
                  <span className="text-[13px] leading-relaxed text-ink-muted">
                    <span className="font-semibold text-ink">hint · </span>
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
