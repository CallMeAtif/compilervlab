/**
 * The states the /ir page can be in besides "here is a trace": nothing
 * compiled yet, an upstream phase blocked translation, the worker is still
 * building the trace, or the worker failed. Every one of them is written to
 * teach: they say WHY there is no intermediate code.
 */
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Braces, CircleAlert, Loader2, TriangleAlert } from 'lucide-react';
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

function Frame({
  title,
  icon,
  tone = 'neutral',
  children,
}: {
  title: string;
  icon: ReactNode;
  tone?: 'neutral' | 'error';
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={clsx(
        'flex flex-col gap-3 rounded-lg border p-6',
        tone === 'error' ? 'border-err/50 bg-err-soft' : 'border-dashed border-line-strong bg-surface',
      )}
    >
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Nothing compiled yet. */
export function IrIdle({ source }: { source: string }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <Frame title="Compile a program to begin" icon={<Braces aria-hidden className="size-5 text-accent" />}>
        <p className="max-w-2xl text-sm text-ink-muted">
          Intermediate code generation translates the type-checked AST into three-address code
          (Dragon Book §6.2–§6.9). Compile, and this view replays the translation step by step:
          each AST node as it is entered, each quadruple as it is emitted, and every §6.7
          backpatch that fills in a jump target.
        </p>
        <CompileCta className="flex flex-col items-start gap-2" />
        <ul className="grid gap-1 text-sm text-ink-muted sm:grid-cols-3">
          <li className="rounded-md bg-raised px-3 py-2">
            <span className="font-medium text-ink">Quadruples</span> — op · arg1 · arg2 · result
          </li>
          <li className="rounded-md bg-raised px-3 py-2">
            <span className="font-medium text-ink">Triples</span> — values named by position
          </li>
          <li className="rounded-md bg-raised px-3 py-2">
            <span className="font-medium text-ink">Indirect triples</span> — a listing of pointers
          </li>
        </ul>
      </Frame>
      <aside className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-ink-muted">
          Source waiting to be compiled
        </h3>
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
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <Frame
        title="No intermediate code: an earlier phase stopped the pipeline"
        tone="error"
        icon={<CircleAlert aria-hidden className="size-5 text-err" />}
      >
        <p className="max-w-2xl text-sm text-ink">
          Translation to three-address code runs only on a program that parsed and type-checked
          cleanly — the generator indexes <span className="font-mono">SemanticInfo</span> for the
          type and symbol of every node it visits, so a single unresolved name would make the
          translation meaningless. Fix the diagnostics below and compile again.
        </p>
        {shown.length === 0 ? (
          <p className="text-sm text-ink-muted">
            The worker returned no trace and no diagnostics — this usually means the program
            declares no functions to translate.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((d, i) => (
              <li
                key={`${d.phase}-${d.span.start}-${i}`}
                className="rounded-md border border-line bg-surface p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {d.severity === 'error' ? (
                    <CircleAlert aria-hidden className="size-4 text-err" />
                  ) : (
                    <TriangleAlert aria-hidden className="size-4 text-warn" />
                  )}
                  <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
                    {PHASE_LABEL[d.phase]}
                  </span>
                  <span className="font-mono text-[11px] text-ink-faint">
                    line {d.span.line}, col {d.span.col}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink">{d.message}</p>
                {d.rule && (
                  <p className="mt-1 font-mono text-[11px] text-ink-muted">rule: {d.rule}</p>
                )}
                {d.hint && <p className="mt-1 text-xs text-ink-muted">{d.hint}</p>}
              </li>
            ))}
          </ul>
        )}
      </Frame>
      <aside className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-ink-muted">
          Where the pipeline stopped
        </h3>
        <CodeStrip source={source} spans={spans} maxHeight="24rem" />
      </aside>
    </div>
  );
}

/** The worker itself failed (not a diagnostic). */
export function IrFailed({ message }: { message: string }) {
  return (
    <Frame
      title="The trace could not be built"
      tone="error"
      icon={<CircleAlert aria-hidden className="size-5 text-err" />}
    >
      <p className="text-sm text-ink">
        The compile worker refused the <span className="font-mono">ir.gen</span> request:
      </p>
      <p className="rounded-md bg-surface p-3 font-mono text-xs text-err">{message}</p>
    </Frame>
  );
}

/** Trace under construction in the worker. */
export function IrSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 aria-hidden className="size-4 animate-spin text-accent" />
          Translating the AST to three-address code in the worker…
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="h-72 animate-pulse rounded-lg border border-line bg-raised" />
          <div className="h-72 animate-pulse rounded-lg border border-line bg-raised" />
        </div>
        <div className="h-28 animate-pulse rounded-lg border border-line bg-raised" />
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-line bg-raised" />
    </div>
  );
}
