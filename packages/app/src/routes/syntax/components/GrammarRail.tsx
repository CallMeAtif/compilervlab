/**
 * The always-visible production rail: the selected grammar, numbered exactly the
 * way the traces cite it (irRefs carry `production` ids), with the productions
 * referenced by the current step marked.
 */
import { useMemo } from 'react';
import { clsx } from 'clsx';
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
    <aside
      aria-label="Grammar productions"
      className={clsx(
        'flex min-w-0 flex-col rounded-lg border border-line bg-surface',
        className,
      )}
    >
      <header className="flex flex-col gap-2 border-b border-line px-3 py-2">
        <h3 className="text-sm font-semibold tracking-tight text-ink">
          {grammar.name}
          {augmented && <span className="ml-1 font-mono text-xs text-ink-faint">(augmented)</span>}
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <Stat label="prods" value={grammar.productions.length} />
          <Stat label="N" value={grammar.nonterminals.length} />
          <Stat label="T" value={grammar.terminals.length} />
        </div>
      </header>

      <ol className="min-w-0 flex-1 overflow-auto p-1 font-mono text-xs lg:max-h-[calc(100vh-22rem)]">
        {grammar.productions.map((p, i) => {
          const prev = grammar.productions[i - 1];
          const newGroup = !prev || prev.lhs !== p.lhs;
          const on = highlighted.has(p.id);
          return (
            <li
              key={p.id}
              data-current={on || undefined}
              className={clsx(
                'flex items-baseline gap-2 rounded px-1.5 py-0.5 transition-colors',
                newGroup && i > 0 && 'mt-1.5',
                on && 'bg-accent-soft',
              )}
            >
              {/* shape signifier for "cited by this step", not colour alone */}
              <span aria-hidden className={clsx('w-2 shrink-0', on ? 'text-accent' : 'text-transparent')}>
                ▸
              </span>
              <span className="w-8 shrink-0 text-right text-[10px] text-ink-faint">p{p.id}</span>
              <span className="min-w-0 break-words">
                <span
                  className={clsx(
                    'font-semibold',
                    lrSet.has(p.lhs) ? 'text-warn' : 'text-ink',
                  )}
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

      <footer className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
        Productions are numbered as the traces cite them (0-based). ACTION cells write{' '}
        <code className="font-mono text-ink-muted">rN</code> for production{' '}
        <code className="font-mono text-ink-muted">p(N−1)</code> — the book numbers productions
        from 1.
        {leftRecursive.length > 0 && (
          <span className="mt-1 block text-warn">
            Left recursive: {leftRecursive.slice(0, 6).join(', ')}
            {leftRecursive.length > 6 ? ` … (+${leftRecursive.length - 6})` : ''}.
          </span>
        )}
      </footer>
    </aside>
  );
}
