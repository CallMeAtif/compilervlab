/**
 * Shared placeholder body for phase routes awaiting their phase team's
 * content wave. Shows what will land here and the current deep-link state so
 * teams can verify ?algo=&step=&pass= round-tripping immediately.
 */
import type { Phase } from '@lab/core';
import { Construction } from 'lucide-react';
import { phaseInfo } from '../lib/phases';
import { usePhaseUrlState } from '../lib/urlState';
import { useCompilationStore } from '../store/compilation';
import { CodeStrip } from './viz/CodeStrip';

export function PhasePlaceholder({ phase }: { phase: Phase }) {
  const info = phaseInfo(phase);
  const { algo, step, pass } = usePhaseUrlState();
  const compilation = useCompilationStore((s) => s.compilation);

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <section className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
        <Construction aria-hidden className="size-8 text-ink-faint" strokeWidth={1.5} />
        <h2 className="text-base font-semibold text-ink">
          {info.title} visualization lands here
        </h2>
        <p className="max-w-md text-sm text-ink-muted">
          The {info.title.toLowerCase()} team is building this view: artifact visualization on
          the left, the step-through TracePanel on the right, every step cited to the Dragon
          Book.
        </p>
        <dl className="mt-2 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 rounded-md bg-raised px-4 py-2 text-left font-mono text-xs text-ink-muted">
          <dt>?algo=</dt>
          <dd>{algo ?? '(default)'}</dd>
          <dt>?step=</dt>
          <dd>{step ?? '—'}</dd>
          <dt>?pass=</dt>
          <dd>{pass ?? '—'}</dd>
        </dl>
      </section>

      <aside className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-ink-muted">
          Source under compilation
        </h3>
        {compilation ? (
          <CodeStrip source={compilation.source} maxHeight="24rem" />
        ) : (
          <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-ink-faint">
            Nothing compiled yet — go to the overview and press Compile.
          </p>
        )}
      </aside>
    </div>
  );
}
