import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import type { Phase } from '@lab/core';
import { useCompilationStore, stageInfo } from '../store/compilation';
import { PHASES } from '../lib/phases';
import { STATUS_META, StatusMark } from './StatusBadge';
import { ChevronRight } from 'lucide-react';

const HANDOFF: Partial<Record<Phase, { short: string; long: string }>> = {
  lex: { short: 'tokens', long: 'a token stream and a symbol table' },
  syntax: { short: 'AST', long: 'an abstract syntax tree' },
  semantic: { short: 'typed AST', long: 'the AST annotated with types and resolved names' },
  ir: { short: 'TAC', long: 'three-address code (quadruples)' },
  opt: { short: 'opt. TAC', long: 'optimised three-address code' },
};

const TAGLINE: Record<Phase, string> = {
  lex: 'Regex → NFA → DFA, then scan the source.',
  syntax: 'FIRST/FOLLOW, LL(1) and LR tables, live parse.',
  semantic: 'Scopes, symbol tables, type checking.',
  ir: 'Quadruples, triples, indirect triples.',
  opt: 'Basic blocks, dataflow, classic passes.',
  codegen: 'x86-64 selection, liveness, register colouring.',
};

function StatusLegend() {
  const order: readonly ('ok' | 'errors' | 'stale' | 'pending')[] = ['ok', 'errors', 'stale', 'pending'];
  return (
    <details className="group min-w-0">
      <summary className="flex h-8 w-fit cursor-pointer list-none items-center gap-1 rounded-sm font-mono text-2xs text-ink-faint transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 transition-transform duration-[var(--dur-fast)] group-open:rotate-90 motion-reduce:transition-none"
        />
        key
      </summary>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
        {order.map((s) => (
          <li key={s} className="flex items-center gap-1.5 font-mono text-2xs text-ink-faint">
            <StatusMark status={s} />
            {STATUS_META[s].label}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function PipelineDiagram({ currentPhase }: { currentPhase?: Phase }) {
  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const pipeline = useCompilationStore((s) => s.pipelineInfo);
  return (
    <section aria-labelledby="pipeline-heading" className="section mt-10">
      <div className="section-head">
        <h2 id="pipeline-heading" className="section-title">
          Pipeline
        </h2>
        <StatusLegend />
      </div>

      <ol className="mt-4 grid grid-cols-1 gap-y-5 sm:grid-cols-2 xl:grid-cols-6 xl:gap-y-0">
        {PHASES.map((p, i) => {
          const info = stageInfo(compilation, stale, p.phase, (c) => p.summary(c, pipeline));
          const meta = STATUS_META[info.status];
          const handoff = HANDOFF[p.phase];
          const compiled = info.status !== 'pending';
          
          const isHighlighted = currentPhase 
            ? (PHASES.findIndex(x => x.phase === currentPhase) + 1 === i)
            : (compiled && p.phase === 'lex');

          return (
            <li key={p.phase} className="relative flex min-w-0">
              <Link
                to={p.path}
                title={TAGLINE[p.phase]}
                aria-label={`Phase ${i + 1} of ${PHASES.length}: ${p.title}. ${
                  info.summary ?? meta.label
                }. ${TAGLINE[p.phase]}`}
                className={clsx(
                  "group flex min-w-0 flex-1 flex-col gap-1 border-t-2 pt-2 pr-5 pb-1 transition-colors duration-[var(--dur-fast)] hover:border-accent",
                  isHighlighted ? 'border-accent bg-accent/5' : 'border-line'
                )}
              >
                <span className="flex items-baseline gap-2">
                  <span aria-hidden className="font-mono text-2xs text-ink-faint tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-serif text-base font-semibold text-ink group-hover:text-accent">
                    {p.short}
                  </span>
                  <StatusMark status={info.status} />
                </span>
                <span
                  className={clsx(
                    'font-mono text-2xs break-words tabular-nums',
                    compiled && info.status === 'ok' ? 'text-ink-muted' : meta.text,
                  )}
                  title={info.summary ?? meta.label}
                >
                  {compiled ? (info.summary ?? meta.label) : '—'}
                </span>
              </Link>

              {handoff && (
                <span
                  title={handoff.long}
                  className="pointer-events-none absolute -top-2 right-0 z-10 hidden translate-x-1/2 bg-surface px-1.5 font-mono text-3xs whitespace-nowrap text-ink-faint xl:block"
                >
                  <span className="sr-only">produces </span>
                  {handoff.short} <span aria-hidden>›</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
