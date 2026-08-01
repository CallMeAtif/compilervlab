/**
 * The states the /ir page can be in besides "here is a trace": nothing
 * compiled yet, an upstream phase blocked translation, the worker is still
 * building the trace, or the worker failed. Every one of them is written to
 * teach: they say WHY there is no intermediate code.
 */
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { CircleAlert, Loader2, TriangleAlert } from 'lucide-react';
import type { Diagnostic, Phase } from '@lab/core/common/types.js';
import { CodeStrip } from '../../components/viz/CodeStrip';
import { CompileCta } from '../../components/CompileCta';

/** Page-local keyframes: the target field of a backpatched jump filling in.
 *  Emphasis only (background/box-shadow), never layout, and off under
 *  prefers-reduced-motion. */
const IR_CSS = `
@keyframes ir-patch-fill {
  0%   { background-color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent); }
  60%  { background-color: var(--accent-soft); box-shadow: inset 0 0 0 2px var(--accent); }
  100% { background-color: transparent; box-shadow: none; }
}
.ir-patch-fill { animation: ir-patch-fill 900ms ease-out both; border-radius: 3px; }
@media (prefers-reduced-motion: reduce) {
  .ir-patch-fill {
    animation: none;
    background-color: var(--accent-soft);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
}
`;

export function IrStyles() {
  return <style>{IR_CSS}</style>;
}

/**
 * A state is quiet prose, not a loud box: a serif heading and an explanation.
 * An error keeps a status edge (a 2px rule down the left margin) so the tone
 * is carried by a shape as well as by colour.
 */
function Frame({
  title,
  tone = 'neutral',
  children,
}: {
  title: string;
  tone?: 'neutral' | 'error';
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={clsx('section mt-0', tone === 'error' && 'border-l-2 border-err pl-5')}
    >
      <h2 className={clsx('state-title', tone === 'error' && 'text-err')}>
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** Nothing compiled yet. */
export function IrIdle({ source }: { source: string }) {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <Frame title="Compile a program to begin">
        <CompileCta className="flex flex-col items-start gap-2" />
      </Frame>
      <aside className="section mt-0">
        <header className="section-head">
          <h2 className="section-title">Source</h2>
        </header>
        <CodeStrip source={source} maxHeight="24rem" />
      </aside>
    </div>
  );
}

const PHASE_LABEL: Record<Phase, string> = {
  lex: 'Lexical analysis',
  syntax: 'Syntax analysis',
  semantic: 'Semantic analysis',
  ir: 'Intermediate code',
  opt: 'Optimization',
  codegen: 'Code generation',
};

/** An upstream phase errored, so there is no IR trace to show. */
export function IrBlocked({
  diagnostics,
  source,
}: {
  diagnostics: readonly Diagnostic[];
  source: string;
}) {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const shown = errors.length > 0 ? errors : diagnostics;
  const spans = shown.map((d) => d.span);
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <Frame title="An earlier phase stopped the pipeline" tone="error">
        <p className="prose-note text-ink">
          Translation needs a program that parsed and type-checked. Fix the diagnostics below
          and compile again.
        </p>
        {shown.length === 0 ? (
          <p className="prose-note">No diagnostics: the program declares no functions.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {shown.map((d, i) => (
              <li key={`${d.phase}-${d.span.start}-${i}`} className="border-t border-line pt-2">
                <div className="flex flex-wrap items-center gap-2 font-mono text-2xs">
                  {d.severity === 'error' ? (
                    <CircleAlert aria-hidden className="size-3.5 text-err" />
                  ) : (
                    <TriangleAlert aria-hidden className="size-3.5 text-warn" />
                  )}
                  <span className="tracking-wide text-ink-muted uppercase">
                    {PHASE_LABEL[d.phase]}
                  </span>
                  <span className="text-ink-faint">
                    line {d.span.line}, col {d.span.col}
                  </span>
                </div>
                <p className="mt-1 text-ink">{d.message}</p>
                {d.rule && (
                  <p className="mt-1 font-mono text-2xs text-ink-muted">rule: {d.rule}</p>
                )}
                {d.hint && <p className="mt-1 text-sm text-ink-muted">{d.hint}</p>}
              </li>
            ))}
          </ul>
        )}
      </Frame>
      <aside className="section mt-0">
        <header className="section-head">
          <h2 className="section-title">Where the pipeline stopped</h2>
        </header>
        <CodeStrip source={source} spans={spans} maxHeight="24rem" />
      </aside>
    </div>
  );
}

/** The worker itself failed (not a diagnostic). */
export function IrFailed({ message }: { message: string }) {
  return (
    <Frame title="The trace could not be built" tone="error">
      <p className="prose-note text-ink">
        The compile worker refused <span className="font-mono text-xs">ir.gen</span>:
      </p>
      {/* A verbatim machine message is a code listing, so it earns a frame. */}
      <p className="framed bg-code p-3 font-mono text-xs text-err">{message}</p>
    </Frame>
  );
}

/** Trace under construction in the worker. */
export function IrSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]"
    >
      <div className="flex flex-col gap-6">
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 aria-hidden className="size-4 animate-spin text-accent" />
          Translating…
        </p>
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="h-72 animate-pulse rounded-sm bg-raised motion-reduce:animate-none" />
          <div className="h-72 animate-pulse rounded-sm bg-raised motion-reduce:animate-none" />
        </div>
        <div className="h-28 animate-pulse rounded-sm bg-raised motion-reduce:animate-none" />
      </div>
      <div className="h-64 animate-pulse rounded-sm bg-raised motion-reduce:animate-none" />
    </div>
  );
}
