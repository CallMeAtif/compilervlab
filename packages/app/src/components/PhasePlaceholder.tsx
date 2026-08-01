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
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <section className="section">
        <div className="section-head">
          <h2 className="section-title flex items-center gap-2">
            <Construction aria-hidden className="size-4 text-ink-faint" strokeWidth={1.75} />
            {info.title} visualization lands here
          </h2>
          <span className="section-meta">in progress</span>
        </div>
        <p className="prose-note">
          The {info.title.toLowerCase()} team is building this view: artifact visualization on
          the left, the step-through TracePanel on the right, every step cited to the Dragon
          Book.
        </p>
        <dl className="mt-4 grid w-fit grid-cols-[auto_auto] gap-x-6 gap-y-1 font-mono text-xs text-ink-muted">
          <dt className="text-ink-faint">?algo=</dt>
          <dd>{algo ?? '(default)'}</dd>
          <dt className="text-ink-faint">?step=</dt>
          <dd>{step ?? '—'}</dd>
          <dt className="text-ink-faint">?pass=</dt>
          <dd>{pass ?? '—'}</dd>
        </dl>
      </section>

      <aside className="section">
        <div className="section-head">
          <h2 className="section-title">Source under compilation</h2>
        </div>
        {compilation ? (
          <CodeStrip source={compilation.source} maxHeight="24rem" />
        ) : (
          <p className="prose-note">
            Nothing compiled yet — go to the overview and press Compile.
          </p>
        )}
      </aside>
    </div>
  );
}
