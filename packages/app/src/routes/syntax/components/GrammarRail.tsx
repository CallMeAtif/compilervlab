/**
 * The grammar productions, numbered exactly the way the traces cite them
 * (irRefs carry `production` ids), with the productions referenced by the
 * current step marked.
 *
 * EDITORIAL (docs/EDITORIAL.md §0): this is REFERENCE material, so it is a
 * disclosure above the artifact instead of a permanent third column. Closed, it
 * is one line of mono data — grammar, counts, left recursion. Open, it is the
 * full numbered list, still marking whatever the current step cites.
 */
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { Grammar } from '@lab/core/grammar/grammar.js';
import type { StepRecord } from '@lab/trace';
import { Stat } from './ui';
import { symbols } from '../lib/grammars';

export function productionRefs(step: StepRecord<{ kind: string }> | null): ReadonlySet<number> {
  const out = new Set<number>();
  for (const ref of step?.meta.irRefs ?? []) {
    if (ref.kind === 'production' && typeof ref.id === 'number') out.add(ref.id);
  }
  return out;
}

export function symbolRefs(step: StepRecord<{ kind: string }> | null): ReadonlySet<string> {
  const out = new Set<string>();
  for (const ref of step?.meta.irRefs ?? []) {
    if (ref.kind === 'grammarSymbol' && typeof ref.id === 'string') out.add(ref.id);
  }
  return out;
}

export interface GrammarRailProps {
  grammar: Grammar;
  /** True when the view works on G′ (the LR family) — the rail then shows S′ → S. */
  augmented: boolean;
  highlighted: ReadonlySet<number>;
  leftRecursive: readonly string[];
  className?: string;
}

export function GrammarRail({
  grammar,
  augmented,
  highlighted,
  leftRecursive,
  className,
}: GrammarRailProps) {
  const lrSet = useMemo(() => new Set(leftRecursive), [leftRecursive]);

  return (
    <section aria-label="Grammar productions" className={clsx('mb-7 min-w-0', className)}>
      <details className="group min-w-0 border-b border-line pb-2">
        <summary
          // A quiet text row, not a button: chevron, name, counts. `list-none`
          // drops the browser's own triangle — the chevron IS the shape
          // signifier, and it rotates rather than changing colour.
          className="flex h-9 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-sm text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden"
        >
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-ink-faint transition-transform duration-[var(--dur-fast)] group-open:rotate-90"
          />
          <span className="font-mono text-2xs tracking-[0.08em] uppercase">Grammar</span>
          {/* `augment()` already writes "(augmented)" into the name; saying it
              twice was the old rail's habit, not information. */}
          <span className="font-mono text-xs text-ink">
            {grammar.name}
            {augmented && !/augmented/i.test(grammar.name) && (
              <span className="ml-1.5 text-2xs text-ink-faint">augmented</span>
            )}
          </span>
          <Stat label="prods" value={grammar.productions.length} />
          <Stat label="N" value={grammar.nonterminals.length} />
          <Stat label="T" value={grammar.terminals.length} />
          {leftRecursive.length > 0 && (
            <span className="font-mono text-2xs text-warn">
              left recursive: {leftRecursive.slice(0, 6).join(', ')}
              {leftRecursive.length > 6 ? ` +${leftRecursive.length - 6}` : ''}
            </span>
          )}
        </summary>

        <ol className="artifact-scroll mt-2 max-h-64 min-w-0 font-mono text-xs sm:columns-2 xl:columns-3">
          {grammar.productions.map((p, i) => {
            const prev = grammar.productions[i - 1];
            const newGroup = !prev || prev.lhs !== p.lhs;
            const on = highlighted.has(p.id);
            return (
              <li
                key={p.id}
                data-current={on || undefined}
                className={clsx(
                  'flex break-inside-avoid items-baseline gap-2 rounded px-1.5 py-0.5 transition-colors',
                  newGroup && i > 0 && 'mt-1.5',
                  on && 'bg-accent-soft',
                )}
              >
                {/* shape signifier for "cited by this step", not colour alone */}
                <span
                  aria-hidden
                  className={clsx('w-2 shrink-0', on ? 'text-accent' : 'text-transparent')}
                >
                  ▸
                </span>
                <span className="w-8 shrink-0 text-right text-3xs text-ink-faint">p{p.id}</span>
                <span className="min-w-0 break-words">
                  <span
                    className={clsx('font-semibold', lrSet.has(p.lhs) ? 'text-warn' : 'text-ink')}
                    title={lrSet.has(p.lhs) ? `${p.lhs} is left recursive` : undefined}
                  >
                    {p.lhs}
                  </span>
                  <span className="text-ink-faint"> → </span>
                  <span className="text-ink-muted">{symbols(p.rhs)}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-2 font-mono text-2xs text-ink-faint">
          0-based. ACTION <code className="text-ink-muted">rN</code> reduces by{' '}
          <code className="text-ink-muted">p(N−1)</code>.
        </p>
      </details>
    </section>
  );
}
